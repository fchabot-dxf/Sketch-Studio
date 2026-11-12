import { angleSectorOf } from '../angle-sector.js';

// Constraint definitions: computeError(params, positions) and computeJacobian(params, positions)
// positions: Float64Array [x0,y0, x1,y1, ...] for joints referenced by indices in 'params.joints', followed by the circle radius
// unknowns (engine.js hasRadiusUnknown).
//
// THE radius operand of a row (one formulation for point-on-circle and every tangent form): a CIRCLE's radius is its unknown,
// positions[at] (params.radiusAt, or radiiAt[i]); an ARC's radius is LIVE, |rim - centre| measured from its joints (params.rimJoint,
// or rimJoints[i], with the row's centre joint), so the rim and centre columns carry its derivative; otherwise the constant
// params.radius (or radii[i]).

function idx(positions, jointIndex) { return jointIndex * 2; }
// THE one way a row writes a joint's derivative (task 533): ACCUMULATE (gx, gy) into that joint's two columns, never assign. A row
// can name the same joint more than once (two lines sharing a corner, the same line twice, a point that is an end of its own line,
// a line ending on a circle's centre): each occurrence adds its own partial. Assigning let the last write overwrite the others
// (F6: parallel of two lines sharing a corner, |J - fd| = 29; turn 404 for equal). The caller hands every row zeroed
// (engine._assemble allocates a fresh zero-filled row per constraint).
const addGrad = (outRow, j, gx, gy) => { outRow[j*2 + 0] += gx; outRow[j*2 + 1] += gy; };
// The radius a row uses: the circle's unknown, the arc's |rim - centre|, else the constant.
const radiusValue = (positions, at, constant, rim, centre) => {
  if (typeof at === 'number') return positions[at];
  if (typeof rim === 'number' && typeof centre === 'number') {
    return Math.hypot(positions[rim*2] - positions[centre*2], positions[rim*2+1] - positions[centre*2+1]);
  }
  return Number(constant) || 0;
};
// ACCUMULATE coef * d(radius)/d(variable) into outRow for the same operand (a constant radius has no columns).
const addRadiusDerivative = (outRow, positions, coef, at, rim, centre) => {
  if (typeof at === 'number') { outRow[at] += coef; return; }
  if (typeof rim === 'number' && typeof centre === 'number') {
    const rx = positions[rim*2] - positions[centre*2], ry = positions[rim*2+1] - positions[centre*2+1];
    const rd = Math.hypot(rx, ry) || 1e-12;
    addGrad(outRow, rim, coef * rx / rd, coef * ry / rd);
    addGrad(outRow, centre, -coef * rx / rd, -coef * ry / rd);
  }
};

// THE angle row (task 553): the measured SECTOR (#core/angle-sector.js: rays of line 1 and line 2 + the way it turns) holds the CCW angle
// alpha from u (line 1's direction) to v (line 2's) at  turn * value + (ray1 != ray2 ? 180 : 0)  modulo 360. With k = ray1 * ray2 = +-1:
//   S = |u||v| sin(theta - alpha) = k (cross cos t - turn dot sin t),   C = |u||v| cos(theta - alpha) = k (dot cos t + turn cross sin t)
// (t = value in radians; written with cos t / sin t of the VALUE so a sector-less or task-543 row is the same floating-point row as before,
// up to its sign). Where C >= 0 (within 90 degrees of the target) the residual is S: exactly the row of every build before this one, so a
// solve near the answer is unchanged. Where C < 0 that row would pull to the OPPOSITE ray (theta = alpha + 180, the modulo-180 twin); the
// residual continues monotonically instead,  r = 2 sgn(S) |u||v| - S  (|r| grows from |u||v| at 90 degrees to 2|u||v| at 180), so the only
// zero is theta == alpha: a 190 degree dimension is not satisfied by the 10 or 170 degree pose. Continuous (C1) at C = 0; it jumps only at
// the exactly opposite pose, which is no solution either way.
const angleRow = (params, ux, uy, vx, vy) => {
  const { ray1, ray2, turn } = angleSectorOf(params);
  const k = ray1 * ray2;
  const t = ((Number(params.value) || 0) * Math.PI) / 180;
  const ct = Math.cos(t), st = turn * Math.sin(t);
  const cross = ux * vy - uy * vx, dot = ux * vx + uy * vy;
  const S = k * (cross * ct - dot * st), C = k * (dot * ct + cross * st);
  return { k, ct, st, S, C, far: C < 0, sgn: S < 0 ? -1 : 1, lu: Math.hypot(ux, uy), lv: Math.hypot(vx, vy) };
};

export const Definitions = {
  // Distance constraint:
  //   joint-pair  (joints=[a,b], value):                  |a−b| − value
  //   radius      (joints=[center,rim], value):           |rim−center| − value     (synthesized from {shape, isRadius})
  //   line-line   (joints=[P,A,B], value, __lineLine):    |perp dist from P to line AB| − value
  //
  // The line-line case is engine-synthesized from {shapes:[s1,s2]} — P is one
  // endpoint of line 2, AB is line 1. Two parallel lines have constant
  // perpendicular distance, so a single point measure is sufficient when the
  // lines are also constrained parallel (which they typically are by shape
  // construction in CAD UIs); without that, this constraint pulls one endpoint
  // of line 2 toward the target distance from line 1.
  distance: {
    rows: 1,
    computeError: (params, positions) => {
      if (typeof params.radiusAt === 'number') return positions[params.radiusAt] - (params.value || 0);   // a circle's radius
      if (params.__lineLine) {
        const pi = params.joints[0], ai = params.joints[1], bi = params.joints[2];
        const px = positions[pi*2], py = positions[pi*2+1];
        const ax = positions[ai*2], ay = positions[ai*2+1];
        const bx = positions[bi*2], by = positions[bi*2+1];
        const ux = bx - ax, uy = by - ay;
        const wx = px - ax, wy = py - ay;
        const cross = wx * uy - wy * ux;
        const lu = Math.hypot(ux, uy) || 1e-12;
        // Signed perp distance; subtract sign(initial)·value via abs.
        const signed = cross / lu;
        return Math.abs(signed) - (params.value || 0);
      }
      const ia = params.joints[0], ib = params.joints[1];
      const ax = positions[ia*2], ay = positions[ia*2+1];
      const bx = positions[ib*2], by = positions[ib*2+1];
      // HORIZONTAL / VERTICAL dimension (params.dimMode): drives the PROJECTION, signed so a drag cannot flip it.
      // s = params.dimSign (locked by the engine at first solve; +1 = b is right of / above-in-y of a).
      if (params.dimMode === 'horizontal') return (params.dimSign || 1) * (bx - ax) - (params.value || 0);
      if (params.dimMode === 'vertical') return (params.dimSign || 1) * (by - ay) - (params.value || 0);
      const dx = ax - bx, dy = ay - by;
      return Math.hypot(dx, dy) - (params.value || 0);
    },
    computeJacobian: (params, positions, outRow) => {
      if (typeof params.radiusAt === 'number') { outRow[params.radiusAt] += 1; return; }
      if (params.__lineLine) {
        const pi = params.joints[0], ai = params.joints[1], bi = params.joints[2];
        const px = positions[pi*2], py = positions[pi*2+1];
        const ax = positions[ai*2], ay = positions[ai*2+1];
        const bx = positions[bi*2], by = positions[bi*2+1];
        const ux = bx - ax, uy = by - ay;
        const wx = px - ax, wy = py - ay;
        const cross = wx * uy - wy * ux;
        const lu = Math.hypot(ux, uy) || 1e-12;
        const signed = cross / lu;
        const sgn = signed >= 0 ? 1 : -1;
        // d|signed|/dvar = sgn · d(signed)/dvar
        // d(cross/|u|)/dvar — same chain as in tangent's circle-line case.
        const lu3 = lu * lu * lu;
        addGrad(outRow, pi, sgn * (uy / lu), sgn * (-ux / lu));
        addGrad(outRow, ai, sgn * ((wy - uy) / lu + cross * (ux / lu3)), sgn * ((ux - wx) / lu + cross * (uy / lu3)));
        addGrad(outRow, bi, sgn * ((-wy) / lu + cross * (-ux / lu3)), sgn * ((wx) / lu + cross * (-uy / lu3)));
        return;
      }
      const ia = params.joints[0], ib = params.joints[1];
      const ax = positions[ia*2], ay = positions[ia*2+1];
      const bx = positions[ib*2], by = positions[ib*2+1];
      if (params.dimMode === 'horizontal') { const sg = params.dimSign || 1; addGrad(outRow, ia, -sg, 0); addGrad(outRow, ib, sg, 0); return; }
      if (params.dimMode === 'vertical') { const sg = params.dimSign || 1; addGrad(outRow, ia, 0, -sg); addGrad(outRow, ib, 0, sg); return; }
      const dx = ax - bx, dy = ay - by;
      const r = Math.hypot(dx, dy) || 1e-12;
      addGrad(outRow, ia, dx / r, dy / r);
      addGrad(outRow, ib, -dx / r, -dy / r);
    }
  },

  // Point-on-line: project point P onto line AB and require perpendicular distance = 0
  // Error = ((P - A) x (B - A)) / |B-A|  (scalar perpendicular distance)
  point_on_line: {
    rows: 1,
    computeError: (params, positions) => {
      // Point-on-circle/arc target: residual = dist(point, center) - radius.
      if (params.onCircle) {
        const dx = positions[params.joints[0]*2] - positions[params.joints[1]*2];
        const dy = positions[params.joints[0]*2+1] - positions[params.joints[1]*2+1];
        return Math.hypot(dx, dy) - radiusValue(positions, params.radiusAt, params.radius, params.rimJoint, params.joints[1]);
      }
      const pi = params.joints[0], ai = params.joints[1], bi = params.joints[2];
      const px = positions[pi*2], py = positions[pi*2+1];
      const ax = positions[ai*2], ay = positions[ai*2+1];
      const bx = positions[bi*2], by = positions[bi*2+1];
      const ux = bx - ax, uy = by - ay;
      const wx = px - ax, wy = py - ay;
      const cross = wx * uy - wy * ux; // signed area
      const denom = Math.hypot(ux, uy) || 1e-12;
      return cross / denom;
    },
    computeJacobian: (params, positions, outRow) => {
      // Point-on-circle/arc: r = |P - C| - R, the full derivative (the centre takes part, so a circle can move to meet its point).
      if (params.onCircle) {
        const pi = params.joints[0], ci = params.joints[1];
        const dx = positions[pi*2] - positions[ci*2];
        const dy = positions[pi*2+1] - positions[ci*2+1];
        const d = Math.hypot(dx, dy) || 1e-12;
        addGrad(outRow, pi, dx / d, dy / d);
        addGrad(outRow, ci, -dx / d, -dy / d);
        addRadiusDerivative(outRow, positions, -1, params.radiusAt, params.rimJoint, ci);
        return;
      }
      const pi = params.joints[0], ai = params.joints[1], bi = params.joints[2];
      const px = positions[pi*2], py = positions[pi*2+1];
      const ax = positions[ai*2], ay = positions[ai*2+1];
      const bx = positions[bi*2], by = positions[bi*2+1];
      const ux = bx - ax, uy = by - ay;
      const wx = px - ax, wy = py - ay;
      const denom = Math.hypot(ux, uy) || 1e-12;

      // FULL derivative of r = (w x u)/|u|: the point AND both line endpoints take part, so a point on a line that can still move
      // can move the line (like Fusion), and the DOF analysis reads the same rows the solver steps with.
      const r = (wx * uy - wy * ux) / denom;
      const dd = (dux, duy) => (dux * ux + duy * uy) / denom; // d|u|/d(var)
      addGrad(outRow, pi, uy / denom, -ux / denom);
      addGrad(outRow, ai, ((-uy + wy) - r * dd(-1, 0)) / denom, ((-wx + ux) - r * dd(0, -1)) / denom);
      addGrad(outRow, bi, ((-wy) - r * dd(1, 0)) / denom, ((wx) - r * dd(0, 1)) / denom);
    }
  },

  // Coincident: enforce P1 - P2 = (0,0) (two scalar constraints)
  coincident: {
    rows: 2,
    computeError: (params, positions) => {
      const a = params.joints[0], b = params.joints[1];
      const ax = positions[a*2], ay = positions[a*2+1];
      const bx = positions[b*2], by = positions[b*2+1];
      return [ax - bx, ay - by];
    },
    computeJacobian: (params, positions, outRows) => {
      const a = params.joints[0], b = params.joints[1];
      // first row: x difference
      addGrad(outRows[0], a, 1, 0); addGrad(outRows[0], b, -1, 0);
      // second row: y difference
      addGrad(outRows[1], a, 0, 1); addGrad(outRows[1], b, 0, -1);
    }
  },

  // Horizontal: enforce same Y coordinate for the two joints
  horizontal: {
    rows: 1,
    computeError: (params, positions) => {
      const a = params.joints[0], b = params.joints[1];
      const ay = positions[a*2 + 1], by = positions[b*2 + 1];
      return ay - by;
    },
    computeJacobian: (params, positions, outRow) => {
      const a = params.joints[0], b = params.joints[1];
      addGrad(outRow, a, 0, 1); addGrad(outRow, b, 0, -1);
    }
  },

  // Vertical: enforce same X coordinate for the two joints
  vertical: {
    rows: 1,
    computeError: (params, positions) => {
      const a = params.joints[0], b = params.joints[1];
      const ax = positions[a*2 + 0], bx = positions[b*2 + 0];
      return ax - bx;
    },
    computeJacobian: (params, positions, outRow) => {
      const a = params.joints[0], b = params.joints[1];
      addGrad(outRow, a, 1, 0); addGrad(outRow, b, -1, 0);
    }
  },
  // Midpoint: ensure joint[2] is midpoint of joint[0]-joint[1]
  midpoint: {
    rows: 2,
    computeError: (params, positions) => {
      const a = params.joints[0], b = params.joints[1], m = params.joints[2];
      const ax = positions[a*2], ay = positions[a*2+1];
      const bx = positions[b*2], by = positions[b*2+1];
      const mx = positions[m*2], my = positions[m*2+1];
      return [ (ax + bx) * 0.5 - mx, (ay + by) * 0.5 - my ];
    },
    computeJacobian: (params, positions, outRows) => {
      // Full BIDIRECTIONAL Jacobian for residual [(ax+bx)/2 - mx, (ay+by)/2 - my]. Constraining the
      // midpoint (e.g. coincident -> origin to center a shape) now translates the endpoints too, not just
      // slaves m to a,b. Least-change keeps placing-a-marker behaviour: m free + endpoints held -> only m
      // moves; a pinned m -> the endpoints follow.
      const a = params.joints[0], b = params.joints[1], m = params.joints[2];
      addGrad(outRows[0], a, 0.5, 0); addGrad(outRows[0], b, 0.5, 0); addGrad(outRows[0], m, -1, 0);
      addGrad(outRows[1], a, 0, 0.5); addGrad(outRows[1], b, 0, 0.5); addGrad(outRows[1], m, 0, -1);
    }
  },

  // Collinear: ensure subsequent joints lie on line defined by first two joints
  // For joints [A,B,C,...] we produce (N-2) scalar perpendicular-distance rows: cross((B-A),(Ci-A)) / |B-A|
  collinear: {
    // NOTE: row-count varies per-constraint (handled by engine._assemble via special-case)
    computeError: (params, positions) => {
      const ji = params.joints || [];
      if (!ji || ji.length < 3) return 0.0;
      const ax = positions[ji[0]*2], ay = positions[ji[0]*2+1];
      const bx = positions[ji[1]*2], by = positions[ji[1]*2+1];
      const ux = bx - ax, uy = by - ay;
      const denom = Math.hypot(ux, uy) || 1e-12;
      const out = [];
      for (let k = 2; k < ji.length; ++k) {
        const cx = positions[ji[k]*2], cy = positions[ji[k]*2+1];
        const wx = cx - ax, wy = cy - ay;
        const cross = ux * wy - uy * wx;
        out.push(cross / denom);
      }
      return out;
    },
    computeJacobian: (params, positions, outRows) => {
      const ji = params.joints || [];
      if (!ji || ji.length < 3) return;
      const ax = positions[ji[0]*2], ay = positions[ji[0]*2+1];
      const bx = positions[ji[1]*2], by = positions[ji[1]*2+1];
      const ux = bx - ax, uy = by - ay;
      const denom = Math.hypot(ux, uy) || 1e-12;
      for (let r = 0; r < ji.length - 2; ++r) {
        const ci = ji[2 + r];
        // ∂error/∂Cx = -uy/denom ; ∂error/∂Cy = ux/denom
        addGrad(outRows[r], ci, -uy / denom, ux / denom);
        {
          // the full derivative of r = (u x w)/|u| too: the baseline's own freedom is not hidden and the baseline can move
          const cx = positions[ci*2], cy = positions[ci*2+1];
          const wx = cx - ax, wy = cy - ay;
          const rr = (ux * wy - uy * wx) / denom;
          const dd = (dux, duy) => (dux * ux + duy * uy) / denom; // d|u|/d(var)
          addGrad(outRows[r], ji[0], ((-wy + uy) - rr * dd(-1, 0)) / denom, ((-ux + wx) - rr * dd(0, -1)) / denom);
          addGrad(outRows[r], ji[1], ((wy) - rr * dd(1, 0)) / denom, ((-wx) - rr * dd(0, 1)) / denom);
        }
      }
    }
  },
  // Parallel: cross(u, v) = 0 where u = B−A, v = D−C.
  //
  // We use the un-normalized cross product (not cross/|u||v|) — the residual
  // scales with |u|·|v| but the Jacobian is exact and clean. The earlier
  // normalized form had a sign bug in ∂/∂cy and an approximate Jacobian that
  // ignored the denominator's derivative, causing the solver to step in the
  // wrong direction and "converge" at the initial state.
  parallel: {
    rows: 1,
    computeError: (params, positions) => {
      const ax = positions[params.joints[0]*2], ay = positions[params.joints[0]*2+1];
      const bx = positions[params.joints[1]*2], by = positions[params.joints[1]*2+1];
      const cx = positions[params.joints[2]*2], cy = positions[params.joints[2]*2+1];
      const dx = positions[params.joints[3]*2], dy = positions[params.joints[3]*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      return ux * vy - uy * vx;
    },
    computeJacobian: (params, positions, outRow) => {
      const aI = params.joints[0], bI = params.joints[1], cI = params.joints[2], dI = params.joints[3];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const dx = positions[dI*2], dy = positions[dI*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      // r = ux*vy − uy*vx, with u = b−a, v = d−c. Chain rule:
      //   ∂r/∂ax = −vy   ∂r/∂ay = vx     (∂u/∂a = −I)
      //   ∂r/∂bx =  vy   ∂r/∂by = −vx    (∂u/∂b = +I)
      //   ∂r/∂cx =  uy   ∂r/∂cy = −ux    (∂v/∂c = −I)
      //   ∂r/∂dx = −uy   ∂r/∂dy =  ux    (∂v/∂d = +I)
      // ACCUMULATE: the two lines may share a joint (b === c at a corner), each part adds its own partial (addGrad).
      addGrad(outRow, aI, -vy,  vx);
      addGrad(outRow, bI,  vy, -vx);
      addGrad(outRow, cI,  uy, -ux);
      addGrad(outRow, dI, -uy,  ux);
    }
  },

  // Perpendicular: (B-A) dot (D-C) = 0
  perpendicular: {
    // Always 1 row, but the residual *formula* depends on branch:
    //   no branch:   r = u · v        (zero for either ±90° configuration)
    //   branch ±1:   r = u × v − branch · |u||v|
    //                (zero iff u ⟂ v AND cross(u,v) has sign 'branch')
    // The branched form is smooth with no kinks and has a single global
    // minimum at the chosen perpendicular configuration — no local minima
    // on the wrong half-plane.
    rows: 1,
    computeError: (params, positions) => {
      const ax = positions[params.joints[0]*2], ay = positions[params.joints[0]*2+1];
      const bx = positions[params.joints[1]*2], by = positions[params.joints[1]*2+1];
      const cx = positions[params.joints[2]*2], cy = positions[params.joints[2]*2+1];
      const dx = positions[params.joints[3]*2], dy = positions[params.joints[3]*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      if (params.branch !== 1 && params.branch !== -1) return ux * vx + uy * vy;
      const cross = ux * vy - uy * vx;
      const lenU = Math.hypot(ux, uy) || 1e-12;
      const lenV = Math.hypot(vx, vy) || 1e-12;
      return cross - params.branch * lenU * lenV;
    },
    computeJacobian: (params, positions, outRow) => {
      const a = params.joints[0], b = params.joints[1], c = params.joints[2], d = params.joints[3];
      const ax = positions[a*2], ay = positions[a*2+1];
      const bx = positions[b*2], by = positions[b*2+1];
      const cx = positions[c*2], cy = positions[c*2+1];
      const dx = positions[d*2], dy = positions[d*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      if (params.branch !== 1 && params.branch !== -1) {
        // Original dot-product Jacobian
        addGrad(outRow, a, -vx, -vy);
        addGrad(outRow, b,  vx,  vy);
        addGrad(outRow, c, -ux, -uy);
        addGrad(outRow, d,  ux,  uy);
        return;
      }
      // Branched: r = (ux*vy − uy*vx) − branch · |u| · |v|
      // ∂r/∂u = (vy, −vx) − branch · |v| · (ux/|u|, uy/|u|)
      // ∂r/∂v = (−uy, ux) − branch · |u| · (vx/|v|, vy/|v|)
      // Chain to a,b,c,d via u = b−a, v = d−c.
      const lenU = Math.hypot(ux, uy) || 1e-12;
      const lenV = Math.hypot(vx, vy) || 1e-12;
      const br = params.branch;
      const drdux =  vy - br * lenV * (ux / lenU);
      const drduy = -vx - br * lenV * (uy / lenU);
      const drdvx = -uy - br * lenU * (vx / lenV);
      const drdvy =  ux - br * lenU * (vy / lenV);
      // u = b − a  →  ∂u/∂a = −I, ∂u/∂b = +I
      addGrad(outRow, a, -drdux, -drduy);
      addGrad(outRow, b,  drdux,  drduy);
      // v = d − c  →  ∂v/∂c = −I, ∂v/∂d = +I
      addGrad(outRow, c, -drdvx, -drdvy);
      addGrad(outRow, d,  drdvx,  drdvy);
    }
  },

  // Tangent: for circle/arc-line or arc-arc; simplified as dot of normals = 0 for arc-line
  // Here we implement point/arc tangent to line as constraint between arc center and line direction + radius sign.
  //
  // Circle-circle branch lock: `params.branch` ∈ {'external', 'internal'}
  //   'external' (default): circles touch on the outside, dist(centers) = r1 + r2
  //   'internal':           one circle inside the other, dist(centers) = |r1 - r2|
  // Without a branch, the solver picks whichever side the linearization points
  // toward — and a fast drag can flip mid-stroke. Locking at creation time
  // pins the chosen configuration.
  tangent: {
    rows: 1,
    computeError: (params, positions) => {
      // Two modes:
      //   1) circle-circle: params.joints = [C1, C2], params.radii = [r1, r2]
      //      residual = ‖C2−C1‖ − target, target = r1+r2 (external) or |r1−r2| (internal)
      //   2) circle-line:   params.joints = [C, A, B], params.radius = r
      //      residual = (cross² − r²·|u|²) / |u|²  where cross = (C−A) × (B−A), u = B−A
      //      Smooth (no |·|), zero iff distance(C, line) = r.
      if (params.joints && params.joints.length === 2 && Array.isArray(params.radii) && params.radii.length === 2) {
        const i1 = params.joints[0], i2 = params.joints[1];
        const x1 = positions[i1*2], y1 = positions[i1*2+1];
        const x2 = positions[i2*2], y2 = positions[i2*2+1];
        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.hypot(dx, dy) || 1e-12;
        const at = params.radiiAt || [], rim = params.rimJoints || [];
        const r1 = radiusValue(positions, at[0], params.radii[0], rim[0], i1);
        const r2 = radiusValue(positions, at[1], params.radii[1], rim[1], i2);
        const target = (params.branch === 'internal') ? Math.abs(r1 - r2) : (r1 + r2);
        return dist - target;
      }

      // Circle-line case: residual = |signed_dist(C, line AB)| − radius
      // Linear in |d|, so the gradient stays at unit slope all the way to
      // convergence (unlike d²−r² which shrinks near the optimum and stalls
      // LM at a few-tenths-of-a-percent geometric error).
      const cI = params.joints[0], aI = params.joints[1], bI = params.joints[2];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const ux = bx - ax, uy = by - ay;
      const wx = cx - ax, wy = cy - ay;
      const cross = wx * uy - wy * ux;
      const lu = Math.hypot(ux, uy) || 1e-12;
      if (params.sharedEnd) {
        // Endpoint tangency: the shared joint P is the touch point, so (P - C) ⟂ line direction.
        const px = params.sharedEnd === 'a' ? ax : bx, py = params.sharedEnd === 'a' ? ay : by;
        return ((px - cx) * ux + (py - cy) * uy) / lu;
      }
      const r = radiusValue(positions, params.radiusAt, params.radius, params.rimJoint, cI);
      return Math.abs(cross / lu) - r;
    },
    computeJacobian: (params, positions, outRow) => {
      // circle-circle Jacobian: same as distance w.r.t centers
      if (params.joints && params.joints.length === 2 && Array.isArray(params.radii) && params.radii.length === 2) {
        const i1 = params.joints[0], i2 = params.joints[1];
        const x1 = positions[i1*2], y1 = positions[i1*2+1];
        const x2 = positions[i2*2], y2 = positions[i2*2+1];
        const dx = x2 - x1, dy = y2 - y1;
        const r = Math.hypot(dx, dy) || 1e-12;
        addGrad(outRow, i1, -dx / r, -dy / r);
        addGrad(outRow, i2,  dx / r,  dy / r);
        // each operand's radius (a circle's unknown or an arc's |rim - centre|): target r1 + r2 (external) or |r1 - r2| (internal)
        const at = params.radiiAt || [], rim = params.rimJoints || [];
        const r1 = radiusValue(positions, at[0], params.radii[0], rim[0], i1), r2 = radiusValue(positions, at[1], params.radii[1], rim[1], i2);
        const internal = params.branch === 'internal', s = r1 - r2 >= 0 ? 1 : -1;
        addRadiusDerivative(outRow, positions, internal ? -s : -1, at[0], rim[0], i1);
        addRadiusDerivative(outRow, positions, internal ? s : -1, at[1], rim[1], i2);
        return;
      }

      // Circle-line Jacobian for residual = |s| − r where s = cross/|u|.
      // d|s|/dvar = sgn(s) · ds/dvar.
      const cI = params.joints[0], aI = params.joints[1], bI = params.joints[2];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const ux = bx - ax, uy = by - ay;
      const wx = cx - ax, wy = cy - ay;
      const cross = wx * uy - wy * ux;
      const lu = Math.hypot(ux, uy) || 1e-12;
      if (params.sharedEnd) {
        // s = (P - C).u / |u|; ds = (dw.u + w.du)/|u| - g (u.du)/|u|^3, g = w.u
        const pI = params.sharedEnd === 'a' ? aI : bI;
        const wpx = positions[pI*2] - cx, wpy = positions[pI*2+1] - cy;
        const g = wpx * ux + wpy * uy;
        const lu3 = lu * lu * lu;
        const add = (idx, dwx, dwy, dux, duy) => addGrad(outRow, idx,
          (dwx * ux + wpx * dux) / lu - g * (ux * dux) / lu3,
          (dwy * uy + wpy * duy) / lu - g * (uy * duy) / lu3);
        // x and y components are independent: variable x moves (dw,du) along x only.
        add(cI, -1, -1, 0, 0);
        add(pI, 1, 1, 0, 0);
        add(aI, 0, 0, -1, -1);
        add(bI, 0, 0, 1, 1);
        return;
      }
      const s = cross / lu;
      const sgn = s >= 0 ? 1 : -1;
      // ∂cross/∂{Cx,Cy} = (uy, −ux)
      // ∂cross/∂{Ax,Ay} = (wy − uy,  ux − wx)
      // ∂cross/∂{Bx,By} = (−wy,       wx)
      // ∂(1/|u|)/∂{Ax,Ay} = ( ux/|u|³,  uy/|u|³)
      // ∂(1/|u|)/∂{Bx,By} = (−ux/|u|³, −uy/|u|³)
      // ∂(1/|u|)/∂{Cx,Cy} = 0
      const lu3 = lu * lu * lu;
      addGrad(outRow, cI, sgn * (uy / lu), sgn * (-ux / lu));
      addGrad(outRow, aI, sgn * ((wy - uy) / lu + cross * (ux / lu3)), sgn * ((ux - wx) / lu + cross * (uy / lu3)));
      addGrad(outRow, bI, sgn * ((-wy) / lu + cross * (-ux / lu3)), sgn * ((wx) / lu + cross * (-uy / lu3)));
      addRadiusDerivative(outRow, positions, -1, params.radiusAt, params.rimJoint, cI);
    }
  },

  // Equal: enforce length/radius equality between two shapes (line or circle)
  equal: {
    rows: 1,
    computeError: (params, positions) => {
      // A circle operand (engine.js): params.terms = [t1, t2], each { at } (a circle's radius unknown) or { a, b } (|a - b|).
      if (params.terms) {
        const size = (t) => (typeof t.at === 'number' ? positions[t.at]
          : Math.hypot(positions[t.a*2] - positions[t.b*2], positions[t.a*2+1] - positions[t.b*2+1]));
        return size(params.terms[0]) - size(params.terms[1]);
      }
      // Prefer explicit joint pairs when present: [a,b,c,d] -> len(a,b) - len(c,d)
      if (params.joints && params.joints.length >= 4) {
        const a = params.joints[0], b = params.joints[1], c = params.joints[2], d = params.joints[3];
        const ax = positions[a*2], ay = positions[a*2+1];
        const bx = positions[b*2], by = positions[b*2+1];
        const cx = positions[c*2], cy = positions[c*2+1];
        const dx = positions[d*2], dy = positions[d*2+1];
        const l1 = Math.hypot(ax - bx, ay - by) || 0;
        const l2 = Math.hypot(cx - dx, cy - dy) || 0;
        return l1 - l2;
      }
      return 0;
    },
    computeJacobian: (params, positions, outRow) => {
      if (params.terms) {
        // ACCUMULATE: the two terms may share a joint (see below).
        params.terms.forEach((t, i) => {
          const sg = i === 0 ? 1 : -1;
          if (typeof t.at === 'number') { outRow[t.at] += sg; return; }
          const dx = positions[t.a*2] - positions[t.b*2], dy = positions[t.a*2+1] - positions[t.b*2+1];
          const l = Math.hypot(dx, dy) || 1e-12;
          addGrad(outRow, t.a, sg * dx / l, sg * dy / l);
          addGrad(outRow, t.b, -sg * dx / l, -sg * dy / l);
        });
        return;
      }
      if (params.joints && params.joints.length >= 4) {
        const a = params.joints[0], b = params.joints[1], c = params.joints[2], d = params.joints[3];
        const ax = positions[a*2], ay = positions[a*2+1];
        const bx = positions[b*2], by = positions[b*2+1];
        const cx = positions[c*2], cy = positions[c*2+1];
        const dx = positions[d*2], dy = positions[d*2+1];
        const dx1 = ax - bx, dy1 = ay - by;
        const dx2 = cx - dx, dy2 = cy - dy;
        const l1 = Math.hypot(dx1, dy1) || 1e-12;
        const l2 = Math.hypot(dx2, dy2) || 1e-12;
        // ACCUMULATE (+= / -=), never assign: the two lengths may share a joint. Every arc is
        // equal [centre, rim1, centre, rim2] (shapes.js makeArc), so a === c, and an assignment let the
        // second length's partial overwrite the first on the centre -> wrong Jacobian -> drags stalled
        // (turn 404). The row starts at zero (addGrad), so this is exact for distinct joints too.
        // ∂len1/∂a = (dx1/l1, dy1/l1); ∂len1/∂b = (-dx1/l1, -dy1/l1)
        addGrad(outRow, a, dx1 / l1, dy1 / l1);
        addGrad(outRow, b, -dx1 / l1, -dy1 / l1);
        // subtract derivatives for second length (len1 - len2)
        addGrad(outRow, c, -dx2 / l2, -dy2 / l2);
        addGrad(outRow, d, dx2 / l2, dy2 / l2);
      }
    }
  },

  // Angle: the angle dimension between two line segments, value in degrees, in its measured sector (angleRow above, task 553).
  //
  // Near the answer the row is r = k (cross(u, v) · cos(t) − turn · dot(u, v) · sin(t)) = |u||v| sin(theta − alpha), t = value · π/180.
  // Special cases there:
  //   t = 0°  → r = k cross(u, v)         (same as parallel)
  //   t = 90° → r = −k turn dot(u, v)     (same as perpendicular, no branch lock)
  // Un-normalized — the residual scales with |u|·|v|, but the Jacobian is exact.
  angle: {
    rows: 1,
    computeError: (params, positions) => {
      const ax = positions[params.joints[0]*2], ay = positions[params.joints[0]*2+1];
      const bx = positions[params.joints[1]*2], by = positions[params.joints[1]*2+1];
      const cx = positions[params.joints[2]*2], cy = positions[params.joints[2]*2+1];
      const dx = positions[params.joints[3]*2], dy = positions[params.joints[3]*2+1];
      const g = angleRow(params, bx - ax, by - ay, dx - cx, dy - cy);
      return g.far ? 2 * g.sgn * g.lu * g.lv - g.S : g.S;
    },
    computeJacobian: (params, positions, outRow) => {
      const aI = params.joints[0], bI = params.joints[1], cI = params.joints[2], dI = params.joints[3];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const dx = positions[dI*2], dy = positions[dI*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      const g = angleRow(params, ux, uy, vx, vy);
      const { k, ct, st } = g;
      // S = k (cross·ct − dot·st)
      // ∂cross/∂(ux,uy) = (vy, −vx); ∂dot/∂(ux,uy) = (vx, vy)
      // ∂cross/∂(vx,vy) = (−uy, ux); ∂dot/∂(vx,vy) = (ux, uy)
      let drdux = k * ( vy * ct - vx * st);
      let drduy = k * (-vx * ct - vy * st);
      let drdvx = k * (-uy * ct - ux * st);
      let drdvy = k * ( ux * ct - uy * st);
      if (g.far) {
        // r = 2 sgn(S) |u||v| − S:  ∂(|u||v|)/∂u = |v| u/|u|,  ∂(|u||v|)/∂v = |u| v/|v|
        const lu = g.lu || 1e-12, lv = g.lv || 1e-12, w = 2 * g.sgn;
        drdux = w * lv * ux / lu - drdux;
        drduy = w * lv * uy / lu - drduy;
        drdvx = w * lu * vx / lv - drdvx;
        drdvy = w * lu * vy / lv - drdvy;
      }
      addGrad(outRow, aI, -drdux, -drduy);
      addGrad(outRow, bI,  drdux,  drduy);
      addGrad(outRow, cI, -drdvx, -drdvy);
      addGrad(outRow, dI,  drdvx,  drdvy);
    }
  },

  // Mouse-spring: soft target used by InteractionSolver to represent a drag 'weak constraint'
  mouse_spring: {
    rows: 2,
    computeError: (params, positions) => {
      const pi = params.joints[0];
      const px = positions[pi*2], py = positions[pi*2+1];
      const tx = (params.value && params.value[0]) || 0;
      const ty = (params.value && params.value[1]) || 0;
      const w = Math.sqrt(params.stiffness || 1e4);
      return [ w * (px - tx), w * (py - ty) ];
    },
    computeJacobian: (params, positions, outRows) => {
      const pi = params.joints[0];
      const w = Math.sqrt(params.stiffness || 1e4);
      addGrad(outRows[0], pi, w, 0);
      addGrad(outRows[1], pi, 0, w);
    }
  }
};

// THE body point of a shape (task 538): in a BODY drag the mouse spring pulls the point of the shape that was GRABBED, fixed on the
// shape by ONE number computed once at pointer-down from the hit position (param). One entry per shape kind, declared as data:
//   param(P, hit)                the parameter of the grabbed point: P = the shape's joint positions [{x,y}] in shape.joints order
//   point(op, positions)         the body point [x, y] read from the solver positions (op.target = the spring's target, the cursor)
//   grad(op, positions, rows)    d(point)/d(variables): row 0 = d x, row 1 = d y, ACCUMULATED through addGrad / addRadiusDerivative
// op = { joints: dense joint indices of the shape (shape.joints order), param, target: [x, y] (the spring's target), radiusAt / radius /
// rimJoint (the radius operand, engine._radiusOperand: a circle's radius unknown, an arc's live |rim - centre|) }.
//   prefersHold                  indices into shape.joints held for the drag WHEN the body point can still follow the cursor with them
//                                held (engine.bodyDragTarget); released (least change) when it cannot. A temporary hold: solver rows
//                                only, nothing is written to the document.
// A kind with no entry has no body point (bezier: its control points are shape data, not solver unknowns): its body drag keeps the
// joint drag targets of every member (selection-tools.js).
// The rim point on the TARGET's ray from the centre: P = C + r u, u = (target - C) / |target - C| (the grab angle `param` when the target
// sits on the centre), r = the circle's radius unknown or the arc's live radius. Its angle follows the cursor (like Fusion), so P - target
// = (r - |target - C|) u: the spring makes the circle / arc pass through the cursor. dP/dC = I - (r / d)(I - u u^T), dP/dr = u.
const rimDir = (op, positions) => {
  const c = op.joints[0], dx = op.target[0] - positions[c*2], dy = op.target[1] - positions[c*2+1], d = Math.hypot(dx, dy);
  return d > 0 ? { ux: dx / d, uy: dy / d, d } : { ux: Math.cos(op.param), uy: Math.sin(op.param), d: 0 };
};
const RIM_POINT = {
  // A rim drag changes the RADIUS and keeps the CENTRE (joints[0]) whenever the constraints allow it (owner 2026-11-12, like Fusion).
  prefersHold: [0],
  param: (P, hit) => Math.atan2(hit.y - P[0].y, hit.x - P[0].x),
  point: (op, positions) => {
    const c = op.joints[0], r = radiusValue(positions, op.radiusAt, op.radius, op.rimJoint, c), { ux, uy } = rimDir(op, positions);
    return [positions[c*2] + r * ux, positions[c*2+1] + r * uy];
  },
  grad: (op, positions, rows) => {
    const c = op.joints[0], r = radiusValue(positions, op.radiusAt, op.radius, op.rimJoint, c), { ux, uy, d } = rimDir(op, positions);
    const k = d > 0 ? r / d : 0;
    addGrad(rows[0], c, 1 - k * (1 - ux * ux), k * ux * uy);
    addGrad(rows[1], c, k * ux * uy, 1 - k * (1 - uy * uy));
    addRadiusDerivative(rows[0], positions, ux, op.radiusAt, op.rimJoint, c);
    addRadiusDerivative(rows[1], positions, uy, op.radiusAt, op.rimJoint, c);
  },
};
export const BODY_POINTS = {
  // a fixed fraction t along the line: P = (1 - t) A + t B (t = the hit projected on AB, 0..1)
  line: {
    prefersHold: [],   // a line translates: nothing held
    param: (P, hit) => {
      const ux = P[1].x - P[0].x, uy = P[1].y - P[0].y, l2 = ux * ux + uy * uy;
      return l2 > 0 ? Math.min(1, Math.max(0, ((hit.x - P[0].x) * ux + (hit.y - P[0].y) * uy) / l2)) : 0.5;
    },
    point: (op, positions) => {
      const a = op.joints[0], b = op.joints[1], t = op.param;
      return [(1 - t) * positions[a*2] + t * positions[b*2], (1 - t) * positions[a*2+1] + t * positions[b*2+1]];
    },
    grad: (op, positions, rows) => {
      const a = op.joints[0], b = op.joints[1], t = op.param;
      addGrad(rows[0], a, 1 - t, 0); addGrad(rows[0], b, t, 0);
      addGrad(rows[1], a, 0, 1 - t); addGrad(rows[1], b, 0, t);
    },
  },
  circle: RIM_POINT,
  arc: RIM_POINT,
};

// Backwards-compatible aliases for constraint type names (camelCase → snake_case)
// Many parts of the codebase use camelCase keys (e.g. CONSTRAINT_TYPES.POINT_ON_LINE === 'pointOnLine')
// while solver Definitions are snake_cased. Provide aliases so engine.lookup works with either.
Definitions.pointOnLine = Definitions.point_on_line;
Definitions.mouseSpring = Definitions.mouse_spring;
