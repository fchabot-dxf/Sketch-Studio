// TASK 789 bug 3 (hunt 784 #3): a line length = 0 through a formula collapsed the line, and restoring the parameter was refused for ever
// ('is already determined by the other constraints': a distance between two joints ON each other had a zero solver row, definitions.js). Now the 0
// is refused (bug 2's size rule, dimension-size-789-node.test.js), and a sketch SAVED with a collapsed (0) line length before that rule is
// repaired by setting a valid value (the Parameters table or the canvas box). Node kit (SketchStudio, the real document load) + the box's and the
// Parameters table's own commit path (previewDimensionInput / planChange -> applyParameterChange).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { previewDimensionInput, planChange } from '#core/parameters.js';
import * as seams from '#core/dimension-seams.js';
const { applyParameterChange, refusalReason } = seams;
const SIZE_MESSAGE = 'a length must be more than 0'; // the one length rule (task 789b), also the drawing tools' box hint (task 782) 'A length must be more than 0.'

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
  await createNamedDesign(profile, 'sketchstudio', 'Collapsed 789', doc);
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
  // ---- bug 3: a line length through a formula (d2 = W - 50, W = 80 -> 30), perpendicular to a horizontal 50 mm line
  const lineDoc = (bc, d2) => docOf(
    [['a', { x: 0, y: 0, fixed: true }], ['b', { x: 50, y: 0 }], ['c', { x: 50, y: bc }]],
    [{ id: 'l1', type: 'line', joints: ['a', 'b'] }, { id: 'l2', type: 'line', joints: ['b', 'c'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'perpendicular', shapes: ['l1', 'l2'] },
      { type: 'distance', joints: ['a', 'b'], value: 50, offset: -20, name: 'd1' },
      { type: 'distance', joints: ['b', 'c'], value: d2, expression: 'W - 50 mm', offset: 20, name: 'd2' }],
    [{ name: 'W', expression: `${50 + d2} mm`, unit: 'mm', comment: '' }]);
  // a sketch SAVED with the line collapsed (d2 = 0, c on b) before the rule: setting a valid value repairs it
  await openDoc(lineDoc(0, 0));
  near(lenOf('b', 'c'), 0, 'the saved line is collapsed');
  const fix = setParameter('W', '80 mm');
  ok(fix.ok, `W = 80 repairs the collapsed line (${JSON.stringify(fix)})`);
  near(dim('d2').value, 30, 'd2 = 30');
  near(lenOf('b', 'c'), 30, 'the line is 30 long again');
  near(lenOf('a', 'b'), 50, 'd1 still holds');
  near(J('c').x - J('b').x, 0, 'and it is perpendicular again', 1e-3);
  // the canvas box repairs it too
  await openDoc(lineDoc(0, 0));
  const fix2 = typeInto('d2', '25');
  ok(fix2.ok, `typing 25 into the collapsed d2 repairs it (${JSON.stringify(fix2)})`);
  near(lenOf('b', 'c'), 25, 'the line is 25 long');

  // the 0 itself is refused now (bug 2's rule): the line keeps its length and a valid W still drives it
  await openDoc(lineDoc(30, 30));
  refusedWithSize(setParameter('W', '50 mm'), 'W = 50 (the line d2 = 0)');
  near(lenOf('b', 'c'), 30, 'the line keeps its length');
  ok(setParameter('W', '90 mm').ok, 'W = 90 afterwards is taken');
  near(lenOf('b', 'c'), 40, 'the line follows (40)');

  console.log(`PASS dimension-collapsed-789: ${checks} checks`);
} finally {
  if (app) await app.close();
}
