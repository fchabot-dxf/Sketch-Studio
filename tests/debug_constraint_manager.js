(async () => {
    const { ConstraintManager } = await import('#core/constraint-manager.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');

    const state = { constraints: [], joints: new Map(), shapes: [], engine: { solve: (n) => { return { converged: true, error: 0 }; } } };
    state.joints.set('j1', { x: 0, y: 0 }); state.joints.set('j2', { x: 10, y: 0 });

    const params = { joints: ['j1','j2'] };
    const mathConflict = ConstraintManager._mathPreCheck(state, CONSTRAINT_TYPES.HORIZONTAL, params);
    console.log('mathConflict:', mathConflict);

    const sandbox = ConstraintManager._sandboxVerify(state, CONSTRAINT_TYPES.HORIZONTAL, params, 50);
    console.log('sandbox verify result:', sandbox);

    const c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, params, { source: 'test', autoSolve: false });
    console.log('createConstraint returned:', c);
})();
