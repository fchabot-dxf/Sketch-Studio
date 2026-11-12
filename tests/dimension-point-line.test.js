// tests/dimension-point-line.test.js -- TASK 520: the Dimension tool's point-to-line and line-to-line dimensions, and perpendicular from an exactly
// parallel start (findings NEW-1, NEW-2, NEW-3, NEW-5 of docs/COVERAGE-AUDIT.md; their repros used to be pinned in tests/harness/coverage/matrix-findings.js).
// Everything goes through the real tool handlers / ConstraintManager; nothing is a hand-written solver row.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { TOOL_MODES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { perpendicularDistance } from '#core/geometry.js';
import { commitDimensionEdit } from '#ui/dimension-seams.js';
import { handleDimensionPointerDown, anchorPlacingDimension, resetDimensionState } from '#ui/input-handlers/dimension-tool.js';

const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 800 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture() {}, releasePointerCapture() {} };
const evt = (x, y) => ({ clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, target: { closest: () => null } });
const J = (S, id) => S.state.joints.get(id);
const quiet = (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; } };
// a click never swallows an error: a throw fails the test
const click = (S, x, y, hitJoint, hitShape) => quiet(() => handleDimensionPointerDown(evt(x, y), svg, S.state, hitJoint, hitShape, null));
const perp = (S, p, a, b) => Math.abs(perpendicularDistance(J(S, p), J(S, a), J(S, b)));

// ---------------------------------------------------------------- NEW-1 + NEW-2: point-to-line
function pointLineSketch() {
  const S = L.newSketch(); const st = S.state;
  const a = L.point(S, 100, 100), b = L.point(S, 200, 100), p = L.point(S, 140, 60); const ln = L.line(S, a, b);
  st.currentTool = TOOL_MODES.DIMENSION; resetDimensionState(st);
  return { S, st, a, b, p, ln };
}
const pointThenLine = (k) => { click(k.S, 140, 60, { id: k.p, j: J(k.S, k.p) }, null); click(k.S, 150, 100, null, { shape: L.shape(k.S, k.ln) }); };

{ // NEW-1: no throw, the undo group is closed, ONE dimension made of one constraint, one undo step
  const k = pointLineSketch();
  pointThenLine(k);
  assert.strictEqual(!!k.st._undoGroupActive, false, 'NEW-1: the dimension gesture leaves no undo group open');
  const dims = k.st.constraints.filter(c => c.type === 'distance');
  assert.strictEqual(dims.length, 1, 'NEW-1: exactly one distance constraint: ' + k.st.constraints.map(L.describe).join(', '));
  assert.strictEqual(k.st.constraints.length, 1, 'NEW-1: the gesture made nothing but the dimension (no pointOnLine)');
  assert.strictEqual(k.st.joints.size, 1 + 3, 'NEW-1: no helper joint (origin + a, b, p)');
  assert.deepStrictEqual(dims[0].joints, [k.p, k.a, k.b], 'the dimension is stored as the three joints [point, line end A, line end B]');
  assert(Math.abs(dims[0].value - 40) < 1e-9 && !L.isDriven(dims[0]), 'born driving with the perpendicular distance 40: ' + L.describe(dims[0]));
  quiet(() => anchorPlacingDimension(svg, k.st)); resetDimensionState(k.st);
  assert.strictEqual(!!k.st._undoGroupActive, false, 'still no undo group open after the label is dropped');
  k.st.undo();
  assert.strictEqual(k.st.constraints.length, 0, 'NEW-1: ONE undo removes the dimension');
}

{ // NEW-2: the distance holds when the line swings, the row removes exactly 1 DOF, a typed value drives, delete leaves nothing behind
  const k = pointLineSketch();
  const free0 = L.nullity(k.S);
  pointThenLine(k); quiet(() => anchorPlacingDimension(svg, k.st)); resetDimensionState(k.st);
  k.S.engine.solve(L.ITER);
  assert.strictEqual(L.nullity(k.S) - free0, -1, 'NEW-2: a point-to-line dimension removes exactly one degree of freedom');
  for (const id of [k.a, k.p]) J(k.S, id).fixed = true;
  J(k.S, k.b).y -= 40;
  k.S.engine.solve(L.ITER);
  const d1 = perp(k.S, k.p, k.a, k.b);
  assert(Math.abs(d1 - 40) < 1e-3, 'NEW-2: after swinging the line the PERPENDICULAR distance is still 40, got ' + d1);
  assert(L.residuals(k.S).max < 1e-6, 'residual ' + L.residuals(k.S).max);
  const c = k.st.constraints.find(x => x.type === 'distance');
  const r = commitDimensionEdit(k.st, c, 55);
  assert(!r.reverted, 'the typed value is accepted');
  assert(Math.abs(perp(k.S, k.p, k.a, k.b) - 55) < 1e-3, 'a typed value 55 drives the perpendicular distance: ' + perp(k.S, k.p, k.a, k.b));
  deleteConstraints(k.st, [c]); k.S.engine.solve(L.ITER);
  assert.strictEqual(k.st.joints.size, 4, 'no joint left behind after deleting the dimension');
}

{ // a joint that is an end of the clicked line cannot be dimensioned to that line
  const k = pointLineSketch();
  click(k.S, 100, 100, { id: k.a, j: J(k.S, k.a) }, null);
  click(k.S, 150, 100, null, { shape: L.shape(k.S, k.ln) });
  assert.strictEqual(k.st.constraints.length, 0, 'a dimension from the line\'s own end to that line is refused');
  assert.strictEqual(!!k.st._undoGroupActive, false);
}

{ // the undo group closes on EVERY exit including a throw (one place: handleDimensionPointerDown), and the error still propagates
  const k = pointLineSketch();
  click(k.S, 140, 60, { id: k.p, j: J(k.S, k.p) }, null);
  const real = ConstraintManager.createConstraint;
  ConstraintManager.createConstraint = () => { throw new Error('boom'); };
  try { assert.throws(() => click(k.S, 150, 100, null, { shape: L.shape(k.S, k.ln) }), /boom/, 'the error propagates'); }
  finally { ConstraintManager.createConstraint = real; }
  assert.strictEqual(!!k.st._undoGroupActive, false, 'the undo group is closed after a throw');
  resetDimensionState(k.st);
}

// ---------------------------------------------------------------- NEW-5: line-to-line, both click orders
for (const first of [true, false]) {
  const S = L.newSketch(); const st = S.state;
  const a = L.point(S, 100, 100), b = L.point(S, 160, 120), c = L.point(S, 130, 190), d = L.point(S, 190, 210);
  const l1 = L.line(S, a, b), l2 = L.line(S, c, d);
  st.currentTool = TOOL_MODES.DIMENSION; resetDimensionState(st);
  const ids = first ? [l1, l2] : [l2, l1];
  click(S, 130, 85, null, { shape: L.shape(S, ids[0]) });
  click(S, 160, 175, null, { shape: L.shape(S, ids[1]) });
  const k = st.constraints.find(x => x.type === 'distance' && x.shapes);
  assert(k, 'a line-to-line distance is created (order ' + (first ? '1,2' : '2,1') + ')');
  assert(k.value > 0, 'the stored value is a positive distance: ' + k.value);
  assert(!L.isDriven(k), 'it is driving, not a reference (order ' + (first ? '1,2' : '2,1') + '): ' + (k.drivenReason || ''));
  assert.strictEqual(!!st._undoGroupActive, false);
  resetDimensionState(st);
}

// ---------------------------------------------------------------- NEW-3: perpendicular from an exactly parallel start
const perpFrom = (dx, dy, setup) => {
  const S = L.newSketch();
  const mk = (x, y, ex, ey) => { const p = L.point(S, x, y), q = L.point(S, x + ex, y + ey); return { id: L.line(S, p, q), p, q }; };
  const l1 = mk(100, 100, 60, 0), l2 = mk(250, 110, dx, dy);
  if (setup) setup(S, l1, l2);
  const c = ConstraintManager.createConstraint(S.state, 'perpendicular', { shapes: [l1.id, l2.id] }, { source: 'audit' });
  S.engine.solve(L.ITER);
  const u = [J(S, l1.q).x - J(S, l1.p).x, J(S, l1.q).y - J(S, l1.p).y], v = [J(S, l2.q).x - J(S, l2.p).x, J(S, l2.q).y - J(S, l2.p).y];
  return { S, c, l1, l2, dot: (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)), v, p2: J(S, l2.p), q2: J(S, l2.q), nullity: L.nullity(S) };
};
{
  for (const [dx, dy, name] of [[60, 0, 'parallel'], [-60, 0, 'anti-parallel'], [60, 0.01, '0.01 degree'], [60, 30, '27 degree']]) {
    const r = perpFrom(dx, dy);
    assert(r.c, 'NEW-3: perpendicular accepted from a ' + name + ' start');
    assert(Math.abs(r.dot) < 1e-4, 'NEW-3: the lines end up perpendicular (cos ' + r.dot + ') from a ' + name + ' start');
    if (name === '0.01 degree') { const [la, lb] = [Math.hypot(60, 0), Math.hypot(J(r.S, r.l2.q).x - J(r.S, r.l2.p).x, J(r.S, r.l2.q).y - J(r.S, r.l2.p).y)]; assert(Math.abs(lb - 60) < 1e-3 && Math.abs(Math.hypot(J(r.S, r.l1.q).x - J(r.S, r.l1.p).x, J(r.S, r.l1.q).y - J(r.S, r.l1.p).y) - la) < 1e-3, 'task 521: both lengths unchanged from a near-parallel start (' + lb + ')'); }
  }
  // Fusion rule: the SECOND-picked line turns (counter-clockwise on the tie) about its midpoint; the first line stays
  const r = perpFrom(60, 0);
  assert(J(r.S, r.l1.p).x === 100 && J(r.S, r.l1.q).x === 160 && J(r.S, r.l1.p).y === 100, 'the first-picked line does not move');
  assert(Math.abs((r.p2.x + r.q2.x) / 2 - 280) < 1e-3 && Math.abs((r.p2.y + r.q2.y) / 2 - 110) < 1e-3, 'the second line turned about its midpoint (280,110)');
  assert(r.v[1] > 0, 'the tie goes counter-clockwise (v.y > 0): ' + r.v);
  assert.strictEqual(r.nullity, 8 - 1, 'perpendicular removes exactly one degree of freedom');
  // a fixed end of the second line is the pivot
  const f = perpFrom(60, 0, (S, l1, l2) => { J(S, l2.p).fixed = true; });
  assert(f.c && Math.abs(f.dot) < 1e-4, 'perpendicular with a fixed end of the second line is accepted and perpendicular');
  assert(f.p2.x === 250 && f.p2.y === 110, 'the fixed end did not move');
}

console.log('dimension-point-line.test.js: ok');
process.exit(0);
