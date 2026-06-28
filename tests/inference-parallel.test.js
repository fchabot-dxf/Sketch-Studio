(async () => {
    const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    const state = {
        joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), selectedShapes: new Set(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, currentTool: 'select'
    };

    // Reference horizontal line l1 (j1-j2)
    state.joints.set('j1', { x: 0, y: 0, fixed: false });
    state.joints.set('j2', { x: 100, y: 0, fixed: false });
    state.shapes.push({ id: 'l1', type: 'line', joints: ['j1','j2'] });

    // Movable line l2 (j3-j4), initially vertical
    state.joints.set('j3', { x: 0, y: 0, fixed: false });
    state.joints.set('j4', { x: 0, y: 10, fixed: false });
    state.shapes.push({ id: 'l2', type: 'line', joints: ['j3','j4'] });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0, y:0, width:200, height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    // Drag j4 to (50,0) to make line l2 horizontal and thus parallel to l1
    const down = { clientX: 0, clientY: 10, pointerId: 1, target: { closest: () => null, dataset: {} } };
    const hitJoint = { id: 'j4', j: state.joints.get('j4') };
    assert(handleSelectionPointerDown(down, svg, state, hitJoint, null, null) === true, 'pointerDown should start drag');

    // Move to make line l2 horizontal (same Y as l1)
    const move = { clientX: 50, clientY: 0 };
    handleSelectionPointerMove(move, svg, state);
    console.log('DEBUG inference after move:', state.inference);
    assert(state.inference && state.inference.type === 'parallel', 'Expected PARALLEL inference');

    const up = { clientX: 50, clientY: 0, pointerId: 1 };
    handleSelectionPointerUp(up, svg, state);

    const par = state.constraints.find(c => c && c.type === 'parallel');
    assert(par, 'PARALLEL constraint should be present');
    console.log('parallel inference test passed ✅');
})().catch(e => { console.error('parallel inference test failed ❌', e); process.exit(1); });