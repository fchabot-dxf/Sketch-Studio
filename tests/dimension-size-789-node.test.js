// TASK 789 bug 2 (hunt 784 #2): a dimension that is a shape's SIZE (a radius / diameter, a line's own length) never takes a value of 0 or less,
// from ANY path: typed in the canvas box, a formula (fx) typed into it, or a parameter whose change re-evaluates its formula. The ONE size rule of
// the drawing tools' boxes (task 782, #core/dimension-seams.js sizeRefusal) refuses it with the same message; nothing changes (values, formulas,
// parameters, geometry, the undo history). A distance between points of two different shapes is no size: 0 still makes them meet, as in Fusion.
// Bug 3 (a saved collapsed dimension is repaired): dimension-collapsed-789-node.test.js. Node kit (SketchStudio, the real document load) + the
// box's and the Parameters table's own commit path (previewDimensionInput / planChange -> applyParameterChange).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { previewDimensionInput, planChange } from '#core/parameters.js';
import * as seams from '#core/dimension-seams.js';
const { applyParameterChange, refusalReason } = seams;
const SIZE_MESSAGE = 'a size must be more than 0'; // the drawing tools' box hint (task 782) 'A size must be more than 0.'

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-3) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const docOf = (joints, shapes, constraints, parameters = []) => ({
  version: 3, hosts: {},
  geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...joints.map(([id, j]) => [id, { fixed: false, sketchId: 'sketch-1', ...j }])],
    shapes: shapes.map((s) => ({ sketchId: 'sketch-1', ...s })),
    constraints, parameters,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});
let app = null;
async function openDoc(doc) {
  if (app) { await app.close(); app = null; }
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Size 789', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const J = (id) => S().joints.get(id);
const dim = (name) => S().constraints.find((c) => c.name === name);
const param = (name) => S().parameters.find((p) => p.name === name);
const lenOf = (a, b) => Math.hypot(J(b).x - J(a).x, J(b).y - J(a).y);
// the canvas box: type `text` into dimension `name` (previewDimensionInput -> applyParameterChange, as numeric-input-manager handleCommit does)
function typeInto(name, text) {
  const pv = previewDimensionInput(S(), dim(name), text, { unit: 'mm' });
  if (!pv.ok) return { ok: false, reason: pv.hint };
  const res = applyParameterChange(S(), pv.plan, 'edit');
  return res.ok ? res : { ok: false, reason: refusalReason(res) };
}
// the Parameters table: the Expression cell of a user parameter (planChange setParameter -> applyParameterChange)
function setParameter(name, text) {
  const plan = planChange(S(), { type: 'setParameter', name, text }, { unit: 'mm' });
  if (!plan.ok) return { ok: false, reason: plan.message };
  const res = applyParameterChange(S(), plan, 'change parameter');
  return res.ok ? res : { ok: false, reason: refusalReason(res) };
}
const refusedWithSize = (res, what) => ok(!res.ok && String(res.reason).includes(SIZE_MESSAGE), `${what} is refused with the size message (${JSON.stringify(res)})`);

try {
  // ---- bug 2: a circle radius (d2 = W - 50, W = 80 -> 30)
  const circleDoc = () => docOf([['c1', { x: 0, y: 0, fixed: true }]], [{ id: 'cir1', type: 'circle', joints: ['c1'], radius: 30 }],
    [{ type: 'distance', shape: 'cir1', value: 30, isRadius: true, name: 'd1', expression: 'W - 50 mm' }],
    [{ name: 'W', expression: '80 mm', unit: 'mm', comment: '' }]);
  await openDoc(circleDoc());
  const circle = () => S().shapes.find((s) => s.id === 'cir1');
  const hist0 = S().history.length;
  // a parameter change whose formula re-evaluates to -10 / 0
  refusedWithSize(setParameter('W', '40 mm'), 'W = 40 (d1 = W - 50 = -10)');
  refusedWithSize(setParameter('W', '50 mm'), 'W = 50 (d1 = 0)');
  near(circle().radius, 30, 'the circle keeps its radius');
  near(dim('d1').value, 30, 'd1 keeps its value');
  ok(dim('d1').expression === 'W - 50 mm', `d1 keeps its formula (${dim('d1').expression})`);
  ok(param('W').expression === '80 mm', `W keeps its expression (${param('W').expression})`);
  ok(S().history.length === hist0, `a refused change leaves no undo step (${S().history.length} vs ${hist0})`);
  // typed on the canvas: a number, and a formula
  refusedWithSize(typeInto('d1', '-10'), 'typing -10');
  refusedWithSize(typeInto('d1', '0'), 'typing 0');
  refusedWithSize(typeInto('d1', 'W - 90 mm'), 'typing the formula W - 90');
  near(circle().radius, 30, 'still radius 30');
  near(dim('d1').value, 30, 'still d1 = 30');
  // a valid value still goes through every path
  ok(setParameter('W', '70 mm').ok, 'W = 70 (d1 = 20) is taken');
  near(circle().radius, 20, 'the circle follows W');
  ok(typeInto('d1', '12').ok, 'typing 12 is taken');
  near(circle().radius, 12, 'the circle takes 12');

  // ---- a distance between points of two DIFFERENT lines is no size: 0 still makes the points meet (Fusion, the recorded oracle tests/fusion-dim-edit.test.js)
  await openDoc(docOf([['a', { x: 0, y: 0, fixed: true }], ['b', { x: 30, y: 0, fixed: true }], ['p', { x: 40, y: 10 }], ['q', { x: 60, y: 30 }]],
    [{ id: 'l1', type: 'line', joints: ['a', 'b'] }, { id: 'l2', type: 'line', joints: ['p', 'q'] }],
    [{ type: 'distance', joints: ['b', 'p'], value: Math.hypot(10, 10), name: 'd1' }]));
  const meet = typeInto('d1', '0');
  ok(meet.ok, `a 0 distance between two lines' ends is taken (${JSON.stringify(meet)})`);
  near(Math.hypot(J('p').x - J('b').x, J('p').y - J('b').y), 0, 'the points meet');

  // the ONE rule and message: the seam's and the drawing tools' box hint
  ok(seams.SIZE_REFUSAL === SIZE_MESSAGE, `the seam exports the one size message (${seams.SIZE_REFUSAL})`);
  const { SIZE_REFUSAL_HINT } = await import('#ui/numeric-input-manager.js');
  ok(SIZE_REFUSAL_HINT === 'A size must be more than 0.', `the box hint is the same message (${SIZE_REFUSAL_HINT})`);

  console.log(`PASS dimension-size-789: ${checks} checks`);
} finally {
  if (app) await app.close();
}
