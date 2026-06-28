(async () => {
  const { handleLinePointerDown, handleLinePointerUp } = await import('../apps/sketchstudio/ui/input-handlers/line-tool.js');
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

  // Ensure origin exists (some tests expect it)
  state.joints.set('j_origin', { x: 0, y: 0, fixed: true });

  // Start a line at origin
  const downEvent = { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  const startSnap = { type: 'joint', targetId: 'j_origin', pt: { x: 0, y: 0 }, isLocked: true };
  handleLinePointerDown(downEvent, null, state, startSnap, { x: 0, y: 0 });

  // Simulate preview snap to grid position (locked)
  state.active.preview = state.active.preview || {};
  state.active.preview.snapTarget = { type: 'grid', pt: { x: 4, y: 0 }, isLocked: true };

  // Pointer up at grid => line created, but grid snap should not create a coincident constraint
  const upEvent = { clientX: 4, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  const okUp = handleLinePointerUp(upEvent, null, state, null, { x: 4, y: 0 }, false);
  assert(okUp === true, 'handleLinePointerUp should return true');
  assert(state.shapes.length === 1, 'A new line shape should be created');

  // The end joint should not have been constrained to a grid joint (grid snaps are visual only)
  const s = state.shapes[0];
  const endJointId = s.joints[1];
  // The line tool always creates an internal coincident between the end joint and the newly created start
  // for the next segment — that's expected. Ensure no *extra* coincident constraints were created by the grid snap.
  const coincidents = state.constraints.filter(c => c.type === 'coincident' && c.joints && c.joints.includes(endJointId));
  // Expect only the internal successor coincident (1)
  assert(coincidents.length === 1, 'Only internal coincident should exist; grid snap must not create extra coincident constraints');

  console.log('grid-snap-apply tests passed ✅');
})().catch(e => { console.error('grid-snap-apply tests failed ❌', e); process.exit(1); });