// tests/canvas-grid-lod.test.js — level of detail + fade of the shared grid (pure, on gridDefsMarkup/gridLevel).
import assert from 'assert';
import { gridDefsMarkup, gridLevel, MIN_MINOR_PX } from '#ui/canvas-grid.js';

const G = 2, M = 20; // a 1/10 grid
const at = (pxPerUnit) => { const z = 1 / pxPerUnit; return (s) => s * z; };
const lvl = (pxPerUnit) => gridLevel({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(pxPerUnit) });

// 3 zooms: in / mid / far out → minor spacing G / ×10 / ×100, always >= MIN_MINOR_PX on screen
const near = lvl(50), mid = lvl(1), far = lvl(0.05);
assert.strictEqual(near.minor, G);
assert.strictEqual(mid.minor, G * 10);
assert.strictEqual(far.minor, G * 100);
for (const l of [near, mid, far]) {
  assert(l.minorPx >= MIN_MINOR_PX, `minor ${l.minor} is ${l.minorPx}px < ${MIN_MINOR_PX}`);
  assert.strictEqual(l.major, l.minor * 10);
}
for (let p = 100; p > 0.0001; p *= 0.93) assert(lvl(p).minorPx >= MIN_MINOR_PX, `px/unit ${p}`);

// never subdivides below GRID_SIZE when zoomed in
assert.strictEqual(lvl(10000).minor, G);

// fade is monotone in zoom within a level and 0 at the threshold, 1 at 2×
assert.strictEqual(lvl(MIN_MINOR_PX / G).fade, 0);
assert.strictEqual(lvl(2 * MIN_MINOR_PX / G).fade, 1);
let prev = -1;
for (let p = MIN_MINOR_PX / G; p <= 2 * MIN_MINOR_PX / G; p += 0.05) {
  const f = lvl(p).fade;
  assert(f >= prev, 'fade must not decrease while zooming in within a level');
  prev = f;
}

// markup follows the same levels in both modes
const lines = (p) => gridDefsMarkup({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(p), gridMode: 'lines' });
const points = (p) => gridDefsMarkup({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(p), gridMode: 'points' });
assert(lines(50).includes('<pattern id="grid" width="2" height="2"') && !lines(50).includes('opacity'));
assert(lines(1).includes('<pattern id="grid" width="20" height="20"') && lines(1).includes('<pattern id="grid-heavy" width="200"'));
assert(lines(0.05).includes('<pattern id="grid" width="200" height="200"'));
assert(lines(0.4).includes('stroke-opacity="'), 'partially faded minor');
assert(points(1).includes('<pattern id="grid" x="-10" y="-10" width="20" height="20"'));
assert(points(0.05).includes('width="200" height="200"'));
assert(points(0.4).includes('fill-opacity="'));
assert(!points(50).includes('opacity'));

console.log('canvas-grid-lod: ok');
