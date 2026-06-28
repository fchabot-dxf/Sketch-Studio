(async () => {
  const { handleLinePointerDown, handleLinePointerMove, handleLinePointerUp } = await import('../apps/sketchstudio/ui/input-handlers/line-tool.js');
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

  // 1) Click (no drag) should confirm start without creating a shape
  // Simulate pointer down (start of a click)
  const down = { clientX: 0, clientY: 0 };
  const wStart = { x: 0, y: 0 };
  const okDown = handleLinePointerDown(down, null, state, null, wStart);
  assert(okDown === true, 'PointerDown should be handled');
  // Immediately pointer up without move => no drag
  const up = { clientX: 0, clientY: 0 };
  const wUp = { x: 10, y: 0 };
  const okUp = handleLinePointerUp(up, null, state, null, wUp, false);
  assert(okUp === true, 'PointerUp should be handled');
  // Since it was just a click, no new shape created, but we should have an active.start created
  assert(state.active && state.active.start, 'Click without drag should set an active.start joint');
  const shapesAfterClick = state.shapes.length;

  // 2) Drag should finalize a line and create a shape
  // Reset minimal active state to simulate a new start
  state.active = null; state.shapes = []; state.joints = new Map(); counter = 1;
  const okDown2 = handleLinePointerDown(down, null, state, null, wStart);
  assert(okDown2 === true, 'PointerDown2 should be handled');
  // Simulate pointer move exceeding threshold to mark drag
  const move = { clientX: 50, clientY: 0 };
  handleLinePointerMove(move, null, state, { x: 50, y: 0 });
  // Now pointer up should create a shape
  const okUp2 = handleLinePointerUp({ clientX: 50, clientY: 0 }, null, state, null, { x: 50, y: 0 }, true);
  assert(okUp2 === true, 'PointerUp after drag should be handled');
  assert(state.shapes.length === 1, 'A line shape should be created after a drag');

  console.log('line-drag tests passed ✅');
})().catch(e => { console.error('line-drag tests failed ❌', e); process.exit(1); });