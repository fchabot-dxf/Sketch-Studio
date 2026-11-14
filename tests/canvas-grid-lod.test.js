// tests/canvas-grid-lod.test.js — level of detail + fade of the shared grid (pure, on gridDefsMarkup/gridLevel).
import assert from 'assert';
import { gridDefsMarkup, gridLevel, MIN_MINOR_PX } from '#ui/canvas-grid.js';

const G = 2, M = 20; // a 1/10 grid
const at = (pxPerUnit) => { const z = 1 / pxPerUnit; return (s) => s * z; };
const lvl = (pxPerUnit) => gridLevel({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(pxPerUnit) });

// 3 zooms: in / mid / far out. Heavy = the base 20, then the 1-2-5 sequence above it (50, 100, 200, 500, 1000 ...); the light lines are
// heavy/5 where that is a nice step (Fusion's "heavy every 5 light lines"), else heavy/10, else heavy/4; the level is the first whose
// light lines are >= MIN_MINOR_PX apart on screen
const near = lvl(50), mid = lvl(1), far = lvl(0.05);
assert.deepStrictEqual([near.major, near.minor], [20, 2]);
assert.deepStrictEqual([mid.major, mid.minor], [50, 10]);
assert.deepStrictEqual([far.major, far.minor], [1000, 200]);
for (let p = 100; p > 0.0001; p *= 0.93) {
  const l = lvl(p);
  assert(l.minorPx >= MIN_MINOR_PX - 1e-9 || l.minor === G, `px/unit ${p}: light ${l.minorPx}px`);
}

// TASK 633 (mm file, 1 mm / 10 mm): light lines are visible as soon as drawn (short fade) and the level follows their on-screen spacing
const mm = (p) => gridLevel({ GRID_SIZE: 1, GRID_MAJOR_STEP: 10, scale: at(p) });
assert.deepStrictEqual([mm(8.4).major, mm(8.4).minor, mm(8.4).fade], [10, 1, 1]);   // owner CLOSE: light 8.4 px: fully visible
assert(Math.abs(mm(8.2).fade - 0.5) < 1e-9);
assert.deepStrictEqual([mm(9).major, mm(9).minor, mm(9).fade], [10, 1, 1]);   // full at 8.4 px
assert.deepStrictEqual([mm(6.2).major, mm(6.2).minor, mm(6.2).fade], [20, 2, 1]); // owner FAR: heavy 20, light 2 (12.4 px, full)
assert.deepStrictEqual([mm(3).major, mm(3).minor], [50, 10]);
assert.deepStrictEqual([mm(1.5).major, mm(1.5).minor], [50, 10]);
assert.deepStrictEqual([mm(0.7).major, mm(0.7).minor], [100, 20]);
assert.deepStrictEqual([mm(0.3).major, mm(0.3).minor], [200, 50]);
assert.deepStrictEqual([mm(0.15).major, mm(0.15).minor], [500, 100]);

// a slow zoom-out sweep (40 zooms): the heavy spacing is exactly the 1-2-5 sequence, never skips a step, never goes back
const nice125 = []; for (let e = 1; e < 9; e++) for (const m of [1, 2, 5]) nice125.push(m * 10 ** e);
const sweep = []; for (let i = 0, p = 10; i < 40; i++, p *= 0.8) sweep.push(mm(p));
const heavies = sweep.map((l) => l.major);
const distinct = heavies.filter((h, i) => i === 0 || h !== heavies[i - 1]);
assert.deepStrictEqual(distinct, nice125.slice(0, distinct.length), 'heavy spacing follows 10, 20, 50, 100, 200, 500 ...');
assert(distinct.length >= 10, 'the sweep crosses many steps: ' + distinct);
for (const l of sweep) assert(Number.isInteger(l.major / l.minor), 'light divides heavy');

// never subdivides below GRID_SIZE when zoomed in
assert.strictEqual(lvl(10000).minor, G);

// fade is monotone in zoom within a level and 0 at the threshold, 1 at 2×
assert.strictEqual(lvl(MIN_MINOR_PX / G).fade, 0);
assert.strictEqual(lvl(1.05 * MIN_MINOR_PX / G).fade, 1);
let prev = -1;
for (let p = MIN_MINOR_PX / G; p <= 1.05 * MIN_MINOR_PX / G; p += 0.05) {
  const f = lvl(p).fade;
  assert(f >= prev, 'fade must not decrease while zooming in within a level');
  prev = f;
}

// markup follows the same levels in both modes
const lines = (p) => gridDefsMarkup({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(p), gridMode: 'lines' });
const points = (p) => gridDefsMarkup({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(p), gridMode: 'points' });
assert(lines(50).includes('<pattern id="grid" width="2" height="2"') && !lines(50).includes('opacity'));
assert(lines(1).includes('<pattern id="grid" width="10" height="10"') && lines(1).includes('<pattern id="grid-heavy" width="50"'));
assert(lines(0.05).includes('<pattern id="grid" width="200" height="200"'));
assert(lines(4.1).includes('stroke-opacity="'), 'partially faded minor');
assert(points(1).includes('<pattern id="grid" x="-5" y="-5" width="10" height="10"'));
assert(points(0.05).includes('width="200" height="200"'));
assert(points(4.1).includes('fill-opacity="'));
assert(!points(50).includes('opacity'));

console.log('canvas-grid-lod: ok');
