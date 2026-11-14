// tests/hover-color-removed-node.test.js — TASK 630: HOVER_COLOR is not a setting; hover always draws the --sk-selection blue.
// A stored HOVER_COLOR ('#5B6CF0', the old violet) in the settings AND inside a saved user preset must change nothing.
import assert from 'node:assert';
import fs from 'node:fs';

const VIOLET = '#5B6CF0';
const store = {
  'sketch-studio-settings': JSON.stringify({
    HOVER_COLOR: VIOLET,
    STYLE_PRESETS: {
      v: 1,
      presets: [{ id: 'user-fusion2', name: 'Fusion2', settings: { LINE_STROKE: 0.25, JOINT_RADIUS: 1.4, JOINT_STROKE_MULT: 1.4, SELECTION_FEEDBACK_MULT: 1.5, HOVER_FEEDBACK_MULT: 2, GLYPH_SYMBOL_SIZE_PX: 23, GLYPH_INFERENCE_SIZE_PX: 21, GLYPH_OFFSET_PX: 19, GLYPH_OUTLINE_PX: 0.7, DASH_LENGTH_PX: 7, DASH_GAP_PX: 4, DIM_LABEL_BOX: false, HOVER_COLOR: VIOLET, LABEL_FONT_FAMILY: '', PROFILE_FILL: 'off', LOCKED_LINE_COLOR: '' } }],
    },
  }),
};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const T = await import('../packages/ui/style-templates.js');

assert.strictEqual(SettingsManager.getDefault('HOVER_COLOR'), undefined, 'no HOVER_COLOR default');
assert.ok(!T.STYLE_SETTING_KEYS.includes('HOVER_COLOR'), 'HOVER_COLOR is not a style key');
assert.ok(T.STYLE_TEMPLATES.every((t) => !('HOVER_COLOR' in t.settings)), 'no built-in template carries HOVER_COLOR');
assert.ok(!fs.readFileSync(new URL('../packages/ui/style-panel.js', import.meta.url), 'utf8').includes('HOVER_COLOR'), 'the Style panel has no hover-colour control');

const preset = T.listUserPresets().find((p) => p.id === 'user-fusion2');
assert.ok(preset, 'a saved preset that stores HOVER_COLOR still loads');
T.applyStyleTemplate('user-fusion2');
assert.strictEqual(T.activeStyleTemplateId(SettingsManager.getAll()), 'user-fusion2', 'the preset is still recognised as active');

const joints = new Map([['a', { x: 10, y: 10 }], ['b', { x: 90, y: 10 }]]);
const shapes = [{ id: 'l1', type: 'line', joints: ['a', 'b'] }];
const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 100, height: 100 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 100 }), innerHTML: '' };
draw(joints, shapes, svg, null, null, [], new Set(), new Set(), null, null, new Set(), 'l1', null, null, null, null, false, null);
const tag = svg.innerHTML.match(/<line[^>]*data-shape-id="l1"[^>]*>/)[0];
assert.match(tag, /stroke:var\(--sk-selection, #017AFD\)/i, 'hovered line draws the --sk-selection blue');
assert.ok(!svg.innerHTML.toLowerCase().includes(VIOLET.toLowerCase()), 'no violet anywhere in the hovered render');

const saved = T.saveUserPreset('Fusion2');
assert.ok(!('HOVER_COLOR' in saved.settings), 're-saving a preset drops HOVER_COLOR');
console.log('hover-color-removed-node.test.js passed');
