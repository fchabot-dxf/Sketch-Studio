(async () => {
  const { createNewtonSolver } = await import('../src/core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Under-determined pair: no structural constraints. A mouse_spring should
  // move the dragged joint close to the target (weakly), leaving others unchanged.
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: false });
  joints.set('b', { x: 20, y: 0, fixed: false });
  const constraints = []; // no constraints

  const solver = createNewtonSolver(joints, constraints, [], { maxIter: 30, tol: 1e-9 });

  const res = solver.solve(30, { dragTarget: { jointId: 'a', x: 50, y: 10, stiffness: 1e6 } });

  const a = joints.get('a');
  const b = joints.get('b');
  // 'a' should have moved close to the target; 'b' should be essentially unchanged
  assert(Math.hypot(a.x - 50, a.y - 10) < 1e-3, `Dragged joint didn't approach target: ${a.x},${a.y}`);
  assert(Math.hypot(b.x - 20, b.y - 0) < 1e-6, `Unconstrained neighbor moved unexpectedly: ${b.x},${b.y}`);

  console.log('mouse-spring movement test passed ✅');
})().catch(e => { console.error('mouse-spring movement test failed ❌', e); process.exit(1); });