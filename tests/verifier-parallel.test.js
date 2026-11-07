import assert from 'node:assert';
import { measureResidual } from '#core/constraint-verifier.js';
import { Definitions } from '#core/solver/definitions.js';

console.log('Running tests for verifier PARALLEL vs the solver residual (cross(u,v))...');

// Solver residual: r = ux*vy - uy*vx = |u||v| sin(theta)  (definitions.js parallel). Zero iff theta == 0 (mod 180 deg).
// The verifier reports the same quantity as an ANGLE: asin(|sin theta|) (angular distance to the nearest parallel, in [0, 90 deg]).
function solverResidual(a, b, c, d) {
  const pos = [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];
  return Definitions.parallel.computeError({ joints: [0, 1, 2, 3] }, pos);
}
function verifierResidual(a, b, c, d) {
  const joints = new Map([['a', a], ['b', b], ['c', c], ['d', d]]);
  const shapes = [{ id: 's1', type: 'line', joints: ['a', 'b'] }, { id: 's2', type: 'line', joints: ['c', 'd'] }];
  return measureResidual({ type: 'parallel', shapes: ['s1', 's2'] }, joints, shapes);
}

// deterministic pseudo-random (LCG) so the check is reproducible
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pt = () => ({ x: (rnd() - 0.5) * 200, y: (rnd() - 0.5) * 200 });

// 1. Equivalence over random lines: verifier angle == asin(|r| / (|u||v|)); and zero exactly when the solver residual is zero
for (let i = 0; i < 3000; i++) {
  const a = pt(), b = pt(), c = pt(), d = pt();
  const u = Math.hypot(b.x - a.x, b.y - a.y), v = Math.hypot(d.x - c.x, d.y - c.y);
  if (u < 1e-6 || v < 1e-6) continue;
  const expected = Math.asin(Math.min(1, Math.abs(solverResidual(a, b, c, d)) / (u * v)));
  const got = verifierResidual(a, b, c, d);
  assert.ok(Math.abs(got - expected) < 1e-9, `random case ${i}: verifier ${got} vs solver-derived ${expected}`);
}
// 2. Exactly parallel in all four orientations (same / opposite direction, either order) are satisfied by both
for (const [vx, vy] of [[10, 0], [-10, 0], [3, 3], [-3, -3]]) {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, c = { x: 5, y: 7 };
  const aa = vx === 3 || vx === -3 ? { x: 0, y: 0 } : a; const bb = vx === 3 || vx === -3 ? { x: 4, y: 4 } : b;
  const d = { x: c.x + vx, y: c.y + vy };
  assert.ok(Math.abs(solverResidual(aa, bb, c, d)) < 1e-9 && verifierResidual(aa, bb, c, d) < 1e-9, 'parallel pair satisfied by both: ' + vx + ',' + vy);
}
// 3. DEGENERATE zero-length line: the solver residual is exactly 0 (cross with a zero vector); the verifier must not invent an angle
{
  const a = { x: 3, y: 3 }, b = { x: 3, y: 3 }, c = { x: 0, y: 0 }, d = { x: 5, y: 9 };
  assert.strictEqual(solverResidual(a, b, c, d), 0, 'solver residual with a zero-length line is 0');
  assert.strictEqual(verifierResidual(a, b, c, d), 0, 'verifier must also read a zero-length line as 0 (angle undefined), not atan2(0,0)=0 vs the other line');
}
console.log('verifier PARALLEL tests passed.');
