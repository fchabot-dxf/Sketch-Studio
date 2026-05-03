(async () => {
  const { solveConstraints } = await import('../src/solver-core.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal joints with a coincident constraint that is already satisfied
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: false });
  joints.set('b', { x: 0, y: 0, fixed: false });
  const shapes = [];
  const constraints = [{ type: 'coincident', joints: ['a','b'] }];

  // Run solver with many iterations; with convergence-check it should quickly detect no movement
  // We'll copy positions, run solver, and verify positions are unchanged
  const beforeA = { x: joints.get('a').x, y: joints.get('a').y };
  const beforeB = { x: joints.get('b').x, y: joints.get('b').y };

  solveConstraints(joints, shapes, constraints, 1000);

  const afterA = joints.get('a'); const afterB = joints.get('b');
  assert(afterA.x === beforeA.x && afterA.y === beforeA.y, 'Joint a should not move on already-satisfied constraints');
  assert(afterB.x === beforeB.x && afterB.y === beforeB.y, 'Joint b should not move on already-satisfied constraints');

  console.log('solver-convergence tests passed ✅');
})().catch(e => { console.error('solver-convergence tests failed ❌', e); process.exit(1); });