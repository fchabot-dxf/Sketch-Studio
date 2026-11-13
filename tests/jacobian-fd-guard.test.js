import assert from 'node:assert';
import { Definitions, BODY_POINTS } from '#core/solver/definitions.js';
import { createNewtonSolver } from '#core/solver/engine.js';
import { sceneJoints, sceneShapes } from '#core/reference-lines.js';

// GUARD (task 511, audit F6): the DOF / redundancy analysis (engine.jointFreedom, rankRowRedundant) reads the nullspace of the
// solver Jacobian, _assemble(x). For EVERY constraint type in Definitions that Jacobian must equal a central
// finite difference of the residual on EVERY free column (point AND line endpoints), or the nullity lies about freedom.
// (The solver step and the nullity read the SAME rows: there is no one-sided row any more.)
// Tolerance: max |analytic - finite difference| < TOL per entry.
const TOL = 1e-4, EPS = 1e-6;
const EXEMPT = { mouse_spring: 'transient drag spring, never analysed', mouseSpring: 'alias of mouse_spring' };
const TYPE_OF = { point_on_line: 'pointOnLine', pointOnLine: 'pointOnLine' };

const joints = () => new Map([
  ['a', { x: 0, y: 0, fixed: false }], ['b', { x: 10, y: 3, fixed: false }], ['c', { x: 0, y: 10, fixed: false }],
  ['d', { x: 7, y: 14, fixed: false }], ['m', { x: 9, y: 9, fixed: false }],
  ['n', { x: 20, y: 4, fixed: false }], ['ac', { x: -8, y: 3, fixed: false }], ['as', { x: -3, y: 4, fixed: false }], ['ae', { x: -8, y: 8, fixed: false }],
  ['bc', { x: 12, y: -6, fixed: false }], ['bs', { x: 15, y: -2, fixed: false }], ['be', { x: 8, y: -9, fixed: false }],
]);
// C1 / C2 are circles: their radius is a solver unknown (task 515), the LAST columns of x. A1 / A2 are arcs: the radius is live,
// |first rim - centre| (task 523), so a row that reads it has its rim (as / bs) and centre columns. L3 ends ON A1's end rim.
const SH = () => [
  { id: 'L1', type: 'line', joints: ['a', 'b'] },
  { id: 'L2', type: 'line', joints: ['c', 'd'] },
  { id: 'C1', type: 'circle', joints: ['m'], radius: 2 },
  { id: 'C2', type: 'circle', joints: ['n'], radius: 3.5 },
  { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'] },
  { id: 'A2', type: 'arc', joints: ['bc', 'bs', 'be'] },
  { id: 'L3', type: 'line', joints: ['ae', 'd'] },
];
const CASES = {
  coincident: { type: 'coincident', joints: ['a', 'b'] },
  distance: { type: 'distance', joints: ['a', 'b'], value: 5 },
  horizontal: { type: 'horizontal', joints: ['a', 'b'] },
  vertical: { type: 'vertical', joints: ['a', 'b'] },
  pointOnLine: { type: 'pointOnLine', joint: 'm', shape: 'L1' },
  midpoint: { type: 'midpoint', joints: ['a', 'b', 'm'] },
  collinear: { type: 'collinear', shapes: ['L1', 'L2'] },
  parallel: { type: 'parallel', shapes: ['L1', 'L2'] },
  perpendicular: { type: 'perpendicular', shapes: ['L1', 'L2'] },
  tangent: { type: 'tangent', line: 'L1', circle: 'C1' },
  equal: { type: 'equal', joints: ['a', 'b', 'c', 'd'] },
  angle: { type: 'angle', shapes: ['L1', 'L2'], value: 90 },
  symmetric: { type: 'symmetric', joints: ['m', 'n'], line: 'L1' },
};

// One case: analytic J vs central finite differences on EVERY column of x (joint x/y and circle radius). Returns the largest |J| on
// each circle radius column and on each joint's x/y columns, so a radius case can also assert its radius column is really in the row.
const withOrigin = () => new Map([['j_origin', { x: 0, y: 0, fixed: true }], ...joints()]);   // the axes pass through the origin joint
// scene: resolve the operands in the scene (the two built-in axes, task 539), as the app's engine does (constraint-solver.js).
function guard(label, c, extraShapes = [], scene = false) {
  const J = scene ? sceneJoints(withOrigin()) : joints(), shp = scene ? sceneShapes([...SH(), ...extraShapes]) : [...SH(), ...extraShapes];
  const solver = createNewtonSolver(J, [{ ...c }], shp, { maxIter: 1 });
  const x0 = solver._pack(), n = x0.length;
  const asm = solver._assemble(x0);
  let worst = 0;
  for (let k = 0; k < n; k++) {
    const xp = Float64Array.from(x0), xm = Float64Array.from(x0); xp[k] += EPS; xm[k] -= EPS;
    const rp = solver._assemble(xp).r, rm = solver._assemble(xm).r;
    for (let i = 0; i < asm.m; i++) worst = Math.max(worst, Math.abs((rp[i] - rm[i]) / (2 * EPS) - asm.J[i * n + k]));
  }
  assert.ok(asm.m > 0, `${label}: built no rows`);
  assert.ok(worst < TOL, `${label}: Jacobian differs from finite differences by ${worst} (tolerance ${TOL})`);
  const radiusCol = {};
  const colMax = (k) => { let v = 0; for (let i = 0; i < asm.m; i++) v = Math.max(v, Math.abs(asm.J[i * n + k])); return v; };
  solver._radiusShapes.forEach((s, q) => { radiusCol[s.id] = colMax(solver._nJointVars + q); });
  solver._freeIds.forEach((id, v) => { radiusCol[id] = Math.max(colMax(v * 2), colMax(v * 2 + 1)); });
  console.log(`ok ${label} (rows ${asm.m}, columns ${n}, max diff ${worst.toExponential(1)})`);
  return radiusCol;
}

let checked = 0;
for (const key of Object.keys(Definitions)) {
  if (EXEMPT[key]) continue;
  const type = TYPE_OF[key] || key;
  const c = CASES[type];
  assert.ok(c, `Definitions key "${key}" has no case in this guard: add one or EXEMPT it with a reason`);
  guard(key, c);
  checked++;
}
assert.ok(checked >= 12, 'checked ' + checked);

// The circle RADIUS unknown (task 515): every row that reads it, on every column, and its radius column must be non-zero.
const RADIUS_CASES = [
  ['distance (radius of a circle)', { type: 'distance', shape: 'C1', isRadius: true, value: 5 }, ['C1']],
  ['pointOnLine (point on a circle)', { type: 'pointOnLine', joint: 'a', shape: 'C1' }, ['C1']],
  ['tangent (line-circle)', { type: 'tangent', line: 'L1', circle: 'C1' }, ['C1']],
  ['tangent (circle-circle, external)', { type: 'tangent', shapes: ['C1', 'C2'] }, ['C1', 'C2']],
  ['tangent (circle-circle, internal)', { type: 'tangent', shapes: ['C1', 'C2'], branch: 'internal' }, ['C1', 'C2']],
  ['equal (circle-circle)', { type: 'equal', shapes: ['C1', 'C2'] }, ['C1', 'C2']],
  ['equal (circle-arc)', { type: 'equal', shapes: ['C1', 'A1'] }, ['C1']],
  ['equal (arc-circle)', { type: 'equal', shapes: ['A1', 'C2'] }, ['C2']],
  // The ARC radius (task 523): every tangent form with an arc, and point-on-arc, differentiate |rim - centre| (columns as / bs).
  ['pointOnLine (point on an arc)', { type: 'pointOnLine', joint: 'a', shape: 'A1' }, ['as']],
  ['tangent (line-arc, {line, circle})', { type: 'tangent', line: 'L1', circle: 'A1' }, ['as']],
  ['tangent (line-arc, shapes)', { type: 'tangent', shapes: ['A1', 'L1'] }, ['as']],
  ['tangent (line-arc at a shared rim)', { type: 'tangent', line: 'L3', circle: 'A1' }, ['ae']],
  ['tangent (circle-arc, external)', { type: 'tangent', shapes: ['C1', 'A1'] }, ['C1', 'as']],
  ['tangent (arc-circle, internal)', { type: 'tangent', shapes: ['A1', 'C1'], branch: 'internal' }, ['C1', 'as']],
  ['tangent (arc-arc, external)', { type: 'tangent', shapes: ['A1', 'A2'] }, ['as', 'bs']],
  ['tangent (arc-arc, internal)', { type: 'tangent', shapes: ['A1', 'A2'], branch: 'internal' }, ['as', 'bs']],
];
for (const [label, c, uses] of RADIUS_CASES) {
  const col = guard(label, c);
  for (const id of uses) assert.ok(col[id] > 0.5, `${label}: the ${id} radius/rim column is ${col[id]} (expected it in the row)`);
  checked++;
}
// The angle row's measured SECTOR (task 553, #core/angle-sector.js): every ray / turn combination, values past 180, and poses on both sides
// of 90 degrees from the target (where the row is |u||v| sin(theta - alpha), and beyond, where it continues as 2 sgn |u||v| - S so it pulls
// back to the target, not to its modulo-180 twin). L1 runs at 16.7 degrees, L2 at 29.7: theta = 13.0.
const ANGLE_SECTOR_CASES = [];
for (const ray1 of [1, -1]) for (const ray2 of [1, -1]) for (const turn of [1, -1]) for (const value of [30, 100, 190, 270, 350]) {
  ANGLE_SECTOR_CASES.push([`angle ${value}, sector ${ray1}/${ray2}/${turn}`, { type: 'angle', shapes: ['L1', 'L2'], value, sector: { ray1, ray2, turn } }]);
}
let farRows = 0;
for (const [label, c] of ANGLE_SECTOR_CASES) {
  const alpha = c.sector.turn * c.value + (c.sector.ray1 !== c.sector.ray2 ? 180 : 0), off = Math.abs((((13.0 - alpha) % 360) + 540) % 360 - 180);
  if (off > 90) farRows++;
  assert.ok(off > 1 && off < 179, `${label}: keep the case off the target and off its opposite (${off})`);
  guard(label + ` (${off.toFixed(0)} deg from the target)`, c);
  checked++;
}
assert.ok(farRows >= 10, `the far side of the angle row is covered (${farRows} cases)`);
// A row that names the SAME joint more than once (task 533, F6): two lines sharing a corner in every way, the same line twice, a point
// that is an end of its own line, a line ending on a circle / arc centre, arcs sharing a rim or a centre, a two-joint row given one
// joint twice. Each occurrence adds its own partial (definitions.js addGrad); the old rows ASSIGNED, so the last write overwrote the
// others (parallel b === c: |J - fd| = 11).
const LX = (p, q) => [{ id: 'LX', type: 'line', joints: [p, q] }];
const ARC3 = (c, s, e) => [{ id: 'A3', type: 'arc', joints: [c, s, e] }];
const SHARE = { 'L2 starts at L1 end (b=c)': ['b', 'd'], 'L2 ends at L1 end (b=d)': ['c', 'b'], 'L2 starts at L1 start (a=c)': ['a', 'd'],
  'L2 ends at L1 start (a=d)': ['c', 'a'], 'the same line twice': ['a', 'b'], 'the same line reversed': ['b', 'a'] };
const TWO_LINE_ROWS = [
  ['parallel', { type: 'parallel' }], ['perpendicular', { type: 'perpendicular' }],
  ['perpendicular branch +1', { type: 'perpendicular', branch: 1 }], ['perpendicular branch -1', { type: 'perpendicular', branch: -1 }],
  ['angle 90', { type: 'angle', value: 90 }], ['angle 30', { type: 'angle', value: 30 }],
  ['angle 200', { type: 'angle', value: 200 }], ['angle 300 clockwise to the opposite ray', { type: 'angle', value: 300, sector: { ray1: 1, ray2: -1, turn: -1 } }],
  ['equal', { type: 'equal' }],
  ['collinear', { type: 'collinear' }], ['distance line-line', { type: 'distance', value: 4 }],
];
const SHARED_CASES = [];
for (const [pattern, ends] of Object.entries(SHARE)) {
  for (const [row, c] of TWO_LINE_ROWS) {
    SHARED_CASES.push([`${row}, ${pattern}`, { ...c, shapes: ['L1', 'LX'] }, LX(...ends)]);
    if (row === 'distance line-line') SHARED_CASES.push([`${row} (reversed operands), ${pattern}`, { ...c, shapes: ['LX', 'L1'] }, LX(...ends)]);
  }
}
SHARED_CASES.push(
  ['pointOnLine, the point is the line start', { type: 'pointOnLine', joint: 'a', shape: 'L1' }],
  ['pointOnLine, the point is the line end', { type: 'pointOnLine', joint: 'b', shape: 'L1' }],
  ['distance point-line, the point is the line start', { type: 'distance', joints: ['a', 'a', 'b'], value: 3 }],
  ['distance point-line, the point is the line end', { type: 'distance', joints: ['b', 'a', 'b'], value: 3 }],
  ['pointOnLine (circle), the point is the centre', { type: 'pointOnLine', joint: 'm', shape: 'C1' }],
  ['pointOnLine (arc), the point is the radius rim', { type: 'pointOnLine', joint: 'as', shape: 'A1' }],
  ['tangent line-circle, the line ends on the centre', { type: 'tangent', line: 'LX', circle: 'C1' }, LX('m', 'c')],
  ['tangent line-arc, the line ends on the centre', { type: 'tangent', line: 'LX', circle: 'A1' }, LX('ac', 'd')],
  ['tangent line-arc, the line starts on the start rim', { type: 'tangent', line: 'LX', circle: 'A1' }, LX('as', 'd')],
  ['tangent arc-arc, a shared rim', { type: 'tangent', shapes: ['A1', 'A3'] }, ARC3('bc', 'as', 'be')],
  ['tangent arc-arc, centre on the other rim', { type: 'tangent', shapes: ['A1', 'A3'] }, ARC3('as', 'bs', 'be')],
  ['tangent arc-arc internal, a shared centre', { type: 'tangent', shapes: ['A1', 'A3'], branch: 'internal' }, ARC3('ac', 'bs', 'be')],
  ['equal arc-arc, a shared centre', { type: 'equal', shapes: ['A1', 'A3'] }, ARC3('ac', 'bs', 'be')],
  ['horizontal, one joint twice', { type: 'horizontal', joints: ['a', 'a'] }],
  ['vertical, one joint twice', { type: 'vertical', joints: ['a', 'a'] }],
  ['coincident, one joint twice', { type: 'coincident', joints: ['a', 'a'] }],
  ['distance (horizontal dimension), one joint twice', { type: 'distance', joints: ['a', 'a'], value: 0, dimMode: 'horizontal' }],
  ['distance (vertical dimension), one joint twice', { type: 'distance', joints: ['a', 'a'], value: 0, dimMode: 'vertical' }],
  ['midpoint, the midpoint is an end', { type: 'midpoint', joints: ['a', 'b', 'a'] }],
  ['midpoint, both ends one joint', { type: 'midpoint', joints: ['a', 'a', 'm'] }],
  ['collinear (joints), the point is the base start', { type: 'collinear', joints: ['a', 'b', 'a'] }],
  ['equal (joints), a shared end', { type: 'equal', joints: ['a', 'b', 'a', 'c'] }],
);
// Run every shared case and report ALL that differ before failing, so a regression names every row it breaks.
const sharedBad = [];
for (const [label, c, extra] of SHARED_CASES) {
  try { guard('shared joint: ' + label, c, extra); } catch (e) { sharedBad.push(e.message); }
  checked++;
}
assert.ok(sharedBad.length === 0, `${sharedBad.length} of ${SHARED_CASES.length} shared-joint rows differ from finite differences:\n  ` + sharedBad.join('\n  '));
// The BODY drag target (task 538): the mouse spring on the grabbed point of a shape, one declared BODY_POINTS entry per shape kind
// (line: a fraction t along it; circle / arc: the rim point on the target's ray from the centre, through the circle's radius unknown / the
// arc's live radius, so the centre columns carry the ray's turn too). A target ON the centre has no ray (the point falls back to the grab
// angle): not differentiable there, so not a case.
// Every kind needs a case; its rows are checked on every column like a constraint row, and the radius / rim column must be in them.
const BODY = (shape, param) => ({ type: 'mouse_spring', body: { shape, param }, value: [3, -2], stiffness: 1e4, joints: [] });
const BODY_CASES = [
  ['line', 'body point on a line, t = 0.3', BODY('L1', 0.3), [], ['a', 'b']],
  ['line', 'body point on a line, t = 0 (an end)', BODY('L1', 0), [], ['a']],
  ['line', 'body point on a line, t = 1 (an end)', BODY('L1', 1), [], ['b']],
  ['line', 'body point on a line whose two ends are one joint', BODY('LX', 0.4), LX('a', 'a'), ['a']],
  ['circle', 'body point on a circle rim, target off the centre', BODY('C1', 0.7), [], ['C1', 'm']],
  ['arc', 'body point on an arc rim, target off the centre', BODY('A1', 2.0), [], ['as', 'ac']],
  ['arc', 'body point on an arc whose centre is another arc rim', BODY('A3', -1.1), ARC3('as', 'bs', 'be'), ['bs', 'as']],
  // a temporary HOLD of the drag (engine.bodyDragTarget: the circle's / arc's centre held off its place): its rows are checked too
  ['circle', 'body point on a circle rim, centre held', { ...BODY('C1', 0.7), stiffness: 1, body: { shape: 'C1', param: 0.7, hold: [{ joint: 'm', x: 8, y: 9.5 }] } }, [], ['C1', 'm']],
  ['arc', 'body point on an arc rim, centre held', { ...BODY('A1', 2.0), stiffness: 1, body: { shape: 'A1', param: 2.0, hold: [{ joint: 'ac', x: -7, y: 3 }] } }, [], ['as', 'ac']],
];
for (const kind of Object.keys(BODY_POINTS)) assert.ok(BODY_CASES.some(b => b[0] === kind), `BODY_POINTS kind "${kind}" has no case in this guard: add one`);
for (const [, label, c, extra, uses] of BODY_CASES) {
  const col = guard('body drag: ' + label, c, extra);
  for (const id of uses) assert.ok(col[id] > 0.5, `body drag: ${label}: the ${id} column is ${col[id]} (expected it in the row)`);
  checked++;
}
// SYMMETRIC (task 563): every form (points 2 rows, lines 4, circles / arcs 3) about a sketch line and about each axis, both end pairings of two
// lines, and the patterns where a joint repeats inside the row (a point that is an end of the symmetry line, the same point twice, two lines
// sharing an end, two circles sharing a centre). The symmetry line's own ends are free here, so their columns must be in the rows (a free line
// can move); about an axis they are fixed (no column).
const SYM = (extra) => ({ type: 'symmetric', ...extra });
const SYMMETRIC_CASES = [
  ['points about a sketch line', SYM({ joints: ['m', 'n'], line: 'L1' }), [], false, 2, ['a', 'b', 'm', 'n']],
  ['points about the X axis', SYM({ joints: ['m', 'n'], line: 'ref_axis_x' }), [], true, 2, ['m', 'n']],
  ['points about the Y axis', SYM({ joints: ['c', 'd'], line: 'ref_axis_y' }), [], true, 2, ['c', 'd']],
  ['points, one is the symmetry line start', SYM({ joints: ['a', 'm'], line: 'L1' }), [], false, 2, ['a', 'b', 'm']],
  ['points, one is the symmetry line end', SYM({ joints: ['n', 'b'], line: 'L1' }), [], false, 2, ['a', 'b', 'n']],
  ['points, the same point twice', SYM({ joints: ['m', 'm'], line: 'L1' }), [], false, 2, ['a', 'b', 'm']],
  ['lines, straight end pairs', SYM({ joints: ['c', 'm', 'd', 'n'], shapes: ['L2', 'LX'], line: 'L1' }), LX('m', 'n'), false, 4, ['a', 'b', 'c', 'd', 'm', 'n']],
  ['lines, crossed end pairs', SYM({ joints: ['c', 'n', 'd', 'm'], shapes: ['L2', 'LX'], line: 'L1' }), LX('m', 'n'), false, 4, ['c', 'd', 'm', 'n']],
  ['lines sharing an end', SYM({ joints: ['c', 'ae', 'd', 'd'], shapes: ['L2', 'L3'], line: 'L1' }), [], false, 4, ['a', 'b', 'c', 'd', 'ae']],
  ['lines about the Y axis', SYM({ joints: ['c', 'm', 'd', 'n'], shapes: ['L2', 'LX'], line: 'ref_axis_y' }), LX('m', 'n'), true, 4, ['c', 'd', 'm', 'n']],
  ['circles about a sketch line', SYM({ shapes: ['C1', 'C2'], line: 'L1' }), [], false, 3, ['C1', 'C2', 'm', 'n', 'a', 'b']],
  ['circle and arc about a sketch line', SYM({ shapes: ['C1', 'A1'], line: 'L2' }), [], false, 3, ['C1', 'm', 'ac', 'as', 'c', 'd']],
  ['arc and arc about the X axis', SYM({ shapes: ['A1', 'A2'], line: 'ref_axis_x' }), [], true, 3, ['ac', 'as', 'bc', 'bs']],
  ['circles sharing a centre', SYM({ shapes: ['C1', 'A3'], line: 'L1' }), ARC3('m', 'bs', 'be'), false, 3, ['C1', 'm', 'bs']],
];
for (const [label, c, extra, scene, rows, uses] of SYMMETRIC_CASES) {
  const col = guard('symmetric: ' + label, c, extra, scene);
  const solver = createNewtonSolver(scene ? sceneJoints(withOrigin()) : joints(), [{ ...c }], scene ? sceneShapes([...SH(), ...extra]) : [...SH(), ...extra], { maxIter: 1 });
  assert.strictEqual(solver._assemble(solver._pack()).m, rows, `symmetric: ${label}: ${rows} rows`);
  for (const id of uses) assert.ok(col[id] > 1e-3, `symmetric: ${label}: the ${id} column is ${col[id]} (expected it in the rows)`);
  checked++;
}
console.log(`jacobian-fd-guard: ${checked} cases agree with finite differences (tol ${TOL}), circle radius and arc rim columns included, ${SHARED_CASES.length} of them with a joint shared inside the row.`);
