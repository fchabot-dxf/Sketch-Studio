// tests/drawbox-fix-1028-node.test.js — TASK 1028: the draw-time box bugs found by audit 1026 (docs/DRAWBOX-AUDIT-1026.md), one section per bug id.
// Real SketchStudio page in the node kit (tests/helpers/node-app.js): real pointer + key events through the app's own listeners.
//   B-01 emptying a single-field box (and the polygon's N) unlocks it          B-02 Enter and a click give a rectangle the same constraints
//   B-03 the 3-point rectangle has its length then height boxes                  B-04 the 3-point arc slot keeps a typed span (and its formula)
//   B-05 a right-click with a typed length makes ONE segment                      B-06 Enter merges a line's end by the click's rule (0.01)
//   B-07 an arc sweep of 0 / -90 / 360 / 720 is refused inline                    B-08 a typed length a locked point cannot hold is refused
//   B-09 / B-18 Fillet and Offset refuse inline with the parser's message        B-13 `param = value` in an angle / count box; a free name refused
//   B-14 rect: Enter with no size keeps the box                                  B-15 Tab in a single box keeps the focus      B-19 a click commits Fillet
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { RECT_MODES, SLOT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { planChange, OFFSET_ZERO_REASON } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { SIZE_REFUSAL_HINT } from '#ui/numeric-input-manager.js';

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
const dualFields = (app) => { const b = app.document.getElementById('dualInput'); return shown(b) ? [...b.querySelectorAll('input')] : []; };
const hint = (app) => { const h = app.document.getElementById('dimHint'); return shown(h) ? h.textContent : ''; };
const toasts = (app) => { const c = app.document.getElementById('notification-container'); return c ? [...c.children].map((x) => x.textContent) : []; };
const W = (app, x, y) => app.toScreen(x, y);
const clickW = (app, x, y, o) => { const p = W(app, x, y); app.click(p.x, p.y, o); };
const moveW = (app, x, y) => { const p = W(app, x, y); app.move(p.x, p.y); };
const lines = (app) => app.state.shapes.filter((s) => s.type === 'line' && !s.isConstruction);
const J = (app, id) => app.state.joints.get(id);
const lenOf = (app, s) => Math.hypot(J(app, s.joints[1]).x - J(app, s.joints[0]).x, J(app, s.joints[1]).y - J(app, s.joints[0]).y);
const dists = (app) => app.state.constraints.filter((c) => c.type === CONSTRAINT_TYPES.DISTANCE);
const typeCounts = (app) => app.state.constraints.reduce((m, c) => { m[c.type] = (m[c.type] || 0) + 1; return m; }, {});
const near = (a, b, tol, msg) => assert(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const backspaces = (app, n) => { for (let i = 0; i < n; i++) app.type('\b'); };

// ── B-01: emptying a single-field box unlocks it (the cursor sets the size again); the polygon's N falls back to the remembered count ──
await run('B-01 circle: Ø 60, Backspace x2, Enter at the cursor: the cursor radius, no dimension', async () => {
  const app = await openFresh();
  try {
    app.tool('circle'); clickW(app, -30, 0); moveW(app, -10, 0);
    assert(single(app), 'the diameter box is open');
    app.type('60'); backspaces(app, 2);
    assert.strictEqual(single(app).value, '', 'the box is empty');
    moveW(app, -10, 0); app.enter();
    const c = app.state.shapes.find((s) => s.type === 'circle');
    assert(c, 'a circle was placed');
    near(c.radius, 20, 1e-3, 'the radius is the cursor one, not the deleted 6');
    assert.strictEqual(dists(app).length, 0, 'no dimension from a deleted number');
  } finally { await app.close(); }
});
await run('B-01 arc: radius 25 then empty, start by click: the cursor radius; sweep 90 then empty: the cursor sweep', async () => {
  const app = await openFresh();
  try {
    app.tool('arc'); clickW(app, -30, 0); moveW(app, 10, 0);
    app.type('25'); backspaces(app, 2); moveW(app, 10, 0); clickW(app, 10, 0);
    const start = J(app, app.state.active.start);
    near(Math.hypot(start.x + 30, start.y), 40, 1e-3, 'the start is at the cursor radius 40, not 2');
    moveW(app, -30, -40);
    app.type('90'); backspaces(app, 2); moveW(app, -30, -40); clickW(app, -30, -40);
    const arc = app.state.shapes.find((s) => s.type === 'arc');
    assert(arc, 'an arc was placed');
    const e = J(app, arc.joints[2]);
    near(Math.atan2(-(e.y - 0), e.x + 30) * 180 / Math.PI, 90, 0.5, 'the end follows the cursor (90 degrees up), not a 9 degree arc');
    assert.strictEqual(dists(app).length, 0, 'no radius dimension from a deleted number');
  } finally { await app.close(); }
});
await run('B-01 slot: span 40 then empty, end by click: the clicked span; width 12 then empty: the cursor width', async () => {
  const app = await openFresh();
  try {
    app.tool('slot'); app.state.slotMode = SLOT_MODES.CENTER_TO_CENTER;
    clickW(app, -40, 10); moveW(app, 10, 10);
    app.type('40'); backspaces(app, 2); moveW(app, 10, 10); clickW(app, 10, 10);
    moveW(app, -15, 15);
    app.type('12'); backspaces(app, 2); moveW(app, -15, 15); clickW(app, -15, 15);
    const spans = dists(app).filter((d) => !d.isDiameter && !d.isRadius);
    assert.strictEqual(spans.length, 0, `no span dimension from a deleted number (${JSON.stringify(dists(app).map((d) => d.value))})`);
    const wd = dists(app).find((d) => d.isDiameter || d.isRadius);
    assert(wd && Math.abs(wd.value - 1) > 0.5, `the width is not the deleted 1 (${wd && wd.value})`);
  } finally { await app.close(); }
});
await run('B-01 polygon: N 4 typed then emptied falls back to the remembered N', async () => {
  const app = await openFresh();
  try {
    app.tool('polygon');
    clickW(app, -40, 0); moveW(app, -20, 0);
    let [, n] = dualFields(app); n.focus(); n.select(); app.type('9'); app.enter();
    const first = lines(app).length;
    assert.strictEqual(first, 9, `the first polygon has 9 sides (${first})`);
    clickW(app, 40, 0); moveW(app, 60, 0);
    [, n] = dualFields(app); n.focus(); n.select(); app.type('4'); backspaces(app, 1); app.enter();
    assert.strictEqual(lines(app).length - first, 9, `the second polygon has the remembered 9 sides (${lines(app).length - first})`);
  } finally { await app.close(); }
});

// ── B-02: a typed rectangle committed by Enter gets the constraints the same rectangle committed by a click gets ──
await run('B-02 2-point and centre: Enter and click give the same constraints (no extra pointOnLine)', async () => {
  for (const mode of [RECT_MODES.TWO_POINT, RECT_MODES.CENTER]) {
    const got = {};
    for (const how of ['click', 'enter']) {
      const app = await openFresh();
      try {
        app.tool('rect'); app.state.rectMode = mode;
        const start = mode === RECT_MODES.CENTER ? [-20, -10] : [-40, -10];
        clickW(app, ...start); moveW(app, 10, 30);
        app.type('40'); app.key('Tab'); app.type('20');
        if (how === 'click') clickW(app, 10, 30); else app.enter();
        assert.strictEqual(lines(app).length, 4, `${mode} ${how}: placed`);
        got[how] = typeCounts(app);
      } finally { await app.close(); }
    }
    assert.deepStrictEqual(got.enter, got.click, `${mode}: Enter ${JSON.stringify(got.enter)} vs click ${JSON.stringify(got.click)}`);
  }
});

// ── B-03: the 3-point rectangle: a length box after click 1, a height box after the base; Enter and a click place the typed sizes; 0 is refused ──
for (const how of ['enter', 'click']) {
  await run(`B-03 3-point rectangle by ${how}: length 40, height 20, two dimensions`, async () => {
    const app = await openFresh();
    try {
      app.tool('rect'); app.state.rectMode = RECT_MODES.THREE_POINT;
      clickW(app, -30, -20);
      assert(single(app), 'a length box shows after the first click');
      moveW(app, 20, -20); app.type('40');
      if (how === 'enter') app.enter(); else clickW(app, 20, -20);
      assert(app.state.active && app.state.active.secondPt, 'the base is placed');
      const b = J(app, app.state.active.secondPt);
      near(Math.hypot(b.x + 30, b.y + 20), 40, 1e-6, 'the base is the typed 40');
      assert(single(app), 'a height box shows after the base');
      moveW(app, 0, 10); app.type('20');
      if (how === 'enter') app.enter(); else clickW(app, 0, 10);
      assert.strictEqual(lines(app).length, 4, 'placed');
      assert.deepStrictEqual(lines(app).map((s) => +lenOf(app, s).toFixed(6)).sort((a, b) => a - b), [20, 20, 40, 40], 'the sides are the typed 40 x 20');
      assert.deepStrictEqual(dists(app).map((d) => d.value).sort((a, b) => a - b), [20, 40], 'the typed length and height are the two dimensions');
      assert(dists(app).every((d) => !d.isDriven && !d.driven), 'both drive');
      assert(!single(app) && app.state.active === null, 'the box closed, the tool waits for the next rectangle');
    } finally { await app.close(); }
  });
}
await run('B-03 3-point rectangle: a typed 0 is refused (red, hint, nothing drawn)', async () => {
  const app = await openFresh();
  try {
    app.tool('rect'); app.state.rectMode = RECT_MODES.THREE_POINT;
    clickW(app, -30, -20); moveW(app, 20, -20); app.type('40'); app.enter();
    moveW(app, 0, 10); app.type('0'); app.enter();
    assert.strictEqual(lines(app).length, 0, 'nothing drawn');
    assert(single(app), 'the box stays open');
    assert.strictEqual(single(app).getAttribute('aria-invalid'), 'true', 'the field is red');
    assert.strictEqual(hint(app), SIZE_REFUSAL_HINT, 'the hint says why');
  } finally { app.esc(); app.esc(); await app.close(); }   // the box's module state is shared by every page this process opens: close the refused box first
});

// ── B-04: the 3-point arc slot keeps a typed span (the chord between its end centres) as a dimension, with its formula ──
await run('B-04 3-point arc slot: typed span 30 is a driving dimension; a formula is kept', async () => {
  for (const text of ['30', 'd1 / 2']) {
    const app = await openFresh();
    try {
      if (text !== '30') { app.tool('line'); clickW(app, -60, 40); moveW(app, -20, 40); app.type('60'); app.enter(); app.esc(); app.esc(); }
      app.tool('slot'); app.state.slotMode = SLOT_MODES.THREE_POINT_ARC;
      clickW(app, -25, 0); moveW(app, 10, 0); app.type(text); app.enter();
      moveW(app, -10, 15); clickW(app, -10, 15);
      moveW(app, -10, 18); clickW(app, -10, 18);
      const span = dists(app).find((d) => Array.isArray(d.joints) && d.joints.length === 2 && Math.abs(d.value - 30) < 1e-6);
      assert(span, `${text}: a span dimension of 30 (${JSON.stringify(dists(app).map((d) => [d.value, d.expression]))})`);
      assert(!span.isDriven && !span.driven, `${text}: it drives`);
      if (text !== '30') assert.strictEqual(span.expression, 'd1 / 2', 'the formula is kept');
    } finally { await app.close(); }
  }
});

// ── B-05: a right-click with a typed length commits that segment and finishes the chain: ONE segment, as without typing ──
await run('B-05 line: typed 40 then right-click: one segment of 40, the chain finished', async () => {
  for (const typed of [true, false]) {
    const app = await openFresh();
    try {
      app.tool('line'); clickW(app, -40, 20); moveW(app, -10, -10);
      if (typed) app.type('40');
      const p = W(app, -10, -10); app.rightClick(p.x, p.y);
      assert.strictEqual(lines(app).length, 1, `typed=${typed}: one segment (${lines(app).map((s) => lenOf(app, s).toFixed(2))})`);
      if (typed) near(lenOf(app, lines(app)[0]), 40, 1e-6, 'the segment is the typed 40');
      assert.strictEqual(app.state.active, null, `typed=${typed}: the chain is finished`);
      assert.strictEqual(app.state.currentTool, 'line', `typed=${typed}: the Line tool stays`);
    } finally { await app.close(); }
  }
});

// ── B-06: an Enter-committed line merges its end with a joint by the click's rule (within 0.01), never 0.5 mm away ──
await run('B-06 line: typed end 0.3 mm from an unrelated endpoint: no merge, the old line does not move', async () => {
  const app = await openFresh();
  try {
    app.tool('line'); clickW(app, 10, 30); moveW(app, 10, 40); clickW(app, 10, 40); app.esc(); app.esc();
    const old = lines(app)[0];
    const oldPts = old.joints.map((id) => ({ ...J(app, id) }));
    app.tool('line'); clickW(app, -30, 30.3); moveW(app, 10, 30); app.type('40.3'); app.enter();   // the audit's B-X03: the typed end lands 0.3 mm from (10, 30)
    assert.strictEqual(lines(app).length, 2, 'the new line is placed');
    old.joints.forEach((id, i) => { near(J(app, id).x, oldPts[i].x, 1e-6, 'the old line did not move (x)'); near(J(app, id).y, oldPts[i].y, 1e-6, 'the old line did not move (y)'); });
    const nl = lines(app)[1];
    assert(!nl.joints.some((id) => old.joints.includes(id)), 'the new end is not the old joint');
    assert(!app.state.constraints.some((c) => c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints.some((id) => old.joints.includes(id))), 'no coincident to the old line');
    near(lenOf(app, nl), 40.3, 1e-6, 'the typed length');
  } finally { await app.close(); }
});

// ── B-07: an arc sweep outside (0, 360) is refused inline (red field, hint, nothing drawn) ──
await run('B-07 arc: sweep 0, -90, 360, 720 refused with a hint; 90 places', async () => {
  const app = await openFresh();
  try {
    app.tool('arc'); clickW(app, -30, 0); moveW(app, 10, 0); clickW(app, 10, 0); moveW(app, -30, -40);
    for (const v of ['0', '-90', '360', '720']) {
      const f = single(app); f.focus(); f.select(); app.type(v); app.enter();
      assert.strictEqual(app.state.shapes.filter((s) => s.type === 'arc').length, 0, `${v}: nothing drawn`);
      assert(single(app), `${v}: the box stays open`);
      assert.strictEqual(single(app).getAttribute('aria-invalid'), 'true', `${v}: the field is red`);
      assert(/sweep/i.test(hint(app)), `${v}: the hint says why ("${hint(app)}")`);
      const p = W(app, -30, -40); app.click(p.x, p.y);
      assert.strictEqual(app.state.shapes.filter((s) => s.type === 'arc').length, 0, `${v}: a click places nothing either`);
    }
    const f = single(app); f.focus(); f.select(); app.type('90'); app.enter();
    assert.strictEqual(app.state.shapes.filter((s) => s.type === 'arc').length, 1, '90 places the arc');
  } finally { await app.close(); }
});

// ── B-08: a typed length that a LOCKED point cannot hold is refused like the edit box (Can't set to ...): the box keeps the text, nothing is drawn ──
await run('B-08 line: typed 40.004 ending on a locked point 40 away is refused, box keeps the text', async () => {
  for (const how of ['enter', 'click']) {
    const app = await openFresh();
    try {
      app.tool('line'); clickW(app, 40, 0); moveW(app, 40, -20); clickW(app, 40, -20); app.esc(); app.esc();
      const lockedId = [...app.state.joints.entries()].find(([, j]) => Math.abs(j.x - 40) < 1e-6 && Math.abs(j.y) < 1e-6)[0];
      J(app, lockedId).fixed = true;
      const n0 = lines(app).length, c0 = app.state.constraints.length;
      app.tool('line'); clickW(app, 0, 0); moveW(app, 40, 0);
      const [len] = dualFields(app); len.focus(); len.select(); app.type('40.004');
      if (how === 'enter') app.enter(); else clickW(app, 40, 0);
      assert.strictEqual(lines(app).length, n0, `${how}: no segment drawn`);
      assert.strictEqual(app.state.constraints.length, c0, `${how}: no constraint left behind`);
      assert(dualFields(app).length && dualFields(app)[0].value === '40.004', `${how}: the box keeps the typed text`);
      assert(/^Can't set to 40\.004 mm/.test(hint(app)), `${how}: the edit box's wording ("${hint(app)}")`);
      assert(app.state.active, `${how}: the segment is still being drawn`);
    } finally { app.esc(); app.esc(); await app.close(); }
  }
});

// ── B-09 / B-18: Fillet and Offset refuse inline under the box with the draw boxes' wording (the parser's own message), no toast ──
async function drawL() {
  const app = await openFresh({ w: 160 });
  app.tool('line'); clickW(app, -40, -30); clickW(app, -40, 30); clickW(app, 40, 30); app.esc(); app.esc();
  app.tool('select');
  return app;
}
await run('B-09 / B-18 fillet: "6abc", "abc", empty, 0 refused inline with the parser / size wording; no toast', async () => {
  const app = await drawL();
  try {
    app.tool('fillet'); clickW(app, -40, 30);
    const box = app.document.getElementById('fillet-radius-input');
    assert(box, 'the radius box is open');
    const t0 = toasts(app).length;
    for (const [text, want] of [['6abc', /unexpected/i], ['abc', /unknown parameter 'abc'/], ['', /nothing to evaluate/], ['0', new RegExp('^' + SIZE_REFUSAL_HINT.replace('.', '\\.') + '$')], ['-3', /more than 0/]]) {
      box.focus(); box.select(); if (text) app.type(text); else { app.type('x'); backspaces(app, 1); }
      app.enter();
      assert(app.document.getElementById('fillet-radius-input'), `${JSON.stringify(text)}: the box stays open`);
      assert(want.test(hint(app)), `${JSON.stringify(text)}: inline hint "${hint(app)}"`);
      assert.strictEqual(box.getAttribute('aria-invalid'), 'true', `${JSON.stringify(text)}: the field is red`);
    }
    assert.strictEqual(toasts(app).length, t0, `no toast (${toasts(app).slice(t0)})`);
    assert.strictEqual(app.state.shapes.filter((s) => s.type === 'arc').length, 0, 'nothing filleted');
  } finally { await app.close(); }
});
await run('B-18 offset: "6abc", empty, 0 refused inline; no toast', async () => {
  const app = await drawL();
  try {
    app.tool('offset'); clickW(app, -40, 0); clickW(app, -25, 0);
    const box = app.document.getElementById('offset-distance-input');
    assert(box, 'the distance box is open');
    const t0 = toasts(app).length;
    for (const [text, want] of [['6abc', /unexpected/i], ['', /nothing to evaluate/], ['0', new RegExp(OFFSET_ZERO_REASON.replace(/[()]/g, '\\$&'))]]) {
      box.focus(); box.select(); if (text) app.type(text); else { app.type('x'); backspaces(app, 1); }
      app.enter();
      assert(app.document.getElementById('offset-distance-input'), `${JSON.stringify(text)}: the box stays open`);
      assert(want.test(hint(app)), `${JSON.stringify(text)}: inline hint "${hint(app)}"`);
    }
    assert.strictEqual(toasts(app).length, t0, `no toast (${toasts(app).slice(t0)})`);
  } finally { await app.close(); }
});

// ── B-13: `param = value` in an angle / count box updates that user parameter; a free name (nothing to name: no dimension) is refused with a plain hint ──
await run('B-13 line angle / polygon N: existing parameter updated, free name refused', async () => {
  const app = await openFresh();
  try {
    for (const [name, unit] of [['ang', 'deg'], ['n', '']]) {
      const plan = planChange(app.state, { type: 'createParameter', name, unit, text: '10' }, { unit: 'mm' });
      assert(plan.ok, 'parameter planned ' + name);
      applyParameterChange(app.state, plan, 'create ' + name);
    }
    app.tool('line'); clickW(app, -40, 0); moveW(app, 0, 0);
    let [, ang] = dualFields(app); ang.focus(); ang.select(); app.type('a = 30'); app.enter();
    assert.strictEqual(lines(app).length, 0, 'a free name in the angle box: nothing drawn');
    assert(/a name needs a dimension/.test(hint(app)), `the free name is refused with a plain hint ("${hint(app)}")`);
    ang.focus(); ang.select(); app.type('ang = 30'); app.enter();
    assert.strictEqual(lines(app).length, 1, 'ang = 30 draws the line');
    const l = lines(app)[0], a = J(app, l.joints[0]), b = J(app, l.joints[1]);
    near(-Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, 30, 1e-6, 'at 30 degrees');
    assert.strictEqual(app.state.parameters.find((p) => p.name === 'ang').expression.replace(/\s*deg$/, ''), '30', 'the parameter ang is now 30');
    app.esc(); app.esc();
    app.tool('polygon'); clickW(app, 40, 40); moveW(app, 60, 40);
    let [, n] = dualFields(app); n.focus(); n.select(); app.type('n = 5'); app.enter();
    assert.strictEqual(lines(app).length - 1, 5, `n = 5: five sides (${lines(app).length - 1})`);
    assert.strictEqual(app.state.parameters.find((p) => p.name === 'n').expression, '5', 'the parameter n is now 5');
  } finally { await app.close(); }
});

// ── B-14: Rectangle (2-point, centre): Enter with no size keeps the box open and the draw going, like the other tools ──
await run('B-14 rect: click, Enter with no size: the box stays open; the next click places the rectangle', async () => {
  for (const mode of [RECT_MODES.TWO_POINT, RECT_MODES.CENTER]) {
    const app = await openFresh();
    try {
      app.tool('rect'); app.state.rectMode = mode;
      clickW(app, -20, -10); app.enter();
      assert(dualFields(app).length === 2, `${mode}: the W x H box stays open`);
      moveW(app, 20, 20); clickW(app, 20, 20);
      assert.strictEqual(lines(app).length, 4, `${mode}: placed by the click`);
    } finally { await app.close(); }
  }
});

// ── B-15: Tab inside a single-field box keeps the focus in the box (it selects its text, as the two-field box's Tab does) ──
await run('B-15 circle / arc / slot: Tab keeps the focus in the single box', async () => {
  const app = await openFresh();
  try {
    app.tool('circle'); clickW(app, -30, 0); moveW(app, -10, 0);
    app.type('60'); app.key('Tab');
    assert.strictEqual(app.document.activeElement, single(app), 'circle: the focus stays in the box');
    app.type('40'); app.enter();
    const c = app.state.shapes.find((s) => s.type === 'circle');
    assert(c && Math.abs(c.radius - 20) < 1e-6, `Tab selected the text: 40 replaced it (r ${c && c.radius})`);
    app.tool('slot'); app.state.slotMode = SLOT_MODES.CENTER_TO_CENTER; clickW(app, 20, 30); moveW(app, 60, 30);
    app.key('Tab');
    assert.strictEqual(app.document.activeElement, single(app), 'slot: the focus stays in the box');
  } finally { await app.close(); }
});

// ── B-19: a canvas click with a typed radius commits the Fillet (as in the draw boxes), it does not cancel it ──
await run('B-19 fillet: radius 8 typed, a click on empty canvas applies it', async () => {
  const app = await drawL();
  try {
    app.tool('fillet'); clickW(app, -40, 30);
    const box = app.document.getElementById('fillet-radius-input');
    box.focus(); box.select(); app.type('8');
    clickW(app, 30, -30);
    const arc = app.state.shapes.find((s) => s.type === 'arc');
    assert(arc, 'the fillet was applied');
    const r = dists(app).find((d) => d.isRadius);
    assert(r && Math.abs(r.value - 8) < 1e-6, `radius 8 (${r && r.value})`);
    assert.strictEqual(app.state.currentTool, 'fillet', 'the tool stays');
  } finally { await app.close(); }
});

console.log(`drawbox-fix-1028-node: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); process.exit(1); }
