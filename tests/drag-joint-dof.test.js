(async () => {
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal state with a single free joint (DOF should be 2)
  const state = {
    joints: new Map(),
    shapes: [],
    constraints: [],
    selectedJoints: new Set(),
    selectedShapes: new Set(),
    selectedConstraints: new Set(),
    beginUndoGroup: () => {},
    endUndoGroup: () => {},
    saveState: () => {},
    currentTool: 'select'
  };

  // Free joint (no constraints) => effectively 2 DOF
  state.joints.set('j_free', { x: 10, y: 10, fixed: false });

  // Minimal svg shim for coordinate transforms
  const svg = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    viewBox: { baseVal: { x: 0, y: 0, width: 200, height: 200 } },
    setPointerCapture: () => {},
    releasePointerCapture: () => {}
  };

  // Simulate pointer down on the free joint
  const down = { clientX: 10, clientY: 10, pointerId: 1, target: { closest: () => null, dataset: {} } };
  const hitJoint = { id: 'j_free', j: state.joints.get('j_free') };
  const okDown = handleSelectionPointerDown(down, svg, state, hitJoint, null, null);
  assert(okDown === true, 'pointerDown should start joint drag');
  assert(state.drag && state.drag.type === 'joint', 'drag state should be a joint drag');
  assert(state.drag.jointIds.includes('j_free'), 'drag jointIds should include j_free');

  // Simulate pointer move sufficiently large to be considered a drag
  const move = { clientX: 30, clientY: 10 };
  const moved = handleSelectionPointerMove(move, svg, state);
  assert(moved === true, 'pointerMove should be handled');

  // After move, the joint should have a dragTarget (move applied) and x should have changed
  const j = state.joints.get('j_free');
  assert(j.dragTarget, 'dragTarget should be set for draggable joint');
  assert(typeof j.dragTarget.x === 'number' && j.dragTarget.x !== 10, 'dragTarget.x should reflect movement');

  console.log('drag-joint-dof test passed ✅');
})().catch(e => { console.error('drag-joint-dof test failed ❌', e); process.exit(1); });