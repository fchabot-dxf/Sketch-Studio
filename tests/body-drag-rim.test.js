// TASK 538 -- a RIM body drag (circle, arc): the radius changes and the CENTRE stays wherever the constraints allow it (owner 2026-11-12,
// like Fusion); the centre moves only when the pull cannot be followed with it kept (definitions.js BODY_POINTS rim entry: prefersHold
// [centre], slides; engine.bodyDragTarget). Through the app's real pointer path (handleSelectionPointerDown / Move / Up) plus the app's
// per-frame engine.solve after every move (apps/sketchstudio/main.js loop()), as tests/harness/fusion-oracle/drag-cells.js runOurs does.
// After every drag: the temporary hold left nothing behind (no `fixed` flag, no drag target) and the document differs from the pre-drag
// one only in coordinates / radii; every constraint and dimension holds.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { arcByTool, measureArc } from './harness/coverage/arcs-variants.js';
import { arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';

const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
const muted = (f) => { const l = console.log, e = console.error, w = console.warn; console.log = () => {}; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; } };
const mk = (S, type, params) => muted(() => ConstraintManager.createConstraint(S.state, type, params, { source: 'audit' }));
const lock = (S, ids) => muted(() => { S.state.selectedJoints = new Set(ids); toggleFixedSelection(S.state); S.state.selectedJoints = new Set(); });
const P = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: j.y }; };
const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
// the document with every number blanked: a drag may change coordinates and radii, nothing else (no flag, no key, no constraint)
const shapeOfDoc = (S) => JSON.stringify({ joints: [...S.state.joints], shapes: S.state.shapes, constraints: S.state.constraints }, (k, v) => (typeof v === 'number' ? 0 : v));

function drag(S, shapeId, from, to) {
  const st = S.state, doc0 = shapeOfDoc(S);
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const ev = (p) => ({ clientX: p.x, clientY: p.y, pointerId: 1, target: { closest: () => null, dataset: {} } });
  muted(() => {
    assert.ok(handleSelectionPointerDown(ev(from), SVG, st, null, { shape: L.shape(S, shapeId), pt: { ...from } }, null), 'the body drag starts');
    for (let i = 1; i <= 20; i++) { handleSelectionPointerMove(ev({ x: from.x + (to.x - from.x) * i / 20, y: from.y + (to.y - from.y) * i / 20 }), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500); }
    handleSelectionPointerUp(ev(to), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500);
  });
  assert.strictEqual(shapeOfDoc(S), doc0, 'the drag changed only coordinates / radii (no hold, flag, drag target or constraint left behind)');
  const res = L.residuals(S);
  assert.ok(res.max < 1e-6, `every constraint and dimension holds after the drag (worst ${res.max}, ${L.describe(res.worst)})`);
}

// --- a FREE circle by its rim: the centre stays, the radius follows the cursor (out, in, diagonal)
for (const [name, to, wantR] of [['out', { x: 130, y: 100 }, 30], ['in', { x: 112, y: 100 }, 12], ['diagonal', { x: 127, y: 107 }, Math.hypot(27, 7)]]) {
  const S = L.newSketch();
  const C = L.circle(S, 100, 100, 20);
  drag(S, C.id, { x: 120, y: 100 }, to);
  const c = P(S, C.c), r = L.shape(S, C.id).radius;
  assert.ok(d(c, { x: 100, y: 100 }) < 1e-6, `free circle pulled ${name}: the centre stays (moved ${d(c, { x: 100, y: 100 })})`);
  assert.ok(Math.abs(r - wantR) < 1e-3, `free circle pulled ${name}: radius ${r}, expected ${wantR}`);
  console.log(`free circle pulled ${name}: centre kept, radius 20 -> ${r.toFixed(4)}`);
}

// --- a FREE arc by its body: the centre stays, the radius becomes |cursor - centre| (out, in, tangential, diagonal), the ends keep their
// angles, the sweep its sign and size (Fusion, task 540: the centre never moves, never a rigid translate)
for (const [name, to] of [['out', { x: 100, y: 138 }], ['in', { x: 100, y: 122 }], ['tangential', { x: 82, y: 130 }], ['diagonal', { x: 87.3, y: 142.7 }]]) {
  const S = L.newSketch();
  const A = arcByTool(S, 100, 100, 30, 140, 20 * Math.PI / 180);
  const [c, s, e] = A.joints, ang = (id) => Math.atan2(P(S, id).y - P(S, c).y, P(S, id).x - P(S, c).x) * 180 / Math.PI;
  const m0 = measureArc(S, A.shape), a0 = [ang(s), ang(e)];
  drag(S, A.shape, { x: 100, y: 130 }, to);
  const m1 = measureArc(S, A.shape), want = d(to, { x: 100, y: 100 });
  assert.ok(d(P(S, c), { x: 100, y: 100 }) < 1e-6, `free arc pulled ${name}: the centre stays`);
  assert.ok(Math.abs(m1.R - want) < 1e-3 && Math.abs(m1.Re - want) < 1e-3, `free arc pulled ${name}: radius 30 -> ${m1.R} / ${m1.Re}, expected |cursor - centre| = ${want}`);
  assert.ok(Math.abs(ang(s) - a0[0]) < 0.05 && Math.abs(ang(e) - a0[1]) < 0.05, `free arc pulled ${name}: the ends keep their angles (${a0.map(v => v.toFixed(3))} -> ${ang(s).toFixed(3)}, ${ang(e).toFixed(3)})`);
  assert.ok(m1.dir === m0.dir && Math.abs(m1.spanDeg - m0.spanDeg) < 0.05, `free arc pulled ${name}: the sweep keeps its sign and size (${m0.signedDeg} -> ${m1.signedDeg})`);
  console.log(`free arc by its body, pulled ${name}: centre kept, radius 30 -> ${m1.R.toFixed(4)} (|cursor - centre| ${want.toFixed(4)}), sweep ${m1.signedDeg.toFixed(3)} deg`);
}

// --- an arc with BOTH ENDS FIXED: the centre cannot be kept (the radius is then determined), so it is released: the bulge changes, the
// ends stay, the arc passes through the cursor and keeps its direction, also across a half circle (pulled out 18: 140 -> 213 degrees). The
// stored largeArc flag is NOT recomputed (finding EA-2, not this task): printed, not asserted.
for (const [name, to] of [['out', { x: 100, y: 148 }], ['in', { x: 100, y: 118 }], ['tangential', { x: 82, y: 130 }], ['diagonal', { x: 87.3, y: 142.7 }]]) {
  const S = L.newSketch();
  const A = arcByTool(S, 100, 100, 30, 140, 20 * Math.PI / 180);
  const [c, s, e] = A.joints;
  lock(S, [s, e]);
  const s0 = P(S, s), e0 = P(S, e), m0 = measureArc(S, A.shape), c0 = P(S, c);
  drag(S, A.shape, { x: 100, y: 130 }, to);
  const m1 = measureArc(S, A.shape), C = P(S, c), sh = L.shape(S, A.shape);
  assert.ok(d(P(S, s), s0) < 1e-9 && d(P(S, e), e0) < 1e-9, `arc with fixed ends pulled ${name}: the ends stay`);
  assert.ok(d(C, c0) > 1 && Math.abs(C.x - 100) < 1e-6, `arc with fixed ends pulled ${name}: the centre moves along the chord's bisector (${C.x}, ${C.y})`);
  assert.ok(Math.abs(d(to, C) - m1.R) < 1e-3, `arc with fixed ends pulled ${name}: the arc passes through the cursor (|cursor - centre| - R = ${d(to, C) - m1.R})`);
  const info = arcSweepInfo(C, P(S, s), P(S, e), { largeArc: sh.largeArc, sweep: sh.sweep });
  assert.ok(m1.dir === m0.dir && angleInArcSweep(info, Math.atan2(to.y - C.y, to.x - C.x)), `arc with fixed ends pulled ${name}: same direction, the cursor inside the arc's sweep`);
  console.log(`arc with fixed ends pulled ${name}: ends kept, centre (100,100) -> (${C.x.toFixed(3)}, ${C.y.toFixed(3)}), radius ${m0.R.toFixed(3)} -> ${m1.R.toFixed(3)}, sweep ${m0.signedDeg.toFixed(2)} -> ${m1.signedDeg.toFixed(2)} deg, stored largeArc ${sh.largeArc} (coherent with the span: ${m1.flagCoherent}; EA-2)`);
}

// --- a circle with a RADIUS DIMENSION: the radius cannot change, so the centre is released: the circle translates
{
  const S = L.newSketch();
  const C = L.circle(S, 100, 100, 20);
  assert.ok(mk(S, 'distance', { shape: C.id, value: 20, isRadius: true }), 'the radius dimension');
  drag(S, C.id, { x: 120, y: 100 }, { x: 130, y: 100 });
  const c = P(S, C.c), r = L.shape(S, C.id).radius;
  assert.ok(Math.abs(r - 20) < 1e-6, 'radius-dimensioned circle: the radius stays 20');
  assert.ok(Math.abs(c.x - 110) < 1e-3 && Math.abs(c.y - 100) < 1e-3, `radius-dimensioned circle: translates by the pull (centre ${c.x}, ${c.y})`);
  console.log(`circle with a radius dimension: translates, centre (100,100) -> (${c.x.toFixed(4)}, ${c.y.toFixed(4)})`);
}

// --- a circle with a HELD centre AND a radius dimension: nothing can move, nothing moves
{
  const S = L.newSketch();
  const C = L.circle(S, 100, 100, 20);
  lock(S, [C.c]);
  assert.ok(mk(S, 'distance', { shape: C.id, value: 20, isRadius: true }), 'the radius dimension');
  drag(S, C.id, { x: 120, y: 100 }, { x: 127, y: 106 });
  assert.ok(d(P(S, C.c), { x: 100, y: 100 }) < 1e-9 && Math.abs(L.shape(S, C.id).radius - 20) < 1e-9, 'held centre + radius dimension: nothing moves');
  console.log('circle with a held centre and a radius dimension: nothing moves');
}
console.log('body-drag-rim: ok');
