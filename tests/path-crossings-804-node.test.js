// tests/path-crossings-804-node.test.js — TASK 804: THE crossing check of written toolpaths (#core/path-crossings.js pathCrossings, tolerance
// CROSSING_TOL_MM): proper crossings, crossings through a vertex (of one path or of both), touches that are NOT crossings (a V touching a line, two
// vertices meeting and parting, a path ending on another, ending 0.001 mm past it, running along another and leaving on the side it came from), a
// run along another that leaves on the other side (one crossing), closed paths (two squares overlapping = 2), a bow-tie loop crossing itself, and three
// passages through one point (a leg through the point where a ring starts and ends: 2 crossings).
import assert from 'node:assert';
import { pathCrossings, CROSSING_TOL_MM } from '#core/path-crossings.js';

const P = (pts, closed = false) => ({ points: pts.map(([x, y]) => ({ x, y })), closed });
const cases = [
  ['X proper', [P([[0, 0], [10, 10]]), P([[0, 10], [10, 0]])], 1],
  ['through a vertex', [P([[0, 0], [5, 5], [10, 10]]), P([[0, 10], [10, 0]])], 1],
  ['vertex on vertex', [P([[0, 0], [5, 5], [10, 10]]), P([[0, 10], [5, 5], [10, 0]])], 1],
  ['vertex touch (V)', [P([[0, 0], [5, 5], [10, 0]]), P([[0, 5], [10, 5]])], 0],
  ['vertex-vertex touch', [P([[0, 0], [5, 5], [10, 0]]), P([[0, 10], [5, 5], [10, 10]])], 0],
  ['T end', [P([[5, 0], [5, 5]]), P([[0, 5], [10, 5]])], 0],
  ['T end 0.001 mm past', [P([[5, 0], [5, 5.001]]), P([[0, 5], [10, 5]])], 0],
  ['T end 0.01 mm past', [P([[5, 0], [5, 5.01]]), P([[0, 5], [10, 5]])], 1],
  ['overlap, same side', [P([[0, 0], [2, 5], [8, 5], [10, 0]]), P([[0, 5], [10, 5]])], 0],
  ['overlap, other side', [P([[0, 0], [2, 5], [8, 5], [10, 10]]), P([[0, 5], [10, 5]])], 1],
  ['nested squares', [P([[0, 0], [10, 0], [10, 10], [0, 10]], true), P([[2, 2], [8, 2], [8, 8], [2, 8]], true)], 0],
  ['overlapping squares', [P([[0, 0], [10, 0], [10, 10], [0, 10]], true), P([[5, 2], [15, 2], [15, 8], [5, 8]], true)], 2],
  ['bow-tie loop', [P([[0, 0], [10, 10], [10, 0], [0, 10]], true)], 1],
  ['closing point repeated', [P([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])], 0],
  ['three passages at a point', [P([[0, 0], [5, 5], [5, 15], [-5, 15], [-5, 5], [5, 5], [10, 0], [10, -5], [3, -5], [4, 2], [6, 8], [8, 20]])], 2],
];
let checks = 0;
for (const [name, paths, want] of cases) {
  const got = pathCrossings(paths);
  assert.strictEqual(got.count, want, `${name}: ${got.count} crossings, want ${want} ${JSON.stringify(got.crossings)}`);
  checks++;
}
assert.strictEqual(CROSSING_TOL_MM, 0.002); checks++;
// the same answers moved / turned anywhere (no exact-zero test decides anything)
for (const [name, paths, want] of cases) {
  const th = 0.7, c = Math.cos(th), s = Math.sin(th);
  const moved = paths.map((p) => ({ ...p, points: p.points.map(({ x, y }) => ({ x: 123.456 + x * c - y * s, y: -78.9 + x * s + y * c })) }));
  assert.strictEqual(pathCrossings(moved).count, want, `${name} turned: want ${want}`);
  checks++;
}
console.log(`path-crossings-804: ${checks} checks passed`);
