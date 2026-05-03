(async () => {
  const { solveConstraints } = await import('../src/solver-core.js');
  const { createNewtonSolver } = await import('../src/core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Simple two-joint distance constraint scenario
  const makeState = () => {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 20, y: 0, fixed: false });
    const shapes = [];
    const constraints = [{ type: 'distance', joints: ['a','b'], value: 10 }];
    return { joints, shapes, constraints };
  };

  const s1 = makeState();
  // Run legacy façade (now delegates to Newton)
  const resFacade = solveConstraints(s1.joints, s1.shapes, s1.constraints, 20);
  assert(resFacade && typeof resFacade.converged === 'boolean', 'solveConstraints should return Newton-like result');

  // Distance should be satisfied to within solver tolerance
  const ja = s1.joints.get('a'), jb = s1.joints.get('b');
  const dist = Math.hypot(jb.x - ja.x, jb.y - ja.y);
  assert(Math.abs(dist - 10) < 1e-4, `Facade must satisfy distance; got ${dist}`);

  // Run Newton solver directly on a fresh copy and compare results
  const s2 = makeState();
  const engine = createNewtonSolver(s2.joints, s2.constraints, s2.shapes, { maxIter: 20, tol: 1e-8 });
  const resEngine = engine.solve(20);
  assert(resEngine.converged === true || resFacade.converged === resEngine.converged, 'convergence should match or both be boolean');

  const ja2 = s2.joints.get('a'), jb2 = s2.joints.get('b');
  const dist2 = Math.hypot(jb2.x - ja2.x, jb2.y - ja2.y);
  assert(Math.abs(dist2 - 10) < 1e-6, `Direct Newton must satisfy distance tightly; got ${dist2}`);

  // Compare facade result to direct result (positions within tolerance)
  assert(Math.abs(ja.x - ja2.x) < 1e-3 && Math.abs(jb.x - jb2.x) < 1e-3, 'Facade and direct Newton positions should be nearly identical');

  console.log('solver-core now delegates to Newton — regression test passed ✅');
})().catch(e => { console.error('solver-core delegation test failed ❌', e); process.exit(1); });