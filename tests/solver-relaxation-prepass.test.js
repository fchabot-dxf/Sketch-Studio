(async () => {
  const { createNewtonSolver } = await import('../src/core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Helper: build a triangle with three distance constraints, joints placed far
  // from the target side lengths so the initial residual is huge.
  function buildTriangle() {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });           // pin one vertex
    joints.set('b', { x: 200, y: 0, fixed: false });         // far from target |ab|=10
    joints.set('c', { x: 0, y: 200, fixed: false });         // far from target |ac|=10
    const shapes = [];
    const constraints = [
      { type: 'distance', joints: ['a', 'b'], value: 10 },
      { type: 'distance', joints: ['a', 'c'], value: 10 },
      { type: 'distance', joints: ['b', 'c'], value: 10 }   // forces equilateral
    ];
    return { joints, shapes, constraints };
  }

  // Test 1: pre-pass reduces residual on a far-from-solution start
  {
    const { joints, shapes, constraints } = buildTriangle();
    const solver = createNewtonSolver(joints, constraints, shapes, {
      maxIter: 0,                  // disable LM so we measure pre-pass alone
      prepassEnabled: true,
      prepassIters: 10,
      prepassResidualSkip: 0,      // force pre-pass to run regardless
      prepassHandoffResidual: 0    // do not hand off early
    });
    const result = solver.solve();
    // Each side should now be much closer to 10 than the original ~200
    const ab = Math.hypot(joints.get('b').x - joints.get('a').x, joints.get('b').y - joints.get('a').y);
    const ac = Math.hypot(joints.get('c').x - joints.get('a').x, joints.get('c').y - joints.get('a').y);
    assert(ab < 200 && ac < 200, `pre-pass made no progress: ab=${ab}, ac=${ac}`);
    assert(result.error < 200, `pre-pass left residual at ${result.error}, expected < 200`);
  }

  // Test 2: pre-pass + LM converges on a hard start where LM alone may struggle
  {
    const { joints, shapes, constraints } = buildTriangle();
    const solver = createNewtonSolver(joints, constraints, shapes, {
      maxIter: 50,
      tol: 1e-6,
      prepassEnabled: true
    });
    const result = solver.solve();
    assert(result.converged, `combined solver did not converge: error=${result.error}`);
    const ab = Math.hypot(joints.get('b').x - joints.get('a').x, joints.get('b').y - joints.get('a').y);
    const ac = Math.hypot(joints.get('c').x - joints.get('a').x, joints.get('c').y - joints.get('a').y);
    const bc = Math.hypot(joints.get('c').x - joints.get('b').x, joints.get('c').y - joints.get('b').y);
    assert(Math.abs(ab - 10) < 1e-3, `|ab|=${ab}, expected 10`);
    assert(Math.abs(ac - 10) < 1e-3, `|ac|=${ac}, expected 10`);
    assert(Math.abs(bc - 10) < 1e-3, `|bc|=${bc}, expected 10`);
  }

  // Test 3: pre-pass disabled — LM alone still works on a near-solution start
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 9.5, y: 0, fixed: false });
    const constraints = [{ type: 'distance', joints: ['a', 'b'], value: 10 }];
    const solver = createNewtonSolver(joints, constraints, [], {
      maxIter: 50,
      tol: 1e-6,
      prepassEnabled: false
    });
    const result = solver.solve();
    assert(result.converged, `LM-only solver did not converge: error=${result.error}`);
    const ab = Math.hypot(joints.get('b').x - joints.get('a').x, joints.get('b').y - joints.get('a').y);
    assert(Math.abs(ab - 10) < 1e-3, `|ab|=${ab}, expected 10`);
  }

  // Test 4: pre-pass is skipped when initial residual is already small
  // (regression check — we should not touch positions if no work is needed).
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 0, y: 0, fixed: false });
    const constraints = [{ type: 'coincident', joints: ['a', 'b'] }];
    const solver = createNewtonSolver(joints, constraints, [], {
      maxIter: 50,
      tol: 1e-6,
      prepassEnabled: true
    });
    const result = solver.solve();
    assert(result.converged, 'already-satisfied sketch did not report converged');
    assert(joints.get('a').x === 0 && joints.get('a').y === 0, 'joint a moved when it should not have');
    assert(joints.get('b').x === 0 && joints.get('b').y === 0, 'joint b moved when it should not have');
  }

  console.log('solver-relaxation-prepass tests passed ✅');
})().catch(e => { console.error('solver-relaxation-prepass tests failed ❌', e); process.exit(1); });
