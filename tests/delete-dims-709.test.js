// tests/delete-dims-709.test.js - TASK 709 (owner turn 1896: "Deleting geometry should delete the dimension"). Fusion: deleting a sketch curve
// or point deletes every dimension and constraint that names it, and the dimension's parameter leaves the parameter table. THE SWEEP, on the real
// SketchStudio Design canvas through the node kit (tests/helpers/node-app.js): for every dimension kind the app makes (point-point, point-line,
// line-line, horizontal / vertical, angle, radius, slot width (diameter), offset, fillet radius, pattern values, a template's dimensions, a
// dimension driven by a user parameter) and the constraints that name a shape (point on line, tangent, symmetric, parallel, equal), the drawing is
// built with the tools' own operations (#core/tool-ops.js), then deleted, one way at a time:
//   shape  the dimensioned shape selected + the Delete key (#core/delete-manager.js deleteSelection, the path every delete takes)
//   joint  one of its points selected + Delete
//   all    the whole drawing selected + Delete
//   trim   the Trim tool clicked on the line (a whole line with no crossing goes; an end past a crossing goes)
// After each, what is LEFT is listed: constraints naming geometry that is gone (a missing shape / point, or a point only deleted geometry used),
// their labels on the canvas, their rows in the Parameters table (#ui/parameter-table.js buildParameterRows, what the window shows); a
// dimension on SURVIVING geometry must stay; ONE Ctrl+Z brings everything back (document compared). Every case's line is printed (the table).
// O10 (owner ruling 1905, like Fusion): a deleted dimension that a formula reads keeps its name as a value (a user parameter flagged
// deletedDimension, comment 'dimension deleted'), editable, gone by itself once nothing reads it; Undo restores the real dimension.
import assert from 'node:assert';
import * as ops from '#core/tool-ops.js';
import { open } from './helpers/node-app.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';
import { patternDefaults, isPatternConstraint } from '#core/pattern.js';
import { offsetChainOf, applyOffset } from '#core/offset.js';
import { buildTemplate, templateById } from '#core/templates.js';
import { serializeDocument, deserializeDocument } from '#core/document.js';
import { evaluateAll } from '#core/parameters.js';
import { buildParameterRows, planTableEdit, commitTableEdit } from '#ui/parameter-table.js';

const app = await open({ host: 'sketchstudio' });
const st = app.state;
const rows = [];
let failures = 0;

// ---- the drawing, from nothing (the origin stays) ----
function reset() {
  for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0; st.parameters.length = 0;
  st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
  app.frames(2);
}
const shapeOf = (id) => st.shapes.find((s) => s.id === id);
const line = (x1, y1, x2, y2) => ops.polyline(st, [[x1, y1], [x2, y2]], false)[0];
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const named = (c) => (c.name ? `${c.type}:${c.name}` : c.type);
const docOf = () => JSON.stringify({
  joints: [...st.joints.entries()].map(([k, j]) => [k, Math.round(j.x * 1e4) / 1e4, Math.round(j.y * 1e4) / 1e4]).sort(),
  shapes: st.shapes.map((s) => [s.id, ...s.joints]), constraints: st.constraints.map((c) => named(c) + ':' + JSON.stringify([c.joints, c.joint, c.shapes, c.shape, c.line, c.circle])),
  parameters: st.parameters.map((p) => p.name + '=' + p.expression),
});

// ---- the cases: build() -> { dims: the dimensions / constraints under test, survivor: one on other geometry, shape, joint, trim?: [x, y] } ----
const CASES = [
  { kind: 'distance point-point (a line length)', build() {
    const L = line(0, 0, 40, 0), M = line(0, 30, 30, 30);
    return { dims: [ops.dimension(st, { joints: [L.a, L.b] }, { x: 20, y: -8 }, '40')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 38 }, '30'), shape: L.id, joint: L.a, trim: [20, 0] };
  } },
  { kind: 'distance point-line', build() {
    const L = line(0, 0, 40, 0), P = line(10, 20, 30, 25), M = line(0, 60, 30, 60);
    return { dims: [ops.dimension(st, { point: P.a, line: L.id }, { x: 5, y: 10 }, '20')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: L.id, joint: L.a, trim: [20, 0] };
  } },
  { kind: 'distance line-line (parallel)', build() {
    const L = line(0, 0, 40, 0), K = line(0, 20, 40, 20), M = line(0, 60, 30, 60);
    return { dims: [ops.dimension(st, { lines: [L.id, K.id] }, { x: 45, y: 10 }, '20')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: L.id, joint: L.a, trim: [20, 0] };
  } },
  { kind: 'horizontal / vertical (task 680)', build() {
    const L = line(0, 0, 40, 3), M = line(0, 60, 30, 60);
    const d = ops.dimension(st, { joints: [L.a, L.b] }, { x: 20, y: -15 }, '40');
    return { dims: [d], note: 'dimMode ' + d.dimMode, survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: L.id, joint: L.a, trim: [20, 1.5] };
  } },
  { kind: 'angle', build() {
    const L = line(0, 0, 40, 0), K = line(0, 5, 30, 35), M = line(0, 60, 30, 60);
    return { dims: [ops.dimension(st, { lines: [L.id, K.id] }, { x: 20, y: 8 }, '45')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: L.id, joint: L.a, trim: [20, 0] };
  } },
  { kind: 'radius (circle)', build() {
    const C = ops.circle(st, 0, 0, 10), M = line(30, 0, 60, 0);
    return { dims: [ops.dimension(st, { shape: C.id }, { x: 8, y: -12 }, '10')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 45, y: -8 }, '30'), shape: C.id, joint: C.c };
  } },
  { kind: 'radius (arc)', build() {
    const c = ops.click(st, 0, 0), a = ops.click(st, 10, 0), b = ops.click(st, 0, -10);
    const A = ops.arc(st, c, a, b, { sweep: false }), M = line(30, 0, 60, 0);
    return { dims: [ops.dimension(st, { shape: A }, { x: 9, y: -9 }, '10')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 45, y: -8 }, '30'), shape: A, joint: c };
  } },
  { kind: 'slot width (diameter, task 673)', build() {
    const s = ops.slot(st, ops.click(st, 0, 0), ops.click(st, 30, 0), 10), M = line(0, 40, 30, 40);
    const w = st.constraints.find((k) => k.isDiameter);
    const arcId = w.shape;
    return { dims: [w], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 48 }, '30'), shape: arcId, joint: shapeOf(arcId).joints[0] };
  } },
  { kind: 'offset (tasks 667 / 690)', build() {
    const L = line(0, 0, 40, 0), M = line(0, 60, 30, 60);
    const ch = offsetChainOf(st, L.id);
    const res = applyOffset(st, ch.chain, 5, 1);
    assert.ok(res.ok, 'the offset is made: ' + res.reason);
    const off = st.constraints.find((k) => k.type === T.OFFSET);
    return { dims: [off], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: L.id, joint: L.a, trim: [20, 0] };
  } },
  { kind: 'fillet radius', build() {
    const r = ops.rect(st, 0, 0, 40, 30);
    const f = ops.fillet(st, r.top, r.right, 5);
    const M = line(0, 60, 30, 60);
    return { dims: [f.radiusConstraint], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: f.arc, joint: f.center };
  } },
  { kind: 'pattern values (task 694)', build() {
    const C = ops.circle(st, 0, 0, 2), M = line(0, 60, 30, 60);
    const p = ops.pattern(st, T.RECTANGULAR_PATTERN, { shapes: [C.id], joints: [] }, { ...patternDefaults(T.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [10, 10], distanceType: 'spacing' });
    return { dims: [p], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: C.id, joint: C.c };
  } },
  { kind: 'template (rounded rectangle) fillet radius', build() {
    const r = deserializeDocument(buildTemplate(templateById('rounded-rectangle')), st);
    assert.ok(r.ok !== false, 'the template loads');
    const rad = st.constraints.find((k) => k.isRadius && st.shapes.some((s) => s.id === k.shape && s.type === 'arc'));
    const keep = st.constraints.find((k) => k !== rad && k.isRadius);
    return { dims: [rad], survivor: keep, shape: rad.shape, joint: shapeOf(rad.shape).joints[0] };
  } },
  { kind: 'dimension driven by a user parameter', build() {
    ops.parameter(st, 'w', 'mm', '25 mm');
    const L = line(0, 0, 40, 0), M = line(0, 60, 30, 60);
    return { dims: [ops.dimension(st, { joints: [L.a, L.b] }, { x: 20, y: -8 }, 'w')], survivor: ops.dimension(st, { joints: [M.a, M.b] }, { x: 15, y: 68 }, '30'), shape: L.id, joint: L.a, trim: [20, 0], keepParameter: 'w' };
  } },
  // constraints (no dimension) that name a SHAPE: the same rule
  { kind: 'constraint point-on-line', build() {
    const L = line(0, 0, 40, 0), P = line(10, 0, 20, 30);
    return { dims: [ops.constrain(st, T.POINT_ON_LINE, { joint: P.a, shape: L.id })], shape: L.id, joint: L.a, trim: [5, 0] };
  } },
  { kind: 'constraint tangent (line, circle)', build() {
    const L = line(-20, 10, 20, 10), C = ops.circle(st, 0, 0, 10);
    return { dims: [ops.constrain(st, T.TANGENT, { line: L.id, circle: C.id })], shape: L.id, joint: L.a, trim: [0, 10] };
  } },
  { kind: 'constraint symmetric (two points about a line)', build() {
    const L = line(0, -20, 0, 20), P = line(-10, 0, -20, 30), Q = line(10, 0, 20, 30);
    return { dims: [ops.constrain(st, T.SYMMETRIC, { joints: [P.a, Q.a], line: L.id })], shape: L.id, joint: L.a, trim: [0, 10] };
  } },
  { kind: 'constraint parallel (two lines)', build() {
    const L = line(0, 0, 40, 0), K = line(0, 20, 40, 21);
    return { dims: [ops.constrain(st, T.PARALLEL, { shapes: [L.id, K.id] })], shape: L.id, joint: L.a, trim: [20, 0] };
  } },
];

// ---- what is left after a delete ----
function leftovers(before) {
  const shapeIds = new Set(st.shapes.map((s) => s.id));
  const usedNow = new Set(st.shapes.flatMap((s) => asList(s.joints)));
  const lostPoints = new Set([...before.usedJoints].filter((j) => !usedNow.has(j))); // points that only deleted / trimmed geometry used
  const gone = (c) => {
    if (isPatternConstraint(c)) return [...c.sources.shapes].some((id) => !shapeIds.has(id)) || c.sources.points.some((j) => !st.joints.has(j));
    const shapes = [...asList(c.shapes), ...asList(c.shape), ...asList(c.line), ...asList(c.circle)];
    const joints = [...asList(c.joints), ...asList(c.joint)];
    return shapes.some((id) => !shapeIds.has(id)) || joints.some((j) => !st.joints.has(j) || (lostPoints.has(j) && !(st.joints.get(j) || {}).virtualSharp));
  };
  const left = st.constraints.filter(gone);
  const idx = left.map((c) => st.constraints.indexOf(c));
  const labels = idx.filter((i) => app.svg.querySelector(`.dim-label[data-constraint-idx="${i}"]`)).length;
  const table = buildParameterRows(st, { unit: 'mm' }).dimensions.filter((r) => left.includes(r.constraint)).map((r) => r.name);
  return { left, labels, table };
}

function run(c, mode) {
  reset();
  const b = c.build();
  st.engine.solve(200);
  app.frames(2);
  const target = { shape: b.shape, joint: b.joint };
  if (mode === 'trim' && !b.trim) return null;
  const pre = docOf();
  const before = { usedJoints: new Set(st.shapes.flatMap((s) => asList(s.joints))) };
  const histBefore = st.history.length;
  if (mode === 'shape') { st.selectedShapes.add(target.shape); app.key('Delete'); }
  else if (mode === 'joint') { st.selectedJoints.add(target.joint); app.key('Delete'); }
  else if (mode === 'all') { st.shapes.forEach((s) => st.selectedShapes.add(s.id)); app.key('Delete'); }
  else if (mode === 'trim') { app.tool('trim'); const p = app.toScreen(...b.trim); app.click(p.x, p.y); app.tool('select'); }
  app.frames(2);
  const lo = leftovers(before);
  const survivorKept = b.survivor && mode !== 'all' ? st.constraints.includes(b.survivor) : null; // 'all' deletes the survivor's geometry too
  const parameterKept = b.keepParameter ? st.parameters.some((p) => p.name === b.keepParameter) : null;
  const steps = st.history.length - histBefore;
  app.undo(); app.frames(2);
  const undone = docOf() === pre;
  const row = { kind: c.kind + (b.note ? ` [${b.note}]` : ''), mode, left: lo.left.map(named), labels: lo.labels, table: lo.table, survivorKept, parameterKept, steps, undone };
  rows.push(row);
  return row;
}

try {
  for (const c of CASES) for (const mode of ['shape', 'joint', 'all', 'trim']) run(c, mode);

  // ---- O10 (owner ruling 1905, "like Fusion"; Fusion measured by the advisor): a deleted dimension that a formula reads KEEPS its name as a
  // value (d2 = d1 / 2 stays 15, half = d1 / 4 stays 7.5); the kept d1 is a row of the Parameters table ("dimension deleted"), editable; it goes
  // by itself once nothing reads it; Undo of the delete gives the real dimension back; a new dimension never takes its name. ----
  const formulaLog = [];
  const check = (cond, msg) => { formulaLog.push(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };
  const param = (n) => st.parameters.find((p) => p.name === n) || null;
  const userRow = (n) => buildParameterRows(st, { unit: 'mm' }).user.find((r) => r.name === n) || null;
  const valueOf = (n) => { const v = evaluateAll(st, { unit: 'mm' }).values.get(n); return v ? Math.round(v.v * 1e6) / 1e6 : null; };
  const errorsNow = () => [...(evaluateAll(st, { unit: 'mm' }).errors || new Map())].map(([k, e]) => `${k}: ${e.message}`);
  const dim = (n) => st.constraints.find((c) => c.name === n) || null;
  const build = () => {
    reset();
    const A = line(0, 0, 30, 0), B = line(0, 30, 40, 30), C = line(0, 60, 20, 60);
    const d1 = ops.dimension(st, { joints: [A.a, A.b] }, { x: 15, y: -8 }, '30');
    const d2 = ops.dimension(st, { joints: [B.a, B.b] }, { x: 20, y: 38 }, `${d1.name} / 2`);
    ops.parameter(st, 'half', 'mm', `${d1.name} / 4`);
    const d3 = ops.dimension(st, { joints: [C.a, C.b] }, { x: 10, y: 68 }, '20'); // nothing reads it
    st.engine.solve(200); app.frames(2);
    return { A, B, C, d1, d2, d3 };
  };
  const keptLooks = (what) => {
    const p = param('d1');
    check(!dim('d1'), `${what}: the dimension d1 is gone from the sketch`);
    check(p && p.deletedDimension === true && p.expression === '30 mm' && p.unit === 'mm', `${what}: d1 is kept as a value 30 mm (${JSON.stringify(p)})`);
    check(valueOf('d2') === 15 && dim('d2') && dim('d2').expression === 'd1 / 2' && Math.abs(dim('d2').value - 15) < 1e-6, `${what}: d2 is still d1 / 2 = 15 (${valueOf('d2')})`);
    check(valueOf('half') === 7.5 && param('half').expression === 'd1 / 4', `${what}: half is still d1 / 4 = 7.5 (${valueOf('half')})`);
    check(errorsNow().length === 0, `${what}: no formula error (${errorsNow().join('; ')})`);
    const r = userRow('d1');
    check(r && r.value === '30' && r.comment === 'dimension deleted' && [...r.users].sort().join(',') === 'd2,half', `${what}: the Parameters table shows d1 = 30 · dimension deleted, read by d2 and half (${JSON.stringify(r && { value: r.value, comment: r.comment, users: r.users })})`);
    check(!param('d3'), `${what}: d3, which nothing reads, is never a kept value`);
  };
  {
    // 1. its LINE deleted (shape + Delete), with an unread dimension's line deleted in the same step
    const { A, C } = build();
    const h0 = st.history.length;
    st.selectedShapes.add(A.id); st.selectedShapes.add(C.id); app.key('Delete'); app.frames(2);
    keptLooks('line + Delete');
    check(!dim('d3') && !param('d3'), 'line + Delete: d3 (nothing reads it) went completely with its line');
    check(st.history.length === h0 + 1, 'line + Delete: one undo step');
    app.undo(); app.frames(2);
    check(dim('d1') && Math.abs(dim('d1').value - 30) < 1e-6 && !param('d1') && dim('d3'), 'Undo: the real dimension d1 (and d3) is back, no kept value: ' + JSON.stringify({ d1: dim('d1') && dim('d1').value, kept: param('d1'), d3: !!dim('d3') }));
    check(errorsNow().length === 0 && valueOf('d2') === 15, 'Undo: d2 reads the real d1');
  }
  {
    // 2. a point of the line deleted; 3. the Trim tool; 4. the dimension itself deleted
    let b = build(); st.selectedJoints.add(b.A.a); app.key('Delete'); app.frames(2); keptLooks('point + Delete');
    b = build(); app.tool('trim'); const p = app.toScreen(15, 0); app.click(p.x, p.y); app.tool('select'); app.frames(2);
    check(!st.shapes.some((s) => s.id === b.A.id), 'Trim: the line is gone'); keptLooks('Trim');
    b = build(); st.selectedConstraints.add(b.d1); st.selectedConstraints.add(b.d3); app.key('Delete'); app.frames(2);
    check(st.shapes.some((s) => s.id === b.A.id), 'dimension + Delete: the line stays'); keptLooks('dimension + Delete');
  }
  {
    // 5. the kept value: a new dimension does not take its name; editing it moves its readers; save / load keeps it; it goes once nothing reads it
    const { A } = build();
    st.selectedShapes.add(A.id); app.key('Delete'); app.frames(2);
    const N = line(0, 90, 25, 90);
    const dn = ops.dimension(st, { joints: [N.a, N.b] }, { x: 12, y: 98 }, '25');
    check(dn.name !== 'd1' && !param(dn.name) && st.constraints.filter((c) => c.name === dn.name).length === 1, `a new dimension takes a free name (${dn.name}), never the kept d1`);
    const ed = planTableEdit(st, { kind: 'parameter', column: 'expression', name: 'd1', text: '40 mm' }, { unit: 'mm' });
    check(ed.ok && commitTableEdit(st, ed).ok, 'the kept d1 is edited in the table: 40 mm');
    st.engine.solve(200);
    check(valueOf('d2') === 20 && Math.abs(dim('d2').value - 20) < 1e-6 && valueOf('half') === 10, `editing it moves its readers: d2 = 20, half = 10 (${valueOf('d2')}, ${valueOf('half')})`);
    check(param('d1') && param('d1').deletedDimension === true, 'edited, it is still a kept value');
    const S2 = ops.newSketchState(); deserializeDocument(serializeDocument(st), S2);
    check(JSON.stringify(S2.parameters.find((p) => p.name === 'd1')) === JSON.stringify({ name: 'd1', unit: 'mm', expression: '40 mm', comment: 'dimension deleted', deletedDimension: true }), 'save / load keeps the kept value: ' + JSON.stringify(S2.parameters));
    // its readers go: d2 (the dimension) first: half still reads d1; then half (the bin in the table): d1 goes by itself
    st.selectedConstraints.add(dim('d2')); app.key('Delete'); app.frames(2);
    check(!dim('d2') && param('d1'), 'd2 deleted: d1 is kept (half still reads it)');
    check(!param('d2'), 'd2 itself is not kept: nothing reads it');
    const del = planTableEdit(st, { kind: 'parameter', column: 'delete', name: 'half' }, { unit: 'mm' });
    check(del.ok && commitTableEdit(st, del).ok, 'half deleted in the table');
    check(!param('d1') && !userRow('d1'), 'nothing reads d1 any more: the kept value is gone by itself, and its row');
    app.undo(); app.frames(2);
    check(param('half') && param('d1') && param('d1').deletedDimension === true, 'Undo of that delete: half and the kept d1 are back');
  }

  // ---- the table ----
  console.log('kind | delete | left-over constraints | labels | table rows | survivor kept | parameter kept | undo steps | one Ctrl+Z restores');
  for (const r of rows) console.log(`${r.kind} | ${r.mode} | ${r.left.join(', ') || '-'} | ${r.labels} | ${r.table.join(', ') || '-'} | ${r.survivorKept ?? 'n/a'} | ${r.parameterKept ?? 'n/a'} | ${r.steps} | ${r.undone}`);
  console.log('O10, a formula reads the deleted dimension:'); for (const l of formulaLog) console.log(l);

  for (const r of rows) {
    const where = `${r.kind} / ${r.mode}`;
    const bad = [];
    if (r.left.length) bad.push('left-over constraints ' + r.left.join(', '));
    if (r.labels) bad.push(r.labels + ' label(s) of deleted geometry on the canvas');
    if (r.table.length) bad.push('Parameters rows ' + r.table.join(', '));
    if (r.survivorKept === false) bad.push('the dimension on SURVIVING geometry was deleted');
    if (r.parameterKept === false) bad.push('the user parameter was deleted');
    if (!r.undone) bad.push('one Ctrl+Z does not restore the drawing');
    if (bad.length) { failures++; console.error(`FAIL ${where}: ${bad.join('; ')}`); }
  }
} finally { await app.close(); }
if (failures) { console.error(`delete-dims-709: ${failures} case(s) leave something behind`); process.exitCode = 1; }
else console.log(`delete-dims-709: ok (${rows.length} cases)`);
