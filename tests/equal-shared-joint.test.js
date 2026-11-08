(async () => {
  const { solveConstraints } = await import('#core/solver-core.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Two lines meeting at corner `o`, made equal by shape ids (3 distinct joints).
  const joints = new Map(Object.entries({
    o: { x: 0, y: 0, fixed: true },
    a: { x: 100, y: 0, fixed: true },
    b: { x: 0, y: 40 }
  }));
  const shapes = [
    { id: 'L1', type: 'line', joints: ['o', 'a'] },
    { id: 'L2', type: 'line', joints: ['o', 'b'] }
  ];
  const constraints = [{ type: CONSTRAINT_TYPES.EQUAL, shapes: ['L1', 'L2'] }];
  solveConstraints(joints, shapes, constraints, 500);

  const len = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const l1 = len(joints.get('o'), joints.get('a'));
  const l2 = len(joints.get('o'), joints.get('b'));
  assert(Math.abs(l1 - l2) < 1e-3, `equal on lines sharing a joint not held (L1=${l1.toFixed(3)} L2=${l2.toFixed(3)})`);
  console.log('equal-shared-joint OK', l1.toFixed(3), l2.toFixed(3));
})().catch(e => { console.error(e.message || e); process.exit(1); });
