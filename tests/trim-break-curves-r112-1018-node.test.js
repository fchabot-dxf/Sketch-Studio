// tests/trim-break-curves-r112-1018-node.test.js -- TASK 1018, audit R1-12 (+ owner ruling): Trim cuts circles and arcs, Break splits them, like Fusion.
//  1. A circle trimmed between two cutters (a keyway's walls) becomes an ARC: the same shape, its ends on the walls, its diameter dimension kept as a diameter
//     (Fusion keeps the dimension on the arc, unverified); the hover shows the piece first; Undo brings the circle back.
//  2. An arc trimmed becomes a shorter arc: the cut end held on the cutter, its own structural equal on its new rims.
//  3. Break on an arc splits it into two arcs round the same centre (sharing the split point); Break on a circle splits it between the two points
//     around the click; a circle with nothing on it refuses with a notice (nothing written, the tool stays: owner rule turn 3741).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { unsatisfiedConstraints } from '#core/constraint-verifier.js';

const RIM_Y = -Math.sqrt(100 - 9);
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
  await createNamedDesign(profile, 'sketchstudio', 'R1-12 curves', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const J = (id) => S().joints.get(id);
const shape = (id) => S().shapes.find((s) => s.id === id);
const near = (p, x, y, tol = 1e-3) => p && Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol;
const toasts = () => [...(app.document.getElementById('notification-container')?.children || [])].map((el) => el.textContent.trim());
const clickW = (x, y) => { const p = app.toScreen(x, y); app.click(p.x, p.y); };
const ownEqual = (arc) => S().constraints.some((c) => c.type === 'equal' && Array.isArray(c.joints) && c.joints.join() === [arc.joints[0], arc.joints[1], arc.joints[0], arc.joints[2]].join());
const heldOn = (jid, sid) => S().constraints.some((c) => (c.type === 'pointOnLine' && c.joint === jid && c.shape === sid)
  || (c.type === 'coincident' && c.joints.includes(jid) && S().shapes.find((s) => s.id === sid)?.joints.some((j) => c.joints.includes(j))));

try {
  // 1. Keyway: circle C1 (Ø20 at the origin, dimensioned) cut open between its two walls
  await openDoc(docOf(
    [['cc', { x: 0, y: 0, fixed: true }], ['w1a', { x: -3, y: RIM_Y }], ['w1b', { x: -3, y: -13 }], ['w2a', { x: 3, y: RIM_Y }], ['w2b', { x: 3, y: -13 }]],
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 10 },
      { id: 'W1', type: 'line', joints: ['w1a', 'w1b'] }, { id: 'W2', type: 'line', joints: ['w2a', 'w2b'] }, { id: 'R', type: 'line', joints: ['w1b', 'w2b'] }],
    [{ type: 'distance', shape: 'C1', isRadius: true, isDiameter: true, value: 20, name: 'd1' },
      { type: 'pointOnLine', joint: 'w1a', shape: 'C1' }, { type: 'pointOnLine', joint: 'w2a', shape: 'C1' }],
  ));
  app.tool('trim');
  const pTop = app.toScreen(0, -10);
  app.move(pTop.x, pTop.y);
  const overlay = app.document.getElementById('trim-tool-overlay');
  assert.ok(overlay && /<path/.test(overlay.innerHTML), `Trim hover shows the circle's piece between the walls (got ${overlay ? overlay.innerHTML.trim().slice(0, 60) : 'no overlay'})`);
  const h0 = S().history.length;
  app.click(pTop.x, pTop.y);
  const c1 = shape('C1');
  assert.strictEqual(c1.type, 'arc', 'the trimmed circle is now an arc (the same shape, C1)');
  assert.strictEqual(c1.radius, undefined, 'the arc stores no radius scalar');
  const [, s1, e1] = c1.joints;
  assert.ok(near(J(s1), 3, RIM_Y) && near(J(e1), -3, RIM_Y), `the arc runs from the right wall round to the left wall (got ${JSON.stringify([J(s1), J(e1)])})`);
  assert.ok(heldOn(s1, 'W2') && heldOn(e1, 'W1'), 'each cut end is held on its wall');
  assert.ok(ownEqual(c1), 'the arc has its structural equal on its two rims');
  const dim = S().constraints.find((c) => c.name === 'd1');
  assert.ok(dim && dim.isDiameter && dim.shape === 'C1' && dim.value === 20, 'the diameter dimension stays on the arc, as a diameter');
  assert.strictEqual(S().currentTool, 'trim', 'Trim stays active after the trim');
  assert.strictEqual(S().history.length, h0 + 1, 'one undo step');
  S().engine.solve(200);
  assert.deepStrictEqual(unsatisfiedConstraints(S().constraints, S().joints, S().shapes).map((c) => c.type), [], 'every constraint holds after the trim');
  app.undo();
  assert.ok(shape('C1').type === 'circle' && shape('C1').radius === 10, 'Undo brings the circle back');

  // 2. An arc (centre (50, 0), R 20, half a turn from (70, 0) through (50, 20) to (30, 0)) cut by a vertical line at x = 50: the far half goes
  await openDoc(docOf(
    [['ac', { x: 50, y: 0, fixed: true }], ['as', { x: 70, y: 0 }], ['ae', { x: 30, y: 0 }], ['la', { x: 50, y: -5, fixed: true }], ['lb', { x: 50, y: 30, fixed: true }]],
    [{ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], sweep: true }, { id: 'L', type: 'line', joints: ['la', 'lb'] }],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }, { type: 'distance', shape: 'A1', isRadius: true, value: 20, name: 'd1' }],
  ));
  app.tool('trim');
  clickW(50 - 20 * Math.cos(Math.PI / 4), 20 * Math.sin(Math.PI / 4));
  const a1 = shape('A1');
  assert.ok(a1 && a1.type === 'arc' && a1.joints[1] === 'as', 'the arc keeps its start');
  assert.ok(near(J(a1.joints[2]), 50, 20), `the arc now ends on the cutter at (50, 20) (got ${JSON.stringify(J(a1.joints[2]))})`);
  assert.ok(!J('ae'), 'the removed end is gone');
  assert.ok(heldOn(a1.joints[2], 'L'), 'the cut end is held on the cutter');
  assert.ok(ownEqual(a1) && !S().constraints.some((c) => c.type === 'equal' && c.joints && c.joints.includes('ae')), 'the structural equal moved to the new rims');
  assert.ok(S().constraints.some((c) => c.name === 'd1'), 'the radius dimension stays');

  // 3a. Break on an arc: two arcs round the same centre, sharing the split point
  await openDoc(docOf(
    [['ac', { x: 50, y: 0, fixed: true }], ['as', { x: 70, y: 0 }], ['ae', { x: 30, y: 0 }]],
    [{ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], sweep: true }],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }],
  ));
  app.tool('break');
  clickW(50 + 20 * Math.cos(Math.PI / 4), 20 * Math.sin(Math.PI / 4));
  const arcs = S().shapes.filter((s) => s.type === 'arc');
  assert.strictEqual(arcs.length, 2, 'Break splits the arc into two arcs');
  const [b1, b2] = [shape('A1'), arcs.find((s) => s.id !== 'A1')];
  assert.ok(b1.joints[0] === 'ac' && b2.joints[0] === 'ac', 'both arcs share the centre');
  assert.ok(b1.joints[2] === b2.joints[1], 'they share the split point');
  const mid = J(b1.joints[2]);
  assert.ok(Math.abs(Math.hypot(mid.x - 50, mid.y) - 20) < 1e-9 && near(mid, 50 + 20 * Math.SQRT1_2, 20 * Math.SQRT1_2, 0.5), `the split point is on the arc where clicked (got ${JSON.stringify(mid)})`);
  assert.ok(b1.sweep === true && b2.sweep === true && ownEqual(b1) && ownEqual(b2), 'each arc keeps the turning sense and has its own structural equal');
  assert.strictEqual(S().currentTool, 'break', 'Break stays active');

  // 3b. Break on a circle crossed by two lines: two arcs, split at the crossings around the click; 3c. nothing on a circle: a notice
  await openDoc(docOf(
    [['cc', { x: 0, y: 0, fixed: true }], ['p1', { x: -3, y: -20, fixed: true }], ['p2', { x: -3, y: 0, fixed: true }], ['q1', { x: 3, y: -20, fixed: true }], ['q2', { x: 3, y: 0, fixed: true }], ['dc', { x: 80, y: 0, fixed: true }]],
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 10 }, { id: 'P', type: 'line', joints: ['p1', 'p2'] }, { id: 'Q', type: 'line', joints: ['q1', 'q2'] },
      { id: 'C2', type: 'circle', joints: ['dc'], radius: 10 }],
    [{ type: 'distance', shape: 'C1', isRadius: true, isDiameter: true, value: 20, name: 'd1' }],
  ));
  app.tool('break');
  clickW(0, -10);
  const c1b = shape('C1'), piece = S().shapes.find((s) => s.type === 'arc' && s.id !== 'C1');
  assert.ok(c1b.type === 'arc' && piece, 'Break splits the circle into two arcs');
  assert.ok(near(J(piece.joints[1]), -3, RIM_Y) && near(J(piece.joints[2]), 3, RIM_Y), `the clicked part runs between the two crossings (got ${JSON.stringify(piece.joints.slice(1).map(J))})`);
  assert.ok(c1b.joints[1] === piece.joints[2] && c1b.joints[2] === piece.joints[1] && c1b.joints[0] === piece.joints[0], 'the two arcs share the centre and both split points');
  assert.ok(heldOn(piece.joints[1], 'P') && heldOn(piece.joints[2], 'Q'), 'the split points are held on the crossing lines');
  assert.ok(S().constraints.some((c) => c.name === 'd1' && c.shape === 'C1'), 'the diameter dimension stays on the circle turned arc');
  app.document.getElementById('notification-container').innerHTML = '';
  const n0 = S().shapes.length, hb = S().history.length;
  clickW(90, 0);
  assert.ok(toasts().some((m) => /Break: a circle splits between two points on it/.test(m)), `a lone circle refuses with the reason (got ${JSON.stringify(toasts())})`);
  assert.ok(shape('C2').type === 'circle' && S().shapes.length === n0 && S().history.length === hb, 'nothing written, no undo step');
  assert.strictEqual(S().currentTool, 'break', 'Break stays active after the refusal');

  console.log('trim-break-curves-r112-1018-node: ok');
} finally {
  if (app) await app.close();
}
