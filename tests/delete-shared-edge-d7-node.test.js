// tests/delete-shared-edge-d7-node.test.js -- D-7 (TASK 1007):
// Deleting one edge L1(a,b) of a rectangle whose corners are shared with surviving sides removes every constraint
// and dimension referencing that line (including point-to-line distance [p, a, b] and edge distance [a, b]).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 60, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c', { x: 60, y: 40, fixed: false, sketchId: 'sketch-1' }],
      ['d', { x: 0, y: 40, fixed: false, sketchId: 'sketch-1' }],
      ['p', { x: 30, y: -25, fixed: false, sketchId: 'sketch-1' }],
      ['m', { x: 30, y: 0, fixed: false, sketchId: 'sketch-1' }],
    ],
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 'sketch-1' },
      { id: 'L3', type: 'line', joints: ['c', 'd'], sketchId: 'sketch-1' },
      { id: 'L4', type: 'line', joints: ['d', 'a'], sketchId: 'sketch-1' },
    ],
    constraints: [
      { type: 'horizontal', joints: ['a', 'b'] },
      { type: 'vertical', joints: ['b', 'c'] },
      { type: 'horizontal', joints: ['c', 'd'] },
      { type: 'vertical', joints: ['d', 'a'] },
      { type: 'midpoint', joints: ['a', 'b', 'm'] },
      { type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -10, name: 'd1' },
      { type: 'distance', joints: ['p', 'a', 'b'], value: 25, offset: 15, name: 'd2' },
      { type: 'distance', joints: ['b', 'c'], value: 40, dimMode: 'vertical', offset: 10, name: 'd3' },
    ],
    parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'D-7 Delete Shared Edge', doc);
const app = await open({ host: 'sketchstudio', profile });

try {
  app.tool('select');
  app.state.selectedShapes.add('L1');
  app.key('Delete');
  app.frames(2);

  assert.strictEqual(app.state.shapes.some((s) => s.id === 'L1'), false, 'L1 was deleted');
  assert.strictEqual(app.state.shapes.length, 3, 'Other 3 edges survive');
  assert.strictEqual(app.state.constraints.some((c) => c.name === 'd1'), false, 'Own edge length d1 deleted');
  assert.strictEqual(app.state.constraints.some((c) => c.name === 'd2'), false, 'Point-to-line dim d2=[p,a,b] deleted (D-7)');
  assert.strictEqual(app.state.constraints.some((c) => c.type === 'horizontal' && c.joints.includes('a') && c.joints.includes('b')), false, 'Horizontal [a,b] deleted');
  assert.strictEqual(app.state.constraints.some((c) => c.type === 'midpoint' && c.joints.includes('m')), false, 'Midpoint [a,b,m] deleted');
  assert.strictEqual(app.state.constraints.some((c) => c.name === 'd3'), true, 'Surviving edge dim d3 kept');
  assert.strictEqual(app.svg.querySelectorAll('.dim-label').length, 1, 'Only 1 dimension label (d3) remains in DOM');

  app.undo();
  app.frames(2);
  assert.strictEqual(app.state.shapes.length, 4, 'Undo restores L1');
  assert.ok(app.state.constraints.some((c) => c.name === 'd2'), 'Undo restores d2');
  console.log('delete-shared-edge-d7-node: ok');
} finally {
  await app.close();
}
