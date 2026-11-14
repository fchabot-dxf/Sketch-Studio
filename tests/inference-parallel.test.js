// TASK 582: the drag's inference is found where the drag's SOLVE puts the dragged joint (selection-tools.js dragToward), so the sketch is the
// real engine-backed sketch state (tests/harness/audit/lib.js newSketch), as in the app; a hand-built state without a solver never moves the joint.
// TASK 598: a drag offers no PARALLEL to another line (Fusion, real mouse: a line end turned parallel to another line shows and adds nothing; turned
// horizontal it shows and adds Horizontal). l2 made horizontal beside the horizontal l1 now infers HORIZONTAL and the release adds a horizontal, no
// parallel (before: the attached-line parallel test answered first and added parallel(l2, l1)). tests/drag-attached-inference-node.test.js has the rows.
import * as L from './harness/audit/lib.js';
(async () => {
    const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } = await import('#ui/input-handlers/selection-tools.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    const state = L.newSketch().state;
    state.currentTool = 'select';

    // Reference horizontal line l1 (j1-j2)
    state.joints.set('j1', { x: 0, y: 0, fixed: false });
    state.joints.set('j2', { x: 100, y: 0, fixed: false });
    state.shapes.push({ id: 'l1', type: 'line', joints: ['j1','j2'] });

    // Movable line l2 (j3-j4), initially vertical
    state.joints.set('j3', { x: 0, y: 0, fixed: false });
    state.joints.set('j4', { x: 0, y: 10, fixed: false });
    state.shapes.push({ id: 'l2', type: 'line', joints: ['j3','j4'] });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0, y:0, width:200, height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    // Drag j4 to (50,0) to make line l2 horizontal (and so parallel to l1)
    const down = { clientX: 0, clientY: 10, pointerId: 1, target: { closest: () => null, dataset: {} } };
    const hitJoint = { id: 'j4', j: state.joints.get('j4') };
    assert(handleSelectionPointerDown(down, svg, state, hitJoint, null, null) === true, 'pointerDown should start drag');

    // Move to make line l2 horizontal (same Y as l1)
    const move = { clientX: 50, clientY: 0 };
    handleSelectionPointerMove(move, svg, state);
    console.log('DEBUG inference after move:', state.inference);
    assert(state.inference && state.inference.type === 'horizontal', 'Expected the HORIZONTAL inference (no parallel to l1, task 598): ' + (state.inference && state.inference.type));

    const up = { clientX: 50, clientY: 0, pointerId: 1 };
    handleSelectionPointerUp(up, svg, state);

    assert(!state.constraints.some(c => c && c.type === 'parallel'), 'no PARALLEL constraint is added (task 598)');
    assert(state.constraints.some(c => c && c.type === 'horizontal' && c.joints && c.joints.includes('j3') && c.joints.includes('j4')), 'a HORIZONTAL constraint on l2 is added');
    console.log('parallel inference test passed ✅ (a drag infers horizontal, never parallel)');
})().catch(e => { console.error('parallel inference test failed ❌', e); process.exit(1); });