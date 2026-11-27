// tests/fillet-gap-r105-1018-node.test.js -- TASK 1018, audit R1-05: Fillet takes two lines that do not meet (Fusion's Fillet extends them, unverified).
// Deleting a fillet's arc leaves its two lines cut back (a 5 x 5 gap at R 5) and the fillet's virtual sharp at the corner. Picking the two lines
// with Fillet refused ("Curves must meet at a corner to fillet"). It now fillets them across the gap, at the point where their extensions meet,
// keeping that virtual sharp (and the overall dimension on it) as the new fillet's.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { deleteShapes } from '#core/delete-manager.js';

const P = (x, y, o = {}) => ({ x, y, fixed: false, sketchId: 'sketch-1', ...o });
const doc = {
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['a', P(0, 0, { fixed: true })], ['k', P(0, -50)], ['b', P(60, -50, { fixed: true })]],
    shapes: [{ id: 'LV', type: 'line', joints: ['a', 'k'], sketchId: 'sketch-1' }, { id: 'LH', type: 'line', joints: ['k', 'b'], sketchId: 'sketch-1' }],
    constraints: [{ type: 'vertical', joints: ['a', 'k'] }, { type: 'horizontal', joints: ['k', 'b'] }, { type: 'distance', joints: ['a', 'k'], value: 50, name: 'd1', dimMode: 'vertical' }],
    parameters: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
};

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'R1-05 fillet gap', doc);
const app = await open({ host: 'sketchstudio', profile });
const S = () => app.state;
const J = (id) => S().joints.get(id);
const toasts = () => [...(app.document.getElementById('notification-container')?.children || [])].map((el) => el.textContent.trim());
const filletWith = (picks) => {
  app.tool('fillet');
  for (const [x, y] of picks) { const p = app.toScreen(x, y); app.click(p.x, p.y); }
  const box = app.document.getElementById('fillet-radius-input');
  if (!box) return false;
  box.focus(); box.value = ''; app.type('5'); app.enter();
  app.tool('select');
  return true;
};
const sharps = () => [...S().joints].filter(([, j]) => j.virtualSharp).map(([id]) => id);

try {
  assert.ok(filletWith([[0, -50]]), 'the corner fillets');
  const arc0 = S().shapes.find((s) => s.type === 'arc');
  const [v0] = sharps();
  assert.ok(arc0 && v0, 'a fillet arc and its virtual sharp');
  deleteShapes(S(), [arc0.id]);
  assert.ok(!S().shapes.some((s) => s.type === 'arc') && J(v0), 'the arc is gone; its virtual sharp stays (the dimension holds it)');
  const lvEnd = J(S().shapes.find((s) => s.id === 'LV').joints[1]);
  assert.ok(Math.abs(lvEnd.y + 45) < 1e-6, 'the lines stay cut back: a 5 mm gap');

  // R1-05: pick the two lines, R 5
  app.document.getElementById('notification-container').innerHTML = '';
  assert.ok(filletWith([[0, -30], [30, -50]]), `the radius box opens on the two lines across the gap (toasts: ${JSON.stringify(toasts())})`);
  const arc = S().shapes.find((s) => s.type === 'arc');
  assert.ok(arc, 'a new fillet arc');
  const lv = S().shapes.find((s) => s.id === 'LV'), lh = S().shapes.find((s) => s.id === 'LH');
  assert.ok(arc.joints.slice(1).includes(lv.joints[1]) && arc.joints.slice(1).includes(lh.joints[0]), 'both lines end on the arc');
  const c = J(arc.joints[0]);
  assert.ok(Math.abs(c.x - 5) < 1e-6 && Math.abs(c.y + 45) < 1e-6, `the arc is centred at (5, -45), tangent to both lines (got ${JSON.stringify(c)})`);
  assert.deepStrictEqual(sharps(), [v0], 'the corner keeps ONE virtual sharp: the deleted fillet\'s');
  assert.strictEqual(arc.filletSharp, v0, 'the new fillet uses it');
  assert.ok(S().constraints.some((k) => k.name === 'd1' && k.joints.includes(v0)), 'the overall dimension still measures to the sharp corner');
  const pol = S().constraints.filter((k) => k.type === 'pointOnLine' && k.joint === v0);
  assert.strictEqual(pol.length, 2, 'the sharp is held once on each line (not doubled)');
  console.log('fillet-gap-r105-1018-node: ok');
} finally {
  await app.close();
}
