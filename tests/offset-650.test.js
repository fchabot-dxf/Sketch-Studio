// tests/offset-650.test.js - TASK 650: #core/offset.js (Offset, like Fusion's Create > Offset) on a headless sketch (tests/harness/audit/lib.js:
// the real sketch state, engine and constraint paths the tools use).
//   the Fusion case (advisor-verified with the Fusion API): a 40 mm line, a 30 mm line and an R10 quarter arc joined end to end, 5 mm inward ->
//   lines 35 / 25 and an R5 arc, JOINED (shared joints), ONE offset constraint = ONE driving distance dimension; outward too (45 / 35 / R15);
//   a closed rectangle inward and outward; a circle; a line + arc tangent chain walked against its source directions; an open chain's ends on the
//   normals through the source ends; collapse refused (a line reversed, an arc radius <= 0) with nothing changed; a branch refused.
//   The solver: the offset rows hold every offset piece (sources held: 0 DOF left, engine nullity = finite-difference nullity, analytic Jacobian =
//   finite differences), a dimension edit 5 -> 8 moves the offset chain and leaves the sources, save / load keeps the constraint, the handle anchor.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import {
  offsetChainOf, offsetChainGeometry, offsetSideAt, applyOffset, offsetHandleAnchor, offsetOperands, offsetRowCount, offsetResidual,
  parseOffsetDistance, defaultOffsetDistance
} from '#core/offset.js';
import { measureResidual } from '#core/constraint-verifier.js';
import { commitDimensionEdit } from '#core/dimension-seams.js';
import { isDimension } from '#core/parameters.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { arcSweepInfo } from '#core/geometry.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon, polyArea } from '#core/loop-geometry.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const TOL = 1e-6;
const near = (a, b, msg, tol = TOL) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const nearP = (p, q, msg, tol = TOL) => ok(Math.hypot(p.x - q.x, p.y - q.y) <= tol, `${msg}: (${p.x}, ${p.y}) vs (${q.x}, ${q.y})`);
const P = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: j.y }; };
const shape = (S, id) => S.state.shapes.find(s => s.id === id);
const len = (S, id) => { const s = shape(S, id); const a = P(S, s.joints[0]), b = P(S, s.joints[1]); return Math.hypot(b.x - a.x, b.y - a.y); };
const radius = (S, id) => { const s = shape(S, id); if (s.type === 'circle') return s.radius; const c = P(S, s.joints[0]), a = P(S, s.joints[1]); return Math.hypot(a.x - c.x, a.y - c.y); };
const ends = (s) => (s.type === 'arc' ? [s.joints[1], s.joints[2]] : s.joints.slice(0, 2));

// the offset of the chain picked on `pickId`, toward world point `toward`; returns the result and checks the common rules
function offset(S, pickId, d, toward, label) {
  const ch = offsetChainOf(S.state, pickId);
  ok(ch.ok, `${label}: the chain is found (${ch.reason})`);
  const side = offsetSideAt(S.state, ch.chain, toward);
  const nShapes = S.state.shapes.length, nCons = S.state.constraints.length;
  const res = applyOffset(S.state, ch.chain, d, side);
  ok(res.ok, `${label}: applied (${res.reason})`);
  ok(S.state.shapes.length === nShapes + ch.chain.pieces.length, `${label}: one new shape per chain piece`);
  const mine = S.state.constraints.slice(nCons);
  const offs = mine.filter(c => c.type === CONSTRAINT_TYPES.OFFSET);
  ok(offs.length === 1 && offs[0] === res.constraint, `${label}: ONE offset constraint`);
  ok(isDimension(res.constraint) && res.constraint.value === d && !res.constraint.isDriven && /^d\d+$/.test(res.constraint.name), `${label}: it is the driving distance dimension ${res.constraint.name} = ${d}`);
  const arcs = res.shapes.map(id => shape(S, id)).filter(s => s.type === 'arc');
  ok(mine.length === 1 + arcs.length && mine.filter(c => c.type === 'equal').length === arcs.length, `${label}: besides it, only each arc's structural equal (${mine.map(c => c.type)})`);
  ok(L.residuals(S).max < 1e-9, `${label}: every constraint satisfied as made (worst ${L.describe(L.residuals(S).worst)} ${L.residuals(S).max})`);
  // joined: consecutive pieces SHARE their joint (coincident by construction), in the chain order
  const n = res.shapes.length, closed = ch.chain.closed;
  for (let k = 1; k < (closed ? n + 1 : n) && shape(S, res.shapes[0]).type !== 'circle'; k++) {
    const a = shape(S, res.shapes[(k - 1) % n]), b = shape(S, res.shapes[k % n]);
    ok(ends(a)[1] === ends(b)[0], `${label}: piece ${k - 1} ends on the joint piece ${k % n} starts on`);
  }
  return { ...res, chain: ch.chain, side };
}

// the solver holds the offset: sources fixed -> 0 DOF left; analytic Jacobian = finite differences; a solve keeps everything
function solverHolds(S, res, label) {
  const src = res.chain.pieces.map(p => shape(S, p.id));
  const fixedBefore = new Map();
  for (const s of src) for (const j of s.joints) { fixedBefore.set(j, S.state.joints.get(j).fixed); S.state.joints.get(j).fixed = true; }
  for (const s of src) if (s.type === 'circle') S.state.constraints.push({ type: 'distance', shape: s.id, isRadius: true, value: s.radius, __tmp: true });
  const f = S.engine.jointFreedom();
  const free = res.joints.filter(j => (f.freedom.get(j) || 0) > 0);
  ok(free.length === 0 && f.nullity === 0, `${label}: sources held -> the offset is fully defined (free joints ${free}, nullity ${f.nullity})`);
  const fd = L.fdJacobian(S);
  ok(fd.worst.length === 0, `${label}: analytic Jacobian = finite differences (${JSON.stringify(fd.worst)})`);
  ok(fd.nullity === f.nullity, `${label}: finite-difference nullity ${fd.nullity} = engine ${f.nullity}`);
  for (let i = S.state.constraints.length - 1; i >= 0; i--) if (S.state.constraints[i].__tmp) S.state.constraints.splice(i, 1); // in place: the engine holds the array
  for (const [j, was] of fixedBefore) S.state.joints.get(j).fixed = was;
  const snap = L.snapshot(S);
  S.engine.solve(L.ITER);
  ok(L.maxDeviation(S, snap) < 1e-6, `${label}: a solve leaves the offset where it was made`);
}

// ---------------------------------------------------------------- the Fusion case: 40 / 30 / R10 quarter arc
function fusionChain() {
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 40, 0), c = L.point(S, 40, 30), ac = L.point(S, 30, 30), e = L.point(S, 30, 40);
  const l1 = L.line(S, a, b), l2 = L.line(S, b, c);
  const arc = L.arc(S, ac, c, e); // centre (30, 30), from (40, 30) counter-clockwise to (30, 40): tangent to the 30 mm line at (40, 30)
  shape(S, arc).sweep = true;
  return { S, l1, l2, arc, a, b, c, ac, e };
}
{
  const F = fusionChain();
  const S = F.S;
  ok(len(S, F.l1) === 40 && len(S, F.l2) === 30 && Math.abs(radius(S, F.arc) - 10) < 1e-12, 'Fusion case drawn: 40, 30, R10');
  const ch = offsetChainOf(S.state, F.l2);
  ok(ch.ok && ch.chain.pieces.length === 3 && !ch.chain.closed, 'picking the middle line takes the whole chain (3 pieces, open)');
  ok(JSON.stringify(ch.chain.joins) === JSON.stringify(['corner', 'tangent']), `joins: the line-line corner, the line-arc tangent join (${ch.chain.joins})`);
  const res = offset(S, F.l2, 5, { x: 20, y: 10 }, 'Fusion inward 5');
  const [o1, o2, oa] = res.shapes; // chain order from the free end of line 1
  near(len(S, o1), 35, 'Fusion inward: line 1 -> 35'); near(len(S, o2), 25, 'Fusion inward: line 2 -> 25'); near(radius(S, oa), 5, 'Fusion inward: R10 -> R5');
  nearP(P(S, shape(S, oa).joints[0]), { x: 30, y: 30 }, 'the offset arc keeps the centre');
  nearP(P(S, shape(S, o1).joints[0]), { x: 0, y: 5 }, 'open end: line 1 starts on the normal through (0, 0)');
  nearP(P(S, shape(S, oa).joints[2]), { x: 30, y: 35 }, 'open end: the arc ends on the ray through (30, 40)');
  nearP(P(S, shape(S, o2).joints[1]), { x: 35, y: 30 }, 'tangent join: the line ends on the arc at the common normal');
  const info = arcSweepInfo(P(S, shape(S, oa).joints[0]), P(S, shape(S, oa).joints[1]), P(S, shape(S, oa).joints[2]), { sweep: shape(S, oa).sweep });
  near(info.span, Math.PI / 2, 'the offset arc is a quarter too');
  solverHolds(S, res, 'Fusion inward');
  // the dimension drives: 5 -> 8 moves the offset chain, the sources stay
  const srcSnap = new Map([F.a, F.b, F.c, F.ac, F.e].map(j => [j, P(S, j)]));
  const r = commitDimensionEdit(S.state, res.constraint, 8);
  ok(!r.reverted, `the dimension edit 5 -> 8 is accepted (${r.reason || r.clash})`);
  for (const [j, p] of srcSnap) nearP(P(S, j), p, 'the source stays where it was', 1e-6);
  near(len(S, o1), 32, 'd = 8: line 1 -> 32', 1e-6); near(len(S, o2), 22, 'd = 8: line 2 -> 22', 1e-6); near(radius(S, oa), 2, 'd = 8: R2', 1e-6);
  near(P(S, shape(S, o1).joints[0]).y, 8, 'd = 8: line 1 is 8 from its source', 1e-6);
  near(measureResidual(res.constraint, S.state.joints, S.state.shapes), 0, 'the offset residual after the edit', 1e-6);
  // the drag-handle anchor (a follow-up plugs the shared arrow here): the first offset piece's midpoint, the normal away from its source
  const h = offsetHandleAnchor(S.state, res.chain, res.side, 8);
  nearP(h.point, { x: 16, y: 8 }, 'handle anchor: line 1 offset midpoint'); nearP(h.normal, { x: 0, y: 1 }, 'handle normal: away from the source (inward = +y)');
  // save / load: the constraint comes back the same and still holds
  const doc = serializeDocument(S.state);
  const S2 = L.newSketch();
  const loaded = deserializeDocument(JSON.parse(JSON.stringify(doc)), S2.state);
  ok(loaded.ok, `the document loads (${loaded.reason})`);
  const back = S2.state.constraints.find(c => c.type === CONSTRAINT_TYPES.OFFSET);
  ok(back && JSON.stringify(back.shapes) === JSON.stringify(res.constraint.shapes) && back.value === 8 && back.name === res.constraint.name
    && JSON.stringify(back.joins) === JSON.stringify(res.constraint.joins) && JSON.stringify(back.sides) === JSON.stringify(res.constraint.sides), 'save / load keeps the offset constraint');
  ok(offsetResidual(back, S2.state.joints, S2.state.shapes, (s) => radius(S2, s.id)) < 1e-6, 'the loaded offset holds');
}
{
  const F = fusionChain();
  const res = offset(F.S, F.arc, 5, { x: 20, y: -10 }, 'Fusion outward 5'); // pick the arc this time
  const S = F.S;
  const byType = res.shapes.map(id => shape(S, id));
  const lines = byType.filter(s => s.type === 'line').map(s => len(S, s.id)).sort((a, b) => a - b);
  near(lines[0], 35, 'Fusion outward: line 2 -> 35'); near(lines[1], 45, 'Fusion outward: line 1 -> 45');
  near(radius(S, byType.find(s => s.type === 'arc').id), 15, 'Fusion outward: R10 -> R15');
  solverHolds(S, res, 'Fusion outward');
}

// ---------------------------------------------------------------- a closed rectangle (rect tool: H/V + coincident corners)
for (const [label, toward, d, w, h] of [['rectangle inward', { x: 20, y: 15 }, 5, 30, 20], ['rectangle outward', { x: 60, y: 15 }, 5, 50, 40]]) {
  const S = L.newSketch();
  const R = L.rect(S, 0, 0, 40, 30);
  const res = offset(S, R.top, d, toward, label);
  ok(res.chain.closed && res.chain.pieces.length === 4, `${label}: a closed chain of 4`);
  const ls = res.shapes.map(id => len(S, id)).sort((a, b) => a - b);
  near(ls[0], h, `${label}: short side`); near(ls[1], h, `${label}: short side`); near(ls[2], w, `${label}: long side`); near(ls[3], w, `${label}: long side`);
  const xs = res.joints.map(j => P(S, j).x), ys = res.joints.map(j => P(S, j).y);
  near(Math.min(...xs), 20 - w / 2, `${label}: left`); near(Math.max(...ys), 15 + h / 2, `${label}: top`);
  ok(res.joints.length === 4, `${label}: 4 shared corner joints (closed)`);
  // ordinary shapes: the offset is a closed loop of its own for the cut / plot / export pipelines (#core/loop-finder.js)
  const loops = findLoops(S.state), byId = new Map(S.state.shapes.map(s => [s.id, s]));
  const mine = loops.find(l => l.edges.every(e => res.shapes.includes(e)) && l.edges.length === 4);
  ok(loops.length === 2 && mine && Math.abs(polyArea(loopPolygon(mine, S.state, byId)) - w * h) < 1e-6, `${label}: the offset is its own closed loop of area ${w * h} (${loops.length} loops)`);
  solverHolds(S, res, label);
  const r = commitDimensionEdit(S.state, res.constraint, 2);
  ok(!r.reverted, `${label}: edit to 2`);
  const ls2 = res.shapes.map(id => len(S, id)).sort((a, b) => a - b);
  near(ls2[0], label.includes('inward') ? 26 : 34, `${label}: d = 2 short side`, 1e-6);
}
// collapse: a 40 x 30 rectangle inward 15 (the short sides vanish) / 16 (they turn back) is refused, nothing changes
for (const d of [15, 16]) {
  const S = L.newSketch();
  const R = L.rect(S, 0, 0, 40, 30);
  const ch = offsetChainOf(S.state, R.left).chain;
  const t0 = JSON.stringify(serializeDocument(S.state));
  const res = applyOffset(S.state, ch, d, offsetSideAt(S.state, ch, { x: 20, y: 15 }));
  ok(!res.ok && /line would (collapse|turn back)/.test(res.reason), `rectangle inward ${d}: refused (${res.reason})`);
  ok(JSON.stringify(serializeDocument(S.state)) === t0, `rectangle inward ${d}: nothing changed`);
}

// ---------------------------------------------------------------- a circle
{
  const S = L.newSketch();
  const C = L.circle(S, 10, 10, 10);
  const inn = offset(S, C.id, 3, { x: 12, y: 10 }, 'circle inward');
  near(radius(S, inn.shapes[0]), 7, 'circle inward: R7'); nearP(P(S, shape(S, inn.shapes[0]).joints[0]), { x: 10, y: 10 }, 'circle inward: same centre');
  solverHolds(S, inn, 'circle inward');
  const out = offset(S, C.id, 3, { x: 30, y: 10 }, 'circle outward');
  near(radius(S, out.shapes[0]), 13, 'circle outward: R13');
  const ha = offsetHandleAnchor(S.state, out.chain, out.side, 3), hi = offsetHandleAnchor(S.state, inn.chain, inn.side, 3);
  nearP(ha.point, { x: 23, y: 10 }, 'circle outward handle anchor on the offset circle'); nearP(ha.normal, { x: 1, y: 0 }, 'circle outward handle normal: outward');
  nearP(hi.point, { x: 17, y: 10 }, 'circle inward handle anchor'); nearP(hi.normal, { x: -1, y: 0 }, 'circle inward handle normal: toward the centre (d grows inward)');
  const r = commitDimensionEdit(S.state, out.constraint, 4);
  ok(!r.reverted, 'circle: edit to 4'); near(radius(S, out.shapes[0]), 14, 'circle: d = 4 -> R14', 1e-6); near(radius(S, C.id), 10, 'circle: the source keeps R10', 1e-6);
  const ch = offsetChainOf(S.state, C.id).chain;
  const big = applyOffset(S.state, ch, 10, 1);
  ok(!big.ok && /would shrink to radius 0/.test(big.reason), `circle inward 10: refused (${big.reason})`);
}

// ---------------------------------------------------------------- an arc then a line, tangent, sources drawn against the chain direction
{
  const S = L.newSketch();
  // arc centre (0, 0) R10 from (0, 10) clockwise to (10, 0) [stored start (10, 0), end (0, 10), sweep = increasing angle], then a line from
  // (10, -20) UP to (10, 0) [stored the other way round]: tangent at (10, 0)
  const c = L.point(S, 0, 0), p1 = L.point(S, 10, 0), p2 = L.point(S, 0, 10), q = L.point(S, 10, -20);
  const arc = L.arc(S, c, p1, p2); shape(S, arc).sweep = true;
  const ln = L.line(S, q, p1);
  const ch = offsetChainOf(S.state, arc);
  ok(ch.ok && JSON.stringify(ch.chain.joins) === '["tangent"]', `arc + line: one tangent join (${ch.reason || ch.chain.joins})`);
  const res = offset(S, arc, 4, { x: 3, y: 3 }, 'arc + line inward');
  const oa = res.shapes.map(id => shape(S, id)).find(s => s.type === 'arc'), ol = res.shapes.map(id => shape(S, id)).find(s => s.type === 'line');
  near(radius(S, oa.id), 6, 'arc + line inward: R6');
  near(len(S, ol.id), 20, 'arc + line inward: the line keeps its length (tangent join, normal end)');
  ok(P(S, ol.joints[0]).x === 6 || Math.abs(P(S, ol.joints[0]).x - 6) < 1e-9, 'arc + line inward: the line is 4 to the left of x = 10');
  solverHolds(S, res, 'arc + line inward');
  const r = commitDimensionEdit(S.state, res.constraint, 2);
  ok(!r.reverted, 'arc + line: edit to 2'); near(radius(S, oa.id), 8, 'arc + line: d = 2 -> R8', 1e-6);
  const tooFar = applyOffset(S.state, offsetChainOf(S.state, arc).chain, 12, offsetSideAt(S.state, offsetChainOf(S.state, arc).chain, { x: 3, y: 3 }));
  ok(!tooFar.ok && /would shrink to radius/.test(tooFar.reason), `arc + line inward 12: refused, the arc radius would be <= 0 (${tooFar.reason})`);
}

// ---------------------------------------------------------------- an L of two lines (the live test's drawing), coincident corner (line tool)
{
  const S = L.newSketch();
  const segs = L.polyline(S, [[0, 40], [0, 0], [50, 0]], false);
  const res = offset(S, segs[0].id, 5, { x: 10, y: 10 }, 'L inward');
  ok(res.shapes.length === 2 && res.joints.length === 3, 'L: two new lines on three joints (the corner shared)');
  const corner = res.joints[1];
  nearP(P(S, corner), { x: 5, y: 5 }, 'L: the corner at (5, 5)');
  solverHolds(S, res, 'L inward');
}

// ---------------------------------------------------------------- construction curves are offset as construction
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 30, 0);
  const cl = L.line(S, a, b, true);
  const res = offset(S, cl, 2, { x: 15, y: 5 }, 'construction line');
  ok(shape(S, res.shapes[0]).isConstruction === true, 'construction line: its offset is construction');
  near(P(S, shape(S, res.shapes[0]).joints[0]).y, 2, 'construction line: 2 from its source');
}

// ---------------------------------------------------------------- refusals: a branch, a non-curve kind; the distance parser
{
  const S = L.newSketch();
  const a = L.point(S, 0, 0), b = L.point(S, 10, 0), c = L.point(S, 20, 0), d = L.point(S, 10, 10);
  const l1 = L.line(S, a, b); L.line(S, b, c); L.line(S, b, d);
  const ch = offsetChainOf(S.state, l1);
  ok(!ch.ok && /branches/.test(ch.reason), `a T junction is refused (${ch.reason})`);
}
ok(parseOffsetDistance('5', 'mm') === 5 && parseOffsetDistance('0.25', 'in') === 6.35 && parseOffsetDistance('0', 'mm') === null && parseOffsetDistance('x', 'mm') === null, 'distance parser: doc units, > 0');
ok(defaultOffsetDistance('mm') === 5 && defaultOffsetDistance('in') === 6.35, 'default distance: 5 mm / 1/4"');
ok(offsetRowCount({ type: 'offset', shapes: ['nope', 'nada'] }, []) === 0 && offsetOperands({ type: 'offset', shapes: ['x'] }, []) === null, 'an unresolved offset has no rows');
{
  const F = fusionChain();
  const ch = offsetChainOf(F.S.state, F.l1).chain;
  const g = offsetChainGeometry(F.S.state, ch, 10, offsetSideAt(F.S.state, ch, { x: 20, y: 10 }));
  ok(!g.ok && /shrink to radius 0/.test(g.reason), `Fusion chain inward 10: the R10 arc would vanish, refused (${g.reason})`);
}

console.log(`offset-650: ${checks} checks passed`);
