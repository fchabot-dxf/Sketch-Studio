import assert from 'node:assert';
import { Definitions } from '#core/solver/definitions.js';
import { measureResidual } from '#core/constraint-verifier.js';

// GUARD: every constraint the SOLVER can build (a key of solver Definitions) must have a verifier case, or
// `default: return 0` silently reports it as always-satisfied (the class of bug found for EQUAL joint form, ANGLE,
// line-line DISTANCE). For each key we hand the verifier a deliberately VIOLATED instance and require residual > 0.
// A new Definitions key fails here until it gets a verifier case (or is listed in EXEMPT with a reason).
console.log('Running guard: every solver Definitions key has a verifier case...');

const EXEMPT = {
  mouse_spring: 'transient drag spring added by InteractionSolver during a drag; never a persisted constraint',
  mouseSpring: 'camelCase alias of mouse_spring',
};
// definitions.js key -> the constraint `type` string the app stores (camelCase alias for pointOnLine)
const TYPE_OF = { point_on_line: 'pointOnLine', pointOnLine: 'pointOnLine' };

const J = () => new Map([
  ['a', { x: 0, y: 0 }], ['b', { x: 10, y: 3 }], ['c', { x: 0, y: 10 }], ['d', { x: 7, y: 14 }], ['m', { x: 9, y: 9 }],
]);
const SH = [
  { id: 'L1', type: 'line', joints: ['a', 'b'] },
  { id: 'L2', type: 'line', joints: ['c', 'd'] },
  { id: 'C1', type: 'circle', joints: ['m'], radius: 2 },
];
// a violated instance per type (geometry above: L1 is not horizontal/vertical, L1 and L2 are neither parallel nor perpendicular
// nor collinear, 'm' is nowhere near L1 or the midpoint of a-b, |ab| != 5, tangent distance != radius)
const VIOLATED = {
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
  symmetric: { type: 'symmetric', joints: ['a', 'm'], line: 'L2' },
};

let checked = 0;
for (const key of Object.keys(Definitions)) {
  if (EXEMPT[key]) continue;
  const type = TYPE_OF[key] || key;
  const c = VIOLATED[type];
  assert.ok(c, `Definitions key "${key}" has no violated-instance entry in this guard: add one (and a verifier case), or list it in EXEMPT with a reason`);
  const r = measureResidual(c, J(), SH);
  assert.ok(r > 1e-6, `verifier measures "${key}" as satisfied (residual ${r}) on a violated instance -- missing/zero verifier case`);
  checked++;
}
assert.ok(checked >= 12, 'guard should have checked every real constraint type, checked ' + checked);
console.log(`verifier covers all ${checked} solver constraint types (exempt: ${Object.keys(EXEMPT).join(', ')}).`);
