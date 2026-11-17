// tests/review-grid-754.test.js — TASK 754: the Export step's 3D view stands on the Design canvas's paper with the Design canvas's grid.
// Node: the grid spec (review-grid.js reviewGridSpec) is derived from the SAME declarations the Design grid draws from: the GRID_MODE
// setting (lines -> lines, points -> dots, off -> none), the spacing of canvas-grid's gridSpacingFromSettings + gridLevel (mm and inch
// documents: the 3D level == the Design pattern's spacing at the same zoom), the mark sizes (GRID_MARK_PX), and the colours read from
// the Design canvas's own tokens (designCanvasColors; index.html declares them once; review-grid.js / review-view.js hold no colour).
// The real scene (clear colour, the grid drawn at that spacing, orbit / zoom, phone, app + Fusion mode) is review-grid-754-live.test.js.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { reviewGridSpec, designCanvasColors, DESIGN_CANVAS_TOKENS, GRID_FADE, gridMaterialSource } from '../apps/shaper/src/review-grid.js';
import { gridSpacingFromSettings, gridSpacing, gridDefsMarkup, gridLevel, GRID_MARK_PX, MIN_MINOR_PX } from '../packages/ui/canvas-grid.js';
import SettingsManager from '../packages/core/settings-manager.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const DEFAULTS = SettingsManager.getDefaults();
// a SettingsManager-like store: the declared defaults + overrides
const store = (over = {}) => ({ get: (k) => (k in over ? over[k] : DEFAULTS[k]), getDefault: (k) => DEFAULTS[k] });
const colors = { background: '#F4EFE1', minor: '#d8cfba', major: '#c4b896' };
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

// 1. style: GRID_MODE -> the 3D style, normalised like the Design grid (an unknown value = lines)
for (const [mode, want, visible] of [['lines', 'lines', true], ['points', 'points', true], ['off', 'off', false], ['bogus', 'lines', true], [undefined, 'lines', true]]) {
  const s = reviewGridSpec({ settings: store({ GRID_MODE: mode }), unit: 'mm', colors, pxPerMm: 4 });
  eq([s.mode, s.visible], [want, visible], `GRID_MODE ${mode}: ${want}, ${visible ? 'shown' : 'hidden'}`);
  eq(s.markPx, want === 'points' ? GRID_MARK_PX.points : GRID_MARK_PX.lines, `GRID_MODE ${mode}: the Design grid's mark sizes`);
  eq(s.colors, colors, `GRID_MODE ${mode}: the colours passed through unchanged`);
}

// 2. spacing: mm (the declared defaults, and stored values), cm, inch documents (decimal and binary divisions, another major)
const pattern = (markup, id) => Number(new RegExp(`<pattern id="${id}"[^>]* width="([^"]+)"`).exec(markup)[1]);
const cases = [
  ['mm defaults', 'mm', {}, { minor: 10, major: 100 }],
  ['mm 2 / 10', 'mm', { GRID_SIZE: 2, GRID_MAJOR_STEP: 10 }, { minor: 2, major: 10 }],
  ['cm defaults', 'cm', {}, { minor: 10, major: 100 }],
  ['inch tenths', 'in', {}, { minor: 2.54, major: 25.4 }],
  ['inch eighths', 'in', { INCH_GRID_DIVISIONS: 8 }, { minor: 25.4 / 8, major: 25.4 }],
  ['inch sixteenths, 2 in major', 'in', { INCH_GRID_DIVISIONS: 16, INCH_GRID_MAJOR: 2 }, { minor: 50.8 / 16, major: 50.8 }],
];
for (const [name, unit, over, base] of cases) {
  const settings = store(over);
  const sp = gridSpacingFromSettings(settings, unit);
  // the reader is the renderer's: gridSpacing of the stored numbers (a non-number falls back to its declared default)
  eq(sp, gridSpacing(unit, { GRID_SIZE: Number(settings.get('GRID_SIZE')), GRID_MAJOR_STEP: Number(settings.get('GRID_MAJOR_STEP')), INCH_GRID_DIVISIONS: settings.get('INCH_GRID_DIVISIONS'), INCH_GRID_MAJOR: settings.get('INCH_GRID_MAJOR') }), name + ': gridSpacingFromSettings == gridSpacing of the stored values');
  for (const pxPerMm of [40, 8, 4, 2, 1, 0.5, 0.2, 0.05]) {
    const s = reviewGridSpec({ settings, unit, colors, pxPerMm });
    ok(Math.abs(s.base.minor - base.minor) < 1e-9 && Math.abs(s.base.major - base.major) < 1e-9, `${name}: the base spacing ${JSON.stringify(s.base)}`);
    // the Design canvas at the same zoom draws its <pattern>s at exactly the 3D level's spacing (same gridLevel, same settings)
    const scale = (px) => px / pxPerMm;
    const markup = gridDefsMarkup({ ...sp, scale, gridMode: 'lines' });
    ok(Math.abs(pattern(markup, 'grid') - s.minor) < 1e-9 && Math.abs(pattern(markup, 'grid-heavy') - s.major) < 1e-9, `${name} @ ${pxPerMm} px/mm: the Design pattern ${pattern(markup, 'grid')} / ${pattern(markup, 'grid-heavy')} == the 3D level ${s.minor} / ${s.major}`);
    eq(s.fade, gridLevel({ ...sp, scale }).fade, `${name} @ ${pxPerMm} px/mm: the light-line fade is the Design grid's`);
    // zoomed in enough, a 3D grid cell IS the setting's cell (the board measures the same number of cells as in Design)
    if (base.minor * pxPerMm >= MIN_MINOR_PX) ok(Math.abs(s.minor - base.minor) < 1e-9 && s.major === s.base.major, `${name} @ ${pxPerMm} px/mm: the base level`);
    else ok(s.minor * pxPerMm >= MIN_MINOR_PX || s.minor > base.minor, `${name} @ ${pxPerMm} px/mm: a coarser level, never light lines under ${MIN_MINOR_PX} px (unless the last level)`);
  }
}
// an inch document's levels stay round inches (the Design grid's 1-2-5 / binary tables)
for (const pxPerMm of [8, 2, 0.5, 0.1]) {
  const s = reviewGridSpec({ settings: store(), unit: 'in', colors, pxPerMm });
  const inches = s.minor / 25.4;
  ok([1, 2, 5].some((m) => Math.abs(Math.log10(inches / m) - Math.round(Math.log10(inches / m))) < 1e-9), `inch tenths @ ${pxPerMm}: the light spacing ${inches} in is a 1-2-5 inch step`);
}

// 3. colours: read from the Design canvas's computed style, by the declared token names; a token that resolves to nothing throws
eq(DESIGN_CANVAS_TOKENS, { background: '--shaper-cream', minor: '--sk-grid-minor', major: '--sk-grid-major' }, 'the Design canvas tokens');
const style = (vals) => ({ getPropertyValue: (n) => vals[n] ?? '' });
eq(designCanvasColors(style({ '--shaper-cream': ' #F4EFE1', '--sk-grid-minor': '#d8cfba ', '--sk-grid-major': '#c4b896' })), colors, 'the three colours, trimmed');
eq(designCanvasColors(style({ '--shaper-cream': '#fff', '--sk-grid-minor': 'rgb(255, 0, 0)', '--sk-grid-major': '#00f' })), { background: '#fff', minor: 'rgb(255, 0, 0)', major: '#00f' }, 'a template token value is taken as resolved');
assert.throws(() => designCanvasColors(style({ '--shaper-cream': '#fff', '--sk-grid-minor': '#000' })), /--sk-grid-major/, 'a missing token throws, naming it'); checks++;

// 4. ONE declaration: index.html declares the paper once (--shaper-cream), the Design canvas paints with it and declares the grid tokens;
// the 3D stage's CSS surface is the same paper; no colour literal for the background or the grid in the 3D code
const html = read('apps/shaper/index.html');
// every CSS block of exactly that selector (a plain id / :root), joined
const block = (sel) => { const all = [...html.matchAll(new RegExp(`\\n\\s*${sel} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n'); assert.ok(all, 'no CSS block ' + sel); return all; };
ok(/--shaper-cream:\s*#F4EFE1;/.test(block(':root')), ':root declares the paper --shaper-cream');
ok(/--shaper-review-bg:\s*var\(--shaper-cream\);/.test(block(':root')), 'the 3D stage surface (--shaper-review-bg) is the paper token, not a copied hex');
const dc = block('#design-canvas');
ok(/background-color:\s*var\(--shaper-cream\)/.test(dc), 'the Design canvas paints var(--shaper-cream)');
ok(/--sk-grid-minor:\s*#[0-9a-f]{6};/i.test(dc) && /--sk-grid-major:\s*#[0-9a-f]{6};/i.test(dc), 'the Design canvas declares its grid tokens');
for (const f of ['apps/shaper/src/review-grid.js']) ok(!/#[0-9a-f]{3,6}\b|0x[0-9a-f]{6}/i.test(read(f).replace(/^\s*\/\/.*$/gm, '').replace(/#include/g, '')), f + ': no colour literal');
const rv = read('apps/shaper/src/review-view.js');
ok(!/0x14161a/i.test(rv) && /scene\.background = new THREE\.Color\(\);/.test(rv) && /scene\.background\.setStyle\(gridColors\.background\)/.test(rv), 'review-view.js: the clear colour is set only from the Design canvas colours');
ok(/designCanvas: document\.getElementById\('design-canvas'\)/.test(read('apps/shaper/src/main.js')), 'main.js hands the Design canvas element to the 3D view');
// the feature is Shaper's Export 3D only: no other host imports it
const filesIn = (dir) => fs.readdirSync(path.join(root, dir), { recursive: true }).map((f) => path.join(dir, String(f))).filter((f) => /\.(js|html)$/.test(f) && !/vendor/.test(f));
const users = [...filesIn('apps'), ...filesIn('packages')].filter((f) => /import[^;]*review-grid\.js/.test(read(f))).map((f) => f.replace(/\\/g, '/')).sort();
eq(users, ['apps/shaper/src/review-view.js'], 'only the Shaper 3D view imports the 3D grid (not Export 2D, Design or another host)');

// 5. the shader plane: one material, the Design grid's minimum spacing, a fade-out with no edge
ok(gridMaterialSource.fragmentShader.includes(`MIN_PX = ${MIN_MINOR_PX.toFixed(1)}`), 'the shader thins lines under the Design grid\'s MIN_MINOR_PX');
ok(/fwidth/.test(gridMaterialSource.fragmentShader) && /smoothstep\(uFadeFrom, uFadeTo/.test(gridMaterialSource.fragmentShader), 'screen-space marks (fwidth) and a smooth fade-out');
ok(GRID_FADE.from > 1 && GRID_FADE.to > GRID_FADE.from, 'the grid extends beyond the board and fades out before the plane ends');

console.log(`review-grid-754: ${checks} checks passed`);
