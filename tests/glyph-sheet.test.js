// tests/glyph-sheet.test.js — TASK 505: the owner's glyph sheet is the single source of the Fusion glyphs.
import assert from 'node:assert';
import fs from 'node:fs';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { DOMParserShim, attributesRead } = await import('./helpers/xml-dom-shim.js');
const sheetText = fs.readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8');
const okFetch = async () => ({ ok: true, text: async () => sheetText });

const { dbg } = await import('../packages/core/debug.js');
const warns = [];
const origWarn = dbg.warn; dbg.warn = (...a) => { warns.push(a.join(' ')); };

// ---- the REAL file: exactly the 11 glyphs, finite bboxes, guides/labels ignored, transforms never read
const NAMES = ['coincident', 'collinear', 'concentric', 'equal', 'horizontal', 'midpoint', 'parallel', 'perpendicular', 'polygon', 'tangent', 'vertical'].map((n) => 'glyph-' + n);
const { parseGlyphSheet, getGlyph, loadGlyphSheet, onGlyphSheetReady } = await import('../packages/ui/glyph-sheet.js');
const { fusionGlyphMarkup, CONSTRAINT_GLYPH, loadFusionGlyphs } = await import('../packages/ui/fusion-glyphs.js');
const table = parseGlyphSheet(sheetText, new DOMParserShim());
assert.deepStrictEqual([...table.keys()].sort(), NAMES, 'exactly the 11 glyph-* groups (guides and labels ignored)');
for (const [id, g] of table) {
  assert(g.paths.length >= 1, `${id} has paths`);
  for (const v of [g.bbox.x0, g.bbox.y0, g.bbox.w, g.bbox.h, g.centre.x, g.centre.y]) assert(Number.isFinite(v), `${id} finite bbox`);
  assert(g.bbox.w > 0 && g.bbox.h > 0, `${id} bbox has size`);
}
assert.strictEqual(table.get('glyph-equal').paths.length, 2, 'rects are read as paths (equal = two bars)');
assert(table.get('glyph-equal').paths.every((d) => /^M[-\d.,]+L.*Z$/.test(d)), 'rect converted to a path d');
assert(!attributesRead.has('transform'), 'the loader never reads a transform');
assert(!attributesRead.has('style'), 'the loader never reads the file style');
// the table maps every needed glyph to a name the sheet has, pointOnLine -> coincident
for (const t of Object.keys(CONSTRAINT_GLYPH)) assert(table.has(CONSTRAINT_GLYPH[t]), `${t} -> ${CONSTRAINT_GLYPH[t]} exists in the sheet`);
assert.strictEqual(CONSTRAINT_GLYPH.pointOnLine, 'glyph-coincident');
assert(!('fixed' in CONSTRAINT_GLYPH) && !('angle' in CONSTRAINT_GLYPH), 'fixed and angle have no glyph');

// ---- before load: nothing drawn, no throw
assert.strictEqual(getGlyph('glyph-horizontal'), null);
assert.strictEqual(fusionGlyphMarkup('horizontal', 15, 15, 1, 'white', 'black'), '', 'no glyph until the sheet has loaded');
let ready = 0; onGlyphSheetReady(() => ready++);
assert.strictEqual(ready, 0);

// ---- load once; a repeat call does not fetch again; onReady fires
let fetches = 0;
await loadGlyphSheet({ fetchFn: async (u) => { fetches++; return okFetch(u); }, parser: new DOMParserShim(), expected: NAMES });
await loadGlyphSheet({ fetchFn: async (u) => { fetches++; return okFetch(u); }, parser: new DOMParserShim() });
assert.strictEqual(fetches, 1, 'fetched once'); assert.strictEqual(ready, 1, 'onReady fired once');
assert.strictEqual(warns.length, 0, 'a good load warns nothing');
assert(getGlyph('glyph-horizontal') && getGlyph('glyph-midpoint'));
assert.strictEqual(getGlyph('glyph-nope'), null, 'a missing name gives null, not a throw');

// ---- markup: first path d of the file's glyph, larger side = size, outline width from the setting only
const fg = { fusionGlyphMarkup }, gs = { getGlyph };
const hz = gs.getGlyph('glyph-horizontal');
const m1 = fg.fusionGlyphMarkup('horizontal', 20, 20, 1, 'white', 'black');
assert(m1.includes(`d="${hz.paths[0]}"`), 'markup carries the first path d of glyph-horizontal from the file');
const side = Math.max(hz.bbox.w, hz.bbox.h);
assert(m1.includes(`scale(${+(20 / side).toFixed(5)})`), 'larger bbox side scaled to the glyph size');
const m2 = fg.fusionGlyphMarkup('horizontal', 20, 20, 2.5, 'white', 'black');
assert.notStrictEqual(m1, m2);
const strip = (s) => s.replace(/stroke-width="[^"]*"/, '');
assert.strictEqual(strip(m1), strip(m2), 'changing the outline changes only stroke-width');
assert.strictEqual(+/stroke-width="([^"]*)"/.exec(m2)[1], +(2.5 * side / 20).toFixed(4), 'stroke-width = outline px in glyph units');
assert(/stroke-linejoin="round"/.test(m1) && !/paint-order/.test(m1));
assert.strictEqual(fg.fusionGlyphMarkup('pointOnLine', 20, 20, 1, 'w', 'b'), fg.fusionGlyphMarkup('coincident', 20, 20, 1, 'w', 'b'), 'pointOnLine uses glyph-coincident');
for (const t of ['fixed', 'angle', 'unknown', undefined]) assert.strictEqual(fg.fusionGlyphMarkup(t, 20, 20, 1, 'w', 'b'), '', `${t}: no glyph, no throw`);

// ---- failures warn once and never throw (fresh module instances)
for (const [label, fetchFn] of [['rejects', async () => { throw new Error('offline'); }], ['404', async () => ({ ok: false, status: 404 })], ['bad xml', async () => ({ ok: true, text: async () => '<svg><g id="glyph-x"/></svg>' })]]) {
  warns.length = 0;
  const mod = await import(`../packages/ui/glyph-sheet.js?fail=${label}`);
  assert.strictEqual(await mod.loadGlyphSheet({ fetchFn, parser: new DOMParserShim() }), null, label);
  await mod.loadGlyphSheet({ fetchFn, parser: new DOMParserShim() });
  assert.strictEqual(warns.length, 1, `${label}: reported once`);
  assert.strictEqual(mod.getGlyph('glyph-horizontal'), null);
}
{ // a glyph name missing from the sheet is reported once
  warns.length = 0;
  const mod = await import('../packages/ui/glyph-sheet.js?fail=missing');
  await mod.loadGlyphSheet({ fetchFn: okFetch, parser: new DOMParserShim(), expected: [...NAMES, 'glyph-renamed'] });
  assert.strictEqual(warns.length, 1); assert(/glyph-renamed/.test(warns[0]));
}
dbg.warn = origWarn;
assert.strictEqual(typeof loadFusionGlyphs, 'function');
console.log('glyph-sheet.test.js passed');
