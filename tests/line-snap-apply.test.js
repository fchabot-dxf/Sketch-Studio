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

  // Pre-existing joint to snap to
  state.joints.set('j_exist', { x: 100, y: 0, fixed: false });

  // Start the line at origin (simulate starting on origin joint)
  const downEvent = { clientX: 0, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  const startSnap = { type: 'joint', targetId: 'j_origin', pt: { x: 0, y: 0 }, isLocked: true };
  // Prime state.active as if we clicked on origin
  handleLinePointerDown(downEvent, null, state, startSnap, { x: 0, y: 0 });

  // Simulate live preview having a snap to j_exist and being locked
  state.active.preview = state.active.preview || {};
  state.active.preview.snapTarget = { type: 'joint', targetId: 'j_exist', pt: { x: 100, y: 0 }, isLocked: true };

  // Now release pointer at roughly the same place (would create an end joint snapped to j_exist)
  const upEvent = { clientX: 100, clientY: 0, pointerId: 1, pointerType: 'mouse' };
  const okUp = handleLinePointerUp(upEvent, null, state, null, { x: 100, y: 0 }, false);
  assert(okUp === true, 'handleLinePointerUp should return true');
  assert(state.shapes.length === 1, 'A new line shape should be created');

  // Confirm a coincident constraint to j_exist was applied (constraints include COINCIDENT between end and j_exist)
  const coincident = state.constraints.find(c => c.type === 'coincident' && c.joints && c.joints.includes('j_exist'));
  assert(coincident, 'A coincident constraint to j_exist should have been created');

  console.log('line-snap-apply tests passed ✅');
})().catch(e => { console.error('line-snap-apply tests failed ❌', e); process.exit(1); });