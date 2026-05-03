(async () => {
    const { applySnapConstraint } = await import('../src/core/snap-constraints.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup minimal state
    const state = { joints: new Map(), shapes: [], constraints: [] };
    state.joints.set('j1', { x: 0, y: 0 }); state.joints.set('j2', { x: 10, y: 0 });

    // Test joint->joint coincident
    let ok = applySnapConstraint(state, 'j1', { type: 'joint', id: 'j2' }, {});
    assert(ok === true, 'applySnapConstraint should return true for joint->joint');
    const c = state.constraints.find(c => c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && ((c.joints[0] === 'j1' && c.joints[1] === 'j2') || (c.joints[0] === 'j2' && c.joints[1] === 'j1')));
    assert(!!c, 'Coincident constraint should be present');

    // Test joint->line point-on-line
    // Create a line shape
    state.joints.set('la', { x: 0, y: 0 }); state.joints.set('lb', { x: 100, y: 0 });
    const sId = 's_line1'; state.shapes.push({ id: sId, type: 'line', joints: ['la','lb'] });
    state.joints.set('j3', { x: 50, y: 0 });

    ok = applySnapConstraint(state, 'j3', { type: 'line', shape: state.shapes[0], pt: { x: 50, y: 0 } }, {});
    assert(ok === true, 'applySnapConstraint should return true for joint->line');
    const p = state.constraints.find(c => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint === 'j3' && c.shape === sId);
    assert(!!p, 'Point-on-line constraint should be present');

    // New: ensure point-on-line projects to infinite line, not clamped to segment endpoints
    state.joints.set('j5', { x: 20, y: 5 });
    state.constraints.push({ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: 'j5', shape: sId });
    const { solveConstraints } = await import('../src/solver-core.js');
    // Run solver to enforce constraint
    solveConstraints(state.joints, state.shapes, state.constraints, 20);
    const j5 = state.joints.get('j5');
    assert(Math.abs(j5.y - 0) < 1e-3 && Math.abs(j5.x - 20) < 1e-3, 'point-on-line should project to infinite line, not clamp to endpoint');

    // Regression test: findSnap returns targetId for joints; ensure it works
    state.joints.set('j4', { x: 20, y: 0 });
    ok = applySnapConstraint(state, 'j1', { type: 'joint', targetId: 'j4' }, {});
    assert(ok === true, 'applySnapConstraint should accept targetId-style joint snaps');
    const c2 = state.constraints.find(c => c.type === CONSTRAINT_TYPES.COINCIDENT && c.joints && ((c.joints[0] === 'j1' && c.joints[1] === 'j4') || (c.joints[0] === 'j4' && c.joints[1] === 'j1')));
    assert(!!c2, 'Coincident constraint should be present for targetId case');

    console.log('snap-constraints tests passed ✅');
})().catch(e => { console.error('snap-constraints tests failed ❌', e); process.exit(1); });