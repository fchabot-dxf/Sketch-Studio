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
// A formula in ANOTHER parameter reading a deleted d-name is listed separately (its outcome is the owner's decision, design doc O10).
import assert from 'node:assert';
import * as ops from '#core/tool-ops.js';
import { open } from './helpers/node-app.js';
import { CONSTRAINT_TYPES as T } from '#core/constants.js';
import { patternDefaults, isPatternConstraint } from '#core/pattern.js';
import { offsetChainOf, applyOffset } from '#core/offset.js';
import { buildTemplate, templateById } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';
import { evaluateAll } from '#core/parameters.js';
import { buildParameterRows } from '#ui/parameter-table.js';

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

  // ---- a formula in ANOTHER dimension reads the deleted d-name (the owner's decision: design doc O10) ----
  reset();
  const A = line(0, 0, 40, 0), B = line(0, 30, 40, 30);
  const d1 = ops.dimension(st, { joints: [A.a, A.b] }, { x: 20, y: -8 }, '40');
  const d2 = ops.dimension(st, { joints: [B.a, B.b] }, { x: 20, y: 38 }, `${d1.name} / 2`);
  ops.parameter(st, 'half', 'mm', `${d1.name} / 4`);
  app.frames(2);
  st.selectedShapes.add(A.id); app.key('Delete'); app.frames(2);
  const ev = evaluateAll(st, { unit: 'mm' });
  const formula = { d1: d1.name, d1Left: st.constraints.includes(d1), d2: d2.name, d2Expression: d2.expression || null, d2Value: d2.value,
    half: (st.parameters.find((p) => p.name === 'half') || {}).expression, errors: [...(ev.errors || new Map())].map(([k, e]) => `${k}: ${e.message}`) };
  app.undo();

  // ---- the table ----
  console.log('kind | delete | left-over constraints | labels | table rows | survivor kept | parameter kept | undo steps | one Ctrl+Z restores');
  for (const r of rows) console.log(`${r.kind} | ${r.mode} | ${r.left.join(', ') || '-'} | ${r.labels} | ${r.table.join(', ') || '-'} | ${r.survivorKept ?? 'n/a'} | ${r.parameterKept ?? 'n/a'} | ${r.steps} | ${r.undone}`);
  console.log('formula reading the deleted name: ' + JSON.stringify(formula));

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
