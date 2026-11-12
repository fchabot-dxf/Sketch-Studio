// pointOnLine: the point AND the line endpoints participate in the Jacobian (always; the old opt-in `mutual` flag is retired) (a virtual-sharp
// joint V on a fillet's trimmed lines must be able to FOLLOW the lines when the radius is edited).
(async () => {
  const { Definitions } = await import('#core/solver/definitions.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const def = Definitions.pointOnLine;
  const pos = new Float64Array([1.3, 2.1, 4.2, -0.7, 9.1, 3.3]); // P, A, B

  // 1. matches finite differences in all six columns
  {
    const params = { joints: [0, 1, 2] };
    const row = new Float64Array(6); def.computeJacobian(params, pos, row);
    for (let i = 0; i < 6; i++) {
      const p = pos.slice(); p[i] += 1e-6; const q = pos.slice(); q[i] -= 1e-6;
      const fd = (def.computeError(params, p) - def.computeError(params, q)) / 2e-6;
      assert(Math.abs(fd - row[i]) < 1e-6, `column ${i}: analytic ${row[i]} vs fd ${fd}`);
    }
  }

  // 2. behaviour: V must follow a line whose endpoint is driven. A=(0,0) fixed, B=(10,0) driven to (10,5)
  //    by a distance; V constrained on AB and tied to B's x -> V.y must follow the tilted line.
  // a SAVED file may still carry the retired `mutual: true` flag: it must load and behave the same (ignored).
  for (const legacyFlag of [false, true]) {
    const joints = new Map([
      ['A', { x: 0, y: 0, fixed: true }], ['B', { x: 10, y: 0, fixed: false }], ['V', { x: 5, y: 0, fixed: false }]]);
    const shapes = [{ id: 'L', type: 'line', joints: ['A', 'B'] }];
    const constraints = [
      { type: 'vertical', joints: ['B', 'V'] },                    // V.x == B.x  -> V sits at B's x
      { type: 'distance', joints: ['A', 'B'], value: Math.hypot(10, 5) }, // |AB| fixed
      { type: 'pointOnLine', joint: 'V', shape: 'L', ...(legacyFlag ? { mutual: true } : {}) },
      { type: 'distance', joints: ['B', 'V'], value: 0 },
    ];
    const eng = createNewtonSolver(joints, constraints, shapes, {});
    const r = eng.solve(300);
    const B = joints.get('B'), V = joints.get('V');
    const onLine = Math.abs(V.x * B.y - V.y * B.x) / Math.hypot(B.x, B.y);
    assert(r.converged !== false && onLine < 1e-6, `legacyFlag=${legacyFlag}: V stays on the line while the endpoint moves`);
  }
  console.log('solver-point-on-line-full test passed ✅');
})().catch(e => { console.error('solver-point-on-line-full test failed ❌', e.message); process.exit(1); });
