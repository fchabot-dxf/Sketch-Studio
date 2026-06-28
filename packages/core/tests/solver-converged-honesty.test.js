// Regression test for the "converged-but-lying" defect (Blocker 1).
//
// The solver must NOT report converged:true while a constraint is unsatisfied.
// Two modes, both empirically reproduced during diagnosis:
//   A) coincident-with-fixed DOF-strip: a joint welded to a fixed anchor loses
//      all degrees of freedom (x0.length===0), so a further unsatisfiable
//      constraint on it was silently dropped by the engine's early-return.
//   B) conflicting constraints: parallel + angle(30) on the same two lines settle
//      to a least-squares compromise satisfying NEITHER, yet reported success.
//
// Definition of done: both modes -> converged:false + a non-empty conflict list,
// and result.error == max geometric residual.
(async () => {
  const { createEngine } = await import('#core/constraint-solver.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const TOL = 0.001; // SolverConfig.VERIFIER_TOLERANCE

  // ---- Mode A (wrapper): coincident-with-fixed, then an unsatisfiable distance ----
  {
    const eng = createEngine(null);
    eng.init();                                   // adds fixed j_origin at (0,0)
    eng.addJoint('a', 3, 0, false);
    eng.addConstraint({ id: 'c_coin', type: 'coincident', joints: ['a', 'j_origin'] });
    eng.addConstraint({ id: 'c_dist', type: 'distance', joints: ['a', 'j_origin'], value: 5 });

    const res = eng.solve(100);
    console.log('[Mode A] ', JSON.stringify({ converged: res.converged, error: res.error, conflicts: (res.conflicts || []).map(c => c.id) }));

    assert(res.converged === false, 'Mode A: must report converged:false (distance 5 is unsatisfiable once `a` is welded to the fixed origin)');
    assert(Array.isArray(res.conflicts) && res.conflicts.length >= 1, 'Mode A: must surface a non-empty conflict list');
    assert(res.conflicts.some(c => c.id === 'c_dist'), 'Mode A: the distance constraint must be reported as a conflict');
    const maxResid = Math.max(...res.conflicts.map(c => c.residual));
    assert(Math.abs(res.error - maxResid) < 1e-9, 'Mode A: error must equal the max geometric residual');
    assert(res.error >= 5 - 1e-6, 'Mode A: max residual should be ~5 (distance target 5 vs actual 0)');
  }

  // ---- Mode A (engine guard): same case directly against the engine ----
  {
    const joints = new Map();
    joints.set('j_origin', { x: 0, y: 0, fixed: true });
    joints.set('a', { x: 3, y: 0, fixed: false });
    const constraints = [
      { id: 'c_coin', type: 'coincident', joints: ['a', 'j_origin'] },
      { id: 'c_dist', type: 'distance', joints: ['a', 'j_origin'], value: 5 },
    ];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 100 });
    const res = solver.solve(100);
    console.log('[Mode A / engine] ', JSON.stringify(res));
    assert(res.converged === false, 'engine x0.length===0 guard: must not claim converged when constraints are violated with zero free DOF');
    assert(res.error >= 5 - 1e-6, 'engine guard: error should report the ~5 residual, not 0');
  }

  // ---- Mode B (wrapper): conflicting parallel + angle(30) ----
  {
    const eng = createEngine(null);
    eng.init();
    eng.addJoint('a', 10, 0, true);    // line1 = origin->a, fixed horizontal
    eng.addJoint('c', 0, 5, false);
    eng.addJoint('d', 10, 5, false);   // line2 = c->d, free
    eng.addShape({ id: 'L1', type: 'line', joints: ['j_origin', 'a'] });
    eng.addShape({ id: 'L2', type: 'line', joints: ['c', 'd'] });
    eng.addConstraint({ id: 'c_par', type: 'parallel', shapes: ['L1', 'L2'] });
    eng.addConstraint({ id: 'c_ang', type: 'angle', shapes: ['L1', 'L2'], value: 30 });

    const res = eng.solve(300);
    console.log('[Mode B] ', JSON.stringify({ converged: res.converged, error: res.error, conflicts: (res.conflicts || []).map(c => ({ id: c.id, r: +c.residual.toFixed(4) })) }));

    assert(res.converged === false, 'Mode B: parallel + angle(30) are mutually exclusive; must report converged:false');
    assert(Array.isArray(res.conflicts) && res.conflicts.length >= 1, 'Mode B: must surface a non-empty conflict list');
    const maxResid = Math.max(...res.conflicts.map(c => c.residual));
    assert(Math.abs(res.error - maxResid) < 1e-9, 'Mode B: error must equal the max geometric residual');
    assert(res.error > TOL, 'Mode B: max residual must exceed tolerance (neither constraint satisfiable)');
  }

  console.log('solver-converged-honesty tests passed ✅');
})().catch(e => { console.error('solver-converged-honesty tests failed ❌', e && e.message ? e.message : e); process.exit(1); });
