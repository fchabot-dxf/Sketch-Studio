// Constraint definitions: computeError(params, positions) and computeJacobian(params, positions)
// positions: Float64Array [x0,y0, x1,y1, ...] for joints referenced by indices in 'params.joints'

function idx(positions, jointIndex) { return jointIndex * 2; }

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
      const dx = ax - bx, dy = ay - by;
      return Math.hypot(dx, dy) - (params.value || 0);
    },
    computeJacobian: (params, positions, outRow) => {
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
        outRow[pi*2 + 0] = sgn * (uy / lu);
        outRow[pi*2 + 1] = sgn * (-ux / lu);
        outRow[ai*2 + 0] = sgn * ((wy - uy) / lu + cross * (ux / lu3));
        outRow[ai*2 + 1] = sgn * ((ux - wx) / lu + cross * (uy / lu3));
        outRow[bi*2 + 0] = sgn * ((-wy) / lu + cross * (-ux / lu3));
        outRow[bi*2 + 1] = sgn * ((wx) / lu + cross * (-uy / lu3));
        return;
      }
      const ia = params.joints[0], ib = params.joints[1];
      const ax = positions[ia*2], ay = positions[ia*2+1];
      const bx = positions[ib*2], by = positions[ib*2+1];
      const dx = ax - bx, dy = ay - by;
      const r = Math.hypot(dx, dy) || 1e-12;
      outRow[ia*2 + 0] = dx / r; outRow[ia*2 + 1] = dy / r;
      outRow[ib*2 + 0] = -dx / r; outRow[ib*2 + 1] = -dy / r;
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
        return Math.hypot(dx, dy) - (params.radius || 0);
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
      // Point-on-circle/arc: move only the point along the radial direction.
      if (params.onCircle) {
        const pi = params.joints[0], ci = params.joints[1];
        const dx = positions[pi*2] - positions[ci*2];
        const dy = positions[pi*2+1] - positions[ci*2+1];
        const d = Math.hypot(dx, dy) || 1e-12;
        outRow[pi*2 + 0] = dx / d; outRow[pi*2 + 1] = dy / d;
        outRow[ci*2 + 0] = 0; outRow[ci*2 + 1] = 0;
        return;
      }
      const pi = params.joints[0], ai = params.joints[1], bi = params.joints[2];
      const px = positions[pi*2], py = positions[pi*2+1];
      const ax = positions[ai*2], ay = positions[ai*2+1];
      const bx = positions[bi*2], by = positions[bi*2+1];
      const ux = bx - ax, uy = by - ay;
      const wx = px - ax, wy = py - ay;
      const denom = Math.hypot(ux, uy) || 1e-12;
      const inv = 1 / (denom * denom * denom); // used for derivative of 1/denom

      // d/dP ( (P-A) x U / |U| ) => ( uy, -ux ) / |U|
      outRow[pi*2 + 0] = uy / denom; outRow[pi*2 + 1] = -ux / denom;

      // For point-on-line snapping we prefer to move the POINT (params.joints[0])
      // rather than moving the line endpoints. Set derivatives only for the point
      // so the solver updates the point position instead of altering the shape.
      outRow[ai*2 + 0] = 0; outRow[ai*2 + 1] = 0;
      outRow[bi*2 + 0] = 0; outRow[bi*2 + 1] = 0;
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
      outRows[0][a*2 + 0] = 1; outRows[0][a*2 + 1] = 0;
      outRows[0][b*2 + 0] = -1; outRows[0][b*2 + 1] = 0;
      // second row: y difference
      outRows[1][a*2 + 0] = 0; outRows[1][a*2 + 1] = 1;
      outRows[1][b*2 + 0] = 0; outRows[1][b*2 + 1] = -1;
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
      outRow[a*2 + 0] = 0; outRow[a*2 + 1] = 1;
      outRow[b*2 + 0] = 0; outRow[b*2 + 1] = -1;
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
      outRow[a*2 + 0] = 1; outRow[a*2 + 1] = 0;
      outRow[b*2 + 0] = -1; outRow[b*2 + 1] = 0;
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
      outRows[0][a*2 + 0] = 0.5; outRows[0][b*2 + 0] = 0.5; outRows[0][m*2 + 0] = -1;
      outRows[1][a*2 + 1] = 0.5; outRows[1][b*2 + 1] = 0.5; outRows[1][m*2 + 1] = -1;
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
      // For robustness we move the extra points (Ci) onto the baseline AB; set derivatives only on Ci
      for (let r = 0; r < ji.length - 2; ++r) {
        const ci = ji[2 + r];
        // ∂error/∂Cx = -uy/denom ; ∂error/∂Cy = ux/denom
        outRows[r][ci*2 + 0] = -uy / denom;
        outRows[r][ci*2 + 1] = ux / denom;
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
      outRow[aI*2 + 0] = -vy; outRow[aI*2 + 1] =  vx;
      outRow[bI*2 + 0] =  vy; outRow[bI*2 + 1] = -vx;
      outRow[cI*2 + 0] =  uy; outRow[cI*2 + 1] = -ux;
      outRow[dI*2 + 0] = -uy; outRow[dI*2 + 1] =  ux;
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
        outRow[a*2 + 0] = -vx; outRow[a*2 + 1] = -vy;
        outRow[b*2 + 0] =  vx; outRow[b*2 + 1] =  vy;
        outRow[c*2 + 0] = -ux; outRow[c*2 + 1] = -uy;
        outRow[d*2 + 0] =  ux; outRow[d*2 + 1] =  uy;
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
      outRow[a*2 + 0] = -drdux; outRow[a*2 + 1] = -drduy;
      outRow[b*2 + 0] =  drdux; outRow[b*2 + 1] =  drduy;
      // v = d − c  →  ∂v/∂c = −I, ∂v/∂d = +I
      outRow[c*2 + 0] = -drdvx; outRow[c*2 + 1] = -drdvy;
      outRow[d*2 + 0] =  drdvx; outRow[d*2 + 1] =  drdvy;
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
        const r1 = Number(params.radii[0]) || 0;
        const r2 = Number(params.radii[1]) || 0;
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
      const r = Number(params.radius) || 0;
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
        outRow[i1*2 + 0] = -dx / r; outRow[i1*2 + 1] = -dy / r;
        outRow[i2*2 + 0] =  dx / r; outRow[i2*2 + 1] =  dy / r;
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
      const s = cross / lu;
      const sgn = s >= 0 ? 1 : -1;
      // ∂cross/∂{Cx,Cy} = (uy, −ux)
      // ∂cross/∂{Ax,Ay} = (wy − uy,  ux − wx)
      // ∂cross/∂{Bx,By} = (−wy,       wx)
      // ∂(1/|u|)/∂{Ax,Ay} = ( ux/|u|³,  uy/|u|³)
      // ∂(1/|u|)/∂{Bx,By} = (−ux/|u|³, −uy/|u|³)
      // ∂(1/|u|)/∂{Cx,Cy} = 0
      const lu3 = lu * lu * lu;
      outRow[cI*2 + 0] = sgn * (uy / lu);
      outRow[cI*2 + 1] = sgn * (-ux / lu);
      outRow[aI*2 + 0] = sgn * ((wy - uy) / lu + cross * (ux / lu3));
      outRow[aI*2 + 1] = sgn * ((ux - wx) / lu + cross * (uy / lu3));
      outRow[bI*2 + 0] = sgn * ((-wy) / lu + cross * (-ux / lu3));
      outRow[bI*2 + 1] = sgn * ((wx) / lu + cross * (-uy / lu3));
    }
  },

  // Equal: enforce length/radius equality between two shapes (line or circle)
  equal: {
    rows: 1,
    computeError: (params, positions) => {
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
      outRow.fill(0.0);
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
        // ∂len1/∂a = (dx1/l1, dy1/l1); ∂len1/∂b = (-dx1/l1, -dy1/l1)
        outRow[a*2 + 0] = dx1 / l1; outRow[a*2 + 1] = dy1 / l1;
        outRow[b*2 + 0] = -dx1 / l1; outRow[b*2 + 1] = -dy1 / l1;
        // subtract derivatives for second length (len1 - len2)
        outRow[c*2 + 0] = -dx2 / l2; outRow[c*2 + 1] = -dy2 / l2;
        outRow[d*2 + 0] = dx2 / l2; outRow[d*2 + 1] = dy2 / l2;
      }
    }
  },

  // Angle: enforce the angle between two line segments equals params.value (degrees).
  //
  // Lines are direction-symmetric (flipping a line by 180° is geometrically the
  // same line), so we pick a residual that's invariant under that flip:
  //   r = cross(u, v) · cos(t) − dot(u, v) · sin(t)     where t = value · π/180
  // Zero iff the angle from u to v is t mod π. Special cases:
  //   t = 0°  → r = cross(u, v)         (same as parallel)
  //   t = 90° → r = −dot(u, v)          (same as perpendicular, no branch lock)
  // Un-normalized — the residual scales with |u|·|v|, but the Jacobian is exact.
  angle: {
    rows: 1,
    computeError: (params, positions) => {
      const ax = positions[params.joints[0]*2], ay = positions[params.joints[0]*2+1];
      const bx = positions[params.joints[1]*2], by = positions[params.joints[1]*2+1];
      const cx = positions[params.joints[2]*2], cy = positions[params.joints[2]*2+1];
      const dx = positions[params.joints[3]*2], dy = positions[params.joints[3]*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      const t = ((Number(params.value) || 0) * Math.PI) / 180;
      const ct = Math.cos(t), st = Math.sin(t);
      return (ux * vy - uy * vx) * ct - (ux * vx + uy * vy) * st;
    },
    computeJacobian: (params, positions, outRow) => {
      const aI = params.joints[0], bI = params.joints[1], cI = params.joints[2], dI = params.joints[3];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const dx = positions[dI*2], dy = positions[dI*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      const t = ((Number(params.value) || 0) * Math.PI) / 180;
      const ct = Math.cos(t), st = Math.sin(t);
      // r = cross·ct − dot·st
      // ∂cross/∂(ux,uy) = (vy, −vx); ∂dot/∂(ux,uy) = (vx, vy)
      // ∂cross/∂(vx,vy) = (−uy, ux); ∂dot/∂(vx,vy) = (ux, uy)
      const drdux =  vy * ct - vx * st;
      const drduy = -vx * ct - vy * st;
      const drdvx = -uy * ct - ux * st;
      const drdvy =  ux * ct - uy * st;
      outRow[aI*2 + 0] = -drdux; outRow[aI*2 + 1] = -drduy;
      outRow[bI*2 + 0] =  drdux; outRow[bI*2 + 1] =  drduy;
      outRow[cI*2 + 0] = -drdvx; outRow[cI*2 + 1] = -drdvy;
      outRow[dI*2 + 0] =  drdvx; outRow[dI*2 + 1] =  drdvy;
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
      const idx = pi * 2;
      outRows[0][idx + 0] = w; outRows[0][idx + 1] = 0;
      outRows[1][idx + 0] = 0; outRows[1][idx + 1] = w;
    }
  }
};

// Backwards-compatible aliases for constraint type names (camelCase → snake_case)
// Many parts of the codebase use camelCase keys (e.g. CONSTRAINT_TYPES.POINT_ON_LINE === 'pointOnLine')
// while solver Definitions are snake_cased. Provide aliases so engine.lookup works with either.
Definitions.pointOnLine = Definitions.point_on_line;
Definitions.mouseSpring = Definitions.mouse_spring;
