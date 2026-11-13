// tests/shape-id-unique.test.js -- TASK 541 (advisor ruling): every new shape id comes from THE shape-id generator (#core/shape-id.js), so
// shapes made in a tight loop (many in one millisecond) never share an id. Before it, the rect tool named its lines 's' + Date.now() + '_k'
// and the line / circle tools 's' + Date.now(): two made in one millisecond collided, and shapes.find returned the wrong shape.
// 1000 of each maker in a tight loop (rectangles in all three modes, polygons, arcs, beziers, and the id the line / circle tools mint), then
// every shape id unique across all of them, every group id unique per group; and no source file mints a shape id from Date.now() alone
// (or from its own Date.now() + counter, like the clipboard's paste did: the generator is the one place).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { makeRectFromTwoJoints, makeRectFromCenter, makeRectFrom3Points, makePolygon, makeArc, makeBezier } from '#core/shapes.js';
import { newShapeId } from '#core/shape-id.js';

const N = 1000;
const joints = new Map();
let jn = 0;
const genJ = () => 'j' + (++jn);
const pt = (x, y) => { const id = genJ(); joints.set(id, { x, y, fixed: false }); return id; };
const ids = [], groups = new Map(); // group id -> the maker call that made it
const take = (call, built) => {
  for (const s of built.shapes) { ids.push(s.id); if (s.groupId) { const g = groups.get(s.groupId); assert.ok(g === undefined || g === call, `group id ${s.groupId} made by two calls`); groups.set(s.groupId, call); } }
};
const t0 = Date.now();
let call = 0;
for (let i = 0; i < N; i++) {
  take(++call, makeRectFromTwoJoints(joints, pt(0, 0), pt(10, 5), genJ));
  take(++call, makeRectFromCenter(joints, pt(0, 0), pt(10, 5), genJ));
  take(++call, makeRectFrom3Points(joints, pt(0, 0), pt(10, 0), pt(10, 5), genJ));
  take(++call, makePolygon(joints, pt(0, 0), pt(10, 0), 5, genJ));
  take(++call, makeArc(joints, pt(0, 0), pt(10, 0), pt(0, 10)));
  take(++call, makeBezier(joints, pt(0, 0), pt(10, 0), [3, 3], [7, 3]));
  ids.push(newShapeId('s'));        // the line tool and the circle tool
  ids.push(newShapeId('circle_'));  // the drawing tools' circle
}
const ms = Date.now() - t0;
const unique = new Set(ids).size;
assert.strictEqual(unique, ids.length, `${ids.length - unique} duplicate shape ids among ${ids.length}`);
console.log(`${ids.length} shape ids from ${call} maker calls + ${2 * N} tool ids in ${ms} ms (many per millisecond): all unique; ${groups.size} group ids, one per call`);

// no shape id minted from Date.now() alone anywhere in the packages or apps (the forms the generator replaced)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const BAD = /'s' \+ Date\.now\(\)|`s_bezier_\$\{Date\.now\(\)\}`|'circle_' \+ Date\.now\(\)|'rect_' \+ Date\.now\(\)|const base = Date\.now\(\)|`\$\{Date\.now\(\)\}_\$\{\+\+/;
const offenders = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|vendor|tests/.test(e.name)) walk(p); }
    else if (e.name.endsWith('.js') && BAD.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(ROOT, p));
  }
};
walk(path.join(ROOT, 'packages')); walk(path.join(ROOT, 'apps'));
assert.deepStrictEqual(offenders, [], 'shape ids minted from Date.now() alone: ' + offenders.join(', '));
console.log('shape-id-unique.test.js: ok');
