(async () => {
  const { analyzeConstraintStatus } = await import('#core/constraint-status.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Setup: fixed anchor 'a' connected to 'b' by a Distance -> b reduced to d1; b coincident to c so c should inherit the distance source
  const joints = new Map();
  joints.set('a', { x: 0, y: 0, fixed: true });
  joints.set('b', { x: 0, y: 0, fixed: false });
  joints.set('c', { x: 10, y: 0, fixed: false });

  const constraints = [
    { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['b','c'] },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','b'], value: 3.0 }
  ];

  const status = analyzeConstraintStatus({ joints, shapes: [], constraints });

  // anchor 'a' should be traced as 'fixed'
  assert(status.dofSources.get('a') && status.dofSources.get('a').includes('fixed'), 'anchor must be traced as fixed');

  // b should have a distance source recorded
  const bSources = status.dofSources.get('b') || [];
  assert(bSources.some(s => s.startsWith('distance')), `expected b to have distance source, got: ${bSources}`);
  // And provenance should include anchor info for downstream use (anchor:a)
  assert(bSources.some(s => s.startsWith('anchor:') || s.includes('anchor:') || status.dofSources.get('b').some(x => String(x).includes('anchor:')) ), `expected b to include anchor provenance (anchor:a), got: ${bSources}`);

  // c (coincident member) should inherit the distance source after cluster unification
  const cSources = status.dofSources.get('c') || [];
  assert(cSources.some(s => s.startsWith('distance')), `expected c to inherit distance source, got: ${cSources}`);

  console.log('dof-sources test passed ✅');
})().catch(e => { console.error('dof-sources test failed ❌', e); process.exit(1); });