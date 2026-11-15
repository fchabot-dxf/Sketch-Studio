// tests/offset-line-reverse-656.test.js - TASK 656: an edit that would turn an offset LINE inside out is refused (the line twin of task 654).
// Fusion (advisor-verified): the offset is the source -/+ d; an edit that needs a reversed offset piece cannot solve.
//   1. a 60 x 40 rectangle (width and height dimensions), offset 15 INSIDE (a 30 x 10 inner rectangle); the height typed 20 (20 - 30 = -10):
//      refused through the UI's path (previewDimensionInput -> applyParameterChange): the height stays 40, the drawing exactly as before, no undo
//      step, one reason.
//   3. valid edits: height 40 -> 60 gives a 30 x 30 inner rectangle; an OUTSIDE offset of 15 with height 40 -> 20 gives 90 x 50.
//   4. one undo step per accepted edit; undo / redo give exactly the drawing before / after.
//   2. the shared collapse refusal text reads "would collapse an arc to a point" (it read "a arc").
//   5. not a rectangle case: an open L (H + V legs) offset inside 15, a leg shortened below 15: refused, a leg shortened to 20 accepted; a line +
//      arc chain meeting at a CORNER, the line shortened below what the corner eats: refused, a valid length accepted.
//   Every chain: the offset pieces keep their direction (no inversion) after every accepted edit; with the sources held the offset has 0 DOF and
//   exactly as many rows as unknowns (the row count is unchanged).
// Headless: tests/harness/audit/lib.js (the real sketch state, engine and constraint paths the tools use).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { offsetChainOf, applyOffset, offsetSideAt, offsetRowCount } from '#core/offset.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#ui/dimension-seams.js';
import { ConstraintManager } from '#core/constraint-manager.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const shape = (S, id) => S.state.shapes.find((s) => s.id === id);
const P = (S, id) => S.state.joints.get(id);
const len = (S, id) => { const s = shape(S, id), a = P(S, s.joints[0]), b = P(S, s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };
const image = (S) => JSON.stringify({
  joints: [...S.state.joints].map(([id, j]) => [id, j.x, j.y]),
  shapes: S.state.shapes.map((s) => [s.id, s.type, s.joints, s.radius]),
  values: S.state.constraints.map((c) => [c.type, c.value]),
});
const dim = (S, a, b, value, dimMode) => ConstraintManager.createConstraint(S.state, 'distance', { joints: [a, b], value, dimMode }, { source: 'dimension' });
const C = (S, type, params) => ConstraintManager.createConstraint(S.state, type, params, { source: 'test' });
// the dimension box: type `text` on dimension c, Enter (numeric-input-manager handleCommit's path)
const typeInto = (S, c, text) => {
  const pv = previewDimensionInput(S.state, c, text, { unit: 'mm' });
  ok(pv.ok, `"${text}" parses (${pv.message || ''})`);
  return applyParameterChange(S.state, pv.plan, 'edit dimension', { snapshot: true });
};
const offsetOf = (S, pick, d, toward) => {
  const ch = offsetChainOf(S.state, pick);
  ok(ch.ok, `the chain is found (${ch.reason})`);
  const res = applyOffset(S.state, ch.chain, d, offsetSideAt(S.state, ch.chain, toward));
  ok(res.ok, `offset ${d} applied (${res.reason})`);
  S.engine.solve(L.ITER);
  ok(L.residuals(S).max < 1e-6, `every constraint holds after the offset (${L.residuals(S).max})`);
  return { ...res, chain: ch.chain };
};
// every offset LINE runs the same way as its source (in the chain direction) and is longer than zero: no piece turned inside out
const noInversion = (S, res, label) => {
  const c = res.constraint;
  for (let k = 0; k < c.shapes.length / 2; k++) {
    const src = shape(S, c.shapes[2 * k]), off = shape(S, c.shapes[2 * k + 1]);
    if (src.type !== 'line') continue;
    const [a, b] = c.rev[k] ? [src.joints[1], src.joints[0]] : src.joints;
    const ux = P(S, b).x - P(S, a).x, uy = P(S, b).y - P(S, a).y;
    const along = ((P(S, off.joints[1]).x - P(S, off.joints[0]).x) * ux + (P(S, off.joints[1]).y - P(S, off.joints[0]).y) * uy) / Math.hypot(ux, uy);
    ok(along > 1e-3, `${label}: offset line ${k} runs the way its source does (${along.toFixed(6)} along it)`);
  }
};
// sources held -> the offset pieces have 0 DOF and exactly as many rows as unknowns (2 per offset joint; an arc's equal is one of them)
const zeroDof = (S, res, label) => {
  const src = res.chain.pieces.map((p) => shape(S, p.id));
  const was = new Map();
  for (const s of src) for (const j of s.joints) { was.set(j, P(S, j).fixed); P(S, j).fixed = true; }
  const f = S.engine.jointFreedom();
  const free = res.joints.filter((j) => (f.freedom.get(j) || 0) > 0);
  ok(free.length === 0 && f.nullity === 0, `${label}: sources held -> the offset is fully defined (free ${free}, nullity ${f.nullity})`);
  const fd = L.fdJacobian(S);
  ok(fd.worst.length === 0, `${label}: analytic Jacobian = finite differences (${JSON.stringify(fd.worst)})`);
  for (const [j, v] of was) P(S, j).fixed = v;
  const arcs = res.shapes.filter((id) => shape(S, id).type === 'arc').length;
  ok(offsetRowCount(res.constraint, S.state.shapes) + arcs === 2 * res.joints.length,
    `${label}: rows ${offsetRowCount(res.constraint, S.state.shapes)} + ${arcs} arc equal(s) = 2 x ${res.joints.length} offset joints`);
};
// a refused edit: the value reverts, the drawing is exactly as before, no undo step, one reason
const refused = (S, c, text, label) => {
  const before = image(S), h0 = S.state.history.length, v0 = c.value;
  const r = typeInto(S, c, text);
  ok(r.ok === false && r.reverted === true, `${label}: ${v0} -> ${text} refused (${JSON.stringify(r)})`);
  const why = r.reason || (r.clash ? `conflicts with ${r.clash}` : '');
  ok(why.length > 0, `${label}: the refusal gives one reason ("${why}")`);
  console.log(`${label}: refused: "${why}"`);
  ok(c.value === v0, `${label}: the dimension keeps ${v0} (${c.value})`);
  ok(image(S) === before, `${label}: the drawing is exactly as before`);
  ok(S.state.history.length === h0, `${label}: no undo step (${h0} -> ${S.state.history.length})`);
  ok(L.residuals(S).max < 1e-6, `${label}: every constraint satisfied after the refusal (${L.residuals(S).max})`);
  return why;
};
// an accepted edit: one undo step; undo / redo exact
const accepted = (S, c, text, label, check) => {
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, c, text);
  ok(r.ok === true, `${label}: -> ${text} accepted (${JSON.stringify(r)})`);
  ok(L.residuals(S).max < 1e-6, `${label}: every constraint holds (${L.residuals(S).max})`);
  check();
  ok(S.state.history.length === h0 + 1, `${label}: ONE undo step (${h0} -> ${S.state.history.length})`);
  const after = image(S);
  S.state.undo(); ok(image(S) === before, `${label}: undo gives exactly the drawing before`);
  S.state.redo(); ok(image(S) === after, `${label}: redo gives exactly the drawing after`);
  S.state.undo(); ok(image(S) === before && S.state.history.length === h0, `${label}: undo again: back to before, the history as it was`);
  S.state.redo();
};

// ---------------------------------------------------------------- 1 / 3 / 4. the rectangle
function rectangle(d, inside) {
  const S = L.newSketch();
  const R = L.rect(S, 0, 0, 60, 40);
  const t = shape(S, R.top), r = shape(S, R.right);
  const w = dim(S, t.joints[0], t.joints[1], 60, 'horizontal'), h = dim(S, r.joints[0], r.joints[1], 40, 'vertical');
  S.engine.solve(L.ITER);
  near(len(S, R.right), 40, 'the rectangle is 40 high'); near(len(S, R.top), 60, 'and 60 wide');
  const res = offsetOf(S, R.top, d, inside ? { x: 30, y: 20 } : { x: 30, y: -50 });
  return { S, R, w, h, res };
}
const sides = (S, res) => res.shapes.map((id) => len(S, id)).sort((a, b) => a - b);
{
  const { S, R, h, res } = rectangle(15, true);
  const s0 = sides(S, res);
  [10, 10, 30, 30].forEach((v, i) => near(s0[i], v, 'inside 15 as made: a 30 x 10 inner rectangle'));
  noInversion(S, res, 'inside 15 as made');
  zeroDof(S, res, 'rectangle inside 15');
  const why = refused(S, h, '20', 'rectangle inside 15, height 40 -> 20 (inner 20 - 30 = -10)');
  near(len(S, R.right), 40, 'after the refusal: the rectangle is still 40 high');
  sides(S, res).forEach((v, i) => near(v, s0[i], 'after the refusal: the inner rectangle is still 30 x 10'));
  noInversion(S, res, 'after the refusal');
  ok(!/ a arc/.test(why), `the reason reads well ("${why}")`);
  refused(S, h, '29', 'rectangle inside 15, height 40 -> 29 (inner -1)');
  accepted(S, h, '60', 'rectangle inside 15, height 40 -> 60', () => {
    near(len(S, R.right), 60, 'height 60');
    const s = sides(S, res); [30, 30, 30, 30].forEach((v, i) => near(s[i], v, 'height 60: a 30 x 30 inner rectangle'));
    noInversion(S, res, 'height 60');
  });
}
{
  const { S, R, h, res } = rectangle(15, false);
  const s0 = sides(S, res);
  [70, 70, 90, 90].forEach((v, i) => near(s0[i], v, 'outside 15 as made: a 90 x 70 rectangle'));
  zeroDof(S, res, 'rectangle outside 15');
  accepted(S, h, '20', 'rectangle outside 15, height 40 -> 20', () => {
    near(len(S, R.right), 20, 'height 20');
    const s = sides(S, res); [50, 50, 90, 90].forEach((v, i) => near(s[i], v, 'outside, height 20: a 90 x 50 rectangle'));
    noInversion(S, res, 'outside, height 20');
  });
}

// ---------------------------------------------------------------- 5. an open L (vertical leg 40, horizontal leg 50), offset inside 15
{
  const S = L.newSketch();
  const segs = L.polyline(S, [[0, 40], [0, 0], [50, 0]], false);
  C(S, 'vertical', { joints: [segs[0].a, segs[0].b] }); C(S, 'horizontal', { joints: [segs[1].a, segs[1].b] });
  const v = dim(S, segs[0].a, segs[0].b, 40, 'vertical'), hd = dim(S, segs[1].a, segs[1].b, 50, 'horizontal');
  S.engine.solve(L.ITER);
  const res = offsetOf(S, segs[0].id, 15, { x: 20, y: 20 });
  const lens0 = res.shapes.map((id) => len(S, id));
  near(lens0[0], 25, 'L inside 15: the vertical offset leg is 40 - 15'); near(lens0[1], 35, 'L inside 15: the horizontal offset leg is 50 - 15');
  noInversion(S, res, 'L as made');
  zeroDof(S, res, 'L inside 15');
  refused(S, v, '10', 'L inside 15, vertical leg 40 -> 10 (offset leg 10 - 15 = -5)');
  refused(S, hd, '12', 'L inside 15, horizontal leg 50 -> 12 (offset leg 12 - 15 = -3)');
  noInversion(S, res, 'L after the refusals');
  accepted(S, v, '20', 'L inside 15, vertical leg 40 -> 20', () => {
    near(len(S, segs[0].id), 20, 'the vertical leg is 20');
    near(len(S, res.shapes[0]), 5, 'its offset leg is 20 - 15'); near(len(S, res.shapes[1]), 35, 'the horizontal offset leg stays 35');
    noInversion(S, res, 'L, leg 20');
  });
}

// ---------------------------------------------------------------- 5. a line + arc chain meeting at a CORNER
// line (0, 0) -> (30, 0) (horizontal, length dimension 30), then an arc R 30 (radius dimension) about (60, 0) from (30, 0) up to (60, 30): the
// line meets the arc at 90 degrees. Offset 5 to the +y side: the line moves up to y = 5 and the arc grows to R 35; they meet at
// x = 60 - sqrt(35^2 - 5^2) = 25.359, so the offset line is 30 - 4.641 long. The line shortened to 3 would need an offset line of 3 - 4.641 < 0.
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 30, 0), c = L.point(S, 60, 0), e = L.point(S, 60, 30);
  const ln = L.line(S, a, b);
  const arc = L.arc(S, c, b, e); shape(S, arc).sweep = false;
  C(S, 'horizontal', { joints: [a, b] }); C(S, 'horizontal', { joints: [b, c] });
  const ld = dim(S, a, b, 30, 'horizontal');
  ConstraintManager.createConstraint(S.state, 'distance', { shape: arc, value: 30, isRadius: true }, { source: 'dimension' });
  S.engine.solve(L.ITER);
  ok(L.residuals(S).max < 1e-6, 'the line + arc chain holds');
  const res = offsetOf(S, ln, 5, { x: 15, y: 3 });
  const eat = 60 - Math.sqrt(35 * 35 - 25);
  const offLine = res.shapes.find((id) => shape(S, id).type === 'line'), offArc = res.shapes.find((id) => shape(S, id).type === 'arc');
  near(len(S, offLine), eat, 'line + arc: the offset line ends where it meets the R 35 offset arc');
  const oc = P(S, shape(S, offArc).joints[0]), o1 = P(S, shape(S, offArc).joints[1]);
  near(Math.hypot(o1.x - oc.x, o1.y - oc.y), 35, 'line + arc: the offset arc is R 35');
  noInversion(S, res, 'line + arc as made');
  zeroDof(S, res, 'line + arc');
  refused(S, ld, '3', `line + arc, line 30 -> 3 (offset line 3 - ${(30 - eat).toFixed(3)} < 0)`);
  noInversion(S, res, 'line + arc after the refusal');
  accepted(S, ld, '10', 'line + arc, line 30 -> 10', () => {
    near(len(S, ln), 10, 'the line is 10');
    near(len(S, offLine), 10 - (30 - eat), 'its offset line is 10 - 4.641');
    noInversion(S, res, 'line + arc, line 10');
  });
}

// ---------------------------------------------------------------- 2. the shared collapse text reads "an arc" (it read "a arc")
// two arcs R 10 tied equal, the first's radius typed 0.01: the second would shrink to a point (the typed arc itself is the user's own size)
{
  const S = L.newSketch();
  const A = L.arc(S, L.point(S, 0, 0), L.point(S, 10, 0), L.point(S, 0, 10)), B = L.arc(S, L.point(S, 50, 0), L.point(S, 60, 0), L.point(S, 50, 10));
  shape(S, A).sweep = true; shape(S, B).sweep = true;
  C(S, 'equal', { shapes: [A, B] });
  const rd = ConstraintManager.createConstraint(S.state, 'distance', { shape: A, value: 10, isRadius: true }, { source: 'dimension' });
  S.engine.solve(L.ITER);
  const why = refused(S, rd, '0.01', 'two equal arcs, the first R 10 -> 0.01');
  ok(why === '0.01 would collapse an arc to a point', `the collapse text reads "an arc" ("${why}")`);
}

console.log(`offset-line-reverse-656: ${checks} checks passed`);
