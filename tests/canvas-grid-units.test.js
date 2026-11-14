// tests/canvas-grid-units.test.js — TASK 532 part A: the ONE grid spacing per document unit + inch divisions (pure).
import assert from 'node:assert';
import { gridSpacing, gridLevel, gridDefsMarkup, GRID_SPACING_BY_UNIT, GRID_INCH_DIVISIONS } from '#ui/canvas-grid.js';
import SettingsManager from '#core/settings-manager.js';

const S = { GRID_SIZE: 2, GRID_MAJOR_STEP: 10 };
const IN = 25.4;
// mm (and cm: no row) = the settings, untouched; the divisions setting is ignored
assert.deepStrictEqual(gridSpacing('mm', S), S);
assert.deepStrictEqual(gridSpacing('cm', { ...S, INCH_GRID_DIVISIONS: 8 }), S);
assert.deepStrictEqual(gridSpacing('mm', { GRID_SIZE: 3, GRID_MAJOR_STEP: 12 }), { GRID_SIZE: 3, GRID_MAJOR_STEP: 12 });
assert.deepStrictEqual(GRID_INCH_DIVISIONS, [10, 2, 4, 8, 16]);
assert.strictEqual(SettingsManager.get('INCH_GRID_DIVISIONS'), 10, 'declared default');
// TASK 532 (owner): the mm DEFAULT grid is heavy every 100 mm, light every 10 mm (was 10 / 2, kept by anyone with those values stored/set)
assert.strictEqual(SettingsManager.getDefault('GRID_MAJOR_STEP'), 100);
assert.strictEqual(SettingsManager.getDefault('GRID_SIZE'), 10);
assert.deepStrictEqual(gridSpacing('mm', SettingsManager.getDefaults()), { GRID_SIZE: 10, GRID_MAJOR_STEP: 100 });
// the old default, when SET, is still exactly the old grid
assert.deepStrictEqual(gridSpacing('mm', { GRID_SIZE: 2, GRID_MAJOR_STEP: 10 }), { GRID_SIZE: 2, GRID_MAJOR_STEP: 10 });
assert(gridDefsMarkup({ GRID_SIZE: 2, GRID_MAJOR_STEP: 10, scale: (px) => px * 0.2, gridMode: 'lines' }).startsWith('<pattern id="grid" width="2" height="2"'));

const near = (a, b) => Math.abs(a - b) < 1e-9;
// "round in the chosen system" for major M inches, n divisions: a multiple of M/n (the base minor), M itself, or a step of the declared
// nice sequence (decimal: 1, 2, 5 x 10^e; binary: 2^e)
const isNice = (v, n) => (n === 10 ? [1, 2, 5].some((m) => near(Math.log10(v / m), Math.round(Math.log10(v / m)))) : near(Math.log2(v), Math.round(Math.log2(v))));
const isRound = (inches, n, M) => (near(inches * n / M, Math.round(inches * n / M)) || near(inches, M) || isNice(inches, n));
for (const M of [1, 2, 12]) for (const n of GRID_INCH_DIVISIONS) {
  const sp = gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: n, INCH_GRID_MAJOR: M });
  assert(near(sp.GRID_SIZE, IN * M / n) && near(sp.GRID_MAJOR_STEP, IN * M), `M=${M} n=${n} base M/n in, major M in`);
  for (const s of [0.02, 0.05, 0.2, 0.5, 1, 3]) {
    const L = gridLevel({ ...sp, scale: (px) => px * s });
    assert(isRound(L.minor / IN, n, M), `M=${M} n=${n} zoom ${s}: minor ${L.minor / IN} in not round`);
    assert(isRound(L.major / IN, n, M) && near(L.major / L.minor, Math.round(L.major / L.minor)), `M=${M} n=${n} zoom ${s}: major ${L.major / IN} in`);
    assert(L.major >= L.minor);
    assert(L.fade === 0 || L.minorPx >= 8 - 1e-9, 'visible light lines never denser than MIN_MINOR_PX');
  }
  // snap lands on multiples of M/n inch
  for (const x of [37.3, -12.9, 0.4, 301.7]) {
    const g = Math.round(x / sp.GRID_SIZE) * sp.GRID_SIZE;
    assert(near(g / IN * n / M, Math.round(g / IN * n / M)), `M=${M} n=${n} snap ${x}`);
  }
}
// a 40-zoom zoom-out sweep: only round inch values, the heavy never goes back
for (const n of GRID_INCH_DIVISIONS) {
  const spn = gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: n });
  let last = 0;
  for (let i = 0, p = 0.2; i < 40; i++, p *= 1.25) {
    const L = gridLevel({ ...spn, scale: (px) => px * p });
    assert(L.major >= last - 1e-9 && isRound(L.major / IN, n, 1) && isRound(L.minor / IN, n, 1), `n=${n} sweep ${i}: heavy ${L.major / IN} in, light ${L.minor / IN} in`);
    last = L.major;
  }
}
// invalid major falls back to 1 in
assert(near(gridSpacing('in', { ...S, INCH_GRID_MAJOR: -3 }).GRID_MAJOR_STEP, IN));
// binary sequence below an inch halves/doubles: 1/16 -> 1/8 -> 1/4 -> 1/2 -> 1
const sp16 = gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: 16 });
const seq = [];
for (const s of [0.07, 0.15, 0.3, 0.6, 1.2]) seq.push(gridLevel({ ...sp16, scale: (px) => px * s }).minor / IN);
assert(seq.every((v, i) => i === 0 || near(v / seq[i - 1], 2) || near(v / seq[i - 1], 1)), 'halving/doubling only: ' + seq);
// decimal: 1-2-5 steps
const sp10 = gridSpacing('in', S);
const l10 = gridLevel({ ...sp10, scale: (px) => px });
assert(near(l10.major / IN, 5) && near(l10.minor / IN, 1), 'decimal inch at 1 px/mm: heavy 5 in, light 1 in (0.2 in = 5 px is too dense)');
// mm levels unchanged
assert.strictEqual(gridLevel({ ...S, scale: (px) => px }).minor, 10);
// switching the setting re-draws: different markup per divisions
const mk = (n) => gridDefsMarkup({ ...gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: n }), scale: (px) => px * 0.1, gridMode: 'lines' });
assert(mk(10) !== mk(8) && mk(8) !== mk(4));
assert(gridDefsMarkup({ ...gridSpacing('in', { ...S, INCH_GRID_MAJOR: 2 }), scale: (px) => px * 0.1, gridMode: 'lines' }) !== mk(10), 'major change re-draws');
assert.strictEqual(SettingsManager.get('INCH_GRID_MAJOR'), 1);
assert(GRID_SPACING_BY_UNIT.in);
console.log('canvas-grid-units: ok');
