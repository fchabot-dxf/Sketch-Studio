// tests/angle-arrows-d9-node.test.js -- D-9 (TASK 1010, BUG-130): both arrowheads of an angle dimension point ALONG the arc
// (tangent), out of its two ends. They were rotated 90 degrees (radial).
import assert from 'node:assert';
import { docOf, openDoc } from './fixtures/display-1010/doc-kit.js';

const app = await openDoc(docOf(
  { a: [0, 0, true], b: [60, 0, true], c: [30, 51.9615] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
  [{ type: 'angle', shapes: ['L1', 'L2'], value: 60, sector: { ray1: 1, ray2: 1, turn: 1 }, offset: 30, name: 'd1' }],
));
try {
  app.frames();
  const idx = app.state.constraints.findIndex((c) => c.name === 'd1');
  const polys = [...app.svg.querySelectorAll(`polygon[data-constraint-idx="${idx}"]`)].map((p) => p.getAttribute('points').trim().split(/\s+/).map((q) => q.split(',').map(Number)));
  assert.strictEqual(polys.length, 2, 'the angle dimension draws two arrowheads');
  const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const dots = polys.map(([tip, b1, b2]) => {
    const dir = unit([tip[0] - (b1[0] + b2[0]) / 2, tip[1] - (b1[1] + b2[1]) / 2]);
    const r = unit(tip), t = [-r[1], r[0]]; // the vertex is the origin: radial = the tip, tangent = +angle direction
    return { radial: dir[0] * r[0] + dir[1] * r[1], tangent: dir[0] * t[0] + dir[1] * t[1] };
  });
  console.log('arrows', JSON.stringify(dots));
  assert.ok(Math.abs(dots[0].radial) < 1e-6 && Math.abs(dots[1].radial) < 1e-6, `no arrow points radially: ${JSON.stringify(dots)}`);
  assert.ok(Math.abs(dots[0].tangent + 1) < 1e-6, `the start arrow points back out of the arc start (tangent -1): ${dots[0].tangent}`);
  assert.ok(Math.abs(dots[1].tangent - 1) < 1e-6, `the end arrow points on out of the arc end (tangent +1): ${dots[1].tangent}`);
  console.log('PASS angle-arrows-d9-node');
} finally { await app.close(); }
