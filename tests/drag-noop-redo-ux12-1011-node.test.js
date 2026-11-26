// tests/drag-noop-redo-ux12-1011-node.test.js -- TASK 1011 (UX-12):
// Dragging an item that cannot move (0 DOF), or a drag that ends where it started, must record no undo step
// and preserve state.redoStack (and any evicted history entry at maxHistory).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });

const D = (a, b, value, name) => ({ type: 'distance', joints: [a, b], value, name });
const H = (a, b) => ({ type: 'horizontal', joints: [a, b] });
const V = (a, b) => ({ type: 'vertical', joints: [a, b] });

const DOC = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 80, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c', { x: 80, y: 40, fixed: false, sketchId: 'sketch-1' }],
      ['d', { x: 0, y: 40, fixed: false, sketchId: 'sketch-1' }],
      ['p', { x: -40, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['q', { x: -40, y: 30, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 'sketch-1' },
      { id: 'L3', type: 'line', joints: ['c', 'd'], sketchId: 'sketch-1' },
      { id: 'L4', type: 'line', joints: ['d', 'a'], sketchId: 'sketch-1' },
      { id: 'Lfree', type: 'line', joints: ['p', 'q'], sketchId: 'sketch-1' },
    ],
    constraints: [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2')],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

const quiet = (fn) => {
  const l = console.log, w = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; }
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'UX-12 Redo', DOC);
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state;
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 20, y: 20, w: 260 });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();

  const dragW = (from, to, steps = 10) => quiet(() => {
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    app.drag(a, b, steps);
  });

  // 1. Move the free point p, then undo so redoStack holds 1 entry
  dragW({ x: -40, y: 0 }, { x: -60, y: -15 });
  const movedP = { x: st.joints.get('p').x, y: st.joints.get('p').y };
  assert.ok(Math.hypot(movedP.x - (-40), movedP.y - 0) > 10, 'free point p moved');
  app.undo();
  assert.strictEqual(st.redoStack.length, 1, 'undo populated redoStack with 1 entry');
  const histBefore = st.history.length;
  const redoEntryBefore = st.redoStack[0];

  // 2. Drag the 0-DOF corner c: must move 0, add no history entry, and KEEP redoStack
  const c0 = { x: st.joints.get('c').x, y: st.joints.get('c').y };
  dragW(c0, { x: c0.x + 30, y: c0.y + 30 });
  const c1 = st.joints.get('c');
  assert.strictEqual(Math.hypot(c1.x - c0.x, c1.y - c0.y), 0, '0-DOF corner c did not move');
  assert.strictEqual(st.history.length, histBefore, '0-DOF joint drag recorded no history step');
  assert.strictEqual(st.redoStack.length, 1, `0-DOF joint drag preserved redoStack (got ${st.redoStack.length})`);
  assert.strictEqual(st.redoStack[0], redoEntryBefore, 'exact redo entry preserved');

  // 3. Drag the 0-DOF edge body L2: must also move 0 and KEEP redoStack
  dragW({ x: 80, y: 20 }, { x: 110, y: 20 });
  assert.strictEqual(st.history.length, histBefore, '0-DOF body drag recorded no history step');
  assert.strictEqual(st.redoStack.length, 1, `0-DOF body drag preserved redoStack (got ${st.redoStack.length})`);

  // 4. Ctrl+Y still redoes the undone move of p
  app.redo();
  assert.ok(Math.hypot(st.joints.get('p').x - movedP.x, st.joints.get('p').y - movedP.y) < 1e-6, 'redo still re-applies the undone drag');

  // 5. History-at-cap (maxHistory) eviction must also be restored on a 0-DOF drag
  st.maxHistory = 2;
  dragW(movedP, { x: movedP.x - 10, y: movedP.y });
  dragW({ x: st.joints.get('p').x, y: st.joints.get('p').y }, { x: st.joints.get('p').x - 10, y: st.joints.get('p').y });
  assert.strictEqual(st.history.length, 2, 'history is at maxHistory cap');
  const oldest = st.history[0];
  dragW(c0, { x: c0.x + 25, y: c0.y + 25 });
  assert.strictEqual(st.history.length, 2, 'history length unchanged after 0-DOF drag at cap');
  assert.strictEqual(st.history[0], oldest, 'oldest history entry was not evicted by a 0-DOF drag');

  console.log('drag-noop-redo-ux12-1011-node: ok');
} finally {
  await app.close();
}
