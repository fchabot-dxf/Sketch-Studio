(async () => {
    const { handlePointerDown } = await import('../src/ui/input-manager.js');
    const { TOOL_MODES } = await import('../src/core/constants.js');
    const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Setup minimal state
    const state = { joints: new Map(), shapes: [], constraints: [], genJ: () => 'j' + Math.floor(Math.random()*10000), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, selectedShapes: new Set(), selectedJoints: new Set() };
    // Line
    state.joints.set('a', { x: 0, y: 0 }); state.joints.set('b', { x: 10, y: 0 }); state.shapes.push({ id: 'L1', type: 'line', joints: ['a','b'] });
    // free point joint
    state.joints.set('pt', { x: 5, y: 10 });

    state.currentTool = TOOL_MODES.MIDPOINT;
    // First click on line
    state.snapTarget = { type: 'line', shape: state.shapes[0], pt: { x: 5, y: 0 }, isLocked: true, targetId: 'L1' };
    const svg = { setPointerCapture: () => {}, releasePointerCapture: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), viewBox: { baseVal: { width: 100, height: 100 } } };
    const { worldToScreen } = await import('../apps/sketchstudio/coords.js');
    let e = { clientX: worldToScreen(svg, state.snapTarget.pt).x, clientY: worldToScreen(svg, state.snapTarget.pt).y, pointerId: 1, pointerType: 'mouse', button: 0, preventDefault: () => {} };
    handlePointerDown(e, svg, state);
    // Then click on joint
    state.snapTarget = { type: 'joint', targetId: 'pt', pt: state.joints.get('pt'), isLocked: true };
    e.clientX = worldToScreen(svg, state.snapTarget.pt).x; e.clientY = worldToScreen(svg, state.snapTarget.pt).y;
    handlePointerDown(e, svg, state);

    // Verify midpoint constraint created
    const c = state.constraints.find(c => c.type === CONSTRAINT_TYPES.MIDPOINT && c.joints && c.joints.length === 3);
    assert(!!c, 'Midpoint constraint should have been created');

    console.log('input-manager midpoint routing test passed ✅');
})().catch(e => { console.error('input-manager midpoint test failed ❌', e); process.exit(1); });