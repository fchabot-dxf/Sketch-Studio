(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Test 1: free joint with no constraints → 2 unknowns, 0 equations → rank-deficient
  {
    const joints = new Map();
    joints.set('a', { x: 5, y: 5, fixed: false });
    const solver = createNewtonSolver(joints, [], [], { maxIter: 10 });
    const result = solver.solve();
    assert(result.rankDeficient === true, `expected rankDeficient=true for unconstrained joint, got ${result.rankDeficient}`);
  }

  // Test 2: one free joint with a single distance to a fixed origin.
  // 1 equation in 2 unknowns — there's a circle of valid positions.
  // Rank(J) = 1 < n = 2 → under-constrained. Solver still converges.
  {
    const joints = new Map();
    joints.set('o', { x: 0, y: 0, fixed: true });
    joints.set('a', { x: 3, y: 0, fixed: false });
    const constraints = [{ type: 'distance', joints: ['o', 'a'], value: 5 }];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 50, tol: 1e-6 });
    const result = solver.solve();
    assert(result.converged, `solver should converge along the circle, got error=${result.error}`);
    assert(result.rankDeficient === true, `1-distance / 2-DOF should report rankDeficient, got ${result.rankDeficient}`);
    const a = joints.get('a');
    const d = Math.hypot(a.x, a.y);
    assert(Math.abs(d - 5) < 1e-3, `joint should land on circle r=5, got d=${d}`);
  }

  // Test 3: well-constrained system — two distances pin the joint.
  {
    const joints = new Map();
    joints.set('p1', { x: 0, y: 0, fixed: true });
    joints.set('p2', { x: 10, y: 0, fixed: true });
    joints.set('a',  { x: 5, y: 5, fixed: false });
    const constraints = [
      { type: 'distance', joints: ['p1', 'a'], value: 5 },
      { type: 'distance', joints: ['p2', 'a'], value: 5 }
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 50, tol: 1e-4 });
    const result = solver.solve();
    assert(result.error < 1e-3, `solver should reach low residual, got error=${result.error}`);
    assert(result.rankDeficient === false, `well-constrained intersection should NOT be rankDeficient, got ${result.rankDeficient}`);
  }

  // Test 4: rank-deficient *and* badly initialized — pre-pass converges early,
  // and the early-return path still reports rankDeficient.
  {
    const joints = new Map();
    joints.set('o', { x: 0, y: 0, fixed: true });
    joints.set('a', { x: 100, y: 100, fixed: false }); // far from circle r=5
    const constraints = [{ type: 'distance', joints: ['o', 'a'], value: 5 }];
    const solver = createNewtonSolver(joints, constraints, [], {
      maxIter: 50, tol: 1e-6,
      prepassEnabled: true,
      prepassResidualSkip: 0,    // force pre-pass to run
      prepassHandoffResidual: 1e-9 // never hand off — let pre-pass hit tol
    });
    const result = solver.solve();
    assert(result.rankDeficient === true,
      `pre-pass early-return path should also report rankDeficient, got ${result.rankDeficient}`);
  }

  console.log('solver-rank-deficiency tests passed ✅');
})().catch(e => { console.error('solver-rank-deficiency tests failed ❌', e); process.exit(1); });
