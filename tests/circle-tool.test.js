(async () => {
    const { finalizeCircleFromActive, _test_setCircleLockedRadius } = await import('#ui/input-handlers/circle-tool.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Helper to create minimal state
    let counter = 1;
    const createState = () => ({
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (counter++),
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {}
    });

    // Test finalize without locked radius - should NOT add a radius constraint
    (() => {
        const state = createState();
        const centerId = state.genJ();
        state.joints.set(centerId, { x: 0, y: 0 });

        state.active = {
            mode: 'circle',
            start: centerId,
            preview: { type: 'circle', pt: { x: 10, y: 0 } }
        };

        const ok = finalizeCircleFromActive(null, state);
        assert(ok === true, 'finalizeCircleFromActive (circle) should return true');
        assert(state.shapes.length === 1, 'One shape should be created');
        assert(!state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'No radius distance constraint should be added when no input');
    })();

    // Test finalize with locked radius - should add a radius constraint
    (() => {
        const state = createState();
        const centerId = state.genJ();
        state.joints.set(centerId, { x: 0, y: 0 });

        state.active = {
            mode: 'circle',
            start: centerId,
            preview: { type: 'circle', pt: { x: 10, y: 0 } }
        };

        try { _test_setCircleLockedRadius(7); } catch (_) { }
        const ok = finalizeCircleFromActive(null, state);
        assert(ok === true, 'finalizeCircleFromActive (circle) should return true when lockedRadius set');
        assert(state.shapes.length === 1, 'One shape should be created');
        assert(state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'A radius distance constraint should be added when input provided');
    })();

    console.log('circle-tool finalize tests passed ✅');
})().catch(e => {
    console.error('circle-tool tests failed ❌', e);
    process.exit(1);
});