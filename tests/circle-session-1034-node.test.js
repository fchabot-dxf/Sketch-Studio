// tests/circle-session-1034-node.test.js — TASK 1034 (the input unification trial, plan docs/INPUT-UNIFY-PLAN-1031.md 5.1, proof items 1-4).
// The Circle tool runs in the tool session (#ui/tool-session.js): the same step = the same result whatever the device. Each case below draws one
// circle in a fresh SketchStudio (real DOM events through input-manager, the translators and the value box) and reads back:
//   - the document (shapes + constraints, ids normalised): identical inside each group;
//   - the session's step log: the same steps (centre, rim) with the same picks and values in every case (only `via` differs);
//   - the build counter: ONE build per circle.
// Group A, a typed diameter 60, four ways: mouse Enter, mouse click, touch Enter, touch tap.
// Group B, nothing typed, a joint (b) under the rim: mouse click-click, mouse click + hover + Enter (C-1 / X-01: Enter keeps the snap the
// cursor shows, so it too gives point-on-circle), touch tap-tap; and drag-release (mouse and touch) = click-click.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { toolSession } from '#ui/tool-session.js';
import { CIRCLE } from '#ui/input-handlers/circle-tool.js';

const doc = () => ({
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 40, y: 0, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [{ id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' }],
    constraints: [], parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

async function openApp() {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'T1034', doc());
  const app = await open({ host: 'sketchstudio', profile });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 30, y: 0, w: 200 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}

const T = { pointerType: 'touch' };
const tap = (app, p) => { app.down(p.x, p.y, T); app.up(p.x, p.y, T); };
const tapBox = (app) => app.press(app.document.getElementById('dimInput'));
const fingerDrag = (app, a, b, steps = 8) => { app.down(a.x, a.y, T); for (let i = 1; i <= steps; i++) app.move(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, { ...T, buttons: 1 }); app.up(b.x, b.y, T); };

// the document the case made: every joint / shape / constraint id replaced by its order of appearance, numbers rounded, transient fields dropped
function normalisedDoc(state) {
  const names = new Map();
  const name = (id) => { if (!names.has(id)) names.set(id, `#${names.size}`); return names.get(id); };
  const ids = new Set([...state.joints.keys(), ...state.shapes.map((s) => s.id), ...state.constraints.map((c) => c.id).filter(Boolean)]);
  const norm = (v) => {
    if (typeof v === 'string') return ids.has(v) ? name(v) : v;
    if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).filter((k) => !k.startsWith('_') && k !== 'glyphPos').sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  const shapes = norm(state.shapes);
  const joints = norm([...state.joints.entries()].filter(([id]) => state.shapes.some((s) => s.joints.includes(id))).map(([id, j]) => ({ id, x: j.x, y: j.y })));
  return JSON.stringify({ shapes, joints, constraints: norm(state.constraints.filter((c) => c.type !== 'mouse_spring')) });
}
// the session's step log, without `via` (the only field allowed to differ between devices)
const picksOf = (log) => JSON.stringify(log.filter((e) => e.result === 'picked').map(({ via, ...rest }) => rest), (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
const viasOf = (log) => log.filter((e) => e.result === 'picked').map((e) => e.via).join(',');

const W = { centre: [10, 20], rimHover: [30, 20], b: [40, 0] };
async function drawCase(label, fn) {
  const app = await openApp();
  try {
    app.tool('circle');
    const s = (k) => app.toScreen(...W[k]);
    fn(app, s);
    const session = toolSession(app.state, CIRCLE);
    const out = { label, doc: normalisedDoc(app.state), picks: picksOf(session.log), vias: viasOf(session.log), builds: session.builds, active: app.state.active, circles: app.state.shapes.filter((x) => x.type === 'circle').length };
    console.log(`  ${label}: builds=${out.builds} vias=${out.vias} circles=${out.circles}`);
    return out;
  } finally { await app.close(); }
}

const typed = [
  await drawCase('A1 mouse: click centre, type 60, Enter', (app, s) => { app.click(s('centre').x, s('centre').y); app.move(s('rimHover').x, s('rimHover').y); app.type('60'); app.enter(); }),
  await drawCase('A2 mouse: click centre, type 60, click', (app, s) => { app.click(s('centre').x, s('centre').y); app.move(s('rimHover').x, s('rimHover').y); app.type('60'); app.click(s('rimHover').x, s('rimHover').y); }),
  await drawCase('A3 touch: tap centre, tap box, type 60, Enter', (app, s) => { tap(app, s('centre')); tapBox(app); app.type('60'); app.enter(); }),
  await drawCase('A4 touch: tap centre, tap box, type 60, tap canvas', (app, s) => { tap(app, s('centre')); tapBox(app); app.type('60'); tap(app, s('rimHover')); }),
];
const untyped = [
  await drawCase('B1 mouse: click centre, click b', (app, s) => { app.click(s('centre').x, s('centre').y); app.move(s('b').x, s('b').y); app.click(s('b').x, s('b').y); }),
  await drawCase('B2 mouse: click centre, hover b, Enter', (app, s) => { app.click(s('centre').x, s('centre').y); app.move(s('b').x, s('b').y); app.enter(); }),
  await drawCase('B3 touch: tap centre, tap b', (app, s) => { tap(app, s('centre')); tap(app, s('b')); }),
  await drawCase('B4 mouse: drag centre -> b', (app, s) => { app.drag(s('centre'), s('b')); }),
  await drawCase('B5 touch: drag centre -> b', (app, s) => { fingerDrag(app, s('centre'), s('b')); }),
];

for (const group of [typed, untyped]) {
  for (const c of group) {
    assert.strictEqual(c.circles, 1, `${c.label}: one circle`);
    assert.strictEqual(c.builds, 1, `${c.label}: the ONE build ran once`);
    assert.strictEqual(c.active, null, `${c.label}: the draw finished`);
    assert.strictEqual(c.doc, group[0].doc, `${c.label}: the same document as ${group[0].label}\n${c.doc}\nvs\n${group[0].doc}`);
    assert.strictEqual(c.picks, group[0].picks, `${c.label}: the same steps, picks and values as ${group[0].label}\n${c.picks}\nvs\n${group[0].picks}`);
  }
}
const A = JSON.parse(typed[0].doc), B = JSON.parse(untyped[0].doc);
const circleA = A.shapes.find((s) => s.type === 'circle'), circleB = B.shapes.find((s) => s.type === 'circle');
assert.strictEqual(circleA.radius, 30, 'typed: radius 30 (diameter 60)');
assert.ok(A.constraints.some((c) => c.type === 'distance' && c.isDiameter && c.value === 60), 'typed: the diameter dimension 60');
assert.ok(!A.constraints.some((c) => c.type === 'pointOnLine'), 'typed: no point-on-circle (a typed size takes no snap)');
assert.ok(B.constraints.some((c) => c.type === 'pointOnLine' && Array.isArray(c.joints) && c.joints.includes(B.joints.find((j) => j.x === 40 && j.y === 0).id) && c.shapes && c.shapes.includes(circleB.id)) ||
  B.constraints.some((c) => c.type === 'pointOnLine' && JSON.stringify(c).includes(circleB.id)), `untyped: b is ON the circle (point-on-circle) ${JSON.stringify(B.constraints)}`);
assert.ok(Math.abs(circleB.radius - Math.hypot(30, 20)) < 1e-6, 'untyped: the rim on b');
assert.deepStrictEqual(JSON.parse(typed[0].picks).map((p) => p.step), ['centre', 'rim'], 'the step log: centre, rim');
assert.deepStrictEqual([...new Set(untyped.map((c) => c.vias))].sort(), ['click,click', 'click,enter', 'click,release'].sort(), 'only `via` differs: click / enter / release');
console.log("typed doc", typed[0].doc); console.log("untyped doc", untyped[0].doc); console.log("step log (B1)", untyped[0].picks);
console.log("PASS circle-session-1034-node");
