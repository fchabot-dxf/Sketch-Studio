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

const near = (a, b) => Math.abs(a - b) < 1e-9;
// "round in the chosen system" for major M inches, n divisions: a multiple of M/n below M; M times a power of the LOD ratio above
const isRound = (inches, n, M) => (inches < M - 1e-9 ? near(inches * n / M, Math.round(inches * n / M))
  : (() => { const r = n === 10 ? 10 : 2; const k = Math.log(inches / M) / Math.log(r); return near(k, Math.round(k)); })());
for (const M of [1, 2, 12]) for (const n of GRID_INCH_DIVISIONS) {
  const sp = gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: n, INCH_GRID_MAJOR: M });
  assert(near(sp.GRID_SIZE, IN * M / n) && near(sp.GRID_MAJOR_STEP, IN * M), `M=${M} n=${n} base M/n in, major M in`);
  for (const s of [0.02, 0.05, 0.2, 0.5, 1, 3]) {
    const L = gridLevel({ ...sp, scale: (px) => px * s });
    assert(isRound(L.minor / IN, n, M), `M=${M} n=${n} zoom ${s}: minor ${L.minor / IN} in not round`);
    assert(isRound(L.major / IN, n, M) && near(L.major / L.minor, Math.round(L.major / L.minor)), `M=${M} n=${n} zoom ${s}: major ${L.major / IN} in`);
    assert(L.major >= L.minor);
    assert(L.minorPx >= 8 - 1e-9, 'never denser than MIN_MINOR_PX');
  }
  // snap lands on multiples of M/n inch
  for (const x of [37.3, -12.9, 0.4, 301.7]) {
    const g = Math.round(x / sp.GRID_SIZE) * sp.GRID_SIZE;
    assert(near(g / IN * n / M, Math.round(g / IN * n / M)), `M=${M} n=${n} snap ${x}`);
  }
}
// invalid major falls back to 1 in
assert(near(gridSpacing('in', { ...S, INCH_GRID_MAJOR: -3 }).GRID_MAJOR_STEP, IN));
// binary sequence below an inch halves/doubles: 1/16 -> 1/8 -> 1/4 -> 1/2 -> 1
const sp16 = gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: 16 });
const seq = [];
for (const s of [0.07, 0.15, 0.3, 0.6, 1.2]) seq.push(gridLevel({ ...sp16, scale: (px) => px * s }).minor / IN);
assert(seq.every((v, i) => i === 0 || near(v / seq[i - 1], 2) || near(v / seq[i - 1], 1)), 'halving/doubling only: ' + seq);
// decimal: x10 steps
const sp10 = gridSpacing('in', S);
assert(near(gridLevel({ ...sp10, scale: (px) => px * 0.5 }).minor / IN, 1));
// mm levels unchanged
assert.strictEqual(gridLevel({ ...S, scale: (px) => px }).minor, 10);
// switching the setting re-draws: different markup per divisions
const mk = (n) => gridDefsMarkup({ ...gridSpacing('in', { ...S, INCH_GRID_DIVISIONS: n }), scale: (px) => px * 0.1, gridMode: 'lines' });
assert(mk(10) !== mk(8) && mk(8) !== mk(4));
assert(gridDefsMarkup({ ...gridSpacing('in', { ...S, INCH_GRID_MAJOR: 2 }), scale: (px) => px * 0.1, gridMode: 'lines' }) !== mk(10), 'major change re-draws');
assert.strictEqual(SettingsManager.get('INCH_GRID_MAJOR'), 1);
assert(GRID_SPACING_BY_UNIT.in);
console.log('canvas-grid-units: ok');
