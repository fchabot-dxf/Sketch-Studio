(async () => {
    const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } = await import('#ui/input-handlers/selection-tools.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Minimal state with one line and a free joint
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        selectedJoints: new Set(),
        selectedShapes: new Set(),
        selectedConstraints: new Set(),
        beginUndoGroup: () => {},
        endUndoGroup: () => {},
        saveState: () => {},
        currentTool: 'select'
    };

    // Create endpoints j1(0,0) and j2(10,0) and line s1
    state.joints.set('j1', { x: 0, y: 0, fixed: false });
    state.joints.set('j2', { x: 10, y: 0, fixed: false });
    state.shapes.push({ id: 's1', type: 'line', joints: ['j1', 'j2'] });

    // Create draggable joint j3 near midpoint but offset
    state.joints.set('j3', { x: 5, y: 5, fixed: false });

    // Minimal svg shim for coordinate transforms
    const svg = {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
        viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } },
        setPointerCapture: () => {},
        releasePointerCapture: () => {}
    };

    // Simulate pointer down on j3
    const down = { clientX: 5, clientY: 5, pointerId: 1, target: { closest: () => null, dataset: {} } };
    const hitJoint = { id: 'j3', j: state.joints.get('j3') };
    const okDown = handleSelectionPointerDown(down, svg, state, hitJoint, null, null);
    assert(okDown === true, 'pointerDown should start joint drag');

    // Simulate pointer move toward the midpoint (force > threshold)
    const move = { clientX: 5, clientY: -1 };
    handleSelectionPointerMove(move, svg, state);

    // We should have an inference active and it should be MIDPOINT
    console.log('DEBUG inference after move:', state.inference);
    assert(state.inference && state.inference.type === 'midpoint', 'Inference should detect midpoint');

    // Simulate pointer up to finalize drag and apply the constraint
    const up = { clientX: 5, clientY: 0, pointerId: 1 };

    const { INFERENCE_TYPES } = await import('#core/constants.js');
    console.log('DEBUG cond:', state.inference && state.inference.type === INFERENCE_TYPES.MIDPOINT, 'targetId:', state.inference && state.inference.targetId);

    handleSelectionPointerUp(up, svg, state);
    console.log('DEBUG constraints after up:', state.constraints);
    // Verify a MIDPOINT constraint exists linking j1, j2 and j3
    const midC = (state.constraints || []).find(c => c && c.type === 'midpoint');
    assert(midC, 'MIDPOINT constraint should be present');
    const ids = new Set(midC.joints || []);
    assert(ids.has('j1') && ids.has('j2') && ids.has('j3'), 'MIDPOINT constraint should reference j1, j2, j3');

    console.log('midpoint inference on drag test passed ✅');
})().catch(e => {
    console.error('midpoint inference test failed ❌', e);
    process.exit(1);
});