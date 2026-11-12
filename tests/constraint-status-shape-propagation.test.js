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

  // --- Body drag of a line with a FIXED end (task 538): the grabbed point (mid) follows the cursor as far as the constraints allow ---
  // The old rule masked the whole drag when any member joint was 0-DOF (nothing moved); like Fusion, the fixed end now stays and the
  // free end follows (the line stretches about the fixed end), the target lives on the SHAPE (no joint target), cleared on pointer-up.
  {
    const L = await import('./harness/audit/lib.js');
    const { SolverConfig } = await import('#core/solver-config.js');
    const { handleSelectionPointerUp } = await import('#ui/input-handlers/selection-tools.js');
    const S = L.newSketch(), state = S.state;
    const a = L.point(S, 0, 0), b = L.point(S, 10, 0);
    state.joints.get(a).fixed = true;
    const lineId = L.line(S, a, b);
    const svg = { getBoundingClientRect: () => ({ left:0, top:0, width:200, height:200 }), viewBox: { baseVal: { x:0,y:0,width:200,height:200 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
    state.currentTool = 'select'; state.selectedJoints = new Set(); state.selectedShapes = new Set(); state.selectedConstraints = new Set();
    const ev = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, target: { closest: () => null, dataset: {} } });
    const line = state.shapes.find(s => s.id === lineId);
    const ok = handleSelectionPointerDown(ev(5, 0), svg, state, null, { shape: line, pt: { x: 5, y: 0 } }, null);
    assert(ok === true, 'pointerDown should start shape drag');
    for (let i = 1; i <= 10; i++) { handleSelectionPointerMove(ev(5, 0.4 * i), svg, state); S.engine.solve(SolverConfig.ITERATIONS || 500); }
    assert(line.dragTarget && Math.abs(line.dragTarget.param - 0.5) < 1e-12, 'the body target is on the shape, grabbed at t = 0.5');
    assert(!state.joints.get(a).dragTarget && !state.joints.get(b).dragTarget, 'a body drag sets no joint target');
    handleSelectionPointerUp(ev(5, 4), svg, state); S.engine.solve(SolverConfig.ITERATIONS || 500);
    const A = state.joints.get(a), B = state.joints.get(b);
    assert(A.x === 0 && A.y === 0, 'the fixed end stays');
    assert(Math.abs(B.y - 8) < 1e-3 && Math.abs(B.x - 10) < 0.5, `the free end follows: the mid point went up 4, so the far end went up 8 (b = ${B.x}, ${B.y})`);
    assert(!line.dragTarget, 'pointer-up clears the body target');
  }

  console.log('constraint-status shape propagation tests passed ✅');
})().catch(e => { console.error('constraint-status shape propagation tests failed ❌', e); process.exit(1); });