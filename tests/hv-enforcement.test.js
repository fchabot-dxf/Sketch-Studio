(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Vertical enforcement: after solve, x coordinates must match
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 10, y: 5, fixed: false });
    const constraints = [{ type: CONSTRAINT_TYPES.VERTICAL, joints: ['a','b'] }];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 30, tol: 1e-9 });
    const res = solver.solve(30);
    assert(res.converged, 'Vertical solver did not converge');
    const a = joints.get('a'), b = joints.get('b');
    assert(Math.abs(a.x - b.x) < 1e-6, `X coords not equal after vertical solve: ${a.x}, ${b.x}`);
  }

  // Horizontal enforcement: after solve, y coordinates must match
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 10, y: -5, fixed: false });
    const constraints = [{ type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a','b'] }];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 30, tol: 1e-9 });
    const res = solver.solve(30);
    assert(res.converged, 'Horizontal solver did not converge');
    const a = joints.get('a'), b = joints.get('b');
    assert(Math.abs(a.y - b.y) < 1e-6, `Y coords not equal after horizontal solve: ${a.y}, ${b.y}`);
  }

  console.log('H/V solver enforcement tests passed ✅');
})().catch(e => { console.error('H/V enforcement test failed ❌', e); process.exit(1); });