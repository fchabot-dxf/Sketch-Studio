// tests/template-units-722-node.test.js -- TASK 722: templates speak the DOCUMENT's unit (owner turn 2002: "templates are still in mm even if I set my file as inches").
//   1. defaults: an inch document rounds each mm default to the nearest 1/16 in (38 mm -> 1.5 in, 600 -> 23.625 in), a cm one to 0.1 cm, mm is as
//      authored; counts, angles and choices never change; paramUnit says the document's unit for a length
//   2. the user parameters a template creates: the document's unit and expression ("board = 1.5 in"), the same parameters in the same order as mm
//   3. the geometry equals the template built from those (rounded) values in mm: every template, every point, 0 DOF after loading
//   4. a mm document is unchanged: buildTemplate(t) equals buildTemplate(t, {}, 'mm') (ids aside) and the mm texts of the refusals are as before
//   5. typed text: parseParam takes the document unit, "1/8 in", 3 inch marks, 38mm, an expression; NaN for the rest
//   6. the refusals (703) speak the document unit ("use less than 7.87 in"), and the number said works
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { TEMPLATES, TemplateRefusal, buildTemplate, defaultParams, paramUnit, paramKind, parseParam, templateById, toMm } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ids = (doc) => JSON.stringify(doc).replace(/\d+_\d{13}/g, 'T').replace(/\d{13}/g, 'T').replace(/T_\d+/g, 'T'); // the ids carry a counter and a timestamp

// ---- 1. defaults
for (const [id, want] of [['right-angle-brace', { width: 11.8125, height: 23.625, thickV: 1.5 }], ['slot', { length: 1.5625, width: 0.375 }]]) {
  const d = defaultParams(templateById(id), 'in');
  for (const [k, v] of Object.entries(want)) eq(d[k], v, `${id}.${k} in an inch document`);
}
for (const t of TEMPLATES) {
  const mm = defaultParams(t), inch = defaultParams(t, 'in'), cm = defaultParams(t, 'cm');
  eq(defaultParams(t, 'mm'), mm, `${t.id}: mm defaults as authored`);
  for (const [k, spec] of Object.entries(t.params)) {
    if (paramKind(spec) !== 'length') { eq([inch[k], cm[k]], [mm[k], mm[k]], `${t.id}.${k}: a ${paramKind(spec)} does not change`); continue; }
    const si = spec.docStep ? spec.docStep.in : 1 / 16, sc = spec.docStep ? spec.docStep.cm : 0.1; // TASK 840: a spec's own steps (docStep), else 1/16 in and 0.1 cm
    ok(Math.abs(inch[k] / si - Math.round(inch[k] / si)) < 1e-6 && inch[k] > 0, `${t.id}.${k}: ${inch[k]} in is a multiple of ${si}`);
    ok(Math.abs(inch[k] - mm[k] / 25.4) <= si / 2 + 1e-9 || inch[k] === si, `${t.id}.${k}: ${inch[k]} in is the nearest ${si} in of ${mm[k]} mm`);
    ok(Math.abs(cm[k] / sc - Math.round(cm[k] / sc)) < 1e-6 && (Math.abs(cm[k] - mm[k] / 10) <= sc / 2 + 1e-9 || cm[k] === sc), `${t.id}.${k}: ${cm[k]} cm is the nearest ${sc} cm of ${mm[k]} mm`);
  }
}
{ // TASK 840: the spur gear's backlash allowance declares finer steps (0.1 mm -> 0.004 in, 0.01 cm), its module rounds as every length (3 mm -> 1/8 in)
  const g = defaultParams(templateById('spur-gear'), 'in'), c = defaultParams(templateById('spur-gear'), 'cm');
  eq([g.backlash, g.module, g.bore, c.backlash, c.module], [0.004, 0.125, 0.375, 0.01, 0.3], 'spur-gear defaults in an inch and a cm document');
}
eq([paramUnit({ label: 'a' }, 'in'), paramUnit({ label: 'a', kind: 'angle' }, 'in'), paramUnit({ label: 'a', kind: 'count' }, 'in'), paramUnit({ label: 'a' })], ['in', 'deg', '', 'mm'], 'paramUnit');

// ---- 2 + 3. parameters and geometry, every template, inch and cm
const solved = (doc) => {
  const S = L.newSketch();
  assert.ok(muted(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state)).ok);
  muted(() => S.engine.solve(L.ITER));
  return S;
};
const points = (S) => [...S.state.joints.values()].map((j) => [Math.round(j.x * 1e6) / 1e6 + 0, Math.round(j.y * 1e6) / 1e6 + 0]);
for (const unit of ['in', 'cm']) for (const t of TEMPLATES) {
  const own = defaultParams(t, unit), docU = buildTemplate(t, {}, unit), docMm = buildTemplate(t, toMm(t, own, unit));
  const live = docU.geometry.parameters, liveMm = docMm.geometry.parameters;
  eq(live.map((p) => p.name), liveMm.map((p) => p.name), `${t.id} ${unit}: the same parameters`);
  for (const p of live) {
    const key = Object.keys(t.params).find((k) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()) === p.name), spec = t.params[key];
    const u = paramKind(spec) === 'angle' ? 'deg' : unit;
    eq([p.unit, p.expression], [u, `${own[key]} ${u}`], `${t.id} ${unit}: ${p.name}`);
  }
  const A = solved(docU), B = solved(docMm);
  eq(points(A), points(B), `${t.id} ${unit}: the geometry is the template built from the ${unit} values`);
  eq(L.nullity(A), 0, `${t.id} ${unit}: 0 DOF`);
}

// ---- 4. a mm document is as before
for (const t of TEMPLATES) eq(ids(buildTemplate(t)), ids(buildTemplate(t, {}, 'mm')), `${t.id}: mm build unchanged`);
eq(buildTemplate(templateById('slot'), {}).geometry.parameters.map((p) => p.expression), ['40 mm', '10 mm'], 'mm parameters: "40 mm", "10 mm"');

// ---- 5. typed text
const len = { label: 'x' };
eq([parseParam(len, '1/8 in', 'in'), parseParam(len, '3"', 'in'), parseParam(len, '38mm', 'in'), parseParam(len, '2', 'in'), parseParam(len, '1.5 in * 2', 'mm')], [0.125, 3, 1.496063, 2, 76.2], 'a length: the document unit, or any unit the parser accepts');
eq([parseParam(len, '2.5 cm', 'cm'), parseParam(len, '25 mm', 'cm'), parseParam(len, '3', 'cm')], [2.5, 2.5, 3], 'cm');
ok([parseParam(len, '', 'in'), parseParam(len, 'abc', 'in'), parseParam(len, '5 deg', 'in'), parseParam(len, '1/', 'in')].every(Number.isNaN), 'empty, wrong or the wrong kind: NaN');
eq([parseParam({ label: 'a', kind: 'angle' }, '60', 'in'), parseParam({ label: 'a', kind: 'angle' }, '45°', 'in'), parseParam({ label: 'c', kind: 'count' }, '6', 'in')], [60, 45, 6], 'an angle in deg, a count as typed');

// ---- 6. refusals in the document unit
const refusal = (id, values, unit) => { try { muted(() => buildTemplate(templateById(id), values, unit)); } catch (e) { return e; } return null; };
{
  const e = refusal('slot', { length: 1, width: 1 }, 'in');
  ok(e instanceof TemplateRefusal && e.param === 'width', 'a TemplateRefusal for the width');
  eq(e.message, 'Width is too big for this length: use less than 1 in.', 'slot, in');
  eq(refusal('slot', { length: 1, width: 0.99 }, 'in'), null, 'the number said works');
  eq(refusal('slot', { length: 30, width: 40 }, 'cm').message, 'Width is too big for this length: use less than 30 cm.', 'slot, cm');
  eq(refusal('slot', { length: 40, width: 40 }).message, 'Width is too big for this length: use less than 40 mm.', 'slot, mm as before');
  eq(refusal('box-frame', { thickness: 300 }, 'mm').message, 'Plywood thickness is too big for this width: use less than 200 mm.', 'box frame, mm as before');
  eq(refusal('box-frame', { thickness: 12 }, 'in').message, 'Plywood thickness is too big for this width: use less than 7.87 in.', 'box frame, in (width 400 mm = 15.75 in, half 7.87)');
}
console.log(`template-units-722-node: ${checks} checks passed`);
