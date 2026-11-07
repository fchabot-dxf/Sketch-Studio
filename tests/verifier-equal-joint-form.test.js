import assert from 'node:assert';
import { measureResidual } from '#core/constraint-verifier.js';
import { createEngine } from '#core/constraint-solver.js';

console.log('Running tests for verifier EQUAL joint form ([a,b,c,d] -> |ab| - |cd|)...');

// pure: residual = | |ab| - |cd| |, the same as the solver row (definitions.js equal, joints >= 4)
{
  const joints = new Map([['a', { x: 0, y: 0 }], ['b', { x: 3, y: 4 }], ['c', { x: 10, y: 10 }], ['d', { x: 10, y: 17 }]]);
  const eq = { type: 'equal', joints: ['a', 'b', 'c', 'd'] }; // |ab| = 5, |cd| = 7
  assert.ok(Math.abs(measureResidual(eq, joints, []) - 2) < 1e-9, 'unequal pairs must measure 2, got ' + measureResidual(eq, joints, []));
  joints.get('d').y = 15; // |cd| = 5
  assert.ok(measureResidual(eq, joints, []) < 1e-9, 'equal pairs measure 0');
}

// engine level: an arc's own `equal` (makeArc) that the solver cannot satisfy must NOT read as converged
{
  const engine = createEngine(null); engine.init();
  const c = engine.genJ(); engine.addJoint(c, 0, 0, true);
  const p2 = engine.genJ(); engine.addJoint(p2, 10, 0, true);   // radius 10, pinned
  const p3 = engine.genJ(); engine.addJoint(p3, 0, 14, true);   // radius 14, pinned: cannot be equal
  engine.addShape({ id: 'arc1', type: 'arc', subType: 'CENTER', joints: [c, p2, p3] });
  engine.addConstraint({ type: 'equal', joints: [c, p2, c, p3] });
  const r = engine.solve(200);
  assert.strictEqual(r.converged, false, 'an unsatisfiable arc equal must not read as converged (was: silently converged)');
  assert.ok(Math.abs(r.error - 4) < 1e-3, 'residual should be 4, got ' + r.error);
}
console.log('verifier EQUAL joint-form tests passed.');
