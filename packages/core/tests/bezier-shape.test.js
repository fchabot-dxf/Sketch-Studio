// packages/core/tests/bezier-shape.test.js — UNIFY-3 oracle. Pins the new first-class #core BEZIER shape:
// makeBezier factory shape; cubicPathD -> correct SVG 'd'; coreShapeToPolyline -> the expected 16-step de Casteljau
// polyline (17 pts incl. start, correct endpoints/midpoint/bounds). ADDITIVE — a new shape kind, pure + deterministic.
import { makeBezier } from '#core/shapes.js';
import { cubicPathD } from '#core/geometry.js';
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js';

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

  // coreShapeToPolyline -> 16-step de Casteljau polyline (17 pts incl. the start).
  const joints = new Map([['a', { x: 0, y: 0 }], ['b', { x: 10, y: 0 }]]);
  const shape = { type: 'bezier', joints: ['a', 'b'], c1: [0, 10], c2: [10, 10] };
  const poly = coreShapeToPolyline(shape, joints);
  assert(poly.length === 17, 'bezier -> 17 points (start + 16-step de Casteljau)');
  assert(near(poly[0][0], 0) && near(poly[0][1], 0), 'starts at p0 (0,0)');
  assert(near(poly[16][0], 10) && near(poly[16][1], 0), 'ends at p3 (10,0)');
  assert(near(poly[8][0], 5) && near(poly[8][1], 7.5), 'midpoint t=0.5 -> (5, 7.5)');
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  assert(near(Math.min(...xs), 0) && near(Math.max(...xs), 10), 'x-bounds [0,10]');
  assert(near(Math.min(...ys), 0) && near(Math.max(...ys), 7.5), 'y-bounds [0,7.5]');

  // guards: missing control points / missing endpoint -> [].
  assert(coreShapeToPolyline({ type: 'bezier', joints: ['a', 'b'] }, joints).length === 0, 'missing ctrl -> []');
  assert(coreShapeToPolyline({ type: 'bezier', joints: ['a', 'zzz'], c1: [0, 10], c2: [10, 10] }, joints).length === 0, 'missing endpoint -> []');

  console.log('bezier-shape (UNIFY-3) tests passed ✅');
})().catch((e) => { console.error('bezier-shape tests failed ❌', e); process.exit(1); });
