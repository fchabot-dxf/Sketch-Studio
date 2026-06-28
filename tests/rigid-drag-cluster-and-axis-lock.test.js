(async () => {
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('#ui/input-handlers/selection-tools.js');
  const { ConstraintManager } = await import('#core/constraint-manager.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // --- Case 1: Cluster contains a 0-DOF joint (propagate full lock to cluster) ---
  {
    const state = { joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), selectedShapes: new Set(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, currentTool: 'select' };
    // j_origin (anchored) + b coincident to origin + c coincident to b (cluster)
    state.joints.set('j_origin', { x: 0, y: 0, fixed: true });
    state.joints.set('b', { x: 0, y: 0, fixed: false });
    state.joints.set('c', { x: 10, y: 0, fixed: false });
    state.constraints.push({ type: CONSTRAINT_TYPES.COINCIDENT, joints: ['j_origin', 'b'] });
    state.constraints.push({ type: CONSTRAINT_TYPES.COINCIDENT, joints: ['b', 'c'] });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0,y:0,width:200,height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    // Start drag on member 'c' (cluster should include b and c)
    const down = { clientX: 10, clientY: 0, pointerId: 1, target: { closest: () => null, dataset: {} } };
    const okDown = handleSelectionPointerDown(down, svg, state, { id: 'c', j: state.joints.get('c') }, null, null);
    assert(okDown, 'pointerDown should start cluster drag');
    // Simulate move that would normally translate the cluster
    const move = { clientX: 50, clientY: 20 };
    handleSelectionPointerMove(move, svg, state);

    // Because cluster contains a 0DOF (origin-propagated), both b and c must remain unchanged (drag masked)
    const b = state.joints.get('b');
    const c = state.joints.get('c');
    assert(b.dragTarget && Math.abs(b.dragTarget.x - 0) < 1e-9 && Math.abs(b.dragTarget.y - 0) < 1e-9, 'Cluster member b should not move (masked)');
    assert(c.dragTarget && Math.abs(c.dragTarget.x - 10) < 1e-9 && Math.abs(c.dragTarget.y - 0) < 1e-9, 'Cluster member c should not move (masked)');
  }

  // --- Case 2: Horizontal constraint should lock vertical movement (lockY) ---
  {
    const state = { joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), selectedShapes: new Set(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, currentTool: 'select' };
    state.joints.set('a', { x: 0, y: 0, fixed: false });
    state.joints.set('b', { x: 10, y: 0, fixed: false });
    // Add Horizontal constraint between a and b (floating assembly)
    state.constraints.push({ type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a','b'] });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0,y:0,width:200,height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    // Drag joint 'b' in a predominantly vertical direction — Y should be masked only if grounded; here assembly is floating so movement allowed
    const down = { clientX: 10, clientY: 0, pointerId: 1, target: { closest: () => null, dataset: {} } };
    handleSelectionPointerDown(down, svg, state, { id: 'b', j: state.joints.get('b') }, null, null);
    const move = { clientX: 10, clientY: 50 }; // large vertical move
    handleSelectionPointerMove(move, svg, state);

    const b = state.joints.get('b');
    // For a *floating* horizontal assembly, the assembly should move — vertical movement is allowed
    assert(b.dragTarget, 'dragTarget should be set');
    assert(Math.abs(b.dragTarget.y - 0) > 1e-9, `Vertical movement should be allowed for floating H constraint (y=${b.dragTarget.y})`);

  }

  // --- Case 3: Anchored vertical line should lock X (corner cluster d1, slide in Y) ---
  {
    const state = { joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), selectedShapes: new Set(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, currentTool: 'select' };
    // Origin anchored vertical line: origin (fixed) and v1 are vertically aligned
    state.joints.set('j_origin', { x: 0, y: 0, fixed: true });
    state.joints.set('v1', { x: 0, y: 10, fixed: false });
    // Corner is coincident with v1 and is start of a bottom horizontal segment to h1
    state.joints.set('corner', { x: 0, y: 0, fixed: false });
    state.joints.set('h1', { x: 12, y: 0, fixed: false });

    // Coincident corner-v1, horizontal between corner and h1, vertical anchors origin-v1
    state.constraints.push({ type: CONSTRAINT_TYPES.COINCIDENT, joints: ['corner','v1'] });
    state.constraints.push({ type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['corner','h1'] });
    state.constraints.push({ type: CONSTRAINT_TYPES.VERTICAL, joints: ['j_origin','v1'] });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0,y:0,width:200,height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    // Drag the corner: X should be locked (corner stays at x=0), Y should be allowed (slide vertically)
    const down2 = { clientX: 0, clientY: 0, pointerId: 1, target: { closest: () => null, dataset: {} } };
    handleSelectionPointerDown(down2, svg, state, { id: 'corner', j: state.joints.get('corner') }, null, null);
    const move2 = { clientX: 50, clientY: 30 };
    handleSelectionPointerMove(move2, svg, state);

    const corner = state.joints.get('corner');
    assert(corner.dragTarget, 'corner dragTarget should be set');
    // X must remain locked (due to vertical anchoring via v1->origin)
    assert(Math.abs(corner.dragTarget.x - 0) < 1e-9, `Corner X should be locked by anchored vertical (x=${corner.dragTarget.x})`);
    // Y should be free (sliding)
    assert(Math.abs(corner.dragTarget.y - 0) > 1e-9, `Corner Y should be allowed to change (y=${corner.dragTarget.y})`);

  }

  console.log('rigid drag (cluster 0DOF + H/V axis lock) tests passed ✅');
})().catch(e => { console.error('rigid drag tests failed ❌', e); process.exit(1); });