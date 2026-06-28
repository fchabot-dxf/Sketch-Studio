(async () => {
  const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp, resetSelectionState } = await import('#ui/input-handlers/selection-tools.js');
  const { findSnap } = await import('#ui/snap-detection.js');
  const { TOOL_MODES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const svg = { getBoundingClientRect: () => ({ width: 800, height: 600 }), viewBox: { baseVal: { x:0,y:0,width:800,height:600 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

  function makeState(){ return { currentTool: TOOL_MODES.SELECT, joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), beginUndoGroup: () => {}, saveState: () => {}, endUndoGroup: () => {} }; }

  // Cluster: A-B-C at same location with two constraints
  const state = makeState();
  state.joints.set('A', { x: 200, y: 200 });
  state.joints.set('B', { x: 200, y: 200 });
  state.joints.set('C', { x: 200, y: 200 });
  state.constraints = [{ type: 'coincident', joints: ['A','B'] }, { type: 'coincident', joints: ['B','C'] }];

  // A new joint D starts away and will be dragged into cluster
  state.joints.set('D', { x: 300, y: 200 });

  // Ensure transient selection/drag state is clear between tests
  resetSelectionState();

  // Pointer down on D
  const eDown = { clientX: 300, clientY: 200, pointerId: 5, target: { closest: () => null }, shiftKey: false };
  handleSelectionPointerDown(eDown, svg, state, { id: 'D', j: state.joints.get('D') }, null, null);

  // Simulate moving near cluster but first move must register drag
  const eMove1 = { clientX: 260, clientY: 200, pointerId: 5 };
  // Simulate central snap detection (input-manager normally does this)
  state.lastMouse = { x: eMove1.clientX, y: eMove1.clientY };
  const snap1 = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
  state.snapTarget = snap1 ? { type: snap1.type, targetId: snap1.targetId || snap1.id || null, pt: snap1.pt || (snap1.x !== undefined ? { x: snap1.x, y: snap1.y } : null), x: snap1.x, y: snap1.y, shape: snap1.shape } : null;
  state.activeSnap = state.snapTarget;
  handleSelectionPointerMove(eMove1, svg, state);

  // Now move into cluster location (200,200) to lock
  const eMove2 = { clientX: 200, clientY: 200, pointerId: 5 };
  state.lastMouse = { x: eMove2.clientX, y: eMove2.clientY };
  const snap2 = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
  state.snapTarget = snap2 ? { type: snap2.type, targetId: snap2.targetId || snap2.id || null, pt: snap2.pt || (snap2.x !== undefined ? { x: snap2.x, y: snap2.y } : null), x: snap2.x, y: snap2.y, shape: snap2.shape } : null;
  state.activeSnap = state.snapTarget;
  handleSelectionPointerMove(eMove2, svg, state);

  // Release should create D <-> (one member of cluster) coincident constraint
  const eUp = { clientX: 200, clientY: 200, pointerId: 5 };
  handleSelectionPointerUp(eUp, svg, state);

  const c = state.constraints.find(c => c.type === 'coincident' && (c.joints.includes('D')));
  assert(!!c, 'Dropping D into cluster should create a coincident constraint linking D to cluster');

  console.log('snap-to-cluster tests passed ✅');
})().catch(e => { console.error('snap-to-cluster tests failed ❌', e); process.exit(1); });