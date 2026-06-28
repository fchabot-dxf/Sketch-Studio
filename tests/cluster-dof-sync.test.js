(async () => {
  const { analyzeConstraintStatus } = await import('#core/constraint-status.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Case 1: Coincident cluster sync -> all members inherit d0 when one is fixed
  {
    const joints = new Map();
    joints.set('j_origin', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 0, y: 0, fixed: false });
    joints.set('c', { x: 0, y: 0, fixed: false });
    const constraints = [
      { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['j_origin','b'] },
      { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['b','c'] }
    ];
    const status = analyzeConstraintStatus({ joints, shapes: [], constraints });
    assert(status.jointDOFs.get('b') === 0, 'Cluster member b should be d0');
    assert(status.jointDOFs.get('c') === 0, 'Cluster member c should be d0 (propagated)');
  }

  // Case 2: Two horizontal anchors -> same-axis locks must not collapse DOF to 0
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 20, y: 0, fixed: true });
    joints.set('p', { x: 10, y: 5, fixed: false });
    const constraints = [
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a','p'] },
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['b','p'] }
    ];
    const status = analyzeConstraintStatus({ joints, shapes: [], constraints });
    // p should be locked in Y but free in X => d1
    const dofP = status.jointDOFs.get('p');
    assert(dofP === 1, `Expected p.dof === 1 (sliding along X) but got d${dofP}`);
  }

  // Case 3: Cluster where one member is reduced to d1 by a relative constraint -> all cluster members must report d1
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: true });
    joints.set('b', { x: 0, y: 0, fixed: false });
    joints.set('c', { x: 0, y: 0, fixed: false });
    const constraints = [
      { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['b','c'] },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','b'], value: 0 }
    ];
    const status = analyzeConstraintStatus({ joints, shapes: [], constraints });
    // Distance to fixed a reduces b to d1, cluster sync should set c to same
    assert(status.jointDOFs.get('b') === 1, 'b should be d1');
    assert(status.jointDOFs.get('c') === 1, 'c should inherit d1 via coincident cluster');
  }

  console.log('cluster DOF synchronization tests passed ✅');
})().catch(e => { console.error('cluster DOF sync tests failed ❌', e); process.exit(1); });