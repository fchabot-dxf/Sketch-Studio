(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
  const { TOOL_MODES } = await import('#core/constants.js');
  const { SolverConfig } = await import('#core/solver-config.js');

  const svg = {
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }
  };

  // Test 1: a far cursor jump gets clamped to MAX_DRAG_STEP
  {
    const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT };
    state.joints.set('a', { x: 0, y: 0 });
    const hitJoint = { id: 'a', j: state.joints.get('a') };
    handleSelectionPointerDown({ clientX: 0, clientY: 0, pointerId: 1, target: { closest: () => null } }, svg, state, hitJoint, null, null);
    // Pointer jumps far in one frame: 1000 units along x
    handleSelectionPointerMove({ clientX: 1000, clientY: 0, pointerId: 1 }, svg, state);

    const dt = state.joints.get('a').dragTarget;
    assert(dt, 'dragTarget should be set');
    const dist = Math.hypot(dt.x, dt.y);
    const cap = SolverConfig.MAX_DRAG_STEP;
    assert(dist <= cap + 1e-6, `dragTarget distance ${dist} should be <= cap ${cap}`);
    assert(dist > cap * 0.99, `dragTarget should be near the cap (${cap}), got ${dist}`);
    // Direction preserved (along +x)
    assert(dt.x > 0 && Math.abs(dt.y) < 1e-6, `dragTarget should be along +x, got (${dt.x}, ${dt.y})`);
  }

  // Test 2: a small cursor move is NOT clamped (passes through unchanged)
  {
    const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT };
    state.joints.set('a', { x: 0, y: 0 });
    const hitJoint = { id: 'a', j: state.joints.get('a') };
    handleSelectionPointerDown({ clientX: 0, clientY: 0, pointerId: 1, target: { closest: () => null } }, svg, state, hitJoint, null, null);
    handleSelectionPointerMove({ clientX: 5, clientY: 7, pointerId: 1 }, svg, state);

    const dt = state.joints.get('a').dragTarget;
    assert(dt, 'dragTarget should be set');
    assert(Math.abs(dt.x - 5) < 1e-6 && Math.abs(dt.y - 7) < 1e-6,
      `small move should pass through unchanged, got (${dt.x}, ${dt.y})`);
  }

  // Test 3: cap honors SolverConfig.MAX_DRAG_STEP at runtime
  {
    const original = SolverConfig.MAX_DRAG_STEP;
    SolverConfig.MAX_DRAG_STEP = 25;
    try {
      const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT };
      state.joints.set('a', { x: 0, y: 0 });
      const hitJoint = { id: 'a', j: state.joints.get('a') };
      handleSelectionPointerDown({ clientX: 0, clientY: 0, pointerId: 1, target: { closest: () => null } }, svg, state, hitJoint, null, null);
      handleSelectionPointerMove({ clientX: 1000, clientY: 0, pointerId: 1 }, svg, state);
      const dt = state.joints.get('a').dragTarget;
      const dist = Math.hypot(dt.x, dt.y);
      assert(Math.abs(dist - 25) < 1e-6, `with cap=25, expected dist=25, got ${dist}`);
    } finally {
      SolverConfig.MAX_DRAG_STEP = original;
    }
  }

  // Test 4: cap=0 disables clamping
  {
    const original = SolverConfig.MAX_DRAG_STEP;
    SolverConfig.MAX_DRAG_STEP = 0;
    try {
      const state = { joints: new Map(), shapes: [], currentTool: TOOL_MODES.SELECT };
      state.joints.set('a', { x: 0, y: 0 });
      const hitJoint = { id: 'a', j: state.joints.get('a') };
      handleSelectionPointerDown({ clientX: 0, clientY: 0, pointerId: 1, target: { closest: () => null } }, svg, state, hitJoint, null, null);
      handleSelectionPointerMove({ clientX: 1000, clientY: 0, pointerId: 1 }, svg, state);
      const dt = state.joints.get('a').dragTarget;
      assert(Math.abs(dt.x - 1000) < 1e-6, `with cap=0, expected unchanged, got x=${dt.x}`);
    } finally {
      SolverConfig.MAX_DRAG_STEP = original;
    }
  }

  console.log('drag step cap tests passed ✅');
})().catch(e => { console.error('drag step cap tests failed ❌', e); process.exit(1); });
