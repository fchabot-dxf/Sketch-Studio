(async () => {
  const { analyzeConstraintStatus } = await import('#core/constraint-status.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Triangle rooted at origin
  const joints = new Map();
  joints.set('j_origin', { x: 0, y: 0, fixed: true });
  joints.set('px', { x: 3, y: 0, fixed: false });
  joints.set('pd', { x: 2, y: 2, fixed: false });

  const constraints = [
    // px is constrained horizontally to origin and has a distance to origin
    { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['j_origin','px'] },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j_origin','px'], value: 3.0 },
    // pd is constrained by two distances (origin->pd and px->pd)
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j_origin','pd'], value: Math.sqrt(8) },
    { type: CONSTRAINT_TYPES.DISTANCE, joints: ['px','pd'], value: Math.sqrt(2) }
  ];

  const status = analyzeConstraintStatus({ joints, shapes: [], constraints });
  console.log('DEBUG status.jointDOFs:', Array.from(status.jointDOFs.entries()));
  console.log('DEBUG radialConstraints:', (status.radialConstraints && Array.from(status.radialConstraints.entries()).map(([k,s])=>[k,Array.from(s)])));

  // 1) origin is grounded
  assert(status.jointDOFs.get('j_origin') === 0, 'origin should be d0');

  // 2) px: lockedY from horizontal + radial distance -> d0
  const pxd = status.jointDOFs.get('px');
  assert(pxd === 0, `px should be d0 but is d${pxd}`);
  assert(status.lockedAxisY.has('px'), 'px should have lockedAxisY');
  const pxRad = (status.radialConstraints.get('px') || new Set()).size;
  assert(pxRad >= 1, 'px should have at least one radial constraint counted');

  // 3) pd: two radial constraints -> d0
  const pdd = status.jointDOFs.get('pd');
  assert(pdd === 0, `pd should be d0 but is d${pdd}`);
  const pdRad = (status.radialConstraints.get('pd') || new Set()).size;
  assert(pdRad >= 2, `pd should report 2 radial constraints (got ${pdRad})`);

  console.log('hybrid-propagation tests passed ✅');
})().catch(e => { console.error('hybrid-propagation test failed ❌', e); process.exit(1); });