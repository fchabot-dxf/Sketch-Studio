// tests/style-templates.test.js — TASK 481: shared Style templates (settings only; the renderer is untouched).
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const { loadGlyphSheet } = await import('../packages/ui/glyph-sheet.js');
const { DOMParserShim } = await import('./helpers/xml-dom-shim.js');
await loadGlyphSheet({ fetchFn: async () => ({ ok: true, text: async () => fs.readFileSync(new URL('../assets/constraint-glyphs.svg', import.meta.url), 'utf8') }), parser: new DOMParserShim() });
const { STYLE_TEMPLATES, STYLE_SETTING_KEYS, CUSTOM_TEMPLATE_ID, activeStyleTemplateId, applyStyleTemplate, getStyleTemplate, bindTemplateTokens } =
  await import('../packages/ui/style-templates.js');

// The fixed sketch: rectangle with a fillet, hexagon, a construction diagonal (dimensions are constraints).
const joints = new Map(); const shapes = [];
const J = (id, x, y) => joints.set(id, { x, y });
J('a', 100, 100); J('b', 300, 100); J('c', 300, 200); J('d', 100, 200);
for (const [i, [p, q]] of [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']].entries()) shapes.push({ id: 'r' + i, type: 'line', joints: [p, q] });
shapes.push({ id: 'diag', type: 'line', joints: ['a', 'c'], construction: true });
J('o1', 20, 20); J('o2', 60, 20);
shapes.push({ id: 'open', type: 'line', joints: ['o1', 'o2'] });
const hex = [];
for (let i = 0; i < 6; i++) { J('h' + i, 500 + 60 * Math.cos(i * Math.PI / 3), 300 + 60 * Math.sin(i * Math.PI / 3)); hex.push('h' + i); }
hex.forEach((p, i) => shapes.push({ id: 'hx' + i, type: 'line', joints: [p, hex[(i + 1) % 6]] }));
const constraints = [
  { id: 'k1', type: 'distance', joints: ['a', 'b'], value: 200 },
  { id: 'k2', type: 'distance', joints: ['b', 'c'], value: 100 },
];
const render = (sel = new Set(), hov = null) => {
  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    innerHTML: '',
  };
  draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), null, null, sel, hov, null, null, null, null, false, null);
  return svg.innerHTML;
};
const strokeWidths = (m) => [...m.matchAll(/stroke-width="([\d.]+)"/g)].map((x) => +x[1]);

const before = render();
assert(before.length > 200, 'the fixed sketch renders markup');

// 1. declaration: every template covers the same keys; no built-in template declares colour tokens (the Fusion colours are the stylesheet defaults)
for (const t of STYLE_TEMPLATES) {
  assert(!t.tokens, t.id + ' declares no tokens');
  assert.deepStrictEqual(Object.keys(t.settings).sort(), [...STYLE_SETTING_KEYS].sort(), t.id + ' covers every template key');
}
assert.deepStrictEqual(STYLE_TEMPLATES.map((t) => t.id), ['default', 'compact', 'presentation']);
assert.strictEqual(STYLE_TEMPLATES[0].name, 'Fusion (default)');
const defaults = SettingsManager.getDefaults();
assert.strictEqual(defaults.STYLE_TEMPLATE, 'default', 'the chosen template reuses the old PRESET slot');
assert(!('PRESET' in defaults), 'PRESET is gone (renamed)');
for (const k of STYLE_SETTING_KEYS) assert.strictEqual(getStyleTemplate('default').settings[k], defaults[k], 'Default = factory ' + k);
// the factory values ARE the former Fusion template's (task 630)
assert.strictEqual(defaults.LINE_STROKE, 0.25); assert.strictEqual(defaults.JOINT_RADIUS, 1.0);
assert.strictEqual(defaults.GLYPH_SYMBOL_SIZE_PX, 25); assert.strictEqual(defaults.SELECTION_FEEDBACK_MULT, 2.33);
// a stored STYLE_TEMPLATE 'fusion' (a removed id) loads as the default, with no error
assert.strictEqual(getStyleTemplate('fusion'), getStyleTemplate('default'), 'a stored fusion id falls back to the default template');
SettingsManager.set('STYLE_TEMPLATE', 'fusion');
assert.strictEqual(activeStyleTemplateId(SettingsManager.getAll()), 'default', 'a stored fusion id reads as the default look');

// 2. Compact renders thinner markup; Default restores the original markup exactly
applyStyleTemplate('compact');
const f = SettingsManager.getAll();
assert.strictEqual(f.STYLE_TEMPLATE, 'compact');
assert.strictEqual(f.LINE_STROKE, 0.3); assert.strictEqual(f.JOINT_RADIUS, 1);
assert.strictEqual(f.HOVER_FEEDBACK_MULT, 3); assert.strictEqual(f.SELECTION_FEEDBACK_MULT, 2.5);
assert.strictEqual(activeStyleTemplateId(f), 'compact');
const compact = render();
assert.notStrictEqual(compact, before, 'Compact changes the look');
applyStyleTemplate('presentation');
assert(Math.max(...strokeWidths(render())) > Math.max(...strokeWidths(before)), 'Presentation strokes are heavier');
applyStyleTemplate('default');
assert.strictEqual(render(), before, 'Default restores the original markup byte-for-byte');
assert.strictEqual(activeStyleTemplateId(SettingsManager.getAll()), 'default');

// 3. Custom after an edit (the edit is kept)
applyStyleTemplate('default');
SettingsManager.set('LINE_STROKE', 0.5);
assert.strictEqual(activeStyleTemplateId(SettingsManager.getAll()), CUSTOM_TEMPLATE_ID);
assert.strictEqual(SettingsManager.get('LINE_STROKE'), 0.5);

// 4. persistence across reload: a fresh module instance reads the same localStorage
applyStyleTemplate('presentation');
const fresh = (await import(pathToFileURL(new URL('../packages/core/settings-manager.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href + '?reload')).default;
assert.strictEqual(fresh.get('STYLE_TEMPLATE'), 'presentation');
assert.strictEqual(activeStyleTemplateId(fresh.getAll()), 'presentation');
assert.strictEqual(fresh.get('LINE_STROKE'), getStyleTemplate('presentation').settings.LINE_STROKE);

// 5. every host that mounts the Style panel gets the select (it is built inside the shared createStylePanel)
const panel = fs.readFileSync(new URL('../packages/ui/style-panel.js', import.meta.url), 'utf8');
assert(/dataset\.key = 'STYLE_TEMPLATE'/.test(panel) && /STYLE_TEMPLATES/.test(panel), 'the shared panel builds the Template select');
const hosts = ['../apps/sketchstudio/main.js', '../apps/shaper/src/main.js'];
for (const h of hosts) {
  assert(/createStylePanel\(/.test(fs.readFileSync(new URL(h, import.meta.url), 'utf8')), h + ' mounts the shared Style panel');
}

// 6. TASK 489: Fusion colours + glyph style (tokens on the canvas host only; Default unchanged)
const sketch2 = { joints: new Map(), shapes: [] };
sketch2.joints.set('p', { x: 50, y: 400, fixed: true }); sketch2.joints.set('q', { x: 250, y: 400, fixed: true });
sketch2.joints.set('u', { x: 50, y: 500 }); sketch2.joints.set('v', { x: 250, y: 520 });
sketch2.shapes.push({ id: 'fixedLine', type: 'line', joints: ['p', 'q'] }, { id: 'freeLine', type: 'line', joints: ['u', 'v'] },
  { id: 'cons', type: 'line', joints: ['p', 'v'], isConstruction: true });
const glyphConstraints = [{ id: 'g1', type: 'horizontal', joints: ['u', 'v'] }, { id: 'g2', type: 'parallel', shapes: ['fixedLine', 'freeLine'] }];
const render2 = (hov = null) => {
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), innerHTML: '' };
  draw(sketch2.joints, sketch2.shapes, svg, null, null, glyphConstraints, new Set(), new Set(), null, null, new Set(), hov, null, null, null, null, false, null);
  return svg.innerHTML;
};
applyStyleTemplate('default');
const d2 = render2();
assert(/fusion-glyph/.test(d2) && !/<use /.test(d2), 'Default glyphs are the outlined glyphs (the only style)');
assert(/var\(--sk-geo-fixed, #202020\)/.test(d2), 'Default: fixed line uses the geo-fixed token');
assert(/var\(--sk-construction, #f97316\)/.test(d2), 'Default: construction line uses the construction token');
applyStyleTemplate('compact');
const f2 = render2();
assert(/fusion-glyph/.test(f2), 'Compact renders outlined glyphs');
assert(f2 !== d2, 'Compact differs from Default on the same sketch');
assert(/stroke:var\(--sk-selection, #017AFD\)/i.test(render2('freeLine')), 'hover draws the --sk-selection token');
applyStyleTemplate('default');
assert.strictEqual(render2(), d2, 'Default markup identical after a Compact round trip');

// tokens go on the host element only: no built-in sets any; a saved preset that carries tokens still applies them
const mkHost = () => { const props = {}; return { props, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } } }; };
const host = mkHost(), chrome = mkHost();
const unbind = bindTemplateTokens(host);
assert.strictEqual(Object.keys(host.props).length, 0, 'Default sets no tokens');
SettingsManager.set('STYLE_PRESETS', { v: 1, presets: [{ id: 'user-old', name: 'Old Fusion', settings: { ...getStyleTemplate('default').settings }, tokens: { '--sk-geo-fixed': '#000000', '--sk-constraint-fill': '#2B9BD6' } }] });
applyStyleTemplate('user-old');
assert.strictEqual(host.props['--sk-geo-fixed'], '#000000', 'a preset with tokens sets them on the host');
assert.strictEqual(host.props['--sk-constraint-fill'], '#2B9BD6');
assert.strictEqual(Object.keys(chrome.props).length, 0, 'tokens never touch another element');
applyStyleTemplate('compact');
assert.strictEqual(Object.keys(host.props).length, 0, 'Compact clears the tokens');
applyStyleTemplate('user-old'); SettingsManager.resetToDefaults();
assert.strictEqual(Object.keys(host.props).length, 0, 'reset to defaults clears the tokens');
unbind();

console.log('style-templates.test.js passed');
