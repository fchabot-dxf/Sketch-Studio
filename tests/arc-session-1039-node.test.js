// tests/arc-session-1039-node.test.js — TASK 1039 (the plan's Arc migration, docs/INPUT-UNIFY-PLAN-1031.md 5.2 item 2; proof as the Circle trial 1034).
// The Arc tool (Center Point Arc and 3-Point Arc) runs in the tool session (#ui/tool-session.js): the same step = the same result whatever the device.
// Each case draws one arc in a fresh SketchStudio (real DOM events through input-manager, the translators and the value boxes) and reads back:
//   - the document (shapes + constraints, ids normalised): identical inside each group;
//   - the session's step log: the same steps with the same picks and values in every case (only `via` differs);
//   - the build counter: ONE build per arc;
//   - the preview drawn just before the last step: the arc the build makes (centre, radius, end, winding, large-arc).
// Groups, per variant: typed values (mouse Enter, mouse click, touch box + Enter, touch box + tap); nothing typed with the last point on a joint
// (mouse clicks, mouse hover + Enter, taps, mouse drag-release for the first span, finger drag-release). Plus the engine rules the Arc brought in:
// a press-step dragged back onto its point = a click (its box opens: Arc and Circle), a zero-sweep end is too small (A-3), a refused value holds nothing.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { toolSession } from '#ui/tool-session.js';
import { ARC, SWEEP_REFUSAL } from '#ui/input-handlers/arc-tool.js';
import { CIRCLE } from '#ui/input-handlers/circle-tool.js';
import { ARC_MODES } from '#core/constants.js';
import { arcSweepInfo, angleBetween } from '#core/geometry.js';

const P_END = { x: 10 + 30 * Math.cos(Math.PI / 3), y: 20 + 30 * Math.sin(Math.PI / 3) };   // on the Center arc's circle, 60 deg round from its start
const Q3 = { x: 10, y: -5 };                                                               // the 3-Point Arc's third point
const doc = () => ({
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: -60, y: -40, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: -40, y: -40, fixed: true, sketchId: 'sketch-1' }],
      ['p', { x: P_END.x, y: P_END.y, fixed: true, sketchId: 'sketch-1' }],
      ['q', { x: Q3.x, y: Q3.y, fixed: true, sketchId: 'sketch-1' }],
    ],
    shapes: [{ id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' }],
    constraints: [], parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

async function openApp() {
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'T1039', doc());
  const app = await open({ host: 'sketchstudio', profile });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: 0, y: 10, w: 200 });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}

const T = { pointerType: 'touch' };
const tapBox = (app) => app.press(app.document.getElementById('dimInput'));
const boxOpen = (app) => { const e = app.document.getElementById('dimInput'); return !!e && !e.classList.contains('hidden') && e.style.display !== 'none'; };

// the document the case made: every joint / shape / constraint id replaced by its order of appearance, numbers rounded, transient fields dropped
function normalisedDoc(state) {
  const names = new Map();
  const name = (id) => { if (!names.has(id)) names.set(id, `#${names.size}`); return names.get(id); };
  const ids = new Set([...state.joints.keys(), ...state.shapes.map((s) => s.id), ...state.constraints.map((c) => c.id).filter(Boolean)]);
  const norm = (v) => {
    if (typeof v === 'string') return ids.has(v) ? name(v) : v.replace(/_\d{10,}_\d+$/, '_N');   // an arc's group id carries a timestamp
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

// the arc the preview shows now (as the renderer reads it), and the arc the build made: centre, radius, end point, winding flag, large-arc
const previewArc = (app) => {
  const pv = app.state.active && app.state.active.preview;
  if (!pv || pv.type !== 'arc') return null;
  return { cx: pv.center.x, cy: pv.center.y, r: pv.radius, ex: pv.center.x + pv.radius * Math.cos(pv.endAngle), ey: pv.center.y + pv.radius * Math.sin(pv.endAngle), sweep: !!pv.sweep, large: !!pv.largeArc };
};
const builtArc = (state) => {
  const a = state.shapes.find((s) => s.type === 'arc');
  if (!a) return null;
  const [c, s, e] = a.joints.map((id) => state.joints.get(id));
  return { cx: c.x, cy: c.y, r: Math.hypot(s.x - c.x, s.y - c.y), ex: e.x, ey: e.y, sweep: !!a.sweep, large: arcSweepInfo(c, s, e, { sweep: a.sweep }).span > Math.PI };
};
const sameArc = (p, b) => !!p && !!b && ['cx', 'cy', 'r', 'ex', 'ey'].every((k) => Math.abs(p[k] - b[k]) < 1e-6) && p.sweep === b.sweep && p.large === b.large;

async function drawCase(label, mode, fn) {
  const app = await openApp();
  try {
    app.tool('arc');
    app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${mode}"]`).click(); app.frames(1);
    const W = (x, y) => app.toScreen(x, y);
    const h = {
      W,
      click: (x, y) => { const p = W(x, y); app.move(p.x, p.y); app.click(p.x, p.y); },
      move: (x, y) => { const p = W(x, y); app.move(p.x, p.y); },
      tap: (x, y) => { const p = W(x, y); app.down(p.x, p.y, T); app.up(p.x, p.y, T); },
      drag: (a, b) => app.drag(W(a.x, a.y), W(b.x, b.y)),
      fingerDrag: (a, b, steps = 8) => { const A = W(a.x, a.y), B = W(b.x, b.y); app.down(A.x, A.y, T); for (let i = 1; i <= steps; i++) app.move(A.x + (B.x - A.x) * i / steps, A.y + (B.y - A.y) * i / steps, { ...T, buttons: 1 }); app.up(B.x, B.y, T); },
      round: (c, r, a0, a1, steps = 10) => { for (let i = 0; i <= steps; i++) { const a = (a0 + (a1 - a0) * i / steps) * Math.PI / 180; const p = W(c.x + r * Math.cos(a), c.y + r * Math.sin(a)); app.move(p.x, p.y); } },
      preview: null,
      mid() { app.frames(1); this.preview = previewArc(app); },
    };
    fn(app, h);
    const session = toolSession(app.state, ARC);
    const out = { label, doc: normalisedDoc(app.state), picks: picksOf(session.log), vias: viasOf(session.log), builds: session.builds, active: app.state.active, arcs: app.state.shapes.filter((x) => x.type === 'arc').length, preview: h.preview, built: builtArc(app.state) };
    console.log(`  ${label}: builds=${out.builds} vias=${out.vias} arcs=${out.arcs} previewEqualsBuild=${sameArc(out.preview, out.built)}`);
    return out;
  } finally { await app.close(); }
}

function sameGroup(group, { steps }) {
  for (const c of group) {
    assert.strictEqual(c.arcs, 1, `${c.label}: one arc`);
    assert.strictEqual(c.builds, 1, `${c.label}: the ONE build ran once`);
    assert.strictEqual(c.active, null, `${c.label}: the draw finished`);
    assert.strictEqual(c.doc, group[0].doc, `${c.label}: the same document as ${group[0].label}\n${c.doc}\nvs\n${group[0].doc}`);
    assert.strictEqual(c.picks, group[0].picks, `${c.label}: the same steps, picks and values as ${group[0].label}\n${c.picks}\nvs\n${group[0].picks}`);
    if (c.preview) assert.ok(sameArc(c.preview, c.built), `${c.label}: the preview drawn before the last step is the arc the build makes: ${JSON.stringify(c.preview)} vs ${JSON.stringify(c.built)}`);
  }
  assert.deepStrictEqual(JSON.parse(group[0].picks).map((p) => p.step), steps, `the step log: ${steps.join(', ')}`);
  assert.ok(group.filter((c) => c.preview).length >= 2, 'the preview was read in at least two cases of the group');
}

// ───────────────────────────────── Center Point Arc ─────────────────────────────────
const CSE = ARC_MODES.CENTER_START_END;
const C = { x: 10, y: 20 }, S = { x: 40, y: 20 };
const cseTyped = [
  await drawCase('CA1 mouse: centre, R 25 + Enter, wind, sweep 90 + Enter', CSE, (app, h) => { h.click(C.x, C.y); h.move(S.x, S.y); app.type('25'); app.enter(); h.round(C, 25, 0, 45); app.type('90'); h.mid(); app.enter(); }),
  await drawCase('CA2 mouse: centre, R 25 + click, wind, sweep 90 + click', CSE, (app, h) => { h.click(C.x, C.y); h.move(S.x, S.y); app.type('25'); h.click(S.x, S.y); h.round(C, 25, 0, 45); app.type('90'); h.mid(); const e = h.W(C.x + 25 * Math.cos(Math.PI / 4), C.y + 25 * Math.sin(Math.PI / 4)); app.click(e.x, e.y); }),
  await drawCase('CA3 touch: tap centre, tap box, 25 + Enter, 90 + Enter', CSE, (app, h) => { h.tap(C.x, C.y); tapBox(app); app.type('25'); app.enter(); app.type('90'); h.mid(); app.enter(); }),
  await drawCase('CA4 touch: tap centre, tap box, 25, tap; tap box, 90, tap', CSE, (app, h) => { h.tap(C.x, C.y); tapBox(app); app.type('25'); h.tap(S.x, S.y); tapBox(app); app.type('90'); h.mid(); h.tap(C.x, C.y + 25); }),
];
const cseClicks = [
  await drawCase('CB1 mouse: click centre, start, wind, click p', CSE, (app, h) => { h.click(C.x, C.y); h.click(S.x, S.y); h.round(C, 30, 0, 60); h.move(P_END.x, P_END.y); h.mid(); h.click(P_END.x, P_END.y); }),
  await drawCase('CB2 mouse: click centre, start, wind, hover p, Enter', CSE, (app, h) => { h.click(C.x, C.y); h.click(S.x, S.y); h.round(C, 30, 0, 60); h.move(P_END.x, P_END.y); h.mid(); app.enter(); }),
  await drawCase('CB3 touch: tap centre, start, p', CSE, (app, h) => { h.tap(C.x, C.y); h.tap(S.x, S.y); h.tap(P_END.x, P_END.y); }),
  await drawCase('CB4 mouse: drag centre -> start (A-1), wind, click p', CSE, (app, h) => { h.drag(C, S); h.round(C, 30, 0, 60); h.move(P_END.x, P_END.y); h.mid(); h.click(P_END.x, P_END.y); }),
  await drawCase('CB5 touch: finger drag centre -> start, tap p', CSE, (app, h) => { h.fingerDrag(C, S); h.tap(P_END.x, P_END.y); }),
];
sameGroup(cseTyped, { steps: ['centre', 'start', 'end'] });
sameGroup(cseClicks, { steps: ['centre', 'start', 'end'] });
assert.deepStrictEqual([...new Set(cseClicks.map((c) => c.vias))].sort(), ['click,click,click', 'click,click,enter', 'click,release,click'].sort(), 'only `via` differs: click / enter / release');
{
  const A = JSON.parse(cseTyped[0].doc), B = JSON.parse(cseClicks[0].doc);
  const arcA = A.shapes.find((s) => s.type === 'arc');
  assert.ok(A.constraints.some((c) => c.type === 'distance' && c.isRadius && c.value === 25 && c.shape === arcA.id), 'typed: the radius dimension 25');
  const b = cseTyped[0].built;
  assert.ok(Math.abs(b.r - 25) < 1e-9 && Math.abs(angleBetween({ x: b.cx, y: b.cy }, { x: b.ex, y: b.ey }) - Math.PI / 2) < 1e-9 && b.sweep, `typed: radius 25, sweep 90 deg the positive way (${JSON.stringify(b)})`);
  assert.ok(!A.constraints.some((c) => c.type === 'coincident'), 'typed: no snap kept (a typed value positions the point)');
  const pId = B.joints.find((j) => Math.abs(j.x - P_END.x) < 1e-6 && Math.abs(j.y - P_END.y) < 1e-6);
  assert.ok(B.constraints.some((c) => c.type === 'coincident'), `untyped: the end on p is coincident with it ${JSON.stringify(B.constraints)} ${JSON.stringify(pId)}`);
  assert.ok(cseClicks[0].built.sweep && !cseClicks[0].built.large, 'untyped: the short 60 deg arc the positive way (a tap gives the same arc as a hovered click)');
}

// ───────────────────────────────── 3-Point Arc ─────────────────────────────────
const P3 = ARC_MODES.THREE_POINT;
const A0 = { x: -20, y: 20 }, E0 = { x: 40, y: 20 }, SIDE = { x: 0, y: 0 };
const p3Typed = [
  await drawCase('PA1 mouse: start, chord 40 + Enter, hover the side, R 30 + Enter', P3, (app, h) => { h.click(A0.x, A0.y); h.move(E0.x, E0.y); app.type('40'); app.enter(); h.move(SIDE.x, SIDE.y); app.type('30'); h.mid(); app.enter(); }),
  await drawCase('PA2 mouse: start, chord 40 + click, R 30 + click on the side', P3, (app, h) => { h.click(A0.x, A0.y); h.move(E0.x, E0.y); app.type('40'); h.click(E0.x, E0.y); h.move(SIDE.x, SIDE.y); app.type('30'); h.mid(); h.click(SIDE.x, SIDE.y); }),
  await drawCase('PA3 touch: tap start, tap box, 40 + Enter, 30, tap the side', P3, (app, h) => { h.tap(A0.x, A0.y); tapBox(app); app.type('40'); app.enter(); app.type('30'); h.tap(SIDE.x, SIDE.y); }),
  await drawCase('PA4 touch: tap start, tap box, 40, tap; tap box, 30, tap the side', P3, (app, h) => { h.tap(A0.x, A0.y); tapBox(app); app.type('40'); h.tap(E0.x, E0.y); tapBox(app); app.type('30'); h.tap(SIDE.x, SIDE.y); }),
];
const p3Clicks = [
  await drawCase('PB1 mouse: click start, end, q', P3, (app, h) => { h.click(A0.x, A0.y); h.click(E0.x, E0.y); h.move(Q3.x, Q3.y); h.mid(); h.click(Q3.x, Q3.y); }),
  await drawCase('PB2 mouse: click start, end, hover q, Enter', P3, (app, h) => { h.click(A0.x, A0.y); h.click(E0.x, E0.y); h.move(Q3.x, Q3.y); h.mid(); app.enter(); }),
  await drawCase('PB3 touch: tap start, end, q', P3, (app, h) => { h.tap(A0.x, A0.y); h.tap(E0.x, E0.y); h.tap(Q3.x, Q3.y); }),
  await drawCase('PB4 mouse: drag start -> end, click q', P3, (app, h) => { h.drag(A0, E0); h.move(Q3.x, Q3.y); h.mid(); h.click(Q3.x, Q3.y); }),
  await drawCase('PB5 touch: finger drag start -> end, tap q', P3, (app, h) => { h.fingerDrag(A0, E0); h.tap(Q3.x, Q3.y); }),
];
sameGroup(p3Typed, { steps: ['start', 'end', 'onArc'] });
sameGroup(p3Clicks, { steps: ['start', 'end', 'onArc'] });
assert.deepStrictEqual([...new Set(p3Clicks.map((c) => c.vias))].sort(), ['click,click,click', 'click,click,enter', 'click,release,click'].sort(), 'only `via` differs: click / enter / release');
{
  const A = JSON.parse(p3Typed[0].doc), B = JSON.parse(p3Clicks[0].doc);
  const arcA = A.shapes.find((s) => s.type === 'arc'), arcB = B.shapes.find((s) => s.type === 'arc');
  assert.ok(A.constraints.some((c) => c.type === 'distance' && c.isRadius && c.value === 30 && c.shape === arcA.id), 'typed: the radius dimension 30');
  assert.ok(A.constraints.some((c) => c.type === 'distance' && !c.isRadius && c.value === 40 && Array.isArray(c.joints)), 'typed: the chord dimension 40 between the ends');
  assert.ok(B.constraints.some((c) => c.type === 'pointOnLine' && c.shape === arcB.id), `untyped: q is ON the arc (point on arc) ${JSON.stringify(B.constraints)}`);
  assert.ok(Math.abs(p3Typed[0].built.r - 30) < 1e-9, 'typed: radius 30');
}

// ───────────────────────────────── the engine rules the Arc brought in ─────────────────────────────────
const failures = [];
async function rule(name, fn) { const app = await openApp(); try { await fn(app); console.log(`  ok: ${name}`); } catch (e) { failures.push(`${name}: ${e.message.split('\n')[0]}`); console.log(`  FAIL: ${name}: ${e.message.split('\n')[0]}`); } finally { await app.close(); } }
const dragBack = (app, at, away) => {
  const a = app.toScreen(at.x, at.y), b = app.toScreen(away.x, away.y);
  app.move(a.x, a.y); app.down(a.x, a.y);
  for (let i = 1; i <= 4; i++) app.move(a.x + (b.x - a.x) * i / 4, a.y + (b.y - a.y) * i / 4, { buttons: 1 });
  for (let i = 3; i >= 0; i--) app.move(a.x + (b.x - a.x) * i / 4, a.y + (b.y - a.y) * i / 4, { buttons: 1 });
  app.up(a.x, a.y);
};
await rule('Circle: a drag from the centre back onto it = a centre click: the diameter box opens, the next click places the circle (approved generic rule, task 1039)', async (app) => {
  app.tool('circle');
  dragBack(app, C, S);
  const s = toolSession(app.state, CIRCLE);
  assert.ok(s.pending() && s.stepId() === 'rim', 'the centre is held, the rim still to come');
  assert.ok(boxOpen(app), 'the diameter box is open');
  const r = app.toScreen(S.x, S.y); app.move(r.x, r.y); app.click(r.x, r.y);
  assert.strictEqual(app.state.shapes.filter((x) => x.type === 'circle').length, 1, 'the next click placed the circle');
});
await rule('Arc (both variants): a drag back onto the first point = a click: its box opens', async (app) => {
  for (const [mode, step] of [[CSE, 'start'], [P3, 'end']]) {
    app.tool('arc'); app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${mode}"]`).click(); app.frames(1);
    dragBack(app, C, S);
    assert.strictEqual(toolSession(app.state, ARC).stepId(), step, `${mode}: the first point is held`);
    assert.ok(boxOpen(app), `${mode}: the box is open`);
    app.esc(); app.esc();
  }
});
await rule('A-3: an end with no sweep is too small for a click and for Enter alike: nothing placed, the tool waits', async (app) => {
  app.tool('arc'); app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${CSE}"]`).click(); app.frames(1);
  const c = app.toScreen(C.x, C.y), s = app.toScreen(S.x, S.y);
  app.move(c.x, c.y); app.click(c.x, c.y); app.move(s.x, s.y); app.click(s.x, s.y);
  app.move(s.x + 1, s.y); app.move(s.x, s.y); app.click(s.x, s.y);
  assert.strictEqual(app.state.shapes.filter((x) => x.type === 'arc').length, 0, 'the click on the start ray placed nothing');
  assert.strictEqual(toolSession(app.state, ARC).stepId(), 'end', 'the tool waits for the end');
  app.enter();
  assert.strictEqual(app.state.shapes.filter((x) => x.type === 'arc').length, 0, 'Enter there placed nothing either');
  assert.ok(boxOpen(app), 'the sweep box stays open');
});
await rule('a refused sweep holds nothing: the preview follows the pointer, a click is refused, the box keeps the hint', async (app) => {
  app.tool('arc'); app.document.querySelector(`.sk-ribbon-menu-item[data-mode="${CSE}"]`).click(); app.frames(1);
  const c = app.toScreen(C.x, C.y), s = app.toScreen(S.x, S.y);
  app.move(c.x, c.y); app.click(c.x, c.y); app.move(s.x, s.y); app.click(s.x, s.y);
  for (let i = 1; i <= 6; i++) { const p = app.toScreen(C.x + 30 * Math.cos(i * Math.PI / 18), C.y + 30 * Math.sin(i * Math.PI / 18)); app.move(p.x, p.y); }
  app.type('360'); app.frames(1);
  const pv = previewArc(app);
  assert.ok(pv && Math.abs(angleBetween({ x: pv.cx, y: pv.cy }, { x: pv.ex, y: pv.ey }) - Math.PI / 3) < 0.05, `the preview follows the pointer (60 deg), not the refused 360: ${JSON.stringify(pv)}`);
  assert.ok(app.document.getElementById('dimHint').textContent.includes(SWEEP_REFUSAL), 'the box shows why');
  const e = app.toScreen(C.x + 30 * Math.cos(Math.PI / 3), C.y + 30 * Math.sin(Math.PI / 3)); app.click(e.x, e.y);
  assert.strictEqual(app.state.shapes.filter((x) => x.type === 'arc').length, 0, 'a click places nothing while the box refuses');
});
assert.deepStrictEqual(failures, [], failures.join('\n'));
console.log('center typed doc', cseTyped[0].doc); console.log('center untyped doc', cseClicks[0].doc); console.log('3-point typed doc', p3Typed[0].doc); console.log('3-point untyped doc', p3Clicks[0].doc);
console.log('step log (CB1)', cseClicks[0].picks); console.log('step log (PB1)', p3Clicks[0].picks);
console.log('PASS arc-session-1039-node');
