// tests/style-presets.test.js — TASK 604: user style presets (the storage + validation layer; the panel clicks are in style-presets-live.test.js).
import assert from 'node:assert';

const store = {};
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { setDebugSink } = await import('../packages/core/debug.js');
const T = await import('../packages/ui/style-templates.js');
const warnings = [];
setDebugSink((e) => { if (e.level === 'warn') warnings.push(e.args.join(' ')); });

assert.deepStrictEqual(SettingsManager.getDefaults().STYLE_PRESETS, { v: 1, presets: [] }, 'one declared key, versioned, empty by default');

// save after changing two knobs; a preset carries every look key and nothing else
T.applyStyleTemplate('default');
SettingsManager.set('LINE_STROKE', 0.7); SettingsManager.set('DASH_GAP_PX', 3);
const p = T.saveUserPreset('  Mine ');
assert.strictEqual(p.name, 'Mine');
assert.deepStrictEqual(Object.keys(p.settings).sort(), [...T.STYLE_SETTING_KEYS].sort());
assert.deepStrictEqual(p.tokens, T.getStyleTemplate('default').tokens, 'a preset saved from Default carries the Default tokens (task 614)');
assert.strictEqual(SettingsManager.get('STYLE_TEMPLATE'), p.id, 'the saved preset becomes the chosen template');
assert.strictEqual(T.activeStyleTemplateId(SettingsManager.getAll()), p.id);

// the same apply path restores it; a built-in is untouched
T.applyStyleTemplate('default');
assert.strictEqual(SettingsManager.get('LINE_STROKE'), SettingsManager.getDefault('LINE_STROKE'));
const before = SettingsManager.getAll();
T.applyStyleTemplate(p.id);
const after = SettingsManager.getAll();
assert.strictEqual(after.LINE_STROKE, 0.7); assert.strictEqual(after.DASH_GAP_PX, 3);
for (const k of Object.keys(after)) if (!['LINE_STROKE', 'DASH_GAP_PX', 'STYLE_TEMPLATE'].includes(k)) assert.deepStrictEqual(after[k], before[k], k + ' unchanged');
assert.strictEqual(T.STYLE_TEMPLATES.find((t) => t.id === 'default').settings.LINE_STROKE, SettingsManager.getDefault('LINE_STROKE'), 'the built-in Default is unchanged by saving or applying a preset');

// tokens: a preset saved while Fusion is the template keeps Fusion's tokens
T.applyStyleTemplate('fusion');
const f = T.saveUserPreset('Fusion plus');
assert.deepStrictEqual(f.tokens, T.getStyleTemplate('fusion').tokens);
assert.notStrictEqual(f.tokens, T.getStyleTemplate('fusion').tokens, 'a copy, not the built-in object');

// names: empty, long, a built-in's, a duplicate (rename), overwrite keeps the id
assert(T.presetNameProblem('') && T.presetNameProblem('x'.repeat(41)) && T.presetNameProblem('fusion'), 'empty / long / built-in names are refused');
assert.throws(() => T.saveUserPreset('Default'));
assert.throws(() => T.renameUserPreset(f.id, 'mine'), /already exists/, 'a rename onto another preset is refused (case-insensitive)');
SettingsManager.set('LINE_STROKE', 2);
const again = T.saveUserPreset('MINE');
assert.strictEqual(again.id, p.id, 'saving under an existing name overwrites in place'); assert.strictEqual(again.name, 'Mine', 'and keeps the existing name');
assert.strictEqual(T.listUserPresets().length, 2); assert.strictEqual(T.listUserPresets()[0].settings.LINE_STROKE, 2);
T.renameUserPreset(p.id, 'Renamed'); assert.strictEqual(T.listUserPresets()[0].name, 'Renamed');
T.deleteUserPreset(f.id); assert.deepStrictEqual(T.listUserPresets().map((x) => x.name), ['Renamed']);
assert.throws(() => T.deleteUserPreset('default'), 'a built-in cannot be deleted');

// persistence: a fresh manager over the same localStorage sees it
const { pathToFileURL } = await import('node:url');
const url = pathToFileURL(new URL('../packages/core/settings-manager.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href + '?reload';
const fresh = (await import(url)).default;
assert.deepStrictEqual(T.listUserPresets(fresh).map((x) => x.name), ['Renamed']);

// validation: bad entries are dropped, each with a warning naming it; good ones stay; the shape is versioned
const good = T.listUserPresets()[0];
const bad = [
  { id: 'a', name: 'NoSettings' },
  { id: 'b', name: 'BadValue', settings: { ...good.settings, LINE_STROKE: 'thick' } },
  { id: 'c', name: 'MissingKey', settings: Object.fromEntries(Object.entries(good.settings).slice(1)) },
  { id: 'd', name: 'BadToken', settings: good.settings, tokens: { '--evil': 'red' } },
  { ...good, id: 'e', name: '' },
  { ...good }, // duplicate id of the good one
  null,
];
warnings.length = 0;
const kept = T.userPresetsOf({ v: 1, presets: [good, ...bad] });
assert.deepStrictEqual(kept.map((x) => x.name), ['Renamed']);
for (const n of ['NoSettings', 'BadValue', 'MissingKey', 'BadToken']) assert(warnings.some((w) => w.includes('"' + n + '"')), 'a warning names ' + n + ': ' + warnings.join(' | '));
assert.strictEqual(warnings.length, bad.length, 'one warning per dropped entry');
warnings.length = 0;
assert.deepStrictEqual(T.userPresetsOf({ v: 2, presets: [good] }), []); assert.strictEqual(warnings.length, 1, 'unknown version: loaded as none, with a warning');
assert.deepStrictEqual(T.userPresetsOf('junk'), []);
console.log('style-presets.test.js passed');
