// tests/canvas-grid-units.test.js — TASK 532 part A: the ONE grid spacing per document unit (pure).
import assert from 'node:assert';
import { gridSpacing, gridLevel, GRID_SPACING_BY_UNIT } from '#ui/canvas-grid.js';

const S = { GRID_SIZE: 2, GRID_MAJOR_STEP: 10 };
// mm (and cm: no row) = the settings, untouched
assert.deepStrictEqual(gridSpacing('mm', S), S);
assert.deepStrictEqual(gridSpacing('cm', S), S);
assert.deepStrictEqual(gridSpacing('mm', { GRID_SIZE: 3, GRID_MAJOR_STEP: 12 }), { GRID_SIZE: 3, GRID_MAJOR_STEP: 12 });
// inch = round inch values (0.1 in / 1 in) in world mm
const i = gridSpacing('in', S);
assert(Math.abs(i.GRID_SIZE - 2.54) < 1e-12 && Math.abs(i.GRID_MAJOR_STEP - 25.4) < 1e-12);
// level of detail: every displayed minor/major is a round inch value at several zooms
for (const s of [0.05, 0.2, 0.5, 1, 3]) {
  const L = gridLevel({ ...i, scale: (px) => px * s });
  for (const v of [L.minor, L.major]) {
    const inches = v / 25.4;
    const dec = Math.round(inches * 1000) / 1000;
    assert(Math.abs(inches - dec) < 1e-9 && /^\d+(\.\d{1,3})?$/.test(String(dec)), `non-round inch ${inches} at zoom ${s}`);
  }
}
// mm levels unchanged
assert.strictEqual(gridLevel({ ...gridSpacing('mm', S), scale: (px) => px * 1 }).minor, 10);
// snap rule: round(x/base)*base lands on 0.1 in multiples
const gx = Math.round(37.3 / i.GRID_SIZE) * i.GRID_SIZE;
assert(Math.abs(gx / 25.4 * 10 - Math.round(gx / 25.4 * 10)) < 1e-9);
assert(GRID_SPACING_BY_UNIT.in);
console.log('canvas-grid-units: ok');
