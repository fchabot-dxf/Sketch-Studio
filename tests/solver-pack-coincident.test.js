(async () => {
  const { createNewtonSolver } = await import('../src/core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Two free joints bound by a coincident constraint should be packed as a single variable
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: false });
  joints.set('b', { x: 0, y: 0, fixed: false });

  const constraints = [{ type: 'coincident', joints: ['a','b'] }];
  const solver = createNewtonSolver(joints, constraints, [], { maxIter: 1 });

  const x = solver._pack();
  // Only one free variable (cluster 'a'/'b') -> vector length should be 2
  assert(x.length === 2, `expected packed vector length 2 for coincident-cluster, got ${x.length}`);

  // _freeIds should contain precisely one representative
  assert(Array.isArray(solver._freeIds) && solver._freeIds.length === 1, '_freeIds should contain one representative id');

  // Both joint ids should map to the same variable index
  const viA = solver._varIndex.get('a');
  const viB = solver._varIndex.get('b');
  assert(typeof viA === 'number' && viA === viB, 'both coincident members should map to the same varIndex');

  console.log('solver-pack-coincident tests passed ✅');
})().catch(e => { console.error('solver-pack-coincident tests failed ❌', e); process.exit(1); });