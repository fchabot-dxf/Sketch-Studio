(async () => {
    const { handleLinePointerDown, handleLinePointerMove, handleLinePointerUp } = await import('../src/ui/input-handlers/line-tool.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Minimal state
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

    const svg = { viewBox: { baseVal: { x:0,y:0,width:800,height:600 } }, getBoundingClientRect: () => ({ x:0,y:0,width:800,height:600 }) };

    // Simulate pointer down at origin (creates start joint)
    const downEvent = { clientX: 0, clientY: 0 };
    const startW = { x: 0, y: 0 };
    const okDown = handleLinePointerDown(downEvent, svg, state, null, startW);
    assert(okDown === true, 'pointerDown should start line creation');

    // Simulate pointer move near horizontal (y small) to trigger horizontal inference
    const moveEvent = { clientX: 50, clientY: 2 };
    const previewW = { x: 50, y: 2 };
    const okMove = handleLinePointerMove(moveEvent, svg, state, previewW);
    assert(okMove === true, 'pointerMove should update preview');
    // Ensure inference recorded
    assert(state.inference && state.inference.type === 'horizontal', 'Inference should be horizontal');

    // Simulate pointer up at preview (finalize) - no hitSnap
    const upEvent = { clientX: 50, clientY: 2 };
    const okUp = handleLinePointerUp(upEvent, svg, state, null, previewW, true);
    assert(okUp === true, 'pointerUp should finalize line');

    // After finalize, there should be a horizontal constraint added by inference
    const foundHorizontal = state.constraints.some(c => c.type === CONSTRAINT_TYPES.HORIZONTAL || (c.type === undefined && c[0] === 'horizontal') );
    assert(foundHorizontal, 'Horizontal inference constraint should be added on finalize');

    console.log('line-tool inference tests passed ✅');
})().catch(e => { console.error('line-tool inference tests failed ❌', e); process.exit(1); });