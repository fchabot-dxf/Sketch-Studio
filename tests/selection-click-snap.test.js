(async () => {
  const { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } = await import('../apps/sketchstudio/ui/input-handlers/selection-tools.js');
  const { TOOL_MODES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal fake SVG: 1:1 world<->screen mapping
  const svg = { getBoundingClientRect: () => ({ width: 100, height: 100 }), viewBox: { baseVal: { x:0,y:0,width:100,height:100 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

  // Helper to create fresh state
  function makeState(){
    return { currentTool: TOOL_MODES.SELECT, joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), beginUndoGroup: () => {}, saveState: () => {}, endUndoGroup: () => {} };
  }

  // Test 1: Click on a joint near another joint should NOT create a coincident constraint
  {
    const state = makeState();
    state.joints.set('j1', { x: 50, y: 50 });
    state.joints.set('j2', { x: 52, y: 50 }); // nearby joint

    // Simulate pointer down on j1
    const eDown = { clientX: 50, clientY: 50, pointerId: 1, target: { closest: () => null }, shiftKey: false };
    handleSelectionPointerDown(eDown, svg, state, { id: 'j1', j: state.joints.get('j1') }, null, null);

    // Simulate immediate pointer up at same location (no meaningful movement)
    const eUp = { clientX: 50, clientY: 50, pointerId: 1 };
    handleSelectionPointerUp(eUp, svg, state);

    // No coincident constraints should be created
    const c = state.constraints.find(c => c.type === 'coincident');
    assert(!c, 'Click should NOT create coincident constraint');
  }

  // Test 2: Dragging the joint close enough to the target (within FORCE_PX) should create a snap/coincident constraint on release
  {
    const state = makeState();
    state.joints.set('j1', { x: 50, y: 50 });
    state.joints.set('j2', { x: 52, y: 50 }); // nearby joint

    const eDown = { clientX: 50, clientY: 50, pointerId: 2, target: { closest: () => null }, shiftKey: false };
    handleSelectionPointerDown(eDown, svg, state, { id: 'j1', j: state.joints.get('j1') }, null, null);

    // Simulate an initial move beyond threshold, then move back into j2's lock radius
    const { findSnap } = await import('#ui/snap-detection.js');
    const eMove1 = { clientX: 65, clientY: 50, pointerId: 2 };
    // Simulate unified snap detection as input-manager would
    state.lastMouse = { x: eMove1.clientX, y: eMove1.clientY };
    const snap1 = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
    state.snapTarget = snap1 ? { type: snap1.type, targetId: snap1.targetId || snap1.id || null, pt: snap1.pt || (snap1.x !== undefined ? { x: snap1.x, y: snap1.y } : null), x: snap1.x, y: snap1.y, shape: snap1.shape } : null;
    state.activeSnap = state.snapTarget;
    handleSelectionPointerMove(eMove1, svg, state);

    const eMove2 = { clientX: 52, clientY: 50, pointerId: 2 };
    state.lastMouse = { x: eMove2.clientX, y: eMove2.clientY };
    const snap2 = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
    state.snapTarget = snap2 ? { type: snap2.type, targetId: snap2.targetId || snap2.id || null, pt: snap2.pt || (snap2.x !== undefined ? { x: snap2.x, y: snap2.y } : null), x: snap2.x, y: snap2.y, shape: snap2.shape } : null;
    state.activeSnap = state.snapTarget;
    handleSelectionPointerMove(eMove2, svg, state);

    // Release - should apply the snap we saw visually (locked during the final move)
    const eUp = { clientX: 52, clientY: 50, pointerId: 2 };
    handleSelectionPointerUp(eUp, svg, state);

    const c = state.constraints.find(c => c.type === 'coincident');
    assert(!!c, 'Drag release inside lock radius should create coincident constraint');
    // Ensure the coincident references j1 (dragged) and j2 (nearby target)
    const involves = c.joints && (c.joints.includes('j1') && (c.joints.includes('j2') || c.joints.length === 2));
    assert(involves, 'Coincident should reference dragged joint and nearby joint');
  }

  // Test 3: Dragging but NOT locking (far from target) should NOT create a constraint
  {
    const state = makeState();
    state.joints.set('j1', { x: 50, y: 50 });
    state.joints.set('j2', { x: 52, y: 50 }); // nearby joint

    const eDown = { clientX: 50, clientY: 50, pointerId: 3, target: { closest: () => null }, shiftKey: false };
    handleSelectionPointerDown(eDown, svg, state, { id: 'j1', j: state.joints.get('j1') }, null, null);

    // Move far away from target, no visual lock will appear
    const { findSnap } = await import('#ui/snap-detection.js');
    const eMove = { clientX: 80, clientY: 50, pointerId: 3 };
    state.lastMouse = { x: eMove.clientX, y: eMove.clientY };
    const snap = findSnap(state.joints, state.shapes, svg, state.lastMouse, [], false, false, 1.0);
    state.snapTarget = snap ? { type: snap.type, targetId: snap.targetId || snap.id || null, pt: snap.pt || (snap.x !== undefined ? { x: snap.x, y: snap.y } : null), x: snap.x, y: snap.y, shape: snap.shape } : null;
    state.activeSnap = state.snapTarget;
    handleSelectionPointerMove(eMove, svg, state);

    const eUp = { clientX: 80, clientY: 50, pointerId: 3 };
    handleSelectionPointerUp(eUp, svg, state);

    const c = state.constraints.find(c => c.type === 'coincident');
    assert(!c, 'Drag release without lock should NOT create coincident constraint');
  }

  console.log('selection-click-snap tests passed ✅');
})().catch(e => { console.error('selection-click-snap tests failed ❌', e); process.exit(1); });