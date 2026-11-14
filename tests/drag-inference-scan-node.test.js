// tests/drag-inference-scan-node.test.js -- TASK 594 (node, through tests/helpers/node-app.js, the app's own pointer listeners): while a SINGLE
// point is dragged, no inference the point cannot satisfy is offered.
// Cause (found by task 584): packages/core/inference-engine.js findInference ran the attached-line tests (H / V, parallel / perpendicular of a
// line through the dragged joint, midpoint) for a joint drag and then ALSO the DRAWING scan, which reads the move from the drag start to the
// cursor as a line being drawn: a tangent to a circle / arc the start lies on, parallel / perpendicular to a nearby line. That is the point's
// MOTION, not a line of the sketch: the inferred position is on a line through the start, and the relation it names does not hold there for any
// line through the point (a lone point has no line at all). Now the drawing scan runs only when a line is DRAWN (no drag in the options).
// Fusion (measured with the real mouse, docs/FUSION-COMPARISON.md "Dragging: inferences of a single point (task 594)"): dragging a lone point on a
// circle, a line end on a circle, a free line end (parallel to a nearby line or along its own line) or a line end shared with an arc end along its
// tangent shows NO inference and adds nothing; a free line end turned horizontal shows the Horizontal glyph and adds it (an attached-line test).
// A case that fails on the code before shows "FAIL <case>" in the output: an inference whose relation does not hold at its position (or one
// whose reference is the dragged point's own line, which names no relation at all and only pinned the point on its own direction).
// Each case: a stored design (mm), one press on the point, pointer moves along a path, release. Per event the shown inference (state.inference,
// what the renderer draws) is checked at its position: the relation it names must hold for every line through the dragged point (the release
// adds it to each of them, selection-tools.js handleSelectionPointerUp). Controls: the LINE tool still gets its tangent / parallel /
// perpendicular inference; an attached-line inference of a drag (a line end made parallel to another line) is still offered.
// The view: 130 mm across, no grid magnet (GRID_MAGNETISM 0.001, as tests/drag-like-fusion-node.test.js).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r) => r * 180 / Math.PI;

function design(joints, shapes, constraints) {
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })), constraints,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
}
async function openDesign(doc, centre) {
  const profile = await createProfile();
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 594');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(doc, { app: 'sketchstudio', id }); }
  const app = await open({ host: 'sketchstudio', profile });
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w: 130 }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}

// Does the inference `inf` (state.inference) hold with the dragged point `id` at inf.pos? Returns null when it does, else why not. The release adds
// its relation to EVERY line through the point (other than the reference), so each must satisfy it; a point with no line cannot satisfy a
// parallel / perpendicular / tangent at all.
function unsatisfied(st, id, inf) {
  const p = inf.pos;
  const lines = st.shapes.filter((s) => s.type === 'line' && s.joints.includes(id) && s.id !== inf.targetId);
  const dirOf = (s) => { const o = pos(st, s.joints[0] === id ? s.joints[1] : s.joints[0]); return { o, a: Math.atan2(p.y - o.y, p.x - o.x) }; };
  const ref = st.shapes.find((s) => s.id === inf.targetId);
  const ownLine = ref && ref.joints.includes(id);
  if ((inf.type === 'parallel' || inf.type === 'perpendicular' || inf.type === 'tangent') && !lines.length) return ownLine ? 'its reference is the line of the dragged point itself' : 'no line through the point';
  if (inf.type === 'parallel' || inf.type === 'perpendicular') {
    const end = (k) => ref.joints[k] === id ? p : pos(st, ref.joints[k]); // the reference with the dragged point at the inferred position
    const ra = Math.atan2(end(1).y - end(0).y, end(1).x - end(0).x);
    for (const s of lines) {
      let d = deg(dirOf(s).a - ra) % 180; if (d < 0) d += 180; // 0 or 180 = parallel, 90 = perpendicular
      const err = inf.type === 'parallel' ? Math.min(d, 180 - d) : Math.abs(d - 90);
      if (err > 0.01) return `${s.id} is ${err.toFixed(2)} deg off ${inf.type} to ${inf.targetId} at the inferred position`;
    }
    return null;
  }
  if (inf.type === 'tangent') {
    const c = pos(st, ref.joints[0]), r = ref.type === 'circle' ? ref.radius : dist(c, pos(st, ref.joints[1]));
    for (const s of lines) {
      const { o } = dirOf(s), L = dist(o, p);
      const off = Math.abs((p.x - o.x) * (o.y - c.y) - (o.x - c.x) * (p.y - o.y)) / L; // centre to the line's infinite line
      if (Math.abs(off - r) > 1e-3) return `${s.id} passes ${off.toFixed(3)} mm from ${inf.targetId}'s centre (radius ${r.toFixed(3)}) at the inferred position`;
    }
    return null;
  }
  return null; // H / V / midpoint: the attached-line tests place the point where the relation holds
}

// press on joint `id`, one pointer move per world point of `path`, release at the last one; every shown inference with whether it holds
const dragAlong = quiet(async (app, id, path) => {
  const st = app.state, a = app.toScreen(pos(st, id).x, pos(st, id).y), n0 = st.constraints.length;
  app.move(a.x, a.y); app.down(a.x, a.y);
  assert.ok(st.drag && st.drag.id === id, 'the press on ' + id + ' starts its drag');
  const type = st.drag.type, shown = [], snaps = new Map();
  let last = a;
  for (const w of path) {
    const s = app.toScreen(w.x, w.y); app.move(s.x, s.y, { buttons: 1 }); last = s;
    if (st.activeSnap) { const k = st.activeSnap.type + ':' + (st.activeSnap.targetId || (st.activeSnap.shape && st.activeSnap.shape.id) || ''); snaps.set(k, (snaps.get(k) || 0) + 1); }
    if (st.inference) shown.push({ type: st.inference.type, target: st.inference.targetId, why: unsatisfied(st, id, st.inference) });
  }
  app.up(last.x, last.y);
  assert.ok(!st.drag, 'the drag ended');
  return { type, shown, snaps: [...snaps].map(([k, n]) => `${n} x ${k}`).join(', ') || 'none', added: st.constraints.slice(n0).map((c) => [c.type, c.shapes || c.joints || [c.line, c.circle]]) };
});
const linePath = (from, to, n = 30) => Array.from({ length: n }, (_, k) => ({ x: from.x + (to.x - from.x) * (k + 1) / n, y: from.y + (to.y - from.y) * (k + 1) / n }));

const summary = (shown) => { const m = new Map(); for (const s of shown) { const k = `${s.type}:${s.target} ${s.why ? 'CANNOT (' + s.why.replace(/[-\d.]+ (deg|mm)/g, '#') + ')' : 'holds'}`; m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([k, n]) => `${n} x ${k}`).join('; ') || 'none'; };
let failed = 0;
async function check(label, doc, centre, id, path, expect = {}) {
  const app = await openDesign(doc, centre);
  try {
    const r = await dragAlong(app, id, path);
    const bad = r.shown.filter((s) => s.why);
    console.log(`${label}: drag ${r.type}; ${path.length} events, inference shown on ${r.shown.length}: ${summary(r.shown)}; snap shown ${r.snaps}; added at release ${JSON.stringify(r.added)}`);
    assert.strictEqual(r.type, 'joint', label + ': precondition, a single-joint drag');
    if (bad.length) { failed++; console.log(`  FAIL ${label}: ${bad.length} events offer an inference the point cannot satisfy, e.g. ${bad[0].type}:${bad[0].target} (${bad[0].why})`); }
    if (expect.shows) assert.ok(r.shown.some((s) => s.type === expect.shows && !s.why), label + ': still offers its ' + expect.shows + ' inference (' + summary(r.shown) + ')');
  } finally { await app.close(); }
}

// Every scene sits around O, away from the X / Y axes (their snap would hide the inference), in the view centred on O.
const O = { x: 40, y: 30 };
const at = (dx, dy) => ({ x: O.x + dx, y: O.y + dy });
const J = (o) => Object.fromEntries(Object.entries(o).map(([k, [dx, dy, f]]) => [k, [O.x + dx, O.y + dy, f]]));
const arcPath = (r, a0, a1, n = 30) => Array.from({ length: n }, (_, k) => { const t = (a0 + (a1 - a0) * (k + 1) / n) * Math.PI / 180; return at(r * Math.cos(t), r * Math.sin(t)); });
const ray = (from, angleDeg, len, n = 30) => linePath(from, { x: from.x + len * Math.cos(angleDeg * Math.PI / 180), y: from.y + len * Math.sin(angleDeg * Math.PI / 180) }, n);
const line = (id, a, b, isConstruction = false) => ({ id, type: 'line', joints: [a, b], isConstruction });

// ---- 1. a point ON A CIRCLE (point on curve): circle C centre O, r 20; P = O + (20, 0) on C. Dragged along C (the cursor on C: the curve
// snap is shown) and along C's tangent at P (straight up, 12 mm: the cursor leaves C).
const CIRCLE = (joints = {}, shapes = [], constraints = []) => design(J({ cc: [0, 0], p: [20, 0], ...joints }),
  [{ id: 'C', type: 'circle', joints: ['cc'], radius: 20, isConstruction: false }, ...shapes], [{ type: 'pointOnLine', joint: 'p', shape: 'C' }, ...constraints]);
const scenes1 = [
  ['1a lone point on a circle', CIRCLE()],
  ['1b lone point on a circle, a vertical line 4 mm beside it', CIRCLE({ m0: [24, -20], m1: [24, 20] }, [line('M', 'm0', 'm1')])],
  ['1c line end on a circle', CIRCLE({ la: [45, -12] }, [line('L', 'la', 'p')])],
];
for (const [label, doc] of scenes1) {
  await check(label + ', along the circle', doc, O, 'p', arcPath(20, 0, 40));
  await check(label + ', along its tangent', doc, O, 'p', ray(at(20, 0), 90, 12));
}

// ---- 2. a FREE line end: L A = O -> B = O + (30, 10); M O + (15, 6) -> O + (45, 26), direction (3, 2), 5 mm from B.
const FREE = () => design(J({ a: [0, 0], b: [30, 10], m0: [15, 6], m1: [45, 26] }), [line('L', 'a', 'b'), line('M', 'm0', 'm1')], []);
await check('2a free line end, moved parallel to the nearby line M', FREE(), O, 'b', ray(at(30, 10), Math.atan2(2, 3) * 180 / Math.PI, 14));
await check('2b free line end, moved along its own line', FREE(), O, 'b', ray(at(30, 10), Math.atan2(1, 3) * 180 / Math.PI, 14));
// control: an attached-line inference is still offered: B moved to O + (24, 16), where L (from A) is parallel to M
await check('2c control, free line end turned until its line is parallel to M', FREE(), O, 'b', linePath(at(30, 10), at(24, 16)), { shows: 'parallel' });

// ---- 3. the end of a line ATTACHED TO AN ARC: arc A centre O, start S = O + (20, 0), end O + (0, 20), counter-clockwise; line L O + (40, -15) -> S
// SHARING the arc's start joint (as the line tool makes it when it starts on the arc's end: line-tool.js takes the snapped joint as the start).
const ARC_LINE = () => design(J({ ac: [0, 0], s: [20, 0], ae: [0, 20], la: [40, -15] }),
  [{ id: 'A', type: 'arc', subType: 'CENTER', joints: ['ac', 's', 'ae'], largeArc: false, sweep: true }, line('L', 'la', 's')],
  [{ type: 'equal', joints: ['ac', 's', 'ac', 'ae'] }]);
await check('3a line end shared with an arc end, along the arc (opening it)', ARC_LINE(), O, 's', arcPath(20, 0, -30));
await check('3b line end shared with an arc end, along the arc (closing it)', ARC_LINE(), O, 's', arcPath(20, 0, 30));
await check('3c line end shared with an arc end, along the tangent of the arc', ARC_LINE(), O, 's', ray(at(20, 0), -90, 12));

// ---- 4. a POLYGON corner, as the polygon tool makes it (core/shapes.js makePolygon: sides and construction radii share the corner joint, equal
// sides, equal radii). Hexagon centre O, radius 8 (its other sides and radii within findInference's 10-unit reach), corner K = O + (8, 0),
// moved 6 mm in each direction of 30 degrees.
const R = 8, H = R * Math.sqrt(3) / 2;
const HEX = () => {
  const c = [[R, 0], [R / 2, H], [-R / 2, H], [-R, 0], [-R / 2, -H], [R / 2, -H]];
  const joints = { pc: [0, 0] }; c.forEach((p, i) => { joints['k' + i] = p; });
  const shapes = [], cons = [];
  for (let i = 0; i < 6; i++) {
    shapes.push({ ...line('side' + i, 'k' + i, 'k' + ((i + 1) % 6)), groupId: 'poly_1' });
    shapes.push({ ...line('rad' + i, 'pc', 'k' + i, true), groupId: 'poly_1' });
  }
  for (let i = 0; i < 5; i++) { cons.push({ type: 'equal', shapes: ['side' + i, 'side' + (i + 1)] }); cons.push({ type: 'equal', shapes: ['rad' + i, 'rad' + (i + 1)] }); }
  return design(J(joints), shapes, cons);
};
for (let d = 0; d < 360; d += 30) await check(`4 polygon corner, moved at ${d} deg`, HEX(), O, 'k0', ray(at(R, 0), d, 6));

// ---- 5. control: the LINE tool (drawing) still gets its tangent / parallel / perpendicular inference
{
  const app = await openDesign(CIRCLE({ m0: [-40, 15], m1: [-10, 25], n0: [-40, -25], n1: [-30, -5] }, [line('M', 'm0', 'm1'), line('N', 'n0', 'n1')]), O);
  try {
    const st = app.state;
    const shownFrom = quiet(async (from, to) => { // the line tool: click at `from`, hover toward `to`: the inference shown at the last hover
      app.tool('line');
      const a = app.toScreen(from.x, from.y); app.click(a.x, a.y);
      let inf = null;
      for (const w of linePath(from, to, 10)) { const s = app.toScreen(w.x, w.y); app.move(s.x, s.y); inf = st.inference ? { type: st.inference.type, target: st.inference.targetId } : null; }
      app.esc();
      return inf;
    });
    // (skew directions: a drawn line within 3 deg of horizontal / vertical takes H / V first)
    const q = 20 / Math.SQRT2;
    const tangent = await shownFrom(at(q, q), at(q - 14, q + 14.3)); // from C at 45 deg, along its tangent (0.6 deg off)
    const parallel = await shownFrom(at(-25, 15), at(-10, 20.2)); // 4.7 mm beside M (direction (3, 1)), not touching it, 0.6 deg off
    const perpendicular = await shownFrom(at(-30, -5), at(-50, 5.3)); // from N's end (N direction (1, 2)), at right angles to N
    console.log(`5 control, line tool: tangent ${JSON.stringify(tangent)}, parallel ${JSON.stringify(parallel)}, perpendicular ${JSON.stringify(perpendicular)}`);
    assert.deepStrictEqual(tangent, { type: 'tangent', target: 'C' }, 'drawing from a circle along its tangent infers the tangent');
    assert.deepStrictEqual(parallel, { type: 'parallel', target: 'M' }, 'drawing beside a line along its direction infers parallel');
    assert.deepStrictEqual(perpendicular, { type: 'perpendicular', target: 'N' }, 'drawing from a line end at right angles infers perpendicular');
  } finally { await app.close(); }
}

assert.strictEqual(failed, 0, failed + ' case(s) offer a single-joint drag an inference the point cannot satisfy (see FAIL lines above)');
console.log('drag-inference-scan-node: ok');
