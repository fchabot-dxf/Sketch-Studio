(async () => {
    const { applySnapConstraint } = await import('#core/snap-constraints.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');
    const { solveConstraints } = await import('#core/solver-core.js');

    const state = { joints: new Map(), shapes: [], constraints: [] };
    state.joints.set('la', { x: 0, y: 0 }); state.joints.set('lb', { x: 100, y: 0 });
    const sId = 's_line1'; state.shapes.push({ id: sId, type: 'line', joints: ['la','lb'] });
    state.joints.set('j5', { x: 20, y: 5 });
    state.constraints.push({ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: 'j5', shape: sId });

    console.log('Before:', state.joints.get('j5'));
    solveConstraints(state.joints, state.shapes, state.constraints, 2000);
    console.log('After:', state.joints.get('j5'));
})();
