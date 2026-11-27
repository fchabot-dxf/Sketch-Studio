// TASK 1034: the Circle tool runs in the tool session (#ui/tool-session.js). Rewritten from finalizeCircleFromActive / _test_setCircleLockedRadius
// (gone: there is ONE build) to the session's shared events: the centre step, then the rim step from Enter (via 'enter'), as the box translator
// sends it. The assertions are the old ones: Enter with nothing typed adds no radius dimension; with a typed size it adds one.
(async () => {
    const { toolSession } = await import('#ui/tool-session.js');
    const { CIRCLE } = await import('#ui/input-handlers/circle-tool.js');
    const { CONSTRAINT_TYPES } = await import('#core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Helper to create minimal state
    let counter = 1;
    const createState = () => ({
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (counter++),
        beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}),
        endUndoGroup: () => {},
        onDrawCancelled: () => {},
        saveState: () => {}
    });
    const typedValue = (v) => ({ value: v, typed: true, expression: null, name: null, assign: null });

    // Enter without a typed size - should NOT add a radius constraint
    (() => {
        const state = createState();
        const s = toolSession(state, CIRCLE);
        assert(s.step({ at: { x: 0, y: 0 }, via: 'click' }) === 'next', 'the centre step is made');
        s.hover({ at: { x: 10, y: 0 }, snap: null, screen: null });
        const ok = s.step({ ...s.lastHover, via: 'enter' });
        assert(ok === 'built', 'Enter (circle) should build the circle');
        assert(state.shapes.length === 1, 'One shape should be created');
        assert(state.shapes[0].radius === 10, 'its radius is the hover distance');
        assert(!state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'No radius distance constraint should be added when no input');
    })();

    // Enter with a typed size - should add a radius constraint
    (() => {
        const state = createState();
        const s = toolSession(state, CIRCLE);
        s.step({ at: { x: 0, y: 0 }, via: 'click' });
        s.hover({ at: { x: 10, y: 0 }, snap: null, screen: null });
        s.values('diameter', typedValue(14));
        const ok = s.step({ ...s.lastHover, via: 'enter' });
        assert(ok === 'built', 'Enter (circle) should build the circle when a size is typed');
        assert(state.shapes.length === 1, 'One shape should be created');
        assert(state.shapes[0].radius === 7, 'its radius is the typed diameter / 2');
        assert(state.constraints.some(c => c.type === CONSTRAINT_TYPES.DISTANCE && c.isRadius === true), 'A radius distance constraint should be added when input provided');
    })();

    console.log('circle-tool finalize tests passed ✅');
})().catch(e => {
    console.error('circle-tool tests failed ❌', e);
    process.exit(1);
});
