import { Algebra } from './algebra.js';
import { Definitions, BODY_POINTS } from './definitions.js';
import { InteractionSolver } from './interaction.js';
import { SolverConfig } from '../solver-config.js';
import { getCoincidentJoints } from '../joints.js';
import { isPointLineDistance } from '../geometry.js';
import { symmetricOperands } from '../symmetric.js';

// THE declaration of the solver's non-joint unknown (task 515, like Fusion and PlaneGCS): a CIRCLE is one centre joint plus a `radius`,
// and that radius is a solver unknown. `shape.radius` stays the ONE store: _pack reads it as the start value, _unpack writes the solved
// value back. An arc is not one of these: its radius is live through its rim joints (|rim - centre|).
export function hasRadiusUnknown(s) {
  return !!s && s.type === 'circle' && Array.isArray(s.joints) && s.joints.length === 1 && typeof s.radius === 'number' && Number.isFinite(s.radius);
}

// The solver state is joint x/y AND every circle radius: a caller that tries a solve and rolls it back snapshots and restores both here.
export function snapshotSolverState(joints, shapes) {
  const pos = new Map(), radii = new Map();
  for (const [id, j] of joints) pos.set(id, { x: j.x, y: j.y });
  for (const s of (shapes || [])) if (hasRadiusUnknown(s)) radii.set(s, s.radius);
  return { pos, radii };
}
export function restoreSolverState(joints, shapes, snap) {
  for (const [id, j] of joints) { const p = snap.pos.get(id); if (p) { j.x = p.x; j.y = p.y; } }
  for (const [s, r] of snap.radii) s.radius = r;
}

// THE reachable directions of a point p(x) (task 538): its gradient with respect to the unknowns as sparse entries [{ col, gx, gy }]
// (a joint: the identity on its two columns; a body point: its BODY_POINTS gradient) through the constraint nullspace N (n x k):
// M = G N, aa = |M_x|^2, bb = |M_y|^2, ab = M_x . M_y. rank 0 = the point cannot move, 1 = only along dir, 2 = freely.
export function reachableDirections(N, k, grad) {
  let aa = 0, bb = 0, ab = 0;
  for (let q = 0; q < k; ++q) {
    let a = 0, b = 0;
    for (const g of grad) { const v = N[g.col * k + q]; a += g.gx * v; b += g.gy * v; }
    aa += a * a; bb += b * b; ab += a * b;
  }
  const fx = aa > 1e-10, fy = bb > 1e-10;
  let rank = 0;
  if (fx || fy) rank = (aa * bb - ab * ab > 1e-9 * aa * bb) ? 2 : 1;
  let dir = null;
  if (rank === 1) { const v = aa >= bb ? [aa, ab] : [ab, bb], l = Math.hypot(v[0], v[1]); dir = [v[0] / l, v[1] / l]; }
  return { fx, fy, rank, dir };
}

// One assembly (_assemble): the residuals r (m), the sparse Jacobian rows S (Algebra's form, null for a residuals-only assembly) and, on
// first read, J: the dense m x n row-major copy of S.
class Assembly {
  constructor(S, r, m, n) { this.S = S; this.r = r; this.m = m; this.n = n; this._J = null; }
  get J() { return this._J || (this._J = Algebra.dense(this.S, this.m, this.n)); }
}

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
    // the dense index of each joint (insertion order): the order of a cluster's members and the layout _assemble reads
    this._jointIndex = new Map();
    let ji = 0;
    for (const [id] of this.joints.entries()) this._jointIndex.set(id, ji++);
    // The coincident clusters, every one at once (task 541): the connected components of the coincident pairs, the same sets
    // getCoincidentJoints closes transitively one joint at a time; each component's joints in insertion order.
    const parent = new Map();
    const find = (a) => {
      if (!parent.has(a)) { parent.set(a, a); return a; }
      let r = a; while (parent.get(r) !== r) r = parent.get(r);
      while (a !== r) { const nx = parent.get(a); parent.set(a, r); a = nx; }
      return r;
    };
    for (const c of this.constraints) {
      if (c.type === 'coincident' && c.joints) { const [j1, j2] = c.joints; const a = find(j1), b = find(j2); if (a !== b) parent.set(a, b); }
    }
    const inOrder = new Map(); // component root -> its joints in insertion order
    for (const [id] of this.joints.entries()) {
      const root = parent.has(id) ? find(id) : id;
      if (!inOrder.has(root)) inOrder.set(root, []);
      inOrder.get(root).push(id);
    }

    // Iterate in insertion order so representative selection is deterministic
    for (const [id, j] of this.joints.entries()) {
      if (!j || j.fixed) continue;
      if (id === 'j_origin') continue;
      if (processed.has(id)) continue;

      // The full coincident cluster (transitive), its joints in insertion order
      const clusterJoints = inOrder.get(parent.has(id) ? find(id) : id);

      // If the cluster contains a fixed member (j_origin or fixed:true), the
      // entire cluster is pinned by that anchor. Pull every cluster member's
      // stored position to the anchor and skip them from the variable set —
      // they're constants, not unknowns. Without this, a coincident-with-fixed
      // joint becomes a solver variable held only by a unit-weight residual,
      // which a stiff mouse spring (weight ~1e4) can pull away from the anchor.
      // The anchor is the first fixed member in getCoincidentJoints' order (which one, when a cluster holds two, decides where it snaps).
      let anchor = null, cluster = null;
      if (clusterJoints.some(jid => { const mj = this.joints.get(jid); return mj && (mj.fixed || jid === 'j_origin'); })) {
        cluster = getCoincidentJoints(id, this.constraints);
        for (const jid of cluster) {
          const mj = this.joints.get(jid);
          if (mj && (mj.fixed || jid === 'j_origin')) { anchor = jid; break; }
        }
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
      for (const jid of clusterJoints) {
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

    // Build the solution vector: x,y of each free joint representative, then the radius of each circle (hasRadiusUnknown), in
    // shapes order. Radius k is x[_nJointVars + k] here and positions[2 * joints.size + k] in the dense array the Definitions read.
    const nJ = freeReps.length * 2;
    this._radiusShapes = (this.shapes || []).filter(hasRadiusUnknown);
    this._radiusSlot = new Map(this._radiusShapes.map((s, k) => [s.id, k]));
    const x = new Float64Array(nJ + this._radiusShapes.length);
    for (let i = 0; i < freeReps.length; ++i) {
      const j = this.joints.get(freeReps[i]); x[i*2] = j.x; x[i*2+1] = j.y;
    }
    for (let k = 0; k < this._radiusShapes.length; ++k) x[nJ + k] = this._radiusShapes[k].radius;
    this._freeIds = freeReps;
    this._nJointVars = nJ;
    // The layout _assemble reads (task 541): the J column of each dense index (a joint's x/y -> its cluster's variable, a circle radius ->
    // its unknown, -1 = a constant: fixed or anchored) and the reusable row buffers.
    const denseLen = this.joints.size * 2 + this._radiusShapes.length;
    this._colOf = new Int32Array(denseLen).fill(-1);
    for (const [id, vi] of this._varIndex) { const d = this._jointIndex.get(id) * 2; this._colOf[d] = vi * 2; this._colOf[d + 1] = vi * 2 + 1; }
    for (let k = 0; k < this._radiusShapes.length; ++k) this._colOf[this.joints.size * 2 + k] = nJ + k;
    this._rowBufs = [new Float64Array(denseLen), new Float64Array(denseLen)]; // zero between rows (_assemble's emitRow clears them)
    this._acc = new Float64Array(x.length);
    this._mark = new Uint8Array(x.length);
    this._touched = new Int32Array(x.length);
    this._ops = new Int32Array(16);
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
    // THE write-back of a circle's solved radius (shape.radius is its only store).
    for (let k = 0; k < this._radiusShapes.length; ++k) this._radiusShapes[k].radius = x[this._nJointVars + k];
  }

  // Build the dense array the Definitions read: x,y of every joint in insertion order of this.joints, then each circle radius
  // (radius k at 2 * joints.size + k, see _radiusAt).
  _positionsFromVector(x) {
    const positions = new Float64Array(this.joints.size * 2 + this._radiusShapes.length);
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
    for (let k = 0; k < this._radiusShapes.length; ++k) positions[idx++] = x[this._nJointVars + k];
    return positions;
  }

  // Dense index of a shape's radius unknown, or undefined (not a circle with a radius unknown).
  _radiusAt(shape) {
    const k = shape ? this._radiusSlot.get(shape.id) : undefined;
    return k === undefined ? undefined : this.joints.size * 2 + k;
  }

  // THE radius operand of a circle/arc in a row (definitions.js radiusValue / addRadiusDerivative): { at } a circle's radius unknown;
  // { radius } a stored constant; { rim } an arc's LIVE radius |rim - centre|, rim = its FIRST rim joint (joints[1]; makeArc's
  // equal keeps the second rim at the same distance), so the row differentiates the radius through the rim and centre joints.
  _radiusOperand(shape, jointIndexMap) {
    const at = this._radiusAt(shape);
    if (at !== undefined) return { at };
    if (shape && typeof shape.radius === 'number') return { radius: shape.radius };
    const rim = shape && shape.joints && shape.joints.length >= 2 ? jointIndexMap.get(shape.joints[1]) : undefined;
    return typeof rim === 'number' ? { rim } : { radius: 0 };
  }

  // THE size term of a shape in a row (definitions.js sizeValue): { at } a circle's radius unknown, { a, b } the length of its first two joints
  // (a line, or an arc's centre-rim pair = its live radius), null when it has neither.
  _sizeTerm(s, jointIndexMap) {
    const at = this._radiusAt(s);
    if (at !== undefined) return { at };
    const a = s && s.joints && s.joints.length >= 2 ? jointIndexMap.get(s.joints[0]) : undefined;
    const b = s && s.joints && s.joints.length >= 2 ? jointIndexMap.get(s.joints[1]) : undefined;
    return typeof a === 'number' && typeof b === 'number' ? { a, b } : null;
  }

  // THE operand of a BODY drag target (task 538) { shape: id, param }: the shape kind's declared BODY_POINTS entry and its op
  // (dense joint indices in shape.joints order, the parameter, the radius operand of a circle / arc).
  _bodyOperand(body, jointIndexMap, target) {
    const shape = this.shapes.find(s => s && s.id === body.shape);
    const kind = shape ? BODY_POINTS[shape.type] : undefined;
    if (!kind) throw new Error(`body drag target: shape ${body.shape} has no declared body point (BODY_POINTS[${shape ? shape.type : 'missing shape'}])`);
    const rad = this._radiusOperand(shape, jointIndexMap);
    return { kind, op: { joints: shape.joints.map(id => jointIndexMap.get(id)), param: body.param, target, radiusAt: rad.at, radius: rad.radius, rimJoint: rad.rim } };
  }

  // Assemble residual vector r and Jacobian J (m x n where n = 2*freeJoints + circle radii, the layout of _pack). J is SPARSE (task 541):
  // the result's S = { rowPtr, cols, vals } holds each row's non-zero columns ascending (Algebra); `J` is its dense m x n row-major copy,
  // built on first read (tests and audits read it). opts.jacobian === false: the residuals only (S null), for the trial steps.
  _assemble(x, opts = {}) {
    const withJ = opts.jacobian !== false;
    const n = x.length;

    // First pass: compute number of scalar constraint rows (use def.rows when available)
    let m = 0;
    const rowsPerConstraint = new Int32Array(this.constraints.length);
    for (let i = 0; i < this.constraints.length; ++i) {
      const c = this.constraints[i];
      if (c.isDriven || c.driven) { rowsPerConstraint[i] = 0; continue; } // references are FREE — no rows
      // a BODY drag spring (task 538): its 2 rows plus 2 per temporarily held joint
      if (c.type === 'mouse_spring' && c.body) { rowsPerConstraint[i] = 2 + 2 * ((c.body.hold && c.body.hold.length) || 0); m += rowsPerConstraint[i]; continue; }
      const def = Definitions[c.type];
      if (def && typeof def.rows === 'number') {
        rowsPerConstraint[i] = def.rows;
      } else if (def && typeof def.rows === 'function') {
        // Variable-row constraint (symmetric: 2 per mirrored pair + 1 for a radius equality): the def decides per instance, from the
        // constraint and the shapes it names.
        rowsPerConstraint[i] = def.rows(c, this.shapes) | 0;
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

    const r = new Float64Array(m);
    // The sparse rows of J: row i's entries are cols/vals[rowPtr[i] .. rowPtr[i + 1]). A row past m is dropped, a row never written is empty
    // (a zero row), as the dense m x n matrix did.
    const rowPtr = new Int32Array(m + 1);
    let cap = Math.max(16, m * 8), nnz = 0;
    let cols = new Int32Array(cap), vals = new Float64Array(cap);
    const push = (c, v) => {
      if (nnz === cap) { cap *= 2; const c2 = new Int32Array(cap); c2.set(cols); cols = c2; const v2 = new Float64Array(cap); v2.set(vals); vals = v2; }
      cols[nnz] = c; vals[nnz] = v; nnz++;
    };

    let row = 0;
    const endRow = () => { if (row < m) rowPtr[row + 1] = nnz; row++; };
    // The mapping from joint id -> dense index used by Definitions (joint insertion order, _pack)
    const jointIndexMap = this._jointIndex;

    // The dense array the Definitions read (joints in insertion order, then the circle radii).
    const densePositions = this._positionsFromVector(x);
    const denseLen = densePositions.length;
    const colOf = this._colOf, acc = this._acc, mark = this._mark, touched = this._touched, bufs = this._rowBufs;
    // THE operands of a row: the dense indices its Definition reads and differentiates, every one set into the row's params (or a body
    // point's op) by this function: joints / rimJoint / rimJoints / the terms' a and b (both coordinates of a joint), radiusAt / radiiAt /
    // the terms' at (a circle's radius unknown). Ascending, so emitRow sums a cluster's members in insertion order. A Definition writing
    // anywhere else would leave a row buffer dirty: the assembly checks they are all zero at its end and THROWS (never a wrong row).
    let ops = this._ops, nOps = 0;
    const addIdx = (i) => { if (nOps === ops.length) { const o2 = new Int32Array(ops.length * 2); o2.set(ops); ops = this._ops = o2; } ops[nOps++] = i; };
    const addJoint = (j) => { if (Number.isInteger(j) && j >= 0) { addIdx(j * 2); addIdx(j * 2 + 1); } };
    const addAt = (a) => { if (Number.isInteger(a) && a >= 0) addIdx(a); };
    const operandsOf = (p) => {
      nOps = 0;
      if (Array.isArray(p.joints)) for (const j of p.joints) addJoint(j);
      addAt(p.radiusAt); addJoint(p.rimJoint);
      if (Array.isArray(p.radiiAt)) for (const a of p.radiiAt) addAt(a);
      if (Array.isArray(p.rimJoints)) for (const j of p.rimJoints) addJoint(j);
      if (Array.isArray(p.terms)) for (const t of p.terms) if (t) { addAt(t.at); addJoint(t.a); addJoint(t.b); }
      for (let a = 1; a < nOps; ++a) { const v = ops[a]; let b = a - 1; while (b >= 0 && ops[b] > v) { ops[b + 1] = ops[b]; --b; } ops[b + 1] = v; }
    };
    // Close row `row` from one dense Jacobian row (the Definitions' layout) over the row's operands, scaled by w: a joint column sums its
    // cluster members (in insertion order), a radius column is copied, a constant (fixed / anchored) joint has no column. The operands are
    // left zeroed for the next row. Exactly the dense values: a column no member touches is 0, and is not stored.
    const emitRow = (buf, w = wStruct) => {
      let t = 0;
      for (let q = 0; q < nOps; ++q) {
        const i = ops[q], v = buf[i];
        if (v !== 0) {
          buf[i] = 0;
          const c = colOf[i];
          if (c >= 0) { if (!mark[c]) { mark[c] = 1; touched[t++] = c; } acc[c] += v; }
        }
      }
      for (let a = 1; a < t; ++a) { const c = touched[a]; let b = a - 1; while (b >= 0 && touched[b] > c) { touched[b + 1] = touched[b]; --b; } touched[b + 1] = c; }
      for (let a = 0; a < t; ++a) { const c = touched[a]; push(c, acc[c] * w); acc[c] = 0; mark[c] = 0; }
      endRow();
    };

    // --- Drag-time structural weighting ---------------------------------------
    // A temporary mouse-spring (added by InteractionSolver during a drag) carries
    // weight sqrt(stiffness) (~100 by default). At unit weight, the shape-defining
    // constraints (H/V/perp/parallel/coincident) and dimensions LOSE that tug and the
    // shape SHEARS. Lift every real constraint to RATIO * the spring weight so geometry
    // and dimensions DOMINATE: the drag can only move the joint within the feasible
    // manifold (resize), never break structure. Using a ratio to the spring (rather than
    // an absolute weight) keeps J^TJ conditioning bounded whatever the spring stiffness.
    // No spring present (every normal solve) => wStruct = 1, so this path is inert and the
    // oracle / convergence semantics are unchanged.
    let wStruct = 1;
    {
      let springW = 0;
      for (const sc of this.constraints) {
        if (sc.type === 'mouse_spring') springW = Math.max(springW, Math.sqrt(sc.stiffness || 1e3));
      }
      if (springW > 0) wStruct = springW * (SolverConfig.STRUCTURAL_DRAG_RATIO || 1);
    }

    for (let ci = 0; ci < this.constraints.length; ++ci) {
      const c = this.constraints[ci];
      if (c.isDriven || c.driven) continue; // skip driven (reference) rows — a reference never affects geometry

      // --- Temporary mouse-spring added by InteractionSolver, BODY form (task 538): the grabbed point of a shape, P(x) - target,
      // weighted sqrt(stiffness) (never wStruct), its two rows from the shape kind's declared BODY_POINTS entry (cluster-aware emitRow).
      if (c.type === 'mouse_spring' && c.body) {
        const b = this._bodyOperand(c.body, jointIndexMap, c.value);
        const w = Math.sqrt(c.stiffness || 1e3);
        const p = b.kind.point(b.op, densePositions);
        r[row] = w * (p[0] - c.value[0]);
        r[row+1] = w * (p[1] - c.value[1]);
        if (withJ) {
          operandsOf(b.op);
          b.kind.grad(b.op, densePositions, bufs);
          emitRow(bufs[0], w);
          emitRow(bufs[1], w);
        } else row += 2;
        // the drag's temporary HOLDS (engine.bodyDragTarget: e.g. a circle's centre): joint - its held position, weighted like a
        // structural row (wStruct) so the spring moves what is not held.
        for (const h of (c.body.hold || [])) {
          const hj = jointIndexMap.get(h.joint);
          for (let k = 0; k < 2; ++k) {
            r[row] = wStruct * (densePositions[hj*2 + k] - (k ? h.y : h.x));
            if (withJ) {
              const col = colOf[hj*2 + k];   // the row's one entry: d(joint)/d(its column) = 1
              if (col >= 0) push(col, 1 * wStruct);
            }
            endRow();
          }
        }
        continue;
      }

      // --- Special-case: temporary mouse-spring added by InteractionSolver (JOINT form) ---
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
        if (withJ && targetVar >= 0) push(targetVar * 2, w);
        endRow();
        if (withJ && targetVar >= 0) push(targetVar * 2 + 1, w);
        endRow();
        continue;
      }

      const def = Definitions[c.type];
      if (!def) { continue; }

      // Normalize parameters: map joint ids -> indices in densePositions
      const params = { ...c };
      // Prefer explicit `c.joints` when present (tests may pass joint-index arrays)
      params.joints = (c.joints || []).map(id => jointIndexMap.get(id));

      // H/V dimension: lock WHICH SIDE b sits on (sign of the projection) on the constraint at first solve, so a drag
      // across a cannot flip it (same idea as the perpendicular branch lock). Re-locked if the mode changes.
      if (c.type === 'distance' && (c.dimMode === 'horizontal' || c.dimMode === 'vertical') && params.joints.length === 2 &&
          typeof params.joints[0] === 'number' && typeof params.joints[1] === 'number') {
        if (c.dimSign !== 1 && c.dimSign !== -1 || c.dimSignMode !== c.dimMode) {
          const k = c.dimMode === 'horizontal' ? 0 : 1;
          const d = densePositions[params.joints[1]*2 + k] - densePositions[params.joints[0]*2 + k];
          c.dimSign = d < 0 ? -1 : 1;
          c.dimSignMode = c.dimMode;
        }
        params.dimSign = c.dimSign;
      }

      // Point-to-line dimension: joints [P, A, B] -> the perpendicular distance from P to line AB (the line-line row).
      if (c.type === 'distance' && isPointLineDistance(c)) params.__lineLine = true;

      // Symmetric (task 563): ONE operand reader (#core/symmetric.js) -> joints [line s1, line s2, the mirrored pairs (nPairs), the points on a
      // mirrored line (task 572: q, a1, a2 each)] and, for circles / arcs, the two size terms of the radius equality. Unresolved -> no joints:
      // the Definition returns no rows (and counted none).
      if (c.type === 'symmetric') {
        const o = symmetricOperands(c, this.shapes);
        params.joints = o ? [...o.line, ...o.pairs.flat(), ...o.onLine.flat()].map(id => jointIndexMap.get(id)) : [];
        params.nPairs = o ? o.pairs.length : 0;
        if (o && o.sizes) params.terms = o.sizes.map(sh => this._sizeTerm(sh, jointIndexMap));
      }

      // Backwards compatibility: many constraints use `joint` + `shape` or `shapes` instead of `joints`.
      // Synthesize `params.joints` for common shape-backed constraints (pointOnLine, collinear, parallel, perpendicular).
      if ((!params.joints || params.joints.length === 0)) {
        if (c.type === 'pointOnLine' && c.joint && c.shape) {
          const shape = this.shapes.find(s => s.id === c.shape);
          if (shape && shape.type === 'line' && shape.joints && shape.joints.length >= 2) {
            params.joints = [ jointIndexMap.get(c.joint), jointIndexMap.get(shape.joints[0]), jointIndexMap.get(shape.joints[1]) ];
          }
          // Point-on-circle/arc: |P - centre| = radius. joints = [point, center]; a circle's radius is its unknown (radiusAt),
          // an arc's is live through its rim joint (rimJoint). (Without this branch a circle target left params.joints empty
          // -> NaN -> the constraint was silently ignored.)
          else if (shape && (shape.type === 'circle' || shape.type === 'arc') && shape.joints && shape.joints.length >= 1) {
            params.joints = [ jointIndexMap.get(c.joint), jointIndexMap.get(shape.joints[0]) ];
            const op = this._radiusOperand(shape, jointIndexMap);
            params.radiusAt = op.at; params.radius = op.radius; params.rimJoint = op.rim;
            params.onCircle = true;
          }
        }
        // Support tangent: circle-circle (via shapes), or line+circle (via {line, circle} or shapes [line, circle] / [circle, line])
        else if (c.type === 'tangent') {
          let lineId = c.line;
          let circleId = c.circle;
          if ((!lineId || !circleId) && c.shapes && c.shapes.length === 2) {
            const sA = this.shapes.find(s => s && s.id === c.shapes[0]);
            const sB = this.shapes.find(s => s && s.id === c.shapes[1]);
            if (sA && sB) {
              if ((sA.type === 'circle' || sA.type === 'arc') && (sB.type === 'circle' || sB.type === 'arc')) {
                const cA = sA.joints && sA.joints.length > 0 ? sA.joints[0] : null;
                const cB = sB.joints && sB.joints.length > 0 ? sB.joints[0] : null;
                if (cA && cB) {
                  const idxA = jointIndexMap.get(cA);
                  const idxB = jointIndexMap.get(cB);
                  if (typeof idxA === 'number' && typeof idxB === 'number') {
                    params.joints = [ idxA, idxB ];
                    const opA = this._radiusOperand(sA, jointIndexMap), opB = this._radiusOperand(sB, jointIndexMap);
                    params.radii = [opA.radius, opB.radius];
                    params.radiiAt = [opA.at, opB.at];       // a circle operand reads its radius unknown
                    params.rimJoints = [opA.rim, opB.rim];   // an arc operand's radius is live through its rim joint
                  }
                }
              } else if (sA.type === 'line' && (sB.type === 'circle' || sB.type === 'arc')) {
                lineId = sA.id;
                circleId = sB.id;
              } else if (sB.type === 'line' && (sA.type === 'circle' || sA.type === 'arc')) {
                lineId = sB.id;
                circleId = sA.id;
              }
            }
          }
          // Tangent line+circle (created by the UI tool with {line, circle} fields or mapped from shapes).
          // Synthesize joints = [center, A, B] and pass radius via params.radius.
          if (lineId && circleId) {
            const lineShape = this.shapes.find(s => s && s.id === lineId);
            const circShape = this.shapes.find(s => s && s.id === circleId);
            if (lineShape && lineShape.type === 'line' && lineShape.joints && lineShape.joints.length >= 2 &&
                circShape && (circShape.type === 'circle' || circShape.type === 'arc') && circShape.joints && circShape.joints.length >= 1) {
              const cIdx = jointIndexMap.get(circShape.joints[0]);
              const aIdx = jointIndexMap.get(lineShape.joints[0]);
              const bIdx = jointIndexMap.get(lineShape.joints[1]);
              if (typeof cIdx === 'number' && typeof aIdx === 'number' && typeof bIdx === 'number') {
                params.joints = [cIdx, aIdx, bIdx];
                // Shared endpoint (a fillet: the line ends ON the arc's rim joint) -> endpoint-tangency
                // residual (P - C) . u/|u| = 0, non-singular; distance-to-line has a double root there.
                const arcRim = new Set(circShape.joints.slice(1));
                if (arcRim.has(lineShape.joints[0])) params.sharedEnd = 'a';
                else if (arcRim.has(lineShape.joints[1])) params.sharedEnd = 'b';
                // a circle's radius unknown or an arc's live |rim - centre| takes part in the row
                const op = this._radiusOperand(circShape, jointIndexMap);
                params.radiusAt = op.at; params.radius = op.radius; params.rimJoint = op.rim;
              }
            }
          }
        }
        // Distance "radius" — {shape, isRadius, value}: a circle's radius unknown (radiusAt), an arc's center→rim distance.
        else if (c.type === 'distance' && c.isRadius && c.shape) {
          const shape = this.shapes.find(s => s.id === c.shape);
          if (this._radiusAt(shape) !== undefined) params.radiusAt = this._radiusAt(shape);
          else if (shape && (shape.type === 'circle' || shape.type === 'arc') && shape.joints && shape.joints.length >= 2) {
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
        // Equal with a CIRCLE operand: one size term per shape, a circle's radius unknown or the length of a line / an arc's
        // centre-rim pair (its first two joints), so equal(circle, circle) is r1 - r2 and equal(circle, arc) r - |rim - centre|.
        else if (c.type === 'equal' && c.shapes && c.shapes.length === 2 && c.shapes.some(sid => this._radiusAt(this.shapes.find(x => x && x.id === sid)) !== undefined)) {
          const terms = c.shapes.map(sid => this._sizeTerm(this.shapes.find(x => x && x.id === sid), jointIndexMap));
          if (terms.every(Boolean)) params.terms = terms;
        }
        else if ((c.type === 'collinear' || c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equal' || c.type === 'angle') && c.shapes && c.shapes.length > 0) {
          const jointList = [];
          for (const sid of c.shapes) {
            const s = this.shapes.find(x => x.id === sid);
            if (!s || !s.joints) continue;
            if (s.joints.length >= 2) { jointList.push(s.joints[0], s.joints[1]); }
            else if (s.joints.length === 1) { jointList.push(s.joints[0]); }
          }
          // equal, parallel, perpendicular and angle read their joints POSITIONALLY as [a,b,c,d] (two lines); deduping a shared corner would leave 3 and turn the row into a no-op/NaN.
          // Only collinear wants a set of unique points.
          const uniq = c.type === 'collinear' ? [...new Set(jointList)] : jointList;
          params.joints = uniq.map(id => jointIndexMap.get(id)).filter(idx => typeof idx === 'number');
        }
      }

      // A radius distance whose shape gives neither a radius unknown nor a centre-rim pair (the shape is missing or has no
      // radius) has nothing to measure: an EXPLICIT zero row. Definitions.distance would index params.joints[0]/[1] of an empty
      // array -> positions[NaN] -> NaN, and that NaN poisons the gradient (Algebra.atx) of every column it shares.
      if (c.type === 'distance' && c.isRadius && params.radiusAt === undefined && (!params.joints || params.joints.length < 2)) {
        r[row] = 0;
        endRow();
        continue;
      }

      const e = def.computeError(params, densePositions);
      if (Array.isArray(e)) {
        // multi-row (coincident, midpoint, collinear: 2; symmetric: up to 4): one row buffer per row, added on first need
        if (withJ) {
          while (bufs.length < e.length) bufs.push(new Float64Array(denseLen));
          operandsOf(params); def.computeJacobian(params, densePositions, bufs);
        }
        for (let k = 0; k < e.length; ++k) {
          r[row] = e[k] * wStruct;
          if (withJ) emitRow(bufs[k]); else row++;
        }
        if (withJ) for (let k = e.length; k < bufs.length; ++k) for (let q = 0; q < nOps; ++q) bufs[k][ops[q]] = 0; // a buffer no row read
      } else {
        r[row] = e * wStruct;
        if (withJ) {
          operandsOf(params);
          def.computeJacobian(params, densePositions, bufs[0]);
          emitRow(bufs[0]);
        } else row++;
      }
    }
    for (let i = row; i < m; ++i) rowPtr[i + 1] = nnz;
    if (withJ) for (const buf of bufs) for (let i = 0; i < denseLen; ++i) {
      if (buf[i] !== 0) throw new Error(`solver: a constraint row wrote dense index ${i}, outside the operands _assemble gave it (engine.js operandsOf)`);
    }

    return new Assembly(withJ ? { rowPtr, cols: cols.subarray(0, nnz), vals: vals.subarray(0, nnz) } : null, r, m, n);
  }

  // ── Rank-redundancy of a candidate constraint row ───────────────────────────
  // Slice a row-major assembly {J,m,n} into an array of length-n row vectors.
  _rowsOf(asm) {
    const { S, m, n } = asm; const rows = [];
    for (let i = 0; i < m; ++i) { const v = new Float64Array(n); for (let p = S.rowPtr[i]; p < S.rowPtr[i + 1]; ++p) v[S.cols[p]] = S.vals[p]; rows.push(v); }
    return rows;
  }

  // True if ANY candidate row has a component OUTSIDE the span of the basis rows — i.e. adding it
  // RAISES the constraint rank. Modified Gram-Schmidt with a scale-robust relative tolerance.
  // Sparse (task 541), the same arithmetic as the dense sweep: a basis vector keeps its support (its non-zero columns, ascending) and a dot
  // or an update runs over that support only (the skipped terms are products with a zero); a basis vector whose support does not meet
  // the row's current support is skipped (its dot is exactly 0: no change), the candidates found per column (colTo).
  _rowsRaiseRank(basisRows, candRows, n) {
    const ABS = 1e-9, REL = 1e-6;
    const basis = [];                                  // { v, idx }: the unit vector and its support, ascending
    const colTo = Array.from({ length: n }, () => []); // column -> the basis vectors whose support holds it
    const inSup = new Uint8Array(n);
    const normOf = (v, sup) => { let s = 0; for (let p = 0; p < sup.length; ++p) s += v[sup[p]] * v[sup[p]]; return Math.sqrt(s); };
    // the row with every basis vector's component removed, in basis order; returns { v, sup (ascending), n0 }; skip: n0 below which it stops
    const reduce = (row, skip) => {
      const v = Float64Array.from(row);
      const sup = [];
      for (let i = 0; i < n; ++i) if (v[i] !== 0) { sup.push(i); inSup[i] = 1; }
      const n0 = normOf(v, sup);
      if (n0 >= skip) {
        const cand = new Uint8Array(basis.length);
        for (const i of sup) for (const b of colTo[i]) cand[b] = 1;
        for (let bi = 0; bi < basis.length; ++bi) {
          if (!cand[bi]) continue;
          const { v: bv, idx } = basis[bi];
          let d = 0; for (let p = 0; p < idx.length; ++p) d += v[idx[p]] * bv[idx[p]];
          for (let p = 0; p < idx.length; ++p) {
            const i = idx[p];
            v[i] -= d * bv[i];
            if (!inSup[i] && v[i] !== 0) { inSup[i] = 1; sup.push(i); for (const b of colTo[i]) if (b > bi) cand[b] = 1; }
          }
        }
        sup.sort((a, b) => a - b);
      }
      for (const i of sup) inSup[i] = 0;
      return { v, sup, n0 };
    };
    for (const row of basisRows) {
      const { v, sup, n0 } = reduce(row, -Infinity);
      const nrm = normOf(v, sup);
      // Relative like the candidate test below: a row that is dependent up to solve-tolerance noise must NOT count as a
      // new basis direction, or the basis spans all of R^n and every candidate looks redundant.
      if (nrm > ABS && nrm > REL * n0) {
        for (const i of sup) v[i] /= nrm;
        const id = basis.length;
        basis.push({ v, idx: Int32Array.from(sup) });
        for (const i of sup) colTo[i].push(id);
      }
    }
    for (const row of candRows) {
      const { v, sup, n0 } = reduce(row, ABS);
      if (n0 < ABS) continue; // a zero row carries no information
      if (normOf(v, sup) > REL * n0) return true; // an independent component remains
    }
    return false;
  }

  // True if `candidate`'s Jacobian row(s) at the present configuration are linearly DEPENDENT on the
  // current NON-DRIVEN constraint rows — adding it would NOT raise the constraint rank (it is already
  // determined / REDUNDANT). NOTE: this is per-row rank-increase, NOT the global rankDeficient flag
  // (which is true whenever ANY DOF is free, e.g. an undimensioned height).
  rankRowRedundant(candidate) {
    if (!candidate) return false;
    const allC = this.constraints;
    const x0 = this._pack();
    const n = x0.length;
    if (n === 0) return true; // fully pinned → any new dimension is redundant
    const basisCons = allC.filter(c => c && !c.isDriven && !c.driven && c.type !== 'mouse_spring');
    let redundant;
    try {
      this.constraints = basisCons;
      const basisRows = this._rowsOf(this._assemble(x0));
      // the candidate's own rows: a row depends on its constraint alone (no spring here, so wStruct = 1), so they are the rows it would
      // add at the end of the basis assembly, without assembling the basis twice
      this.constraints = [candidate];
      const candRows = this._rowsOf(this._assemble(x0));
      redundant = candRows.length > 0 && !this._rowsRaiseRank(basisRows, candRows, n);
    } finally {
      this.constraints = allC;
    }
    return redundant;
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
      const { S, r, m } = this._assemble(x);
      if (m === 0) return { x, converged: true, residual: 0 };

      cost = 0; for (let i = 0; i < m; ++i) cost += r[i] * r[i]; cost *= 0.5;
      residual = Math.sqrt(2 * cost);
      if (residual < this.config.tol) return { x, converged: true, residual };
      // Inside Newton's basin — let LM finish.
      if (residual < this.config.prepassHandoffResidual) return { x, converged: false, residual };

      // g = Jᵀ r
      const g = new Float64Array(n);
      Algebra.atx(S, m, n, r, g);
      let gNorm2 = 0; for (let j = 0; j < n; ++j) gNorm2 += g[j] * g[j];
      if (gNorm2 < 1e-24) return { x, converged: false, residual };

      // ‖Jg‖² (avoid materializing Jg)
      let JgNorm2 = 0;
      for (let i = 0; i < m; ++i) {
        let s = 0; for (let p = S.rowPtr[i]; p < S.rowPtr[i + 1]; ++p) s += S.vals[p] * g[S.cols[p]];
        JgNorm2 += s * s;
      }
      if (JgNorm2 < 1e-30) return { x, converged: false, residual };

      let alpha = gNorm2 / JgNorm2;
      let accepted = false;
      // Armijo backtracking: try the Cauchy step, halve up to 6 times.
      for (let bt = 0; bt < 6; ++bt) {
        for (let j = 0; j < n; ++j) xNew[j] = x[j] - alpha * g[j];
        const { r: rNew } = this._assemble(xNew, { jacobian: false });
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
    let dragOpt = options && options.dragTarget ? options.dragTarget : null;
    if (!dragOpt) {
      // a BODY drag (task 538): the one shape carrying a dragTarget { param, x, y } set by the select tool's pointer handler
      for (const s of this.shapes) {
        if (s && s.dragTarget) {
          dragOpt = { body: { shape: s.id, param: s.dragTarget.param, hold: s.dragTarget.hold }, x: s.dragTarget.x, y: s.dragTarget.y, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 };
          break;
        }
      }
    }
    const x0 = this._pack();
    // a JOINT drag: the springs of every joint carrying a dragTarget (set by the UI input handlers; a body drag never sets one, task 538)
    if (!dragOpt || !dragOpt.body) dragOpt = this._jointDragSprings(dragOpt);
    if (x0.length === 0) {
      // No free variables — every joint is pinned (all fixed, or merged into a
      // fixed coincident cluster). The sketch can't move, but its constraints
      // may still be VIOLATED (e.g. a distance on a joint welded to the origin).
      // Check the residual instead of unconditionally claiming success.
      const { r } = this._assemble(x0, { jacobian: false });
      let s = 0; for (let i = 0; i < r.length; ++i) s += r[i] * r[i];
      const residual0 = Math.sqrt(s);
      let cleanup0 = null;
      if (dragOpt) cleanup0 = this.interaction.attachMouseSpring(dragOpt);
      const hasSpring0 = this._hasMouseSpring();
      const { structuralError, dragReached } = this._splitResiduals(x0, residual0, hasSpring0);
      if (cleanup0) cleanup0();
      const out0 = { converged: residual0 < this.config.tol, error: residual0, rankDeficient: false, stalled: false, structuralError };
      if (hasSpring0) out0.dragReached = dragReached;
      return out0;
    }

    let x = new Float64Array(x0); // current estimate
    let lambda = this.config.lambdaInit;
    let lastCost = Infinity;
    let converged = false;
    let finalError = 0;
    let exitedByStep = false;
    // Tracks whether JᵀJ is singular at the final state (rank(J) < n).
    // In CAD terms: the sketch is under-constrained — there are free directions
    // along which the residual doesn't change. The solver may still report
    // converged=true if it found a valid configuration; the flag tells the
    // UI that the configuration is non-unique.
    let rankDeficient = false;

    // If a drag target exists (explicit via options OR implicit j.dragTarget on a joint), inject a temporary 'mouse-spring'
    let cleanup = null;
    if (dragOpt) cleanup = this.interaction.attachMouseSpring(dragOpt);
    const hasSpring = this._hasMouseSpring();

    // Relaxation pre-pass: only worthwhile when starting far from the solution.
    // Cheap cost-of-entry: one assemble to measure initial residual.
    if (this.config.prepassEnabled) {
      const { r: rInit } = this._assemble(x, { jacobian: false });
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
          const { structuralError, dragReached } = this._splitResiduals(x, pre.residual, hasSpring);
          if (cleanup) cleanup();
          const outPre = { converged: true, error: pre.residual, rankDeficient, stalled: false, structuralError };
          if (hasSpring) outPre.dragReached = dragReached;
          return outPre;
        }
      }
    }

    for (let k = 0; k < iter; ++k) {
      const { S, r, m, n } = this._assemble(x);
      // cost = 0.5 * r^T r
      let cost = 0.0; for (let i = 0; i < m; ++i) cost += r[i] * r[i]; cost *= 0.5;

      // check convergence on residual (treat `tol` as world-space residual target)
      const residual = Math.sqrt(2 * cost);
      if (residual < this.config.tol) { converged = true; finalError = residual; break; }

      // Build normal equations: A = J^T J  (n x n, envelope), g = J^T r (n)
      const A = Algebra.gram(S, m, n);
      const g = new Float64Array(n); Algebra.atx(S, m, n, r, g);
      // Levenberg-Marquardt: (A + lambda * diag(A)) dx = -g
      // LM damping — add λ on the diagonal (J^T J + λ I)
      Algebra.addToDiag(A, lambda + 1e-12);
      for (let i = 0; i < n; ++i) g[i] = -g[i]; // move to RHS

      const dx = new Float64Array(g); // copy RHS
      const ok = Algebra.choleskySolveEnvelope(A, dx); // destructive: A is not used again
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
      const { r: rNew } = this._assemble(xCand, { jacobian: false });
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
      if (maxStep < this.config.tol) { converged = true; finalError = Math.sqrt(2 * costNew); x = xCand; exitedByStep = true; break; }

      // keep last cost
      finalError = Math.sqrt(2 * costNew);
    }

    // Optional polishing Gauss-Newton pass (zero-damping) to improve final
    // accuracy. The undamped Cholesky here doubles as a rank-deficiency probe:
    // success ⟺ JᵀJ is positive-definite ⟺ rank(J) = n ⟺ well-constrained.
    try {
      const { S, r, m, n } = this._assemble(x);
      const A = Algebra.gram(S, m, n);
      const g = new Float64Array(n); Algebra.atx(S, m, n, r, g);
      for (let i = 0; i < n; ++i) g[i] = -g[i];
      const dx = new Float64Array(g);
      const ok = Algebra.choleskySolveEnvelope(A, dx);
      rankDeficient = !ok;
      if (ok) {
        // apply small polish step and accept only if it reduces residual
        const xPolish = new Float64Array(n);
        for (let i = 0; i < n; ++i) xPolish[i] = x[i] + dx[i];
        const rPolish = this._assemble(xPolish, { jacobian: false }).r;
        let costPolish = 0.0; for (let i = 0; i < rPolish.length; ++i) costPolish += rPolish[i] * rPolish[i]; costPolish *= 0.5;
        if (costPolish < 0.5 * finalError * finalError) {
          x = xPolish; finalError = Math.sqrt(2 * costPolish);
        }
      }
    } catch (_) { /* fail-open: polishing is optional */ }

    // write back
    this._unpack(x);
    const stalled = exitedByStep && finalError > this.config.tol;
    const { structuralError, dragReached } = this._splitResiduals(x, finalError, hasSpring);
    if (cleanup) cleanup();

    const out = { converged, error: finalError, rankDeficient, stalled, structuralError };
    if (stalled) out.stallError = finalError;
    if (hasSpring) out.dragReached = dragReached;
    return out;
  }

  // THE springs of a JOINT drag (TASK 584): the explicit one (the select tool's grabbed joint, solve's options.dragTarget) and one for every
  // other joint carrying a dragTarget, the members the drag CARRIES (selection-tools pullDrag: the grabbed point's coincident cluster, and
  // an arc grabbed by its centre carries both rims, so it translates whole like Fusion). One spring per solver variable: coincident joints
  // are one point (_pack), a second spring on it would only weigh the pull double. Before, only the FIRST joint carrying a target (joint
  // insertion order) was pulled, so an arc dragged by its centre stretched: the rims followed the radius constraints, not the drag.
  // Returns the list of springs, or null when there is none. Call after _pack (it reads _varIndex).
  _jointDragSprings(explicit) {
    const springs = explicit ? [explicit] : [];
    const seen = new Set();
    const pointOf = (id) => (this._varIndex.has(id) ? 'v' + this._varIndex.get(id) : 'j' + id); // a joint with no variable (anchored) is its own
    if (explicit) seen.add(pointOf(explicit.jointId));
    for (const [id, j] of this.joints.entries()) {
      if (!j || !j.dragTarget || j.fixed) continue;
      const p = pointOf(id);
      if (seen.has(p)) continue;
      seen.add(p);
      springs.push({ jointId: id, x: j.dragTarget.x, y: j.dragTarget.y, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 });
    }
    return springs.length ? springs : null;
  }

  _hasMouseSpring() {
    for (const c of this.constraints) {
      if (c && !(c.isDriven || c.driven) && c.type === 'mouse_spring') return true;
    }
    return false;
  }

  // Separate non-spring structural residual norm from mouse_spring residual norm.
  // When no spring is present, structuralError equals finalError exactly.
  _splitResiduals(x, finalError, hasSpring) {
    if (!hasSpring) return { structuralError: finalError, dragReached: undefined };
    let springSum2 = 0;
    for (const c of this.constraints) {
      if (!c || c.isDriven || c.driven || c.type !== 'mouse_spring') continue;
      if (c.body) {
        // the BODY form: the grabbed point read from the solved positions (the joint map is the dense order of _positionsFromVector)
        const jointIndexMap = new Map(); let k = 0; for (const [id] of this.joints.entries()) jointIndexMap.set(id, k++);
        const b = this._bodyOperand(c.body, jointIndexMap, c.value), p = b.kind.point(b.op, this._positionsFromVector(x));
        const w = Math.sqrt(c.stiffness || 1e3);
        springSum2 += (w * (p[0] - c.value[0])) ** 2 + (w * (p[1] - c.value[1])) ** 2;
        continue;
      }
      const jointId = c.joints && c.joints.length > 0 ? c.joints[0] : null;
      const j = jointId != null ? this.joints.get(jointId) : null;
      if (!j || !c.value) continue;
      const w = Math.sqrt(c.stiffness || 1e3);
      const rx = w * (j.x - c.value[0]);
      const ry = w * (j.y - c.value[1]);
      springSum2 += rx * rx + ry * ry;
    }
    const dragReached = Math.sqrt(springSum2) < 1e-3;
    const allC = this.constraints;
    let structuralError = 0;
    try {
      this.constraints = allC.filter(c => !c || c.type !== 'mouse_spring');
      const { r } = this._assemble(x, { jacobian: false });
      let s = 0; for (let i = 0; i < r.length; ++i) s += r[i] * r[i];
      structuralError = Math.sqrt(s);
    } finally {
      this.constraints = allC;
    }
    return { structuralError, dragReached };
  }

  // THE nullspace of the global (non-driven, spring-free) constraint Jacobian at the present configuration, built from the same
  // _assemble() rows the solver uses: N (n x k, row-major, column q = one free direction), k = nullity, x0 = the packed unknowns.
  // Shared by jointFreedom (every joint, every circle radius) and bodyPointFreedom (the grabbed point of a body drag, task 538).
  // hold: joint ids treated as held (two identity rows each, a body drag's temporary hold); none for jointFreedom.
  _nullspace(hold = []) {
    const allC = this.constraints;
    const x0 = this._pack();
    const n = x0.length;
    let N = null, k = 0;
    if (n > 0) {
      let rows;
      try {
        this.constraints = allC.filter(c => c && !c.isDriven && !c.driven && c.type !== 'mouse_spring');
        const asm = this._assemble(x0);
        rows = this._rowsOf(asm);
      } finally {
        this.constraints = allC;
      }
      for (const id of hold) {
        const vi = this._varIndex.get(id);
        if (vi === undefined) continue;   // a fixed joint is no unknown: already held
        for (let a = 0; a < 2; ++a) { const v = new Float64Array(n); v[vi * 2 + a] = 1; rows.push(v); }
      }
      // Row-normalise (rows mix world-unit and unit-less derivatives), then reduced row echelon form.
      const R = [];
      for (const v of rows) {
        let s = 0; for (let i = 0; i < n; ++i) s += v[i] * v[i];
        s = Math.sqrt(s);
        if (s < 1e-9) continue;
        for (let i = 0; i < n; ++i) v[i] /= s;
        R.push(v);
      }
      const TOL = 1e-7;
      const pivotCol = [];
      const isPivot = new Uint8Array(n);
      let r = 0;
      for (let c = 0; c < n && r < R.length; ++c) {
        let best = r, bv = Math.abs(R[r][c]);
        for (let i = r + 1; i < R.length; ++i) { const a = Math.abs(R[i][c]); if (a > bv) { bv = a; best = i; } }
        if (bv < TOL) continue;
        const tmp = R[r]; R[r] = R[best]; R[best] = tmp;
        const pr = R[r], pv = pr[c];
        for (let j = c; j < n; ++j) pr[j] /= pv;
        for (let i = 0; i < R.length; ++i) {
          if (i === r) continue;
          const row = R[i], f = row[c];
          if (f === 0) continue;
          for (let j = c; j < n; ++j) row[j] -= f * pr[j];
          row[c] = 0;
        }
        pivotCol.push(c); isPivot[c] = 1; ++r;
      }
      const freeCols = [];
      for (let c = 0; c < n; ++c) if (!isPivot[c]) freeCols.push(c);
      k = freeCols.length;
      // N (n x k): free column f -> e_f on f, -R[row][f] on each pivot column.
      N = new Float64Array(n * k);
      for (let q = 0; q < k; ++q) {
        const f = freeCols[q];
        N[f * k + q] = 1;
        for (let i = 0; i < pivotCol.length; ++i) N[pivotCol[i] * k + q] = -R[i][f];
      }
    }
    return { N, k, n, x0 };
  }

  // THE body drag target for a cursor position (task 538), the body-point form of the joint DOF mask, one rule for every kind
  // (definitions.js BODY_POINTS): the kind's preferred holds kept
  // when the body point can still move with them held, else released (least change); then the cursor displacement from the body point
  // is limited to the point's reachable directions: rank 0 -> the target stays on the point (nothing moves), rank 1 -> projected on
  // that direction, rank 2 -> the cursor. Returns { body: { shape, param, hold: [{ joint, x, y }] }, x, y } for solve({ dragTarget }).
  bodyDragTarget(body, cursor) {
    const shape = this.shapes.find(s => s && s.id === body.shape);
    const kind = BODY_POINTS[shape.type];
    const param = body.param, b = { shape: body.shape, param }, at = [cursor.x, cursor.y];
    let hold = kind.prefersHold.map(i => shape.joints[i]);
    let f = hold.length ? this.bodyPointFreedom(b, hold, at) : null;
    if (!f || f.rank === 0) { hold = []; f = this.bodyPointFreedom(b, hold, at); }
    const p = f.point;
    let x = cursor.x, y = cursor.y;
    if (f.rank === 0) { x = p[0]; y = p[1]; }
    else if (f.rank === 1) { const s = (cursor.x - p[0]) * f.dir[0] + (cursor.y - p[1]) * f.dir[1]; x = p[0] + s * f.dir[0]; y = p[1] + s * f.dir[1]; }
    return { body: { shape: body.shape, param, hold: hold.map(id => { const j = this.joints.get(id); return { joint: id, x: j.x, y: j.y }; }) }, x, y };
  }

  // GROUND-TRUTH per-joint freedom: the nullspace of the global (non-driven) constraint Jacobian at the
  // present configuration (_nullspace). A joint is a point whose gradient is the identity on its two columns (reachableDirections):
  // immovable (0) only if no nullspace vector has a component on its x or y; one free direction -> 1; else 2. A circle's radius column likewise:
  // its id is in radiusFree when a nullspace vector moves the radius.
  // Returns { freedom: Map(jointId -> 0|1|2), freeX: Set, freeY: Set, radiusFree: Set(circle id), nullity } (nullity = global DOF).
  jointFreedom() {
    const { N, k } = this._nullspace();
    const freedom = new Map(), freeX = new Set(), freeY = new Set(), radiusFree = new Set();
    const nullity = k;
    for (const [id] of this.joints.entries()) {
      const vi = this._varIndex.get(id);
      if (vi === undefined || k === 0) { freedom.set(id, 0); continue; }
      const f = reachableDirections(N, k, [{ col: vi * 2, gx: 1, gy: 0 }, { col: vi * 2 + 1, gx: 0, gy: 1 }]);
      if (f.fx) freeX.add(id);
      if (f.fy) freeY.add(id);
      freedom.set(id, f.rank);
    }
    for (let q = 0; q < this._radiusShapes.length && k > 0; ++q) {
      const base = (this._nJointVars + q) * k;
      let rr = 0; for (let t = 0; t < k; ++t) rr += N[base + t] * N[base + t];
      if (rr > 1e-10) radiusFree.add(this._radiusShapes[q].id);
    }
    return { freedom, freeX, freeY, radiusFree, nullity };
  }

  // The freedom of the BODY point of a body drag (task 538), the body-point form of the joint DOF mask: the body point's gradient
  // (its spring rows at unit weight, definitions.js BODY_POINTS) through the same nullspace and reachableDirections as a joint.
  // hold: joint ids held for the drag (bodyDragTarget). Returns { rank: 0|1|2, dir: [x, y] (rank 1), point: [x, y] (the body point now) }.
  // target: the spring's target (the cursor), which a rim point's direction reads.
  bodyPointFreedom(body, hold, target) {
    const { N, k, n, x0 } = this._nullspace(hold);
    const jointIndexMap = new Map(); let ji = 0; for (const [id] of this.joints.entries()) jointIndexMap.set(id, ji++);
    const b = this._bodyOperand(body, jointIndexMap, target);
    const point = b.kind.point(b.op, this._positionsFromVector(x0));
    if (k === 0) return { rank: 0, dir: null, point };
    const allC = this.constraints;
    let G;
    try {
      this.constraints = [{ type: 'mouse_spring', body: { shape: body.shape, param: body.param }, value: target, stiffness: 1, joints: [] }];
      G = this._rowsOf(this._assemble(x0));
    } finally {
      this.constraints = allC;
    }
    const grad = [];
    for (let i = 0; i < n; ++i) if (G[0][i] !== 0 || G[1][i] !== 0) grad.push({ col: i, gx: G[0][i], gy: G[1][i] });
    const f = reachableDirections(N, k, grad);
    return { rank: f.rank, dir: f.dir, point };
  }

  // One-shot rank-deficiency probe at position x. Re-assembles, builds JᵀJ
  // (no LM damping), tries Cholesky. Failure ⟺ rank(J) < n.
  // Used by the early-return path when the pre-pass converges before LM runs.
  _checkRankDeficient(x) {
    try {
      const { S, m, n } = this._assemble(x);
      if (m === 0 || n === 0) return false;
      const A = Algebra.gram(S, m, n);
      const probe = new Float64Array(n);
      return !Algebra.choleskySolveEnvelope(A, probe);
    } catch (_) { return false; }
  }
}

// Export a convenience default solver factory to preserve call-site compatibility
export function createNewtonSolver(joints, constraints, shapes, config) {
  return new NewtonSolver(joints, constraints, shapes, config);
}

