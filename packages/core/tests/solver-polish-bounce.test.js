// Regression test for the "bouncy" drag defect (Blocker 2 — the damped step).
//
// Root cause: the solver's zero-damping Gauss-Newton "polish" step (engine.js)
// solves JᵀJ dx = -Jᵀr via Algebra.choleskySolve, whose positive-definite guard
// (EPS) was far too loose (1e-14). A near-singular JᵀJ — routine when a sketch
// is transiently under-constrained mid-drag — PASSED the guard, and back-
// substitution divided by a ~1e-5 pivot, producing an enormous dx (a "fling").
// The fling was accepted (spring-dominated cost) and the next frame hauled it
// back -> visible oscillation/bounce.
//
// Fix: tighten choleskySolve's guard so near-singular matrices are REJECTED
// (ok=false). The polish then skips (rankDeficient=true) and the stable, damped
// LM result stands — no fling.
//
// DoD: choleskySolve rejects near-singular SPD matrices (no 1e10-scale dx),
// still solves well-conditioned systems, and rank-deficient sketches solve to
// finite, bounded positions flagged rankDeficient.
(async () => {
  const { Algebra } = await import('#core/solver/algebra.js');
  const { createNewtonSolver } = await import('#core/solver/engine.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // ---- Guard: near-singular SPD matrices must be REJECTED (no fling) ----
  // On the old EPS=1e-14 these returned ok=true and produced dx ~1e10..1e12.
  const nearSingular = [
    { label: 'diag(1e-10,1)', A: [1e-10, 0, 0, 1] },
    { label: 'diag(1e-12,1)', A: [1e-12, 0, 0, 1] },
    { label: 'rank1+1e-10',   A: [1 + 1e-10, 1, 1, 1] },
  ];
  for (const { label, A } of nearSingular) {
    const Acopy = Float64Array.from(A);
    const b = Float64Array.from([1, 1]);
    const ok = Algebra.choleskySolve(Acopy, 2, b);
    const maxdx = Math.max(Math.abs(b[0]), Math.abs(b[1]));
    console.log(`[guard] ${label}: ok=${ok} maxdx=${maxdx.toExponential(2)}`);
    assert(ok === false, `near-singular ${label} must be rejected (ok=false) so the undamped polish is skipped, not allowed to fling`);
  }

  // ---- Well-conditioned matrices must still solve correctly ----
  {
    // A = [[4,1],[1,3]], b=[1,2]  ->  x = [1/11, 7/11]
    const A = Float64Array.from([4, 1, 1, 3]);
    const b = Float64Array.from([1, 2]);
    const ok = Algebra.choleskySolve(A, 2, b);
    assert(ok === true, 'well-conditioned SPD matrix must still solve (ok=true)');
    assert(Math.abs(b[0] - 1 / 11) < 1e-9 && Math.abs(b[1] - 7 / 11) < 1e-9, 'well-conditioned solve must be correct');
  }

  // ---- End-to-end: a rank-deficient sketch solves finite & bounded (no fling) ----
  {
    // `a` constrained to a circle of radius 10 about the fixed origin -> one free
    // rotational DOF (rank-deficient). Must not fling to huge coordinates.
    const joints = new Map([['o', { x: 0, y: 0, fixed: true }], ['a', { x: 10, y: 0, fixed: false }]]);
    const constraints = [{ type: 'distance', joints: ['o', 'a'], value: 10 }];
    const solver = createNewtonSolver(joints, constraints, [], { maxIter: 200, tol: 1e-6 });
    const res = solver.solve();
    const a = joints.get('a');
    console.log(`[e2e] a=(${a.x.toFixed(4)},${a.y.toFixed(4)}) rankDef=${res.rankDeficient}`);
    assert(Number.isFinite(a.x) && Number.isFinite(a.y), 'rank-deficient solve must stay finite (no NaN)');
    assert(Math.hypot(a.x, a.y) < 1e3, 'rank-deficient solve must stay bounded (no fling to huge coordinates)');
    assert(res.rankDeficient === true, 'rank-deficient sketch must be reported rankDeficient:true');
    assert(Math.abs(Math.hypot(a.x, a.y) - 10) < 1e-3, 'the satisfied distance constraint must still hold (radius ~10)');
  }

  console.log('solver-polish-bounce tests passed ✅');
})().catch(e => { console.error('solver-polish-bounce tests failed ❌', e && e.message ? e.message : e); process.exit(1); });
