(async () => {
  const { analyzeConstraintStatus } = await import('../src/core/constraint-status.js');
  const { CONSTRAINT_TYPES } = await import('../src/core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // 1) distance -> anchored fixed => neighbor becomes radialLocked and d1
  const joints1 = new Map();
  joints1.set('a', { x: 0, y: 0, fixed: true });
  joints1.set('b', { x: 10, y: 0 });
  const constraints1 = [ { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a','b'] } ];
  const s1 = analyzeConstraintStatus({ joints: joints1, shapes: [], constraints: constraints1 });
  assert(s1.radialLocked.has('b'), 'Expected b to be radialLocked when distance to fixed a');
  assert(s1.jointDOFs.get('b') === 1, `Expected b to be d1 (was d${s1.jointDOFs.get('b')})`);

  // 2) distance between two free joints -> no radial lock
  const joints2 = new Map();
  joints2.set('p', { x: 0, y: 0 });
  joints2.set('q', { x: 5, y: 0 });
  const constraints2 = [ { type: CONSTRAINT_TYPES.DISTANCE, joints: ['p','q'] } ];
  const s2 = analyzeConstraintStatus({ joints: joints2, shapes: [], constraints: constraints2 });
  assert(!s2.radialLocked.has('p') && !s2.radialLocked.has('q'), 'Neither joint should be radialLocked when both endpoints are free');
  assert(s2.jointDOFs.get('p') === 2 && s2.jointDOFs.get('q') === 2, 'Both joints should remain d2 for free distance constraint');

  // 3) radius constraint (circle) with fixed center -> rim becomes radialLocked and d1
  const joints3 = new Map();
  joints3.set('c', { x: 0, y: 0, fixed: true });
  joints3.set('r', { x: 10, y: 0 });
  const shapes3 = [ { id: 'C1', type: 'circle', joints: ['c','r'] } ];
  const constraints3 = [ { type: CONSTRAINT_TYPES.DISTANCE, isRadius: true, shape: 'C1' } ];
  const s3 = analyzeConstraintStatus({ joints: joints3, shapes: shapes3, constraints: constraints3 });
  assert(s3.radialLocked.has('r'), 'Rim should be radialLocked when circle center is fixed');
  assert(s3.jointDOFs.get('r') === 1, `Expected rim to be d1 (was d${s3.jointDOFs.get('r')})`);

  console.log('radial-locked tests passed ✅');
})().catch(e => { console.error('radial-locked test failed ❌', e); process.exit(1); });