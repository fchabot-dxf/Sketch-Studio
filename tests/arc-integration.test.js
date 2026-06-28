(async () => {
  const { setupDrawingTools, handleDrawingPointerDown, handleDrawingPointerMove, handleDrawingPointerUp } = await import('../apps/sketchstudio/ui/input-handlers/drawing-tools.js');
  const { TOOL_MODES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal app state
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

  // Run setup to ensure setupArcTool is invoked through the normal flow
  setupDrawingTools(null, state);

  // Simulate selecting the arc tool in the UI
  state.currentTool = TOOL_MODES.ARC;

  // Simulate first click (create start/center depending on mode)
  const down = { clientX: 100, clientY: 100 };
  const w = { x: 100, y: 100 };
  const okDown = handleDrawingPointerDown(down, null, state, null, w);
  assert(okDown === true, 'handleDrawingPointerDown should handle ARc pointerdown');
  assert(state.active && state.active.mode === TOOL_MODES.ARC, 'Arc tool should set active state on down');

  // Simulate a small move (no drag) then up - should not finalize because it's a click
  handleDrawingPointerMove({ clientX: 101, clientY: 101 }, null, state, { x: 101, y: 101 });
  const okUp = handleDrawingPointerUp({ clientX: 101, clientY: 101 }, null, state, null, { x: 101, y: 101 }, false);
  assert(okUp === true, 'handleDrawingPointerUp should be handled');

  // Now perform a drag to progress arc creation in 3-pt mode
  // Create first point again
  handleDrawingPointerDown(down, null, state, null, w);
  // Simulate drag beyond threshold
  handleDrawingPointerMove({ clientX: 150, clientY: 100 }, null, state, { x: 150, y: 100 });
  // Up should create second point
  handleDrawingPointerUp({ clientX: 150, clientY: 100 }, null, state, null, { x: 150, y: 100 }, true);

  // Third point via another press+drag
  handleDrawingPointerDown({ clientX: 175, clientY: 125 }, null, state, null, { x: 175, y: 125 });
  handleDrawingPointerMove({ clientX: 175, clientY: 125 }, null, state, { x: 175, y: 125 });
  const okUp2 = handleDrawingPointerUp({ clientX: 175, clientY: 125 }, null, state, null, { x: 175, y: 125 }, true);
  assert(okUp2 === true, 'Final pointerUp should finalize the arc');
  assert(state.shapes.length === 1, 'Arc shape should be created through drawing flow');

  console.log('arc-integration tests passed ✅');
})().catch(e => { console.error('arc-integration tests failed ❌', e); process.exit(1); });