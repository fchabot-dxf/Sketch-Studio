import assert from 'node:assert';
import { measureResidual } from '#core/constraint-verifier.js';
import { createEngine } from '#core/constraint-solver.js';

console.log('Running tests for verifier PERPENDICULAR (respects c.branch: zero iff theta == branch*90 deg)...');
const DEG = Math.PI / 180;
// u = (1,0) ; v rotated by `deg` from u (theta = signed angle u -> v)
function lines(deg) {
  const joints = new Map([
    ['a', { x: 0, y: 0 }], ['b', { x: 10, y: 0 }],
    ['c', { x: 0, y: 0 }], ['d', { x: 10 * Math.cos(deg * DEG), y: 10 * Math.sin(deg * DEG) }],
  ]);
  const shapes = [{ id: 's1', type: 'line', joints: ['a', 'b'] }, { id: 's2', type: 'line', joints: ['c', 'd'] }];
  return { joints, shapes };
}
const perp = (branch) => ({ type: 'perpendicular', shapes: ['s1', 's2'], ...(branch ? { branch } : {}) });

// unbranched: either +90 or -90 satisfies (solver residual u.v), anything else measures its angular distance
{
  for (const deg of [90, -90, 270]) { const { joints, shapes } = lines(deg); assert.ok(measureResidual(perp(), joints, shapes) < 1e-9, 'unbranched ' + deg); }
  const { joints, shapes } = lines(60);
  assert.ok(Math.abs(measureResidual(perp(), joints, shapes) - 30 * DEG) < 1e-6, 'unbranched at 60 deg measures 30 deg');
}
// branched: only the chosen handedness is satisfied (solver residual u x v - branch |u||v|)
{
  const plus = lines(90), minus = lines(-90);
  assert.ok(measureResidual(perp(1), plus.joints, plus.shapes) < 1e-9, 'branch +1 at +90 satisfied');
  assert.ok(measureResidual(perp(-1), minus.joints, minus.shapes) < 1e-9, 'branch -1 at -90 satisfied');
  const wrong = measureResidual(perp(-1), plus.joints, plus.shapes);
  assert.ok(Math.abs(wrong - Math.PI) < 1e-6, 'branch -1 at +90 is the wrong half-plane: measures 180 deg, got ' + wrong);
  const off = lines(60);
  assert.ok(Math.abs(measureResidual(perp(1), off.joints, off.shapes) - 30 * DEG) < 1e-6, 'branch +1 at 60 deg measures 30 deg');
}
// engine level: pinned at +90 but locked to -1 cannot be satisfied and must NOT read as converged
for (const [branch, deg, expectConverged] of [[-1, 90, false], [1, 90, true], [1, -90, false], [-1, -90, true]]) {
  const engine = createEngine(null); engine.init();
  const mk = (x, y) => { const id = engine.genJ(); engine.addJoint(id, x, y, true); return id; };
  const a = mk(0, 0), b = mk(10, 0), c = mk(0, 0), d = mk(10 * Math.cos(deg * DEG), 10 * Math.sin(deg * DEG));
  engine.addShape({ id: 's1', type: 'line', joints: [a, b] }); engine.addShape({ id: 's2', type: 'line', joints: [c, d] });
  engine.addConstraint({ type: 'perpendicular', shapes: ['s1', 's2'], branch });
  const r = engine.solve(100);
  assert.strictEqual(r.converged, expectConverged, `pinned at ${deg} locked to ${branch}: converged should be ${expectConverged}`);
}
console.log('verifier PERPENDICULAR branch tests passed.');
