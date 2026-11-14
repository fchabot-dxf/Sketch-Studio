// tests/fusion-glyphs-polish.test.js — TASK 491: Fusion glyph paint, glyph coverage, glyph/label overlap, dimension text placement + font.
import assert from 'node:assert';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { draw } = await import('../packages/ui/svg-renderer.js');
const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { applyStyleTemplate } = await import('../packages/ui/style-templates.js');
const { CONSTRAINT_GLYPH, fusionGlyphMarkup } = await import('../packages/ui/fusion-glyphs.js');
const { loadGlyphSheet, getGlyph } = await import('../packages/ui/glyph-sheet.js');
const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
const { readFileSync } = await import('node:fs');
await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });
const { CONSTRAINT_TYPES } = await import('../packages/core/constants.js');
const { rectsIntersect, placeDimText } = await import('../packages/ui/dim-placement.js');

// every constraint type the renderer draws a glyph for maps to a glyph in the sheet (fixed / angle / distance have none)
for (const t of Object.values(CONSTRAINT_TYPES)) {
  if (['distance', 'angle', 'fixed'].includes(t)) continue;
  assert(CONSTRAINT_GLYPH[t] && getGlyph(CONSTRAINT_GLYPH[t]), `renderer constraint type ${t} has a sheet glyph`);
}

// paint: white fill + black outline on every path, no halo technique
for (const t of Object.keys(CONSTRAINT_GLYPH)) {
  const m = fusionGlyphMarkup(t, 24, 24, 1, 'white', '#000');
  assert(/style="fill:white; stroke:#000"/.test(m) && /stroke-linejoin="round"/.test(m) && !/paint-order/.test(m), `${t}: fill + outline`);
}

// sketch (same as the 489 evidence): horizontal + vertical dimensions on a rectangle, glyph constraints
const joints = new Map([['a', { x: 100, y: 100, fixed: true }], ['b', { x: 300, y: 100, fixed: true }], ['c', { x: 300, y: 200, fixed: true }], ['d', { x: 100, y: 200, fixed: true }]]);
const shapes = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']].map((j, i) => ({ id: 'r' + i, type: 'line', joints: j }));
shapes.push({ id: 'k', type: 'line', joints: ['a', 'c'], isConstruction: true });
const mk = () => [
  { id: 'k1', type: 'distance', joints: ['a', 'b'], value: 200, dimMode: 'horizontal' },
  { id: 'k2', type: 'distance', joints: ['b', 'c'], value: 100, dimMode: 'vertical' },
  { id: 'k6', type: 'perpendicular', shapes: ['r0', 'r1'] },
  { id: 'k7', type: 'perpendicular', shapes: ['r1', 'r2'] },
];
const render = () => {
  const cons = mk();
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 700, height: 320 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 700, height: 320 }), innerHTML: '' };
  draw(joints, shapes, svg, null, null, cons, new Set(), new Set(), null, null, new Set(), null, null, null, null, null, false, null);
  return { html: svg.innerHTML, cons };
};

applyStyleTemplate('fusion');
const { html, cons } = render();

const texts = [...html.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => {
  const a = (n) => (new RegExp(`${n}="([^"]*)"`).exec(m[1]) || [])[1];
  return { x: +a('x'), y: +a('y'), size: +a('font-size'), rot: /rotate\(/.test(m[1]), font: a('font-family'), s: m[2] };
}).filter((t) => /^\d/.test(t.s));
assert.strictEqual(texts.length, 2, 'two dimension values drawn');
const hT = texts.find((t) => !t.rot), vT = texts.find((t) => t.rot);
assert(hT && vT, 'horizontal text plain, vertical text rotated');
for (const t of texts) assert(/Segoe UI/.test(t.font), 'dimension text uses the Fusion sans-serif font');

// horizontal: text above the line (dimension line y = 130) and within its span [100, 300]
const hw = hT.s.length * hT.size * 0.55 / 2;
assert(hT.y < 130, 'horizontal text sits above its dimension line');
assert(hT.x - hw >= 100 && hT.x + hw <= 300, 'horizontal text sits within the line span');
// vertical: text beside the line (x = 330), rotated, within [100, 200]
const vh = vT.s.length * vT.size * 0.55 / 2;
assert(vT.x > 330, 'vertical text sits beside (right of) its dimension line');
assert(vT.y - vh >= 100 && vT.y + vh <= 200, 'vertical text sits within the line span');

// the placement function itself: rect clear of the line
const p = placeDimText({ cx: 200, cy: 130, dirX: 1, dirY: 0, text: '200.0', fontPx: 11, gap: 3 });
assert(p.bounds.y1 <= 127 + 1e-9 && p.bounds.x0 >= 100 && p.bounds.x1 <= 300, 'placeDimText: above, within span');

// no glyph rectangle intersects a dimension label rectangle
const ICON = SettingsManager.get('GLYPH_SYMBOL_SIZE_PX'); // the icon size drawn: Fusion's (applied above); was a literal 20, the old factory size
const labelRects = [
  placeDimText({ cx: 200, cy: 130, dirX: 1, dirY: 0, text: hT.s, fontPx: hT.size, gap: 3 }).bounds,
  placeDimText({ cx: 330, cy: 150, dirX: 0, dirY: 1, text: vT.s, fontPx: vT.size, gap: 3 }).bounds,
];
const glyphCentres = [...html.matchAll(/class="constraint-glyph"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)/g)].map((m) => ({ x: +m[1], y: +m[2] }));
assert(glyphCentres.length >= 4, 'glyph positions rendered');
for (const q of glyphCentres) {
  const r = { x0: q.x - ICON / 2, y0: q.y - ICON / 2, x1: q.x + ICON / 2, y1: q.y + ICON / 2 };
  for (const l of labelRects) assert(!rectsIntersect(r, l), `glyph at ${q.x},${q.y} does not cover a dimension label`);
}

// Default is untouched: no font attribute, text centred on the line
applyStyleTemplate('default');
const d = render().html;
assert(!/font-family/.test(d.match(/<text [^>]*>\d/g).join('')), 'Default dimension text has no font-family');
// the default label is plain text (DIM_LABEL_BOX off, task 614): the vertical value is rotated along its line; a boxed label (on) stays upright
assert.strictEqual(/rotate\(/.test(d.match(/<text [^>]*>\d/g).join('')), !SettingsManager.get('DIM_LABEL_BOX'), 'Default dimension text is rotated exactly when the default has no label box');

console.log('fusion-glyphs-polish.test.js passed');
