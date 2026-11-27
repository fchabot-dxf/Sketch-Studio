// tests/break-at-joint-r205-1018-node.test.js -- TASK 1018, audit R2-05: Break clicked on a point already held on the line (a hole's centre at
// its midpoint, or a point on it) splits the line AT that point. It used to make a new, detached joint beside it, so dragging the break point
// slid it away from the hole.
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

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'R2-05 break at joint', docOf(
  [['a', { x: 150, y: 0, fixed: true }], ['b', { x: 0, y: -100, fixed: true }], ['h', { x: 75, y: -50 }],
    ['p', { x: 0, y: 20, fixed: true }], ['q', { x: 100, y: 20, fixed: true }], ['g', { x: 40, y: 20 }]],
  [{ id: 'HYP', type: 'line', joints: ['a', 'b'] }, { id: 'H1', type: 'circle', joints: ['h'], radius: 2.5 },
    { id: 'TOP', type: 'line', joints: ['p', 'q'] }, { id: 'H2', type: 'circle', joints: ['g'], radius: 2.5 }],
  [{ type: 'midpoint', joints: ['a', 'b', 'h'] }, { type: 'pointOnLine', joint: 'g', shape: 'TOP' },
    { type: 'distance', joints: ['p', 'g'], value: 40, name: 'd1' }],
));
const app = await open({ host: 'sketchstudio', profile });
const S = () => app.state;
const J = (id) => S().joints.get(id);
const shape = (id) => S().shapes.find((s) => s.id === id);

try {
  app.tool('break');
  // a click 4 px along the hypotenuse from the hole's centre (inside the joint pick radius): the split is AT the centre
  const ph = app.toScreen(75, -50), pa = app.toScreen(150, 0), L = Math.hypot(pa.x - ph.x, pa.y - ph.y);
  const n0 = S().joints.size;
  const hover = () => app.document.getElementById('break-tool-overlay');
  app.move(Math.round(ph.x + 4 * (pa.x - ph.x) / L), Math.round(ph.y + 4 * (pa.y - ph.y) / L));
  assert.ok(hover() && hover().innerHTML.includes(`cx="75"`) && hover().innerHTML.includes(`cy="-50"`), `the hover marks the hole's centre (got ${hover() && hover().innerHTML.trim().slice(0, 80)})`);
  app.click(Math.round(ph.x + 4 * (pa.x - ph.x) / L), Math.round(ph.y + 4 * (pa.y - ph.y) / L));
  const hyp = shape('HYP'), other = S().shapes.find((s) => s.type === 'line' && s.id !== 'HYP' && s.id !== 'TOP' && s.joints.includes('b'));
  assert.deepStrictEqual(hyp.joints, ['a', 'h'], 'the hypotenuse now ends AT the hole centre');
  assert.ok(other && other.joints[0] === 'h', 'the second piece starts at the hole centre');
  assert.strictEqual(S().joints.size, n0, 'no new joint');
  assert.ok(S().constraints.some((c) => c.type === 'midpoint' && c.joints && c.joints.join() === 'a,b,h'), 'the hole stays at the middle of the whole line');

  // a point held on TOP (pointOnLine): the same; its pointOnLine goes (it is now both pieces' end), its dimension stays
  const pg = app.toScreen(40, 20);
  app.click(pg.x + 3, pg.y);
  const top = shape('TOP');
  assert.deepStrictEqual(top.joints, ['p', 'g'], 'TOP now ends AT the held point');
  assert.ok(!S().constraints.some((c) => c.type === 'pointOnLine' && c.joint === 'g'), 'its point-on-line went (it is an end now)');
  assert.ok(S().constraints.some((c) => c.name === 'd1'), 'its dimension stays');

  // dragging the split point drags the hole with it: they are one point
  app.tool('select');
  S().engine.solve(200);
  app.drag(app.toScreen(75, -50), app.toScreen(90, -70), 12);
  const piece2 = S().shapes.find((s) => s.type === 'line' && s.joints.includes('b') && s.id !== 'HYP');
  assert.ok(shape('HYP').joints[1] === 'h' && piece2.joints[0] === 'h' && shape('H1').joints[0] === 'h', 'the pieces still meet at the hole centre');
  console.log('break-at-joint-r205-1018-node: ok');
} finally {
  await app.close();
}
