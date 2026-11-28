// tests/arc-3point-1022-node.test.js — TASK 1022: the Arc tool's 3-Point Arc (start, end, then a point the arc passes through), beside the Center Point Arc.
// Real SketchStudio page in the node kit (tests/helpers/node-app.js): the ribbon's Arc variant menu, real pointer + key events through the app's own listeners.
//   1 the variant menu sets the mode          2 three clicks: one arc through the three points, the Center Point Arc's shape, ONE undo step
//   3 the third point on the ends' line: refused with a hint, then a good point makes the arc     4 Esc after one / two clicks: nothing left, no undo step
//   5 typed chord (and a formula), typed radius, a too-small / 0 radius refused inline, an emptied box unlocks      6 a third click on a point: on the arc
//   7 the tool stays after an arc; another variant mid-draw restarts it     8 the 3-point arc slot's geometry is main's (the shared circle function)
//   9 a right press places nothing in either mode (TASK 1030's shared rightPressIgnored); re-clicking Arc keeps the draw
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { ARC_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { circumcenter3Pt, arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { makeSlotThreePointArc } from '#core/slot.js';
import { screenToWorld } from '#ui/coords.js';
import { SIZE_REFUSAL_HINT } from '#ui/numeric-input-manager.js';
import { COLLINEAR_ARC_HINT, radiusTooSmallText } from '#ui/input-handlers/arc-tool.js';
import { toolSession } from '#ui/tool-session.js';
import { ARC } from '#ui/input-handlers/arc-tool.js';
// TASK 1039: the Arc runs in the tool session. The step its next pick makes replaces the old phase (Center Point Arc 'center' -> 'start',
// 'start' -> 'end'; 3-Point Arc 'chord' -> 'end', 'bulge' -> 'onArc'); a placed point is a held pick (state.active.held.picks), not a joint yet.
const arcStep = (app) => (app.state.active ? toolSession(app.state, ARC).stepId() : null);
const heldAt = (app, id) => app.state.active.held.picks[id].at;

const failures = [];
let passed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`  ok: ${name}`); }
  catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log(`  FAIL: ${name}: ${String(e.message).split('\n')[0]}`); }
}

async function openFresh({ cx = 0, cy = 0, w = 200 } = {}) {
  const app = await open({ host: 'sketchstudio' });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: cx, y: cy, w });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const shown = (el) => !!el && !el.classList.contains('hidden') && el.style.display !== 'none';
const single = (app) => { const d = app.document.getElementById('dimInput'); return shown(d) ? d : null; };
const hint = (app) => { const h = app.document.getElementById('dimHint'); return shown(h) ? h.textContent : ''; };
const toasts = (app) => { const c = app.document.getElementById('notification-container'); return c ? [...c.children].map((x) => x.textContent) : []; };
const W = (app, x, y) => app.toScreen(x, y);
/** a click at world (x, y); returns the point the click places: the snap the app locked on (a grid point, a joint), else the pixel's world point */
const clickW = (app, x, y, o) => {
  const p = W(app, x, y);
  app.move(p.x, p.y, o);
  const st = app.state.snapTarget;
  const at = st && st.isLocked && st.pt ? { x: st.pt.x, y: st.pt.y } : screenToWorld(app.svg, p.x, p.y);
  app.click(p.x, p.y, o);
  return at;
};
const moveW = (app, x, y) => { const p = W(app, x, y); app.move(p.x, p.y); };
const arcs = (app) => app.state.shapes.filter((s) => s.type === 'arc');
const J = (app, id) => app.state.joints.get(id);
const dists = (app) => app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.DISTANCE);
const near = (a, b, tol, msg) => assert(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const backspaces = (app, n) => { for (let i = 0; i < n; i++) app.type('\b'); };
/** the ribbon's Arc button, then a row of its variant menu (the user's two clicks) */
function pickArcVariant(app, mode) {
  app.tool('arc');
  const item = app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${mode}"]`);
  assert(item, `the Arc variant menu has a ${mode} row`);
  item.click(); app.frames(1);
}
/** the arc's geometry: centre, radius at its start and end, and whether `p` is on its sweep */
function arcGeom(app, arc, p) {
  const [c, s, e] = arc.joints.map((id) => J(app, id));
  const info = arcSweepInfo(c, s, e, { sweep: arc.sweep });
  return { c, s, e, rs: Math.hypot(s.x - c.x, s.y - c.y), re: Math.hypot(e.x - c.x, e.y - c.y), rp: p ? Math.hypot(p.x - c.x, p.y - c.y) : null, onSweep: p ? angleInArcSweep(info, Math.atan2(p.y - c.y, p.x - c.x)) : null };
}

// ── 1. the variant menu ──
await run('1 the Arc button has a variant menu: Center Point Arc (the default) and 3-Point Arc; a row sets the mode', async () => {
  const app = await openFresh();
  try {
    assert.strictEqual(app.state.arcMode, ARC_MODES.CENTER_START_END, 'a fresh page draws Center Point Arcs');
    const rows = [...app.document.querySelectorAll('.sk-ribbon-menu-item')].filter((r) => /^arc-/.test(r.dataset.mode)).map((r) => [r.dataset.mode, r.textContent.trim()]);
    assert.deepStrictEqual(rows, [['arc-cse', 'Center Point Arc'], ['arc-3pt', '3-Point Arc']], 'the two Arc rows');
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    assert.strictEqual(app.state.arcMode, ARC_MODES.THREE_POINT, 'the 3-Point row sets the mode');
    assert.strictEqual(app.state.currentTool, 'arc', 'the Arc tool is active');
  } finally { await app.close(); }
});

await run('1b the Arc variants are wherever the Arc button is: Shaper and Pen Plotter (the shared ribbon; Trace is not a kit host)', async () => {
  for (const host of ['shaper', 'penplotter']) {
    const app = await open({ host });
    try {
      assert(app.document.getElementById('tool-arc'), `${host}: the Arc button`);
      const rows = [...app.document.querySelectorAll('.sk-ribbon-menu-item')].filter((r) => /^arc-/.test(r.dataset.mode)).map((r) => r.dataset.mode);
      assert.deepStrictEqual(rows, ['arc-cse', 'arc-3pt'], `${host}: the two Arc rows`);
    } finally { await app.close(); }
  }
});

// ── 2. three clicks make ONE arc through the three points ──
await run('2 three clicks: one arc through start, end and the third point (centre and radius to 1e-6), the Center Point Arc shape, ONE undo step', async () => {
  for (const [S, E, P] of [[[10, 10], [50, 10], [30, 30]], [[3, -7], [-12, 4], [15, 9]], [[-40, 20], [40, 25], [0, -30]]]) {
    const app = await openFresh();
    try {
      pickArcVariant(app, ARC_MODES.THREE_POINT);
      const h0 = app.state.history.length, j0 = app.state.joints.size;
      clickW(app, ...S); moveW(app, ...E); clickW(app, ...E); moveW(app, ...P); const p = clickW(app, ...P);
      assert.strictEqual(arcs(app).length, 1, `${S}/${E}/${P}: one arc`);
      const arc = arcs(app)[0];
      assert.strictEqual(arc.subType, 'CENTER', 'the Center Point Arc shape (centre, start, end)');
      assert.strictEqual(arc.joints.length, 3, 'three joints');
      const g = arcGeom(app, arc, p);
      const cc = circumcenter3Pt(g.s, g.e, p);
      near(g.c.x, cc.center.x, 1e-6, 'centre x'); near(g.c.y, cc.center.y, 1e-6, 'centre y');
      near(g.rs, cc.radius, 1e-6, 'radius at the start'); near(g.re, cc.radius, 1e-6, 'radius at the end'); near(g.rp, cc.radius, 1e-6, 'the third point is on the circle');
      assert(g.onSweep, 'the third point is on the arc (not on the rest of the circle)');
      near(Math.hypot(g.s.x - S[0], g.s.y - S[1]), 0, 0.5, 'the start is the first click'); near(Math.hypot(g.e.x - E[0], g.e.y - E[1]), 0, 0.5, 'the end is the second click');
      const eq = app.state.constraints.filter((c) => c.type === 'equal' && c.joints && c.joints[0] === arc.joints[0]);
      assert.strictEqual(eq.length, 1, 'the arc keeps its structural equal (makeArc), as a Center Point Arc');
      assert.strictEqual(app.state.history.length, h0 + 1, 'ONE undo step');
      assert.strictEqual(app.state.active, null, 'the draw ended');
      app.undo();
      assert.strictEqual(arcs(app).length, 0, 'undo removes the arc');
      assert.strictEqual(app.state.joints.size, j0, 'and its joints');
      app.redo();
      assert.strictEqual(arcs(app).length, 1, 'redo brings it back');
    } finally { await app.close(); }
  }
});

// ── 3. collinear third point ──
await run('3 the third point on the line through the ends: no arc, a hint; another point then makes the arc', async () => {
  const app = await openFresh();
  try {
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    const h0 = app.state.history.length;
    clickW(app, -30, 10); moveW(app, 30, 10); clickW(app, 30, 10);
    moveW(app, 60, 10); clickW(app, 60, 10);
    assert.strictEqual(arcs(app).length, 0, 'no arc');
    assert(toasts(app).some((t) => t.includes(COLLINEAR_ARC_HINT)), `the hint says why (${JSON.stringify(toasts(app))})`);
    assert(app.state.active && arcStep(app) === 'onArc', 'the draw waits for another third point');
    moveW(app, 0, 40); const p = clickW(app, 0, 40);
    assert.strictEqual(arcs(app).length, 1, 'a point off the line makes the arc');
    near(arcGeom(app, arcs(app)[0], p).rp, arcGeom(app, arcs(app)[0], p).rs, 1e-6, 'through the third point');
    assert.strictEqual(app.state.history.length, h0 + 1, 'the refused click left no undo step; the arc is one');
  } finally { await app.close(); }
});

// ── 4. Esc mid-draw ──
await run('4 Esc after one and after two clicks: nothing left, no undo step, the tool is left (one Esc)', async () => {
  for (const clicks of [1, 2]) {
    const app = await openFresh();
    try {
      pickArcVariant(app, ARC_MODES.THREE_POINT);
      const h0 = app.state.history.length, j0 = app.state.joints.size, s0 = app.state.shapes.length;
      clickW(app, -20, 0); moveW(app, 20, 5);
      if (clicks === 2) { clickW(app, 20, 5); moveW(app, 0, 30); }
      app.esc();
      assert.strictEqual(app.state.shapes.length, s0, `${clicks} click(s): no shape`);
      assert.strictEqual(app.state.joints.size, j0, `${clicks} click(s): no joint left`);
      assert.strictEqual(app.state.history.length, h0, `${clicks} click(s): no undo step`);
      assert.strictEqual(app.state.active, null, `${clicks} click(s): no draw`);
      assert.strictEqual(app.state.currentTool, 'select', `${clicks} click(s): ONE Esc leaves the tool`);
      assert(!single(app), `${clicks} click(s): the box is gone`);
    } finally { await app.close(); }
  }
});

// ── 5. typed values ──
await run('5a typed chord 40: the end at 40 from the start, a driving distance dimension between the ends', async () => {
  const app = await openFresh();
  try {
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    clickW(app, -20, 0); moveW(app, 10, 0);
    assert(single(app), 'the chord box is open after the start click');
    app.type('40'); app.enter();
    assert(app.state.active && arcStep(app) === 'onArc', 'Enter places the end');
    moveW(app, 0, 25); const p = clickW(app, 0, 25);
    const arc = arcs(app)[0];
    assert(arc, 'an arc');
    const g = arcGeom(app, arc, p);
    near(Math.hypot(g.e.x - g.s.x, g.e.y - g.s.y), 40, 1e-6, 'the chord is the typed 40');
    near(g.rp, g.rs, 1e-6, 'through the third point');
    const d = dists(app).find((c) => Array.isArray(c.joints) && c.joints.includes(arc.joints[1]) && c.joints.includes(arc.joints[2]));
    assert(d && Math.abs(d.value - 40) < 1e-9, `a chord dimension of 40 (${JSON.stringify(dists(app).map((c) => c.value))})`);
    assert(!d.isDriven && !d.driven, 'it drives');
  } finally { await app.close(); }
});
await run('5b a formula in the chord box (d1 / 2) is kept on its dimension', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, -60, 60); moveW(app, -20, 60); app.type('60'); app.enter(); app.esc(); app.esc();
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    clickW(app, -25, 0); moveW(app, 10, 0); app.type('d1 / 2'); app.enter();
    moveW(app, -10, 15); clickW(app, -10, 15);
    const d = dists(app).find((c) => Array.isArray(c.joints) && Math.abs(c.value - 30) < 1e-6);
    assert(d, `a chord dimension of 30 (${JSON.stringify(dists(app).map((c) => [c.value, c.expression]))})`);
    assert.strictEqual(d.expression, 'd1 / 2', 'the formula is kept');
  } finally { await app.close(); }
});
await run('5c typed radius 25: the arc has radius 25 on the cursor side, a radius dimension; the short and the long arc follow the cursor', async () => {
  for (const [P, long] of [[[0, 8], false], [[0, 40], true], [[0, -8], false], [[0, -40], true]]) {
    const app = await openFresh();
    try {
      pickArcVariant(app, ARC_MODES.THREE_POINT);
      const s = clickW(app, -20, 0); moveW(app, 20, 0); const e = clickW(app, 20, 0);
      moveW(app, ...P);
      assert(single(app), 'the radius box is open after the end click');
      app.type('25'); moveW(app, ...P); clickW(app, ...P);
      const arc = arcs(app)[0];
      assert(arc, `${P}: an arc`);
      const g = arcGeom(app, arc, null);
      near(g.rs, 25, 1e-6, `${P}: radius at the start`); near(g.re, 25, 1e-6, `${P}: radius at the end`);
      near(Math.hypot(g.s.x - s.x, g.s.y - s.y), 0, 1e-9, 'the start did not move'); near(Math.hypot(g.e.x - e.x, g.e.y - e.y), 0, 1e-9, 'the end did not move');
      const info = arcSweepInfo(g.c, g.s, g.e, { sweep: arc.sweep });
      assert.strictEqual(info.span > Math.PI, long, `${P}: the ${long ? 'long' : 'short'} arc`);
      const side = Math.sign(P[1]);
      const apex = { x: g.c.x, y: g.c.y + side * 25 };   // the chord is horizontal: the arc's farthest point on the cursor's side
      assert(angleInArcSweep(info, Math.atan2(apex.y - g.c.y, apex.x - g.c.x)), `${P}: the arc bulges to the cursor's side`);
      const r = dists(app).find((c) => c.isRadius && c.shape === arc.id);
      assert(r && Math.abs(r.value - 25) < 1e-9, 'a radius dimension of 25');
    } finally { await app.close(); }
  }
});
await run('5d radius 10 for a chord of 40 and radius 0 are refused inline: the hint, a click places nothing; fixed, the arc is placed', async () => {
  const app = await openFresh();
  try {
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    clickW(app, -20, 0); moveW(app, 20, 0); clickW(app, 20, 0); moveW(app, 0, 10);
    app.type('10');
    assert.strictEqual(hint(app), radiusTooSmallText(20), 'the hint says the radius must reach both ends');
    clickW(app, 0, 10);
    assert.strictEqual(arcs(app).length, 0, 'the click places nothing');
    backspaces(app, 2); app.type('0');
    assert.strictEqual(hint(app), SIZE_REFUSAL_HINT, '0 is refused like every size');
    app.enter();
    assert.strictEqual(arcs(app).length, 0, 'Enter places nothing');
    backspaces(app, 1); app.type('30'); moveW(app, 0, 10); clickW(app, 0, 10);
    assert.strictEqual(arcs(app).length, 1, 'a radius of 30 makes the arc');
    near(arcGeom(app, arcs(app)[0], null).rs, 30, 1e-6, 'of radius 30');
  } finally { app.esc(); app.esc(); await app.close(); }
});
await run('5e an emptied box unlocks: radius 25 typed then deleted: the arc goes through the cursor, no radius dimension', async () => {
  const app = await openFresh();
  try {
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    clickW(app, -20, 0); moveW(app, 20, 0); clickW(app, 20, 0); moveW(app, 0, 12);
    app.type('25'); backspaces(app, 2);
    assert.strictEqual(single(app).value, '', 'the box is empty');
    moveW(app, 0, 12); const p = clickW(app, 0, 12);
    const arc = arcs(app)[0];
    assert(arc, 'an arc');
    const g = arcGeom(app, arc, p);
    near(g.rp, g.rs, 1e-6, 'through the cursor');
    assert.strictEqual(dists(app).length, 0, 'no dimension from a deleted number');
  } finally { await app.close(); }
});

// ── 6. snaps ──
await run('6 the start on a line end SHARES it (TASK 1045, Fusion measured 2026-11-27); a third click on an existing point puts that point on the arc', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, -30, 0); clickW(app, -30, -40); app.esc(); app.esc();   // a line whose top end is (-30, 0)
    app.tool('line'); clickW(app, 0, 30); clickW(app, 60, 70); app.esc(); app.esc();    // a point at (0, 30)
    const lineTop = app.state.shapes[0].joints[0];
    const pointOn = app.state.shapes[1].joints[0];
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    const before = app.state.constraints.length;
    clickW(app, -30, 0); moveW(app, 30, 0); clickW(app, 30, 0); moveW(app, 0, 30); clickW(app, 0, 30);
    const arc = arcs(app)[0];
    assert(arc, 'an arc');
    const added = app.state.constraints.slice(before);
    assert(arc.joints[1] === lineTop && !added.some((c) => c.type === CONSTRAINT_TYPES.COINCIDENT), `the start IS the line's end, no coincident (${arc.joints}, ${JSON.stringify(added.map((c) => c.type))})`);
    assert(added.some((c) => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint === pointOn && c.shape === arc.id), `the point is on the arc (${JSON.stringify(added.map((c) => c.type))})`);
  } finally { await app.close(); }
});

// ── 7. the tool stays; another variant mid-draw restarts it ──
await run('7 the tool stays after an arc (a second arc is drawn); the Center Point row mid-draw restarts the tool in that mode', async () => {
  const app = await openFresh();
  try {
    pickArcVariant(app, ARC_MODES.THREE_POINT);
    clickW(app, -40, 0); clickW(app, -10, 0); clickW(app, -25, 10);
    assert.strictEqual(app.state.currentTool, 'arc', 'the Arc tool stays');
    clickW(app, 10, 0); clickW(app, 40, 0); clickW(app, 25, 10);
    assert.strictEqual(arcs(app).length, 2, 'a second 3-point arc');
    const j0 = app.state.joints.size, h0 = app.state.history.length;
    clickW(app, 0, -30); moveW(app, 20, -30);   // a third one, half drawn
    pickArcVariant(app, ARC_MODES.CENTER_START_END);
    assert.strictEqual(app.state.arcMode, ARC_MODES.CENTER_START_END, 'the mode is Center Point');
    assert.strictEqual(app.state.active, null, 'the half-drawn arc is gone');
    assert.strictEqual(app.state.joints.size, j0, 'its start joint too');
    assert.strictEqual(app.state.history.length, h0, 'no undo step');
    clickW(app, 0, -30); clickW(app, 20, -30); clickW(app, 0, -10);
    assert.strictEqual(arcs(app).length, 3, 'a Center Point Arc is drawn next');
    const g = arcGeom(app, arcs(app)[2], null);
    near(Math.hypot(g.c.x - 0, g.c.y + 30), 0, 0.5, 'its first click is the centre');
  } finally { await app.close(); }
});

// ── 9. right press (TASK 1030: the shared input-manager rightPressIgnored, no guard in the Arc tool) ──
await run('9 a right press places nothing in either Arc mode (empty canvas, after one click, after two clicks); re-clicking Arc keeps the draw; left clicks then make the arc', async () => {
  for (const mode of [ARC_MODES.CENTER_START_END, ARC_MODES.THREE_POINT]) {
    const app = await openFresh();
    try {
      pickArcVariant(app, mode);
      const j0 = app.state.joints.size, h0 = app.state.history.length;
      const right = (x, y) => { const p = W(app, x, y); app.rightClick(p.x, p.y); };
      right(-20, 0);
      assert.strictEqual(app.state.active, null, `${mode}: a right press on empty canvas starts nothing`);
      assert.strictEqual(app.state.joints.size, j0, `${mode}: no joint`);
      clickW(app, -20, 0); moveW(app, 20, 0);
      const phase1 = arcStep(app), j1 = app.state.joints.size;
      right(20, 0);
      assert.strictEqual(arcStep(app), phase1, `${mode}: a right press after one click places no point`);
      assert.strictEqual(app.state.joints.size, j1, `${mode}: no joint after one click`);
      app.tool('arc');   // re-clicking the tool's own button: nothing (TASK 1030)
      assert.strictEqual(arcStep(app), phase1, `${mode}: re-clicking Arc keeps the draw`);
      clickW(app, 20, 0); moveW(app, 0, 20);
      const phase2 = arcStep(app), j2 = app.state.joints.size;
      right(0, 20);
      assert.strictEqual(arcs(app).length, 0, `${mode}: a right press after two clicks makes no arc`);
      assert.strictEqual(arcStep(app), phase2, `${mode}: the draw still waits`);
      assert.strictEqual(app.state.joints.size, j2, `${mode}: no joint after two clicks`);
      clickW(app, 0, 20);
      assert.strictEqual(arcs(app).length, 1, `${mode}: the left click makes the arc`);
      assert.strictEqual(app.state.history.length, h0 + 1, `${mode}: one undo step`);
    } finally { app.esc(); await app.close(); }
  }
});

// ── 8. the 3-point arc slot after moving its circle maths to #core/geometry.js ──
await run('8 the 3-point arc slot gives main\'s geometry (numbers from origin/main f04e30c5)', async () => {
  // .evidence/1022/slot-main.txt: makeSlotThreePointArc on main's packages/core/slot.js, width 6
  const MAIN = [
    [[{ x: -25, y: 0 }, { x: 5, y: 0 }, { x: -10, y: 15 }], false, [[-10, 0], [-28, 0], [-22, 0], [8, 0], [2, 0]]],
    [[{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 10, y: -30 }], true, [[23.461538462, -8.846153846], [-2.807091859, 1.058411685], [2.807091859, -1.058411685], [41.978769671, 12.254877067], [38.021230329, 7.745122933]]],
    [[{ x: 3.3, y: -7.1 }, { x: -12.5, y: 4.25 }, { x: 20, y: 9 }], true, [[3.315981022, 9.594603537], [3.297128231, -10.099998625], [3.302871769, -4.100001375], [-15.342111298, 3.289581669], [-9.657888702, 5.210418331]]],
  ];
  for (const [[c1, c2, p3], sweep, pts] of MAIN) {
    let n = 0; const genJ = () => 'g' + (++n);
    const joints = new Map([['c1', { ...c1 }], ['c2', { ...c2 }]]);
    const r = makeSlotThreePointArc(joints, 'c1', 'c2', p3, 6, genJ, false, { widthDimension: true });   // task 1049: the width 6 TYPED (main always placed its dimension)
    assert.strictEqual(r.meta.ac.sweep, sweep, 'the slot arc direction');
    assert.strictEqual(r.shapes.length, 5, 'five shapes'); assert.strictEqual(r.constraints.length, 10, 'ten constraints (task 1038: the 4th tangent, BUG-383)');
    pts.forEach(([x, y], i) => { const j = joints.get('g' + (i + 1)); near(j.x, x, 1e-8, `g${i + 1}.x`); near(j.y, y, 1e-8, `g${i + 1}.y`); });
  }
});

console.log(`arc-3point-1022: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error('  ' + f); process.exit(1); }
