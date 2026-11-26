// tests/lock-1012-node.test.js — TASK 1012 guarding tests (Node, real Design tab via node-app.js)
// Covers:
// - UX-06 / B-1: Lock (F / toggleFixedSelection) on Circle fixes BOTH centre and radius (0 DOF, green,
//   rim drag immovable, 1 undo step, origin-centred circle lock/unlock, EQUAL & radius dim, save/load).
// - UX-06 / B-1 (Arc): Lock on Arc keeps centre, radius, and endpoints fixed (0 DOF, green, rim drag immovable, undoable).
// - UX-26: Fillet on locked lines keeps selectionLockState(L1) = { has: true, locked: true }, green color,
//   fillet arc stays unlocked (black), fillet radius remains editable, and Unlock/Undo work cleanly.
import assert from 'node:assert/strict';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { setConstraintNotifier, ConstraintManager } from '#core/constraint-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { selectionLockState, toggleFixedSelection } from '#ui/input-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { previewDimensionInput } from '#core/parameters.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
SettingsManager.set('LOCKED_LINE_COLOR', '#8DB84A', { persist: 'none' });

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
async function openDesign(doc, { centre = { x: 40, y: 10 }, w = 220, host = 'sketchstudio' } = {}) {
  if (app) { await app.close(); app = null; }
  const profile = await createProfile();
  await quiet(async () => {
    await createNamedDesign(profile, host, 'Lock 1012', doc);
    app = await open({ host, profile, width: 1400, height: 900 });
  });
  setConstraintNotifier(showNotification);
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(app.state.view, { x: centre.x, y: centre.y, w });
  app.state.view.h = app.state.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${app.state.view.x - app.state.view.w / 2} ${app.state.view.y - app.state.view.h / 2} ${app.state.view.w} ${app.state.view.h}`);
  app.frames();
  return app;
}

async function dragWorld(from, to, steps = 8) {
  const a = app.toScreen(from.x, from.y);
  const b = app.toScreen(to.x, to.y);
  await quiet(() => {
    app.move(a.x, a.y);
    app.down(a.x, a.y);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      app.move(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, { buttons: 1 });
    }
    app.up(b.x, b.y);
  });
  app.frames();
}

function shapeStroke(shapeId) {
  app.frames();
  const el = app.svg.querySelector(`[data-shape-id="${shapeId}"]`);
  assert.ok(el, `rendered element for ${shapeId}`);
  return el.getAttribute('style') || '';
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

// ─── UX-06 / B-1 (Circle): Lock fixes centre AND radius, 0 DOF, green, rim immovable, 1 undo step ───
await test('UX-06a: Lock free circle fixes centre + radius, blocks rim drag, turns green, 1 undo step', async () => {
  const doc = makeDoc(
    { cc: [40, 0] },
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }],
  );
  await openDesign(doc, { centre: { x: 40, y: 0 }, w: 200 });
  const h0 = app.state.history.length;
  app.state.selectedShapes.clear();
  app.state.selectedShapes.add('C1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'unlocked before F');

  await quiet(() => app.key('f'));
  app.frames();
  assert.equal(app.state.history.length, h0 + 1, 'Lock records exactly 1 undo step');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'selectionLockState locked:true');

  const st = analyzeConstraintStatus(app.state);
  assert.equal(st.fixedShapes.has('C1'), true, 'locked circle must be in fixedShapes (0 DOF)');
  assert.equal(st.fixedJoints.has('cc'), true, 'circle centre must be fixed');

  // Clear selection to inspect rest stroke color
  app.state.selectedShapes.clear();
  assert.match(shapeStroke('C1'), /#8DB84A/i, 'locked circle renders in LOCKED_LINE_COLOR green');

  // Drag rim outward (60, 0) -> (85, 0): radius AND centre must stay fixed!
  const hBeforeDrag = app.state.history.length;
  await dragWorld({ x: 60, y: 0 }, { x: 85, y: 0 }, 10);
  const c1 = app.state.shapes.find((s) => s.id === 'C1');
  const cc = app.state.joints.get('cc');
  assert.ok(Math.abs(c1.radius - 20) < 1e-4, `locked circle radius must stay 20 after rim drag, got ${c1.radius}`);
  assert.ok(Math.hypot(cc.x - 40, cc.y - 0) < 1e-4, `locked circle centre must stay (40,0), got (${cc.x},${cc.y})`);
  assert.equal(app.state.history.length, hBeforeDrag, 'immovable rim drag adds 0 undo steps');

  // Save/load round-trip preserves circle lock
  const saved = JSON.parse(JSON.stringify(serializeDocument(app.state)));
  const rLoad = deserializeDocument(saved, app.state);
  assert.equal(rLoad.ok, true, 'round-trip deserialize ok');
  app.state.selectedShapes.clear();
  app.state.selectedShapes.add('C1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'lock survives save/load');
  assert.equal(analyzeConstraintStatus(app.state).fixedShapes.has('C1'), true, 'fixedShapes survives save/load');

  // Unlock via F key -> 1 undo step, circle returns free and rim drags again
  const hPreUnlock = app.state.history.length;
  await quiet(() => app.key('f'));
  app.frames();
  assert.equal(app.state.history.length, hPreUnlock + 1, 'Unlock records 1 undo step');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'unlocked after 2nd F');
  assert.equal(analyzeConstraintStatus(app.state).fixedShapes.has('C1'), false, 'no longer in fixedShapes');
  app.state.selectedShapes.clear();
  await dragWorld({ x: 60, y: 0 }, { x: 75, y: 0 }, 10);
  const rAfterUnlockDrag = app.state.shapes.find((s) => s.id === 'C1').radius;
  assert.ok(Math.abs(rAfterUnlockDrag - 35) < 1.5, `unlocked circle rim drags to ~35, got ${rAfterUnlockDrag}`);
});

await test('UX-06b: Circle centred at origin (fixed centre, free radius) locks & unlocks radius cleanly + Undo', async () => {
  const doc = makeDoc(
    {},
    [{ id: 'C1', type: 'circle', joints: ['j_origin'], radius: 20 }],
  );
  await openDesign(doc, { centre: { x: 0, y: 0 }, w: 180 });
  app.state.selectedShapes.add('C1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'origin-centred free-radius circle is NOT locked');

  const h0 = app.state.history.length;
  await quiet(() => app.key('f'));
  app.frames();
  assert.equal(app.state.history.length, h0 + 1, 'locking origin circle records 1 undo step');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'origin circle now locked');
  assert.equal(analyzeConstraintStatus(app.state).fixedShapes.has('C1'), true, 'origin circle now in fixedShapes');

  app.state.selectedShapes.clear();
  await dragWorld({ x: 20, y: 0 }, { x: 40, y: 0 }, 8);
  assert.ok(Math.abs(app.state.shapes.find((s) => s.id === 'C1').radius - 20) < 1e-4, 'locked origin circle rim immovable');

  // Ctrl+Z undoes Lock cleanly
  await quiet(() => app.undo());
  app.frames();
  app.state.selectedShapes.add('C1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'Undo unlocks origin circle');
  assert.equal(analyzeConstraintStatus(app.state).fixedShapes.has('C1'), false, 'origin circle radius free again after Undo');
});

await test('UX-06c: Locked circle participates in EQUAL constraint and auto-reference radius dimension', async () => {
  const doc = makeDoc(
    { c1: [0, 0], c2: [60, 0] },
    [
      { id: 'C1', type: 'circle', joints: ['c1'], radius: 20 },
      { id: 'C2', type: 'circle', joints: ['c2'], radius: 10 },
    ],
  );
  await openDesign(doc, { centre: { x: 30, y: 0 }, w: 220 });
  app.state.selectedShapes.add('C1');
  await quiet(() => app.key('f'));
  app.frames();
  // Equal(C1_locked, C2_free) must pull C2 to R=20 without changing locked C1!
  await quiet(() => {
    ConstraintManager.createConstraint(app.state, 'equal', { shapes: ['C1', 'C2'] }, { source: 'test' });
    app.state.engine.solve(200);
  });
  const c1 = app.state.shapes.find((s) => s.id === 'C1');
  const c2 = app.state.shapes.find((s) => s.id === 'C2');
  assert.ok(Math.abs(c1.radius - 20) < 1e-4, `locked C1 keeps R=20, got ${c1.radius}`);
  assert.ok(Math.abs(c2.radius - 20) < 1e-3, `free C2 matches locked C1 R=20, got ${c2.radius}`);

  // Adding a radius dimension on locked C1 becomes Reference (driven)
  const dim = await quiet(() => ConstraintManager.createConstraint(app.state, 'distance', { shape: 'C1', value: 20, isRadius: true }, { source: 'dimension' }));
  assert.ok(dim && (dim.isDriven || dim.driven), 'radius dim on locked circle must be born Reference (driven)');
});

// ─── UX-06 / B-1 (Arc): Lock on Arc fixes centre, radius, endpoints, blocks rim drag, 1 undo step ───
await test('UX-06d: Lock free arc fixes centre + radius + endpoints, blocks rim drag, turns green, 1 undo step', async () => {
  const doc = makeDoc(
    { ac: [0, 0], as: [20, 0], ae: [0, 20] },
    [{ id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true }],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }],
  );
  await openDesign(doc, { centre: { x: 10, y: 10 }, w: 180 });
  const h0 = app.state.history.length;
  app.state.selectedShapes.add('A1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'arc unlocked before F');

  await quiet(() => app.key('f'));
  app.frames();
  assert.equal(app.state.history.length, h0 + 1, 'Lock arc records 1 undo step');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'arc locked:true');
  assert.equal(analyzeConstraintStatus(app.state).fixedShapes.has('A1'), true, 'locked arc in fixedShapes');

  app.state.selectedShapes.clear();
  assert.match(shapeStroke('A1'), /#8DB84A/i, 'locked arc renders green');

  // Drag arc rim midpoint (20*cos45, 20*sin45) -> (35, 35): radius and centre must stay fixed
  await dragWorld({ x: 20 * Math.SQRT1_2, y: 20 * Math.SQRT1_2 }, { x: 35, y: 35 }, 10);
  const ac = app.state.joints.get('ac');
  const as = app.state.joints.get('as');
  const ae = app.state.joints.get('ae');
  assert.ok(Math.hypot(ac.x, ac.y) < 1e-4, 'arc centre unchanged');
  assert.ok(Math.abs(Math.hypot(as.x - ac.x, as.y - ac.y) - 20) < 1e-4, 'arc start radius unchanged');
  assert.ok(Math.abs(Math.hypot(ae.x - ac.x, ae.y - ac.y) - 20) < 1e-4, 'arc end radius unchanged');

  await quiet(() => app.undo());
  app.frames();
  app.state.selectedShapes.add('A1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'Undo unlocks arc');
});

// ─── UX-26: Fillet on locked lines — ONE source of truth for "is this locked" ───
await test('UX-26a: Fillet on two locked lines keeps L1/L2 locked & green, arc unlocked & black, radius editable, Unlock/Undo work', async () => {
  const doc = makeDoc(
    { a: [0, 0, true], b: [60, 0, true], c: [60, 50, true] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
    ],
  );
  await openDesign(doc, { centre: { x: 30, y: 25 }, w: 220 });
  const res = await quiet(() => applyFillet(app.state, findCornerAtJoint(app.state, 'b'), 10));
  assert.equal(res.success, true, 'fillet succeeded');
  app.frames();

  const st = analyzeConstraintStatus(app.state);
  assert.equal(st.fixedShapes.has('L1'), true, 'L1 in fixedShapes');
  assert.equal(st.fixedShapes.has('L2'), true, 'L2 in fixedShapes');
  assert.equal(st.fixedShapes.has(res.arc.id), true, 'fillet arc in fixedShapes (0 DOF)');

  // ONE source of truth: selectionLockState AND svg-renderer agree!
  app.state.selectedShapes.clear(); app.state.selectedShapes.add('L1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'selectionLockState(L1) must be locked:true');
  app.state.selectedShapes.clear(); app.state.selectedShapes.add('L2');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'selectionLockState(L2) must be locked:true');
  app.state.selectedShapes.clear(); app.state.selectedShapes.add(res.arc.id);
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'fillet arc itself is NOT locked');

  app.state.selectedShapes.clear();
  assert.match(shapeStroke('L1'), /#8DB84A/i, 'filleted locked L1 renders green (LOCKED_LINE_COLOR)');
  assert.match(shapeStroke('L2'), /#8DB84A/i, 'filleted locked L2 renders green (LOCKED_LINE_COLOR)');
  assert.match(shapeStroke(res.arc.id), /#202020/i, 'fillet arc renders black (fully constrained, not locked green)');

  // Editing fillet radius 10 -> 15 on locked lines MUST STILL WORK!
  const pv = previewDimensionInput(app.state, res.radiusConstraint, '15', { unit: 'mm' });
  const editRes = await quiet(() => applyParameterChange(app.state, pv.plan));
  assert.equal(editRes.ok, true, `fillet radius edit 10->15 on locked lines must succeed: ${JSON.stringify(editRes)}`);
  const [ac, p1] = res.arc.joints.map((id) => app.state.joints.get(id));
  assert.ok(Math.abs(Math.hypot(p1.x - ac.x, p1.y - ac.y) - 15) < 1e-3, 'fillet radius updated to 15');
  app.state.selectedShapes.clear(); app.state.selectedShapes.add('L1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'L1 stays locked after fillet radius edit');

  // Unlocking filleted L1 via F unlocks it in 1 undo step, and Ctrl+Z re-locks it
  const hPre = app.state.history.length;
  await quiet(() => app.key('f'));
  app.frames();
  assert.equal(app.state.history.length, hPre + 1, 'unlocking filleted L1 records 1 undo step');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'L1 is now unlocked');
  await quiet(() => app.undo());
  app.frames();
  app.state.selectedShapes.clear(); app.state.selectedShapes.add('L1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'Undo restores L1 locked state');
});

await test('UX-26b: Dimension-constrained line (NOT locked) stays locked:false and black; one-locked + one-free fillet keeps only locked line locked', async () => {
  // 1. Dimension-constrained line from origin: 0 DOF (fixedShapes) but NOT locked
  const docDim = makeDoc(
    { b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['j_origin', 'b'] }],
    [
      { type: 'horizontal', joints: ['j_origin', 'b'] },
      { type: 'distance', joints: ['j_origin', 'b'], value: 60, dimMode: 'horizontal', name: 'd1' },
    ],
  );
  await openDesign(docDim, { centre: { x: 30, y: 0 }, w: 200 });
  assert.equal(analyzeConstraintStatus(app.state).fixedShapes.has('L1'), true, 'dimmed line is in fixedShapes');
  app.state.selectedShapes.add('L1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'dimmed line is NOT locked');
  app.state.selectedShapes.clear();
  assert.match(shapeStroke('L1'), /#202020/i, 'dimmed line renders black, not locked green');

  // 2. One locked line (L1) + one free line (L2) meeting at locked corner b, then filleted
  const docOne = makeDoc(
    { a: [0, 0, true], b: [60, 0, true], c: [60, 50, false] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'L2', type: 'line', joints: ['b', 'c'] },
    ],
  );
  await openDesign(docOne, { centre: { x: 30, y: 25 }, w: 220 });
  const res = await quiet(() => applyFillet(app.state, findCornerAtJoint(app.state, 'b'), 10));
  assert.equal(res.success, true, 'one-locked fillet succeeded');
  app.state.selectedShapes.clear(); app.state.selectedShapes.add('L1');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: true }, 'locked leg L1 stays locked');
  app.state.selectedShapes.clear(); app.state.selectedShapes.add('L2');
  assert.deepEqual(selectionLockState(app.state), { has: true, locked: false }, 'free leg L2 stays unlocked');
});

if (app) { await app.close(); app = null; }
if (failed > 0) { console.error(`FAILED: ${failed} tests`); process.exit(1); }
console.log('ALL lock-1012-node tests PASSED');
process.exit(0);
