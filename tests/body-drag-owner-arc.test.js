// TASK 538 -- dragging a shape by its BODY pulls the point that was grabbed (definitions.js BODY_POINTS, the mouse spring's body form).
// The owner's case (2026-11-12): an arc whose centre is held on the Y axis by a vertical-with-origin constraint and 50 from the origin by a
// dimension, its ends free. Pulling the arc's body (its lowest point) down by 10 grows the radius by 10: the centre stays, both ends keep their
// angles, the sweep keeps its sign and size (no complement, no collapse); pulling back up returns. Through the app's real pointer path
// (handleSelectionPointerDown / Move / Up) plus the app's per-frame engine.solve after every move (apps/sketchstudio/main.js loop()), the same
// sequence tests/harness/fusion-oracle/drag-cells.js runOurs replays. World y points down (SVG), so "down" is +y.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { arcByTool, measureArc } from './harness/coverage/arcs-variants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';

const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
const muted = (f) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; } };

const S = L.newSketch(), st = S.state;
const R0 = 30, A = arcByTool(S, 0, 50, R0, 140, 20 * Math.PI / 180);   // centre (0, 50), ends at 20 and 160 degrees: the arc hangs below its centre
const [c, s, e] = A.joints;
const mk = (type, params) => ConstraintManager.createConstraint(st, type, params, { source: 'audit' });
muted(() => { assert.ok(mk('vertical', { joints: [L.origin, c] }), 'vertical with the origin'); assert.ok(mk('distance', { joints: [L.origin, c], value: 50, dimMode: 'aligned' }), 'the 50 dimension'); S.engine.solve(L.ITER); });
const pos = (id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const ang = (id) => { const p = pos(id), q = pos(c); return Math.atan2(p.y - q.y, p.x - q.x) * 180 / Math.PI; };
const state0 = () => ({ c: pos(c), sA: ang(s), eA: ang(e), m: measureArc(S, A.shape) });
const drag = (from, to) => {
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const ev = (p) => ({ clientX: p.x, clientY: p.y, pointerId: 1, target: { closest: () => null, dataset: {} } });
  muted(() => {
    assert.ok(handleSelectionPointerDown(ev(from), SVG, st, null, { shape: L.shape(S, A.shape), pt: { ...from } }, null), 'the body drag starts');
    for (let i = 1; i <= 20; i++) { handleSelectionPointerMove(ev({ x: from.x + (to.x - from.x) * i / 20, y: from.y + (to.y - from.y) * i / 20 }), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500); }
    handleSelectionPointerUp(ev(to), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500);
  });
  assert.ok(!L.shape(S, A.shape).dragTarget, 'pointer-up clears the body target');
  assert.ok([...st.joints.values()].every(j => !j.dragTarget), 'a body drag sets no joint target');
};
const check = (tag, b, a, wantR) => {
  assert.ok(Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) < 1e-4, `${tag}: the held centre stays (moved ${Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y)})`);
  assert.ok(Math.abs(a.m.R - wantR) < 0.05, `${tag}: radius ${a.m.R}, expected ${wantR}`);
  assert.ok(Math.abs(a.m.Re - a.m.R) < 1e-4, `${tag}: both ends on one circle (${a.m.R} / ${a.m.Re})`);
  assert.ok(Math.abs(a.sA - b.sA) < 0.1 && Math.abs(a.eA - b.eA) < 0.1, `${tag}: the ends keep their angles (${b.sA.toFixed(3)} -> ${a.sA.toFixed(3)}, ${b.eA.toFixed(3)} -> ${a.eA.toFixed(3)})`);
  assert.strictEqual(a.m.dir, b.m.dir, `${tag}: the sweep keeps its sign`);
  assert.ok(Math.abs(a.m.spanDeg - b.m.spanDeg) < 0.1, `${tag}: the sweep keeps its size, no complement / collapse (${b.m.spanDeg} -> ${a.m.spanDeg})`);
  const res = L.residuals(S);
  assert.ok(res.max < 1e-6, `${tag}: every constraint and dimension holds after the drag (worst residual ${res.max}, ${L.describe(res.worst)})`);
  console.log(`${tag}: centre (${a.c.x.toFixed(4)}, ${a.c.y.toFixed(4)}), radius ${b.m.R.toFixed(4)} -> ${a.m.R.toFixed(4)}, end angles ${a.sA.toFixed(3)} / ${a.eA.toFixed(3)}, sweep ${a.m.signedDeg.toFixed(3)} deg, worst residual ${res.max.toExponential(1)}`);
};

const before = state0();
assert.ok(Math.abs(before.m.R - R0) < 1e-9 && Math.abs(before.c.x) < 1e-9 && Math.abs(before.c.y - 50) < 1e-9, 'the arc starts at its drawn place');
const bottom = { x: 0, y: 50 + R0 };   // the arc's lowest point (angle 90 in y-down world)
drag(bottom, { x: 0, y: bottom.y + 10 });
const down = state0();
check('pulled down 10', before, down, R0 + 10);
drag({ x: 0, y: bottom.y + 10 }, bottom);
check('pulled back up 10', down, state0(), R0);
console.log('body-drag-owner-arc: ok');
