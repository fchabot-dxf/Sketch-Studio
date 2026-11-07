// Horizontal / vertical DISTANCE dims (dimMode) DRIVE the projection |dx| / |dy|, like Fusion. Before this the solver
// ignored dimMode (always Euclidean), so an H/V dim between points that are not axis-aligned never drove.
// The sign (which side of a the point sits on) is locked on the constraint at first solve so a drag cannot flip it.
(async () => {
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const { Definitions } = await import('#core/solver/definitions.js');
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

  const make = (b, mode, value) => {
    const joints = new Map([['a', { x: 0, y: 0, fixed: true }], ['b', { x: b[0], y: b[1], fixed: false }]]);
    const c = { type: 'distance', joints: ['a', 'b'], value };
    if (mode) c.dimMode = mode;
    const constraints = [c];
    const eng = createNewtonSolver(joints, constraints, [], {});
    return { joints, c, eng };
  };

  // 1. horizontal drives x only; y is left exactly where it was
  { const { joints, eng } = make([10, 5], 'horizontal', 7); const r = eng.solve(100);
    const b = joints.get('b'); assert(r.converged !== false, 'H converges'); assert(near(b.x, 7) && near(b.y, 5), `H: b=(7,5) expected, got (${b.x},${b.y})`); }
  // 2. vertical drives y only
  { const { joints, eng } = make([10, 5], 'vertical', 3); eng.solve(100);
    const b = joints.get('b'); assert(near(b.y, 3) && near(b.x, 10), `V: b=(10,3) expected, got (${b.x},${b.y})`); }
  // 3. an EDIT moves only that axis
  { const { joints, c, eng } = make([10, 5], 'horizontal', 7); eng.solve(100);
    c.value = 12; eng.solve(100); const b = joints.get('b'); assert(near(b.x, 12) && near(b.y, 5), `H edit 7->12: got (${b.x},${b.y})`);
    c.value = 4; eng.solve(100); assert(near(joints.get('b').x, 4) && near(joints.get('b').y, 5), 'H edit 12->4'); }
  // 4. negative orientation (b left of a) keeps its side
  { const { joints, eng } = make([-10, 5], 'horizontal', 7); eng.solve(100);
    const b = joints.get('b'); assert(near(b.x, -7) && near(b.y, 5), `H left side: expected (-7,5), got (${b.x},${b.y})`); }
  // 5. the sign is locked: dragging b across a and solving brings it back to the ORIGINAL side
  { const { joints, c, eng } = make([10, 5], 'horizontal', 7); eng.solve(100);
    assert(c.dimSign === 1, 'sign locked on the constraint at first solve');
    joints.get('b').x = -2; eng.solve(100);
    assert(near(joints.get('b').x, 7), `a drag across a must not flip the dim: got x=${joints.get('b').x}`); }
  // 6. aligned (no dimMode / 'aligned' / 'auto') stays EUCLIDEAN: unchanged behaviour
  for (const mode of [undefined, 'aligned', 'auto']) {
    const { joints, eng } = make([10, 5], mode, 7); eng.solve(100);
    const b = joints.get('b'); assert(near(Math.hypot(b.x, b.y), 7), `${mode}: euclidean 7, got ${Math.hypot(b.x, b.y)}`);
  }
  // 7. definition-level: aligned residual/Jacobian untouched (byte-identical for non-H/V params)
  { const pos = new Float64Array([1, 2, 4, 6]); const p = { joints: [0, 1], value: 5 };
    assert(Definitions.distance.computeError(p, pos) === Math.hypot(1 - 4, 2 - 6) - 5, 'aligned residual unchanged');
    const row = new Float64Array(4); Definitions.distance.computeJacobian(p, pos, row);
    const r = Math.hypot(-3, -4); assert(row[0] === -3 / r && row[1] === -4 / r && row[2] === 3 / r && row[3] === 4 / r, 'aligned Jacobian unchanged'); }
  // 8. Jacobian of the H/V forms matches finite differences
  for (const [mode, sign] of [['horizontal', 1], ['horizontal', -1], ['vertical', 1], ['vertical', -1]]) {
    const pos = new Float64Array([1.3, 2.1, 6.2, -3.4]); const p = { joints: [0, 1], value: 4, dimMode: mode, dimSign: sign };
    const row = new Float64Array(4); Definitions.distance.computeJacobian(p, pos, row);
    for (let i = 0; i < 4; i++) { const u = pos.slice(); u[i] += 1e-6; const d = pos.slice(); d[i] -= 1e-6;
      const fd = (Definitions.distance.computeError(p, u) - Definitions.distance.computeError(p, d)) / 2e-6;
      assert(Math.abs(fd - row[i]) < 1e-6, `${mode}/${sign} col ${i}: ${row[i]} vs fd ${fd}`); }
  }
  console.log('solver-distance-hv test passed ✅');
})().catch(e => { console.error('solver-distance-hv test failed ❌', e.message); process.exit(1); });
