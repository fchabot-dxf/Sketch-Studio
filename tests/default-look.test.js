// tests/default-look.test.js -- TASK 614: the owner's look is the app's DEFAULT look (factory values; canvas colours = the --sk-* CSS defaults).
//  1. a fresh profile reads exactly the owner's values; Default = those, no tokens; the CSS defaults equal Fusion's tokens; Compact / Presentation unchanged
//  2. Reset to factory defaults gives the same
//  3. a stored user preset still applies over it; a stored choice (a preset, or an applied built-in) is kept over the new factory values
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
const clear = () => { for (const k of Object.keys(store)) delete store[k]; };
const smUrl = new URL('../packages/core/settings-manager.js', import.meta.url);
const freshSM = async (n) => (await import(pathToFileURL(smUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href + '?p' + n)).default; // a new page load
const T = await import('../packages/ui/style-templates.js');

const OWNER = { LINE_STROKE: 0.25, JOINT_RADIUS: 1.4, JOINT_STROKE_MULT: 1.4, SELECTION_FEEDBACK_MULT: 1.5, HOVER_FEEDBACK_MULT: 2,
  GLYPH_SYMBOL_SIZE_PX: 23, GLYPH_INFERENCE_SIZE_PX: 21, GLYPH_OFFSET_PX: 19, GLYPH_OUTLINE_PX: 0.7,
  DASH_LENGTH_PX: 7, DASH_GAP_PX: 4, DIM_LABEL_BOX: false,
  LABEL_FONT_FAMILY: '', PROFILE_FILL: 'off', LOCKED_LINE_COLOR: '' };
assert.deepStrictEqual(Object.keys(OWNER).sort(), [...T.STYLE_SETTING_KEYS].sort(), 'the owner values cover every look knob');
const looks = (all) => Object.fromEntries(T.STYLE_SETTING_KEYS.map((k) => [k, all[k]]));
const FUSION_TOKENS = { '--sk-canvas-bg': '#FFFFFF', '--sk-canvas-bg-snapping': '#F3F8FB', '--sk-grid-minor': '#E2E6EA', '--sk-grid-major': '#C9CFD6',
  '--sk-constraint-fill': '#2B9BD6', '--sk-geo-fixed': '#000000', '--sk-construction': '#A9744F', '--sk-constraint-stroke': '#1F2937',
  '--sk-selection': '#017AFD', '--sk-profile-fill': '#5B9BF0', '--sk-profile-tint': '#3AA0DC', '--sk-joint-fill': '#FFFFFF' };
const mkHost = () => { const props = {}; return { props, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } } }; };

// 1. fresh profile
clear();
const sm = await freshSM(1);
assert.deepStrictEqual(looks(sm.getAll()), OWNER, 'a fresh profile reads the owner values');
assert.strictEqual(sm.get('STYLE_TEMPLATE'), 'default');
const def = T.STYLE_TEMPLATES.find((t) => t.id === 'default');
assert.deepStrictEqual(def.settings, OWNER, 'the built-in Default template gives the owner look');
assert.strictEqual(def.tokens, undefined, 'Default declares no tokens (a host theme, e.g. Shaper cream, is not overridden)');
assert.deepStrictEqual(T.STYLE_TEMPLATES.find((t) => t.id === 'fusion').tokens, FUSION_TOKENS, 'Fusion keeps its tokens');
const css = fs.readFileSync(new URL('../packages/ui/sketcher.css', import.meta.url), 'utf8').match(/:root\s*\{[\s\S]*?\n\}/)[0];
for (const [n, v] of Object.entries(FUSION_TOKENS)) if (!/profile/.test(n)) assert(new RegExp(n + ':\\s*' + v + '\\b', 'i').test(css), 'sketcher.css default ' + n + ' = ' + v);
// Compact / Presentation: resolved settings identical to what origin/main gave them (the old factory filled the keys they did not set)
const OLDF = { LINE_STROKE: 1, JOINT_RADIUS: 4, JOINT_STROKE_MULT: 1, SELECTION_FEEDBACK_MULT: 2, HOVER_FEEDBACK_MULT: 3, GLYPH_SYMBOL_SIZE_PX: 20, GLYPH_INFERENCE_SIZE_PX: 24, GLYPH_OFFSET_PX: 40, GLYPH_OUTLINE_PX: 1, DASH_LENGTH_PX: 8, DASH_GAP_PX: 8, DIM_LABEL_BOX: true, LABEL_FONT_FAMILY: '', PROFILE_FILL: 'off', LOCKED_LINE_COLOR: '' };
assert.deepStrictEqual(T.STYLE_TEMPLATES.find((t) => t.id === 'compact').settings, { ...OLDF, LINE_STROKE: 0.3, JOINT_RADIUS: 1, JOINT_STROKE_MULT: 0.8, SELECTION_FEEDBACK_MULT: 2.5, GLYPH_SYMBOL_SIZE_PX: 12, GLYPH_INFERENCE_SIZE_PX: 14, GLYPH_OFFSET_PX: 26, DASH_LENGTH_PX: 5, DASH_GAP_PX: 4 }, 'Compact resolves as on origin/main');
assert.deepStrictEqual(T.STYLE_TEMPLATES.find((t) => t.id === 'presentation').settings, { ...OLDF, LINE_STROKE: 1.5, JOINT_RADIUS: 5, JOINT_STROKE_MULT: 1, SELECTION_FEEDBACK_MULT: 1.5, HOVER_FEEDBACK_MULT: 2, GLYPH_SYMBOL_SIZE_PX: 28, GLYPH_INFERENCE_SIZE_PX: 32, GLYPH_OFFSET_PX: 56, DASH_LENGTH_PX: 14, DASH_GAP_PX: 8 }, 'Presentation resolves as on origin/main');
assert.strictEqual(T.activeStyleTemplateId(sm.getAll()), 'default', 'the panel shows Default');
const host = mkHost(); const unbind = T.bindTemplateTokens(host, sm);
assert.deepStrictEqual(host.props, {}, 'a fresh profile: the host gets no inline tokens');

// 2. reset gives the same, from any other look
T.applyStyleTemplate('presentation', sm);
T.applyStyleTemplate('fusion', sm); assert.deepStrictEqual(host.props, FUSION_TOKENS, 'Fusion sets its tokens');
sm.resetToDefaults();
assert.deepStrictEqual(looks(sm.getAll()), OWNER, 'Reset to factory defaults: the owner values');
assert.deepStrictEqual(host.props, {}, 'Reset clears the tokens');
assert.strictEqual(T.activeStyleTemplateId(sm.getAll()), 'default');
unbind();

// 3a. a stored user preset applies over the new default, on a fresh page load
clear();
const sm2 = await freshSM(2);
sm2.set('LINE_STROKE', 0.7); sm2.set('DASH_GAP_PX', 3); T.saveUserPreset('Mine', sm2);
const sm3 = await freshSM(3);
const mine = T.listUserPresets(sm3)[0];
assert.strictEqual(sm3.get('STYLE_TEMPLATE'), mine.id, 'the stored choice is the user preset');
assert.strictEqual(sm3.get('LINE_STROKE'), 0.7, 'stored value wins over the new factory value');
assert.strictEqual(T.activeStyleTemplateId(sm3.getAll()), mine.id);
T.applyStyleTemplate('default', sm3); T.applyStyleTemplate(mine.id, sm3);
assert.strictEqual(sm3.get('LINE_STROKE'), 0.7, 'the preset still applies over Default');

// 3b. a user who EARLIER applied the built-in Default has every key stored with the OLD factory values + STYLE_TEMPLATE 'default'
clear();
const OLD = { LINE_STROKE: 1, JOINT_RADIUS: 4, JOINT_STROKE_MULT: 1, SELECTION_FEEDBACK_MULT: 2, HOVER_FEEDBACK_MULT: 3, GLYPH_SYMBOL_SIZE_PX: 20,
  GLYPH_INFERENCE_SIZE_PX: 24, GLYPH_OFFSET_PX: 40, GLYPH_OUTLINE_PX: 1, DASH_LENGTH_PX: 8, DASH_GAP_PX: 8, DIM_LABEL_BOX: true,
  LABEL_FONT_FAMILY: '', PROFILE_FILL: 'off', LOCKED_LINE_COLOR: '' };
store['sketch-studio-settings'] = JSON.stringify({ STYLE_TEMPLATE: 'default', ...OLD });
const sm4 = await freshSM(4);
assert.deepStrictEqual(looks(sm4.getAll()), OLD, 'stored values win: that user keeps the old look');
assert.strictEqual(T.activeStyleTemplateId(sm4.getAll()), T.CUSTOM_TEMPLATE_ID, 'the panel shows Custom (the stored values no longer equal Default)');
const host2 = mkHost(); T.bindTemplateTokens(host2, sm4)();
assert.deepStrictEqual(host2.props, {}, '...and no inline tokens, as before');
T.applyStyleTemplate('default', sm4);
assert.deepStrictEqual(looks(sm4.getAll()), OWNER, 'picking Default in the panel gives the new look');
console.log('default-look.test.js passed');
