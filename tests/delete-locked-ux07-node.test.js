// tests/delete-locked-ux07-node.test.js -- UX-07 = B-5 = D-21 (TASK 1007):
// Selected constraints / dimensions belonging to a locked sketch must NOT be deleted by deleteSelection.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 60, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c', { x: 0, y: 30, fixed: false, sketchId: 'sketch-2' }],
      ['d', { x: 40, y: 30, fixed: false, sketchId: 'sketch-2' }],
    ],
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['c', 'd'], sketchId: 'sketch-2' },
    ],
    constraints: [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -10, name: 'd1' },
      { type: 'distance', joints: ['c', 'd'], value: 40, dimMode: 'horizontal', offset: 10, name: 'd2' },
    ],
    parameters: [],
    sketches: [
      { id: 'sketch-1', name: 'Sketch 1', visible: true, locked: true },
      { id: 'sketch-2', name: 'Sketch 2', visible: true, locked: false },
    ],
    activeSketchId: 'sketch-2', groups: [], profiles: [],
  },
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'UX-07 Locked Delete', doc);
const app = await open({ host: 'sketchstudio', profile });

try {
  const d1 = app.state.constraints.find((c) => c.name === 'd1');
  const h1 = app.state.constraints.find((c) => c.type === 'horizontal');
  const d2 = app.state.constraints.find((c) => c.name === 'd2');
  const hist0 = app.state.history.length;

  app.state.selectedShapes.add('L1');
  app.state.selectedConstraints.add(d1);
  app.state.selectedConstraints.add(h1);
  app.key('Delete');
  app.frames(2);

  assert.strictEqual(app.state.shapes.some((s) => s.id === 'L1'), true, 'Locked shape L1 survives Delete');
  assert.strictEqual(app.state.constraints.includes(d1), true, 'Locked dim d1 survives Delete');
  assert.strictEqual(app.state.constraints.includes(h1), true, 'Locked constraint H survives Delete');
  assert.strictEqual(app.state.history.length, hist0, 'Locked Delete writes no undo step');

  // Unlocked sketch constraint still deletes cleanly
  app.state.selectedShapes.clear();
  app.state.selectedConstraints.clear();
  app.state.selectedConstraints.add(d2);
  app.key('Delete');
  app.frames(2);
  assert.strictEqual(app.state.constraints.includes(d2), false, 'Unlocked dim d2 deletes normally');
  assert.strictEqual(app.state.constraints.includes(d1), true, 'Locked dim d1 still intact');

  console.log('delete-locked-ux07-node: ok');
} finally {
  await app.close();
}
