// tests/arc-rim-drag-node.test.js -- TASK 578 (node, through tests/helpers/node-app.js): grabbing an arc's END (rim) joint drags THAT JOINT ONLY, like
// Fusion; the solver moves whatever the constraints require. Before, selection-tools.js handleJointSelection added the arc's centre and both rims
// as a CLUSTER drag: with the centre held (welded to the origin) the cluster was locked and the grabbed point never moved (task 575 finding A).
//  1. The owner's drawing (tests/fixtures/drag/owner-two-arcs-575.json: two concentric arcs about the origin, radii 2286 / 2667, sides collinear
//     with construction lines through the origin, a 10 deg angle; one DOF = the rotation). Grab j8, 20 pointer events of 4 px along its circle:
//     the joint follows the cursor, the drawing rotates about the origin, every dimension and constraint holds.
//  2. A free arc drawn with the arc tool: grabbing a rim moves that rim to the cursor (what the other rim and the centre do is printed).
//  3. Dragging the arc by its BODY (task 538) still starts a body drag that moves or resizes the arc.
import assert from 'node:assert';
import fs from 'node:fs';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { measureResidual } from '#core/constraint-verifier.js';

const DOC = JSON.parse(fs.readFileSync(new URL('./fixtures/drag/owner-two-arcs-575.json', import.meta.url), 'utf8'));
const J8 = 'j8_1794492561525', J2 = 'j2_1794492542145', C_INNER = 'j1_1794492540938', C_OUTER = 'j7_1794492560318', ORIGIN = 'j_origin';

// The owner's two sides are parallel to a construction line, so the drag's PARALLEL INFERENCE (inference-engine.js findInference) holds on every
// event. Task 578 found it at the CURSOR: it kept the grabbed end on its own line until the cursor left its angle tolerance and then moved it on in
// steps (a staircase, worst gap 40.4 px with 40 events). Task 582 finds it where the drag's solve puts the end (selection-tools.js dragToward): there
// the side IS parallel, the inferred position is the end's own, and the end follows the cursor within one event's step (worst gap 1.08 px).
// Before task 578 it never moved at all (gap 4, 8 ... 79 px, still 0 travel).
const EVENTS = 40, LAG_PX = 4;
const residual = (st) => { let max = 0; for (const c of st.constraints) { if (!c || c.driven || c.type === 'mouse_spring') continue; const r = measureResidual(c, st.joints, st.shapes); if (!(r <= max)) max = r; } return max; };
const pos = (st, id) => { const j = st.joints.get(id); return { x: j.x, y: j.y }; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---- 1. the owner's drawing
{
  const profile = await createProfile();
  SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' }); // no grid snap: the cursor, not a grid node, is what the joint follows (as tests/drag-target-release-live.test.js)
  const id = await createNamedDesign(profile, 'sketchstudio', 'Owner 578');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(DOC, { app: 'sketchstudio', id }); }
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const st = app.state;
    app.tool('select');
    // pan / zoom the view onto j8 (600 world units across, the cursor stays mid-canvas): the drawing's own size is 2.7 km, the default view shows 1.3 m
    Object.assign(st.view, { x: pos(st, J8).x, y: pos(st, J8).y, w: 600 }); st.view.h = st.view.w / (app.svg.getBoundingClientRect().width / app.svg.getBoundingClientRect().height);
    app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
    const o = app.toScreen(0, 0);
    const start = app.toScreen(pos(st, J8).x, pos(st, J8).y);
    const Rs = Math.hypot(start.x - o.x, start.y - o.y), a0 = Math.atan2(start.y - o.y, start.x - o.x);
    const ang0 = Math.atan2(pos(st, J8).y, pos(st, J8).x);
    assert.ok(residual(st) < 1e-6, 'the owner drawing loads solved (residual ' + residual(st) + ')');
    app.move(start.x, start.y); app.down(start.x, start.y);
    assert.ok(st.drag, 'the press on j8 starts a drag');
    assert.deepStrictEqual(st.drag.jointIds, [J8], 'a rim joint drag holds the grabbed joint alone: ' + JSON.stringify(st.drag.jointIds));
    let worst = 0, c = null;
    for (let k = 1; k <= EVENTS; k++) {
      const a = a0 + (4 * k / Rs); // 4 px of arc per event
      c = { x: o.x + Rs * Math.cos(a), y: o.y + Rs * Math.sin(a) };
      app.move(c.x, c.y, { buttons: 1 });
      const j = app.toScreen(pos(st, J8).x, pos(st, J8).y);
      worst = Math.max(worst, Math.hypot(j.x - c.x, j.y - c.y));
    }
    app.up(c.x, c.y);
    const rot = (Math.atan2(pos(st, J8).y, pos(st, J8).x) - ang0) * 180 / Math.PI;
    console.log(`1. j8 dragged 160 px along its circle in 40 events: worst gap to the cursor ${worst.toFixed(3)} px, drawing rotated ${rot.toFixed(3)} deg, worst residual ${residual(st).toExponential(1)}`);
    const endGap = Math.hypot(app.toScreen(pos(st, J8).x, pos(st, J8).y).x - c.x, app.toScreen(pos(st, J8).x, pos(st, J8).y).y - c.y);
    assert.ok(worst < LAG_PX, 'the grabbed joint keeps pace with the cursor (worst gap ' + worst + ' px, bound ' + LAG_PX + ')');
    assert.ok(endGap < LAG_PX && rot * Math.PI / 180 * Rs > 4 * EVENTS - LAG_PX, 'the joint travelled with the cursor (' + (rot * Math.PI / 180 * Rs).toFixed(1) + ' of ' + 4 * EVENTS + ' px)');
    assert.ok(Math.abs(rot) > 0.001, 'the drawing rotated');
    assert.ok(dist(pos(st, ORIGIN), { x: 0, y: 0 }) < 1e-9, 'the origin stayed');
    assert.ok(Math.abs(dist(pos(st, C_INNER), pos(st, J2)) - 2286) < 1e-4 && Math.abs(dist(pos(st, C_OUTER), pos(st, J8)) - 2667) < 1e-4, 'both radii hold (d2 / d3)');
    assert.ok(residual(st) < 1e-6, 'every dimension and constraint holds (d1, d2, d3, the collinears): ' + residual(st));
  } finally { await app.close(); }
}

// ---- 2 and 3. a free arc
const arcApp = async () => {
  const profile = await createProfile(); await createNamedDesign(profile, 'sketchstudio');
  const app = await open({ host: 'sketchstudio', profile }); const o = app.toScreen(0, 0);
  app.click(o.x + 300, o.y + 200); app.esc();
  app.tool('arc'); app.click(o.x + 200, o.y + 100); app.click(o.x + 300, o.y + 100); app.click(o.x + 200, o.y + 200); app.esc();
  app.tool('select');
  const arc = app.state.shapes.find((s) => s.type === 'arc'); assert.ok(arc, 'an arc was drawn');
  return { app, arc };
};
{
  const { app, arc } = await arcApp();
  try {
    const st = app.state, [cj, sj, ej] = arc.joints;
    const b = { c: pos(st, cj), s: pos(st, sj), e: pos(st, ej) };
    const S = app.toScreen(b.e.x, b.e.y);
    app.move(S.x, S.y); app.down(S.x, S.y);
    assert.deepStrictEqual(st.drag.jointIds, [ej], 'a free arc rim drag holds the grabbed joint alone');
    for (let k = 1; k <= 10; k++) app.move(S.x + 3 * k, S.y + 4 * k, { buttons: 1 });
    app.up(S.x + 30, S.y + 40);
    const a = { c: pos(st, cj), s: pos(st, sj), e: pos(st, ej) }, E = app.toScreen(a.e.x, a.e.y);
    const gap = Math.hypot(E.x - (S.x + 30), E.y - (S.y + 40));
    console.log(`2. free arc, end dragged (30, 40) px: gap ${gap.toFixed(3)} px; other end moved ${dist(a.s, b.s).toFixed(3)}, centre moved ${dist(a.c, b.c).toFixed(3)}, radii ${dist(a.c, a.s).toFixed(3)} / ${dist(a.c, a.e).toFixed(3)} (was ${dist(b.c, b.s).toFixed(3)})`);
    assert.ok(gap < 1, 'the grabbed rim moves to the cursor (gap ' + gap + ' px)');
    assert.ok(Math.abs(dist(a.c, a.s) - dist(a.c, a.e)) < 1e-6, 'both ends stay on one circle');
  } finally { await app.close(); }
}
{
  const { app, arc } = await arcApp();
  try {
    const st = app.state, [cj, sj, ej] = arc.joints;
    const c = pos(st, cj), s = pos(st, sj), e = pos(st, ej), R0 = dist(c, s);
    // the arc's body: the point on the arc half way between its ends
    const mx = (s.x + e.x) / 2 - c.x, my = (s.y + e.y) / 2 - c.y, ml = Math.hypot(mx, my);
    const P = app.toScreen(c.x + mx / ml * R0, c.y + my / ml * R0), Q = app.toScreen(c.x, c.y);
    const len = Math.hypot(P.x - Q.x, P.y - Q.y), ux = (P.x - Q.x) / len, uy = (P.y - Q.y) / len;
    app.move(P.x, P.y); app.down(P.x, P.y);
    assert.ok(st.drag && st.drag.body, 'a press on the arc body starts a BODY drag (task 538)');
    for (let k = 1; k <= 10; k++) app.move(P.x + ux * 2 * k, P.y + uy * 2 * k, { buttons: 1 });
    app.up(P.x + ux * 20, P.y + uy * 20);
    const R1 = dist(pos(st, cj), pos(st, sj)), moved = dist(pos(st, cj), c);
    console.log(`3. body drag out 20 px: radius ${R0.toFixed(3)} -> ${R1.toFixed(3)}, centre moved ${moved.toFixed(3)}`);
    assert.ok(Math.abs(R1 - R0) > 1e-3 || moved > 1e-3, 'the body drag moved or resized the arc');
    assert.ok(!st.drag, 'the drag ended');
  } finally { await app.close(); }
}
console.log('arc-rim-drag-node: ok');
