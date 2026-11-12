import assert from 'node:assert';
import { Definitions } from '#core/solver/definitions.js';
import { createNewtonSolver } from '#core/solver/engine.js';

// GUARD (task 511, audit F6): the DOF / redundancy analysis (engine.jointFreedom, rankRowRedundant) reads the nullspace of the
// analysis Jacobian, _assemble(x, { analysis: true }). For EVERY constraint type in Definitions that Jacobian must equal a central
// finite difference of the residual on EVERY free column (point AND line endpoints), or the nullity lies about freedom.
// (The solver's own step may keep a one-sided row, e.g. point_on_line; that is not what the nullity reads.)
// Tolerance: max |analytic - finite difference| < TOL per entry.
const TOL = 1e-4, EPS = 1e-6;
const EXEMPT = { mouse_spring: 'transient drag spring, never analysed', mouseSpring: 'alias of mouse_spring' };
const TYPE_OF = { point_on_line: 'pointOnLine', pointOnLine: 'pointOnLine' };

const joints = () => new Map([
  ['a', { x: 0, y: 0, fixed: false }], ['b', { x: 10, y: 3, fixed: false }], ['c', { x: 0, y: 10, fixed: false }],
  ['d', { x: 7, y: 14, fixed: false }], ['m', { x: 9, y: 9, fixed: false }],
]);
const SH = () => [
  { id: 'L1', type: 'line', joints: ['a', 'b'] },
  { id: 'L2', type: 'line', joints: ['c', 'd'] },
  { id: 'C1', type: 'circle', joints: ['m'], radius: 2 },
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

let checked = 0;
for (const key of Object.keys(Definitions)) {
  if (EXEMPT[key]) continue;
  const type = TYPE_OF[key] || key;
  const c = CASES[type];
  assert.ok(c, `Definitions key "${key}" has no case in this guard: add one or EXEMPT it with a reason`);
  const solver = createNewtonSolver(joints(), [{ ...c }], SH(), { maxIter: 1 });
  const x0 = solver._pack(), n = x0.length;
  const asm = solver._assemble(x0, { analysis: true });
  let worst = 0;
  for (let k = 0; k < n; k++) {
    const xp = Float64Array.from(x0), xm = Float64Array.from(x0); xp[k] += EPS; xm[k] -= EPS;
    const rp = solver._assemble(xp).r, rm = solver._assemble(xm).r;
    for (let i = 0; i < asm.m; i++) worst = Math.max(worst, Math.abs((rp[i] - rm[i]) / (2 * EPS) - asm.J[i * n + k]));
  }
  assert.ok(asm.m > 0, `${key}: built no rows`);
  assert.ok(worst < TOL, `${key}: analysis Jacobian differs from finite differences by ${worst} (tolerance ${TOL})`);
  console.log(`ok ${key} (rows ${asm.m}, max diff ${worst.toExponential(1)})`);
  checked++;
}
assert.ok(checked >= 12, 'checked ' + checked);
console.log(`jacobian-fd-guard: ${checked} constraint types agree with finite differences (tol ${TOL}).`);
