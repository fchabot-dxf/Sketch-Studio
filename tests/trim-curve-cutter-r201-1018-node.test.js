// tests/trim-curve-cutter-r201-1018-node.test.js -- TASK 1018, audit R2-01: an ARC (or a circle) is a cutter too.
// A right-angle gusset with an R 15 relief arc round its corner: trimming the 15 mm stub of each leg (between the corner and the arc) cuts only the
// stub, at the arc, and the cut end is held on the arc. It used to delete the WHOLE leg (trim.js skipped every cutter that was not a line).
// A circle cuts a line the same way.
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
  await createNamedDesign(profile, 'sketchstudio', 'R2-01 arc cutter', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const J = (id) => S().joints.get(id);
const shape = (id) => S().shapes.find((s) => s.id === id);
const near = (p, x, y, tol = 1e-3) => p && Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol;
const clickW = (x, y) => { const p = app.toScreen(x, y); app.click(p.x, p.y); };
const heldOnArc = (jid, arcId) => S().constraints.some((c) => (c.type === 'pointOnLine' && c.joint === jid && c.shape === arcId)
  || (c.type === 'coincident' && c.joints.includes(jid) && shape(arcId).joints.slice(1).some((j) => c.joints.includes(j))));

try {
  // The gusset: legs L1 (corner k -> (150, 0)) and L2 (k -> (0, -100)), hypotenuse H, relief arc A (centre k, R 15) from L1 to L2
  await openDoc(docOf(
    [['k', { x: 0, y: 0 }], ['b', { x: 150, y: 0 }], ['c', { x: 0, y: -100 }], ['r1', { x: 15, y: 0 }], ['r2', { x: 0, y: -15 }]],
    [{ id: 'L1', type: 'line', joints: ['k', 'b'] }, { id: 'L2', type: 'line', joints: ['k', 'c'] }, { id: 'H', type: 'line', joints: ['b', 'c'] },
      { id: 'A', type: 'arc', subType: 'CENTER', joints: ['k', 'r1', 'r2'], sweep: false }],
    [{ type: 'equal', joints: ['k', 'r1', 'k', 'r2'] }, { type: 'pointOnLine', joint: 'r1', shape: 'L1' }, { type: 'pointOnLine', joint: 'r2', shape: 'L2' },
      { type: 'distance', shape: 'A', isRadius: true, value: 15, name: 'd1' }, { type: 'horizontal', joints: ['k', 'b'] }],
  ));
  app.tool('trim');
  clickW(7, 0);
  clickW(0, -7);
  const lines = S().shapes.filter((s) => s.type === 'line');
  assert.strictEqual(lines.length, 3, `both legs and the hypotenuse stay (got ${lines.map((s) => s.id)})`);
  const l1 = shape('L1'), l2 = shape('L2');
  assert.ok(l1 && near(J(l1.joints[0]), 15, 0) && l1.joints[1] === 'b', `L1 now starts at the arc, (15, 0) (got ${JSON.stringify(l1 && l1.joints.map(J))})`);
  assert.ok(l2 && near(J(l2.joints[0]), 0, -15) && l2.joints[1] === 'c', `L2 now starts at the arc, (0, -15) (got ${JSON.stringify(l2 && l2.joints.map(J))})`);
  assert.ok(heldOnArc(l1.joints[0], 'A') && heldOnArc(l2.joints[0], 'A'), 'each cut end is held on the arc');
  assert.ok(S().constraints.some((c) => c.type === 'horizontal' && c.joints.includes(l1.joints[0]) && c.joints.includes('b')), 'L1 keeps its orientation');
  assert.ok(shape('A') && S().constraints.some((c) => c.name === 'd1'), 'the arc and its radius stay');

  // A circle cuts a line: L (0, 0) -> (60, 0) through circle C (centre (30, 0), R 10): the middle goes, each piece ends on the circle
  await openDoc(docOf(
    [['a', { x: 0, y: 0 }], ['b', { x: 60, y: 0 }], ['cc', { x: 30, y: 0, fixed: true }]],
    [{ id: 'L', type: 'line', joints: ['a', 'b'] }, { id: 'C', type: 'circle', joints: ['cc'], radius: 10 }],
    [],
  ));
  app.tool('trim');
  clickW(30, 0);
  const pieces = S().shapes.filter((s) => s.type === 'line');
  assert.strictEqual(pieces.length, 2, 'the line is cut in two at the circle');
  const left = shape('L'), right = pieces.find((s) => s.id !== 'L');
  assert.ok(near(J(left.joints[1]), 20, 0) && near(J(right.joints[0]), 40, 0), 'the pieces end on the circle');
  assert.ok(S().constraints.some((c) => c.type === 'pointOnLine' && c.joint === left.joints[1] && c.shape === 'C')
    && S().constraints.some((c) => c.type === 'pointOnLine' && c.joint === right.joints[0] && c.shape === 'C'), 'each cut end is held on the circle');

  console.log('trim-curve-cutter-r201-1018-node: ok');
} finally {
  if (app) await app.close();
}
