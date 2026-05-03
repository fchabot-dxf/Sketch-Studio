// Constraint definitions: computeError(params, positions) and computeJacobian(params, positions)
// positions: Float64Array [x0,y0, x1,y1, ...] for joints referenced by indices in 'params.joints'

function idx(positions, jointIndex) { return jointIndex * 2; }

export const Definitions = {
  // Distance constraint between joint a and b: |pa - pb| - value = 0
  distance: {
    rows: 1,
    computeError: (params, positions) => {
      const ia = params.joints[0], ib = params.joints[1];
      const ax = positions[ia*2], ay = positions[ia*2+1];
      const bx = positions[ib*2], by = positions[ib*2+1];
      const dx = ax - bx, dy = ay - by;
      return Math.hypot(dx, dy) - (params.value || 0);
    },
    computeJacobian: (params, positions, outRow) => {
      const ia = params.joints[0], ib = params.joints[1];
      const ax = positions[ia*2], ay = positions[ia*2+1];
      const bx = positions[ib*2], by = positions[ib*2+1];
      const dx = ax - bx, dy = ay - by;
      const r = Math.hypot(dx, dy) || 1e-12;
      // derivative w.r.t ax,ay is (dx/r, dy/r); w.r.t bx,by is (-dx/r, -dy/r)
      outRow[ia*2 + 0] = dx / r; outRow[ia*2 + 1] = dy / r;
      outRow[ib*2 + 0] = -dx / r; outRow[ib*2 + 1] = -dy / r;
    }
  },

  // Point-on-line: project point P onto line AB and require perpendicular distance = 0
  // Error = ((P - A) x (B - A)) / |B-A|  (scalar perpendicular distance)
  point_on_line: {
    rows: 1,
    computeError: (params, positions) => {
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
      // Prefer to move only the midpoint joint (do not move the endpoints)
      const m = params.joints[2];
      outRows[0][m*2 + 0] = -1; outRows[0][m*2 + 1] = 0;
      outRows[1][m*2 + 0] = 0; outRows[1][m*2 + 1] = -1;
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
  // Parallel: enforce direction vectors are collinear -> cross product zero
  // For two segments A-B and C-D: error = ( (B-A) x (D-C) ) / (|B-A|*|D-C|)  -> scalar
  parallel: {
    rows: 1,
    computeError: (params, positions) => {
      const a = positions[params.joints[0]*2], b = positions[params.joints[0]*2+1];
      // params.joints: [A,B,C,D]
      const ax = positions[params.joints[0]*2], ay = positions[params.joints[0]*2+1];
      const bx = positions[params.joints[1]*2], by = positions[params.joints[1]*2+1];
      const cx = positions[params.joints[2]*2], cy = positions[params.joints[2]*2+1];
      const dx = positions[params.joints[3]*2], dy = positions[params.joints[3]*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      const cross = ux * vy - uy * vx;
      const denom = (Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1e-12;
      return cross / denom;
    },
    computeJacobian: (params, positions, outRow) => {
      // For brevity and performance: compute numeric partials via analytic chain rule but keep compact.
      // (Implementation note: parallel constraints are rare and Jacobians below are straightforward but verbose.)
      // --- simplified (robust for small-scale solver) ---
      const aI = params.joints[0], bI = params.joints[1], cI = params.joints[2], dI = params.joints[3];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const dx = positions[dI*2], dy = positions[dI*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      const cross = ux * vy - uy * vx;
      const lu = Math.hypot(ux, uy) || 1e-12;
      const lv = Math.hypot(vx, vy) || 1e-12;
      const denom = lu * lv;
      // partials (example for ax): ∂cross/∂ax = -vy ; adjust by /denom and account for denom derivative
      const ddenom_du = (1/lu) * (ux / lu); // simplified scalar used below when needed

      outRow[aI*2 + 0] = (-vy)/denom;
      outRow[aI*2 + 1] = (vx)/denom;
      outRow[bI*2 + 0] = (vy)/denom;
      outRow[bI*2 + 1] = (-vx)/denom;
      outRow[cI*2 + 0] = ( -(-uy) )/denom; // ∂/∂cx -> +uy/denom
      outRow[cI*2 + 1] = ( -( -ux) )/denom; // -> -ux/denom
      outRow[dI*2 + 0] = (-uy)/denom;
      outRow[dI*2 + 1] = (ux)/denom;
    }
  },

  // Perpendicular: (B-A) dot (D-C) = 0
  perpendicular: {
    rows: 1,
    computeError: (params, positions) => {
      const ax = positions[params.joints[0]*2], ay = positions[params.joints[0]*2+1];
      const bx = positions[params.joints[1]*2], by = positions[params.joints[1]*2+1];
      const cx = positions[params.joints[2]*2], cy = positions[params.joints[2]*2+1];
      const dx = positions[params.joints[3]*2], dy = positions[params.joints[3]*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      return ux * vx + uy * vy;
    },
    computeJacobian: (params, positions, outRow) => {
      const a = params.joints[0], b = params.joints[1], c = params.joints[2], d = params.joints[3];
      const ax = positions[a*2], ay = positions[a*2+1];
      const bx = positions[b*2], by = positions[b*2+1];
      const cx = positions[c*2], cy = positions[c*2+1];
      const dx = positions[d*2], dy = positions[d*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      // ∂/∂ax = -vx ; ∂/∂ay = -vy
      outRow[a*2 + 0] = -vx; outRow[a*2 + 1] = -vy;
      // ∂/∂bx = vx ; ∂/∂by = vy
      outRow[b*2 + 0] = vx; outRow[b*2 + 1] = vy;
      // ∂/∂cx = -ux ; ∂/∂cy = -uy
      outRow[c*2 + 0] = -ux; outRow[c*2 + 1] = -uy;
      // ∂/∂dx = ux ; ∂/∂dy = uy
      outRow[d*2 + 0] = ux; outRow[d*2 + 1] = uy;
    }
  },

  // Tangent: for circle/arc-line or arc-arc; simplified as dot of normals = 0 for arc-line
  // Here we implement point/arc tangent to line as constraint between arc center and line direction + radius sign.
  tangent: {
    rows: 1,
    computeError: (params, positions) => {
      // Two modes supported:
      // 1) circle-line tangent: params.joints = [C, A, B] => enforce (C-A) dot (B-A) = 0 (radius ⟂ tangent)
      // 2) circle-circle tangent (shapes case): params.joints = [C1, C2] and params.radii = [r1, r2]
      if (params.joints && params.joints.length === 2 && Array.isArray(params.radii) && params.radii.length === 2) {
        const i1 = params.joints[0], i2 = params.joints[1];
        const x1 = positions[i1*2], y1 = positions[i1*2+1];
        const x2 = positions[i2*2], y2 = positions[i2*2+1];
        const dx = x2 - x1, dy = y2 - y1;
        const dist = Math.hypot(dx, dy) || 1e-12;
        const target = (Number(params.radii[0]) || 0) + (Number(params.radii[1]) || 0);
        return dist - target;
      }

      // Fallback: circle-line tangent
      const cI = params.joints[0], aI = params.joints[1], bI = params.joints[2];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const ux = bx - ax, uy = by - ay;
      const wx = cx - ax, wy = cy - ay;
      return wx * ux + wy * uy;
    },
    computeJacobian: (params, positions, outRow) => {
      // circle-circle Jacobian: same as distance w.r.t centers
      if (params.joints && params.joints.length === 2 && Array.isArray(params.radii) && params.radii.length === 2) {
        const i1 = params.joints[0], i2 = params.joints[1];
        const x1 = positions[i1*2], y1 = positions[i1*2+1];
        const x2 = positions[i2*2], y2 = positions[i2*2+1];
        const dx = x2 - x1, dy = y2 - y1;
        const r = Math.hypot(dx, dy) || 1e-12;
        // ∂/∂C1 = -(dx/r, dy/r); ∂/∂C2 = (dx/r, dy/r)
        outRow[i1*2 + 0] = -dx / r; outRow[i1*2 + 1] = -dy / r;
        outRow[i2*2 + 0] = dx / r; outRow[i2*2 + 1] = dy / r;
        return;
      }

      // circle-line Jacobian (existing behavior)
      const cI = params.joints[0], aI = params.joints[1], bI = params.joints[2];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const ux = bx - ax, uy = by - ay;
      // ∂/∂C : (ux, uy)
      outRow[cI*2 + 0] = ux; outRow[cI*2 + 1] = uy;
      // ∂/∂A : - (ux, uy) + (C-A) dot dU/dA (ignored for stability)
      outRow[aI*2 + 0] = -ux; outRow[aI*2 + 1] = -uy;
      // ∂/∂B : (C-A) dot dU/dB (approx 0 for robustness)
      outRow[bI*2 + 0] = 0; outRow[bI*2 + 1] = 0;
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
