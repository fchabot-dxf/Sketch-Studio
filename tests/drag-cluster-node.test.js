// tests/drag-cluster-node.test.js -- TASK 584 (node, through tests/helpers/node-app.js, the app's own pointer listeners): three drag follow-ups found
// by task 582, each fail-first against the code before it.
//  1. An arc grabbed by its CENTRE with nothing holding it TRANSLATES WHOLE, like Fusion (oracle cells arc.free.centre.* and arc.rad.centre.*,
//     Fusion "MMM. translate"). Before, the select tool set a target on every member of the drag but the solver pulled only ONE joint (the first
//     carrying a target), so the rims followed the radius equality, not the drag: the arc stretched (free) or rotated (radius dimension).
//     Now every solve pulls every joint the drag carries (engine._jointDragSprings, selection-tools.js state.drag.carried). The same holds when a
//     rim is coincident with a line end (every solve of the drag, the app's frame solve included, pulls the same joints). A held centre still locks.
//  2. A joint COINCIDENT WITH THE ORIGIN (the owner's outer centre j7, welded to it) dragged near the origin is not offered j_origin as a snap
//     target: input-manager.js updateSnapTarget's explicit origin check now respects the drag's excluded joints, as findSnap does. Controls: a free
//     point dragged onto the origin still snaps to it (Coincident added at release); the LINE tool still snaps to the origin.
//  3. A CLUSTER drag (the owner's j3 corner: j3 = j14 = j16, an arc end, a side and a construction line) shows no inference: findInference read the
//     displacement start -> cursor as a line being drawn and showed a TANGENT to the inner arc although the side is radial; the release adds nothing.
// The view: no grid magnet (GRID_MAGNETISM 0.001, as tests/arc-rim-drag-node.test.js), so the cursor, not a grid node, is what is followed.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const OWNER = JSON.parse(fs.readFileSync(new URL('./fixtures/drag/owner-two-arcs-575.json', import.meta.url), 'utf8'));
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (p) => `(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`;
const residual = (st) => { let max = 0; for (const c of st.constraints) { if (!c || c.driven || c.type === 'mouse_spring') continue; const r = measureResidual(c, st.joints, st.shapes); if (!(r <= max)) max = r; } return max; };

// a stored design (the document record the app saves) from joints { id: [x, y, fixed] } (mm), shapes, constraints
function design(joints, shapes, constraints) {
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })), constraints,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [], vcarves: [] } };
}
// open the design in SketchStudio, the view `w` world units across centred on `centre`
async function openDesign(doc, centre, w) {
  const profile = await createProfile();
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 584');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(doc, { app: 'sketchstudio', id }); }
  const app = await open({ host: 'sketchstudio', profile });
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: centre.x, y: centre.y, w }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}
// the real mouse: press at the screen point of world `from`, then one pointer move per screen point of `path`, release at the last one; `each`
// runs after every move (the drag's state as the renderer sees it)
const drag = quiet(async (app, from, path, each = () => {}) => {
  const st = app.state, a = app.toScreen(from.x, from.y);
  app.move(a.x, a.y); app.down(a.x, a.y);
  assert.ok(st.drag, 'the press starts a drag');
  const info = { id: st.drag.id, type: st.drag.type, jointIds: st.drag.jointIds.slice() };
  let last = a;
  for (const p of path) { app.move(p.x, p.y, { buttons: 1 }); each(st); last = p; }
  app.up(last.x, last.y);
  assert.ok(!st.drag, 'the drag ended');
  return info;
});
const straight = (app, from, to, n = 30) => { const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y); return Array.from({ length: n }, (_, k) => ({ x: a.x + (b.x - a.x) * (k + 1) / n, y: a.y + (b.y - a.y) * (k + 1) / n })); };

// ---- 1. an arc by its centre (mm): [centre, start, end] counter-clockwise, the radius equality of its two ends, as the arc tool writes it
const ARC = (joints = {}, shapes = [], constraints = [], centreFixed = false) => design(
  { ac: [-20, 20, centreFixed], as: [-8, 20], ae: [-20, 32], ...joints },
  [{ id: 'A', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], largeArc: false, sweep: true }, ...shapes],
  [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }, ...constraints]);
const CURSOR = { x: -10, y: 26 };
async function translate(label, doc, check = () => {}) {
  const app = await openDesign(doc, { x: -15, y: 25 }, 130);
  try {
    const st = app.state, n0 = st.constraints.length, p0 = { c: pos(st, 'ac'), s: pos(st, 'as'), e: pos(st, 'ae') };
    const info = await drag(app, p0.c, straight(app, p0.c, CURSOR));
    const c = pos(st, 'ac'), s = pos(st, 'as'), e = pos(st, 'ae'), d = { x: c.x - p0.c.x, y: c.y - p0.c.y };
    const off = (p, q) => dist(p, { x: q.x + d.x, y: q.y + d.y });
    console.log(`1 ${label}: drag ${info.type} [${info.jointIds.join(',')}]; centre ${fmt(p0.c)} -> ${fmt(c)} (cursor ${fmt(CURSOR)}), start ${fmt(p0.s)} -> ${fmt(s)} (off the translation ${off(s, p0.s).toExponential(1)}), end ${fmt(p0.e)} -> ${fmt(e)} (off ${off(e, p0.e).toExponential(1)}), radius ${dist(p0.c, p0.s).toFixed(4)} -> ${dist(c, s).toFixed(4)} / ${dist(c, e).toFixed(4)} mm, constraints ${n0} -> ${st.constraints.length}`);
    assert.ok(dist(c, p0.c) > 5, label + ': the centre moved (' + fmt(c) + ')');
    assert.ok(off(s, p0.s) < 1e-6 && off(e, p0.e) < 1e-6, label + ': both rims moved with the centre, the arc translated whole (start ' + off(s, p0.s) + ', end ' + off(e, p0.e) + ' mm off)');
    assert.ok(Math.abs(dist(c, s) - 12) < 1e-6 && Math.abs(dist(c, e) - 12) < 1e-6, label + ': the radius stays 12 mm');
    assert.strictEqual(st.constraints.length, n0, label + ': no constraint is added');
    assert.ok(residual(st) < 1e-6, label + ': every constraint holds (' + residual(st) + ')');
    check(st, d);
  } finally { await app.close(); }
}
await translate('free arc', ARC());
await translate('radius-dimensioned arc', ARC({}, [], [{ type: 'distance', shape: 'A', isRadius: true, value: 12, driven: false }]));
await translate('arc whose start is coincident with a free line end', ARC({ la: [10, 5], lb: [-8, 20] }, [{ id: 'L', type: 'line', joints: ['la', 'lb'], isConstruction: false }], [{ type: 'coincident', joints: ['lb', 'as'] }]),
  (st, d) => { assert.ok(dist(pos(st, 'lb'), pos(st, 'as')) < 1e-6, 'the line end stays on the start'); assert.ok(dist(pos(st, 'la'), { x: 10, y: 5 }) < 1e-6, 'the line\'s other end stays (' + fmt(pos(st, 'la')) + ')'); });
{ // the centre held: the lock is kept
  const app = await openDesign(ARC({}, [], [], true), { x: -15, y: 25 }, 130);
  try {
    const st = app.state, p0 = ['ac', 'as', 'ae'].map((id) => pos(st, id));
    await drag(app, p0[0], straight(app, p0[0], CURSOR));
    const moved = ['ac', 'as', 'ae'].map((id, k) => dist(pos(st, id), p0[k]));
    console.log(`1 centre fixed: moved ${moved.map((m) => m.toExponential(1)).join(' / ')} mm`);
    assert.ok(moved.every((m) => m < 1e-9), 'a held centre locks the drag: nothing moves');
  } finally { await app.close(); }
}

// ---- 2. the origin is not a snap target of a drag that holds it
const C_OUTER = 'j7_1794492560318';
{
  const app = await openDesign(OWNER, { x: 0, y: 0 }, 600);
  try {
    const st = app.state, n0 = st.constraints.length, o = app.toScreen(0, 0);
    const offered = [];
    const info = await drag(app, pos(st, C_OUTER), Array.from({ length: 10 }, (_, k) => ({ x: o.x + 2 * (k + 1), y: o.y + (k + 1) })), (s) => {
      for (const t of [s.snapTarget, s.activeSnap]) if (t && (t.targetId === 'j_origin' || t.id === 'j_origin')) offered.push(t.type + ':j_origin');
    });
    console.log(`2 owner j7 (welded to the origin) 10 x (2, 1) px: drag ${info.id} ${info.type}, holds j_origin ${info.jointIds.includes('j_origin')}; events offering j_origin ${offered.length}; constraints ${n0} -> ${st.constraints.length}`);
    assert.ok(info.jointIds.includes('j_origin'), 'precondition: the drag holds the origin (its coincident cluster)');
    assert.strictEqual(offered.length, 0, 'the origin is not offered as a snap target of a drag that holds it (' + offered.join(' ') + ')');
    assert.strictEqual(st.constraints.length, n0, 'nothing is added at release');
  } finally { await app.close(); }
}
{ // control: a FREE point dragged onto the origin still snaps to it
  const app = await openDesign(design({ r: [8, 5] }, [], []), { x: 0, y: 0 }, 130);
  try {
    const st = app.state, n0 = st.constraints.length;
    let locked = false;
    await drag(app, pos(st, 'r'), straight(app, pos(st, 'r'), { x: 0, y: 0 }), (s) => { if (s.activeSnap && s.activeSnap.targetId === 'j_origin' && s.activeSnap.isLocked) locked = true; });
    const added = st.constraints.slice(n0);
    console.log(`2 control, a free point dragged onto the origin: locked to j_origin ${locked}; R ${fmt(pos(st, 'r'))}; added ${JSON.stringify(added.map((c) => [c.type, c.joints]))}`);
    assert.ok(locked, 'a free point dragged onto the origin snaps to it');
    assert.ok(added.length === 1 && added[0].type === 'coincident' && added[0].joints.includes('r') && added[0].joints.includes('j_origin'), 'and a Coincident with the origin is added at release');
  } finally { await app.close(); }
}
{ // control: the LINE tool (drawing) still snaps to the origin
  const app = await openDesign(design({}, [], []), { x: 0, y: 0 }, 130);
  try {
    const st = app.state, o = app.toScreen(0, 0);
    app.tool('line'); app.move(o.x + 4, o.y + 3);
    const t = st.snapTarget;
    console.log(`2 control, the line tool 5 px from the origin: snap ${t ? t.type + ':' + t.targetId : 'none'}`);
    assert.ok(t && t.targetId === 'j_origin', 'the line tool snaps to the origin');
  } finally { await app.close(); }
}

// ---- 3. the owner's j3 corner (a CLUSTER drag) shows no inference
const J3 = 'j3_1794492543360';
for (const sign of [1, -1]) {
  const app = await openDesign(OWNER, pos({ joints: new Map(OWNER.geometry.joints) }, J3), 600);
  try {
    const st = app.state, n0 = st.constraints.length, a0 = Math.atan2(pos(st, J3).y, pos(st, J3).x) * 180 / Math.PI;
    const o = app.toScreen(0, 0), s = app.toScreen(pos(st, J3).x, pos(st, J3).y), Rs = Math.hypot(s.x - o.x, s.y - o.y), t0 = Math.atan2(s.y - o.y, s.x - o.x);
    const shown = [];
    const info = await drag(app, pos(st, J3), Array.from({ length: 40 }, (_, k) => ({ x: o.x + Rs * Math.cos(t0 + sign * 4 * (k + 1) / Rs), y: o.y + Rs * Math.sin(t0 + sign * 4 * (k + 1) / Rs) })), (x) => { if (x.inference) shown.push(x.inference.type + ':' + x.inference.targetId); });
    const a1 = Math.atan2(pos(st, J3).y, pos(st, J3).x) * 180 / Math.PI;
    console.log(`3 owner j3 corner, 40 x 4 px ${sign > 0 ? '+' : '-'}: drag ${info.id} ${info.type} (${info.jointIds.length} joints); j3 ${a0.toFixed(3)} -> ${a1.toFixed(3)} deg; inferences shown ${shown.length}${shown.length ? ' [' + [...new Set(shown)].join(' ') + ']' : ''}; constraints ${n0} -> ${st.constraints.length}`);
    assert.strictEqual(info.type, 'cluster', 'precondition: the j3 corner is a cluster drag');
    assert.ok(Math.abs(a1 - a0) > 1, 'the drawing rotated (' + a0.toFixed(3) + ' -> ' + a1.toFixed(3) + ' deg)');
    assert.ok(!shown.some((x) => x.startsWith('tangent')), 'no tangent inference is shown (' + shown.length + ' events: ' + [...new Set(shown)].join(' ') + ')');
    assert.strictEqual(shown.length, 0, 'a cluster drag shows no inference');
    assert.strictEqual(st.constraints.length, n0, 'nothing is added at release');
    assert.ok(residual(st) < 1e-6, 'every constraint holds (' + residual(st) + ')');
  } finally { await app.close(); }
}
console.log('drag-cluster-node: ok');
