(async () => {
    const { finalizeLineFromActive } = await import('#ui/input-handlers/line-tool.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup minimal state
    let counter = 1;
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (counter++),
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {}
    };

    state.active = {
        mode: 'line',
        start: null,
        startPt: { x: 0, y: 0 },
        preview: { type: 'line', pt: { x: 100, y: 0 } }
    };

    const ok = await finalizeLineFromActive(null, state);
    assert(ok === true, 'finalizeLineFromActive should return true');
    assert(state.shapes.length === 1, 'One shape should be created');
    const s = state.shapes[0];
    assert(s.type === 'line', 'Shape should be a line');
    assert(s.joints && s.joints.length === 2, 'Line should have 2 joints');

    // After finalization, there should be a new start joint for the next segment
    assert(state.active && state.active.start, 'State should have an active start for next segment');
    // Ensure that joints map contains all referenced joints
    assert(state.joints.has(s.joints[0]) && state.joints.has(s.joints[1]) && state.joints.has(state.active.start), 'State joints should include shape joints and new start');

    console.log('line-tool finalize tests passed ✅');
})().catch(e => {
    console.error('line-tool tests failed ❌', e);
    process.exit(1);
});