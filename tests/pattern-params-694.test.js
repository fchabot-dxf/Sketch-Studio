// tests/pattern-params-694.test.js - TASK 694: a sketch PATTERN's values are named document parameters, like Fusion (advisor, Fusion API: a
// rectangular pattern makes quantityOne d1, quantityTwo d2, distanceOne d3, distanceTwo d4; a circular one quantity and totalAngle). On the real
// sketch state and the tools' own operations (#core/tool-ops.js), the Parameters table's pure planning / commit (#ui/parameter-table.js):
//   A names: a new pattern's values take the next d<n> in Fusion's order; a later dimension takes the one after.
//   B the Parameters table: one row per value (kind Count / Length / Angle, unit none / mm / deg).
//   C rename (the Name cell, `name = value` in its box), another dimension reads the name, changing it in the table moves the pattern AND the
//     dependent dimension: one undo step each, Undo puts names / formulas / values / geometry back.
//   D a user parameter drives a quantity (whole number; 2.5 refused with THE pattern rule's message, the table keeps the old value, no undo step;
//     float noise 0.7 * 10 = 7); a user angle parameter -90 deg drives a circular pattern clockwise (task 691), 0 refused.
//   E 0 DOF unchanged (the values are record values, never unknowns); save / load keeps names and formulas; paste names the copy afresh.
//   F migration: tests/fixtures/pattern-params-694-old.document.json (written by main 13c43cd's code: patterns without names) loads with names
//     d3.. after the file's d1 / d2, nothing else changed (joints to the bit, every value, every other field).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as ops from '#core/tool-ops.js';
import { patternDefaults, isPatternConstraint, CIRCULAR_ANGLE_REFUSAL } from '#core/pattern.js';
import { previewDimensionInput, planChange, dimensionEntries, entryName } from '#core/parameters.js';
import { applyParameterChange, dimensionInputLabel } from '#core/dimension-seams.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { buildParameterRows, planTableEdit, commitTableEdit } from '#ui/parameter-table.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const near = (a, b, msg, tol = 1e-6) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const RECT = 'rectangularPattern', CIRC = 'circularPattern';
const P = (st, id) => st.joints.get(id);
const shape = (st, id) => st.shapes.find((s) => s.id === id);
const copyCentres = (st, c) => c.instances.map((i) => P(st, shape(st, i.shapes[0]).joints[0]));
const nullity = (st) => st.engine.jointFreedom().nullity;
const table = (st, edit) => { const p = planTableEdit(st, edit, { unit: 'mm' }); return p.ok ? { planned: p, res: commitTableEdit(st, p) } : { planned: p, res: p }; };
const userAngle = (p) => { let a = Math.atan2(-p.y, p.x) * 180 / Math.PI; if (a < -1e-9) a += 360; return a; };

// ------------------------------------------------------------------ A-E on one drawing: a hole R2 on the origin, its row of copies
const st = ops.newSketchState();
const hole = ops.circle(st, 0, 0, 2);
ops.snap(st, hole.c, 'j_origin');
const r1 = ops.dimension(st, { shape: hole.id }, { x: 3, y: -3 }, '2');
ok(r1.name === 'd1', `the hole's radius is d1 (${r1.name})`);
const c = ops.pattern(st, RECT, { shapes: [hole.id], joints: [] }, { ...patternDefaults(RECT), quantity: [3, 1], distance: [10, 10], distanceType: 'spacing' });
// A: Fusion's order, the next free names
eq(c.names, { quantity1: 'd2', quantity2: 'd3', distance1: 'd4', distance2: 'd5' }, 'A: the pattern values are d2..d5 (quantity one / two, distance one / two)');
ok(!('expressions' in c), 'A: no formula yet');
// a second circle on the origin whose radius will read the pattern's distance; its dimension takes the next name after the pattern's
const ring = ops.circle(st, 0, 0, 30);
ops.snap(st, ring.c, 'j_origin');
const r2 = ops.dimension(st, { shape: ring.id }, { x: 20, y: -25 }, '30');
ok(r2.name === 'd6', `A: the next dimension after the pattern is d6 (${r2.name})`);
eq(dimensionEntries(st.constraints).map(entryName), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], 'A: every entry in constraint order');
eq(nullity(st), 0, 'E: the drawing is fully defined (0 DOF) with the pattern made');

// B: the rows
{
  const rows = buildParameterRows(st, { unit: 'mm' }).dimensions;
  eq(rows.map((r) => r.name), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], 'B: one row per dimension and per pattern value');
  const pr = rows.filter((r) => r.constraint === c);
  eq(pr.map((r) => r.slot), ['quantity1', 'quantity2', 'distance1', 'distance2'], 'B: the pattern rows carry their values');
  eq(pr.map((r) => r.kindLabel), ['Count', 'Count', 'Length', 'Length'], 'B: kinds');
  eq(pr.map((r) => r.unit), ['', '', 'mm', 'mm'], 'B: units (a count has none)');
  eq(pr.map((r) => r.value), ['3', '1', '10', '10'], 'B: values');
  ok(pr[0].measures === 'Rectangular pattern: quantity 1' && pr[3].measures === 'Rectangular pattern: distance 2', `B: what each value is (${pr.map((r) => r.measures)})`);
}

// C: rename in the Name cell, then `pitch = 25` typed into the value (the dimension box's own path), then a dimension reading pitch
{
  const h0 = st.history.length;
  const { res } = table(st, { kind: 'dimension', column: 'name', constraint: c, slot: 'distance1', text: 'gap' });
  ok(res.ok && c.names.distance1 === 'gap' && st.history.length === h0 + 1, `C: the Name cell renames d4 -> gap, one undo step (${JSON.stringify(res)})`);
  const pv = previewDimensionInput(st, c, 'pitch = 25', { unit: 'mm', slot: 'distance1' });
  ok(pv.ok && pv.kind === 'name' && pv.name === 'pitch' && pv.own === 'gap', `C: 'pitch = 25' names the value (${pv.hint})`);
  ok(applyParameterChange(st, pv.plan, dimensionInputLabel(c, pv)).ok, 'C: committed');
  ok(c.names.distance1 === 'pitch' && c.distance[0] === 25, `C: renamed pitch = 25 (${JSON.stringify(c.names)} ${c.distance})`);
  copyCentres(st, c).forEach((p, k) => near(p.x, 25 * (k + 1), `C: copy ${k + 1} at x = ${25 * (k + 1)}`));
  ops.typeDimension(st, r2, 'pitch * 2');
  ok(r2.expression === 'pitch * 2' && r2.value === 50, `C: the ring's radius reads pitch: ${r2.expression} = ${r2.value}`);
  near(shape(st, ring.id).radius, 50, 'C: the ring follows (R 50)');
  // change pitch in the table: the pattern and the dependent move, ONE undo step
  const h1 = st.history.length;
  const t = table(st, { kind: 'dimension', column: 'expression', constraint: c, slot: 'distance1', text: '30' });
  ok(t.planned.ok && t.planned.hint === '= 30 mm' && t.res.ok, `C: pitch = 30 in the table (${t.planned.hint})`);
  ok(st.history.length === h1 + 1, 'C: one undo step');
  ok(c.distance[0] === 30 && r2.value === 60, `C: pitch 30 -> the ring 60 (${c.distance[0]}, ${r2.value})`);
  copyCentres(st, c).forEach((p, k) => near(p.x, 30 * (k + 1), `C: copy ${k + 1} at x = ${30 * (k + 1)}`));
  near(shape(st, ring.id).radius, 60, 'C: the ring follows (R 60)');
  eq(nullity(st), 0, 'E: still 0 DOF');
  st.undo();
  const cu = st.constraints.find(isPatternConstraint), ru = st.constraints.find((k) => k.name === 'd6');
  ok(cu.distance[0] === 25 && cu.names.distance1 === 'pitch' && ru.value === 50 && ru.expression === 'pitch * 2', `C: Undo -> pitch 25, d6 = pitch * 2 = 50 (${cu.distance[0]}, ${ru.expression} ${ru.value})`);
  copyCentres(st, cu).forEach((p, k) => near(p.x, 25 * (k + 1), `C: after Undo copy ${k + 1} at x = ${25 * (k + 1)}`));
  st.redo();
}

// D: a user parameter drives the quantity; refusals keep everything
{
  const cp = () => st.constraints.find(isPatternConstraint);
  const ring2 = () => st.constraints.find((k) => k.name === 'd6');
  ops.parameter(st, 'n', '', '4');
  let t = table(st, { kind: 'dimension', column: 'expression', constraint: cp(), slot: 'quantity1', text: 'n' });
  ok(t.res.ok && cp().quantity[0] === 4 && cp().expressions.quantity1 === 'n' && cp().instances.length === 3, `D: quantity 1 = n = 4 (${cp().quantity} ${JSON.stringify(cp().expressions)})`);
  t = table(st, { kind: 'parameter', column: 'expression', name: 'n', text: '5' });
  ok(t.res.ok && cp().quantity[0] === 5 && cp().instances.length === 4, `D: n = 5 -> 5 holes (${cp().quantity})`);
  copyCentres(st, cp()).forEach((p, k) => near(p.x, 30 * (k + 1), `D: copy ${k + 1} at x = ${30 * (k + 1)}`));
  // 2.5: THE pattern rule refuses it, in the preview and at the commit; nothing changes, no undo step
  const h = st.history.length, before = JSON.stringify(serializeDocument(st));
  t = table(st, { kind: 'parameter', column: 'expression', name: 'n', text: '2.5' });
  ok(!t.planned.ok && t.planned.message === 'd2: quantity 1 must be a whole number of 1 or more', `D: 2.5 refused in the table with the rule's message (${t.planned.message})`);
  const plan = planChange(st, { type: 'setParameter', name: 'n', text: '2.5' });
  const res = applyParameterChange(st, plan, 'change parameter n');
  ok(!res.ok && res.reason === 'quantity 1 must be a whole number of 1 or more', `D: the commit refuses it too (${res.reason})`);
  ok(st.history.length === h && JSON.stringify(serializeDocument(st)) === before, 'D: nothing changed, no undo step');
  ok(st.parameters.find((p) => p.name === 'n').expression === '5', 'D: the table keeps n = 5');
  t = table(st, { kind: 'parameter', column: 'expression', name: 'n', text: '0.7 * 10' });
  ok(t.res.ok && cp().quantity[0] === 7 && cp().instances.length === 6, `D: 0.7 * 10 (7.000000000000001) is the whole number 7 (${cp().quantity})`);
  t = table(st, { kind: 'parameter', column: 'expression', name: 'n', text: '3 mm' });
  ok(!t.planned.ok && /plain number/.test(t.planned.message), `D: a length is no count (${t.planned.message})`);
  eq(nullity(st), 0, 'E: still 0 DOF');
  ok(ring2().value === 60, 'D: the ring untouched');
  // E: save / load keeps names and formulas
  const doc = serializeDocument(st);
  const back = ops.newSketchState();
  ok(deserializeDocument(JSON.parse(JSON.stringify(doc)), back).ok, 'E: reloads');
  const cb = back.constraints.find(isPatternConstraint);
  eq(cb.names, cp().names, 'E: names survive save / load');
  eq(cb.expressions, { quantity1: 'n' }, 'E: formulas survive save / load');
  eq(serializeDocument(back).geometry.constraints, doc.geometry.constraints, 'E: re-saved byte for byte');
  // E: paste: the copy's values take new names (no name twice), the copied formula is frozen at its number
  st.selectedShapes.clear(); st.selectedShapes.add(hole.id); for (const i of cp().instances) for (const s of i.shapes) st.selectedShapes.add(s);
  const env = selectionToEnvelope(st);
  const pasted = pasteDocument(st, env.document, { unit: 'mm' });
  const pc = st.constraints.filter(isPatternConstraint)[1];
  ok(pc && pc !== cp(), 'E: the pattern was pasted');
  const names = dimensionEntries(st.constraints).map(entryName);
  ok(new Set(names).size === names.length, `E: no name twice after the paste (${names})`);
  eq(Object.values(pc.names), ['d8', 'd9', 'd10', 'd11'], 'E: the pasted values take the next names');
  ok(!pc.expressions && pc.quantity[0] === 7 && pasted.frozen.includes('d8'), `E: its copied formula is frozen at 7 (${JSON.stringify(pc.expressions)}, frozen ${pasted.frozen})`);
}

// ------------------------------------------------------------------ D: circular, a user angle -90 deg -> clockwise (task 691); 0 refused
{
  const s2 = ops.newSketchState();
  const C = ops.circle(s2, 5, 0, 1);
  const cc = ops.pattern(s2, CIRC, { shapes: [C.id], joints: [] }, { ...patternDefaults(CIRC), centre: 'j_origin', quantity: 3, angle: 90 });
  eq(cc.names, { quantity: 'd1', angle: 'd2' }, 'A: circular: quantity d1, total angle d2');
  const rows = buildParameterRows(s2, { unit: 'mm' }).dimensions;
  eq(rows.map((r) => [r.name, r.kindLabel, r.unit, r.value]), [['d1', 'Count', '', '3'], ['d2', 'Angle', 'deg', '90']], 'B: circular rows');
  ops.parameter(s2, 'turn', 'deg', '-90');
  let t = table(s2, { kind: 'dimension', column: 'expression', constraint: cc, slot: 'angle', text: 'turn' });
  ok(t.res.ok && cc.angle === -90 && cc.expressions.angle === 'turn', `D: the total angle reads turn = -90 (${cc.angle})`);
  eq(copyCentres(s2, cc).map((p) => Math.round(userAngle(p))), [315, 270], 'D: clockwise: the copies at -45 and -90 degrees');
  t = table(s2, { kind: 'parameter', column: 'expression', name: 'turn', text: '0' });
  ok(!t.planned.ok && t.planned.message === `d2: ${CIRCULAR_ANGLE_REFUSAL}`, `D: 0 refused with the rule's message (${t.planned.message})`);
  ok(cc.angle === -90, 'D: the angle stays -90');
}

// ------------------------------------------------------------------ F: migration of a document saved before task 694
{
  const file = JSON.parse(readFileSync(new URL('./fixtures/pattern-params-694-old.document.json', import.meta.url), 'utf8'));
  ok(file.geometry.constraints.filter((k) => /Pattern$/.test(k.type)).every((k) => !('names' in k)), 'F: the fixture has patterns without names');
  const input = JSON.parse(JSON.stringify(file));
  const s3 = ops.newSketchState();
  ok(deserializeDocument(file, s3).ok, 'F: it loads');
  eq(file, input, 'F: loading does not touch the file object');
  const pats = s3.constraints.filter(isPatternConstraint);
  eq(pats.map((k) => k.names), [{ quantity1: 'd3', quantity2: 'd4', distance1: 'd5', distance2: 'd6' }, { quantity: 'd7', angle: 'd8' }],
    'F: names after the highest name of the file (d2), in constraint order');
  const out = serializeDocument(s3);
  eq(out.geometry.joints, input.geometry.joints, 'F: every joint exactly as in the file (no geometry change)');
  eq(out.geometry.shapes, input.geometry.shapes, 'F: every shape exactly as in the file');
  // a pattern record: exactly the file's plus `names`; a dimension as the load path writes it (key order, no `__` placing flags: not this task's)
  const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).filter((k) => !k.startsWith('__')).sort().map((k) => [k, canon(x[k])])) : x);
  ok(out.geometry.constraints.length === input.geometry.constraints.length, 'F: the same constraints');
  out.geometry.constraints.forEach((k, i) => {
    if (/Pattern$/.test(k.type)) { const { names, ...rest } = k; eq(rest, input.geometry.constraints[i], `F: pattern ${i} is the file's record plus its names`); }
    else eq(canon(k), canon(input.geometry.constraints[i]), `F: constraint ${i} unchanged`);
  });
  const load2 = ops.newSketchState();
  deserializeDocument(JSON.parse(JSON.stringify(out)), load2);
  eq(serializeDocument(load2), out, 'F: deterministic: the migrated document re-loads unchanged');
  const free = s3.engine.jointFreedom();
  const s3b = ops.newSketchState(); deserializeDocument(JSON.parse(JSON.stringify(input)), s3b);
  eq(free.nullity, s3b.engine.jointFreedom().nullity, 'F: the same DOF');
}

console.log(`pattern-params-694: ${checks} checks passed`);
