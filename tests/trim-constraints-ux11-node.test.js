// tests/trim-constraints-ux11-node.test.js -- UX-11 (TASK 1007):
//  1. Trimming a line against a cutter constrains the cut end to the cutter (pointOnLine / coincident),
//     so dragging the cutter moves the trimmed end along with it.
//  2. Trimming a dimensioned rectangle edge removes the dimension across the removed span even when
//     adjacent edges keep both corner joints alive.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const docOf = (joints, shapes, constraints) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints.map(([id, j]) => [id, { fixed: false, sketchId: 'sketch-1', ...j }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
    constraints, parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});

let app = null;
async function openDoc(doc) {
  if (app) { await app.close(); app = null; }
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'UX-11 Trim', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const J = (id) => S().joints.get(id);
const trimAt = (x, y) => { app.tool('trim'); const p = app.toScreen(x, y); app.click(p.x, p.y); app.tool('select'); };

try {
  // 1. Crossing cutter: trim L1 right half -> new cut end has pointOnLine on cutter L2 and follows L2 when dragged
  await openDoc(docOf(
    [['a', { x: 0, y: 20, fixed: true }], ['b', { x: 100, y: 20 }], ['c', { x: 50, y: 0 }], ['d', { x: 50, y: 60 }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['c', 'd'] }],
  ));
  trimAt(80, 20);
  const cutEnd = S().shapes.find((s) => s.id === 'L1').joints[1];
  assert.ok(
    S().constraints.some((c) => c.type === 'pointOnLine' && c.joint === cutEnd && c.shape === 'L2'),
    `Cut end ${cutEnd} must get pointOnLine on cutter L2`,
  );
  app.drag(app.toScreen(J('c').x, J('c').y), app.toScreen(70, 0), 12);
  assert.ok(Math.abs(J(cutEnd).x - 70) < 1e-2 && Math.abs(J(cutEnd).y - 20) < 1e-2, `Cut end followed dragged cutter to ~70,20; got (${J(cutEnd).x}, ${J(cutEnd).y})`);

  // 2. Shared-corner dimensioned rectangle edge: trimming right half removes width dim d1 across removed span
  await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 80, y: 0 }], ['c', { x: 80, y: 40 }], ['d', { x: 0, y: 40 }], ['x1', { x: 40, y: -10, fixed: true }], ['x2', { x: 40, y: 50, fixed: true }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] },
      { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] },
      { id: 'LX', type: 'line', joints: ['x1', 'x2'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['b', 'c'] },
      { type: 'horizontal', joints: ['c', 'd'] }, { type: 'vertical', joints: ['d', 'a'] },
      { type: 'distance', joints: ['a', 'b'], value: 80, name: 'd1', offset: -12 },
      { type: 'distance', joints: ['b', 'c'], value: 40, name: 'd2', offset: 12 }],
  ));
  trimAt(60, 0);
  const l1 = S().shapes.find((s) => s.id === 'L1');
  assert.strictEqual(l1.joints[0], 'a');
  assert.ok(Math.abs(J(l1.joints[1]).x - 40) < 1e-3, 'L1 cut at x=40');
  assert.ok(!S().constraints.some((c) => c.name === 'd1'), 'Old width dimension d1 across removed span must be deleted');
  assert.ok(S().constraints.some((c) => c.name === 'd2'), 'Surviving side dimension d2 stays');
  app.undo();
  assert.ok(S().constraints.some((c) => c.name === 'd1'), 'Undo restores d1');

  // 3. T-junction cutter (cutter ends on L1): cut end gets coincident to cutter's endpoint
  await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 100, y: 0 }], ['c', { x: 40, y: -30 }], ['d', { x: 40, y: 0 }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['c', 'd'] }],
  ));
  trimAt(80, 0);
  const tjEnd = S().shapes.find((s) => s.id === 'L1').joints[1];
  assert.ok(
    S().constraints.some((c) => c.type === 'coincident' && c.joints.includes(tjEnd) && c.joints.includes('d')),
    'T-junction trim constrains cut end coincident to cutter endpoint',
  );
  app.drag(app.toScreen(J('c').x, J('c').y), app.toScreen(65, -30), 12);
  assert.ok(Math.abs(J(tjEnd).x - J('c').x) < 1e-3 && Math.abs(J(tjEnd).x - 65) < 0.1 && Math.abs(J(tjEnd).y) < 1e-2, `T-junction cut end follows cutter to ~65,0; got (${J(tjEnd).x}, ${J(tjEnd).y})`);

  console.log('trim-constraints-ux11-node: ok');
} finally {
  if (app) await app.close();
}
