// tests/drag-mixed-selection-ux22-1011-node.test.js -- TASK 1011 (UX-22):
// Multi-selecting a locked/fixed item together with a free item and dragging must move the free item
// while keeping fixed/0-DOF items stationary. An all-fixed selection still moves nothing and records no undo step.
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
      ['b', { x: 40, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['p', { x: 60, y: 20, fixed: false, sketchId: 'sketch-1' }],
      ['q', { x: 100, y: 20, fixed: false, sketchId: 'sketch-1' }],
      ['f1', { x: 0, y: -30, fixed: true, sketchId: 'sketch-1' }],
      ['f2', { x: 40, y: -30, fixed: true, sketchId: 'sketch-1' }],
      // 0-DOF rectangle via constraints (r2, r3, r4 are NOT .fixed, but 0 DOF)
      ['r1', { x: -60, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['r2', { x: -20, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['r3', { x: -20, y: 30, fixed: false, sketchId: 'sketch-1' }],
      ['r4', { x: -60, y: 30, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['p', 'q'], sketchId: 'sketch-1' },
      { id: 'Lfix', type: 'line', joints: ['f1', 'f2'], sketchId: 'sketch-1' },
      { id: 'R1', type: 'line', joints: ['r1', 'r2'], sketchId: 'sketch-1' },
      { id: 'R2', type: 'line', joints: ['r2', 'r3'], sketchId: 'sketch-1' },
      { id: 'R3', type: 'line', joints: ['r3', 'r4'], sketchId: 'sketch-1' },
      { id: 'R4', type: 'line', joints: ['r4', 'r1'], sketchId: 'sketch-1' },
    ],
    constraints: [
      H('r1', 'r2'), V('r2', 'r3'), H('r3', 'r4'), V('r4', 'r1'),
      D('r1', 'r2', 40, 'd1'), D('r2', 'r3', 30, 'd2'),
    ],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  },
};

const quiet = (fn) => {
  const l = console.log, w = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.log = l; console.warn = w; }
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'UX-22 Mixed Selection', DOC);
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state;
  const P = (id) => ({ x: st.joints.get(id).x, y: st.joints.get(id).y });
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 20, y: 10, w: 300 });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();

  const dragW = (from, to, steps = 15) => quiet(() => {
    const a = app.toScreen(from.x, from.y), b = app.toScreen(to.x, to.y);
    app.drag(a, b, steps);
  });

  // Case A (DR6.3a): fixed L1 + free L2 selected together, drag free L2 (+0, +40)
  st.selectedShapes.clear(); st.selectedJoints.clear();
  st.selectedShapes.add('L1'); st.selectedShapes.add('L2');
  const h0 = st.history.length;
  dragW({ x: 80, y: 20 }, { x: 80, y: 60 });
  assert.strictEqual(dist(P('a'), { x: 0, y: 0 }), 0, 'Case A: fixed L1.a stays');
  assert.strictEqual(dist(P('b'), { x: 40, y: 0 }), 0, 'Case A: fixed L1.b stays');
  assert.ok(Math.abs(P('p').y - 60) < 1 && Math.abs(P('q').y - 60) < 1, `Case A: free L2 moved +40 in Y (p=${JSON.stringify(P('p'))}, q=${JSON.stringify(P('q'))})`);
  assert.strictEqual(st.history.length, h0 + 1, 'Case A: one undo step recorded');
  app.undo();
  assert.ok(dist(P('p'), { x: 60, y: 20 }) < 1e-9 && dist(P('q'), { x: 100, y: 20 }) < 1e-9, 'Case A: undo restores L2');

  // Case B: fixed L1 + free L2 selected together, drag by grabbing FIXED L1 (+20, +30)
  st.selectedShapes.clear(); st.selectedJoints.clear();
  st.selectedShapes.add('L1'); st.selectedShapes.add('L2');
  dragW({ x: 20, y: 0 }, { x: 40, y: 30 });
  assert.strictEqual(dist(P('a'), { x: 0, y: 0 }), 0, 'Case B: fixed L1.a stays when dragged directly');
  assert.strictEqual(dist(P('b'), { x: 40, y: 0 }), 0, 'Case B: fixed L1.b stays when dragged directly');
  assert.ok(Math.abs(P('p').x - 80) < 1 && Math.abs(P('p').y - 50) < 1, `Case B: free L2 moved (+20,+30) (p=${JSON.stringify(P('p'))})`);
  app.undo();

  // Case C: 0-DOF constrained rectangle + free L2 selected together, drag L2 (+0, +35)
  st.selectedShapes.clear(); st.selectedJoints.clear();
  for (const id of ['R1', 'R2', 'R3', 'R4', 'L2']) st.selectedShapes.add(id);
  const rBefore = ['r1', 'r2', 'r3', 'r4'].map(P);
  dragW({ x: 80, y: 20 }, { x: 80, y: 55 });
  for (const [i, id] of ['r1', 'r2', 'r3', 'r4'].entries()) {
    assert.ok(dist(P(id), rBefore[i]) < 1e-9, `Case C: 0-DOF rect corner ${id} stayed put (moved ${dist(P(id), rBefore[i])})`);
  }
  assert.ok(Math.abs(P('p').y - 55) < 1 && Math.abs(P('q').y - 55) < 1, `Case C: free L2 moved +35 in Y (p=${JSON.stringify(P('p'))})`);
  app.undo();

  // Case D: all-fixed selection (L1 + Lfix) -> nothing moves, no undo step
  st.selectedShapes.clear(); st.selectedJoints.clear();
  st.selectedShapes.add('L1'); st.selectedShapes.add('Lfix');
  const hAllFix = st.history.length;
  dragW({ x: 20, y: 0 }, { x: 20, y: 40 });
  assert.strictEqual(dist(P('a'), { x: 0, y: 0 }), 0, 'Case D: fixed L1 stayed');
  assert.strictEqual(dist(P('f1'), { x: 0, y: -30 }), 0, 'Case D: fixed Lfix stayed');
  assert.strictEqual(st.history.length, hAllFix, 'Case D: all-fixed selection leaves no undo step');

  console.log('drag-mixed-selection-ux22-1011-node: ok');
} finally {
  await app.close();
}
