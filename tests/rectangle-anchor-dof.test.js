(async () => {
  const { analyzeConstraintStatus } = await import('#core/constraint-status.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Rectangle anchored only at origin: non-origin corners should be d1 (slide along X or Y)
  const joints = new Map();
  joints.set('j_origin', { x: 0, y: 0, fixed: true });
  joints.set('j_br', { x: 3, y: 0, fixed: false });
  joints.set('j_tr', { x: 3, y: 2, fixed: false });
  joints.set('j_tl', { x: 0, y: 2, fixed: false });

  const constraints = [
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['j_origin','j_br'] },
    { type: CONSTRAINT_TYPES.VERTICAL, joints: ['j_origin','j_tl'] },
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['j_tl','j_tr'] },
    { type: CONSTRAINT_TYPES.VERTICAL, joints: ['j_br','j_tr'] }
  ];

  const status = analyzeConstraintStatus({ joints, shapes: [], constraints });
  assert(status.jointDOFs.get('j_origin') === 0, 'origin should be d0');
  assert(status.jointDOFs.get('j_tl') === 1, `top-left should be d1 but got d${status.jointDOFs.get('j_tl')}`);
  assert(status.jointDOFs.get('j_br') === 1, `bottom-right should be d1 but got d${status.jointDOFs.get('j_br')}`);

  // Test with width and height dimensions added: all shapes must be rigid (black) and all corners d0
  const shapes = [
    { id: 's_bottom', type: 'line', joints: ['j_origin', 'j_br'] },
    { id: 's_right', type: 'line', joints: ['j_br', 'j_tr'] },
    { id: 's_top', type: 'line', joints: ['j_tl', 'j_tr'] },
    { id: 's_left', type: 'line', joints: ['j_origin', 'j_tl'] }
  ];
  const fullyConstrainedConstraints = [
    ...constraints,
    { type: CONSTRAINT_TYPES.DISTANCE, shape: 's_bottom', joints: ['j_origin', 'j_br'], value: 3 },
    { type: CONSTRAINT_TYPES.DISTANCE, shape: 's_right', joints: ['j_br', 'j_tr'], value: 2 }
  ];

  const fullStatus = analyzeConstraintStatus({ joints, shapes, constraints: fullyConstrainedConstraints });
  for (const [jid] of joints) {
    assert(fullStatus.jointDOFs.get(jid) === 0, `joint ${jid} should be d0 but got d${fullStatus.jointDOFs.get(jid)}`);
  }
  assert(fullStatus.fixedShapes.size === 4, `All 4 lines should be in fixedShapes (black) but got ${fullStatus.fixedShapes.size}`);

  console.log('rectangle-anchor-dof test passed ✅');
})().catch(e => { console.error('rectangle-anchor-dof test failed ❌', e); process.exit(1); });
