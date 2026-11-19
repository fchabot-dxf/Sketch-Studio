// tests/offset-781-node.test.js - TASK 781: the offset of a CLOSED chain whose every join is TANGENT holds its distance d.
// Before: #core/offset.js offsetOperands gave such a chain (a rounded rectangle, a slot, arcs only) no row that reads d, so the copy was held only
// up to one uniform distance: a fully dimensioned rounded rectangle + offset had nullity 1 (rank deficient), editing the offset dimension 3 -> 5
// left the copy at 3, and a drag of the copy changed the real gap while the dimension still said 3.
//   1. rounded rectangle (60 x 40, fully dimensioned, 4 fillets R 5), offset 3 INSIDE and OUTSIDE: nullity 0 and not rank deficient after the
//      offset; the dimension typed (inside 3 -> 4, outside 3 -> 5) moves every piece to the new distance, one undo step, undo / redo exact; a drag
//      of each copy joint by (4, 4) keeps the gap (the joint stays put, it has 0 freedom); the analytic Jacobian = finite differences; the row
//      count is exact (rows + arc equals = 2 x offset joints).
//   2. a slot outline (2 lines + 2 arcs, all tangent) and a 4-arc oval (arcs only), sources held: the same checks (the oval has ONE redundant row:
//      rows + arc equals = 2 x offset joints + 1, the module header says why).
//   3. a lone circle: its offset already held d (the radius row): the edit and the drag, as a guard.
//   4. regression: a plain rectangle and an open L (corner joins) keep exactly the rows they had (no anchor), and the same edit / drag results.
//   5. an UNDIMENSIONED offset of the rounded rectangle (task 667, d a free scalar): one DOF (d), and a drag of the copy moves every piece by the
//      same distance (the free d follows), never a gap that differs from piece to piece.
// Headless: tests/harness/audit/lib.js (the real sketch state, engine and constraint paths the tools use).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import * as ops from '#core/tool-ops.js';
import { offsetChainOf, applyOffset, offsetSideAt, offsetRowCount, offsetOperands, undimensionOffset } from '#core/offset.js';
import { arcSweepInfo } from '#core/geometry.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const shape = (S, id) => S.state.shapes.find((s) => s.id === id);
const P = (S, id) => S.state.joints.get(id);
const image = (S) => JSON.stringify({
  joints: [...S.state.joints].map(([id, j]) => [id, j.x, j.y]),
  shapes: S.state.shapes.map((s) => [s.id, s.type, s.joints, s.radius]),
  values: S.state.constraints.map((c) => [c.type, c.value]),
});
const typeInto = (S, c, text) => {
  const pv = previewDimensionInput(S.state, c, text, { unit: 'mm' });
  ok(pv.ok, `"${text}" parses (${pv.message || ''})`);
  return applyParameterChange(S.state, pv.plan, 'edit dimension', { snapshot: true });
};
const radiusOf = (S, s) => (s.type === 'circle' ? s.radius : Math.hypot(P(S, s.joints[1]).x - P(S, s.joints[0]).x, P(S, s.joints[1]).y - P(S, s.joints[0]).y));
// THE real gap of every source -> copy pair: a line, the distance of both copy ends from the source line; an arc / circle, |R' - R| and the
// distance between the centres (0); an arc also its copy's other end radius (both ends on the copy circle).
function gaps(S, c) {
  const out = [];
  for (let k = 0; k < c.shapes.length / 2; k++) {
    const s = shape(S, c.shapes[2 * k]), o = shape(S, c.shapes[2 * k + 1]);
    if (s.type === 'line') {
      const a = P(S, s.joints[0]), b = P(S, s.joints[1]), l = Math.hypot(b.x - a.x, b.y - a.y);
      for (const j of o.joints) { const q = P(S, j); out.push({ k, kind: 'line end', d: Math.abs(((q.x - a.x) * (b.y - a.y) - (q.y - a.y) * (b.x - a.x)) / l) }); }
    } else {
      const C = P(S, s.joints[0]), Co = P(S, o.joints[0]);
      out.push({ k, kind: `${s.type} radius`, d: Math.abs(radiusOf(S, o) - radiusOf(S, s)) });
      out.push({ k, kind: 'centre shift', d: Math.hypot(Co.x - C.x, Co.y - C.y), zero: true });
      if (o.type === 'arc') out.push({ k, kind: 'arc end radius', d: Math.abs(Math.hypot(P(S, o.joints[2]).x - Co.x, P(S, o.joints[2]).y - Co.y) - radiusOf(S, s)) });
    }
  }
  return out;
}
const gapsAre = (S, c, d, label, tol = 1e-6) => {
  const g = gaps(S, c), bad = g.filter((x) => Math.abs(x.d - (x.zero ? 0 : d)) > tol);
  ok(bad.length === 0, `${label}: every source -> copy gap is ${d} (${JSON.stringify(bad.slice(0, 4))})`);
  return g;
};
const offsetOf = (S, pick, d, toward) => {
  const ch = offsetChainOf(S.state, pick);
  ok(ch.ok, `the chain is found (${ch.reason})`);
  const res = applyOffset(S.state, ch.chain, d, offsetSideAt(S.state, ch.chain, toward));
  ok(res.ok, `offset ${d} applied (${res.reason})`);
  const sol = S.engine.solve(L.ITER);
  ok(sol.converged && L.residuals(S).max < 1e-6, `every constraint holds after the offset (${L.residuals(S).max})`);
  return { ...res, chain: ch.chain, sol };
};
// sources as they are (held by their own dimensions, or `fixed` by the scenario): the offset adds 0 DOF, the solve is not rank deficient
const determined = (S, res, label, nullityBefore = 0) => {
  const n = L.nullity(S);
  ok(n === nullityBefore, `${label}: nullity ${nullityBefore} before the offset, ${n} after`);
  const f = S.engine.jointFreedom();
  const free = res.joints.filter((j) => (f.freedom.get(j) || 0) > 0);
  ok(free.length === 0, `${label}: every offset joint has 0 freedom (free: ${free})`);
  const sol = S.engine.solve(L.ITER);
  if (nullityBefore === 0) ok(sol.converged && sol.rankDeficient === false, `${label}: solve converged, not rank deficient (${JSON.stringify(sol)})`);
  const fd = L.fdJacobian(S);
  ok(fd.worst.length === 0, `${label}: analytic Jacobian = finite differences (${JSON.stringify(fd.worst)})`);
};
// the row count: exact (rows + arc equals = 2 x offset joints), or + `extra` redundant rows
const rowCount = (S, res, label, extra = 0) => {
  const arcs = res.shapes.filter((id) => shape(S, id).type === 'arc').length;
  const rows = offsetRowCount(res.constraint, S.state.shapes);
  ok(rows + arcs === 2 * res.joints.length + extra, `${label}: rows ${rows} + ${arcs} arc equal(s) = 2 x ${res.joints.length} offset joints${extra ? ` + ${extra}` : ''}`);
};
// the dimension typed: accepted, every gap moves to the new value, ONE undo step, undo / redo exact
const editMoves = (S, c, from, to, label) => {
  gapsAre(S, c, from, `${label}: before the edit`);
  const before = image(S), h0 = S.state.history.length;
  const r = typeInto(S, c, String(to));
  ok(r.ok === true, `${label}: the offset dimension ${from} -> ${to} accepted (${JSON.stringify(r)})`);
  ok(Number(c.value) === to, `${label}: the dimension reads ${to} (${c.value})`);
  ok(L.residuals(S).max < 1e-6, `${label}: every constraint holds after the edit (${L.residuals(S).max})`);
  gapsAre(S, c, to, `${label}: after ${from} -> ${to}`);
  ok(S.state.history.length === h0 + 1, `${label}: ONE undo step (${h0} -> ${S.state.history.length})`);
  const after = image(S);
  S.state.undo(); ok(image(S) === before, `${label}: undo gives exactly the drawing before`);
  gapsAre(S, c, from, `${label}: after undo`);
  S.state.redo(); ok(image(S) === after, `${label}: redo gives exactly the drawing after`);
};
// a drag of every copy joint by (4, 4) (the select tool's joint drag: solve with a dragTarget): the joint stays (a spring against 0 freedom),
// the gap stays d, the dimension still reads d
const dragKeeps = (S, res, d, label) => {
  const c = res.constraint;
  let worstMove = 0;
  for (const jid of res.joints) {
    const j = P(S, jid), p0 = { x: j.x, y: j.y };
    S.engine.solve(L.ITER, { dragTarget: { jointId: jid, x: p0.x + 4, y: p0.y + 4 } });
    worstMove = Math.max(worstMove, Math.hypot(P(S, jid).x - p0.x, P(S, jid).y - p0.y));
    gapsAre(S, c, d, `${label}: after a (4, 4) drag of copy joint ${jid}`, 1e-3);
    S.engine.solve(L.ITER); // the drag released
    gapsAre(S, c, d, `${label}: after the drag of ${jid} is released`, 1e-6);
  }
  ok(worstMove < 1e-3, `${label}: no copy joint follows a (4, 4) drag (worst move ${worstMove.toExponential(3)})`);
  ok(Number(c.value) === d, `${label}: the dimension still reads ${d} (${c.value})`);
  console.log(`${label}: worst copy joint move under a (4, 4) drag ${worstMove.toExponential(3)}`);
};
const hold = (S, ids) => { for (const id of ids) for (const j of shape(S, id).joints) P(S, j).fixed = true; };

// ---------------------------------------------------------------- 1. the rounded rectangle (the bug hunt's r5)
function roundedRect() {
  const S = L.newSketch(), st = S.state;
  const R = ops.rect(st, 0, 0, 60, -40);
  ops.snap(st, R.c1, L.origin);
  const top = shape(S, R.top), left = shape(S, R.left);
  ops.dimension(st, { joints: [top.joints[0], top.joints[1]] }, { x: 30, y: -50 }, '60');
  ops.dimension(st, { joints: [left.joints[0], left.joints[1]] }, { x: -10, y: -20 }, '40');
  S.engine.solve(L.ITER);
  for (const [a, b] of [[R.top, R.right], [R.right, R.bottom], [R.bottom, R.left], [R.left, R.top]]) ops.fillet(st, a, b, 5);
  S.engine.solve(L.ITER);
  ok(L.nullity(S) === 0, `the rounded rectangle is fully defined (nullity ${L.nullity(S)})`);
  return { S, R };
}
for (const [side, toward, to] of [['inside', { x: 30, y: -20 }, 4], ['outside', { x: 30, y: 20 }, 5]]) {
  const label = `rounded rectangle, offset 3 ${side}`;
  const { S, R } = roundedRect();
  const res = offsetOf(S, R.top, 3, toward);
  ok(res.chain.closed && res.chain.joins.every((j) => j === 'tangent'), `${label}: a closed chain, every join tangent (${JSON.stringify(res.chain.joins)})`);
  determined(S, res, label);
  rowCount(S, res, label);
  ok(offsetOperands(res.constraint, S.state.shapes).filter((r) => r.k === 'nl' || r.k === 'na').length === 1, `${label}: exactly one row reads d (the anchor)`);
  gapsAre(S, res.constraint, 3, label);
  dragKeeps(S, res, 3, label);
  editMoves(S, res.constraint, 3, to, label);
  determined(S, res, `${label}, after the edit`);
  dragKeeps(S, res, to, `${label}, after the edit`);
}

// ---------------------------------------------------------------- 2. a slot outline (lines + arcs) and a 4-arc oval (arcs only)
{
  const label = 'slot outline (2 lines + 2 arcs), offset 3 outside';
  const S = L.newSketch(), st = S.state;
  const c1 = ops.click(st, 0, 0), c2 = ops.click(st, 40, 0);
  const built = ops.slot(st, c1, c2, 20);
  S.engine.solve(L.ITER);
  const outline = built.shapes.filter((s) => !s.isConstruction).map((s) => s.id);
  hold(S, built.shapes.map((s) => s.id));
  const pick = outline.find((id) => shape(S, id).type === 'line');
  const res = offsetOf(S, pick, 3, { x: 20, y: 30 });
  ok(res.chain.pieces.length === 4 && res.chain.closed && res.chain.joins.every((j) => j === 'tangent'), `${label}: 4 pieces, closed, every join tangent (${JSON.stringify(res.chain)})`);
  determined(S, res, label);
  rowCount(S, res, label);
  dragKeeps(S, res, 3, label);
  editMoves(S, res.constraint, 3, 6, label);
  dragKeeps(S, res, 6, `${label}, after the edit`);
}
function oval() {
  // a 4-centre oval: small arcs R 5 about (+-10, 0), large arcs R 5 + 10 sqrt 2 about (0, -+10); tangent where the centres line up
  const S = L.newSketch(), st = S.state;
  const Rb = 5 + 10 * Math.SQRT2, h = Rb * Math.SQRT1_2;
  const pts = [[h, 10 - h], [h, h - 10], [-h, h - 10], [-h, 10 - h]].map(([x, y]) => ops.click(st, x, y)); // y here is the math y; screen y down is fine
  const centres = [[10, 0], [0, -10], [-10, 0], [0, 10]].map(([x, y]) => ops.click(st, x, y));
  const ids = [];
  for (let k = 0; k < 4; k++) {
    const a = pts[k], b = pts[(k + 1) % 4];
    // the order a -> b goes round the oval; the sweep that gives the short (90 deg) arc
    let id = ops.arc(st, centres[k], a, b, { sweep: true });
    const info = arcSweepInfo(P(S, centres[k]), P(S, a), P(S, b), { sweep: true });
    if (info.span > Math.PI) { S.state.shapes.splice(S.state.shapes.findIndex((s) => s.id === id), 1); S.state.constraints.splice(S.state.constraints.length - 1, 1); id = ops.arc(st, centres[k], a, b, { sweep: false }); }
    ids.push(id);
  }
  S.engine.solve(L.ITER);
  hold(S, ids);
  return { S, ids };
}
for (const [side, toward, to] of [['outside', { x: 0, y: 40 }, 5], ['inside', { x: 0, y: 0 }, 2]]) {
  const label = `4-arc oval (arcs only), offset 3 ${side}`;
  const { S, ids } = oval();
  for (const id of ids) { const s = shape(S, id), info = arcSweepInfo(P(S, s.joints[0]), P(S, s.joints[1]), P(S, s.joints[2]), { sweep: s.sweep }); ok(Math.abs(info.span - Math.PI / 2) < 1e-9, `${label}: arc ${id} spans 90 deg (${info.span})`); }
  const res = offsetOf(S, ids[0], 3, toward);
  ok(res.chain.pieces.length === 4 && res.chain.closed && res.chain.joins.every((j) => j === 'tangent'), `${label}: 4 arcs, closed, every join tangent (${JSON.stringify(res.chain)})`);
  determined(S, res, label);
  rowCount(S, res, label, 1);
  dragKeeps(S, res, 3, label);
  editMoves(S, res.constraint, 3, to, label);
  dragKeeps(S, res, to, `${label}, after the edit`);
}

// ---------------------------------------------------------------- 3. a lone circle (a guard: it already held d)
{
  const label = 'circle R 20, offset 3 outside';
  const S = L.newSketch(), st = S.state;
  const C = ops.circle(st, 0, 0, 20);
  P(S, C.c).fixed = true;
  S.engine.solve(L.ITER);
  const n0 = L.nullity(S); // the circle's radius is a DOF of its own (Fusion), the offset adds none
  const res = offsetOf(S, C.id, 3, { x: 30, y: 0 });
  determined(S, res, label, n0);
  editMoves(S, res.constraint, 3, 7, label);
}

// ---------------------------------------------------------------- 4. regression: corner chains keep their rows (no anchor)
{
  const label = 'plain rectangle 60 x 40, offset 3 inside';
  const S = L.newSketch(), st = S.state;
  const R = ops.rect(st, 0, 0, 60, -40);
  ops.snap(st, R.c1, L.origin);
  const top = shape(S, R.top), left = shape(S, R.left);
  ops.dimension(st, { joints: [top.joints[0], top.joints[1]] }, { x: 30, y: -50 }, '60');
  ops.dimension(st, { joints: [left.joints[0], left.joints[1]] }, { x: -10, y: -20 }, '40');
  S.engine.solve(L.ITER);
  const res = offsetOf(S, R.top, 3, { x: 30, y: -20 });
  const kinds = offsetOperands(res.constraint, S.state.shapes).map((r) => r.k).join(' ');
  ok(kinds === 'rl nl rl nl rl nl rl nl', `${label}: each corner keeps its ray row + N row (${kinds})`);
  determined(S, res, label);
  rowCount(S, res, label);
  dragKeeps(S, res, 3, label);
  editMoves(S, res.constraint, 3, 5, label);
}
{
  const label = 'open L, offset 3';
  const S = L.newSketch(), st = S.state;
  const segs = ops.polyline(st, [[0, 0], [40, 0], [40, 30]], false);
  const ids = segs.map((s) => s.id);
  hold(S, ids);
  const res = offsetOf(S, ids[0], 3, { x: 20, y: 10 });
  const kinds = offsetOperands(res.constraint, S.state.shapes).map((r) => r.k).join(' ');
  ok(kinds === 'nl tl rl nl rl tl', `${label}: open start N + T, corner ray + N, open end ray + T (${kinds})`);
  determined(S, res, label);
  rowCount(S, res, label);
  editMoves(S, res.constraint, 3, 5, label);
}

// ---------------------------------------------------------------- 5. undimensioned (task 667): d is the free scalar, the gap stays uniform
{
  const label = 'rounded rectangle, UNDIMENSIONED offset 3 inside';
  const { S, R } = roundedRect();
  const res = offsetOf(S, R.top, 3, { x: 30, y: -20 });
  undimensionOffset(res.constraint);
  S.engine.solve(L.ITER);
  ok(L.nullity(S) === 1, `${label}: one DOF, the free distance (nullity ${L.nullity(S)})`);
  const jid = res.joints[0], j = P(S, jid), p0 = { x: j.x, y: j.y };
  // drag the copy joint 1 mm further inside along the bisector: every piece follows by the same distance, d follows
  S.engine.solve(L.ITER, { dragTarget: { jointId: jid, x: p0.x + 1, y: p0.y - 1 } });
  const g = gaps(S, res.constraint).filter((x) => !x.zero).map((x) => x.d);
  const spread = Math.max(...g) - Math.min(...g);
  ok(spread < 1e-3, `${label}: after a drag the gap is the same on every piece (spread ${spread.toExponential(3)}, ${g.map((v) => v.toFixed(4)).join(' ')})`);
  ok(Math.abs(g[0] - Number(res.constraint.value)) < 1e-3 && Math.abs(g[0] - 3) > 0.1, `${label}: the free distance follows the drag (${res.constraint.value}, gap ${g[0]})`);
}

console.log(`offset-781-node: ${checks} checks passed`);
