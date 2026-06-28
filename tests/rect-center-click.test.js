(async () => {
    const { handleRectPointerDown, handleRectPointerUp, resetRectState } = await import('../apps/sketchstudio/ui/input-handlers/rect-tool.js');
    const { TOOL_MODES, RECT_MODES } = await import('#core/constants.js');
    const { makeRectFromCenter } = await import('#core/shapes.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    const createState = () => ({ joints: new Map(), shapes: [], constraints: [], genJ: () => 'j' + Math.floor(Math.random()*10000), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, isConstructionMode: false, currentTool: TOOL_MODES.RECT, rectMode: RECT_MODES.CENTER, activeSnap: null, snapTarget: null });

    const svg = null; // not needed for this test

    // First click should set center and enter waitingForSecondClick
    const state = createState();
    const w1 = { x: 10, y: 10 };
    handleRectPointerDown({ clientX: 10, clientY: 10 }, svg, state, null, w1);
    // Up without dragging -> should set waitingForSecondClick
    handleRectPointerUp({ clientX: 10, clientY: 10 }, svg, state, null, w1, false);
    assert(state.active && state.active.waitingForSecondClick === true, 'First click should set waitingForSecondClick for center mode');

    // Second click should finalize rectangle (create shapes)
    const w2 = { x: 20, y: 30 };
    handleRectPointerDown({ clientX: 20, clientY: 30 }, svg, state, null, w2);
    const beforeShapes = state.shapes.length;
    handleRectPointerUp({ clientX: 20, clientY: 30 }, svg, state, null, w2, false);
    assert(state.active === null, 'After second click center rect should finalize and active should be cleared');
    assert(state.shapes.length > beforeShapes, 'Rectangle shapes should be created on second click');

    console.log('rect-center-click tests passed ✅');
})().catch(e => { console.error('rect-center-click tests failed ❌', e); process.exit(1); });