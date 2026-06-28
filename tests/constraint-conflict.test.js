(async () => {
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  function makeState() {
    return { joints: new Map(), shapes: [], constraints: [] };
  }

  // Structural conflict: two fixed joints at different locations -> COINCIDENT must be rejected
  const s1 = makeState();
  s1.joints.set('a', { x: 0, y: 0, fixed: true });
  s1.joints.set('b', { x: 5, y: 0, fixed: true });
  const created1 = ConstraintManager.createConstraint(s1, CONSTRAINT_TYPES.COINCIDENT, { joints: ['a','b'] });
  assert(created1 === null, 'Structural conflicting coincident should be rejected');

  // Dimensional conflict: DISTANCE between two fixed joints with mismatched value -> should be demoted to driven
  const s2 = makeState();
  s2.joints.set('a', { x: 0, y: 0, fixed: true });
  s2.joints.set('b', { x: 3, y: 0, fixed: true });
  const created2 = ConstraintManager.createConstraint(s2, CONSTRAINT_TYPES.DISTANCE, { joints: ['a','b'], value: 10 });
  // Should have been added but marked driven/isDriven
  assert(created2 && (created2.isDriven || created2.driven), 'Conflicting distance should be demoted to driven (isDriven/driven flag)');

  console.log('constraint conflict handling tests passed ✅');
})().catch(e => { console.error('constraint conflict handling tests failed ❌', e); process.exit(1); });