// TASK 1039: the Arc tool runs in the tool session (#ui/tool-session.js). Rewritten from finalizeArcFromActive / _test_setArcLockedRadius (gone:
// there is ONE build) to the session's shared events: the centre and start steps, then the end step from Enter (via 'enter') at the last hover, as
// the box translator sends it. The assertions are the old ones: Enter with nothing typed makes one arc on three joints and no radius dimension;
// with a typed radius it adds one; an end on an existing joint (the snap the cursor shows) is made coincident with it.
(async () => {
    const { toolSession } = await import('#ui/tool-session.js');
    const { ARC } = await import('#ui/input-handlers/arc-tool.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Helper to create minimal state
    let counter = 1;
    const createState = () => ({
        joints: new Map(),
        shapes: [],
        constraints: [],
        arcMode: 'arc-cse',
        genJ: () => 'j' + (counter++),
        beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}),
        endUndoGroup: () => {},
        onDrawCancelled: () => {},
        saveState: () => {}
    });
    const typedValue = (v) => ({ value: v, typed: true, expression: null, name: null, assign: null });
    const screen = { x: 0, y: 0 };
    // the centre (0,0) and the start (10,0), then the pointer at (0,10) (a quarter turn), as the translators deliver them
    const toEnd = (state, s, { radius = null } = {}) => {
        assert(s.step({ at: { x: 0, y: 0 }, screen, via: 'click' }) === 'next', 'the centre step is made');
        s.hover({ at: { x: 10, y: 0 }, snap: null, screen });
        if (radius !== null) s.values('radius', typedValue(radius));
        assert(s.step({ ...s.lastHover, via: 'click' }) === 'next', 'the start step is made');
        s.hover({ at: { x: 7, y: 7 }, snap: null, screen });
        s.hover({ at: { x: 0, y: 10 }, snap: state.activeSnap || null, screen });
    };

    // Test center-mode finalize
    (() => {
        const state = createState();
        const s = toolSession(state, ARC);
        toEnd(state, s);
        const ok = s.step({ ...s.lastHover, via: 'enter' });
        assert(ok === 'built', 'Enter (center) should build the arc');
        assert(state.shapes.length === 1, 'One shape should be created');
        const sh = state.shapes[0];
        assert(sh.type === 'arc', 'Shape should be an arc');
        assert(sh.joints && sh.joints.length === 3, 'Arc should have 3 joints');
        // With no numeric radius input, no radius distance constraint should be created
        assert(!state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'No radius distance constraint should be added when no input');
    })();

    // Test center-mode finalize when a radius was typed
    (() => {
        const state = createState();
        const s = toolSession(state, ARC);
        toEnd(state, s, { radius: 5 });
        const ok2 = s.step({ ...s.lastHover, via: 'enter' });
        assert(ok2 === 'built', 'Enter (center) should build the arc when a radius was typed');
        assert(state.shapes.length === 1, 'One shape should be created');
        assert(state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'A radius distance constraint should be added when input provided');
    })();

    // Test that if the final endpoint is snapped to an existing joint, a coincident constraint is created
    (() => {
        const state = createState();
        const existingEnd = state.genJ();
        state.joints.set(existingEnd, { x: 0, y: 10 });
        // TASK 1033 (X-01): the snap the cursor shows lives in state.activeSnap (input-manager updateSnapTarget); the hover carries it to the session
        state.activeSnap = { type: 'joint', targetId: existingEnd, id: existingEnd, pt: { x: 0, y: 10 }, isLocked: true };
        const s = toolSession(state, ARC);
        toEnd(state, s);
        const ok3 = s.step({ ...s.lastHover, via: 'enter' });
        assert(ok3 === 'built', 'Enter should build the arc when snapping the end to an existing joint');
        // One of the constraints should be a coincident linking the arc end and existingEnd joint
        const coinc = state.constraints.find(c => c.type === CONSTRAINT_TYPES.COINCIDENT && Array.isArray(c.joints) && c.joints.includes(existingEnd));
        assert(coinc, 'A coincident constraint should exist linking the arc end to the existing joint');
    })();

    console.log('arc-tool finalize tests passed ✅');
})().catch(e => {
    console.error('arc-tool tests failed ❌', e);
    process.exit(1);
});
