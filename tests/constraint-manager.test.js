(async () => {
    const { ConstraintManager } = await import('../src/core/constraint-manager.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Test validateParams
    assert(ConstraintManager.validateParams(CONSTRAINT_TYPES.HORIZONTAL, { joints: ['j1','j2'] }) === true, 'Horizontal should accept 2 joints');
    assert(ConstraintManager.validateParams(CONSTRAINT_TYPES.HORIZONTAL, { joints: ['j1'] }) === false, 'Horizontal should reject single joint');

    // Test normalizeParams
    const normalized = ConstraintManager.normalizeParams(CONSTRAINT_TYPES.HORIZONTAL, { joints: [{ id: 'j1' }, { id: 'j2' }] });
    assert(Array.isArray(normalized.joints) && normalized.joints[0] === 'j1' && normalized.joints[1] === 'j2', 'normalizeParams should convert joint objects to ids');

    // Test createConstraint duplicate detection
    const state = { constraints: [], joints: new Map(), shapes: [], engine: { solve: (n) => {} } };
    state.joints.set('j1', { x: 0, y: 0 }); state.joints.set('j2', { x: 10, y: 0 });

    const c1 = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: ['j1','j2'] }, { source: 'test', autoSolve: false });
    assert(c1 !== null, 'First constraint should be created');
    const c2 = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: ['j1','j2'] }, { source: 'test', autoSolve: false });
    assert(c2 === null, 'Duplicate constraint should be rejected');

    console.log('ConstraintManager tests passed ✅');
})().catch(e => {
    console.error('ConstraintManager tests failed ❌', e);
    process.exit(1);
});
