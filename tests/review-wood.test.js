// tests/review-wood.test.js — TASK 497: the birch plywood look of the Review board (two textures, planar face UVs, edge UVs from world
// position, wiring). The Wood toggle's on/off behaviour on a real mesh is asserted in review-live.test.js (needs three + WebGL).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { planarUVs, TILE_MM, WOOD_URL, EDGE_URL, EDGE_TILE_MM, edgeUVs } from '../apps/shaper/src/review-view.js';

const root = path.resolve(import.meta.dirname, '..');
const view = fs.readFileSync(path.join(root, 'apps/shaper/src/review-view.js'), 'utf8');
for (const [file, cap, url] of [['birch-plywood.jpg', 400, WOOD_URL], ['birch-plywood-edge.jpg', 250, EDGE_URL]]) {
  const p = path.join(root, 'apps/shaper/assets', file);
  assert.ok(fs.existsSync(p), file + ' exists');
  assert.ok(fs.statSync(p).size < cap * 1024, `${file} is under ${cap} KB: ${fs.statSync(p).size}`);
  assert.ok(view.includes('assets/' + file), 'review-view.js references ' + file);
  assert.ok(url.endsWith('/apps/shaper/assets/' + file), url);
}
assert.doesNotMatch(fs.readFileSync(path.join(root, 'packages/core/relief-model.js'), 'utf8'), /\buv\b|TILE/, 'the core relief model stays texture-free');

assert.strictEqual(TILE_MM, 400);
const pos = new Float32Array([100, -3, 40, 600, 0, 250]);
const uv = planarUVs(pos);
assert.deepStrictEqual([...uv], [100 / TILE_MM, 40 / TILE_MM, 600 / TILE_MM, 250 / TILE_MM].map(Math.fround), 'u = x / TILE, v = z / TILE');
const swapped = planarUVs(pos, TILE_MM, true);
assert.deepStrictEqual([...swapped], [40 / TILE_MM, 100 / TILE_MM, 250 / TILE_MM, 600 / TILE_MM].map(Math.fround), 'a long-X board swaps the axes so the grain follows X');

// the plywood edge: v = y / EDGE_TILE_MM (monotone in y); u runs along the wall, picked by the wall's own normal
assert.strictEqual(EDGE_TILE_MM, 25);
const ys = [-19.05, -12.7, -9, -5, -2, 0];
const wallX = edgeUVs(new Float32Array(ys.flatMap((y) => [10, y, 20])), new Float32Array(ys.flatMap(() => [1, 0, 0])));
const vs = ys.map((_, i) => wallX[i * 2 + 1]);
assert.ok(vs.every((v, i) => i === 0 || v > vs[i - 1]), 'edge v is monotone in y: ' + vs);
assert.ok(Math.abs(vs[5]) < 1e-6 && Math.abs(vs[0] - Math.fround(-19.05 / 25)) < 1e-6, 'v = y / EDGE_TILE_MM');
assert.ok(ys.every((_, i) => Math.abs(wallX[i * 2] - Math.fround(20 / 25)) < 1e-6), 'a wall facing x runs along z: u = z / EDGE_TILE_MM');
const wallZ = edgeUVs(new Float32Array([10, -3, 20]), new Float32Array([0, 0, -1]));
assert.ok(Math.abs(wallZ[0] - Math.fround(10 / 25)) < 1e-6, 'a wall facing z runs along x: u = x / EDGE_TILE_MM');
console.log('review-wood: ok');
