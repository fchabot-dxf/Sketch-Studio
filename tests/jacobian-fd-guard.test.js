import assert from 'node:assert';
import { Definitions } from '#core/solver/definitions.js';
import { createNewtonSolver } from '#core/solver/engine.js';

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
]);
// C1 / C2 are circles: their radius is a solver unknown (task 515), the LAST columns of x. A1 is an arc (radius live via its rims).
const SH = () => [
  { id: 'L1', type: 'line', joints: ['a', 'b'] },
  { id: 'L2', type: 'line', joints: ['c', 'd'] },
  { id: 'C1', type: 'circle', joints: ['m'], radius: 2 },
  { id: 'C2', type: 'circle', joints: ['n'], radius: 3.5 },
  { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'] },
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
};

// One case: analytic J vs central finite differences on EVERY column of x (joint x/y and circle radius). Returns the J columns of
// the circle radii so a radius case can also assert its radius column is really in the row.
function guard(label, c) {
  const solver = createNewtonSolver(joints(), [{ ...c }], SH(), { maxIter: 1 });
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
  solver._radiusShapes.forEach((s, q) => { let v = 0; for (let i = 0; i < asm.m; i++) v = Math.max(v, Math.abs(asm.J[i * n + solver._nJointVars + q])); radiusCol[s.id] = v; });
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
];
for (const [label, c, uses] of RADIUS_CASES) {
  const col = guard(label, c);
  for (const id of uses) assert.ok(col[id] > 0.5, `${label}: the ${id} radius column is ${col[id]} (expected it in the row)`);
  checked++;
}
console.log(`jacobian-fd-guard: ${checked} cases agree with finite differences (tol ${TOL}), circle radius columns included.`);
