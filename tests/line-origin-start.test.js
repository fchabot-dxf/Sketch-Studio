(async () => {
  const { handleLinePointerDown, handleLinePointerUp } = await import('../src/ui/input-handlers/line-tool.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal app state with origin joint
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
  state.joints.set('j_origin', { x: 0, y: 0, fixed: true });

  // Simulate pointer down at origin (snap target)
  const downEvent = { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  const hitSnap = { type: 'joint', targetId: 'j_origin', pt: { x: 0, y: 0 }, isLocked: true };
  const okDown = handleLinePointerDown(downEvent, null, state, hitSnap, { x: 0, y: 0 });
  assert(okDown === true, 'handleLinePointerDown should handle a click at origin');
  assert(state.active && state.active.start === 'j_origin', 'Active start should be j_origin when starting on origin');

  // Simulate pointer up to create a line end at x=100,y=0
  const upEvent = { clientX: 100, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  // PointerUp releases away from the origin, so there should be no snap at the release point.
  const okUp = handleLinePointerUp(upEvent, null, state, null, { x: 100, y: 0 }, false);
  assert(okUp === true, 'handleLinePointerUp should return true');
  assert(state.shapes.length === 1, 'A new line shape should be created');
  const s = state.shapes[0];
  assert(s.type === 'line', 'Shape should be a line');
  assert(s.joints[0] === 'j_origin', 'Line start joint should be j_origin');
  console.log('line-origin-start tests passed ✅');
})().catch(e => { console.error('line-origin-start tests failed ❌', e); process.exit(1); });