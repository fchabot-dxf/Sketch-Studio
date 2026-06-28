(async () => {
  const { analyzeConstraintStatus } = await import('#core/constraint-status.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Case 1: distance to fixed anchor -> DOF 2 -> 1
  {
    const joints = new Map();
    joints.set('j_origin', { x: 0, y: 0, fixed: true });
    joints.set('p', { x: 10, y: 0 });
    const shapes = [];
    const constraints = [{ type: CONSTRAINT_TYPES.DISTANCE, joints: ['j_origin', 'p'], value: 10 }];

    const status = analyzeConstraintStatus({ joints, shapes, constraints });
    const dofP = status.jointDOFs.get('p');
    assert(typeof dofP === 'number' && dofP === 1, `Expected p.dof === 1 after distance-to-fixed, got ${dofP}`);
  }

  // Case 2: distance-to-fixed + horizontal-to-another-fixed -> DOF 1 -> 0 (additive)
  {
    const joints = new Map();
    joints.set('j_origin', { x: 0, y: 0, fixed: true });
    joints.set('f2', { x: 20, y: 0, fixed: true });
    joints.set('p', { x: 10, y: 0 });
    const shapes = [];
    const constraints = [
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j_origin', 'p'], value: 10 },
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['f2', 'p'] }
    ];

    const status = analyzeConstraintStatus({ joints, shapes, constraints });
    const dofP = status.jointDOFs.get('p');
    assert(typeof dofP === 'number' && dofP === 0, `Expected p.dof === 0 after additive constraints, got ${dofP}`);
  }

  // Case 3: line with one endpoint grounded + HV on same line -> other endpoint reduces
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 10, y: 1 });
    const shapes = [{ id: 'L', type: 'line', joints: ['a','b'] }];
    const constraints = [{ type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a','b'] }];

    const status = analyzeConstraintStatus({ joints, shapes, constraints });
    const dofB = status.jointDOFs.get('b');
    assert(typeof dofB === 'number' && dofB === 1, `Expected b.dof === 1 when line grounded at a (got ${dofB})`);
  }

  // Case 4: startup-triangle hypotenuse becomes d0 when both endpoints grounded
  {
    const joints = new Map();
    joints.set('j_origin', { x: 0, y: 0, fixed: true });
    joints.set('j1', { x: 3, y: 0, fixed: true });
    joints.set('j2', { x: 3, y: 4, fixed: false });
    // triangle edges: origin-j1 (fixed), j1-j2, j2-origin
    const constraints = [
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j_origin','j1'], value: 3 },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j1','j2'], value: 4 },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j2','j_origin'], value: 5 }
    ];

    const status = analyzeConstraintStatus({ joints, shapes: [], constraints });
    // with both j_origin and j1 fixed, the joint j2 is fully determined by distances -> d0
    const dofJ2 = status.jointDOFs.get('j2');
    assert(typeof dofJ2 === 'number' && dofJ2 === 0, `Expected j2.dof === 0 for grounded triangle, got ${dofJ2}`);
  }

  console.log('cascading-fixity tests passed ✅');
})().catch(e => { console.error('cascading-fixity tests failed ❌', e); process.exit(1); });