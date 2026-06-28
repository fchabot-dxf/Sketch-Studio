(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // j_origin is fixed; b is coincident to j_origin (structural). A mouse_spring on b
  // should NOT be able to move b — structural invariance must hold.
  const joints = new Map();
  joints.set('j_origin', { x: 0, y: 0, fixed: true });
  joints.set('b', { x: 0, y: 0, fixed: false });
  const constraints = [{ type: 'coincident', joints: ['j_origin', 'b'] }];

  const solver = createNewtonSolver(joints, constraints, [], { maxIter: 50, tol: 1e-9 });

  // Try to pull 'b' to (100,0) with a very stiff mouse spring
  const res = solver.solve(50, { dragTarget: { jointId: 'b', x: 100, y: 0, stiffness: 1e8 } });

  // Structural constraint should prevent movement
  const b = joints.get('b');
  assert(Math.abs(b.x - 0) < 1e-6 && Math.abs(b.y - 0) < 1e-6, `Structural constraint violated: b moved to ${b.x},${b.y}`);
  console.log('mouse-spring structural protection test passed ✅');
})().catch(e => { console.error('mouse-spring structural protection test failed ❌', e); process.exit(1); });