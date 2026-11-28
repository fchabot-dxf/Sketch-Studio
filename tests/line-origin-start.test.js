(async () => {
  const { handleLinePointerDown, handleLinePointerUp } = await import('#ui/input-handlers/line-tool.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal app state with origin joint
  let counter = 1;
  const state = {
    joints: new Map(),
    shapes: [],
    constraints: [],
    genJ: () => 'j' + (counter++),
    beginUndoGroup: () => {}, beginDrawStep: () => {}, closeDrawStep: () => 'none', isUndoGroupOpen: () => false, captureUndoSnapshot: () => ({}),
    endUndoGroup: () => {},
    saveState: () => {}
  };
  state.joints.set('j_origin', { x: 0, y: 0, fixed: true });

  // Simulate pointer down at origin (snap target)
  const downEvent = { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  const hitSnap = { type: 'joint', targetId: 'j_origin', pt: { x: 0, y: 0 }, isLocked: true };
  const okDown = handleLinePointerDown(downEvent, null, state, hitSnap, { x: 0, y: 0 });
  assert(okDown === true, 'handleLinePointerDown should handle a click at origin');
  // TASK 1045 (Fusion measured 2026-11-27: a line start at the origin is a separate point + Coincident): the start is snapped to the origin, not the origin itself
  assert(state.active && state.active.startSnapTarget && state.active.startSnapTarget.targetId === 'j_origin' && state.active.startPt.x === 0 && state.active.startPt.y === 0, 'the start is snapped onto j_origin');

  // Simulate pointer up to create a line end at x=100,y=0
  const upEvent = { clientX: 100, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  // PointerUp releases away from the origin, so there should be no snap at the release point.
  const okUp = handleLinePointerUp(upEvent, null, state, null, { x: 100, y: 0 }, false);
  assert(okUp === true, 'handleLinePointerUp should return true');
  assert(state.shapes.length === 1, 'A new line shape should be created');
  const s = state.shapes[0];
  assert(s.type === 'line', 'Shape should be a line');
  assert(s.joints[0] !== 'j_origin' && state.constraints.some((c) => c.type === 'coincident' && c.joints.includes('j_origin') && c.joints.includes(s.joints[0])), 'Line start is its own joint glued to j_origin by a coincident');
  console.log('line-origin-start tests passed ✅');
})().catch(e => { console.error('line-origin-start tests failed ❌', e); process.exit(1); });