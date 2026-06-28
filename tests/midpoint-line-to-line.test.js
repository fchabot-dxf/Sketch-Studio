(async () => {
    const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        selectedJoints: new Set(),
        selectedShapes: new Set(),
        beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, currentTool: 'select'
    };

    // Line A: j1(0,0)-j2(10,0)
    state.joints.set('j1', { x: 0, y: 0, fixed: false });
    state.joints.set('j2', { x: 10, y: 0, fixed: false });
    state.shapes.push({ id: 'l1', type: 'line', joints: ['j1','j2'] });

    // Line B: j3(30,0)-j4(40,0)
    state.joints.set('j3', { x: 30, y: 0, fixed: false });
    state.joints.set('j4', { x: 40, y: 0, fixed: false });
    state.shapes.push({ id: 'l2', type: 'line', joints: ['j3','j4'] });

    // Draggable joint j5 near midpoint between midpoints (should be at x=20)
    state.joints.set('j5', { x: 20, y: 5, fixed: false });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0, y:0, width:200, height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    const down = { clientX: 20, clientY: 5, pointerId: 1, target: { closest: () => null, dataset: {} } };
    const hitJoint = { id: 'j5', j: state.joints.get('j5') };
    assert(handleSelectionPointerDown(down, svg, state, hitJoint, null, null) === true, 'pointerDown should start drag');

    // Move toward midpoint between the two line midpoints (20,0)
    // Move slightly beyond threshold to register as a drag
    const move = { clientX: 20, clientY: -1 };
    handleSelectionPointerMove(move, svg, state);
    console.log('DEBUG inference after move:', state.inference);
    // Per spec: line→line midpoint should NOT be an inference; ensure none
    assert(!(state.inference && state.inference.type === 'midpoint'), 'Did not expect midpoint inference between lines');

    // Simulate a snap: compute the midpoint snap via findSnap and set it as active
    const { findSnap } = await import('../apps/sketchstudio/snap-detection.js');
    const midSC = { x: 20, y: 0 };
    // Simulate an explicit midpoint snap selection (exclude nearby joints overriding the midpoint)
    state.activeSnap = { type: 'midpoint', joints: ['j2','j3'], pt: { x: 20, y: 0 }, isLocked: true };

    // Release
    const up = { clientX: 20, clientY: 0, pointerId: 1 };
    handleSelectionPointerUp(up, svg, state);

    const midC = state.constraints.find(c => c && c.type === 'midpoint');
    assert(midC, 'MIDPOINT constraint should be present after snap-based release');    const ids = new Set(midC.joints || []);
    // It should include j5 and two anchors that are among j1..j4
    assert(ids.has('j5'), 'MIDPOINT should reference dragged joint');
    const endpointCandidates = ['j1','j2','j3','j4'];
    const anchors = [...ids].filter(x => x !== 'j5');
    assert(anchors.length === 2 && endpointCandidates.includes(anchors[0]) && endpointCandidates.includes(anchors[1]), 'Anchors should be from original endpoints');

    console.log('midpoint line-to-line test passed ✅');
})().catch(e => { console.error('midpoint line-to-line test failed ❌', e); process.exit(1); });