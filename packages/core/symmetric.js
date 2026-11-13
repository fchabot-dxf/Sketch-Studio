// packages/core/symmetric.js - task 563: the SYMMETRIC constraint (like Fusion's Symmetric: entity 1, entity 2, then the symmetry line).
// PURE (no DOM). THE one reader of a stored symmetric constraint: the solver rows (engine.js / definitions.js), the verifier, the creation
// placement, the renderer's glyphs and the tool all resolve it here.
//
// Stored forms (constants.js CONSTRAINT_TYPES.SYMMETRIC), `line` = the symmetry line (any sketch line, a construction line, or an axis
// ref_axis_x / ref_axis_y of #core/reference-lines.js):
//   points   { joints: [p, q], line }                    p and q mirror across the line
//   lines    { joints: [p1, q1, p2, q2], shapes: [l1, l2], line }
//                                                        each END PAIR (p_i of l1, q_i of l2) mirrors: the two segments are mirror images
//                                                        (equal length, mirrored ends), not only the infinite lines (see pairLineEnds)
//   circles  { shapes: [c1, c2], line }                  the centres mirror and the radii are equal (circles or arcs)
// Every form is ONE point-pair rule applied to its pairs (definitions.js mirrorPair*), plus the size equality of the circle form.
import { getCoincidentJoints } from './joints.js';

const isLine = (s) => !!s && s.type === 'line' && Array.isArray(s.joints) && s.joints.length >= 2;
const isCirc = (s) => !!s && (s.type === 'circle' || s.type === 'arc') && Array.isArray(s.joints) && s.joints.length >= 1;
const find = (shapes, id) => (shapes && id != null ? shapes.find(s => s && s.id === id) || null : null);

// The operands of a symmetric constraint: { form, line: [a, b] (the symmetry line's joint ids), pairs: [[p, q], ...] (joint ids that mirror),
// sizes: [shape1, shape2] | null (the circle form's radius equality) } or null when it cannot be resolved (a missing shape, a wrong kind).
export function symmetricOperands(c, shapes) {
  if (!c || !c.line) return null;
  const L = find(shapes, c.line);
  if (!isLine(L)) return null;
  const line = [L.joints[0], L.joints[1]];
  if (Array.isArray(c.shapes) && c.shapes.length === 2) {
    const s1 = find(shapes, c.shapes[0]), s2 = find(shapes, c.shapes[1]);
    if (isLine(s1) && isLine(s2)) {
      if (!Array.isArray(c.joints) || c.joints.length !== 4) return null;
      return { form: 'lines', line, pairs: [[c.joints[0], c.joints[1]], [c.joints[2], c.joints[3]]], sizes: null };
    }
    if (isCirc(s1) && isCirc(s2)) return { form: 'circles', line, pairs: [[s1.joints[0], s2.joints[0]]], sizes: [s1, s2] };
    return null;
  }
  if (Array.isArray(c.joints) && c.joints.length === 2) return { form: 'points', line, pairs: [[c.joints[0], c.joints[1]]], sizes: null };
  return null;
}

// Solver rows of a constraint: 2 per mirrored pair, + 1 for the radius equality (0 when unresolved).
export function symmetricRowCount(c, shapes) {
  const o = symmetricOperands(c, shapes);
  return o ? 2 * o.pairs.length + (o.sizes ? 1 : 0) : 0;
}

// The mirror image of the point X across the line through a and b (a degenerate line leaves X where it is).
export function mirrorPoint(X, a, b) {
  const ux = b.x - a.x, uy = b.y - a.y, l2 = ux * ux + uy * uy;
  if (!(l2 > 0)) return { x: X.x, y: X.y };
  const k = ((X.x - a.x) * ux + (X.y - a.y) * uy) / l2;
  const fx = a.x + k * ux, fy = a.y + k * uy;
  return { x: 2 * fx - X.x, y: 2 * fy - X.y };
}

// THE end pairing of the line form, fixed at creation: line 1's ends (a1, a2) and line 2's (b1, b2) pair straight (a1-b1, a2-b2) or crossed
// (a1-b2, a2-b1), whichever is nearer to mirror images now (the sum of |mirror(a_i) - b_j|), so the solve moves the least. Returns the
// stored joints [p1, q1, p2, q2], or null. A shared end (a V on the line) pairs with itself.
export function pairLineEnds(joints, shapes, l1Id, l2Id, lineId) {
  const l1 = find(shapes, l1Id), l2 = find(shapes, l2Id), L = find(shapes, lineId);
  if (!isLine(l1) || !isLine(l2) || !isLine(L)) return null;
  const P = (id) => joints.get(id);
  const [a1, a2] = l1.joints, [b1, b2] = l2.joints;
  const la = P(L.joints[0]), lb = P(L.joints[1]);
  if (![a1, a2, b1, b2].every(id => P(id)) || !la || !lb) return null;
  const gap = (a, b) => { const m = mirrorPoint(P(a), la, lb), q = P(b); return Math.hypot(m.x - q.x, m.y - q.y); };
  const straight = gap(a1, b1) + gap(a2, b2), crossed = gap(a1, b2) + gap(a2, b1);
  return crossed < straight ? [a1, b2, a2, b1] : [a1, b1, a2, b2];
}

// The residual the verifier reports (world units): the largest |q - mirror(p)| over the pairs, and the radius difference of the circle form.
// Exactly the solver rows' zero set: |q - mirror(p)| is the length of the two rows of the pair (definitions.js mirrorPair*).
export function symmetricResidual(c, joints, shapes, radiusOf) {
  const o = symmetricOperands(c, shapes);
  if (!o) return 0;
  const a = joints.get(o.line[0]), b = joints.get(o.line[1]);
  if (!a || !b) return 0;
  let worst = 0;
  for (const [p, q] of o.pairs) {
    const P = joints.get(p), Q = joints.get(q);
    if (!P || !Q) return 0;
    const m = mirrorPoint(P, a, b);
    worst = Math.max(worst, Math.hypot(Q.x - m.x, Q.y - m.y));
  }
  if (o.sizes) worst = Math.max(worst, Math.abs(radiusOf(o.sizes[0]) - radiusOf(o.sizes[1])));
  return worst;
}

// Why a symmetric constraint cannot exist at all, before any solve (ConstraintManager._mathPreCheck), or null. `fixed(id)` says whether a
// joint cannot move, `tol` the distance under which two points count as one. The two entities must be two different things of one family,
// and the symmetry line must not be one of them.
export function symmetricImpossible(c, joints, shapes, constraints, fixed, tol) {
  const o = symmetricOperands(c, shapes);
  if (!o) return 'pick two points, two lines or two circles / arcs, then a line';
  if (o.form === 'points') {
    const [p, q] = o.pairs[0];
    if (p === q || getCoincidentJoints(p, constraints).has(q)) return 'the two entities are the same point';
  } else if (c.shapes[0] === c.shapes[1]) return `the two entities are the same ${o.form === 'lines' ? 'line' : 'circle'}`;
  if (Array.isArray(c.shapes) && c.shapes.includes(c.line)) return 'the symmetry line cannot be one of the two entities';
  // everything fixed and not mirrored: nothing can move to satisfy it
  const all = [...o.line, ...o.pairs.flat()];
  if (!o.sizes && all.every(fixed)) {
    const a = joints.get(o.line[0]), b = joints.get(o.line[1]);
    if (o.pairs.some(([p, q]) => { const m = mirrorPoint(joints.get(p), a, b), Q = joints.get(q); return Math.hypot(Q.x - m.x, Q.y - m.y) > tol; })) return 'the points are fixed and not symmetric';
  }
  return null;
}
