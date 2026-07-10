// packages/core/tests/core-shape-to-polyline.test.js — PP-7b oracle. Pins coreShapeToPolyline: a #core sketch shape
// -> a polyline ([[x,y],...]). line -> exact endpoints; circle -> a closed rim (vertex count + on-radius + bounds);
// arc -> REUSES the existing sampler (endpoints in Node, no DOM — no 2nd sampler). Pure + deterministic.
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
  const joints = new Map([
    ['a', { x: 0, y: 0 }], ['b', { x: 10, y: 0 }],   // a line
    ['c', { x: 10, y: 10 }],                          // a circle center
    ['ac', { x: 0, y: 0 }], ['as', { x: 10, y: 0 }], ['ae', { x: 0, y: 10 }], // a CENTER arc: center/start/end
  ]);

  // line -> its two endpoints, exactly.
  const line = coreShapeToPolyline({ type: 'line', joints: ['a', 'b'] }, joints);
  assert(JSON.stringify(line) === '[[0,0],[10,0]]', 'line -> endpoints');

  // circle -> a closed rim polyline: 64 segments + close = 65 points, all on radius 5, bounds [5,15] x [5,15].
  const circle = coreShapeToPolyline({ type: 'circle', joints: ['c'], radius: 5 }, joints);
  assert(circle.length === 65, 'circle -> 65 points (64 segments + close)');
  assert(near(circle[0][0], circle[64][0]) && near(circle[0][1], circle[64][1]), 'circle closed (last == first)');
  for (const [x, y] of circle) assert(near(Math.hypot(x - 10, y - 10), 5), 'every circle vertex on radius 5');
  const xs = circle.map((p) => p[0]), ys = circle.map((p) => p[1]);
  assert(near(Math.min(...xs), 5) && near(Math.max(...xs), 15), 'circle x-bounds [5,15]');
  assert(near(Math.min(...ys), 5) && near(Math.max(...ys), 15), 'circle y-bounds [5,15]');

  // arc -> delegates to the EXISTING sampler. In Node (no DOM) sampleArc degrades to [p1, p3]; the browser samples
  // the true curve (that path is exercised by the live end-to-end verify, not here). Assert the degradation shape.
  const arc = coreShapeToPolyline({ type: 'arc', joints: ['ac', 'as', 'ae'], subType: 'CENTER' }, joints);
  assert(arc.length === 2, 'arc -> 2 points in Node (DOM-less sampleArc degradation, no 2nd sampler)');
  assert(JSON.stringify(arc) === '[[0,0],[0,10]]', 'arc Node endpoints = [center, end] (sampleArc p1,p3)');

  // guards: missing joint / unknown type / bad input -> [].
  assert(coreShapeToPolyline({ type: 'line', joints: ['a', 'zzz'] }, joints).length === 0, 'missing joint -> []');
  assert(coreShapeToPolyline({ type: 'circle', joints: ['c'], radius: 0 }, joints).length === 0, 'zero radius -> []');
  assert(coreShapeToPolyline({ type: 'blob', joints: [] }, joints).length === 0, 'unknown type -> []');
  assert(coreShapeToPolyline(null, joints).length === 0, 'null shape -> []');

  console.log('core-shape-to-polyline (PP-7b) tests passed ✅');
})().catch((e) => { console.error('core-shape-to-polyline tests failed ❌', e); process.exit(1); });
