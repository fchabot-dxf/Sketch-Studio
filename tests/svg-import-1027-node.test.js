// tests/svg-import-1027-node.test.js — TASK 1027 (files audit 1024): BUG-302 (F-47a) a non-numeric coordinate skips its shape (it was a made-up 0),
// BUG-303 (F-47b) a circle of radius <= 0 is skipped, BUG-304 (F-58) a circle under a non-uniform scale comes in as an ellipse ring.
// Every skip is a { tag, reason, count } row: the import's one notice prints them ("N skipped/degraded: ...").
import assert from 'node:assert';
import { importSvgGeometry, parseTransform } from '#core/svg-import.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
let n = 0; const genJ = () => 'j' + (++n);
const run = (descs) => importSvgGeometry(descs, { genJ });
const bbox = (r) => { const xs = r.joints.map((j) => j.x), ys = r.joints.map((j) => j.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => Math.round(v * 1000) / 1000); };

// F-47a: the audit's huge-coords.svg line
{
  const r = run([{ tag: 'line', x1: 'NaN', y1: '0', x2: '5', y2: '5' }, { tag: 'line', x1: '0', y1: '0', x2: '5', y2: '5' }]);
  eq(r.shapes.length, 1, 'F-47a: the NaN line is skipped, the good one imported (no made-up (0,0)-(5,5) from the bad one)');
  eq(r.stats.skipped, [{ tag: 'line', reason: 'non-numeric coordinate, not imported', count: 1 }], 'F-47a: counted with its reason');
  const bad = run([{ tag: 'rect', x: '0', y: 'abc', width: '5', height: '5' }, { tag: 'circle', cx: '1', cy: 'x', r: '5' }, { tag: 'ellipse', cx: 'NaN', cy: '0', rx: '3', ry: '2' }, { tag: 'polyline', points: '0,0 NaN,5 10,10' }, { tag: 'polygon', points: '0,0 5,0 x,9' }]);
  eq(bad.shapes.length, 0, 'F-47a: rect, circle, ellipse, polyline and polygon with a bad number are skipped whole');
  eq(bad.stats.skipped.reduce((a, s) => a + s.count, 0), 5, 'F-47a: five skips counted');
  const dflt = run([{ tag: 'line', x2: '5', y2: '5' }, { tag: 'rect', width: '4', height: '3' }]);
  eq(dflt.shapes.length, 5, 'an ABSENT coordinate is still SVG\'s default 0 (a line from the origin, a rect at the origin): no skip');
  eq(dflt.stats.skipped, [], 'and nothing is counted for it');
}
// F-47b
{
  const r = run([{ tag: 'circle', cx: '50', cy: '50', r: '-5' }, { tag: 'circle', cx: '20', cy: '20', r: '0' }, { tag: 'circle', cx: '10', cy: '10', r: '5' }]);
  eq(r.shapes.length, 1, 'F-47b: only the circle of radius 5 is imported');
  eq(r.shapes[0].radius, 5, 'F-47b: radius 5');
  eq(r.stats.skipped, [{ tag: 'circle', reason: 'radius zero or negative, not imported', count: 2 }], 'F-47b: the two skips counted with their reason');
}
// F-58
{
  const circle = { tag: 'circle', cx: '10', cy: '10', r: '5', ctm: parseTransform('scale(2,1)') };
  const r = run([circle]);
  ok(!r.shapes.some((s) => s.type === 'circle'), 'F-58: a stretched circle is no longer ONE circle of radius 7.07');
  eq(bbox(r), [10, 5, 30, 15], 'F-58: it is the 20 x 10 ellipse (x 10..30, y 5..15)');
  const e = run([{ tag: 'ellipse', cx: '10', cy: '10', rx: '5', ry: '5', ctm: parseTransform('scale(2,1)') }]);
  eq(bbox(e), bbox(r), 'F-58: the same ring an <ellipse> of the same size imports to today');
  eq(r.stats.skipped, [], 'F-58: nothing skipped');
  const u = run([{ tag: 'circle', cx: '10', cy: '10', r: '5', ctm: parseTransform('scale(2,2)') }]);
  eq([u.shapes.length, u.shapes[0].type, u.shapes[0].radius], [1, 'circle', 10], 'a UNIFORM scale still gives one circle (radius 10)');
}
console.log(`svg-import-1027: ${checks} checks ok`);
