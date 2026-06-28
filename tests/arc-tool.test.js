(async () => {
    const { finalizeArcFromActive, _test_setArcLockedRadius } = await import('../apps/sketchstudio/ui/input-handlers/arc-tool.js');
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

    // Test center-mode finalize
    (() => {
        const state = createState();
        const centerId = state.genJ();
        const startId = state.genJ();
        state.joints.set(centerId, { x: 0, y: 0 });
        state.joints.set(startId, { x: 10, y: 0 });

        state.active = {
            mode: 'arc',
            subMode: 'arc-cse',
            phase: 'start',
            center: centerId,
            start: startId,
            preview: { type: 'arc', pt: { x: 0, y: 10 } }
        };

        const ok = finalizeArcFromActive(null, state);
        assert(ok === true, 'finalizeArcFromActive (center) should return true');
        assert(state.shapes.length === 1, 'One shape should be created');
        const s = state.shapes[0];
        assert(s.type === 'arc', 'Shape should be an arc');
        assert(s.joints && s.joints.length === 3, 'Arc should have 3 joints');
        // With no numeric radius input, no radius distance constraint should be created
        assert(!state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'No radius distance constraint should be added when no input');
    })();

    // Test center-mode finalize when a locked radius was provided
    (() => {
        const state = createState();
        const centerId = state.genJ();
        const startId = state.genJ();
        state.joints.set(centerId, { x: 0, y: 0 });
        state.joints.set(startId, { x: 10, y: 0 });

        state.active = {
            mode: 'arc',
            subMode: 'arc-cse',
            phase: 'start',
            center: centerId,
            start: startId,
            preview: { type: 'arc', pt: { x: 0, y: 10 } }
        };

        // Set locked radius like live-dimension 'enter' confirmation
        try { _test_setArcLockedRadius(5); } catch (_) { }

        const ok2 = finalizeArcFromActive(null, state);
        assert(ok2 === true, 'finalizeArcFromActive (center) should return true when lockedRadius set');
        assert(state.shapes.length === 1, 'One shape should be created');
        assert(state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'A radius distance constraint should be added when input provided');
    })();

    // Test that if the final endpoint is snapped to an existing joint, a coincident constraint is created
    (() => {
        const state = createState();
        const centerId = state.genJ();
        const startId = state.genJ();
        const existingEnd = state.genJ();
        state.joints.set(centerId, { x: 0, y: 0 });
        state.joints.set(startId, { x: 10, y: 0 });
        state.joints.set(existingEnd, { x: 0, y: 10 });

        // Simulate two-click arc creation: first click sets center/start then second click snaps to existing joint
        state.active = {
            mode: 'arc',
            subMode: 'arc-cse',
            phase: 'start',
            center: centerId,
            start: startId,
            preview: { type: 'arc', pt: { x: 0, y: 10 }, snapTarget: { type: 'joint', targetId: existingEnd, id: existingEnd, pt: { x: 0, y: 10 }, isLocked: true } }
        };

        const ok3 = finalizeArcFromActive(null, state);
        assert(ok3 === true, 'finalizeArcFromActive should return true when snapping end to an existing joint');
        // One of the constraints should be a coincident linking the arc end and existingEnd joint
        const coinc = state.constraints.find(c => c.type === CONSTRAINT_TYPES.COINCIDENT && Array.isArray(c.joints) && c.joints.includes(existingEnd));
        assert(coinc, 'A coincident constraint should exist linking the arc end to the existing joint');
    })();


    console.log('arc-tool finalize tests passed ✅');
})().catch(e => {
    console.error('arc-tool tests failed ❌', e);
    process.exit(1);
});