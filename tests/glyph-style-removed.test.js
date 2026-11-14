// tests/glyph-style-removed.test.js -- TASK 592: the round "badge" constraint-glyph style is gone; the outlined glyph is the only style.
// The Style panel has no glyph-style choice, no style template or setting declares GLYPH_STYLE, and a GLYPH_STYLE='badge' a user saved earlier
// is ignored without an error: the glyphs still render outlined (no coloured disc, no sprite <use>).
import assert from 'node:assert';
import fs from 'node:fs';

const store = { 'sketch-studio-settings': JSON.stringify({ GLYPH_STYLE: 'badge' }) }; // what a user on the old badge style has stored
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const { STYLE_SETTING_KEYS, STYLE_TEMPLATES } = await import('../packages/ui/style-templates.js');
const { loadGlyphSheet } = await import('../packages/ui/glyph-sheet.js');
const { glyphDrawnRadiusPx } = await import('../packages/ui/hover-manager.js');
const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => fs.readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });

// 1. nothing declares the setting any more: not the defaults, not a template, not the Style panel (its controls are source-declared)
assert.ok(!('GLYPH_STYLE' in SettingsManager.getDefaults()), 'GLYPH_STYLE is not a declared setting');
assert.ok(!STYLE_SETTING_KEYS.includes('GLYPH_STYLE'), 'no style template key for it');
for (const t of STYLE_TEMPLATES) assert.ok(!('GLYPH_STYLE' in t.settings), t.id + ': the template has no GLYPH_STYLE');
const panelSrc = fs.readFileSync(new URL('../packages/ui/style-panel.js', import.meta.url), 'utf8');
assert.ok(!/GLYPH_STYLE|Glyph Style|Badge/.test(panelSrc), 'the Style panel declares no glyph-style choice');

// 2. the stale stored value is ignored: it is loaded (the manager keeps unknown keys) but nothing reads it
assert.strictEqual(SettingsManager.get('GLYPH_STYLE'), 'badge', 'the stored value is still in the settings object');
assert.ok(!('GLYPH_STYLE' in SettingsManager.getDefaults()) && !('GLYPH_STYLE' in (STYLE_TEMPLATES[0].settings)), 'but no default or template knows it');
const diag = await import('../packages/ui/diagnostic-log.js');
assert.ok(!('GLYPH_STYLE' in diag.changedSettings()), 'the report header (changedSettings) does not list it');
assert.strictEqual(glyphDrawnRadiusPx(), 10, 'the glyph pick radius is the outlined glyph (GLYPH_SYMBOL_SIZE_PX / 2), whatever is stored');

// 3. the glyphs render outlined, with no error
const joints = new Map([['a', { x: 0, y: 0 }], ['b', { x: 100, y: 0 }], ['c', { x: 100, y: 60 }]]);
const shapes = [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }];
const cons = [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['b', 'c'] }, { type: 'perpendicular', shapes: ['L1', 'L2'] }];
const svg = { viewBox: { baseVal: { x: -50, y: -50, width: 300, height: 200 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 600, height: 400 }), innerHTML: '' };
draw(joints, shapes, svg, null, null, cons, new Set(), new Set(), null, null, new Set(), null, null, null, null, null, false, null);
const glyphs = [...svg.innerHTML.matchAll(/<g class="constraint-glyph"[^>]*>(.*?)<\/g>(?=<g|$|<[a-z])/g)].map((m) => m[1]);
assert.ok(glyphs.length >= 3, 'three constraint glyphs are drawn, got ' + glyphs.length);
assert.ok(glyphs.every((b) => /class="fusion-glyph"/.test(b)), 'every glyph is the outlined sheet glyph');
assert.ok(glyphs.every((b) => !/<use /.test(b) && !/fill:#60A5FA|fill:var\(--sk-constraint-fill/.test(b)), 'no sprite <use>, no coloured badge disc');
console.log('glyph-style-removed.test.js: ok');
