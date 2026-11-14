// tests/canvas-grid-lod.test.js — level of detail + fade of the shared grid (pure, on gridDefsMarkup/gridLevel).
import assert from 'assert';
import { gridDefsMarkup, gridLevel, MIN_MINOR_PX, MIN_MAJOR_PX } from '#ui/canvas-grid.js';

const G = 2, M = 20; // a 1/10 grid
const at = (pxPerUnit) => { const z = 1 / pxPerUnit; return (s) => s * z; };
const lvl = (pxPerUnit) => gridLevel({ GRID_SIZE: G, GRID_MAJOR_STEP: M, scale: at(pxPerUnit) });

// 3 zooms: in / mid / far out. Heavy = the base 20, then the 1-2-5 sequence above it (50, 100, 200, 500, 1000 ...), the light lines
// major/10 (the largest nice step not coarser than the base's 10 divisions, dividing the heavy evenly); heavy always >= MIN_MAJOR_PX on screen
const near = lvl(50), mid = lvl(1), far = lvl(0.05);
assert.deepStrictEqual([near.major, near.minor], [20, 2]);
assert.deepStrictEqual([mid.major, mid.minor], [50, 5]);
assert.deepStrictEqual([far.major, far.minor], [1000, 100]);
for (let p = 100; p > 0.0001; p *= 0.93) {
  const l = lvl(p);
  assert(l.major * p >= MIN_MAJOR_PX - 1e-9, `px/unit ${p}: heavy ${l.major * p}px`);
  assert(l.fade === 0 || l.minorPx >= MIN_MINOR_PX, `px/unit ${p}: visible light lines under MIN_MINOR_PX`);
}

// TASK 633 (mm file, 1 mm / 10 mm): the heavy 10 mm lines are kept while >= MIN_MAJOR_PX; the 1 mm lines fade out on their own
const mm = (p) => gridLevel({ GRID_SIZE: 1, GRID_MAJOR_STEP: 10, scale: at(p) });
assert.deepStrictEqual([mm(8.4).major, mm(8.4).minor], [10, 1]);          // owner CLOSE: light ~8.4 px, nearly faded
assert(mm(8.4).fade < 0.06);
assert.deepStrictEqual([mm(6.2).major, mm(6.2).minor, mm(6.2).fade], [10, 1, 0]);  // owner FAR: heavy 10 mm, no light lines
assert.deepStrictEqual([mm(4.01).major, mm(4.01).minor], [10, 1]);
assert.deepStrictEqual([mm(3).major, mm(3).minor, mm(3).fade], [20, 2, 0]);   // one step further out: heavy 20, light 2 (still faded out)
assert.deepStrictEqual([mm(1.5).major, mm(1.5).minor], [50, 5]);
assert.deepStrictEqual([mm(0.7).major, mm(0.7).minor, mm(0.7).fade], [100, 10, 0]);

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
assert(lines(1).includes('<pattern id="grid" width="5" height="5"') && lines(1).includes('<pattern id="grid-heavy" width="50"'));
assert(lines(0.05).includes('<pattern id="grid" width="100" height="100"'));
assert(lines(6).includes('stroke-opacity="'), 'partially faded minor');
assert(points(1).includes('<pattern id="grid" x="-2.5" y="-2.5" width="5" height="5"'));
assert(points(0.05).includes('width="100" height="100"'));
assert(points(6).includes('fill-opacity="'));
assert(!points(50).includes('opacity'));

console.log('canvas-grid-lod: ok');
