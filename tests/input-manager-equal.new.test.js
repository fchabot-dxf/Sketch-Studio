(async () => {
    const { handlePointerDown } = await import('../apps/sketchstudio/ui/input-manager.js');
    const { TOOL_MODES, CONSTRAINT_TYPES } = await import('#core/constants.js');
    const { worldToScreen } = await import('../apps/sketchstudio/coords.js');
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

    // Minimal state needed by ConstraintManager / input flows
    const state = {
        joints: new Map(),
        shapes: [],
        constraints: [],
        genJ: () => 'j' + Math.floor(Math.random()*10000),
        beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {},
        selectedShapes: new Set(), selectedJoints: new Set(),
        // lightweight engine stub (ConstraintManager may call state.engine.solve)
        engine: { solve: () => ({ error: 0, converged: true }) }
    };

    // Create two long horizontal lines so midpoint clicks are far from endpoints
    // (prevents joint-priority from stealing the snap in test environment)
    state.joints.set('a', { x: 100, y: 100 }); state.joints.set('b', { x: 700, y: 100 });
    state.shapes.push({ id: 'L1', type: 'line', joints: ['a','b'] });
    state.joints.set('p', { x: 100, y: 300 }); state.joints.set('q', { x: 700, y: 300 });
    state.shapes.push({ id: 'L2', type: 'line', joints: ['p','q'] });

    // Set tool to EQUAL
    state.currentTool = TOOL_MODES.EQUAL;

    // Fake svg with larger viewport so world coords map naturally to screen pixels
    const svg = {
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
        clientWidth: 800, clientHeight: 600
    };

    // Helper to build pointer event at a world point
    const makePointerEventForWorldPt = (pt) => ({ clientX: worldToScreen(svg, pt).x, clientY: worldToScreen(svg, pt).y, pointerId: 1, pointerType: 'mouse', button: 0, preventDefault: () => {} });

    // --- First click: select L1 (should create pendingConstraint)
    state.snapTarget = { type: 'line', shape: state.shapes[0], pt: { x: 400, y: 100 }, isLocked: true, targetId: 'L1' };
    let e = makePointerEventForWorldPt(state.snapTarget.pt);
    handlePointerDown(e, svg, state);

    if (!state.pendingConstraint || state.pendingConstraint.type !== TOOL_MODES.EQUAL) throw new Error('Pending equal not set after first click');

    // --- Second click: select L2 (should create EQUAL constraint)
    state.snapTarget = { type: 'line', shape: state.shapes[1], pt: { x: 400, y: 300 }, isLocked: true, targetId: 'L2' };
    e = makePointerEventForWorldPt(state.snapTarget.pt);
    handlePointerDown(e, svg, state);

    const c = state.constraints.find(c => c.type === CONSTRAINT_TYPES.EQUAL && c.shapes && c.shapes.includes('L1') && c.shapes.includes('L2'));
    assert(!!c, 'Equal constraint should have been created between L1 and L2');

    console.log('input-manager equal (new) test passed ✅');
})().catch(e => { console.error('input-manager equal (new) test failed ❌', e); process.exit(1); });