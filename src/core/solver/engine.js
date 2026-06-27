import { Algebra } from './algebra.js';
import { Definitions } from './definitions.js';
import { InteractionSolver } from './interaction.js';
import { SolverConfig } from '../solver-config.js';
import { getCoincidentJoints } from '../joints.js';

// Newton-Raphson + Levenberg-Marquardt solver class
export class NewtonSolver {
  constructor(jointsMap, constraintsArray, shapesArray, config = {}) {
    this.joints = jointsMap; // Map<string,{x,y,fixed}>
    this.constraints = constraintsArray; // array of constraint objects
    this.shapes = shapesArray || [];
    this.config = Object.assign({
      maxIter: 20,
      tol: 1e-6,
      lambdaInit: 1e-3,
      lambdaUp: 10,
      lambdaDown: 0.1,
      verbose: false,
      // Relaxation pre-pass: a few cheap steepest-descent steps with the optimal
      // Cauchy step length, run before LM. Cuts residual fast when far from the
      // solution and gets us into Newton's basin of attraction.
      prepassEnabled: true,
      prepassIters: 10,
      // Skip the pre-pass when the initial residual is already small — Newton
      // alone will converge in 2-3 steps and the pre-pass just costs assemblies.
      prepassResidualSkip: 1e-3,
      // Hand off to LM as soon as residual drops below this; LM converges
      // quadratically inside its basin.
      prepassHandoffResidual: 1e-2
    }, config);
    this.interaction = new InteractionSolver(this);
  }

  // Pack free joint coordinates into Float64Array and build index maps
  // Exclude explicitly fixed joints and the anchored `j_origin` to minimize DOF
  _pack() {
    // Variable packing with Rigid-Body Unification for coincident clusters.
    // Goal: map all coincident (non-fixed) joints to a single variable index so
    // the Jacobian does *not* contain duplicate columns that cause rank-deficiency.
    this._varIndex = new Map();            // jointId -> varIndex (all free members mapped)
    this._clusterMembers = new Map();      // repId -> [memberIds] (only non-fixed members)

    const freeReps = [];
    const processed = new Set(); // joint ids already assigned to a cluster/var

    // Iterate in insertion order so representative selection is deterministic
    for (const [id, j] of this.joints.entries()) {
      if (!j || j.fixed) continue;
      if (id === 'j_origin') continue;
      if (processed.has(id)) continue;

      // Compute the full coincident cluster (transitive)
      const cluster = getCoincidentJoints(id, this.constraints) || new Set([id]);

      // If the cluster contains a fixed member (j_origin or fixed:true), the
      // entire cluster is pinned by that anchor. Pull every cluster member's
      // stored position to the anchor and skip them from the variable set —
      // they're constants, not unknowns. Without this, a coincident-with-fixed
      // joint becomes a solver variable held only by a unit-weight residual,
      // which a stiff mouse spring (weight ~1e4) can pull away from the anchor.
      let anchor = null;
      for (const jid of cluster) {
        const mj = this.joints.get(jid);
        if (mj && (mj.fixed || jid === 'j_origin')) { anchor = jid; break; }
      }
      if (anchor) {
        const ap = this.joints.get(anchor);
        for (const jid of cluster) {
          const mj = this.joints.get(jid);
          if (!mj) continue;
          processed.add(jid);
          if (jid === anchor) continue;
          // Snap the member to the anchor's position so densePositions is consistent.
          mj.x = ap.x; mj.y = ap.y;
        }
        continue; // no variables for this cluster
      }

      // Choose the representative as the first cluster member encountered in joint insertion order
      let rep = null;
      const members = [];
      for (const [jid] of this.joints.entries()) {
        if (!cluster.has(jid)) continue;
        const mj = this.joints.get(jid);
        if (!mj || mj.fixed) { processed.add(jid); continue; } // skip fixed members from variable mapping
        if (!rep) rep = jid;
        members.push(jid);
        processed.add(jid);
      }

      // Fallback: single free joint cluster
      if (!rep) {
        rep = id;
        members.push(id);
        processed.add(id);
      }

      // Assign a single variable index for the representative *and* map all members to it
      const varIdx = freeReps.length;
      for (const mid of members) this._varIndex.set(mid, varIdx);
      this._clusterMembers.set(rep, members);
      freeReps.push(rep);
    }

    // Build solution vector using representative ordering
    const n = freeReps.length * 2;
    const x = new Float64Array(n);
    for (let i = 0; i < freeReps.length; ++i) {
      const j = this.joints.get(freeReps[i]); x[i*2] = j.x; x[i*2+1] = j.y;
    }
    this._freeIds = freeReps;
    return x;
  }

  // Unpack solution vector back into joints map
  _unpack(x) {
    // Unpack variable vector back into all joint members of each representative cluster
    for (let i = 0; i < this._freeIds.length; ++i) {
      const repId = this._freeIds[i];
      const members = this._clusterMembers && this._clusterMembers.get(repId) ? this._clusterMembers.get(repId) : [repId];
      for (const jid of members) {
        const j = this.joints.get(jid);
        if (!j) continue;
        j.x = x[i*2];
        j.y = x[i*2+1];
      }
    }
  }

  // Build positions array indexed by joint-order (dense array) for use by Definitions
  _positionsFromVector(x) {
    // build positions array for all joints in insertion order of this.joints
    const positions = new Float64Array(this.joints.size * 2);
    let idx = 0;
    for (const [id, j] of this.joints.entries()) {
      const varIdx = this._varIndex.has(id) ? this._varIndex.get(id) : -1;
      if (varIdx >= 0) {
        positions[idx++] = x[varIdx*2]; positions[idx++] = x[varIdx*2+1];
      } else {
        // If a joint is not individually mapped but belongs to a cluster whose rep exists,
        // _varIndex will already contain the mapping for that member. The fallback is the
        // joint's stored x/y (static value).
        positions[idx++] = j.x; positions[idx++] = j.y;
      }
    }
    return positions;
  }

  // Assemble residual vector r and Jacobian J (m x n where n = 2*freeJoints)
  _assemble(x) {
    const n = x.length;
    const positions = this._positionsFromVector(x);

    // First pass: compute number of scalar constraint rows (use def.rows when available)
    let m = 0;
    const rowsPerConstraint = new Int32Array(this.constraints.length);
    const denseLen = this.joints.size * 2;
    for (let i = 0; i < this.constraints.length; ++i) {
      const c = this.constraints[i];
      const def = Definitions[c.type];
      if (def && typeof def.rows === 'number') {
        rowsPerConstraint[i] = def.rows;
      } else if (def && typeof def.rows === 'function') {
        // Variable-row constraint (e.g. branch-locked perpendicular): the def
        // decides per-instance based on params.
        rowsPerConstraint[i] = def.rows(c) | 0;
      } else if (c.type === 'coincident') {
        rowsPerConstraint[i] = 2;
      } else if (c.type === 'collinear') {
        // variable-length: joints-based (N-2 rows) or shapes-based (~sum(joints)-2)
        if (c.joints && c.joints.length >= 3) rowsPerConstraint[i] = Math.max(1, c.joints.length - 2);
        else if (c.shapes && c.shapes.length > 0) {
          let cnt = 0;
          for (const sid of c.shapes) {
            const s = this.shapes.find(ss => ss.id === sid);
            if (s && s.joints) cnt += s.joints.length;
          }
          rowsPerConstraint[i] = Math.max(1, cnt - 2);
        } else rowsPerConstraint[i] = 1;
      } else if (c.type === 'mouse_spring') {
        rowsPerConstraint[i] = 2;
      } else {
        rowsPerConstraint[i] = 1;
      }
      m += rowsPerConstraint[i];
    }

    const J = Algebra.allocMatrix(m, n); // row-major matrix (m rows, n cols)
    const r = new Float64Array(m);

    // Zero out J
    for (let i = 0; i < J.length; ++i) J[i] = 0.0;

    let row = 0;
    // Provide a mapping from joint id -> dense index used by Definitions (joint insertion order)
    const jointIndexMap = new Map();
    let jIdx = 0;
    for (const [id] of this.joints.entries()) { jointIndexMap.set(id, jIdx++); }

    // Create a positions array indexed by joint insertion order to satisfy Definitions.
    const densePositions = new Float64Array(this.joints.size * 2);
    jIdx = 0;
    for (const [id, j] of this.joints.entries()) { densePositions[jIdx*2] = (this._varIndex.has(id) ? x[this._varIndex.get(id)*2] : j.x); densePositions[jIdx*2+1] = (this._varIndex.has(id) ? x[this._varIndex.get(id)*2+1] : j.y); jIdx++; }

    for (let ci = 0; ci < this.constraints.length; ++ci) {
      const c = this.constraints[ci];

      // --- Special-case: temporary mouse-spring added by InteractionSolver ---
      if (c.type === 'mouse_spring') {
        // two scalar residuals: dx and dy weighted by sqrt(stiffness)
        const jointId = c.joints[0];
        const denseIdx = jointIndexMap.get(jointId) * 2;
        const px = densePositions[denseIdx], py = densePositions[denseIdx+1];
        const tx = c.value[0], ty = c.value[1];
        const w = Math.sqrt(c.stiffness || 1e3);
        // dx row
        r[row] = w * (px - tx);
        // dy row
        r[row+1] = w * (py - ty);
        // Jacobian rows: derivatives only on the variable that represents this joint (cluster-aware)
        const targetVar = (this._varIndex && this._varIndex.has(jointId)) ? this._varIndex.get(jointId) : -1;
        for (let vi = 0; vi < this._freeIds.length; ++vi) {
          const base = vi*2;
          if (vi === targetVar) {
            J[row * n + base + 0] = w;
            J[row * n + base + 1] = 0.0;
            J[(row+1) * n + base + 0] = 0.0;
            J[(row+1) * n + base + 1] = w;
          } else {
            J[row * n + base + 0] = 0.0;
            J[row * n + base + 1] = 0.0;
            J[(row+1) * n + base + 0] = 0.0;
            J[(row+1) * n + base + 1] = 0.0;
          }
        }
        row += 2;
        continue;
      }

      const def = Definitions[c.type];
      if (!def) { continue; }

      // Normalize parameters: map joint ids -> indices in densePositions
      const params = { ...c };
      // Prefer explicit `c.joints` when present (tests may pass joint-index arrays)
      params.joints = (c.joints || []).map(id => jointIndexMap.get(id));

      // Backwards compatibility: many constraints use `joint` + `shape` or `shapes` instead of `joints`.
      // Synthesize `params.joints` for common shape-backed constraints (pointOnLine, collinear, parallel, perpendicular).
      if ((!params.joints || params.joints.length === 0)) {
        if (c.type === 'pointOnLine' && c.joint && c.shape) {
          const shape = this.shapes.find(s => s.id === c.shape);
          if (shape && shape.type === 'line' && shape.joints && shape.joints.length >= 2) {
            params.joints = [ jointIndexMap.get(c.joint), jointIndexMap.get(shape.joints[0]), jointIndexMap.get(shape.joints[1]) ];
          }
        }
        // Support tangent between two circle/arc shapes by synthesizing center indices + radii
        else if (c.type === 'tangent' && c.shapes && c.shapes.length === 2) {
          const sA = this.shapes.find(s => s.id === c.shapes[0]);
          const sB = this.shapes.find(s => s.id === c.shapes[1]);
          if (sA && sB && (sA.type === 'circle' || sA.type === 'arc') && (sB.type === 'circle' || sB.type === 'arc')) {
            const cA = sA.joints && sA.joints.length > 0 ? sA.joints[0] : null;
            const cB = sB.joints && sB.joints.length > 0 ? sB.joints[0] : null;
            if (cA && cB) {
              const idxA = jointIndexMap.get(cA);
              const idxB = jointIndexMap.get(cB);
              if (typeof idxA === 'number' && typeof idxB === 'number') {
                params.joints = [ idxA, idxB ];
                const rA = (typeof sA.radius === 'number') ? sA.radius : (sA.joints && sA.joints.length >= 2 ? (function(){ const ci = jointIndexMap.get(sA.joints[0]) * 2; const ri = jointIndexMap.get(sA.joints[1]) * 2; const dx = densePositions[ri] - densePositions[ci]; const dy = densePositions[ri+1] - densePositions[ci+1]; return Math.hypot(dx, dy); })() : 0);
                const rB = (typeof sB.radius === 'number') ? sB.radius : (sB.joints && sB.joints.length >= 2 ? (function(){ const ci = jointIndexMap.get(sB.joints[0]) * 2; const ri = jointIndexMap.get(sB.joints[1]) * 2; const dx = densePositions[ri] - densePositions[ci]; const dy = densePositions[ri+1] - densePositions[ci+1]; return Math.hypot(dx, dy); })() : 0);
                params.radii = [rA, rB];
              }
            }
          }
        }
        // Tangent line+circle (created by the UI tool with {line, circle} fields).
        // Synthesize joints = [center, A, B] and pass radius via params.radius.
        else if (c.type === 'tangent' && c.line && c.circle) {
          const lineShape = this.shapes.find(s => s.id === c.line);
          const circShape = this.shapes.find(s => s.id === c.circle);
          if (lineShape && lineShape.type === 'line' && lineShape.joints && lineShape.joints.length >= 2 &&
              circShape && (circShape.type === 'circle' || circShape.type === 'arc') && circShape.joints && circShape.joints.length >= 1) {
            const cIdx = jointIndexMap.get(circShape.joints[0]);
            const aIdx = jointIndexMap.get(lineShape.joints[0]);
            const bIdx = jointIndexMap.get(lineShape.joints[1]);
            if (typeof cIdx === 'number' && typeof aIdx === 'number' && typeof bIdx === 'number') {
              params.joints = [cIdx, aIdx, bIdx];
              params.radius = (typeof circShape.radius === 'number')
                ? circShape.radius
                : (circShape.joints.length >= 2 ? (function(){ const ci = jointIndexMap.get(circShape.joints[0]) * 2; const ri = jointIndexMap.get(circShape.joints[1]) * 2; const dx = densePositions[ri] - densePositions[ci]; const dy = densePositions[ri+1] - densePositions[ci+1]; return Math.hypot(dx, dy); })() : 0);
            }
          }
        }
        // Distance "radius on circle" — {shape, isRadius, value}: center→rim distance.
        else if (c.type === 'distance' && c.isRadius && c.shape) {
          const shape = this.shapes.find(s => s.id === c.shape);
          if (shape && (shape.type === 'circle' || shape.type === 'arc') && shape.joints && shape.joints.length >= 2) {
            params.joints = [jointIndexMap.get(shape.joints[0]), jointIndexMap.get(shape.joints[1])];
          }
        }
        // Distance line-line — {shapes:[s1,s2], value}: perpendicular distance.
        // Synthesize as joints = [P, A, B] reusing the point_on_line residual
        // shifted by `value`. P = s2.joints[0] (one endpoint of line 2);
        // A,B = s1's endpoints (the reference line). The perpendicular distance
        // from P to line AB is computed by point_on_line; the distance residual
        // is that minus the target. Handled below in computeError dispatch.
        else if (c.type === 'distance' && c.shapes && c.shapes.length === 2) {
          const s1 = this.shapes.find(s => s.id === c.shapes[0]);
          const s2 = this.shapes.find(s => s.id === c.shapes[1]);
          if (s1 && s2 && s1.type === 'line' && s2.type === 'line' &&
              s1.joints && s1.joints.length >= 2 && s2.joints && s2.joints.length >= 1) {
            const aIdx = jointIndexMap.get(s1.joints[0]);
            const bIdx = jointIndexMap.get(s1.joints[1]);
            const pIdx = jointIndexMap.get(s2.joints[0]);
            if (typeof aIdx === 'number' && typeof bIdx === 'number' && typeof pIdx === 'number') {
              params.joints = [pIdx, aIdx, bIdx];
              params.__lineLine = true; // sentinel — distance.computeError checks this
            }
          }
        }
        else if ((c.type === 'collinear' || c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equal' || c.type === 'angle') && c.shapes && c.shapes.length > 0) {
          const jointList = [];
          for (const sid of c.shapes) {
            const s = this.shapes.find(x => x.id === sid);
            if (!s || !s.joints) continue;
            if (s.joints.length >= 2) { jointList.push(s.joints[0], s.joints[1]); }
            else if (s.joints.length === 1) { jointList.push(s.joints[0]); }
          }
          const uniq = [...new Set(jointList)];
          params.joints = uniq.map(id => jointIndexMap.get(id)).filter(idx => typeof idx === 'number');
        }
      }

      const e = def.computeError(params, densePositions);
      if (Array.isArray(e)) {
        // multi-row (e.g., coincident)
        const outRows = [new Float64Array(denseLen), new Float64Array(denseLen)];
        for (let k = 0; k < outRows.length; ++k) outRows[k].fill(0.0);
        def.computeJacobian(params, densePositions, outRows);
        for (let k = 0; k < e.length; ++k) {
          r[row] = e[k];
          const rowBuf = outRows[k];
          // copy applicable columns into J
          for (let vi = 0; vi < this._freeIds.length; ++vi) {
            const base = vi*2; // variable columns correspond to free joint ordering
            const repId = this._freeIds[vi];
            const members = (this._clusterMembers && this._clusterMembers.get(repId)) ? this._clusterMembers.get(repId) : [repId];
            let sumX = 0.0, sumY = 0.0;
            for (const mem of members) {
              const denseIdx = jointIndexMap.get(mem) * 2;
              sumX += rowBuf[denseIdx + 0];
              sumY += rowBuf[denseIdx + 1];
            }
            J[row * n + base + 0] = sumX;
            J[row * n + base + 1] = sumY;
          }
          row++;
        }
      } else {
        r[row] = e;
        const rowBuf = new Float64Array(denseLen); rowBuf.fill(0.0);
        def.computeJacobian(params, densePositions, rowBuf);
        for (let vi = 0; vi < this._freeIds.length; ++vi) {
          const base = vi*2; const repId = this._freeIds[vi];
          const members = (this._clusterMembers && this._clusterMembers.get(repId)) ? this._clusterMembers.get(repId) : [repId];
          let sumX = 0.0, sumY = 0.0;
          for (const mem of members) {
            const denseIdx = jointIndexMap.get(mem) * 2;
            sumX += rowBuf[denseIdx + 0];
            sumY += rowBuf[denseIdx + 1];
          }
          J[row * n + base + 0] = sumX;
          J[row * n + base + 1] = sumY;
        }
        row++;
      }
    }

    return { J, r, m, n };
  }

  // Steepest-descent pre-pass with optimal Cauchy step length.
  //
  // Newton/LM converges quadratically inside its basin of attraction but can
  // wander, oscillate, or pump damping λ to huge values when started far away.
  // A handful of steepest-descent steps gets us close enough that LM finishes
  // in 2-3 iterations.
  //
  // Per-step math (cheap — no factorization):
  //   gradient    g = Jᵀr
  //   direction   d = -g
  //   linearized  cost(α) = ½‖r + αJd‖² ⇒ optimal α = ‖g‖² / ‖Jg‖²
  //   accept      x ← x - α g, with Armijo backtracking if cost doesn't drop
  //
  // Returns { x, converged, residual }. converged=true means we already hit
  // tolerance; the caller can skip LM in that case.
  _preRelax(x0) {
    const maxIters = this.config.prepassIters | 0;
    if (maxIters <= 0) return { x: x0, converged: false, residual: Infinity };

    let x = new Float64Array(x0);
    const n = x.length;
    let xNew = new Float64Array(n);
    let cost = Infinity;
    let residual = Infinity;

    for (let k = 0; k < maxIters; ++k) {
      const { J, r, m } = this._assemble(x);
      if (m === 0) return { x, converged: true, residual: 0 };

      cost = 0; for (let i = 0; i < m; ++i) cost += r[i] * r[i]; cost *= 0.5;
      residual = Math.sqrt(2 * cost);
      if (residual < this.config.tol) return { x, converged: true, residual };
      // Inside Newton's basin — let LM finish.
      if (residual < this.config.prepassHandoffResidual) return { x, converged: false, residual };

      // g = Jᵀ r
      const g = new Float64Array(n);
      for (let j = 0; j < n; ++j) {
        let s = 0; for (let i = 0; i < m; ++i) s += J[i * n + j] * r[i];
        g[j] = s;
      }
      let gNorm2 = 0; for (let j = 0; j < n; ++j) gNorm2 += g[j] * g[j];
      if (gNorm2 < 1e-24) return { x, converged: false, residual };

      // ‖Jg‖² (avoid materializing Jg)
      let JgNorm2 = 0;
      for (let i = 0; i < m; ++i) {
        let s = 0; for (let j = 0; j < n; ++j) s += J[i * n + j] * g[j];
        JgNorm2 += s * s;
      }
      if (JgNorm2 < 1e-30) return { x, converged: false, residual };

      let alpha = gNorm2 / JgNorm2;
      let accepted = false;
      // Armijo backtracking: try the Cauchy step, halve up to 6 times.
      for (let bt = 0; bt < 6; ++bt) {
        for (let j = 0; j < n; ++j) xNew[j] = x[j] - alpha * g[j];
        const { r: rNew } = this._assemble(xNew);
        let costNew = 0; for (let i = 0; i < rNew.length; ++i) costNew += rNew[i] * rNew[i]; costNew *= 0.5;
        if (costNew < cost - 1e-4 * alpha * gNorm2) {
          // swap x ↔ xNew (avoid re-alloc)
          const tmp = x; x = xNew; xNew = tmp;
          cost = costNew;
          accepted = true;
          break;
        }
        alpha *= 0.5;
      }
      if (!accepted) return { x, converged: false, residual };

      if (this.config.verbose) {
        try { console.log('[NewtonSolver] prepass iter=', k, 'cost=', cost.toExponential(), 'alpha=', alpha.toExponential()); } catch(_) {}
      }
    }

    return { x, converged: false, residual: Math.sqrt(2 * cost) };
  }

  // Public solve entry point. If dragTarget provided, interaction module will add temporary spring.
  solve(iter = this.config.maxIter, options = {}) {
    const x0 = this._pack();
    if (x0.length === 0) {
      // No free variables — every joint is pinned (all fixed, or merged into a
      // fixed coincident cluster). The sketch can't move, but its constraints
      // may still be VIOLATED (e.g. a distance on a joint welded to the origin).
      // Check the residual instead of unconditionally claiming success.
      const { r } = this._assemble(x0);
      let s = 0; for (let i = 0; i < r.length; ++i) s += r[i] * r[i];
      const residual0 = Math.sqrt(s);
      return { converged: residual0 < this.config.tol, error: residual0, rankDeficient: false };
    }

    let x = new Float64Array(x0); // current estimate
    let lambda = this.config.lambdaInit;
    let lastCost = Infinity;
    let converged = false;
    let finalError = 0;
    // Tracks whether JᵀJ is singular at the final state (rank(J) < n).
    // In CAD terms: the sketch is under-constrained — there are free directions
    // along which the residual doesn't change. The solver may still report
    // converged=true if it found a valid configuration; the flag tells the
    // UI that the configuration is non-unique.
    let rankDeficient = false;

    // If a drag target exists (explicit via options OR implicit j.dragTarget on a joint), inject a temporary 'mouse-spring'
    let cleanup = null;
    let dragOpt = options && options.dragTarget ? options.dragTarget : null;
    if (!dragOpt) {
      // auto-detect first joint carrying a dragTarget set by UI input handlers
      for (const [id, j] of this.joints.entries()) {
        if (j && j.dragTarget && !j.fixed) {
          dragOpt = { jointId: id, x: j.dragTarget.x, y: j.dragTarget.y, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 };
          break;
        }
      }
    }
    if (dragOpt) cleanup = this.interaction.attachMouseSpring(dragOpt);

    // Relaxation pre-pass: only worthwhile when starting far from the solution.
    // Cheap cost-of-entry: one assemble to measure initial residual.
    if (this.config.prepassEnabled) {
      const { r: rInit } = this._assemble(x);
      let r0 = 0; for (let i = 0; i < rInit.length; ++i) r0 += rInit[i] * rInit[i];
      const residual0 = Math.sqrt(r0);
      if (residual0 > this.config.prepassResidualSkip) {
        const pre = this._preRelax(x);
        x = pre.x;
        if (pre.converged) {
          // Even a converged pre-pass deserves the rank check — the user may
          // want to know the sketch has freedom even though we found a fit.
          rankDeficient = this._checkRankDeficient(x);
          this._unpack(x);
          if (cleanup) cleanup();
          return { converged: true, error: pre.residual, rankDeficient };
        }
      }
    }

    for (let k = 0; k < iter; ++k) {
      const { J, r, m, n } = this._assemble(x);
      // cost = 0.5 * r^T r
      let cost = 0.0; for (let i = 0; i < m; ++i) cost += r[i] * r[i]; cost *= 0.5;

      // check convergence on residual (treat `tol` as world-space residual target)
      const residual = Math.sqrt(2 * cost);
      if (residual < this.config.tol) { converged = true; finalError = residual; break; }

      // Build normal equations: A = J^T J  (n x n), g = J^T r (n)
      const A = Algebra.allocMatrix(n, n); for (let i=0;i<A.length;++i) A[i]=0.0;
      Algebra.gram(J, m, n, A);
      const g = new Float64Array(n); Algebra.atx(J, m, n, r, g);
      // Levenberg-Marquardt: (A + lambda * diag(A)) dx = -g
      for (let i = 0; i < n; ++i) {
        // LM damping — add λ on the diagonal (J^T J + λ I)
        A[i * n + i] += lambda + 1e-12;
        g[i] = -g[i]; // move to RHS
      }

      const dx = new Float64Array(g); // copy RHS
      const Acopy = new Float64Array(A); // cholesky is destructive
      const ok = Algebra.choleskySolve(Acopy, n, dx);
      if (!ok) {
        // Matrix not positive definite: increase damping and retry
        lambda *= this.config.lambdaUp;
        if (lambda > 1e12) break;
        continue;
      }

      // candidate update
      const xCand = new Float64Array(n);
      let maxStep = 0.0;
      for (let i = 0; i < n; ++i) { xCand[i] = x[i] + dx[i]; maxStep = Math.max(maxStep, Math.abs(dx[i])); }

      // Evaluate new cost
      const { r: rNew } = this._assemble(xCand);
      let costNew = 0.0; for (let i = 0; i < rNew.length; ++i) costNew += rNew[i] * rNew[i]; costNew *= 0.5;

      if (this.config.verbose) {
        try { console.log('[NewtonSolver] iter=', k, 'cost=', cost.toExponential(), 'costNew=', costNew.toExponential(), 'lambda=', lambda.toExponential(), 'maxStep=', maxStep.toExponential()); } catch(_) {}
      }

      if (costNew < cost) {
        // Accept step
        x = xCand; lastCost = costNew; lambda = Math.max(this.config.lambdaInit, lambda * this.config.lambdaDown);
      } else {
        // Reject step, increase damping
        lambda *= this.config.lambdaUp;
      }

      // Convergence by step magnitude
      if (maxStep < this.config.tol) { converged = true; finalError = Math.sqrt(2 * costNew); x = xCand; break; }

      // keep last cost
      finalError = Math.sqrt(2 * costNew);
    }

    // Optional polishing Gauss-Newton pass (zero-damping) to improve final
    // accuracy. The undamped Cholesky here doubles as a rank-deficiency probe:
    // success ⟺ JᵀJ is positive-definite ⟺ rank(J) = n ⟺ well-constrained.
    try {
      const assembled = this._assemble(x);
      const { J, r, m, n } = assembled;
      const A = Algebra.allocMatrix(n, n); for (let i=0;i<A.length;++i) A[i]=0.0;
      Algebra.gram(J, m, n, A);
      const g = new Float64Array(n); Algebra.atx(J, m, n, r, g);
      for (let i = 0; i < n; ++i) g[i] = -g[i];
      const Acopy = new Float64Array(A);
      const dx = new Float64Array(g);
      const ok = Algebra.choleskySolve(Acopy, n, dx);
      rankDeficient = !ok;
      if (ok) {
        // apply small polish step and accept only if it reduces residual
        const xPolish = new Float64Array(n);
        for (let i = 0; i < n; ++i) xPolish[i] = x[i] + dx[i];
        const rPolish = this._assemble(xPolish).r;
        let costPolish = 0.0; for (let i = 0; i < rPolish.length; ++i) costPolish += rPolish[i] * rPolish[i]; costPolish *= 0.5;
        if (costPolish < 0.5 * finalError * finalError) {
          x = xPolish; finalError = Math.sqrt(2 * costPolish);
        }
      }
    } catch (_) { /* fail-open: polishing is optional */ }

    // write back
    this._unpack(x);
    if (cleanup) cleanup();

    return { converged, error: finalError, rankDeficient };
  }

  // One-shot rank-deficiency probe at position x. Re-assembles, builds JᵀJ
  // (no LM damping), tries Cholesky. Failure ⟺ rank(J) < n.
  // Used by the early-return path when the pre-pass converges before LM runs.
  _checkRankDeficient(x) {
    try {
      const { J, m, n } = this._assemble(x);
      if (m === 0 || n === 0) return false;
      const A = Algebra.allocMatrix(n, n); for (let i = 0; i < A.length; ++i) A[i] = 0.0;
      Algebra.gram(J, m, n, A);
      const probe = new Float64Array(n);
      return !Algebra.choleskySolve(A, n, probe);
    } catch (_) { return false; }
  }
}

// Export a convenience default solver factory to preserve call-site compatibility
export function createNewtonSolver(joints, constraints, shapes, config) {
  return new NewtonSolver(joints, constraints, shapes, config);
}
