// tests/drag-like-fusion-node.test.js -- TASK 582 (node, through tests/helpers/node-app.js): two drag behaviours made like Fusion, from the
// advisor's measurements in Fusion 360 with the real mouse (new unsaved document, sketch on XY, cm; ours is mm, so every Fusion number x 10).
//  M1  a HELD point dragged over a target. Construction line C (0,0) -> (10,5), both ends fixed; a line (2,-3) fixed -> P (6,3), P on C (point on
//      line); a free sketch point Q (8, 4.3), 0.3 off C. Press on P, move onto Q's screen position, release.
//      Fusion: P slid along C to (6.709, 3.355), NO constraint added (count 1 -> 1), Q did not move.
//  M2  the control: a FREE point R (2, 6) dragged the same way onto Q. Fusion: R lands exactly on Q and a Coincident R-Q is ADDED (1 -> 2).
//      => the snap is decided where the DRAGGED POINT is after solving, not where the cursor is (selection-tools.js dragToward).
//  M3  an arc dragged by its CENTRE with one end FIXED: centre (-2,2), radius 1.2, start (-0.8,2) fixed, end (-2,3.2). Press on the centre, move
//      to (-3,3), release. Fusion: centre -> (-1.556, 2.932), start stays, end -> (-0.356, 2.943), radius stays 1.2, no constraint added: the arc
//      keeps its radius and PIVOTS about the fixed end. Before task 582 ours did not move at all (the cluster drag locked on the fixed rim).
//      Also: the end held by a coincident with a fixed point (held by constraints), and the end fixed + a radius dimension: the same pivot.
// The view: 130 mm across the 1314 px canvas (about 10 px per mm, 101 px per cm), so Q's 3 mm off C is about 27 px (more than the 16 px snap
// magnet); no grid magnet (GRID_MAGNETISM 0.001, as tests/arc-rim-drag-node.test.js), so the cursor, not a grid node, is what is followed.
// Tolerances: positions on a line / circle and radii 1e-6 mm (the solver's tolerance); "did not move" 1e-9 mm. Fusion's exact positions along the
// line / circle are NOT asserted (Fusion's drag is path dependent, tests/fusion-drag.test.js); ours are printed beside them (docs/FUSION-COMPARISON.md).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (p) => `(${(p.x / 10).toFixed(3)}, ${(p.y / 10).toFixed(3)}) cm`;
const residual = (st) => { let max = 0; for (const c of st.constraints) { if (!c || c.driven || c.type === 'mouse_spring') continue; const r = measureResidual(c, st.joints, st.shapes); if (!(r <= max)) max = r; } return max; };

// a stored design (the document record the app saves) from joints { id: [x, y, fixed] } (mm), shapes, constraints
function design(joints, shapes, constraints) {
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })), constraints,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
}
async function openDesign(doc, centre) {
  const profile = await createProfile();
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 582');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(doc, { app: 'sketchstudio', id }); }
  const app = await open({ host: 'sketchstudio', profile });
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w: 130 }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}
// the real mouse: press on the grabbed joint, 30 pointer moves in a straight line to `to` (world), release there
const dragJoint = quiet(async (app, id, to) => {
  const st = app.state, a = app.toScreen(pos(st, id).x, pos(st, id).y), b = app.toScreen(to.x, to.y);
  app.move(a.x, a.y); app.down(a.x, a.y);
  assert.ok(st.drag && st.drag.id === id, 'the press on ' + id + ' starts its drag');
  for (let k = 1; k <= 30; k++) app.move(a.x + (b.x - a.x) * k / 30, a.y + (b.y - a.y) * k / 30, { buttons: 1 });
  app.up(b.x, b.y);
  assert.ok(!st.drag, 'the drag ended');
});

// ---- M1 / M2: the scene (mm)
const SCENE = () => design(
  { c0: [0, 0, true], c1: [100, 50, true], a: [20, -30, true], p: [60, 30], q: [80, 43], r: [20, 60] },
  [{ id: 'C', type: 'line', joints: ['c0', 'c1'], isConstruction: true }, { id: 'L', type: 'line', joints: ['a', 'p'], isConstruction: false }],
  [{ type: 'pointOnLine', joint: 'p', shape: 'C' }]);
const offC = (pt) => Math.abs(pt.x * 50 - pt.y * 100) / Math.hypot(100, 50); // distance from the line through (0,0) and (100,50)

{ // M1: the held point P dragged onto Q
  const app = await openDesign(SCENE(), { x: 45, y: 15 });
  try {
    const st = app.state, n0 = st.constraints.length, q0 = pos(st, 'q');
    assert.ok(offC(pos(st, 'p')) < 1e-9 && residual(st) < 1e-6, 'the scene loads solved, P on C');
    await dragJoint(app, 'p', q0);
    const p = pos(st, 'p');
    console.log(`M1 held P dragged onto Q: P ${fmt(p)} (Fusion (6.709, 3.355) cm), off C ${offC(p).toExponential(1)} mm, constraints ${n0} -> ${st.constraints.length} (Fusion 1 -> 1), Q moved ${dist(pos(st, 'q'), q0).toExponential(1)} mm`);
    assert.strictEqual(st.constraints.length, n0, 'no constraint is added: P cannot reach Q, so it does not snap to it (' + JSON.stringify(st.constraints.slice(n0)) + ')');
    assert.ok(offC(p) < 1e-6, 'P stays on C (' + offC(p) + ' mm off)');
    assert.ok(dist(pos(st, 'q'), q0) < 1e-9, 'Q did not move');
    assert.ok(p.x > 60 + 1, 'P slid along C toward Q (' + fmt(p) + ')');
    assert.ok(residual(st) < 1e-6, 'every constraint holds (' + residual(st) + ')');
  } finally { await app.close(); }
}
{ // M2: the free point R dragged onto Q
  const app = await openDesign(SCENE(), { x: 45, y: 15 });
  try {
    const st = app.state, n0 = st.constraints.length, q0 = pos(st, 'q');
    await dragJoint(app, 'r', q0);
    const r = pos(st, 'r'), added = st.constraints.slice(n0);
    console.log(`M2 free R dragged onto Q: R ${fmt(r)} (Fusion (8, 4.3) cm, on Q), constraints ${n0} -> ${st.constraints.length} ${JSON.stringify(added.map((c) => [c.type, c.joints]))} (Fusion 1 -> 2, Coincident R-Q)`);
    assert.strictEqual(added.length, 1, 'one constraint is added');
    assert.ok(added[0].type === 'coincident' && added[0].joints.includes('r') && added[0].joints.includes('q'), 'it is a coincident R-Q');
    assert.ok(dist(r, q0) < 1e-6 && dist(pos(st, 'q'), q0) < 1e-6, 'R lands on Q, Q stays');
  } finally { await app.close(); }
}

// ---- M3: an arc by its centre, one end held (mm). The arc as the arc tool writes it: [centre, start, end], counter-clockwise (sweep), the
// radius equality of its two ends.
const ARC = (extraJoints, extraConstraints, startFixed) => design(
  { ac: [-20, 20], as: [-8, 20, startFixed], ae: [-20, 32], ...extraJoints },
  [{ id: 'A', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], largeArc: false, sweep: true }],
  [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }, ...extraConstraints]);
const CURSOR = { x: -30, y: 30 };
async function pivot(label, doc) {
  const app = await openDesign(doc, { x: -15, y: 25 });
  try {
    const st = app.state, n0 = st.constraints.length, s0 = pos(st, 'as'), c0 = pos(st, 'ac');
    await dragJoint(app, 'ac', CURSOR);
    const c = pos(st, 'ac'), s = pos(st, 'as'), e = pos(st, 'ae');
    const sweep = ((Math.atan2(e.y - c.y, e.x - c.x) - Math.atan2(s.y - c.y, s.x - c.x)) * 180 / Math.PI + 360) % 360;
    console.log(`M3 ${label}: centre ${fmt(c)} (Fusion (-1.556, 2.932) cm), start ${fmt(s)} (stays), end ${fmt(e)} (Fusion (-0.356, 2.943) cm), radius ${(dist(c, s) / 10).toFixed(4)} / ${(dist(c, e) / 10).toFixed(4)} cm (Fusion 1.2), sweep ${sweep.toFixed(1)} deg (Fusion about 51), centre to cursor ${(dist(c0, CURSOR) / 10).toFixed(3)} -> ${(dist(c, CURSOR) / 10).toFixed(3)} cm, constraints ${n0} -> ${st.constraints.length}`);
    assert.ok(dist(s, s0) < 1e-9, label + ': the held end did not move');
    assert.ok(Math.abs(dist(c, s) - 12) < 1e-6 && Math.abs(dist(c, e) - 12) < 1e-6, label + ': the radius stays 1.2 cm (' + dist(c, s) + ' / ' + dist(c, e) + ' mm)');
    assert.ok(dist(c, CURSOR) < dist(c0, CURSOR) - 1, label + ': the centre pivoted toward the cursor (' + fmt(c) + ')');
    assert.strictEqual(st.constraints.length, n0, label + ': no constraint is added');
    assert.ok(residual(st) < 1e-6, label + ': every constraint holds (' + residual(st) + ')');
  } finally { await app.close(); }
}
await pivot('start fixed (the measured drawing)', ARC({}, [], true));
await pivot('start held by a coincident with a fixed point', ARC({ f: [-8, 20, true] }, [{ type: 'coincident', joints: ['as', 'f'] }], false));
await pivot('start fixed + radius dimension 1.2 cm', ARC({}, [{ type: 'distance', shape: 'A', isRadius: true, value: 12, driven: false }], true));
console.log('drag-like-fusion-node: ok');
