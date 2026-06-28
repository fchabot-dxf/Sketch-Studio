(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Construct a system that used to produce duplicate columns when coincident joints
  // were treated independently. a and b are coincident and both constrained to c by distance.
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: false });
  joints.set('b', { x: 0, y: 0, fixed: false });
  joints.set('c', { x: 3, y: 0, fixed: false });

  const constraints = [
    { type: 'coincident', joints: ['a','b'] },
    { type: 'distance', joints: ['a','c'], value: 3 },
    { type: 'distance', joints: ['b','c'], value: 3 }
  ];

  const solver = createNewtonSolver(joints, constraints, [], { maxIter: 50, verbose: false });
  const out = solver.solve(50);

  // Solver should complete (no singular matrix hang) and produce a small error
  assert(out && typeof out.converged === 'boolean', 'solver returned malformed result');
  assert(out.converged === true || out.error < 1e-6, 'solver did not converge / produced large error after grouping coincident joints');

  console.log('solver-cholesky-coincident tests passed ✅');
})().catch(e => { console.error('solver-cholesky-coincident tests failed ❌', e); process.exit(1); });