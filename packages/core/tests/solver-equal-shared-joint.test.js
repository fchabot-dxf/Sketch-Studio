// `equal` [a,b,c,d] = len(a,b) - len(c,d). Every arc carries equal [centre, rim1, centre, rim2] (shapes.js makeArc),
// so a === c. The Jacobian used to ASSIGN the partials, so the second length's write overwrote the first on the shared
// centre joint (centre column -u2 instead of u1 - u2). Normal solves crawled through on damping; a DRAG weights the
// structural rows x1e5, every step got rejected, and the solve reported converged with the dragged joint unmoved
// (turn 404: dragging any point of a filleted rect moved 0.00 mm).
(async () => {
  const { Definitions } = await import('#core/solver/definitions.js');
  const { makeRectFromTwoJoints, makeArc } = await import('#core/shapes.js');
  const { findCornerAtPoint, applyFillet } = await import('#core/fillet.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const DRAG_K = 1e4; // the UI's spring stiffness (SolverConfig.DRAG_STRENGTH 1.0 * 1e4)

  // 1. Finite-difference check of the analytic Jacobian, shared joint (a === c) and all-distinct.
  for (const joints of [[0, 1, 0, 2], [0, 1, 2, 3], [1, 0, 2, 1]]) {
    const pos = Float64Array.from([1.3, -0.7, 9.1, 2.2, -3.4, 8.8, 4.0, 5.5]);
    const an = new Float64Array(pos.length);
    Definitions.equal.computeJacobian({ joints }, pos, an);
    const h = 1e-6;
    for (let k = 0; k < pos.length; k++) {
      const p = Float64Array.from(pos); p[k] += h; const m = Float64Array.from(pos); m[k] -= h;
      const num = (Definitions.equal.computeError({ joints }, p) - Definitions.equal.computeError({ joints }, m)) / (2 * h);
      assert(Math.abs(num - an[k]) < 1e-6, `equal ${JSON.stringify(joints)} d/dx[${k}]: analytic ${an[k]} vs numeric ${num}`);
    }
  }

  const drag = (joints, constraints, shapes, id, dx, dy) => {
    const j = joints.get(id); const x0 = j.x, y0 = j.y;
    const r = createNewtonSolver(joints, constraints, shapes, {}).solve(500, { dragTarget: { jointId: id, x: x0 + dx, y: y0 + dy, stiffness: DRAG_K } });
    return { r, mx: j.x - x0, my: j.y - y0 };
  };
  const radii = (joints, arc) => { const [c, p, q] = arc.joints.map((k) => joints.get(k)); return [Math.hypot(p.x - c.x, p.y - c.y), Math.hypot(q.x - c.x, q.y - c.y)]; };

  // 2. Filleted 60x40 rect, origin corner pinned, no size dims: dragging any free joint must resize it.
  const filleted = () => {
    const joints = new Map(); let n = 0; const g = () => 'j' + (++n);
    const a = g(), b = g();
    joints.set(a, { x: 0, y: 0, fixed: true }); joints.set(b, { x: 60, y: 40, fixed: false });
    const { shapes, constraints } = makeRectFromTwoJoints(joints, a, b, g);
    const state = { joints, shapes, constraints };
    const res = applyFillet(state, findCornerAtPoint(state, { x: 60, y: 40 }, 0.5), 8);
    createNewtonSolver(joints, constraints, shapes, {}).solve(500);
    return { joints, shapes, constraints, res };
  };
  // Joints picked by ROLE per fresh build (fillet joint ids are random per call).
  const at = (S, x, y) => [...S.joints.entries()].filter(([, j]) => !j.fixed && Math.abs(j.x - x) < 1e-6 && Math.abs(j.y - y) < 1e-6).map(([id]) => id);
  const cases = [
    ['left-edge corner A', (S) => at(S, 0, 40)[0], 0, 6, 0, 6],   // free corner on the left edge: height only
    ['left-edge corner B', (S) => at(S, 0, 40)[1], 0, 6, 0, 6],
    ['bottom-edge corner A', (S) => at(S, 60, 0)[0], 3, 0, 3, 0], // free corner on the bottom edge: width only
    ['bottom-edge corner B', (S) => at(S, 60, 0)[1], 3, 0, 3, 0],
    ['virtual-sharp V', (S) => S.res.virtualSharp, 3, 6, 3, 6],
    ['arc centre', (S) => S.res.arc.joints[0], 3, 6, 3, 6],
    ['tangent joint 1', (S) => S.res.arc.joints[1], 3, 6, 3, 6],
    ['tangent joint 2', (S) => S.res.arc.joints[2], 3, 6, 3, 6],
  ];
  for (const [label, pick, dx, dy, ex, ey] of cases) {
    const S = filleted();
    const id = pick(S);
    assert(id && S.joints.has(id), `filleted rect: no joint for ${label}`);
    if (!id || !S.joints.has(id)) continue;
    const { r, mx, my } = drag(S.joints, S.constraints, S.shapes, id, dx, dy);
    assert(r.converged, `filleted rect drag ${label}: not converged`);
    assert(Math.abs(mx - ex) < 1e-3 && Math.abs(my - ey) < 1e-3, `filleted rect drag ${label} by (${dx},${dy}): moved (${mx.toFixed(3)},${my.toFixed(3)}), want (${ex},${ey})`);
    const [r1, r2] = radii(S.joints, S.res.arc);
    assert(Math.abs(r1 - 8) < 1e-4 && Math.abs(r2 - 8) < 1e-4, `filleted rect drag ${label}: radius drifted to ${r1}/${r2}`);
  }

  // 3. A plain free arc (no fillet): dragging the centre or a rim point must follow the mouse and stay circular.
  for (const k of [0, 1, 2]) {
    const joints = new Map([['c', { x: 0, y: 0, fixed: false }], ['p', { x: 10, y: 0, fixed: false }], ['q', { x: 0, y: 10, fixed: false }]]);
    const { shapes, constraints } = makeArc(joints, 'c', 'p', 'q');
    const id = ['c', 'p', 'q'][k];
    const { r, mx, my } = drag(joints, constraints, shapes, id, 3, 4);
    assert(r.converged, `plain arc drag ${id}: not converged`);
    assert(Math.abs(mx - 3) < 1e-3 && Math.abs(my - 4) < 1e-3, `plain arc drag ${id} by (3,4): moved (${mx.toFixed(3)},${my.toFixed(3)})`);
    const [r1, r2] = radii(joints, shapes[0]);
    assert(Math.abs(r1 - r2) < 1e-4, `plain arc drag ${id}: radii differ ${r1} vs ${r2}`);
  }
  console.log('solver-equal-shared-joint test passed ✅');
})().catch(e => { console.error('solver-equal-shared-joint test failed ❌', e.message); process.exit(1); });
