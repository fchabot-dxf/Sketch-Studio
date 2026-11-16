// tests/offset-negative-radius-654.test.js - TASK 654 (fillet audit F24): an edit that would need a NEGATIVE offset arc radius is refused.
// Fusion (advisor-verified): an offset chain stays tied to its source by one OffsetConstraint, the offset arc radius = source R -/+ d, and an edit
// that would need a negative radius cannot solve.
//   1. an L, its corner filleted R 8, offset INSIDE by 5 (offset arc R 3); the fillet's radius typed 4 (4 - 5 = -1): refused through the UI's
//      path (previewDimensionInput -> applyParameterChange): the fillet stays R 8, the offset arc stays R 3 on the inside, no undo step.
//   2. valid edits: fillet R 8 -> 12 gives an offset arc R 7 inside; an OUTSIDE offset of 5 with R 8 -> 4 gives R 9. One undo step each; undo /
//      redo give exactly the drawing before / after.
//   3. not a fillet case (the cause is any offset arc): a plain arc offset inward past its radius, by its own radius edit and by the offset
//      distance edit; a line + tangent arc (the Fusion chain) and an arc + tangent arc with the distance pushed past the arc's radius; an
//      arc + arc fillet (arc -> arc tangent joins) whose radius is typed below the offset distance.
// Headless: tests/harness/audit/lib.js (the real sketch state, engine and constraint paths the tools use).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { offsetChainOf, offsetChainGeometry, applyOffset, offsetSideAt } from '#core/offset.js';
import { findCornerAtJoint, applyFillet } from '#core/fillet.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { ConstraintManager } from '#core/constraint-manager.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const shape = (S, id) => S.state.shapes.find((s) => s.id === id);
const P = (S, id) => S.state.joints.get(id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// both rim radii of an arc
const radii = (S, id) => { const s = shape(S, id), c = P(S, s.joints[0]); return [dist(P(S, s.joints[1]), c), dist(P(S, s.joints[2]), c)]; };
// the whole drawing, exactly: every joint, every shape's joints, every constraint's value
const image = (S) => JSON.stringify({
  joints: [...S.state.joints].map(([id, j]) => [id, j.x, j.y]),
  shapes: S.state.shapes.map((s) => [s.id, s.type, s.joints, s.radius]),
  values: S.state.constraints.map((c) => [c.type, c.value]),
});
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
  return res;
};
const offsetArcOf = (S, res) => res.shapes.find((id) => shape(S, id).type === 'arc');
// the offset arc's ends sit on the source arc's normals at distance d, on the side `inside` (between the centre and the source rim) or outside
const onSide = (S, srcArc, offArc, d, inside, label) => {
  const s = shape(S, srcArc), o = shape(S, offArc), C = P(S, s.joints[0]);
  near(dist(P(S, o.joints[0]), C), 0, `${label}: the offset arc keeps the centre`);
  for (const k of [1, 2]) {
    const T = P(S, s.joints[k]), Q = P(S, o.joints[k]), R = dist(T, C);
    near(dist(Q, T), d, `${label}: offset end ${k} is ${d} from the source end`);
    near(dist(Q, C), inside ? R - d : R + d, `${label}: offset end ${k} on the ${inside ? 'inside' : 'outside'} (R ${R} ${inside ? '-' : '+'} ${d})`);
  }
};

// an L of two lines (the line tool's polyline: coincident corner), its corner filleted R 8
function filletedL() {
  const S = L.newSketch();
  const segs = L.polyline(S, [[0, 40], [0, 0], [50, 0]], false);
  const f = L.fillet(S, segs[0].id, segs[1].id, 8);
  S.engine.solve(L.ITER);
  const dim = S.state.constraints.find((c) => c.isRadius && c.shape === f.arc);
  ok(dim && radii(S, f.arc).every((r) => Math.abs(r - 8) < 1e-9), 'the fillet is R 8 with its radius dimension');
  return { S, segs, f, dim };
}

// ---------------------------------------------------------------- 1 + 2. inside 5: R 8 -> 4 refused; R 8 -> 12 accepted (R 7); undo / redo
{
  const { S, segs, f, dim } = filletedL();
  const res = offsetOf(S, segs[0].id, 5, { x: 20, y: 20 });
  const oa = offsetArcOf(S, res);
  onSide(S, f.arc, oa, 5, true, 'inside 5 as made');
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, dim, '4');
  ok(r.reverted === true, `fillet R 8 -> 4 under an inside offset of 5 (R 4 - 5 < 0): refused (${JSON.stringify(r)})`);
  ok(/conflicts with/.test(r.clash ? `conflicts with ${r.clash}` : r.reason || ''), `the refusal says why, through the dimension edit's own path (${r.reason || r.clash})`);
  ok(dim.value === 8, `the radius dimension keeps 8 (${dim.value})`);
  radii(S, f.arc).forEach((v) => near(v, 8, 'the fillet stays R 8'));
  radii(S, oa).forEach((v) => near(v, 3, 'the offset arc stays R 3'));
  onSide(S, f.arc, oa, 5, true, 'after the refusal');
  ok(image(S) === before, 'the refused edit leaves the drawing exactly as before');
  ok(S.state.history.length === h0, `no undo step for the refused edit (${h0} -> ${S.state.history.length})`);
  ok(L.residuals(S).max < 1e-6, `every constraint satisfied after the refusal (${L.residuals(S).max})`);

  const r2 = typeInto(S, dim, '12');
  ok(!r2.reverted, `fillet R 8 -> 12: accepted (${r2.reason || r2.clash})`);
  radii(S, f.arc).forEach((v) => near(v, 12, 'the fillet is R 12'));
  radii(S, oa).forEach((v) => near(v, 7, 'the offset arc is R 7 (12 - 5)'));
  onSide(S, f.arc, oa, 5, true, 'R 12');
  ok(S.state.history.length === h0 + 1, `ONE undo step for the accepted edit (${h0} -> ${S.state.history.length})`);
  const after = image(S);
  S.state.undo();
  ok(image(S) === before, 'undo: exactly the drawing before the accepted edit (fillet R 8, offset R 3)');
  S.state.redo();
  ok(image(S) === after, 'redo: exactly the drawing after it (fillet R 12, offset R 7)');
  S.state.undo();
  ok(image(S) === before && S.state.history.length === h0, 'undo again: back to before, the history as it was');
}

// ---------------------------------------------------------------- 2. outside 5: R 8 -> 4 accepted, offset arc R 9
{
  const { S, segs, f, dim } = filletedL();
  const res = offsetOf(S, segs[0].id, 5, { x: -20, y: -20 });
  const oa = offsetArcOf(S, res);
  onSide(S, f.arc, oa, 5, false, 'outside 5 as made');
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, dim, '4');
  ok(!r.reverted, `outside: fillet R 8 -> 4 accepted (${r.reason || r.clash})`);
  radii(S, f.arc).forEach((v) => near(v, 4, 'outside: the fillet is R 4'));
  radii(S, oa).forEach((v) => near(v, 9, 'outside: the offset arc is R 9 (4 + 5)'));
  onSide(S, f.arc, oa, 5, false, 'outside R 4');
  ok(S.state.history.length === h0 + 1, 'outside: ONE undo step');
  const after = image(S);
  S.state.undo(); ok(image(S) === before, 'outside: undo gives the drawing before');
  S.state.redo(); ok(image(S) === after, 'outside: redo gives the drawing after');
}

// ---------------------------------------------------------------- 3. not a fillet: plain arcs
// a plain arc R 8 (centre (0, 0), (8, 0) counter-clockwise to (0, 8)) with its radius dimension, offset inward by 5 (R 3)
function plainArc() {
  const S = L.newSketch();
  const c = L.point(S, 0, 0), a = L.point(S, 8, 0), b = L.point(S, 0, 8);
  const arc = L.arc(S, c, a, b); shape(S, arc).sweep = true;
  const dim = ConstraintManager.createConstraint(S.state, 'distance', { shape: arc, value: 8, isRadius: true }, { source: 'test' });
  S.engine.solve(L.ITER);
  const res = offsetOf(S, arc, 5, { x: 2, y: 2 });
  const oa = offsetArcOf(S, res);
  onSide(S, arc, oa, 5, true, 'plain arc inward 5');
  return { S, arc, dim, res, oa };
}
{
  const { S, arc, dim, oa } = plainArc();
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, dim, '4');
  ok(r.reverted === true, `plain arc R 8 -> 4 under an inward offset of 5: refused (${JSON.stringify(r)})`);
  radii(S, arc).forEach((v) => near(v, 8, 'plain arc: stays R 8')); radii(S, oa).forEach((v) => near(v, 3, 'plain arc: the offset stays R 3'));
  ok(image(S) === before && S.state.history.length === h0, 'plain arc: the drawing and the history unchanged');
}
{
  const { S, arc, res, oa } = plainArc();
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, res.constraint, '10');
  ok(r.reverted === true, `plain arc R 8: the offset distance 5 -> 10 (inward past the radius): refused (${JSON.stringify(r)})`);
  radii(S, oa).forEach((v) => near(v, 3, 'plain arc: the offset stays R 3'));
  onSide(S, arc, oa, 5, true, 'plain arc after the refused distance');
  ok(image(S) === before && S.state.history.length === h0, 'plain arc distance: the drawing and the history unchanged');
}
// the Fusion chain: a 40 mm line, a 30 mm line and an R10 quarter arc TANGENT to it, offset 5 inward (R 5); the distance 5 -> 12 (R 10 - 12 < 0)
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 40, 0), c = L.point(S, 40, 30), ac = L.point(S, 30, 30), e = L.point(S, 30, 40);
  L.line(S, a, b); const l2 = L.line(S, b, c);
  const arc = L.arc(S, ac, c, e); shape(S, arc).sweep = true;
  const res = offsetOf(S, l2, 5, { x: 20, y: 10 });
  ok(JSON.stringify(res.constraint.joins) === '["corner","tangent"]', `line -> arc tangent join (${res.constraint.joins})`);
  const oa = offsetArcOf(S, res);
  onSide(S, arc, oa, 5, true, 'line + tangent arc inward 5');
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, res.constraint, '12');
  ok(r.reverted === true, `line + tangent arc R 10: the distance 5 -> 12: refused (${JSON.stringify(r)}; offset arc now ${radii(S, oa).map((v) => v.toFixed(4))})`);
  ok(image(S) === before && S.state.history.length === h0, 'line + tangent arc: the drawing and the history unchanged');
  const r2 = typeInto(S, res.constraint, '8');
  ok(!r2.reverted, `line + tangent arc: the distance 5 -> 8 accepted (${r2.reason || r2.clash})`);
  radii(S, oa).forEach((v) => near(v, 2, 'line + tangent arc: d 8 -> R 2'));
  onSide(S, arc, oa, 8, true, 'line + tangent arc d 8');
}
// an arc R 20 then an arc R 8 TANGENT to it, both turning the same way (centres (0, -20) and (0, -8), the joint (0, 0)), inward 5 (R 15, R 3);
// the distance 5 -> 9 (R 8 - 9 < 0 on the second arc, whose radius only reaches it through the tangent join)
{
  const S = L.newSketch();
  const c1 = L.point(S, 0, -20), s1 = L.point(S, -20, -20), p = L.point(S, 0, 0), c2 = L.point(S, 0, -8), e2 = L.point(S, 8, -8);
  const a1 = L.arc(S, c1, p, s1); shape(S, a1).sweep = true;
  const a2 = L.arc(S, c2, e2, p); shape(S, a2).sweep = true;
  const res = offsetOf(S, a2, 5, { x: 2, y: -6 });
  ok(JSON.stringify(res.constraint.joins) === '["tangent"]', `arc -> arc tangent join (${res.constraint.joins})`);
  const [o2, o1] = res.shapes; // chain order: a2 then a1
  radii(S, o2).forEach((v) => near(v, 3, 'arc + arc: the R 8 arc offset to R 3'));
  radii(S, o1).forEach((v) => near(v, 15, 'arc + arc: the R 20 arc offset to R 15'));
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, res.constraint, '9');
  ok(r.reverted === true, `arc + tangent arc: the distance 5 -> 9 (past R 8): refused (${JSON.stringify(r)}; offsets now ${radii(S, o2).map((v) => v.toFixed(4))} / ${radii(S, o1).map((v) => v.toFixed(4))})`);
  ok(image(S) === before && S.state.history.length === h0, 'arc + tangent arc: the drawing and the history unchanged');
  const r2 = typeInto(S, res.constraint, '7');
  ok(!r2.reverted, `arc + tangent arc: the distance 5 -> 7 accepted (${r2.reason || r2.clash})`);
  radii(S, o2).forEach((v) => near(v, 1, 'arc + arc: d 7 -> R 1')); radii(S, o1).forEach((v) => near(v, 13, 'arc + arc: d 7 -> R 13'));
}

// two ARCS filleted R 5 (the fillet arc tangent to an arc at both ends: two arc -> arc tangent joins), the chain offset 3 to the fillet's
// centre side (fillet offset R 2); the fillet radius typed 1.5 (1.5 - 3 < 0): refused; typed 8: accepted (R 5)
{
  const S = L.newSketch();
  const p = L.point(S, 0, 0);
  const c1 = L.point(S, -30, 0), e1 = L.point(S, -30, 30); L.arc(S, c1, p, e1);
  const c2 = L.point(S, 20, -20), e2 = L.point(S, 20 + Math.hypot(20, 20), -20); L.arc(S, c2, e2, p);
  S.engine.solve(L.ITER);
  const fl = applyFillet(S.state, findCornerAtJoint(S.state, p), 5);
  ok(fl.success, `arc + arc: filleted R 5 (${fl.reason})`);
  S.engine.solve(L.ITER);
  const ch = offsetChainOf(S.state, fl.arc.id);
  ok(ch.ok && JSON.stringify(ch.chain.joins) === '["tangent","tangent"]', `arc + arc fillet: arc, fillet, arc with two tangent joins (${ch.reason || ch.chain.joins})`);
  const k = ch.chain.pieces.findIndex((q) => q.id === fl.arc.id);
  const side = [1, -1].find((sd) => { const g = offsetChainGeometry(S.state, ch.chain, 3, sd); return g.ok && g.pieces[k].r < 5; });
  const res = applyOffset(S.state, ch.chain, 3, side);
  ok(res.ok, `arc + arc fillet: offset 3 toward the fillet's centre (${res.reason})`);
  S.engine.solve(L.ITER);
  const fo = res.shapes[k];
  radii(S, fo).forEach((v) => near(v, 2, 'arc + arc fillet: the fillet offset R 2'));
  const dim = S.state.constraints.find((c) => c.isRadius && c.shape === fl.arc.id);
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, dim, '1.5');
  ok(r.reverted === true, `arc + arc fillet R 5 -> 1.5 under an offset of 3 toward its centre: refused (${JSON.stringify(r)}; its offset now ${radii(S, fo).map((v) => v.toFixed(4))})`);
  ok(image(S) === before && S.state.history.length === h0, 'arc + arc fillet: the drawing and the history unchanged');
  const r2 = typeInto(S, dim, '8');
  ok(!r2.reverted, `arc + arc fillet R 5 -> 8: accepted (${r2.reason || r2.clash})`);
  radii(S, fo).forEach((v) => near(v, 5, 'arc + arc fillet R 8: its offset R 5 (the arc + arc fillet solves to ~1e-5, as on main: audit F21)', 1e-4));
}

console.log(`offset-negative-radius-654: ${checks} checks passed`);
