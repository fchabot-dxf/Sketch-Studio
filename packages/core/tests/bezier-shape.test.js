// packages/core/tests/bezier-shape.test.js — UNIFY-3 oracle. Pins the new first-class #core BEZIER shape:
// makeBezier factory shape; cubicPathD -> correct SVG 'd'; coreShapeToPolyline -> the de Casteljau polyline (TASK 761: at the declared
// chord tolerance, #core/curve-kinds CURVE_TOLERANCE_MM, instead of a fixed 16 steps: correct endpoints, every chord within the tolerance
// of the curve, bounds). ADDITIVE — a new shape kind, pure + deterministic.
import { makeBezier } from '#core/shapes.js';
import { cubicPathD } from '#core/geometry.js';
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js';
import { CURVE_TOLERANCE_MM, bezierSteps } from '#core/curve-kinds.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

  // A symmetric arch cubic: p0(0,0) c1(0,10) c2(10,10) p3(10,0).
  const p0 = { x: 0, y: 0 }, c1 = { x: 0, y: 10 }, c2 = { x: 10, y: 10 }, p3 = { x: 10, y: 0 };

  // cubicPathD -> exact SVG 'd'.
  assert(cubicPathD(p0, c1, c2, p3) === 'M 0 0 C 0 10 10 10 10 0', 'cubicPathD -> M..C..');
  assert(cubicPathD(null, c1, c2, p3) === '', 'cubicPathD guards missing point');

  // makeBezier -> a well-formed bezier shape (endpoints as joints, control points as [x,y] data, no constraints).
  const { shapes, constraints } = makeBezier(new Map(), 'a', 'b', [0, 10], [10, 10]);
  assert(shapes.length === 1 && constraints.length === 0, 'makeBezier -> 1 shape, 0 constraints');
  const b = shapes[0];
  assert(b.type === 'bezier', 'type bezier');
  assert(JSON.stringify(b.joints) === '["a","b"]', 'endpoints are joints [a,b]');
  assert(JSON.stringify(b.c1) === '[0,10]' && JSON.stringify(b.c2) === '[10,10]', 'control points = [x,y] data');
  assert(makeBezier(new Map(), 'a', 'b', [0, 10], [10, 10], true).shapes[0].isConstruction === true, 'construction flag');

  // coreShapeToPolyline -> the de Casteljau polyline at the declared tolerance (TASK 761): n steps from the bound, n + 1 points incl. the start.
  const joints = new Map([['a', { x: 0, y: 0 }], ['b', { x: 10, y: 0 }]]);
  const shape = { type: 'bezier', joints: ['a', 'b'], c1: [0, 10], c2: [10, 10] };
  const poly = coreShapeToPolyline(shape, joints);
  const n = bezierSteps([p0, c1, c2, p3]);
  assert(n === 47, `the arch at ${CURVE_TOLERANCE_MM} mm: 47 steps (ceil(sqrt(0.75 * |(10,-10)| / tol))), got ${n}`);
  assert(poly.length === n + 1, `bezier -> ${n + 1} points (start + ${n} steps), got ${poly.length}`);
  assert(near(poly[0][0], 0) && near(poly[0][1], 0), 'starts at p0 (0,0)');
  assert(near(poly[n][0], 10) && near(poly[n][1], 0), 'ends at p3 (10,0)');
  const at = (t) => { const u = 1 - t; return [3 * u * u * t * 0 + 3 * u * t * t * 10 + t * t * t * 10, 3 * u * u * t * 10 + 3 * u * t * t * 10]; };
  let worst = 0;
  for (let i = 0; i < n; i++) { const m = at((i + 0.5) / n), a = poly[i], b = poly[i + 1]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); worst = Math.max(worst, Math.abs((b[0] - a[0]) * (m[1] - a[1]) - (b[1] - a[1]) * (m[0] - a[0])) / len); }
  assert(worst <= CURVE_TOLERANCE_MM, `every chord within ${CURVE_TOLERANCE_MM} mm of the curve (worst ${worst})`);
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  assert(near(Math.min(...xs), 0) && near(Math.max(...xs), 10), 'x-bounds [0,10]');
  assert(near(Math.min(...ys), 0) && Math.abs(Math.max(...ys) - 7.5) <= CURVE_TOLERANCE_MM, 'y-bounds [0,7.5] within the tolerance');

  // guards: missing control points / missing endpoint -> [].
  assert(coreShapeToPolyline({ type: 'bezier', joints: ['a', 'b'] }, joints).length === 0, 'missing ctrl -> []');
  assert(coreShapeToPolyline({ type: 'bezier', joints: ['a', 'zzz'], c1: [0, 10], c2: [10, 10] }, joints).length === 0, 'missing endpoint -> []');

  console.log('bezier-shape (UNIFY-3) tests passed ✅');
})().catch((e) => { console.error('bezier-shape tests failed ❌', e); process.exit(1); });
