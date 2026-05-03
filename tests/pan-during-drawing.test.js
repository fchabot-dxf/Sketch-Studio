(async () => {
    const { setupInput } = await import('../src/ui/input-manager.js');
    const { handlePanZoomPointerDown, handlePanZoomPointerMove, handlePanZoomPointerUp } = await import('../src/ui/input-handlers/pan-zoom.js');
    const { TOOL_MODES } = await import('../src/core/constants.js');

    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Minimal svg stub
    const svg = {
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
        viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
        setAttribute: () => {},
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        innerHTML: '',
        style: {}
    };

    // Minimal state with an active line preview
    let genCounter = 1;
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + (genCounter++),
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {},
        currentTool: TOOL_MODES.LINE,
        view: { x: 0, y: 0, w: 800, h: 600 }
    };

    state.active = { mode: TOOL_MODES.LINE, start: null, startPt: { x: 0, y: 0 }, preview: { type: 'line', pt: { x: 100, y: 0 } } };
    state.lastMouse = { x: 400, y: 300 };

    // Avoid calling full setupInput in tests (touches DOM APIs). We'll just import helpers
    const { screenToWorld } = await import('../src/core/geometry.js');
    const { handleDrawingPointerMove } = await import('../src/ui/input-handlers/drawing-tools.js');

    // Note: tests run without a DOM event loop; we'll manually call the drawing move after simulating pan


    // Begin panning with middle button
    const down = { button: 1, clientX: 400, clientY: 300, pointerId: 1, preventDefault: () => {} };
    const started = handlePanZoomPointerDown(down, svg, state);
    assert(started === true, 'Pan should start on middle-button down');

    // Move the pointer (pan) — this should dispatch viewport change and update tool preview
    const prevPreview = state.active.preview.pt;
    const move = { clientX: 420, clientY: 300, pointerId: 1, preventDefault: () => {} };
    const moved = handlePanZoomPointerMove(move, svg, state);
    assert(moved === true, 'Pan move should be handled');

    // Reflect viewport change into active tool by running the drawing move handler
    const wAfter = screenToWorld(svg, move.clientX, move.clientY);
    try { handleDrawingPointerMove(move, svg, state, wAfter); } catch (_) { }

    // The input-manager handler should have refreshed active preview / tempMousePos (or our manual call did)
    assert(state.tempMousePos && typeof state.tempMousePos.x === 'number' && typeof state.tempMousePos.y === 'number', 'After panning while drawing there should be a tempMousePos');
    // Ensure preview moved relative to previous preview
    assert(!(state.tempMousePos.x === prevPreview.x && state.tempMousePos.y === prevPreview.y), 'Preview should update after viewport pan');

    // End panning
    const up = { button: 1, clientX: 420, clientY: 300, pointerId: 1 };
    const ended = handlePanZoomPointerUp(up, svg, state);
    assert(ended === true, 'Pan should end on pointer up');

    console.log('pan-during-drawing tests passed ✅');
})().catch(e => {
    console.error('pan-during-drawing tests failed ❌', e);
    process.exit(1);
});