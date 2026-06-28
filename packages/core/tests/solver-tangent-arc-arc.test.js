(async () => {
    const { solveConstraints } = await import('#core/solver-core.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Two arcs (circle-like) placed with centers too far apart; tangent should pull them together
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: []
    };

    // Circle-like 1 at (0,0) r=10
    state.joints.set('c1', { x: 0, y: 0, fixed: false });
    state.joints.set('r1', { x: 10, y: 0, fixed: false });
    state.shapes.push({ id: 's1', type: 'arc', joints: ['c1', 'r1'] });

    // Circle-like 2 at (25,0) r=10
    state.joints.set('c2', { x: 25, y: 0, fixed: false });
    state.joints.set('r2', { x: 35, y: 0, fixed: false });
    state.shapes.push({ id: 's2', type: 'arc', joints: ['c2', 'r2'] });

    state.constraints.push({ type: CONSTRAINT_TYPES.TANGENT, shapes: ['s1','s2'] });

    const before = Math.hypot(state.joints.get('c2').x - state.joints.get('c1').x, state.joints.get('c2').y - state.joints.get('c1').y);
    // Run solver
    solveConstraints(state.joints, state.shapes, state.constraints, 10);
    const after = Math.hypot(state.joints.get('c2').x - state.joints.get('c1').x, state.joints.get('c2').y - state.joints.get('c1').y);

    assert(after < before, 'Tangent constraint should reduce center distance for external tangent');

    console.log('solver-tangent-arc-arc test passed ✅');
})().catch(e => { console.error('solver-tangent-arc-arc test failed ❌', e); process.exit(1); });