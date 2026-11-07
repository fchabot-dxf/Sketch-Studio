// Regression tests for solver stall honesty (TASK 411, step 1 — additive fields).
//
// NewtonSolver.solve() and the constraint-solver wrapper must surface:
//   - stalled (boolean): true iff the LM loop exited via maxStep < tol with finalError > tol
//   - stallError (number | undefined): finalError when stalled, omitted otherwise
//   - structuralError (number): residual norm over all non-mouse_spring rows (equals finalError when no spring)
//   - dragReached (boolean | undefined): when a drag / mouse_spring is present, true iff spring residual norm < 1e-3
(async () => {
  const { createEngine } = await import('#core/constraint-solver.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const TOL = 1e-6;

  // ---- (a) Normal solvable sketch: stalled === false, structuralError ~ 0 ----
  {
    const joints = new Map([
      ['j_origin', { x: 0, y: 0, fixed: true }],
      ['a', { x: 3, y: 4, fixed: false }],
    ]);
    const constraints = [
      { id: 'c_h', type: 'horizontal', joints: ['j_origin', 'a'] },
      { id: 'c_d', type: 'distance', joints: ['j_origin', 'a'], value: 10 },
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 100, tol: TOL });
    const res = solver.solve(100);
    console.log('[a / engine]', JSON.stringify(res));

    assert(res.stalled === false, `a (engine): expected stalled === false, got ${res.stalled}`);
    assert(!('stallError' in res) || res.stallError === undefined, `a (engine): stallError must be omitted when not stalled, got ${res.stallError}`);
    assert(typeof res.structuralError === 'number' && res.structuralError < TOL, `a (engine): expected structuralError < ${TOL}, got ${res.structuralError}`);
    assert(res.structuralError === res.error, `a (engine): structuralError (${res.structuralError}) must equal error (${res.error}) when no spring`);
    assert(!('dragReached' in res) || res.dragReached === undefined, `a (engine): dragReached must be omitted when no spring, got ${res.dragReached}`);

    // Wrapper pass-through check
    const eng = createEngine(null);
    eng.init();
    eng.addJoint('a', 3, 4, false);
    eng.addConstraint({ id: 'c_h', type: 'horizontal', joints: ['j_origin', 'a'] });
    eng.addConstraint({ id: 'c_d', type: 'distance', joints: ['j_origin', 'a'], value: 10 });
    const wRes = eng.solve(100);
    assert(wRes.stalled === false, `a (wrapper): expected stalled === false, got ${wRes.stalled}`);
    assert(typeof wRes.structuralError === 'number' && wRes.structuralError < TOL, `a (wrapper): expected structuralError < ${TOL}, got ${wRes.structuralError}`);
    assert(!('dragReached' in wRes) || wRes.dragReached === undefined, `a (wrapper): dragReached must be omitted when no spring`);
  }

  // ---- (b) Over-constrained pinned conflict: stalled === true, stallError > tol ----
  // Note: if EVERY joint in the sketch is fixed (x0.length === 0), solve() exits early
  // at the zero-DOF guard before entering the LM loop (converged:false, stalled:false).
  // When a joint is pinned by conflicting constraints against fixed anchors (or two fixed
  // points hold a joint with impossible distances 3 + 3 across a 10 span), LM enters the
  // loop, settles at the least-squares compromise (5,0), and exits via maxStep < tol with
  // finalError = hypot(2, 2) ~ 2.828 > tol -> stalled === true, stallError > tol.
  {
    const joints = new Map([
      ['j_origin', { x: 0, y: 0, fixed: true }],
      ['b', { x: 10, y: 0, fixed: true }],
      ['p', { x: 4, y: 1, fixed: false }],
    ]);
    const constraints = [
      { id: 'c_d1', type: 'distance', joints: ['j_origin', 'p'], value: 3 },
      { id: 'c_d2', type: 'distance', joints: ['b', 'p'], value: 3 },
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 200, tol: TOL });
    const res = solver.solve(200);
    console.log('[b / engine]', JSON.stringify(res));

    assert(res.stalled === true, `b (engine): expected stalled === true on LM step-convergence stall, got ${res.stalled}`);
    assert(typeof res.stallError === 'number' && res.stallError > TOL, `b (engine): expected stallError > ${TOL}, got ${res.stallError}`);
    assert(Math.abs(res.stallError - res.error) < 1e-12, `b (engine): stallError (${res.stallError}) must equal finalError (${res.error})`);
    assert(res.structuralError === res.error, `b (engine): structuralError (${res.structuralError}) must equal error (${res.error}) when no spring`);
    assert(!('dragReached' in res) || res.dragReached === undefined, `b (engine): dragReached must be omitted when no spring`);

    // Wrapper pass-through check on the same conflict
    const eng = createEngine(null);
    eng.init();
    eng.addJoint('b', 10, 0, true);
    eng.addJoint('p', 4, 1, false);
    eng.addConstraint({ id: 'c_d1', type: 'distance', joints: ['j_origin', 'p'], value: 3 });
    eng.addConstraint({ id: 'c_d2', type: 'distance', joints: ['b', 'p'], value: 3 });
    const wRes = eng.solve(200);
    assert(wRes.stalled === true, `b (wrapper): expected stalled === true passed through wrapper, got ${wRes.stalled}`);
    assert(typeof wRes.stallError === 'number' && wRes.stallError > TOL, `b (wrapper): expected stallError > ${TOL}, got ${wRes.stallError}`);
    assert(typeof wRes.structuralError === 'number' && wRes.structuralError > TOL, `b (wrapper): expected structuralError > ${TOL}, got ${wRes.structuralError}`);
  }

  // ---- (c) Drag of a point that is fully pinned: dragReached === false while structuralError ~ 0 ----
  {
    // (c1) Point p is a solver variable (fixed:false) fully pinned at (10,0) by horizontal + distance=10
    // to fixed j_origin. Dragging p to (50,50) cannot move p to the target: dragReached === false,
    // while the structural constraints remain satisfied (structuralError ~ 0).
    const joints = new Map([
      ['j_origin', { x: 0, y: 0, fixed: true }],
      ['p', { x: 10, y: 0, fixed: false }],
    ]);
    const constraints = [
      { id: 'c_h', type: 'horizontal', joints: ['j_origin', 'p'] },
      { id: 'c_d', type: 'distance', joints: ['j_origin', 'p'], value: 10 },
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 200, tol: TOL });
    const res = solver.solve(200, { dragTarget: { jointId: 'p', x: 50, y: 50, stiffness: 1e4 } });
    console.log('[c1 / engine]', JSON.stringify(res));

    assert(res.dragReached === false, `c1 (engine): expected dragReached === false for pinned point drag, got ${res.dragReached}`);
    assert(typeof res.structuralError === 'number' && res.structuralError < 1e-3, `c1 (engine): expected structuralError ~ 0 (< 1e-3), got ${res.structuralError}`);

    // Wrapper pass-through check for (c1)
    const eng = createEngine(null);
    eng.init();
    eng.addJoint('p', 10, 0, false);
    eng.addConstraint({ id: 'c_h', type: 'horizontal', joints: ['j_origin', 'p'] });
    eng.addConstraint({ id: 'c_d', type: 'distance', joints: ['j_origin', 'p'], value: 10 });
    const wRes = eng.solve(200, { dragTarget: { jointId: 'p', x: 50, y: 50, stiffness: 1e4 } });
    assert(wRes.dragReached === false, `c1 (wrapper): expected dragReached === false passed through wrapper, got ${wRes.dragReached}`);
    assert(typeof wRes.structuralError === 'number' && wRes.structuralError < 1e-3, `c1 (wrapper): expected structuralError ~ 0 (< 1e-3), got ${wRes.structuralError}`);

    // (c2) Point b welded to fixed j_origin via coincident (x0.length === 0 path):
    // dragging b to (100,0) also reports dragReached === false and structuralError === 0.
    const joints2 = new Map([
      ['j_origin', { x: 0, y: 0, fixed: true }],
      ['b', { x: 0, y: 0, fixed: false }],
    ]);
    const constraints2 = [{ id: 'c_coin', type: 'coincident', joints: ['j_origin', 'b'] }];
    const solver2 = createNewtonSolver(joints2, constraints2, [], { maxIter: 50, tol: TOL });
    const res2 = solver2.solve(50, { dragTarget: { jointId: 'b', x: 100, y: 0, stiffness: 1e8 } });
    console.log('[c2 / engine]', JSON.stringify(res2));

    assert(res2.dragReached === false, `c2 (engine): expected dragReached === false on welded-to-origin drag, got ${res2.dragReached}`);
    assert(typeof res2.structuralError === 'number' && res2.structuralError < TOL, `c2 (engine): expected structuralError ~ 0, got ${res2.structuralError}`);

    // (c3) Contrast: a free point dragged to target reports dragReached === true and structuralError === 0.
    const joints3 = new Map([['a', { x: 0, y: 0, fixed: false }]]);
    const solver3 = createNewtonSolver(joints3, [], [], { maxIter: 50, tol: TOL });
    const res3 = solver3.solve(50, { dragTarget: { jointId: 'a', x: 25, y: -15, stiffness: 1e4 } });
    assert(res3.dragReached === true, `c3 (engine): expected dragReached === true for unconstrained drag, got ${res3.dragReached}`);
    assert(res3.structuralError === 0, `c3 (engine): expected structuralError === 0, got ${res3.structuralError}`);
  }

  console.log('solver-stall-honesty tests passed ✅');
})().catch(e => { console.error('solver-stall-honesty tests failed ❌', e && e.message ? e.message : e); process.exit(1); });
