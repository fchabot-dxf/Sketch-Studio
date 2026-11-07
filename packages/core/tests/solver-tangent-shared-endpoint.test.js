// A line-circle tangent whose line shares an endpoint joint with the arc (a fillet) used a
// singular residual (distance-to-line, double root at tangency) -> radius edits never converged.
// Shared endpoint => endpoint-tangency form (shared - center) ⟂ line, non-singular.
(async () => {
  const { makeRectFromTwoJoints } = await import('#core/shapes.js');
  const { findCornerAtPoint, applyFillet } = await import('#core/fillet.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (c, m) => { if (!c) throw new Error(m); };

  for (const [R0, R] of [[20, 5], [20, 10], [5, 12]]) {
    const joints = new Map(); let n = 0; const g = () => 'j' + (++n);
    const a = g(), b = g();
    joints.set(a, { x: 0, y: 0, fixed: false }); joints.set(b, { x: 80, y: 60, fixed: false });
    const { shapes, constraints } = makeRectFromTwoJoints(joints, a, b, g);
    const state = { joints, shapes, constraints };
    const res = applyFillet(state, findCornerAtPoint(state, { x: 80, y: 0 }, 0.5), R0);
    const eng = createNewtonSolver(joints, constraints, shapes, {});
    res.radiusConstraint.value = R;
    const r = eng.solve(500);
    const [cj, rj] = res.arc.joints;
    const d = Math.hypot(joints.get(cj).x - joints.get(rj).x, joints.get(cj).y - joints.get(rj).y);
    assert(r.converged !== false, `R ${R0}->${R} must converge`);
    assert(Math.abs(d - R) < 1e-6, `R ${R0}->${R}: got ${d}`);
  }
  console.log('solver-tangent-shared-endpoint test passed ✅');
})().catch(e => { console.error('solver-tangent-shared-endpoint test failed ❌', e.message); process.exit(1); });
