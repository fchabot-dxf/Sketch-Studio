(async () => {
    const { handleLinePointerDown, handleLinePointerUp } = await import('../apps/sketchstudio/ui/input-handlers/line-tool.js');
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

    const svg = null;
    // Simulate pointer down on empty canvas at 0,0
    const downEvent = { clientX: 0, clientY: 0 };
    const startWorld = { x: 0, y: 0 };
    let hitSnap = null;

    // Pointer down (start temporary)
    handleLinePointerDown(downEvent, svg, state, hitSnap, startWorld);

    // Simulate a drag by moving the pointer sufficiently far, then release
    const moveEvent = { clientX: 30, clientY: 0 };
    // Minimal DOM shim for tests so pointerMove can run without errors
    if (typeof global.document === 'undefined') global.document = { getElementById: () => null };
    await import('../apps/sketchstudio/ui/input-handlers/line-tool.js').then(m => m.handleLinePointerMove(moveEvent, svg, state, { x: 30, y: 0 }));
    const upEvent = { clientX: 100, clientY: 0 };
    handleLinePointerUp(upEvent, svg, state, null, { x: 100, y: 0 }, true);

    // We should end up with exactly two joints (start and end) for the created line
    assert(state.shapes.length === 1, 'One shape should be created');
    const s = state.shapes[0];
    assert(s.type === 'line', 'Shape should be a line');
    assert(s.joints && s.joints.length === 2, 'Line should have 2 joints');

    const uniqueJoints = new Set();
    for (const jid of s.joints) uniqueJoints.add(jid);
    assert(uniqueJoints.size === 2, 'There should be exactly 2 unique joints for the line (no duplicate starts)');

    console.log('line-start-double-joint test passed ✅');
})().catch(e => {
    console.error('line-start-double-joint test failed ❌', e);
    process.exit(1);
});