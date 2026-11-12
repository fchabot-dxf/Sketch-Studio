// tests/canvas-grid-label-step.test.js — TASK 536: the ONE rule for the step between the grid's axis numbers (pure).
import assert from 'node:assert';
import { labelStep, gridLabelsMarkup, gridSpacing, TARGET_LABEL_GAP_PX, MAX_LABELS_PER_AXIS, NICE_LABEL_STEPS } from '#ui/canvas-grid.js';

assert.strictEqual(TARGET_LABEL_GAP_PX, 100);
assert.deepStrictEqual(NICE_LABEL_STEPS.decimal.mantissas, [1, 2, 5]);
const near = (a, b) => Math.abs(a - b) < 1e-12 * Math.max(1, Math.abs(b));
const mm = (pxPerUnit, major = 10, minor = 2) => labelStep({ major, minor, pxPerUnit, lodRatio: undefined });

// the owner's case: heavy 10, light 2, 10 units = 265 px -> 5 (not 2, not 10)
assert.strictEqual(mm(26.5), 5);
// thresholds (TARGET 100): each step starts where step x px/unit reaches 100
for (const [ppu, want] of [[100, 2], [99.9, 2], [50.01, 2], [50, 2], [49.9, 5], [20, 5], [19.9, 10], [10, 10], [9.9, 20], [5, 20], [4.9, 50], [2, 50], [1.99, 100], [1, 100], [0.5, 200], [0.01, 10000]]) {
  assert.strictEqual(mm(ppu), want, `mm ppu=${ppu}`);
}
// never finer than the light lines (rounded down to a nice step): light 2 -> never 1; light 10 -> never below 10
assert.strictEqual(mm(1000), 2); assert.strictEqual(mm(1e6), 2);
assert.strictEqual(mm(1e6, 100, 10), 10);
// the heavy lines' values are always labelled: step divides the heavy spacing or is a whole multiple of it
for (const [major, minor] of [[10, 2], [100, 10], [25, 5]]) {
  for (let ppu = 1e-4; ppu < 1e5; ppu *= 1.3) {
    const s = mm(ppu, major, minor);
    assert(s > 0 && Number.isFinite(s), 'positive finite');
    const r = s >= major ? s / major : major / s;
    assert(Math.abs(r - Math.round(r)) < 1e-9, `step ${s} vs heavy ${major} at ${ppu}`);
  }
}
assert.strictEqual(mm(26.5, 25, 5), 5, 'heavy 25: 5 divides it and is 132 px apart');
assert.strictEqual(mm(10, 25, 5), 50, 'heavy 25: 10 and 20 do not divide 25 and 25 is not nice: the next fit is 50');
// decimal inches (file unit inch, heavy 1, light 0.1)
assert.ok(near(labelStep({ major: 1, minor: 0.1, pxPerUnit: 300, lodRatio: 10 }), 0.5));
assert.ok(near(labelStep({ major: 1, minor: 0.1, pxPerUnit: 1000, lodRatio: 10 }), 0.1));
assert.ok(near(labelStep({ major: 1, minor: 0.1, pxPerUnit: 1e6, lodRatio: 10 }), 0.1), 'not finer than the light lines');
// binary inches: ... 1/16 1/8 1/4 1/2 1 2 4 ... never finer than the light spacing
const bin = (ppu, minor = 1 / 8, major = 1) => labelStep({ major, minor, pxPerUnit: ppu, lodRatio: 2 });
assert.strictEqual(bin(100), 1); assert.strictEqual(bin(101), 1);
assert.strictEqual(bin(200), 1 / 2); assert.strictEqual(bin(400), 1 / 4); assert.strictEqual(bin(800), 1 / 8);
assert.strictEqual(bin(1e6), 1 / 8, 'light lines 1/8: never 1/16');
assert.strictEqual(bin(1e6, 1 / 16), 1 / 16);
assert.strictEqual(bin(30), 4); assert.strictEqual(bin(3), 64); assert.strictEqual(bin(1e-6), 2 ** 23 >= 1 ? bin(1e-6) : 0);
// very far out / in: finite, positive, terminates
for (const ppu of [1e-300, 1e-12, 1e12, 1e300, Infinity, NaN]) { const s = mm(ppu); assert(s > 0 && Number.isFinite(s), 'ppu ' + ppu + ' -> ' + s); }

// markup: owner's zoom (heavy 10, light 2, 26.5 px/mm): X numbers 5, 10, 15, 20 and -5, -10 ...; ticks only on the 5s
const sp = gridSpacing('mm', { GRID_SIZE: 2, GRID_MAJOR_STEP: 10 });
const scale = (px) => px / 26.5;
const wide = { x: -25, y: -10, width: 50, height: 20 };
const html = gridLabelsMarkup({ ...sp, scale: (px) => px / 26.5, vb: wide, docUnit: 'mm' });
const xs = [...html.matchAll(/<text transform="translate\(([-\d.e]+) [^)]*\) rotate\(90\)" dominant-baseline/g)].map((m) => Number(m[1]));
assert.deepStrictEqual(xs, [-25, -20, -15, -10, -5, 5, 10, 15, 20, 25]);
const tickPath = /id="grid-label-ticks" d="([^"]*)"/.exec(html)[1];
const tickX = [...tickPath.matchAll(/M ([-\d.e]+) 0 V/g)].map((m) => Number(m[1]));
assert.deepStrictEqual(tickX, [-25, -15, -5, 5, 15, 25], 'ticks on the numbers with no heavy line (the 5s), not on the 10s');
assert.deepStrictEqual([...tickPath.matchAll(/M 0 ([-\d.e]+) H/g)].map((m) => Number(m[1])), [-5, 5], 'Y ticks at the 5s (world y -5 and 5), none at +-10 = the window edge or heavy');
assert(!/>0</.test(html), 'no 0');
assert(html.includes(`font-size="${11 / 26.5}"`), 'constant 11 px');
// cap per axis
const huge = gridLabelsMarkup({ ...sp, scale: () => 1e-9, vb: { x: 0, y: 0, width: 1e-6, height: 1e-6 }, docUnit: 'mm' });
assert((huge.match(/<text/g) || []).length <= 2 * MAX_LABELS_PER_AXIS);
assert.strictEqual(gridLabelsMarkup({ ...sp, scale, vb: null, docUnit: 'mm' }), '');
console.log('canvas-grid-label-step: ok');
