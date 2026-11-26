// tests/break-constraints-ux04-node.test.js -- UX-04 (TASK 1007): Break preserves constraints on both pieces
// (horizontal / vertical transferred to both pieces, collinear between them, whole-line length dimension kept
// between original endpoints) so dragging the break midpoint does NOT bend a constrained line into a V.
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
  await createNamedDesign(profile, 'sketchstudio', 'UX-04 Break', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const J = (id) => S().joints.get(id);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const hasPairC = (type, pair) => S().constraints.some((c) => c.type === type && Array.isArray(c.joints) && sameSet(c.joints, pair));
const hasCollinear = (id1, id2) => S().constraints.some((c) => c.type === 'collinear' && Array.isArray(c.shapes) && sameSet(c.shapes, [id1, id2]));

try {
  // 1. Horizontal, dimensioned 80 mm line: break at midpoint -> drag break point off-line
  await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 80, y: 0 }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 80, name: 'd1', offset: -12 }],
  ));

  app.tool('break');
  const midScr = app.toScreen(40, 0);
  app.click(midScr.x, midScr.y);
  app.tool('select');

  const lines = S().shapes.filter((s) => s.type === 'line');
  assert.strictEqual(lines.length, 2, 'Break splits L1 into 2 lines');
  const left = S().shapes.find((s) => s.id === 'L1');
  const right = lines.find((s) => s.id !== 'L1');
  const midId = left.joints[1];
  assert.strictEqual(right.joints[0], midId, 'Right piece starts at the break joint');
  assert.ok(hasPairC('horizontal', left.joints), 'Left piece keeps horizontal constraint');
  assert.ok(hasPairC('horizontal', right.joints), 'Right piece keeps horizontal constraint');
  assert.ok(hasCollinear(left.id, right.id), 'Collinear constraint links both broken pieces');
  assert.ok(S().constraints.some((c) => c.name === 'd1' && sameSet(c.joints, ['a', 'b'])), 'Overall length dimension d1 kept on [a, b]');

  // Drag the break joint vertically toward (40, 30): must stay on y = 0 (no V bend)
  app.drag(app.toScreen(J(midId).x, J(midId).y), app.toScreen(45, 30), 12);
  assert.ok(Math.abs(J(midId).y) < 1e-3, `Break point stayed horizontal (y=${J(midId).y}), no V bend`);
  assert.ok(Math.abs(J('b').x - 80) < 1e-3 && Math.abs(J('b').y) < 1e-3, `End b kept at (80, 0): (${J('b').x}, ${J('b').y})`);

  // Undo restores single unbroken line
  app.undo(); app.undo();
  assert.strictEqual(S().shapes.filter((s) => s.type === 'line').length, 1, 'Undo restores unbroken line');

  // 2. Slanted free line (no H/V): break -> collinear keeps both pieces collinear when dragging break point
  await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 60, y: 60, fixed: true }]],
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [],
  ));
  app.tool('break');
  const midSlant = app.toScreen(30, 30);
  app.click(midSlant.x, midSlant.y);
  app.tool('select');
  const slines = S().shapes.filter((s) => s.type === 'line');
  assert.strictEqual(slines.length, 2, 'Slanted line split into 2');
  const sl = slines.find((s) => s.id === 'L1'), sr = slines.find((s) => s.id !== 'L1');
  const sm = sl.joints[1];
  assert.ok(hasCollinear(sl.id, sr.id), 'Slanted broken pieces share collinear constraint');
  app.drag(app.toScreen(J(sm).x, J(sm).y), app.toScreen(50, 10), 12);
  assert.ok(Math.abs(J(sm).x - J(sm).y) < 1e-3, `Slanted break point stays on line x=y (${J(sm).x}, ${J(sm).y})`);

  console.log('break-constraints-ux04-node: ok');
} finally {
  if (app) await app.close();
}
