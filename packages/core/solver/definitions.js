import { angleSectorOf } from '../angle-sector.js';
import { symmetricRowCount } from '../symmetric.js';
import { offsetRowCount, offsetRowValues } from '../offset.js';
import { patternRowCount, patternRowValues } from '../pattern.js';
import { arcMidpointFromChord } from '../geometry.js';

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

// THE size of a shape in a row (equal with a circle operand, the symmetric circle form): a term { at } is a circle's radius unknown,
// { radius } is a constant (locked or rigid-block) circle radius, { a, b } the length |a - b| (a line, or an arc's centre-rim pair).
const sizeValue = (t, positions) => (typeof t.at === 'number' ? positions[t.at]
  : typeof t.radius === 'number' ? t.radius
  : Math.hypot(positions[t.a*2] - positions[t.b*2], positions[t.a*2+1] - positions[t.b*2+1]));
// ACCUMULATE sg * d(size)/d(variables) into outRow (the two terms of a row may share a joint).
const addSizeGrad = (outRow, t, sg, positions) => {
  if (typeof t.at === 'number') { outRow[t.at] += sg; return; }
  if (typeof t.radius === 'number') return; // constant radius (locked or rigid-block circle)
  const dx = positions[t.a*2] - positions[t.b*2], dy = positions[t.a*2+1] - positions[t.b*2+1];
  const l = Math.hypot(dx, dy) || 1e-12;
  addGrad(outRow, t.a, sg * dx / l, sg * dy / l);
  addGrad(outRow, t.b, -sg * dx / l, -sg * dy / l);
};

// THE right angle of two vectors u and v (task 1038): ONE row for the perpendicular constraint and for a tangent at a shared end
// (sharedEndTangent below). Returns its value r and the derivatives gu = dr/du, gv = dr/dv.
//   no branch:   r = u . v   (zero at +90 or -90 degrees)
//   branch +-1:  the turn from u to v is locked to that sign: it IS the angle constraint's row (angleGrad) at 90 degrees with that turn,
//                regular at the solution and folded on the other half-plane, so the mirrored right angle is no solution. (The old
//                branched row u x v - branch |u||v| is never above 0 and touches 0 at the solution: a double root, its derivative vanishes
//                there, so the DOF counted a perpendicular that holds as free and the solve stopped short of 90 degrees: BUG-380, audit
//                1037 N-A.)
const rightAngleRow = (ux, uy, vx, vy, branch) => ((branch !== 1 && branch !== -1)
  ? { r: ux * vx + uy * vy, gu: [vx, vy], gv: [ux, uy] }
  : angleGrad({ value: 90, sector: { ray1: 1, ray2: 1, turn: branch } }, ux, uy, vx, vy));

// THE tangent at a shared end (task 1038; ONE rule for line-arc and arc-arc): the two curves share their touch point P (one joint of both),
// so they are tangent when the arc's radius C -> P is at a right angle to the other curve's direction t at P:
//   r = rightAngleRow(P - C, t) / |t|   (a length)
// t = B - A for a line (no branch: either way along it); for an arc t = (P - C2) turned +90 degrees, with the tangent's side as the
// branch (u x t = (P - C) . (P - C2)): 'external', the centres on either side of P, is -1; 'internal' +1.
// The distance forms (|C - line| = r, |C1C2| = r1 + r2 or |r1 - r2|) have a double root when the curves share P (a zero row: the DOF
// counted the tangent as free, BUG-381, audit 1037 N-B). e = params.sharedEnd (engine.js): { at: P, centre: C, from, to, turned, branch },
// t = to - from, turned +90 degrees when `turned`.
const sharedEndTangent = (e, positions) => {
  const ux = positions[e.at*2] - positions[e.centre*2], uy = positions[e.at*2+1] - positions[e.centre*2+1];
  const dx = positions[e.to*2] - positions[e.from*2], dy = positions[e.to*2+1] - positions[e.from*2+1];
  const tx = e.turned ? -dy : dx, ty = e.turned ? dx : dy;
  const lt = Math.hypot(tx, ty) || 1e-12;
  const { r, gu, gv } = rightAngleRow(ux, uy, tx, ty, e.branch);
  const value = r / lt;
  // d(value)/dt = gv / |t| - value t / |t|^2; back through the turn (tx = -dy, ty = dx) to d = to - from
  const gtx = gv[0] / lt - value * tx / (lt * lt), gty = gv[1] / lt - value * ty / (lt * lt);
  return { value, gu: [gu[0] / lt, gu[1] / lt], gd: e.turned ? [gty, -gtx] : [gtx, gty] };
};

// THE mirror rows of ONE point pair (p, q) across the line through a and b (task 563, the symmetric constraint; every form uses it). With
// u = b - a and n = u turned -90 degrees / |u| (the normal of the cross product (w x u) / |u|), the reflection residual q - mirror(p) written
// in the line's own frame is
//   row 1   ((p - a) x u + (q - a) x u) / |u|   = (q - mirror(p)) . n   the signed distances of p and q sum to 0: their midpoint is on the line
//   row 2   (q - p) . u / |u|                   = (q - mirror(p)) . u/|u|   the segment pq is perpendicular to the line
// Both rows are world units and orthonormal in (p, q) (d/dp = [n, -u/|u|], d/dq = [n, u/|u|]), so the pair is as well-conditioned as a
// coincident whatever the line's length (an axis is 1 unit long, a sketch line any length); |q - mirror(p)| = hypot(row 1, row 2) is what
// the verifier measures. The line's ends take part (full derivative): a free symmetry line can move.
const mirrorPairError = (positions, a, b, p, q) => {
  const ax = positions[a*2], ay = positions[a*2+1], ux = positions[b*2] - ax, uy = positions[b*2+1] - ay;
  const lu = Math.hypot(ux, uy) || 1e-12;
  const px = positions[p*2] - ax, py = positions[p*2+1] - ay, qx = positions[q*2] - ax, qy = positions[q*2+1] - ay;
  return [((px * uy - py * ux) + (qx * uy - qy * ux)) / lu, ((qx - px) * ux + (qy - py) * uy) / lu];
};
const mirrorPairGrad = (positions, a, b, p, q, row1, row2) => {
  const ax = positions[a*2], ay = positions[a*2+1], ux = positions[b*2] - ax, uy = positions[b*2+1] - ay;
  const lu = Math.hypot(ux, uy) || 1e-12, lu3 = lu * lu * lu;
  const px = positions[p*2] - ax, py = positions[p*2+1] - ay, qx = positions[q*2] - ax, qy = positions[q*2+1] - ay;
  // row 1: (s x u) / |u| with s = (p - a) + (q - a):  d/ds = (uy, -ux) / |u|;  d/du = (-sy, sx) / |u| - (s x u) u / |u|^3
  const sx = px + qx, sy = py + qy, c1 = sx * uy - sy * ux;
  const g1ux = -sy / lu - c1 * ux / lu3, g1uy = sx / lu - c1 * uy / lu3;
  addGrad(row1, p, uy / lu, -ux / lu);
  addGrad(row1, q, uy / lu, -ux / lu);
  // s holds -2a (ds/da = -2 I) and u = b - a (du/da = -I, du/db = I)
  addGrad(row1, a, -2 * uy / lu - g1ux, 2 * ux / lu - g1uy);
  addGrad(row1, b, g1ux, g1uy);
  // row 2: (v . u) / |u| with v = q - p:  d/dv = u / |u|;  d/du = v / |u| - (v . u) u / |u|^3
  const vx = qx - px, vy = qy - py, d2 = vx * ux + vy * uy;
  const g2ux = vx / lu - d2 * ux / lu3, g2uy = vy / lu - d2 * uy / lu3;
  addGrad(row2, p, -ux / lu, -uy / lu);
  addGrad(row2, q, ux / lu, uy / lu);
  addGrad(row2, a, -g2ux, -g2uy);
  addGrad(row2, b, g2ux, g2uy);
};

// THE mirrored-point-ON-a-line row (task 572, the line form of symmetric): the reflection R of point q across the symmetry line s1-s2 lies on
// the line A-B. r = ((R - A) x v) / |v|, v = B - A, with R = s1 + 2 k u - w, w = q - s1, u = s2 - s1, k = (w . u) / |u|^2. One row per end of
// the second line: both ends on the mirror of the first line's INFINITE line (Fusion's two-line symmetry, measured), lengths free.
// World units like point_on_line; the reflection is an isometry, so d r / d q has unit length and the two rows of a line (one per end) are
// independent of each other's end: as well-conditioned as two point-on-line rows. (The pair rule does not fit: no point of the first line
// corresponds to an end of the second.) Full derivative on the symmetry line's ends and the first line's ends: they can move too.
const reflectAcross = (positions, s1, s2, q) => {
  const sx = positions[s1*2], sy = positions[s1*2+1], ux = positions[s2*2] - sx, uy = positions[s2*2+1] - sy;
  const l2 = (ux * ux + uy * uy) || 1e-24, wx = positions[q*2] - sx, wy = positions[q*2+1] - sy, k = (wx * ux + wy * uy) / l2;
  return { x: sx + 2 * k * ux - wx, y: sy + 2 * k * uy - wy, ux, uy, l2, wx, wy, k };
};
const mirrorOnLineError = (positions, s1, s2, q, a, b) => {
  const R = reflectAcross(positions, s1, s2, q);
  const ax = positions[a*2], ay = positions[a*2+1], vx = positions[b*2] - ax, vy = positions[b*2+1] - ay;
  return ((R.x - ax) * vy - (R.y - ay) * vx) / (Math.hypot(vx, vy) || 1e-12);
};
const mirrorOnLineGrad = (positions, s1, s2, q, a, b, row) => {
  const R = reflectAcross(positions, s1, s2, q);
  const ax = positions[a*2], ay = positions[a*2+1], vx = positions[b*2] - ax, vy = positions[b*2+1] - ay;
  const lv = Math.hypot(vx, vy) || 1e-12, wx = R.x - ax, wy = R.y - ay, r = (wx * vy - wy * vx) / lv;
  // the line A-B: point_on_line's derivative with the point R held
  const dd = (dvx, dvy) => (dvx * vx + dvy * vy) / lv;
  addGrad(row, a, ((-vy + wy) - r * dd(-1, 0)) / lv, ((-wx + vx) - r * dd(0, -1)) / lv);
  addGrad(row, b, ((-wy) - r * dd(1, 0)) / lv, ((wx) - r * dd(0, 1)) / lv);
  // through R: g = d r / d R = (vy, -vx) / |v|;  dR = ds1 + 2 dk u + 2 k du - dw,  dk = (dw . u + w . du) / |u|^2 - 2 k (u . du) / |u|^2
  const gx = vy / lv, gy = -vx / lv, gu = 2 * (gx * R.ux + gy * R.uy) / R.l2;
  addGrad(row, q, -gx + gu * R.ux, -gy + gu * R.uy);
  addGrad(row, s2, gu * (R.wx - 2 * R.k * R.ux) + 2 * R.k * gx, gu * (R.wy - 2 * R.k * R.uy) + 2 * R.k * gy);
  addGrad(row, s1, 2 * gx - 2 * R.k * gx + gu * (-R.ux - R.wx + 2 * R.k * R.ux), 2 * gy - 2 * R.k * gy + gu * (-R.uy - R.wy + 2 * R.k * R.uy));
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

// THE angle row's value and derivatives (the angle constraint; a branch-locked perpendicular is this row at 90 degrees, rightAngleRow):
// r = S = k (cross ct - dot st) where the pair is on the sector's side (C >= 0), else folded: 2 sgn(S) |u||v| - S.
const angleGrad = (params, ux, uy, vx, vy) => {
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
  return { r: g.far ? 2 * g.sgn * g.lu * g.lv - g.S : g.S, gu: [drdux, drduy], gv: [drdvx, drdvy] };
};

// TASK 658: the pattern rows (#core/pattern.js patternOperands, engine.js maps them to dense indices).
const patternError = (params, positions) => (params.patternOps ? patternRowValues(params.patternOps,
  (i) => ({ x: positions[i*2], y: positions[i*2+1] }), (o) => radiusValue(positions, o.at, o.radius, o.rim, o.centre)) : []);
function patternJacobian(params, positions, outRows) {
  const ops = params.patternOps;
  if (!ops) return;
  const X = (i) => positions[i*2], Y = (i) => positions[i*2+1];
  const circular = ops.kind === 'circularPattern';
  // a direction's unit vector and, for a line, its ends and length (d u / d b = (I - u u^T) / L, d u / d a = -(that))
  const dirs = circular ? [] : ops.dirs.map((d) => {
    if (d.a === undefined) return { u: { x: d.x, y: d.y } };
    const dx = X(d.b) - X(d.a), dy = Y(d.b) - Y(d.a), L = Math.hypot(dx, dy) || 1e-12;
    return { a: d.a, b: d.b, L, u: { x: dx / L, y: dy / L } };
  });
  let k = 0;
  for (const r of ops.rows) {
    if (r.k === 'pt') {
      const rx = outRows[k], ry = outRows[k + 1];
      k += 2;
      addGrad(rx, r.q, 1, 0); addGrad(ry, r.q, 0, 1);
      if (circular) {
        // q - C - M (p - C), M = rotation by th:  d/dp = -M,  d/dC = M - I
        const co = Math.cos(r.th), si = Math.sin(r.th);
        addGrad(rx, r.p, -co, si); addGrad(ry, r.p, -si, -co);
        addGrad(rx, ops.centre, co - 1, -si); addGrad(ry, ops.centre, si, co - 1);
      } else {
        // q - p - t1 u1 - t2 u2
        addGrad(rx, r.p, -1, 0); addGrad(ry, r.p, 0, -1);
        dirs.forEach((d, n) => {
          if (d.a === undefined || !r.t[n]) return;
          const f = -r.t[n] / d.L, ux = d.u.x, uy = d.u.y;
          addGrad(rx, d.b, f * (1 - ux * ux), f * (-ux * uy)); addGrad(rx, d.a, -f * (1 - ux * ux), -f * (-ux * uy));
          addGrad(ry, d.b, f * (-ux * uy), f * (1 - uy * uy)); addGrad(ry, d.a, -f * (-ux * uy), -f * (1 - uy * uy));
        });
      }
      continue;
    }
    const row = outRows[k++];
    if (r.k === 'rad') {
      addRadiusDerivative(row, positions, 1, r.off.at, r.off.rim, r.off.centre);
      addRadiusDerivative(row, positions, -1, r.src.at, r.src.rim, r.src.centre);
      continue;
    }
    // 'ray': |W| th, th = atan2(A x W, A . W), A = M (p - cs) (M = the rotation, or I), W = q - cq: offset's 'ta' derivative with
    //   d/dW = th W / |W| + (-Wy, Wx) / |W|,  d/dA = |W| (Ay, -Ax) / |A|^2,  d/dp = M^T d/dA,  d/dcs = -M^T d/dA
    const co = circular ? Math.cos(r.th) : 1, si = circular ? Math.sin(r.th) : 0;
    const px = X(r.p) - X(r.cs), py = Y(r.p) - Y(r.cs), ax = co * px - si * py, ay = si * px + co * py;
    const wx = X(r.q) - X(r.cq), wy = Y(r.q) - Y(r.cq);
    const la2 = (ax * ax + ay * ay) || 1e-24, lw = Math.hypot(wx, wy) || 1e-12, th = Math.atan2(ax * wy - ay * wx, ax * wx + ay * wy);
    const gax = lw * ay / la2, gay = -lw * ax / la2, gwx = (th * wx - wy) / lw, gwy = (th * wy + wx) / lw;
    const gpx = co * gax + si * gay, gpy = -si * gax + co * gay;
    addGrad(row, r.q, gwx, gwy); addGrad(row, r.cq, -gwx, -gwy); addGrad(row, r.p, gpx, gpy); addGrad(row, r.cs, -gpx, -gpy);
  }
}

// TASK 875: the rows of the arc midpoint (the midpoint Definition's arc form), f = M - m with M = c + r n, r = |s - c| (the arc's live radius
// through its first rim joint, as _radiusOperand), n = dir R d / |d|, d = e - s, R (x, y) = (y, -x):
//   d f / d m = -I;  d f / d c = I - n u^T (u = (s - c) / r);  d f / d e = r N;  d f / d s = n u^T - r N,  N = d n / d d = (dir / |d|) (R - p dhat^T), p = R dhat
function arcMidpointGrad(joints, dir, positions, outRows) {
  const [c, s, e, m] = joints;
  const cx = positions[c*2], cy = positions[c*2+1], sx = positions[s*2], sy = positions[s*2+1], ex = positions[e*2], ey = positions[e*2+1];
  const r = Math.hypot(sx - cx, sy - cy) || 1e-12, ux = (sx - cx) / r, uy = (sy - cy) / r;
  const dl = Math.hypot(ex - sx, ey - sy) || 1e-12, hx = (ex - sx) / dl, hy = (ey - sy) / dl;
  const px = hy, py = -hx, nx = dir * px, ny = dir * py, k = dir / dl;
  const N00 = k * (0 - px * hx), N01 = k * (1 - px * hy), N10 = k * (-1 - py * hx), N11 = k * (0 - py * hy);
  const [rx, ry] = outRows;
  addGrad(rx, c, 1 - nx * ux, -nx * uy);           addGrad(ry, c, -ny * ux, 1 - ny * uy);
  addGrad(rx, s, nx * ux - r * N00, nx * uy - r * N01); addGrad(ry, s, ny * ux - r * N10, ny * uy - r * N11);
  addGrad(rx, e, r * N00, r * N01);                 addGrad(ry, e, r * N10, r * N11);
  addGrad(rx, m, -1, 0);                            addGrad(ry, m, 0, -1);
}

// TASK 789: the direction a distance between two joints ON each other is differentiated along (see distance computeJacobian): a 3-4-5 unit vector.
const COLLAPSED_DIRECTION = { x: 0.6, y: 0.8 };

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
      const targetVal = (params.value || 0) * (params.isDiameter ? 0.5 : 1);
      if (typeof params.radiusAt === 'number') return positions[params.radiusAt] - targetVal;   // a circle's radius (or diameter / 2)
      if (typeof params.radius === 'number') return params.radius - targetVal;                  // constant (locked or rigid-block) circle radius
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
      return Math.hypot(dx, dy) - targetVal;
    },
    computeJacobian: (params, positions, outRow) => {
      if (typeof params.radiusAt === 'number') { outRow[params.radiusAt] += 1; return; }
      if (typeof params.radius === 'number') return; // constant radius (locked or rigid-block circle)
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
      const r = Math.hypot(dx, dy);
      // TASK 789: two joints ON each other (a collapsed line, e.g. saved by an older version that took a 0 length) have no direction: any unit
      // vector is a gradient of |a - b| there. A zero row made the distance count as already determined (the rank test) and the solve could never
      // move the joints apart, so the line could not be repaired by a valid value. COLLAPSED_DIRECTION is on no axis and no diagonal, so it is
      // independent of the horizontal / vertical / perpendicular rows that hold one coordinate of a joint (an axis direction would be dependent on
      // them, and the solve would stay on that axis): the first step leaves the collapse and the true direction takes over.
      if (r === 0) { addGrad(outRow, ia, COLLAPSED_DIRECTION.x, COLLAPSED_DIRECTION.y); addGrad(outRow, ib, -COLLAPSED_DIRECTION.x, -COLLAPSED_DIRECTION.y); return; }
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
  // TASK 875, the ARC form (params.onArc; engine.js: joints [centre, start, end, point], params.dir = the arc's direction): the point IS the
  // arc's sweep midpoint M = #core/geometry.js arcMidpointFromChord (the centre + |start - centre| along the chord's normal on the arc's side),
  // residual M - point. Chosen over the pair |point - centre| = r + "on the bisector line": that pair is also zero at the MIRROR point (the
  // other end of the bisector diameter, on the chord midpoint's side for a sweep past 180); this point has one zero only, for any sweep in
  // (0, 360), and d/d(point) = -I like the line form (as well-conditioned as a coincident). Full derivative (arcMidpointGrad): the arc can
  // move to meet the point. An arc that does not resolve (joints missing) has nothing to hold: explicit zero rows.
  midpoint: {
    rows: 2,
    computeError: (params, positions) => {
      if (params.onArc) {
        if (params.joints.length < 4) return [0, 0];
        const [c, s, e, m] = params.joints;
        const M = arcMidpointFromChord(positions[c*2], positions[c*2+1], positions[s*2], positions[s*2+1], positions[e*2], positions[e*2+1], params.dir);
        return [M.x - positions[m*2], M.y - positions[m*2+1]];
      }
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
      if (params.onArc) { if (params.joints.length >= 4) arcMidpointGrad(params.joints, params.dir, positions, outRows); return; }
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

  // Perpendicular: (B-A) dot (D-C) = 0, branch-locked (c.branch +-1, CM.lockPerpendicularBranch) to the turn it was made with:
  // THE right-angle row (rightAngleRow above) of u = B - A and v = D - C.
  perpendicular: {
    rows: 1,
    computeError: (params, positions) => {
      const [a, b, c, d] = params.joints;
      return rightAngleRow(positions[b*2] - positions[a*2], positions[b*2+1] - positions[a*2+1],
        positions[d*2] - positions[c*2], positions[d*2+1] - positions[c*2+1], params.branch).r;
    },
    computeJacobian: (params, positions, outRow) => {
      const [a, b, c, d] = params.joints;
      const { gu, gv } = rightAngleRow(positions[b*2] - positions[a*2], positions[b*2+1] - positions[a*2+1],
        positions[d*2] - positions[c*2], positions[d*2+1] - positions[c*2+1], params.branch);
      // u = b - a, v = d - c (ACCUMULATE: the two lines may share a joint)
      addGrad(outRow, a, -gu[0], -gu[1]);
      addGrad(outRow, b,  gu[0],  gu[1]);
      addGrad(outRow, c, -gv[0], -gv[1]);
      addGrad(outRow, d,  gv[0],  gv[1]);
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
      // Curves that share their touch point (a fillet, an arc slot's corner): THE shared-end row (sharedEndTangent), line-arc and arc-arc.
      if (params.sharedEnd) return sharedEndTangent(params.sharedEnd, positions).value;
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
      const r = radiusValue(positions, params.radiusAt, params.radius, params.rimJoint, cI);
      return Math.abs(cross / lu) - r;
    },
    computeJacobian: (params, positions, outRow) => {
      if (params.sharedEnd) { // u = P - C, d = to - from (ACCUMULATE: P is also `to` of an arc's turned direction)
        const e = params.sharedEnd, { gu, gd } = sharedEndTangent(e, positions);
        addGrad(outRow, e.at, gu[0], gu[1]);
        addGrad(outRow, e.centre, -gu[0], -gu[1]);
        addGrad(outRow, e.to, gd[0], gd[1]);
        addGrad(outRow, e.from, -gd[0], -gd[1]);
        return;
      }
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
      if (params.terms) return sizeValue(params.terms[0], positions) - sizeValue(params.terms[1], positions);
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
        params.terms.forEach((t, i) => addSizeGrad(outRow, t, i === 0 ? 1 : -1, positions));
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
      return angleGrad(params, bx - ax, by - ay, dx - cx, dy - cy).r;
    },
    computeJacobian: (params, positions, outRow) => {
      const aI = params.joints[0], bI = params.joints[1], cI = params.joints[2], dI = params.joints[3];
      const ax = positions[aI*2], ay = positions[aI*2+1];
      const bx = positions[bI*2], by = positions[bI*2+1];
      const cx = positions[cI*2], cy = positions[cI*2+1];
      const dx = positions[dI*2], dy = positions[dI*2+1];
      const ux = bx - ax, uy = by - ay;
      const vx = dx - cx, vy = dy - cy;
      const { gu, gv } = angleGrad(params, ux, uy, vx, vy);
      const [drdux, drduy] = gu, [drdvx, drdvy] = gv;
      addGrad(outRow, aI, -drdux, -drduy);
      addGrad(outRow, bI,  drdux,  drduy);
      addGrad(outRow, cI, -drdvx, -drdvy);
      addGrad(outRow, dI,  drdvx,  drdvy);
    }
  },

  // Symmetric (task 563, #core/symmetric.js): params.joints = [s1, s2 (the symmetry line), the nPairs mirrored pairs p, q (mirrorPair*: 2 rows
  // each), then the points-on-a-mirrored-line q, a1, a2 (mirrorOnLine*: 1 row each, task 572)] from engine.js; the circle form adds
  // params.terms = [size 1, size 2] and one row size 1 - size 2 (radii equal). 2 rows for points, 2 for lines (one per end of the second
  // line), 3 for circles / arcs (centres + radius).
  symmetric: {
    rows: (c, shapes) => symmetricRowCount(c, shapes),
    computeError: (params, positions) => {
      const j = params.joints || [], pairEnd = 2 + 2 * (params.nPairs || 0);
      const out = [];
      for (let k = 2; k + 1 < pairEnd; k += 2) out.push(...mirrorPairError(positions, j[0], j[1], j[k], j[k + 1]));
      for (let k = pairEnd; k + 2 < j.length; k += 3) out.push(mirrorOnLineError(positions, j[0], j[1], j[k], j[k + 1], j[k + 2]));
      if (params.terms) out.push(sizeValue(params.terms[0], positions) - sizeValue(params.terms[1], positions));
      return out;
    },
    computeJacobian: (params, positions, outRows) => {
      const j = params.joints || [], pairEnd = 2 + 2 * (params.nPairs || 0);
      let r = 0;
      for (let k = 2; k + 1 < pairEnd; k += 2, r += 2) mirrorPairGrad(positions, j[0], j[1], j[k], j[k + 1], outRows[r], outRows[r + 1]);
      for (let k = pairEnd; k + 2 < j.length; k += 3, r += 1) mirrorOnLineGrad(positions, j[0], j[1], j[k], j[k + 1], j[k + 2], outRows[r]);
      if (params.terms) { addSizeGrad(outRows[r], params.terms[0], 1, positions); addSizeGrad(outRows[r], params.terms[1], -1, positions); }
    }
  },

  // Offset (task 650, #core/offset.js): params.offsetRows = the stored constraint's rows (offsetOperands) with dense joint indices and, for a
  // radius, the radius operand { at, radius, rim, centre } (engine.js); params.value = the distance d, or params.dAt when the distance
  // is a free scalar unknown (dimensioned === false). The VALUES come from the one formula,
  // #core/offset.js offsetRowValues (the verifier reads the same); the derivatives are here, every operand taking part (a free source moves too).
  offset: {
    rows: (c, shapes) => offsetRowCount(c, shapes),
    scalarUnknown: (c, shapes) => !!c && c.dimensioned === false && offsetRowCount(c, shapes) > 0,
    validScalar: (v) => Number.isFinite(v) && v > 0,
    computeError: (params, positions) => offsetRowValues(params.offsetRows || [],
      params.dAt !== undefined ? positions[params.dAt] : (Number(params.value) || 0),
      (i) => ({ x: positions[i*2], y: positions[i*2+1] }), (o) => radiusValue(positions, o.at, o.radius, o.rim, o.centre)),
    computeJacobian: (params, positions, outRows) => {
      const X = (i) => positions[i*2], Y = (i) => positions[i*2+1];
      const dCol = params.dAt;
      let k = 0;
      for (const r of (params.offsetRows || [])) {
        if (r.k === 'cen') {
          addGrad(outRows[k], r.a, 1, 0); addGrad(outRows[k], r.b, -1, 0);
          addGrad(outRows[k + 1], r.a, 0, 1); addGrad(outRows[k + 1], r.b, 0, -1);
          k += 2; continue;
        }
        const row = outRows[k++];
        if (r.k === 'rad') {
          addRadiusDerivative(row, positions, 1, r.off.at, r.off.rim, r.off.centre);
          addRadiusDerivative(row, positions, -1, r.src.at, r.src.rim, r.src.centre);
          if (dCol !== undefined) row[dCol] += -r.sign;
        } else if (r.k === 'nl') {
          // (q - a) x u / |u|, u = b - a: point_on_line's full derivative
          const ux = X(r.b) - X(r.a), uy = Y(r.b) - Y(r.a), wx = X(r.q) - X(r.a), wy = Y(r.q) - Y(r.a), lu = Math.hypot(ux, uy) || 1e-12;
          const f = (wx * uy - wy * ux) / lu, dd = (dux, duy) => (dux * ux + duy * uy) / lu;
          addGrad(row, r.q, uy / lu, -ux / lu);
          addGrad(row, r.a, ((-uy + wy) - f * dd(-1, 0)) / lu, ((-wx + ux) - f * dd(0, -1)) / lu);
          addGrad(row, r.b, ((-wy) - f * dd(1, 0)) / lu, ((wx) - f * dd(0, 1)) / lu);
          if (dCol !== undefined) row[dCol] += -r.sign;
        } else if (r.k === 'tl') {
          // w . u / |u|, w = q - p, u = b - a:  d/dw = u / |u|,  d/du = w / |u| - (w . u) u / |u|^3
          const ux = X(r.b) - X(r.a), uy = Y(r.b) - Y(r.a), wx = X(r.q) - X(r.p), wy = Y(r.q) - Y(r.p), lu = Math.hypot(ux, uy) || 1e-12;
          const wu = wx * ux + wy * uy, lu3 = lu * lu * lu;
          const gux = wx / lu - wu * ux / lu3, guy = wy / lu - wu * uy / lu3;
          addGrad(row, r.q, ux / lu, uy / lu); addGrad(row, r.p, -ux / lu, -uy / lu);
          addGrad(row, r.a, -gux, -guy); addGrad(row, r.b, gux, guy);
        } else if (r.k === 'na') {
          // |q - c| - R(src) - sign d
          const dx = X(r.q) - X(r.c), dy = Y(r.q) - Y(r.c), l = Math.hypot(dx, dy) || 1e-12;
          addGrad(row, r.q, dx / l, dy / l); addGrad(row, r.c, -dx / l, -dy / l);
          addRadiusDerivative(row, positions, -1, r.src.at, r.src.rim, r.src.centre);
          if (dCol !== undefined) row[dCol] += -r.sign;
        } else if (r.k === 'ta') {
          // |B| th, th = atan2(A x B, A . B) (q on the RAY c -> p, task 654), A = p - c, B = q - c:
          //   d th/dB = (-By, Bx) / |B|^2,  d th/dA = (Ay, -Ax) / |A|^2  ->  d/dB = th B / |B| + (-By, Bx) / |B|,  d/dA = |B| (Ay, -Ax) / |A|^2
          const ax = X(r.p) - X(r.c), ay = Y(r.p) - Y(r.c), bx = X(r.q) - X(r.c), by = Y(r.q) - Y(r.c);
          const la2 = (ax * ax + ay * ay) || 1e-24, lb = Math.hypot(bx, by) || 1e-12, th = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
          const gax = lb * ay / la2, gay = -lb * ax / la2, gbx = (th * bx - by) / lb, gby = (th * by + bx) / lb;
          addGrad(row, r.p, gax, gay); addGrad(row, r.q, gbx, gby); addGrad(row, r.c, -gax - gbx, -gay - gby);
        } else if (r.k === 'rl') {
          // |W| th, th = atan2(U x W, U . W) (q on the RAY from p along a -> b, task 656), U = b - a, W = q - p: the 'ta' derivative with A = U,
          // B = W:  d/dW = th W / |W| + (-Wy, Wx) / |W|,  d/dU = |W| (Uy, -Ux) / |U|^2
          const ux = X(r.b) - X(r.a), uy = Y(r.b) - Y(r.a), wx = X(r.q) - X(r.p), wy = Y(r.q) - Y(r.p);
          const lu2 = (ux * ux + uy * uy) || 1e-24, lw = Math.hypot(wx, wy) || 1e-12, th = Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy);
          const gux = lw * uy / lu2, guy = -lw * ux / lu2, gwx = (th * wx - wy) / lw, gwy = (th * wy + wx) / lw;
          addGrad(row, r.q, gwx, gwy); addGrad(row, r.p, -gwx, -gwy); addGrad(row, r.b, gux, guy); addGrad(row, r.a, -gux, -guy);
        }
      }
    }
  },

  // Circular / rectangular pattern (task 658, #core/pattern.js): params.patternOps = the stored pattern's rows (patternOperands) with dense
  // indices (engine.js). The VALUES come from the one formula, #core/pattern.js patternRowValues (the verifier reads the same); the derivatives
  // are here (patternJacobian), every operand taking part (a free source, the centre and a direction line move too).
  circularPattern: { rows: (c, shapes) => patternRowCount(c, shapes), computeError: (p, x) => patternError(p, x), computeJacobian: (p, x, out) => patternJacobian(p, x, out) },
  rectangularPattern: { rows: (c, shapes) => patternRowCount(c, shapes), computeError: (p, x) => patternError(p, x), computeJacobian: (p, x, out) => patternJacobian(p, x, out) },

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
  // A rim point depends on the cursor's ray (rimDir): projecting rank-1 pulls onto f.dir keeps tangential flings on fixed-end arcs bounded.
  projectRank1: true,
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
