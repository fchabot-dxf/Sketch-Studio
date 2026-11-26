// tests/dimension-1004-node.test.js — TASK 1004 guarding tests (Node, real Design tab via node-app.js)
// Covers D-2 (Esc on recovered existing dim), D-3 (drag-release __newlyPlaced leak),
// D-1 (quick-type digit while placing drops 1st digit), D-5+D-6 (state.active & pendingDimension leaks),
// and B-7/D-20 (tool switch mid-placement leaves phantom dim across SketchStudio, Shaper, Pen Plotter).
import assert from 'node:assert/strict';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl } from './helpers/node-dom-read.js';
import SettingsManager from '#core/settings-manager.js';
import { setConstraintNotifier } from '#core/constraint-manager.js';
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
    await createNamedDesign(profile, host, 'DimFix 1004', doc);
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

async function moveW(w) {
  const p = app.toScreen(w.x, w.y);
  await quiet(() => { app.move(p.x, p.y); });
}
async function clickW(w) {
  const p = app.toScreen(w.x, w.y);
  await quiet(() => { app.move(p.x, p.y); app.down(p.x, p.y); app.up(p.x, p.y); });
  app.frames();
}

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

// ─── D-2: Esc on recovered EXISTING parallel / angle dimension must NOT delete it ───
await test('D-2a: Esc while re-placing existing parallel dimension keeps it intact', async () => {
  const doc = makeDoc(
    { a: [0, 0, true], b: [60, 0], c: [0, 30], d: [60, 30] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [{ type: 'distance', shapes: ['L1', 'L2'], value: 30, offset: 20, name: 'd1' }],
  );
  await openDesign(doc);
  const h0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });  // L1 -> length preview
  await clickW({ x: 30, y: 30 }); // L2 -> recovers existing d1 into placing
  assert.equal(app.state.placingConstraint, dimByName('d1'), 'recovered existing parallel dim into placing');
  await quiet(() => app.esc());
  app.frames();
  assert.ok(dimByName('d1'), 'existing parallel dim d1 must survive Esc');
  assert.equal(allDims().length, 1, 'still 1 dimension');
  assert.equal(dimByName('d1').__placing, false, '__placing cleared');
  assert.equal(app.state.history.length, h0, 'history unchanged');
});

await test('D-2b: Esc while re-placing existing angle dimension keeps it intact', async () => {
  const doc = makeDoc(
    { a: [0, 0, true], b: [60, 0, true], c: [30, 50] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
    [{ type: 'angle', shapes: ['L1', 'L2'], value: 59.036, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 25, name: 'd1' }],
  );
  await openDesign(doc);
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await clickW({ x: 15, y: 25 });
  assert.equal(app.state.placingConstraint, dimByName('d1'), 'recovered existing angle dim into placing');
  await quiet(() => app.esc());
  app.frames();
  assert.ok(dimByName('d1'), 'existing angle dim d1 must survive Esc');
  assert.equal(allDims().length, 1, 'still 1 dimension');
});

await test('D-2c: Esc while placing a NEW dimension still removes it and discards birth snapshot', async () => {
  const doc = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(doc);
  const h0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  assert.equal(allDims().length, 1, 'new placing dim born');
  await quiet(() => app.esc());
  app.frames();
  assert.equal(allDims().length, 0, 'new placing dim removed on Esc');
  assert.equal(app.state.history.length, h0, 'birth snapshot discarded');
});

// ─── D-3: Press-drag-release placement clears __newlyPlaced so later dblclick + Esc keeps it ───
await test('D-3: press-drag-release placement followed by dblclick + Esc keeps dimension', async () => {
  const doc = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200 });
  app.tool('dim');
  const pS = app.toScreen(30, 0);
  const pE = app.toScreen(30, -20);
  await quiet(async () => {
    app.move(pS.x, pS.y);
    app.down(pS.x, pS.y);
    app.move(pE.x, pE.y, { buttons: 1 });
    await app.pause(300);
    app.move(pE.x + 2, pE.y, { buttons: 1 });
    app.up(pE.x + 2, pE.y);
  });
  app.frames();
  assert.equal(allDims().length, 1, 'dimension placed by drag-release');
  assert.equal(allDims()[0].__placing, false, '__placing cleared');
  assert.equal(allDims()[0].__newlyPlaced, false, '__newlyPlaced cleared when drag-release ends placement');

  // Later double-click and press Esc -> must NOT delete the dimension!
  const g = allDims()[0].glyphPos;
  const pLbl = app.toScreen(g.x, g.y);
  await app.pause(550);
  app.tool('select');
  await quiet(() => { app.dblclick(pLbl.x, pLbl.y, { target: () => labelEl(app, 0) }); });
  app.frames();
  assert.equal(boxOpen(), true, 'edit box opened on dblclick');
  await quiet(() => app.esc());
  app.frames();
  assert.equal(boxOpen(), false, 'edit box closed');
  assert.equal(allDims().length, 1, 'dimension MUST NOT be deleted by Esc after drag-release placement');
});

// ─── D-1: Quick-typing multi-digit value while placing must NOT drop first digit ───
await test('D-1: quick-typing 4 then 5 + Enter while placing sets dimension to 45 (not 5)', async () => {
  const doc = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 200 });
  const h0 = app.state.history.length;
  app.tool('dim');
  await clickW({ x: 30, y: 0 });
  await moveW({ x: 30, y: -20 });
  await quiet(() => { app.key('4'); });
  app.frames();
  assert.equal(boxOpen(), true, 'edit box opened on first digit');
  assert.equal(boxEl().value, '4', 'first digit prefilled');
  // Let next animation frame run (this is where stale rAF used to select "4"!)
  app.frames(2);
  assert.equal(boxEl().selectionStart, 1, 'caret at end after 4 (not selecting 0..1)');
  assert.equal(boxEl().selectionEnd, 1, 'caret collapsed after 4');
  await quiet(() => { app.type('5'); app.enter(); });
  app.frames();
  assert.equal(boxOpen(), false, 'edit box closed');
  assert.equal(allDims()[0].value, 45, 'dimension value must be 45, not 5');
  assert.ok(Math.abs(app.state.joints.get('b').x - 45) < 1e-3, 'line resized to 45');
  assert.equal(app.state.history.length - h0, 1, 'placing + typing is 1 undo step');
});

// ─── D-5: Point-first dims must clear state.active, and P->Circle rim must clear pendingDimension ───
await test('D-5a: Point-to-Point and Point-to-Line dims clear state.active on completion', async () => {
  const doc = makeDoc(
    { p1: [-40, 20], p2: [-10, 20], la: [10, 0], lb: [70, 0] },
    [{ id: 'L1', type: 'line', joints: ['la', 'lb'] }],
  );
  await openDesign(doc, { centre: { x: 10, y: 10 }, w: 240 });
  app.tool('dim');
  // P -> P
  await clickW({ x: -40, y: 20 });
  await clickW({ x: -10, y: 20 });
  assert.equal(app.state.active, null, 'state.active cleared after 2nd point pick');
  await clickW({ x: -25, y: 35 });
  if (boxOpen()) { await quiet(() => app.enter()); app.frames(); }
  await moveW({ x: 30, y: 50 });
  assert.equal(app.state.active, null, 'state.active stays null while idle in Dim tool');

  // P -> Line
  await clickW({ x: -10, y: 20 });
  await clickW({ x: 40, y: 0 });
  assert.equal(app.state.active, null, 'state.active cleared after Point->Line pick');
  await clickW({ x: 60, y: 10 });
  if (boxOpen()) { await quiet(() => app.enter()); app.frames(); }
  assert.equal(app.state.active, null, 'state.active stays null after Point->Line placement');
});

await test('D-5b: Point then Circle rim clears pendingDimension so next click is not hijacked', async () => {
  const doc = makeDoc(
    { p1: [-40, 20], p3: [50, 30], cc: [20, -25] },
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 15 }],
  );
  await openDesign(doc, { centre: { x: 10, y: 10 }, w: 240 });
  app.tool('dim');
  await clickW({ x: -40, y: 20 }); // p1 starts pendingDimension
  await clickW({ x: 35, y: -25 }); // Circle rim -> the point-to-centre distance (task 1008, D-8)
  await clickW({ x: 45, y: -40 }); // drop it
  if (boxOpen()) { await quiet(() => app.enter()); app.frames(); }
  assert.equal(allDims().length, 1, '1 point-to-centre dim placed');
  assert.equal(app.state.active, null, 'state.active cleared');

  // Now click unrelated p3 -> must start a fresh first pick, NOT create distance(p1, p3)!
  await clickW({ x: 50, y: 30 });
  assert.equal(allDims().length, 1, 'clicking p3 must NOT hijack leaked pendingDimension into distance(p1, p3)');
  assert.equal(app.state.active?.mode, 'dim', 'p3 starts a fresh pending first pick');
  assert.deepEqual(app.state.active?.joints, ['p3'], 'fresh pick is p3, not p1');
});

// ─── D-6 & B-7 / D-20: Tool switch mid-pick & mid-placement across all 3 Node hosts ───
for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
  await test(`B-7/D-20 [${host}]: switching tool mid-placement (ribbon & shortcut) cancels phantom dim & undo step`, async () => {
    const doc = makeDoc({ a: [0, 0, true], b: [60, 0] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
    // Via ribbon
    await openDesign(doc, { host });
    const h0 = app.state.history.length;
    app.tool('dim');
    await clickW({ x: 30, y: 0 });
    assert.equal(allDims().length, 1, 'placing dim created');
    assert.ok(app.state.placingConstraint, 'placingConstraint active');
    app.tool('line');
    assert.equal(app.state.currentTool, 'line', 'switched to line');
    assert.equal(app.state.placingConstraint, null, 'placingConstraint cleared on ribbon switch');
    assert.equal(allDims().length, 0, 'phantom placing dim removed on ribbon switch');
    assert.equal(app.state.history.length, h0, 'birth snapshot discarded on ribbon switch');

    // Via shortcut 'l'
    await openDesign(doc, { host });
    const h1 = app.state.history.length;
    app.tool('dim');
    await clickW({ x: 30, y: 0 });
    await quiet(() => app.key('l'));
    app.frames();
    assert.equal(app.state.currentTool, 'line', 'switched to line via key');
    assert.equal(app.state.placingConstraint, null, 'placingConstraint cleared on key switch');
    assert.equal(allDims().length, 0, 'phantom placing dim removed on key switch');
    assert.equal(app.state.history.length, h1, 'birth snapshot discarded on key switch');

    // Switching tool while re-placing an EXISTING parallel dim must KEEP it!
    const docPar = makeDoc(
      { a: [0, 0, true], b: [60, 0], c: [0, 30], d: [60, 30] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
      [{ type: 'distance', shapes: ['L1', 'L2'], value: 30, offset: 20, name: 'd1' }],
    );
    await openDesign(docPar, { host });
    app.tool('dim');
    await clickW({ x: 30, y: 0 });
    await clickW({ x: 30, y: 30 });
    app.tool('line');
    assert.ok(dimByName('d1'), 'existing parallel dim preserved on tool switch');
    assert.equal(dimByName('d1').__placing, false, '__placing cleared on existing dim');

    // Re-clicking #tool-dim while placing must NOT exit or cancel (owner ruling turn 3741)
    await openDesign(doc, { host });
    app.tool('dim');
    await clickW({ x: 30, y: 0 });
    app.tool('dim');
    assert.equal(app.state.currentTool, 'dim', 're-clicking Dim stays in Dim');
    assert.ok(app.state.placingConstraint, 're-clicking Dim does not cancel active placement');
  });

  await test(`D-6 [${host}]: switching tool mid-pick clears pendingDimension`, async () => {
    const doc = makeDoc({ a: [0, 0, true], b: [60, 0], p: [30, 40] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
    await openDesign(doc, { host });
    app.tool('dim');
    await clickW({ x: 0, y: 0 }); // 1st pick = a
    app.tool('line');
    assert.equal(app.state.active, null, 'state.active cleared on switch away');
    app.tool('dim');
    await clickW({ x: 30, y: 40 }); // click p -> must start fresh pick, NOT pair with a!
    assert.equal(allDims().length, 0, 'no hijacked distance(a, p) after mid-pick tool switch');
  });
}

if (app) { try { resetDimensionState(app.state); } catch (_) {} await app.close(); app = null; }
if (failed > 0) { console.error(`FAILED: ${failed} tests`); process.exit(1); }
console.log('ALL dimension-1004-node tests PASSED');
process.exit(0);
