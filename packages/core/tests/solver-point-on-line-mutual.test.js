// pointOnLine `mutual` flag: the point AND the line endpoints participate in the Jacobian (a virtual-sharp
// joint V on a fillet's trimmed lines must be able to FOLLOW the lines when the radius is edited).
// Without the flag the Jacobian must stay the legacy point-only form (rect-from-center diagonals and snap
// constraints rely on it).
(async () => {
  const { Definitions } = await import('#core/solver/definitions.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const def = Definitions.pointOnLine;
  const pos = new Float64Array([1.3, 2.1, 4.2, -0.7, 9.1, 3.3]); // P, A, B

  // 1. default (no flag): legacy Jacobian, endpoint columns exactly zero, point column unchanged
  {
    const row = new Float64Array(6); def.computeJacobian({ joints: [0, 1, 2] }, pos, row);
    assert(row[2] === 0 && row[3] === 0 && row[4] === 0 && row[5] === 0, 'legacy form: endpoint columns must be exactly 0');
    const ux = 9.1 - 4.2, uy = 3.3 + 0.7, d = Math.hypot(ux, uy);
    assert(Math.abs(row[0] - uy / d) < 1e-15 && Math.abs(row[1] + ux / d) < 1e-15, 'legacy form: point column unchanged');
  }

  // 2. mutual: matches finite differences in all six columns
  {
    const params = { joints: [0, 1, 2], mutual: true };
    const row = new Float64Array(6); def.computeJacobian(params, pos, row);
    for (let i = 0; i < 6; i++) {
      const p = pos.slice(); p[i] += 1e-6; const q = pos.slice(); q[i] -= 1e-6;
      const fd = (def.computeError(params, p) - def.computeError(params, q)) / 2e-6;
      assert(Math.abs(fd - row[i]) < 1e-6, `mutual column ${i}: analytic ${row[i]} vs fd ${fd}`);
    }
  }

  // 3. behaviour: V must follow a line whose endpoint is driven. A=(0,0) fixed, B=(10,0) driven to (10,5)
  //    by a distance; V constrained on AB (mutual) and tied to B's x -> V.y must follow the tilted line.
  for (const mutual of [true, false]) {
    const joints = new Map([
      ['A', { x: 0, y: 0, fixed: true }], ['B', { x: 10, y: 0, fixed: false }], ['V', { x: 5, y: 0, fixed: false }]]);
    const shapes = [{ id: 'L', type: 'line', joints: ['A', 'B'] }];
    const constraints = [
      { type: 'vertical', joints: ['B', 'V'] },                    // V.x == B.x  -> V sits at B's x
      { type: 'distance', joints: ['A', 'B'], value: Math.hypot(10, 5) }, // |AB| fixed
      { type: 'pointOnLine', joint: 'V', shape: 'L', ...(mutual ? { mutual: true } : {}) },
      { type: 'distance', joints: ['B', 'V'], value: 0 },
    ];
    const eng = createNewtonSolver(joints, constraints, shapes, {});
    const r = eng.solve(300);
    const B = joints.get('B'), V = joints.get('V');
    const onLine = Math.abs(V.x * B.y - V.y * B.x) / Math.hypot(B.x, B.y);
    if (mutual) assert(r.converged !== false && onLine < 1e-6, 'mutual: V stays on the line while the endpoint moves');
  }
  console.log('solver-point-on-line-mutual test passed ✅');
})().catch(e => { console.error('solver-point-on-line-mutual test failed ❌', e.message); process.exit(1); });
