// tests/review-wood.test.js — TASK 497: the birch plywood look of the Review board (asset, planar UVs, wiring). The Wood toggle's
// on/off behaviour on a real mesh is asserted in review-live.test.js (needs three + WebGL).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { planarUVs, TILE_MM, WOOD_URL } from '../apps/shaper/src/review-view.js';

const root = path.resolve(import.meta.dirname, '..');
const jpg = path.join(root, 'apps/shaper/assets/birch-plywood.jpg');
assert.ok(fs.existsSync(jpg), 'the texture exists');
assert.ok(fs.statSync(jpg).size < 400 * 1024, 'the texture is under 400 KB: ' + fs.statSync(jpg).size);
const view = fs.readFileSync(path.join(root, 'apps/shaper/src/review-view.js'), 'utf8');
assert.match(view, /assets\/birch-plywood\.jpg/, 'review-view.js references the texture');
assert.ok(WOOD_URL.endsWith('/apps/shaper/assets/birch-plywood.jpg'), WOOD_URL);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'packages/core/relief-model.js'), 'utf8'), /\buv\b|TILE/, 'the core relief model stays texture-free');

assert.strictEqual(TILE_MM, 400);
const pos = new Float32Array([100, -3, 40, 600, 0, 250]);
const uv = planarUVs(pos);
assert.deepStrictEqual([...uv], [100 / TILE_MM, 40 / TILE_MM, 600 / TILE_MM, 250 / TILE_MM].map(Math.fround), 'u = x / TILE, v = z / TILE');
const swapped = planarUVs(pos, TILE_MM, true);
assert.deepStrictEqual([...swapped], [40 / TILE_MM, 100 / TILE_MM, 250 / TILE_MM, 600 / TILE_MM].map(Math.fround), 'a long-X board swaps the axes so the grain follows X');
console.log('review-wood: ok');
