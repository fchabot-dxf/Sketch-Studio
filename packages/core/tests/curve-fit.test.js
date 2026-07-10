// packages/core/tests/curve-fit.test.js — UNIFY-3-fit oracle. Pins fitCubic (Schneider): a straight run -> 1 segment;
// a smooth run -> a few segments with EVERY input point within tolerance of the fitted curve; continuity + guards.
import { fitCubic } from '#core/curve-fit.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  // Independent cubic eval (Bernstein) — does NOT reuse the module internals, so the check is honest.
  const evalCubic = (s, t) => {
    const u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    return { x: s.p0.x * b0 + s.c1.x * b1 + s.c2.x * b2 + s.p3.x * b3, y: s.p0.y * b0 + s.c1.y * b1 + s.c2.y * b2 + s.p3.y * b3 };
  };
  // Max distance from every input point to the fitted chain (densely sampled).
  const maxDeviation = (segs, pts, N = 400) => {
    const cloud = [];
    for (const s of segs) for (let i = 0; i <= N; i++) cloud.push(evalCubic(s, i / N));
    let worst = 0;
    for (const p of pts) {
      let best = Infinity;
      for (const c of cloud) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < best) best = d; }
      if (best > worst) worst = best;
    }
    return worst;
  };
  const continuous = (segs) => segs.every((s, i) => i === 0 ||
    (Math.abs(s.p0.x - segs[i - 1].p3.x) < 1e-9 && Math.abs(s.p0.y - segs[i - 1].p3.y) < 1e-9));

  // 1) STRAIGHT run -> exactly 1 segment; reproduces the line (every point within tolerance).
  const line = []; for (let i = 0; i <= 10; i++) line.push({ x: i, y: 0 });
  const lineSeg = fitCubic(line, 0.5);
  assert(lineSeg.length === 1, 'straight run -> 1 segment (got ' + lineSeg.length + ')');
  assert(maxDeviation(lineSeg, line) <= 0.5, 'straight: every point within tolerance');

  // 2) SMOOTH run (1.5-period sine) -> a few segments; EVERY input point within tolerance; continuous chain.
  const tol = 0.5, sine = [];
  for (let x = 0; x <= 15; x += 0.5) sine.push({ x, y: 10 * Math.sin((2 * Math.PI * x) / 10) });
  const segs = fitCubic(sine, tol);
  assert(segs.length >= 2 && segs.length <= 30, 'smooth run -> a few segments (got ' + segs.length + ')');
  const dev = maxDeviation(segs, sine);
  assert(dev <= tol * 1.1, 'smooth: EVERY input point within tolerance (max dev ' + dev.toFixed(4) + ' <= ' + (tol * 1.1) + ')');
  assert(continuous(segs), 'segments form a continuous chain (p3 == next p0)');
  // endpoints interpolate the stroke ends.
  assert(Math.hypot(segs[0].p0.x - sine[0].x, segs[0].p0.y - sine[0].y) < 1e-6, 'first p0 == stroke start');
  const last = segs[segs.length - 1];
  assert(Math.hypot(last.p3.x - sine[sine.length - 1].x, last.p3.y - sine[sine.length - 1].y) < 1e-6, 'last p3 == stroke end');

  // 3) a TIGHTER tolerance on the same run -> at least as many segments (finer fit).
  assert(fitCubic(sine, 0.05).length >= segs.length, 'tighter tolerance -> >= segments');

  // 4) guards: <2 points -> []; exactly 2 -> 1 straight line-cubic; accepts [x,y] input too.
  assert(fitCubic([], 1).length === 0, '0 points -> []');
  assert(fitCubic([{ x: 0, y: 0 }], 1).length === 0, '1 point -> []');
  const two = fitCubic([[0, 0], [9, 0]], 1);
  assert(two.length === 1, '2 points -> 1 segment');
  assert(Math.abs(two[0].c1.x - 3) < 1e-9 && Math.abs(two[0].c2.x - 6) < 1e-9, '2-point cubic: control pts at 1/3, 2/3');

  console.log('curve-fit (UNIFY-3-fit) tests passed ✅');
})().catch((e) => { console.error('curve-fit tests failed ❌', e); process.exit(1); });
