// TASK 789b (owner ruling, turn 2465: "A distance of 0 between points on two different shapes is still allowed,, dont allow"): EVERY distance
// dimension refuses 0 and a negative value, not only a shape's size: between two shapes' points (aligned, horizontal, vertical), point-to-line,
// line-to-line, from every path (typed in the canvas box, a formula typed into it, a parameter whose change re-evaluates its formula), with the
// ONE rule (#core/dimension-seams.js sizeRefusal / SIZE_REFUSAL). Nothing changes on a refusal. Coincident points stay the Coincident constraint's
// job. An OFFSET (its own rule: any value but 0) and an ANGLE are not this rule. Node kit (SketchStudio, the real document load) + the box's and
// the Parameters table's own commit path (previewDimensionInput / planChange -> applyParameterChange).
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { previewDimensionInput, planChange } from '#core/parameters.js';
import { applyParameterChange, refusalReason } from '#core/dimension-seams.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const near = (a, b, msg, tol = 1e-3) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const MESSAGE = 'a length must be more than 0';

const docOf = (constraints, parameters = []) => ({
  version: 3, hosts: {},
  geometry: {
    // two separate lines: l1 a(0,0)-b(30,0) fixed, l2 p(40,10)-q(70,10) free (parallel to l1, 10 above)
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...[['a', 0, 0, true], ['b', 30, 0, true], ['p', 40, 10, false], ['q', 70, 10, false]]
      .map(([id, x, y, fixed]) => [id, { x, y, fixed, sketchId: 'sketch-1' }])],
    shapes: [{ id: 'l1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' }, { id: 'l2', type: 'line', joints: ['p', 'q'], sketchId: 'sketch-1' }],
    constraints: [{ type: 'horizontal', joints: ['p', 'q'] }, ...constraints], parameters,
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
    activeSketchId: 'sketch-1', groups: [], profiles: [],
  },
});
let app = null;
async function openDoc(doc) {
  if (app) { await app.close(); app = null; }
  const profile = await createProfile();
  await createNamedDesign(profile, 'sketchstudio', 'Distance 789b', doc);
  app = await open({ host: 'sketchstudio', profile });
}
const S = () => app.state;
const dim = (name) => S().constraints.find((c) => c.name === name);
const pos = () => JSON.stringify(['p', 'q'].map((id) => { const j = S().joints.get(id); return [+j.x.toFixed(6), +j.y.toFixed(6)]; }));
function typeInto(name, text) {
  const pv = previewDimensionInput(S(), dim(name), text, { unit: 'mm' });
  if (!pv.ok) return { ok: false, reason: pv.hint };
  const res = applyParameterChange(S(), pv.plan, 'edit');
  return res.ok ? res : { ok: false, reason: refusalReason(res) };
}
function setParameter(name, text) {
  const plan = planChange(S(), { type: 'setParameter', name, text }, { unit: 'mm' });
  if (!plan.ok) return { ok: false, reason: plan.message };
  const res = applyParameterChange(S(), plan, 'change parameter');
  return res.ok ? res : { ok: false, reason: refusalReason(res) };
}
// `res` is refused with THE message and nothing moved / changed
function refused(res, what, name, before) {
  ok(!res.ok && String(res.reason).includes(MESSAGE), `${what} is refused with "${MESSAGE}" (${JSON.stringify(res)})`);
  ok(pos() === before.pos, `${what}: nothing moved (${pos()} vs ${before.pos})`);
  ok(dim(name).value === before.value, `${what}: ${name} keeps its value (${dim(name).value})`);
}
const snap = (name) => ({ pos: pos(), value: dim(name).value });

try {
  // ---- between two shapes' points, every mode: typed 0, typed negative
  const modes = [
    ['aligned', { joints: ['b', 'p'] }, Math.hypot(10, 10)],
    ['horizontal', { joints: ['b', 'p'], dimMode: 'horizontal' }, 10],
    ['vertical', { joints: ['b', 'p'], dimMode: 'vertical' }, 10],
    ['point-to-line', { joints: ['p', 'a', 'b'] }, 10],
    ['line-to-line', { shapes: ['l1', 'l2'] }, 10],
  ];
  for (const [mode, fields, v] of modes) {
    await openDoc(docOf([{ type: 'distance', ...fields, value: v, offset: 8, name: 'd1' }]));
    const before = snap('d1');
    refused(typeInto('d1', '0'), `${mode}: typing 0`, 'd1', before);
    refused(typeInto('d1', '-5'), `${mode}: typing -5`, 'd1', before);
    const fine = typeInto('d1', String(v + 5));
    ok(fine.ok, `${mode}: a positive value is still taken (${JSON.stringify(fine)})`);
  }

  // ---- a formula typed into the box, and a parameter re-evaluating it (aligned between the two lines' points)
  await openDoc(docOf([{ type: 'distance', joints: ['b', 'p'], dimMode: 'horizontal', value: 10, offset: 8, name: 'd1', expression: 'W - 50 mm' }],
    [{ name: 'W', expression: '60 mm', unit: 'mm', comment: '' }]));
  const before = snap('d1');
  refused(typeInto('d1', 'W - 60 mm'), 'the formula W - 60 (= 0)', 'd1', before);
  refused(setParameter('W', '50 mm'), 'W = 50 (d1 = W - 50 = 0)', 'd1', before);
  refused(setParameter('W', '40 mm'), 'W = 40 (d1 = -10)', 'd1', before);
  ok(S().parameters.find((p) => p.name === 'W').expression === '60 mm' && dim('d1').expression === 'W - 50 mm', 'W and the formula are unchanged');
  ok(setParameter('W', '75 mm').ok, 'W = 75 (d1 = 25) is taken');
  near(S().joints.get('p').x - S().joints.get('b').x, 25, 'p follows');

  console.log(`PASS dimension-distance-789b: ${checks} checks`);
} finally {
  if (app) await app.close();
}
