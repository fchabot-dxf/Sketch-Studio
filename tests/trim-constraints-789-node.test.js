// TASK 789 bug 5 (hunt 784 #5, its probe-23 T1): Trim keeps the constraints of the part of the line that stays and never leaves one on a deleted
// point. The trimmed line's orientation (horizontal / vertical on its end pair) holds every kept piece; an end the line no longer reaches and no
// other curve uses goes through THE delete rule (#core/delete-manager.js removeGeometry), with every constraint and dimension naming it (the
// length dimension that measured the removed part); a dimension between points that stay is kept. Before: the end stayed as a ghost point holding
// the old horizontal + distance, and the trimmed line could be dragged off horizontal. Node kit (SketchStudio, the real Trim tool click + drag).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-3) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

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
  await createNamedDesign(profile, 'sketchstudio', 'Trim 789', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const J = (id) => S().joints.get(id);
const shape = (id) => S().shapes.find((s) => s.id === id);
const named = (c) => [...(Array.isArray(c.joints) ? c.joints : []), ...(c.joint ? [c.joint] : [])];
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const has = (type, joints) => S().constraints.some((c) => c.type === type && Array.isArray(c.joints) && sameSet(c.joints, joints));
function noGhosts(what) {
  const ghosts = S().constraints.filter((c) => named(c).some((id) => !S().joints.has(id)));
  ok(!ghosts.length, `${what}: no constraint names a deleted point (${JSON.stringify(ghosts)})`);
  const used = new Set([...S().shapes.flatMap((s) => s.joints || []), ...S().constraints.flatMap(named), 'j_origin']);
  const loose = [...S().joints.keys()].filter((id) => !used.has(id));
  ok(!loose.length, `${what}: no loose point left (${loose})`);
}
const trimAt = (x, y) => { app.tool('trim'); const p = app.toScreen(x, y); app.click(p.x, p.y); app.esc(); };
const dragPoint = (from, to) => { app.esc(); app.drag(app.toScreen(from.x, from.y), app.toScreen(to.x, to.y), 10); };

try {
  // ---- probe-23 T1: a horizontal line a-b, 60 long (d1), with a point p on it 15 from a (d2); a fixed line crosses it at x = 30; trim the right part
  await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 60, y: 0 }], ['p', { x: 15, y: 0 }], ['x1', { x: 30, y: -20, fixed: true }], ['x2', { x: 30, y: 20, fixed: true }]],
    [{ id: 'l1', type: 'line', joints: ['a', 'b'] }, { id: 'cut', type: 'line', joints: ['x1', 'x2'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 60, offset: -20, name: 'd1' },
      { type: 'pointOnLine', joint: 'p', shape: 'l1' }, { type: 'distance', joints: ['a', 'p'], value: 15, offset: 10, name: 'd2' }]));
  trimAt(45, 0);
  const m = shape('l1').joints[1];
  ok(shape('l1').joints[0] === 'a' && m !== 'b', `the line is a -> the new end (${shape('l1').joints})`);
  near(J(m).x, 30, 'the new end is on the cutting line');
  ok(!J('b'), 'the removed end b is gone');
  ok(has('horizontal', ['a', m]), `the trimmed line stays horizontal (${JSON.stringify(S().constraints.map((c) => c.type + ':' + named(c)))})`);
  ok(!S().constraints.some((c) => c.name === 'd1'), 'd1 (it measured the removed part) is gone');
  ok(S().constraints.some((c) => c.name === 'd2' && sameSet(c.joints, ['a', 'p'])), 'd2 (on the kept part) is kept');
  ok(S().constraints.some((c) => c.type === 'pointOnLine' && c.joint === 'p' && c.shape === 'l1'), 'p stays on the line');
  noGhosts('T1');
  dragPoint(J(m), { x: 30, y: 25 });
  near(J(m).y, 0, 'dragging the new end up: the line stays horizontal');
  near(J('p').x, 15, 'd2 still holds');
  app.undo(); app.undo();
  ok(!!J('b') && shape('l1').joints[1] === 'b' && S().constraints.some((c) => c.name === 'd1') && has('horizontal', ['a', 'b']), 'Ctrl+Z (twice: the drag, the trim) puts the line, b, d1 and its horizontal back');

  // ---- the middle of a horizontal line between two cutting lines: BOTH pieces stay horizontal
  await openDoc(docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 90, y: 0 }], ['x1', { x: 30, y: -20, fixed: true }], ['x2', { x: 30, y: 20, fixed: true }],
      ['y1', { x: 60, y: -20, fixed: true }], ['y2', { x: 60, y: 20, fixed: true }]],
    [{ id: 'l1', type: 'line', joints: ['a', 'b'] }, { id: 'c1', type: 'line', joints: ['x1', 'x2'] }, { id: 'c2', type: 'line', joints: ['y1', 'y2'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }]));
  trimAt(45, 0);
  const right = S().shapes.find((s) => s.type === 'line' && s.joints[1] === 'b');
  const left = shape('l1');
  ok(right && right.id !== 'l1' && left.joints[0] === 'a', `two pieces (${S().shapes.map((s) => s.id + ':' + s.joints)})`);
  ok(has('horizontal', left.joints) && has('horizontal', right.joints), `both pieces are horizontal (${JSON.stringify(S().constraints.map((c) => c.type + ':' + named(c)))})`);
  noGhosts('middle');
  dragPoint(J(right.joints[0]), { x: 60, y: 25 });
  near(J(right.joints[0]).y, J('b').y, 'dragging the right piece\'s new end: it stays horizontal');

  // ---- a rectangle's bottom edge (its corners shared with the sides): trim its right part; the corner stays (the right side uses it)
  await openDoc(docOf(
    [['p1', { x: 0, y: 0, fixed: true }], ['p2', { x: 60, y: 0 }], ['p3', { x: 60, y: 40 }], ['p4', { x: 0, y: 40 }], ['x1', { x: 30, y: -10, fixed: true }], ['x2', { x: 30, y: 10, fixed: true }]],
    [{ id: 'bottom', type: 'line', joints: ['p1', 'p2'] }, { id: 'right', type: 'line', joints: ['p2', 'p3'] }, { id: 'top', type: 'line', joints: ['p3', 'p4'] },
      { id: 'left', type: 'line', joints: ['p4', 'p1'] }, { id: 'cut', type: 'line', joints: ['x1', 'x2'] }],
    [{ type: 'horizontal', joints: ['p1', 'p2'] }, { type: 'horizontal', joints: ['p3', 'p4'] }, { type: 'vertical', joints: ['p2', 'p3'] }, { type: 'vertical', joints: ['p4', 'p1'] },
      { type: 'distance', joints: ['p1', 'p2'], value: 60, offset: -15, name: 'd1' }]));
  trimAt(45, 0);
  const mb = shape('bottom').joints[1];
  ok(shape('bottom').joints[0] === 'p1' && mb !== 'p2' && !!J('p2'), `bottom = p1 -> the new end, the corner p2 stays (${shape('bottom').joints})`);
  ok(has('horizontal', ['p1', mb]), 'the trimmed bottom stays horizontal');
  ok(!S().constraints.some((c) => c.name === 'd1'), 'UX-11: d1 across the trimmed span is deleted even though corners p1/p2 stay');
  noGhosts('rectangle');
  dragPoint(J(mb), { x: 30, y: 20 });
  near(J(mb).y, J('p1').y, 'dragging the trimmed bottom\'s new end: it stays horizontal');

  console.log(`PASS trim-constraints-789: ${checks} checks`);
} finally {
  if (app) await app.close();
}
