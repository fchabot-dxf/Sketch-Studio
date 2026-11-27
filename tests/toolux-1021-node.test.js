// tests/toolux-1021-node.test.js — TASK 1021 guarding tests for the tool-behaviour fixes from the real-design audits (R2-04, R2-06, R2-07, R1-09, R2-11, R1-16, R1-17 ...)
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl } from './helpers/node-dom-read.js';
import * as ops from '#core/tool-ops.js';
import { patternDefaults } from '#core/pattern.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { radialDimensionParams } from '#core/constraints.js';
import { previewDimensionInput } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { planTableEdit, commitTableEdit } from '#ui/parameter-table.js';

let passed = 0;
async function run(name, fn) { await fn(); passed++; console.log(`  ok: ${name}`); }

async function openFresh({ cx = 40, cy = -20, w = 200, designBrowser = false } = {}) {
  const app = await open({ host: 'sketchstudio', designBrowser });
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: cx, y: cy, w });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames(2);
  return app;
}
const dualInputs = (app) => [...app.document.querySelectorAll('#dualInput input')];
const setInput = (app, el, text) => {
  el.focus(); el.value = text;
  if (typeof el.setSelectionRange === 'function') el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(new app.window.Event('input', { bubbles: true }));
};
const pressKey = (app, el, key) => el.dispatchEvent(new app.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const count = (app, type) => app.state.constraints.filter((c) => c.type === type).length;
const activeTool = (app) => app.state.currentTool;

// ── R2-04: a typed LENGTH (no angle) keeps the Horizontal / Vertical inference ──
await run('R2-04: line draw-time box: typed length + Enter keeps Horizontal; typed length on a vertical run keeps Vertical', async () => {
  const app = await openFresh();
  try {
    app.tool('line');
    const p0 = app.toScreen(0, 0), p1 = app.toScreen(60, 0);
    app.click(p0.x, p0.y); app.move(p1.x, p1.y);
    const [lenIn] = dualInputs(app);
    assert.ok(lenIn, 'line boxes open');
    setInput(app, lenIn, '50'); pressKey(app, lenIn, 'Enter');
    assert.strictEqual(count(app, 'horizontal'), 1, 'typed length kept the Horizontal inference');
    const d = app.state.constraints.find((c) => c.type === 'distance');
    assert.ok(d && Math.abs(d.value - 50) < 1e-6, 'the typed length is the dimension');
    // the chain continues: move vertically down from the new end, type a length
    const e = app.toScreen(50, 0), q = app.toScreen(50, -40);
    app.move(q.x, q.y);
    const [len2] = dualInputs(app);
    setInput(app, len2, '30'); pressKey(app, len2, 'Enter');
    assert.strictEqual(count(app, 'vertical'), 1, 'typed length kept the Vertical inference on the next segment');
    assert.strictEqual(count(app, 'horizontal'), 1, 'and the second segment did not inherit a stale Horizontal');
  } finally { await app.close(); }
});
await run('R2-04: a typed ANGLE still beats the inference (no H/V is added)', async () => {
  const app = await openFresh();
  try {
    app.tool('line');
    const p0 = app.toScreen(0, 0), p1 = app.toScreen(60, 0);
    app.click(p0.x, p0.y); app.move(p1.x, p1.y);
    const [lenIn, angIn] = dualInputs(app);
    setInput(app, lenIn, '50'); setInput(app, angIn, '30'); pressKey(app, angIn, 'Enter');
    assert.strictEqual(count(app, 'horizontal'), 0, 'typed angle: no Horizontal');
  } finally { await app.close(); }
});

// ── a drawn L (two lines) for the Offset / Fillet tests: screen points chosen from the canvas centre ──
async function drawL() {
  const app = await openFresh({ cx: 0, cy: 0, w: 160 });
  const P1 = app.toScreen(-40, -30), P2 = app.toScreen(-40, 30), P3 = app.toScreen(40, 30);
  app.tool('line'); app.click(P1.x, P1.y); app.click(P2.x, P2.y); app.click(P3.x, P3.y); app.esc(); app.esc();
  app.tool('select');
  return app;
}
const offsetBox = (app) => app.document.getElementById('offset-distance-input');
const filletBox = (app) => app.document.getElementById('fillet-radius-input');

// ── R2-06: after clicking the side the Offset distance box keeps the focus ──
await run('R2-06: Offset: clicking a side keeps the focus in the box; 8 + Enter offsets by 8', async () => {
  const app = await drawL();
  try {
    app.tool('offset');
    const onV = app.toScreen(-40, 0), inside = app.toScreen(-25, 0);
    app.click(onV.x, onV.y);
    assert.ok(offsetBox(app), 'the distance box opens on the pick');
    app.click(inside.x, inside.y);   // choose the side
    assert.strictEqual(app.document.activeElement, offsetBox(app), 'the box still has the focus after the side click');
    app.type('8'); app.enter();
    const o = app.state.constraints.find((c) => c.type === 'offset');
    assert.ok(o && Math.abs(o.value - 8) < 1e-6, 'the typed 8 was applied (offset value ' + (o && o.value) + ')');
  } finally { await app.close(); }
});

// ── R2-07 / R1-09: ONE Esc cancels and leaves Offset / Fillet ──
await run('R2-07: Offset: one Esc (in the box) cancels and leaves the tool', async () => {
  const app = await drawL();
  try {
    app.tool('offset');
    const onV = app.toScreen(-40, 0);
    app.click(onV.x, onV.y);
    assert.ok(offsetBox(app), 'box open');
    const n = app.state.shapes.length;
    app.esc();
    assert.ok(!offsetBox(app), 'the box is gone');
    assert.strictEqual(activeTool(app), 'select', 'ONE Esc left the tool (tool: ' + activeTool(app) + ')');
    assert.strictEqual(app.state.shapes.length, n, 'nothing made');
  } finally { await app.close(); }
});
await run('R1-09: Fillet: one Esc with a first line picked leaves the tool', async () => {
  const app = await drawL();
  try {
    app.tool('fillet');
    const onV = app.toScreen(-40, 0);
    app.click(onV.x, onV.y);   // first line picked, waiting for the second
    app.esc();
    assert.strictEqual(activeTool(app), 'select', 'ONE Esc left Fillet (tool: ' + activeTool(app) + ')');
  } finally { await app.close(); }
});
await run('R1-09: Fillet: one Esc in the radius box cancels and leaves the tool', async () => {
  const app = await drawL();
  try {
    app.tool('fillet');
    const corner = app.toScreen(-40, 30);
    app.click(corner.x, corner.y);
    assert.ok(filletBox(app), 'radius box open on the corner pick');
    app.esc();
    assert.ok(!filletBox(app), 'the box is gone');
    assert.strictEqual(activeTool(app), 'select', 'ONE Esc left Fillet (tool: ' + activeTool(app) + ')');
  } finally { await app.close(); }
});

// ── R2-11: a reference radius / diameter reads (R 15) / (Ø 5): the whole label in the parentheses ──
await run('R2-11: reference R and Ø labels read (R 15) / (Ø 40); driving ones stay R 25 / Ø 40', async () => {
  const profile = await createProfile();
  const J = (id, x, y, fixed = false) => [id, { x, y, fixed, sketchId: 'sketch-1' }];
  await createNamedDesign(profile, 'sketchstudio', 'R2-11', {
    version: 3, hosts: {},
    geometry: {
      joints: [J('j_origin', 0, 0, true), J('cc', 0, 0, true), J('ac', 60, 0, true), J('as', 85, 0), J('ae', 60, 25)],
      shapes: [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20, sketchId: 'sketch-1' }, { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sketchId: 'sketch-1' }],
      constraints: [
        { type: 'distance', shape: 'C1', isRadius: true, isDiameter: true, value: 40, isDriven: true, driven: true, offset: 30, name: 'd1' },
        { type: 'distance', shape: 'A1', isRadius: true, value: 25, isDriven: true, driven: true, offset: 30, name: 'd2' },
      ],
      parameters: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  });
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const txt = (name) => { const i = app.state.constraints.findIndex((c) => c.name === name); const el = labelEl(app, i); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };
    assert.match(txt('d1') || '', /\(Ø 40\)/, 'reference diameter: ' + txt('d1'));
    assert.match(txt('d2') || '', /\(R 25\)/, 'reference radius: ' + txt('d2'));
    app.state.constraints.find((c) => c.name === 'd1').isDriven = false; app.state.constraints.find((c) => c.name === 'd1').driven = false;
    app.state.constraints.find((c) => c.name === 'd2').isDriven = false; app.state.constraints.find((c) => c.name === 'd2').driven = false;
    app.move(app.toScreen(5, 5).x, app.toScreen(5, 5).y); app.frames(3);
    assert.match(txt('d1') || '', /^(?:d1 )?Ø 40$|Ø 40/, 'driving diameter: ' + txt('d1'));
    assert.ok(!/\(/.test(txt('d1') || '') && !/\(/.test(txt('d2') || ''), 'driving: no parentheses: ' + txt('d1') + ' / ' + txt('d2'));
  } finally { await app.close(); }
});

// ── R1-08 (advisor-approved behaviour change): the Slot's centreline infers Horizontal / Vertical like the Line tool, clicked or typed ──
const slotDraw = async (a, b, { typed = null } = {}) => {
  const app = await openFresh({ cx: 40, cy: 0, w: 160 });
  app.tool('slot');
  const A = app.toScreen(a[0], a[1]), B = app.toScreen(b[0], b[1]);
  app.click(A.x, A.y); app.move(B.x, B.y);
  if (typed) { app.type(typed); app.enter(); app.move(B.x, B.y - 20); app.type('6'); app.enter(); }
  else { app.click(B.x, B.y); app.move(B.x, B.y - 20); app.click(B.x, B.y - 20); }
  return app;
};
await run('R1-08: slot with a clicked span along X gets Horizontal', async () => {
  const app = await slotDraw([20, -15], [60, -15]);
  try { assert.strictEqual(count(app, 'horizontal'), 1, 'horizontal ' + count(app, 'horizontal')); } finally { await app.close(); }
});
await run('R1-08: slot with a TYPED span along X keeps Horizontal; typed span along Y gets Vertical', async () => {
  let app = await slotDraw([20, -15], [60, -15], { typed: '40' });
  try { assert.strictEqual(count(app, 'horizontal'), 1, 'typed span: horizontal'); assert.ok(app.state.constraints.some((c) => c.type === 'distance' && Math.abs(c.value - 40) < 1e-6), 'the span dimension'); } finally { await app.close(); }
  app = await slotDraw([20, 0], [20, -40], { typed: '30' });
  try { assert.strictEqual(count(app, 'vertical'), 1, 'typed span: vertical'); assert.strictEqual(count(app, 'horizontal'), 0, 'no horizontal'); } finally { await app.close(); }
});
await run('R1-08: a slanted slot gets neither', async () => {
  const app = await slotDraw([20, 0], [50, -30]);
  try { assert.strictEqual(count(app, 'horizontal') + count(app, 'vertical'), 0, 'no H/V on a 45 degree slot'); } finally { await app.close(); }
});

// ── R1-17 (owner ruling turn 3830): X toggles Construction like Fusion; Coincident has no key ──
await run('R1-17: X toggles Construction (tooltip says (X)); the Coincident button shows no key; K does nothing', async () => {
  const app = await openFresh({ designBrowser: true });
  try {
    const btn = app.document.getElementById('btn-construct-toggle');
    assert.ok(btn && /\(X\)$/.test(btn.title), 'tooltip: ' + (btn && btn.title));
    const co = app.document.getElementById('tool-coincident');
    assert.ok(co && !/\(\w\)/.test(co.title), 'Coincident title has no key: ' + co.title);
    const before = !!app.state.isConstructionMode;
    app.key('k'); assert.strictEqual(!!app.state.isConstructionMode, before, 'K no longer toggles');
    app.key('x'); assert.strictEqual(!!app.state.isConstructionMode, !before, 'X toggles');
    app.key('x'); assert.strictEqual(!!app.state.isConstructionMode, before, 'X toggles back');
    app.key('x'); // still, a bare X never selects Coincident
    assert.notStrictEqual(activeTool(app), 'coincident');
  } finally { await app.close(); }
});

// ── R1-16: the Unit of a user parameter is editable; a length in a Quantity box says so the right way round ──
await run('R1-16: Parameters table: unit change keeps the number (mm -> none), the same kind keeps the value, an in-use kind change is refused naming the users', async () => {
  const st = ops.newSketchState();
  const hole = ops.circle(st, 0, 0, 2); ops.snap(st, hole.c, 'j_origin');
  const create = (name, unit, text) => commitTableEdit(st, planTableEdit(st, { kind: 'new', name, text, unit }, { unit: 'mm' }));
  assert.ok(create('n', 'mm', '6').ok && create('bolt', 'mm', '8').ok, 'two parameters made');
  const unitOf = (name) => st.parameters.find((p) => p.name === name);
  assert.strictEqual(unitOf('n').expression, '6 mm');
  // mm -> none: the typed number stays, as a plain count
  let p = planTableEdit(st, { kind: 'parameter', column: 'unit', name: 'n', text: '' }, { unit: 'mm' });
  assert.ok(p.ok && p.changed, 'the unit change plans: ' + JSON.stringify(p));
  assert.ok(commitTableEdit(st, p).ok);
  assert.deepStrictEqual([unitOf('n').unit, unitOf('n').expression], ['', '6'], 'n is the plain number 6');
  // the plain n now drives a pattern Quantity
  const c = ops.pattern(st, 'circularPattern', { shapes: [hole.id], joints: [] }, { ...patternDefaults('circularPattern'), quantity: 4, centre: 'j_origin' });
  const pv = previewDimensionInput(st, c, 'n', { unit: 'mm', slot: 'quantity' });
  assert.ok(pv.ok, 'n in Quantity is accepted: ' + pv.hint);
  assert.ok(applyParameterChange(st, pv.plan, 'quantity = n').ok);
  // in use + kind change: refused, the message names the user and what it would read
  p = planTableEdit(st, { kind: 'parameter', column: 'unit', name: 'n', text: 'mm' }, { unit: 'mm' });
  assert.ok(!p.ok && /n is used by d\d+/.test(p.message) && /a length instead of a plain number/.test(p.message), 'refused with the users: ' + p.message);
  // the same kind (mm -> cm) keeps the value
  const before = JSON.stringify(unitOf('bolt'));
  p = planTableEdit(st, { kind: 'parameter', column: 'unit', name: 'bolt', text: 'cm' }, { unit: 'mm' });
  assert.ok(p.ok && commitTableEdit(st, p).ok, 'mm -> cm planned and applied');
  assert.deepStrictEqual([unitOf('bolt').unit, unitOf('bolt').expression], ['cm', '8 mm'], 'bolt is still 8 mm, now shown in cm (was ' + before + ')');
  // a formula parameter changing kind asks to be retyped
  assert.ok(create('w', 'mm', 'bolt * 2').ok);
  p = planTableEdit(st, { kind: 'parameter', column: 'unit', name: 'w', text: 'deg' }, { unit: 'mm' });
  assert.ok(!p.ok && /type its expression again/.test(p.message), 'a formula: ' + p.message);
});
await run('R1-16: a length in the Circular Pattern Quantity box says "Quantity needs a plain number, not a length"', async () => {
  const st = ops.newSketchState();
  const hole = ops.circle(st, 0, 0, 2); ops.snap(st, hole.c, 'j_origin');
  commitTableEdit(st, planTableEdit(st, { kind: 'new', name: 'bolt', text: '8', unit: 'mm' }, { unit: 'mm' }));
  const c = ops.pattern(st, 'circularPattern', { shapes: [hole.id], joints: [] }, { ...patternDefaults('circularPattern'), quantity: 4, centre: 'j_origin' });
  const pv = previewDimensionInput(st, c, 'bolt', { unit: 'mm', slot: 'quantity' });
  assert.ok(!pv.ok, 'refused');
  assert.strictEqual(pv.hint, 'Quantity needs a plain number, not a length', 'the message: ' + pv.hint);
});

// ── R1-15 / R1-11: the default label placement avoids existing labels and shapes ──
await run('R1-15: concentric circles\' diameter labels stagger around the centre (no two within 12 mm, none on +X together)', async () => {
  const st = ops.newSketchState();
  const rs = [50, 10, 35].map((r) => { const c = ops.circle(st, 0, 0, r); ops.snap(st, c.c, 'j_origin'); return c; });
  const dims = rs.map((c, i) => ConstraintManager.createConstraint(st, 'distance', radialDimensionParams({ id: c.id, type: 'circle' }, [50, 10, 35][i])));
  assert.ok(dims.every(Boolean), 'three diameters made');
  const pts = dims.map((d) => ({ x: Math.cos(d.labelAngle) * d.offset, y: Math.sin(d.labelAngle) * d.offset }));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= 12, `labels ${i} / ${j} apart: ${JSON.stringify(pts)}`);
  assert.ok(new Set(dims.map((d) => d.labelAngle)).size === 3, 'three different angles: ' + dims.map((d) => d.labelAngle));
  assert.ok(dims.every((d, i) => Math.abs(d.offset - ([50, 10, 35][i] + 8)) < 1e-9), 'each just outside its rim');
});
await run('R1-11: a hole\'s label turns away from a neighbouring line; a linear label sits a fraction of its length away, not 30 mm', async () => {
  const st = ops.newSketchState();
  ops.polyline(st, [[10, -20], [10, 20]], false);   // a vertical wall across the hole's +X leader
  const hole = ops.circle(st, 3, 0, 3);
  const d = ConstraintManager.createConstraint(st, 'distance', radialDimensionParams({ id: hole.id, type: 'circle' }, 3));
  assert.ok(d && Math.abs(d.labelAngle) > 1e-9, 'not toward the wall (angle ' + (d && d.labelAngle) + ')');
  const ln = ops.polyline(st, [[0, 40], [80, 40]], false)[0];
  const dl = ConstraintManager.createConstraint(st, 'distance', { joints: [ln.a, ln.b], value: 80 });
  assert.ok(dl && dl.offset < 30 && dl.offset >= 10, 'offset for an 80 mm edge: ' + (dl && dl.offset));
});

// ── review (task 1021): the default label placement is for a dimension being CREATED; a saved dimension never gets a new one on undo / redo / load ──
// Requirement: distances saved WITHOUT offset / labelAngle / labelSlide (hand-made or very old files; the core createConstraint has stored `offset` since
// the first lift, so any file the app wrote carries it) rebuild to byte-identical records and identical label positions through undo + redo and
// serialize -> deserialize, whatever the order the restore adds them in.
await run('review: distances saved with no placement fields are stable through load, serialize->deserialize and undo/redo', async () => {
  const J = (id, x, y, fixed = false) => [id, { x, y, fixed, sketchId: 'sketch-1' }];
  const doc = {
    version: 3, hosts: {},
    geometry: {
      joints: [J('j_origin', 0, 0, true), J('cc', 0, 0, true), J('a', 0, 40), J('b', 80, 40), J('d', 120, 40)],
      shapes: [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20, sketchId: 'sketch-1' }, { id: 'C2', type: 'circle', joints: ['cc'], radius: 35, sketchId: 'sketch-1' },
        { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1', isConstruction: false }, { id: 'L2', type: 'line', joints: ['b', 'd'], sketchId: 'sketch-1', isConstruction: false }],
      constraints: [
        { type: 'distance', shape: 'C1', isRadius: true, isDiameter: true, value: 40, name: 'd1' },
        { type: 'distance', shape: 'C2', isRadius: true, isDiameter: true, value: 70, name: 'd2' },
        { type: 'distance', joints: ['a', 'b'], value: 80, name: 'd3' },
        { type: 'distance', joints: ['b', 'd'], value: 40, name: 'd4' },
      ],
      parameters: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  };
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'review-1021', doc);
  const app = await open({ host: 'sketchstudio', profile });
  try {
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));   // key order is the renderer's glyphPos write order, not the record's content
    const records = () => canon(app.state.constraints);
    const positions = () => JSON.stringify([...app.svg.querySelectorAll('.dim-label')].map((e) => [e.dataset.constraintIdx, e.textContent.trim(), e.getAttribute('transform') || e.getAttribute('x') + ',' + e.getAttribute('y')]));
    const loaded = records(), loadedPos = positions();
    // serialize -> deserialize
    const st2 = ops.newSketchState();
    deserializeDocument(serializeDocument(app.state), st2);
    assert.strictEqual(canon(st2.constraints), loaded, 'serialize -> deserialize: byte-identical constraint records');
    // undo / redo of an unrelated edit restores the same records and label positions
    app.tool('line'); const p0 = app.toScreen(-60, 60), p1 = app.toScreen(-20, 60);
    app.click(p0.x, p0.y); app.click(p1.x, p1.y); app.esc();
    app.undo(); app.frames(2);
    assert.strictEqual(records(), loaded, 'undo: byte-identical constraint records');
    assert.strictEqual(positions(), loadedPos, 'undo: identical label positions');
    app.redo(); app.undo(); app.frames(2);
    assert.strictEqual(records(), loaded, 'redo then undo: byte-identical constraint records');
    assert.strictEqual(positions(), loadedPos, 'redo then undo: identical label positions');
  } finally { await app.close(); }
});

console.log(`toolux-1021: ${passed} passed`);
process.exit(0);
