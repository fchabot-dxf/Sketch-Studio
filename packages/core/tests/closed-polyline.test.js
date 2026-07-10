// packages/core/tests/closed-polyline.test.js — CIRCLE-FIX oracle. A CLOSED polyline (circle, first==last) must
// survive the optimize pipeline (douglasPeucker / linesimplify / optimize) as the FULL loop, NOT collapse to a 2-pt
// stroke. The collapse was float cancellation in perpDist on the near-zero-length base segment of a closed loop.
// Regression: OPEN polylines simplify EXACTLY as before; distinct-segment linemerge still joins.
import { douglasPeucker } from '#core/plot/optimize/douglas-peucker.js';
import { linemerge, linesimplify, optimize } from '#core/plot/optimize/index.js';
import { toolpathToPolylines } from '#core/plot/index.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  const xspan = (pts) => Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));

  // A 65-pt CLOSED circle (center 50,60 r15; first==last within float epsilon, like coreShapeToPolyline's flatten).
  const N = 64, cx = 50, cy = 60, r = 15, circle = [];
  for (let i = 0; i <= N; i++) { const t = (i / N) * 2 * Math.PI; circle.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  assert(circle.length === 65, 'circle is 65 pts');

  // THE FIX: DP keeps the FULL loop (many vertices, full diameter span), not a 2-pt collapse.
  const dp = douglasPeucker(circle, 0.1);
  assert(dp.length > 16, `closed circle survives DP (got ${dp.length}, must be >16, NOT 2)`);
  assert(near(xspan(dp), 2 * r, 0.01), `full rim preserved (x-span ${xspan(dp).toFixed(3)} ~= ${2 * r})`);
  assert(linesimplify([circle], 0.1)[0].length > 16, 'linesimplify keeps the closed loop');
  assert(optimize([circle], {})[0].length > 16, 'full optimize keeps the closed loop');

  // toolpathToPolylines (the pipeline the exporter uses) on a closed-polyline shape -> the full loop.
  const strokes = toolpathToPolylines([{ id: 'C', type: 'polyline', points: circle }], {});
  assert(strokes.length === 1 && strokes[0].length > 16, `toolpathToPolylines keeps the circle (got ${strokes[0] && strokes[0].length})`);

  // REGRESSION — OPEN polylines unchanged: a zigzag keeps all its corners; a near-straight run simplifies to 2.
  assert(douglasPeucker([[0, 0], [1, 5], [2, 0], [3, 5], [4, 0]], 0.1).length === 5, 'open zigzag -> all 5 kept');
  assert(douglasPeucker([[0, 0], [1, 0.01], [2, 0], [3, 0.01], [4, 0]], 0.1).length === 2, 'near-straight open -> 2');

  // REGRESSION — distinct-segment linemerge still joins two touching OPEN segments into one.
  const m = linemerge([[[0, 0], [10, 0]], [[10, 0], [10, 10]]], 0.05);
  assert(m.length === 1 && m[0].length === 3, `two touching segments merge -> 1 polyline of 3 pts (got ${m.length}/${m[0] && m[0].length})`);
  // two NON-touching segments stay separate.
  assert(linemerge([[[0, 0], [1, 0]], [[5, 5], [6, 5]]], 0.05).length === 2, 'non-touching segments stay separate');

  console.log('closed-polyline (CIRCLE-FIX) tests passed ✅');
})().catch((e) => { console.error('closed-polyline tests failed ❌', e); process.exit(1); });
