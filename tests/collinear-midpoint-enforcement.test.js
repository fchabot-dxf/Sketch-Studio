(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const { CONSTRAINT_TYPES } = await import('#core/constants.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Midpoint (joint-based) — midpoint joint should move to the average of endpoints
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 10, y: 0, fixed: false });
    joints.set('m', { x: 8, y: 5, fixed: false });
    const constraints = [{ type: CONSTRAINT_TYPES.MIDPOINT, joints: ['a','b','m'] }];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 30, tol: 1e-9 });
    const res = solver.solve(30);
    assert(res.converged, 'midpoint solve did not converge');
    const mpt = joints.get('m');
    assert(Math.hypot(mpt.x - 5, mpt.y - 0) < 1e-6, `midpoint not at center: ${mpt.x},${mpt.y}`);
  }

  // Collinear (joint-based): third joint should be projected to the AB line
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 10, y: 0, fixed: false });
    joints.set('c', { x: 5, y: 2, fixed: false });
    const constraints = [{ type: CONSTRAINT_TYPES.COLLINEAR, joints: ['a','b','c'] }];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 30, tol: 1e-9 });
    const res = solver.solve(30);
    assert(res.converged, 'collinear (joints) did not converge');
    const c = joints.get('c');
    assert(Math.abs(c.y - 0) < 1e-6, `joint c not moved onto line: y=${c.y}`);
  }

  // Collinear (shape-based): both joints of second line should snap onto first line
  {
    const joints = new Map();
    joints.set('a', { x: 0, y: 0, fixed: false });
    joints.set('b', { x: 10, y: 0, fixed: false });
    joints.set('c', { x: 0, y: 1, fixed: false });
    joints.set('d', { x: 10, y: 1, fixed: false });
    const shapes = [ { id: 'l1', type: 'line', joints: ['a','b'] }, { id: 'l2', type: 'line', joints: ['c','d'] } ];
    const constraints = [ { type: CONSTRAINT_TYPES.COLLINEAR, shapes: ['l1','l2'] } ];
    const solver = createNewtonSolver(joints, constraints, shapes, { maxIter: 60, tol: 1e-9 });
    const res = solver.solve(60);
    assert(res.converged, 'collinear (shapes) did not converge');
    const cpt = joints.get('c'), dpt = joints.get('d');
    assert(Math.abs(cpt.y - 0) < 1e-6 && Math.abs(dpt.y - 0) < 1e-6, `shape joints not collinear after solve: c.y=${cpt.y}, d.y=${dpt.y}`);
  }

  console.log('collinear & midpoint solver enforcement tests passed ✅');
})().catch(e => { console.error('collinear/midpoint enforcement test failed ❌', e); process.exit(1); });