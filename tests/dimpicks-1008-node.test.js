// tests/dimpicks-1008-node.test.js — TASK 1008 guarding tests (Node, real Design tab via node-app.js)
// Item 1 circles get a DIAMETER dimension, arcs a RADIUS (DD-1 / DIV-01 / B-19a): dimension tool click, D with a circle selected, circle draw-time box.
// Item 2 D-8 circle / arc rims pickable for point / line / circle distances (centre distances)
// Item 3 D-10 (node half) a dimension label drags in the Dimension tool
// Item 4 D-13 a circle with only a Reference dimension takes a new driving one
// Item 5 D-14 clicking a Reference dimension while editing is refused
// Item 6 D-15 Tab commits like Enter
import assert from 'node:assert/strict';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl } from './helpers/node-dom-read.js';
import SettingsManager from '#core/settings-manager.js';
import { setConstraintNotifier, ConstraintManager } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { resetDimensionState } from '#ui/input-handlers/dimension-tool.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const realLog = console.log;
async function quiet(fn) {
  console.log = () => {};
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.log = realLog; console.warn = w; }
}

function makeDoc(joints, shapes, constraints = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [
        ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1' }]),
      ],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints, parameters: [],
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  };
}

let app = null;
async function openDesign(doc, { centre = { x: 30, y: 15 }, w = 220, host = 'sketchstudio' } = {}) {
  if (app) { try { resetDimensionState(app.state); } catch (_) {} await app.close(); app = null; }
  const profile = await createProfile();
  await quiet(async () => {
    await createNamedDesign(profile, host, 'DimPicks 1008', doc);
    app = await open({ host, profile, width: 1600, height: 900 });
  });
  setConstraintNotifier(showNotification);
  app.tool('select');
  resetDimensionState(app.state);
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: centre.x, y: centre.y, w });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames();
  return app;
}

const boxEl = () => app.document.getElementById('dimInput');
const boxOpen = () => { const el = boxEl(); return !!el && !el.classList.contains('hidden'); };
const allDims = () => app.state.constraints.filter((c) => c && (c.type === 'distance' || c.type === 'angle'));
const dimByName = (name) => app.state.constraints.find((c) => c && c.name === name);
const labelText = (c) => { const i = app.state.constraints.indexOf(c); const el = labelEl(app, i); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; };

async function moveW(w) { const p = app.toScreen(w.x, w.y); await quiet(() => { app.move(p.x, p.y); }); }
async function clickW(w) {
  const p = app.toScreen(w.x, w.y);
  await quiet(() => { app.move(p.x, p.y); app.down(p.x, p.y); app.up(p.x, p.y); });
  app.frames();
}
const finishBox = async () => { if (boxOpen()) { await quiet(() => app.enter()); app.frames(); } };

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (err) { failed++; console.error(`FAIL ${name}: ${err.message}`); }
}

const circleDoc = () => makeDoc({ cc: [0, 0, true] }, [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }]);

// ─── item 1: circle = Diameter, arc = Radius ───
await test('1a: Dimension tool click on a circle makes a DIAMETER dimension (Ø 40), driving, value 40', async () => {
  await openDesign(circleDoc(), { centre: { x: 0, y: 0 }, w: 120 });
  app.tool('dim');
  await clickW({ x: 20, y: 0 });             // the rim
  await clickW({ x: 35, y: -25 });           // place the label
  await finishBox();
  const ds = allDims();
  assert.equal(ds.length, 1, 'one dimension');
  assert.equal(ds[0].isDiameter, true, 'isDiameter');
  assert.equal(ds[0].isRadius, true, 'still the radial kind (shape-based)');
  assert.equal(ds[0].value, 40, 'value is the diameter');
  assert.match(labelText(ds[0]) || '', /Ø\s*40/, 'label reads Ø 40: ' + labelText(ds[0]));
  assert.equal(app.state.shapes.find((s) => s.id === 'C1').radius, 20, 'circle unchanged');
});

await test('1b: D with a circle selected makes the same DIAMETER dimension', async () => {
  await openDesign(circleDoc(), { centre: { x: 0, y: 0 }, w: 120 });
  app.tool('select');
  await clickW({ x: 20, y: 0 });
  assert.equal(app.state.selectedShapes.size, 1, 'circle selected');
  await quiet(() => app.key('d'));
  app.frames();
  await clickW({ x: 35, y: -25 });
  await finishBox();
  const ds = allDims();
  assert.equal(ds.length, 1, 'one dimension');
  assert.equal(ds[0].isDiameter, true, 'isDiameter');
  assert.equal(ds[0].value, 40, 'value is the diameter');
});

await test('1c: Dimension tool on an ARC still makes a RADIUS (R, no isDiameter)', async () => {
  const doc = makeDoc({ ac: [0, 0, true], as: [25, 0], ae: [0, 25] },
    [{ id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'] }]);
  await openDesign(doc, { centre: { x: 0, y: 0 }, w: 120 });
  app.tool('dim');
  const a = Math.PI / 4;
  await clickW({ x: 25 * Math.cos(a), y: 25 * Math.sin(a) });
  await clickW({ x: 40, y: 40 });
  await finishBox();
  const ds = allDims();
  assert.equal(ds.length, 1, 'one dimension');
  assert.ok(!ds[0].isDiameter, 'arc is not a diameter');
  assert.equal(ds[0].isRadius, true);
  assert.match(labelText(ds[0]) || '', /^R\s*25/, 'label reads R 25: ' + labelText(ds[0]));
});

await test('1d: circle draw-time box (asks a diameter) makes a DIAMETER dimension of the typed value, no "(x) / 2"', async () => {
  await openDesign(makeDoc({}, []), { centre: { x: 0, y: 0 }, w: 160 });
  app.tool('circle');
  await clickW({ x: 0, y: 0 });
  await moveW({ x: 30, y: 0 });
  assert.equal(boxOpen() || !!app.document.getElementById('dimInput'), true, 'diameter box exists');
  await quiet(() => { app.type('60'); app.enter(); });
  app.frames();
  const circ = app.state.shapes.find((s) => s.type === 'circle');
  assert.ok(circ, 'circle made');
  assert.equal(circ.radius, 30, 'radius is half the typed diameter');
  const d = allDims()[0];
  assert.ok(d, 'a dimension was made');
  assert.equal(d.isDiameter, true, 'the dimension is a diameter');
  assert.equal(d.value, 60, 'value = the typed diameter');
  assert.equal(d.expression, undefined, 'a plain number carries no formula');
});

await test('1e: editing a circle Diameter dimension to 50 resizes the circle to radius 25', async () => {
  await openDesign(makeDoc({ cc: [0, 0, true] }, [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', isRadius: true, isDiameter: true, value: 40, offset: 30, name: 'd1' }]), { centre: { x: 0, y: 0 }, w: 120 });
  const c = dimByName('d1');
  const g = c.glyphPos || { x: 35, y: 0 };
  app.tool('select');
  const idx = app.state.constraints.indexOf(c);
  const p = app.toScreen(g.x, g.y);
  await quiet(() => { app.dblclick(p.x, p.y, { target: () => labelEl(app, idx) }); });
  app.frames();
  assert.equal(boxOpen(), true, 'edit box opens');
  await quiet(() => { boxEl().value = '50'; boxEl().dispatchEvent(new app.window.Event('input', { bubbles: true })); app.enter(); });
  app.frames();
  assert.equal(app.state.shapes.find((s) => s.id === 'C1').radius, 25, 'radius now 25');
  assert.equal(dimByName('d1').value, 50, 'dimension value 50');
});

await test('1f: a saved circle with a RADIUS dimension is left as it is (no migration)', async () => {
  await openDesign(makeDoc({ cc: [0, 0, true] }, [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', isRadius: true, value: 20, offset: 30, name: 'd1' }]), { centre: { x: 0, y: 0 }, w: 120 });
  const c = dimByName('d1');
  assert.ok(!c.isDiameter, 'still a radius');
  assert.match(labelText(c) || '', /^R\s*20/, 'label R 20: ' + labelText(c));
});

await test('1g: EQUAL between a circle with a Diameter dimension (40) and one with a Radius dimension (20) is not a conflict', async () => {
  await openDesign(makeDoc({ c1: [0, 0, true], c2: [80, 0, true] },
    [{ id: 'C1', type: 'circle', joints: ['c1'], radius: 20 }, { id: 'C2', type: 'circle', joints: ['c2'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', isRadius: true, isDiameter: true, value: 40, offset: 30, name: 'd1' },
     { type: 'distance', shape: 'C2', isRadius: true, value: 20, offset: 30, name: 'd2' }]), { centre: { x: 40, y: 0 }, w: 200 });
  const res = await quiet(() => ConstraintManager.createConstraint(app.state, 'equal', { shapes: ['C1', 'C2'] }));
  assert.ok(res, 'the equal was accepted (a diameter 40 and a radius 20 are the same size)');
  assert.ok(app.state.constraints.some((c) => c.type === 'equal'), 'the equal exists');
});

// ─── item 2 (D-8): circle / arc RIMS are picks: the distance from a point / line / another circle's centre to the centre ───
const rimDoc = () => makeDoc(
  { p1: [-40, 20], la: [10, 0], lb: [70, 0], cc: [20, -25], c2: [-30, -40], ac: [60, -40], as: [70, -40], ae: [60, -30] },
  [{ id: 'L1', type: 'line', joints: ['la', 'lb'] }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 15 },
   { id: 'C2', type: 'circle', joints: ['c2'], radius: 10 }, { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'] }],
);
const RIM = { C1: { x: 35, y: -25 }, C2: { x: -20, y: -40 }, A1: { x: 60 + 10 * Math.SQRT1_2, y: -40 + 10 * Math.SQRT1_2 } };
const P1 = { x: -40, y: 20 }, LINE = { x: 40, y: 0 };
const pairs = (c) => (c.joints || []).slice().sort().join(',');

async function pick(a, b) {
  await openDesign(rimDoc(), { centre: { x: 10, y: -10 }, w: 240 });
  app.tool('dim');
  await clickW(a); await clickW(b);
  return allDims();
}
for (const [name, first, second, joints] of [
  ['point then circle rim', P1, RIM.C1, ['cc', 'p1']],
  ['circle rim then point', RIM.C1, P1, ['cc', 'p1']],
  ['point then arc rim', P1, RIM.A1, ['ac', 'p1']],
  ['arc rim then point', RIM.A1, P1, ['ac', 'p1']],
  ['circle rim then circle rim', RIM.C1, RIM.C2, ['c2', 'cc']],
  ['circle rim then arc rim', RIM.C2, RIM.A1, ['ac', 'c2']],
  ['arc rim then circle rim', RIM.A1, RIM.C1, ['ac', 'cc']],
]) {
  await test(`2 ${name}: the distance between the two (centres), nothing else made`, async () => {
    const ds = await pick(first, second);
    assert.equal(ds.length, 1, 'exactly one dimension: ' + JSON.stringify(ds.map((d) => ({ j: d.joints, s: d.shape }))));
    assert.ok(!ds[0].isRadius, 'not a radial dimension');
    assert.equal(pairs(ds[0]), joints.slice().sort().join(','), 'between ' + joints.join(' and '));
    const [a, b] = ds[0].joints.map((j) => app.state.joints.get(j));
    const measured = ds[0].dimMode === 'horizontal' ? Math.abs(a.x - b.x) : ds[0].dimMode === 'vertical' ? Math.abs(a.y - b.y) : Math.hypot(a.x - b.x, a.y - b.y); // the mode follows the pointer, as for two points
    assert.ok(Math.abs(ds[0].value - measured) < 1e-6, 'the value is that distance (' + ds[0].dimMode + '): ' + ds[0].value + ' vs ' + measured);
    assert.ok(app.state.placingConstraint && app.state.placingConstraint === ds[0], 'its label is being placed');
  });
}
for (const [name, first, second, circle] of [
  ['line then circle rim', LINE, RIM.C1, 'cc'],
  ['circle rim then line', RIM.C1, LINE, 'cc'],
  ['arc rim then line', RIM.A1, LINE, 'ac'],
  ['line then arc rim', LINE, RIM.A1, 'ac'],
]) {
  await test(`2 ${name}: the perpendicular distance from the centre to the line`, async () => {
    const ds = await pick(first, second);
    assert.equal(ds.length, 1, 'exactly one dimension: ' + JSON.stringify(ds.map((d) => ({ j: d.joints, s: d.shape }))));
    assert.equal(ds[0].joints.length, 3, 'a point-to-line distance');
    assert.equal(ds[0].joints[0], circle, 'from the centre ' + circle);
    const c = app.state.joints.get(circle);
    assert.ok(Math.abs(ds[0].value - Math.abs(c.y)) < 1e-6, 'value ' + ds[0].value + ' = the centre height ' + Math.abs(c.y));
  });
}
await test('2 origin then circle rim: the distance from the origin to the centre', async () => {
  await openDesign(rimDoc(), { centre: { x: 10, y: -10 }, w: 240 });
  app.tool('dim');
  await clickW({ x: 0, y: 0 }); await clickW(RIM.C1);
  const ds = allDims();
  assert.equal(ds.length, 1, 'one dimension');
  assert.equal(pairs(ds[0]), ['cc', 'j_origin'].join(','), 'origin to centre');
});
await test('2 a circle rim then its OWN rim again is still the circle diameter (no distance to itself)', async () => {
  await openDesign(rimDoc(), { centre: { x: 10, y: -10 }, w: 240 });
  app.tool('dim');
  await clickW(RIM.C1);
  await clickW({ x: 20 + 15 * Math.SQRT1_2, y: -25 + 15 * Math.SQRT1_2 });   // its own rim, elsewhere: a drop, the box opens
  await finishBox();
  const ds = allDims();
  assert.equal(ds.length, 1, 'one dimension');
  assert.equal(ds[0].isDiameter, true, 'the circle diameter');
});
await test('2 point then circle rim, placed: nothing is left pending (the next click starts a fresh pick)', async () => {
  await openDesign(rimDoc(), { centre: { x: 10, y: -10 }, w: 240 });
  app.tool('dim');
  await clickW(P1); await clickW(RIM.C1); await clickW({ x: 0, y: -50 });
  await finishBox();
  assert.equal(allDims().length, 1);
  assert.equal(app.state.active, null, 'state.active cleared');
  await clickW({ x: 70, y: 0 });                    // lb: a fresh first pick
  assert.equal(allDims().length, 1, 'no hijacked distance');
  assert.deepEqual(app.state.active && app.state.active.joints, ['lb'], 'the fresh pick is lb');
});

// ─── item 3 (D-10): a dimension label drags in the Dimension tool ───
await test('3 a dimension label can be dragged while the Dimension tool is active (no new dimension, one undo step, tool kept)', async () => {
  await openDesign(makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }]), { centre: { x: 30, y: 0 }, w: 200 });
  app.tool('dim');
  const c = dimByName('d1'), idx = app.state.constraints.indexOf(c);
  const before = { offset: c.offset, slide: c.labelSlide };
  const h0 = app.state.history.length;
  const g = c.glyphPos;
  const p = app.toScreen(g.x, g.y), q = { x: p.x + 40, y: p.y - 30 };
  await quiet(() => {
    app.move(p.x, p.y);
    app.down(p.x, p.y, { target: () => labelEl(app, idx) });
    app.move(q.x, q.y, { buttons: 1 });
    app.move(q.x + 3, q.y, { buttons: 1 });
    app.up(q.x + 3, q.y);
  });
  app.frames();
  assert.equal(allDims().length, 1, 'no second dimension born by the press');
  assert.equal(app.state.currentTool, 'dim', 'the tool is kept');
  assert.equal(app.state.placingConstraint, null, 'nothing is being placed');
  const c2 = dimByName('d1');
  assert.ok(c2.offset !== before.offset || c2.labelSlide !== before.slide, 'the label moved: offset ' + before.offset + ' -> ' + c2.offset + ', slide ' + before.slide + ' -> ' + c2.labelSlide);
  assert.equal(app.state.history.length - h0, 1, 'one undo step for the drag');
  assert.equal(app.state.drag, null, 'the drag ended');
});

// ─── item 4 (D-13): a circle with only a Reference dimension takes a driving one, like a circle with none ───
await test('4 a circle with only a REFERENCE dimension: the Dimension tool places a new DRIVING diameter (same as a circle with none)', async () => {
  await openDesign(makeDoc({ cc: [0, 0, true] }, [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', isRadius: true, value: 20, isDriven: true, driven: true, offset: 30, name: 'd1' }]), { centre: { x: 0, y: 0 }, w: 120 });
  app.tool('dim');
  await clickW({ x: 20, y: 0 });
  await clickW({ x: 35, y: -25 });
  await finishBox();
  const ds = allDims();
  assert.equal(ds.length, 2, 'the reference stays, a new dimension is added: ' + JSON.stringify(ds.map((d) => ({ n: d.name, drv: !d.isDriven }))));
  const added = ds.find((d) => d.name !== 'd1');
  assert.ok(added && !added.isDriven && !added.driven, 'the new one is DRIVING');
  assert.equal(added.isDiameter, true, 'a diameter');
  assert.equal(added.value, 40);
  assert.equal(dimByName('d1').isDriven, true, 'the old reference is still a reference');
});

// ─── item 5 (D-14): a formula cannot depend on a reference dimension ───
const refDoc = () => makeDoc({ a: [0, 0, true], b: [60, 0], c: [0, 40, true], d: [40, 40], e: [80, 0, true], f: [80, 30, true] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }, { id: 'L3', type: 'line', joints: ['e', 'f'] }],
  [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'horizontal', joints: ['c', 'd'] },
   { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' },
   { type: 'distance', joints: ['c', 'd'], value: 40, dimMode: 'horizontal', offset: 20, name: 'd2' },
   { type: 'distance', joints: ['e', 'f'], value: 30, dimMode: 'vertical', offset: 20, isDriven: true, driven: true, name: 'd3' }]);
const hintEl = () => app.document.getElementById('dimHint');
const hintText = () => { const h = hintEl(); return h && !h.classList.contains('hidden') ? h.textContent.trim() : ''; };
await test('5 clicking a REFERENCE dimension while editing inserts nothing and says why; a driving one still inserts', async () => {
  await openDesign(refDoc(), { centre: { x: 40, y: 20 }, w: 260 });
  const idx = (n) => app.state.constraints.indexOf(dimByName(n));
  const P = (n) => { const g = dimByName(n).glyphPos; return app.toScreen(g.x, g.y); };
  await app.pause(550);
  await quiet(() => { const p = P('d1'); app.dblclick(p.x, p.y, { target: () => labelEl(app, idx('d1')) }); });
  assert.equal(boxOpen(), true, 'edit box open');
  await quiet(() => { app.type(' + '); });
  const before = boxEl().value;
  await quiet(() => { const p = P('d3'); app.click(p.x, p.y, { target: () => labelEl(app, idx('d3')) }); });
  assert.equal(boxEl().value, before, 'the reference name was NOT inserted: "' + boxEl().value + '"');
  assert.match(hintText(), /d3.*reference/i, 'the hint says why: "' + hintText() + '"');
  assert.equal(boxOpen(), true, 'the box stays open');
  await quiet(() => { const p = P('d2'); app.click(p.x, p.y, { target: () => labelEl(app, idx('d2')) }); });
  assert.match(boxEl().value, /d2$/, 'a driving dimension still inserts its name: "' + boxEl().value + '"');
});

// ─── item 6 (D-15): Tab commits like Enter ───
await test('6 Tab in the dimension edit box commits the typed value like Enter (one undo step, box closed)', async () => {
  await openDesign(makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }]), { centre: { x: 30, y: 0 }, w: 200 });
  const c = dimByName('d1'), idx = app.state.constraints.indexOf(c);
  const g = c.glyphPos, p = app.toScreen(g.x, g.y);
  const h0 = app.state.history.length;
  await app.pause(550);
  await quiet(() => { app.dblclick(p.x, p.y, { target: () => labelEl(app, idx) }); });
  assert.equal(boxOpen(), true, 'edit box open');
  await quiet(() => { app.key('a', { ctrl: true }); app.type('75'); app.key('Tab'); });
  app.frames();
  assert.equal(boxOpen(), false, 'the box closed');
  assert.equal(dimByName('d1').value, 75, 'the value was saved');
  assert.ok(Math.abs(app.state.joints.get('b').x - 75) < 1e-3, 'the line is 75 long');
  assert.equal(app.state.history.length - h0, 1, 'one undo step');
});

process.exitCode = failed ? 1 : 0;
if (app) { try { await app.close(); } catch (_) {} }
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
