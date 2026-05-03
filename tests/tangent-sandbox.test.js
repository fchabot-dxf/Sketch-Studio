(async () => {
    const { ConstraintManager } = await import('../src/core/constraint-manager.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const { solveConstraints } = await import('../src/solver-core.js');

    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup state
    const state = { joints: new Map(), shapes: [], constraints: [] };

    // Vertical line at x=0
    state.joints.set('la', { x: 0, y: 0 });
    state.joints.set('lb', { x: 0, y: 100 });
    const lineId = 'L1';
    state.shapes.push({ id: lineId, type: 'line', joints: ['la', 'lb'] });

    // Circle centered at (20,50) radius 10
    state.joints.set('c', { x: 20, y: 50 });
    const circleId = 'C1';
    state.shapes.push({ id: circleId, type: 'circle', joints: ['c'], radius: 10 });

    // Provide engine.solve for sandbox to use
    state.engine = { solve: (iter) => solveConstraints(state.joints, state.shapes, state.constraints, iter) };

    // Add vertical constraint to line
    const vert = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints: ['la','lb'] }, { source: 'test' });
    assert(vert, 'Vertical constraint should be created');

    // Now attempt to add tangent between the line and the circle (shapes form)
    const tangent = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { shapes: [lineId, circleId] }, { source: 'test' });

    // It should be accepted (not null)
    assert(tangent, 'Tangent constraint should be accepted and not sandbox-rejected');

    // Also verify it is present in state's constraints
    const found = state.constraints.some(c => c.type === CONSTRAINT_TYPES.TANGENT && ((c.shapes && c.shapes.includes(lineId) && c.shapes.includes(circleId)) || (c.line === lineId && c.circle === circleId)));
    assert(found, 'Tangent constraint should be present in state.constraints after creation');

    console.log('tangent-sandbox tests passed ✅');
})().catch(e => { console.error('tangent-sandbox tests failed ❌', e); process.exit(1); });