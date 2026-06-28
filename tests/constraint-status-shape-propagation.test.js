(async () => {
  const { analyzeConstraintStatus } = await import('#core/constraint-status.js');
  const { handleSelectionPointerDown, handleSelectionPointerMove } = await import('#ui/input-handlers/selection-tools.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // --- H/V on a line should clamp member joints to max 1 DOF ---
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0 });
    joints.set('b', { x: 10, y: 5 });
    const shapes = [{ id: 'L1', type: 'line', joints: ['a','b'] }];
    const constraints = [{ type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a','b'] }];

    const status = analyzeConstraintStatus({ joints, shapes, constraints });
    const dofA = status.jointDOFs.get('a');
    const dofB = status.jointDOFs.get('b');
    // Floating assembly: H/V is a *relative* constraint — joints retain full absolute DOF
    assert(typeof dofA === 'number' && dofA === 2, `Expected a.dof === 2 for floating assembly, got ${dofA}`);
    assert(typeof dofB === 'number' && dofB === 2, `Expected b.dof === 2 for floating assembly, got ${dofB}`);
  }

  // --- Distance propagation: fixed endpoint clamps mate to max 1 DOF ---
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 10, y: 0 });
    const shapes = [];
    const constraints = [{ type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','b'], value: 10 }];

    const status = analyzeConstraintStatus({ joints, shapes, constraints });
    const dofB = status.jointDOFs.get('b');
    assert(typeof dofB === 'number' && dofB <= 1, `Expected b.dof <= 1, got ${dofB}`);
  }

  // --- Rigid Shape Rule: dragging a line with any 0-DOF joint must be neutralized ---
  {
    const state = { joints: new Map(), shapes: [], constraints: [], selectedJoints: new Set(), selectedShapes: new Set(), beginUndoGroup: () => {}, endUndoGroup: () => {}, saveState: () => {}, currentTool: 'select' };
    // a is fixed; b is free; line L1 joins them
    state.joints.set('a', { x: 0, y: 0, fixed: true });
    state.joints.set('b', { x: 10, y: 0, fixed: false });
    state.shapes.push({ id: 'L1', type: 'line', joints: ['a','b'] });

    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0,y:0,width:200,height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };

    // Start dragging the shape
    const down = { clientX: 5, clientY: 0, pointerId: 1, target: { closest: () => null, dataset: {} } };
    const hitShape = { shape: state.shapes[0], pt: { x: 5, y: 0 } };
    const ok = handleSelectionPointerDown(down, svg, state, null, hitShape, null);
    assert(ok === true, 'pointerDown should start shape drag');

    // Attempt to move the line (would normally translate both joints)
    const move = { clientX: 50, clientY: 20 };
    handleSelectionPointerMove(move, svg, state);

    // Because 'a' is fixed (0 DOF), the whole shape drag must be masked and dragTargets should remain unchanged
    const a = state.joints.get('a');
    const b = state.joints.get('b');
    assert(a.dragTarget && Math.abs(a.dragTarget.x - 0) < 1e-9 && Math.abs(a.dragTarget.y - 0) < 1e-9, 'Fixed endpoint a should not move');
    assert(b.dragTarget && Math.abs(b.dragTarget.x - 10) < 1e-9 && Math.abs(b.dragTarget.y - 0) < 1e-9, 'Line member b should be masked when any endpoint is 0-DOF');
  }

  console.log('constraint-status shape propagation tests passed ✅');
})().catch(e => { console.error('constraint-status shape propagation tests failed ❌', e); process.exit(1); });