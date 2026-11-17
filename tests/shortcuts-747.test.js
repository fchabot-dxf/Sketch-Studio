// tests/shortcuts-747.test.js: TASK 747, the user's own keyboard shortcuts (packages/ui/shortcuts.js), no browser.
//  1. the override layer: a changed key REPLACES the declared keys for matching, the per-app list and the hints / titles; SHORTCUTS stays the defaults;
//  2. the conflict rule (shortcutConflicts): same scope, 'app' with any scope, a tool scope shadowing the canvas letters, different apps, the retired
//     keys' exception, Shift is not an exception, and NO declared default is flagged;
//  3. Swap (the other takes the old key; none if there was none), unassign, reset one / all;
//  4. the refused browser keys (REFUSED_KEYS), the fixed rows, comboFromEvent, the capture switch, Delete keeps its document-tab exception;
//  5. storage: ONE setting holding only the changed ids, round-trip through localStorage + a reload, an unknown id ignored, a malformed value back to
//     the default without a throw and without any catch in shortcuts.js.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// a localStorage for the settings store (it reads it at import, as in the browser)
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { default: SettingsManager } = await import('#core/settings-manager.js');
const S = await import('#ui/shortcuts.js');
const {
  SHORTCUTS, shortcutById, defaultShortcut, matchesShortcut, matchShortcut, shortcutsForHost, shortcutHint, titleWithShortcut, shortcutConflicts,
  combosOverlap, scopesLiveTogether, refusedReason, REFUSED_KEYS, assignShortcut, swapShortcut, unassignShortcut, resetShortcut, resetAllShortcuts,
  isShortcutChanged, userKeysOf, isCombo, comboFromEvent, setShortcutCapture, onShortcutsChange, USER_KEYS_SETTING,
} = S;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ev = (key, mods = {}, extra = {}) => ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt, ...extra });
const k = (key, { mod = false, shift = false, alt = false } = {}) => ({ key, mod, shift, alt }); // a captured combo: every modifier stated
const stored = () => JSON.parse(store.get('sketch-studio-settings') || '{}')[USER_KEYS_SETTING];
const listKeys = (host, id) => shortcutsForHost(host).find((s) => s.id === id).keys;
const defaultKeys = (id) => defaultShortcut(id).keys;
let changes = 0; onShortcutsChange(() => { changes++; });

// ── 0. starts at the defaults ──
assert.deepStrictEqual(SettingsManager.get(USER_KEYS_SETTING), { v: 1, keys: {} }, 'the setting is declared: { v: 1, keys: {} }');
assert(SHORTCUTS.every((s) => shortcutById(s.id) === s && !isShortcutChanged(s.id)), 'no change: every shortcut is the declared one');

// ── 2. the conflict rule (pure: given the keys) ──
assert(scopesLiveTogether('canvas', 'canvas') && scopesLiveTogether('app', 'tool:line') && scopesLiveTogether('stage:toolpath', 'app'), 'live together');
assert(!scopesLiveTogether('canvas', 'tool:fillet') && !scopesLiveTogether('tool:line', 'tool:shape') && !scopesLiveTogether('canvas', 'stage:toolpath'), 'never together');
assert(combosOverlap({ key: 'l', mod: false, alt: false }, k('L', { shift: true })), 'Shift+L is the L letter (Shift free on it)');
assert(!combosOverlap({ key: 'b', mod: false, alt: false, shift: false }, k('b', { shift: true })), 'Shift+B is not the plain B (Bezier forbids Shift)');
assert(combosOverlap({ code: 'Space' }, k(' ')) && combosOverlap({ chars: '0123456789.' }, k('7')), 'Space by code = the space key; a chars set = each char');
assert.deepStrictEqual(shortcutConflicts('tool.line', k('r')), ['tool.rect'], 'same scope (canvas): R is Rectangle; Fillet\'s R (tool:fillet) shadows it by design, no conflict');
assert.deepStrictEqual(shortcutConflicts('tool.line', k('k')), ['sketch.construction'], "'app' meets 'canvas': K is Construction");
assert.deepStrictEqual(shortcutConflicts('fillet.radius', k('l')), [], 'a tool scope does not meet the canvas letters (Fillet radius on L: free)');
assert.deepStrictEqual(shortcutConflicts('fillet.radius', k('k')), ['sketch.construction'], "but it meets 'app'");
assert.deepStrictEqual(shortcutConflicts('edit.undo', k(' ')), ['view.panHold'], "Undo ('app', every app) on Space meets Pen Plotter's Hold to pan");
assert.deepStrictEqual(shortcutConflicts('sketch.group', k(' ')), [], 'Shaper\'s Group on Space: Hold to pan is Pen Plotter\'s only (different apps): no conflict');
assert.deepStrictEqual(shortcutConflicts('tool.line', k('g', { mod: true })), ['sketch.group'], 'Ctrl+G on Line meets Shaper\'s Group (Line is in Shaper too)');
assert.deepStrictEqual(shortcutConflicts('edit.undo', k('l', { shift: true })), ['tool.line'], 'Shift is no exception: Shift+L fires Line too');
assert.deepStrictEqual(shortcutConflicts('sketch.construction', k('s')), ['tool.select'], 'a bare S meets Select only (the retired Pen Plotter art keys are gone: TASK 748)');
assert.deepStrictEqual(shortcutConflicts('sketch.construction', k('s', { mod: true, shift: true })), [], 'Ctrl+Shift+S meets nothing: Save is Ctrl+S without Shift (no exception rule is needed any more)');
// TASK 748: each letter the retired Pen Plotter art keys held (V T S L R E P F X N), taken bare by an 'app' shortcut, meets only the canvas tool / constraint
// of that letter (and Fillet's R while Fillet draws); Swap is offered exactly where there is ONE changeable conflict
const LETTER_OWNER = { v: ['tool.pan'], t: ['tool.perpendicular'], s: ['tool.select'], l: ['tool.line'], r: ['tool.rect', 'fillet.radius'], e: ['tool.equal'],
  p: ['tool.polygon'], f: ['sketch.fix'], x: ['tool.coincident'], n: ['tool.fillet'] };
for (const id of ['sketch.construction', 'edit.undo', 'file.save', 'view.parameters']) for (const [ch, owners] of Object.entries(LETTER_OWNER)) {
  assert.deepStrictEqual(shortcutConflicts(id, k(ch)), owners, `${id} on a bare ${ch.toUpperCase()}: only ${owners.join(', ')}, no retired Pen Plotter key`);
}
assert.deepStrictEqual(assignShortcut('sketch.construction', k('l')), { conflicts: ['tool.line'], keys: [k('l')] }, 'a bare L on Construction: one conflict, Swap is offered');
assert.deepStrictEqual(assignShortcut('file.save', k('r')).conflicts, ['tool.rect', 'fillet.radius'], 'a bare R on Save: two conflicts (no Swap)');
assert(!SHORTCUTS.some((s) => s.id.startsWith('plotter.')), 'no Pen Plotter art-tool / finishPolyline shortcut is declared any more (TASK 748)');
assert.deepStrictEqual(shortcutConflicts('edit.undo', k('z', { mod: true, shift: true })), ['edit.redo'], 'Ctrl+Shift+Z is Redo\'s second key');
for (const s of SHORTCUTS) for (const c of s.keys) assert.deepStrictEqual(shortcutConflicts(s.id, c, defaultKeys), [], `a declared default is never a conflict: ${s.id} ${JSON.stringify(c)}`);

// ── 4. refused keys, fixed rows, the captured combo, the capture switch ──
const REFUSE = [k('w', { mod: true }), k('t', { mod: true, shift: true }), k('n', { mod: true }), k('n', { mod: true, shift: true }), k('Tab', { mod: true }),
  k('Tab', { mod: true, shift: true }), k('Tab'), k('F5'), k('r', { mod: true }), k('l', { mod: true }), k('f', { mod: true }), k('F11'), k('F12'),
  k('F4', { alt: true }), k('q', { mod: true }), k('i', { mod: true, shift: true }), k('1', { mod: true }), k('=', { mod: true })];
for (const c of REFUSE) assert(typeof refusedReason(c) === 'string', 'refused: ' + JSON.stringify(c));
assert.strictEqual(refusedReason(k('w', { mod: true })), 'closes the browser tab');
for (const c of [k('k'), k('d', { mod: true }), k('e', { mod: true }), k('F2'), k('l', { alt: true }), k('s', { mod: true }), k('c', { mod: true, shift: true })]) {
  assert.strictEqual(refusedReason(c), null, 'not refused: ' + JSON.stringify(c));
}
assert(REFUSED_KEYS.every((r) => isCombo(r.combo) && typeof r.reason === 'string' && r.reason), 'REFUSED_KEYS: a combo and a reason each');
for (const s of SHORTCUTS.filter((x) => !x.fixed)) for (const c of s.keys) if (c.mod !== undefined && c.alt !== undefined) {
  assert.strictEqual(refusedReason(c), null, `no default key the user could capture is refused: ${s.id}`);
}
const FIXED = SHORTCUTS.filter((s) => s.fixed).map((s) => s.id);
assert.deepStrictEqual(FIXED, ['edit.cancel', 'draw.typeValue', 'dim.typeValue', 'view.panHold'], 'the fixed rows (no retired Pen Plotter key among them: TASK 748)');
assert(SHORTCUTS.every((s) => (s.listed === false || s.keys.some((c) => c.chars !== undefined) ? !!s.fixed : true)), 'every unlisted and every chars shortcut is fixed');
for (const id of FIXED) assert.throws(() => assignShortcut(id, k('k')), /cannot be changed/, id + ' cannot be changed');
assert.throws(() => unassignShortcut('edit.cancel'), /cannot be changed/);
assert.deepStrictEqual(comboFromEvent(ev('Shift', { shift: true })), null, 'a bare modifier waits');
assert.deepStrictEqual(comboFromEvent(ev('Control', { ctrl: true })), null);
assert.deepStrictEqual(comboFromEvent(ev('Escape')), { cancel: true }, 'Esc cancels');
assert.deepStrictEqual(comboFromEvent(ev('K', { ctrl: true, shift: true })), k('k', { mod: true, shift: true }), 'Ctrl+Shift+K');
assert.deepStrictEqual(comboFromEvent(ev('k', { meta: true })), k('k', { mod: true }), 'Cmd = mod');
assert.deepStrictEqual(comboFromEvent(ev('F2')), k('F2'), 'a named key keeps its name');
setShortcutCapture(true);
assert(!matchesShortcut(ev('l'), 'tool.line') && !matchesShortcut(ev('z', { ctrl: true }), 'edit.undo'), 'while capturing, no shortcut matches');
setShortcutCapture(false);
assert(matchesShortcut(ev('l'), 'tool.line'), 'after it, they match again');

// ── 1 + 3. edits, through the ONE setting ──
const c0 = changes;
assert.deepStrictEqual(assignShortcut('tool.line', k('w', { mod: true })), { refused: 'closes the browser tab' }, 'a refused key changes nothing');
assert.strictEqual(changes, c0, 'and tells no one');
assert.deepStrictEqual(assignShortcut('tool.line', k('l')), { done: true }, 'L captured again: no conflict (the art L is Pen Plotter Toolpath\'s, never the canvas\')');
assert(isShortcutChanged('tool.line') && !matchesShortcut(ev('L', { shift: true }), 'tool.line'), 'but it is exactly L now (Shift released): a change, marked');
resetAllShortcuts();
assert.deepStrictEqual(assignShortcut('tool.line', k('k')), { conflicts: ['sketch.construction'], keys: [k('k')] }, 'Line on K: Construction has it');
assert(!isShortcutChanged('tool.line') && matchesShortcut(ev('l'), 'tool.line'), 'a conflict changes nothing');
swapShortcut('tool.line', [k('k')], 'sketch.construction');
assert(changes > c0, 'onShortcutsChange fired');
assert.deepStrictEqual(shortcutById('tool.line').keys, [k('k')], 'Line = K');
assert.deepStrictEqual(shortcutById('sketch.construction').keys, defaultKeys('tool.line'), 'Construction takes Line\'s old key (L)');
assert.strictEqual(matchShortcut(ev('k'), ['tool.line', 'sketch.construction']), 'tool.line', 'K = Line');
assert.strictEqual(matchShortcut(ev('l'), ['tool.line', 'sketch.construction']), 'sketch.construction', 'L = Construction');
assert(!matchesShortcut(ev('K', { shift: true }), 'tool.line'), 'the captured K is exactly K (Shift released)');
assert.deepStrictEqual(listKeys('shaper', 'tool.line'), [k('k')], 'the list shows K');
assert.strictEqual(shortcutHint('tool.line', { mac: false }), 'K'); assert.strictEqual(titleWithShortcut('Line', 'tool.line', { mac: false }), 'Line (K)', 'the tooltip says (K)');
assert.strictEqual(titleWithShortcut('Construction', 'sketch.construction', { mac: false }), 'Construction (L)');
assert.deepStrictEqual(defaultShortcut('tool.line').keys, [{ key: 'l', mod: false, alt: false }], 'SHORTCUTS keeps the default');
assert(isShortcutChanged('tool.line') && isShortcutChanged('sketch.construction') && !isShortcutChanged('tool.rect'));
assert.deepStrictEqual(Object.keys(stored().keys).sort(), ['sketch.construction', 'tool.line'], 'only the changed ids are stored');
assert.strictEqual(stored().v, 1);
// a swap with a shortcut that had no key leaves the other one with none
unassignShortcut('tool.rect');
assert.deepStrictEqual(shortcutById('tool.rect').keys, [], 'Rectangle: no key');
assert.strictEqual(shortcutHint('tool.rect'), '', 'no hint'); assert.strictEqual(titleWithShortcut('Rect', 'tool.rect'), 'Rect', 'the tooltip shows no key');
assert(!matchesShortcut(ev('r'), 'tool.rect'), 'R is nothing now');
assert.deepStrictEqual(shortcutConflicts('tool.line', k('r')), [], 'and R is free');
assert.deepStrictEqual(assignShortcut('tool.rect', k('c')), { conflicts: ['tool.circle'], keys: [k('c')] });
swapShortcut('tool.rect', [k('c')], 'tool.circle');
assert.deepStrictEqual(shortcutById('tool.circle').keys, [], 'Circle took Rectangle\'s "none"');
assert.throws(() => swapShortcut('tool.line', [k('s')], 'tool.rect'), /conflicts are/, 'Swap only with THE conflict');
assert.throws(() => swapShortcut('sketch.construction', [k('Escape')], 'edit.cancel'), /cannot be changed/, 'never with a fixed one');
assert.throws(() => swapShortcut('tool.line', [k('w', { mod: true })], 'tool.rect'), /refused/, 'never a refused key');
// reset one (a reset whose default another shortcut has taken since is a conflict, with the same Swap), Ctrl+letter on a tool, a captured default
assert.deepStrictEqual(resetShortcut('tool.circle'), { conflicts: ['tool.rect'], keys: defaultKeys('tool.circle') }, 'Circle\'s Reset: Rectangle has C now');
assert.deepStrictEqual(shortcutById('tool.circle').keys, [], 'a conflicting Reset changes nothing');
swapShortcut('tool.circle', defaultKeys('tool.circle'), 'tool.rect');
assert.deepStrictEqual(shortcutById('tool.circle').keys, defaultKeys('tool.circle'), 'Swap: Circle has its C back');
assert.deepStrictEqual(shortcutById('tool.rect').keys, [], '... and Rectangle took Circle\'s "none"');
assert(!('tool.circle' in stored().keys), 'a default is not stored');
assert.deepStrictEqual(resetShortcut('tool.rect'), { done: true }, 'Rectangle\'s Reset: R is free');
assert.deepStrictEqual(shortcutById('tool.rect').keys, defaultKeys('tool.rect'), 'reset one');
assert.deepStrictEqual(resetShortcut('tool.rect'), { same: true }, 'nothing to reset');
assert.deepStrictEqual(Object.keys(stored().keys).sort(), ['sketch.construction', 'tool.line'], 'only Line and Construction are still changed');
assert.deepStrictEqual(assignShortcut('tool.dimension', k('d', { mod: true })), { done: true }, 'Ctrl+D on Dimension: the user may (not refused, no conflict)');
assert(matchesShortcut(ev('d', { ctrl: true }), 'tool.dimension') && !matchesShortcut(ev('d'), 'tool.dimension'));
assert.deepStrictEqual(assignShortcut('tool.dimension', k('d', { mod: true })), { same: true }, 'the same key again: nothing to do');
assert.deepStrictEqual(assignShortcut('edit.undo', k('z', { mod: true })), { done: true }, 'Undo on exactly Ctrl+Z');
assert(isShortcutChanged('edit.undo') && matchesShortcut(ev('z', { ctrl: true }), 'edit.undo'), 'Ctrl+Z with Alt now released: a change from the default (Alt was free)');
// Delete keeps the focused-document-tab exception (TASK 727) when it is captured again
assert.deepStrictEqual(assignShortcut('edit.delete', k('Delete')), { done: true });
const tabTarget = { closest: (sel) => (sel === '.sk-doctab-main' ? {} : null) };
assert.deepStrictEqual(shortcutById('edit.delete').keys, [{ ...k('Delete'), notIn: '.sk-doctab-main' }], 'the captured Delete keeps notIn');
assert(!matchesShortcut(ev('Delete', {}, { target: tabTarget }), 'edit.delete') && !matchesShortcut(ev('Backspace'), 'edit.delete'), 'Delete only, not on a focused tab');

// ── 5. storage round-trip: a reload reads the same keys ──
const before = Object.fromEntries(SHORTCUTS.map((s) => [s.id, shortcutById(s.id).keys]));
const raw = store.get('sketch-studio-settings');
SettingsManager.load(); // as a page reload does
assert.deepStrictEqual(Object.fromEntries(SHORTCUTS.map((s) => [s.id, shortcutById(s.id).keys])), before, 'a reload reads the same keys back');
assert.strictEqual(store.get('sketch-studio-settings'), raw, 'and writes nothing');
// unknown / fixed / malformed entries
const warns = []; const warn0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));
const set = (v) => { store.set('sketch-studio-settings', JSON.stringify({ [USER_KEYS_SETTING]: v })); SettingsManager.load(); };
set({ v: 1, keys: { 'no.such': [k('k')], 'plotter.art.scale': [k('q')], 'plotter.finishPolyline': [k('q')], 'edit.cancel': [k('q')], 'tool.line': 'K', 'tool.rect': [{ key: 'q', mod: 'yes' }], 'tool.arc': [{ key: 'q', foo: 1 }], 'tool.circle': [k('q')] } });
assert.deepStrictEqual(shortcutById('tool.line').keys, defaultKeys('tool.line'), 'a value that is not a list: the default');
assert.deepStrictEqual(shortcutById('tool.rect').keys, defaultKeys('tool.rect'), 'a combo of the wrong shape: the default');
assert.deepStrictEqual(shortcutById('tool.arc').keys, defaultKeys('tool.arc'), 'a combo with an unknown field: the default');
assert.deepStrictEqual(shortcutById('edit.cancel').keys, defaultKeys('edit.cancel'), 'a fixed id: ignored');
assert(warns.some((w) => w.includes('plotter.art.scale')) && warns.some((w) => w.includes('plotter.finishPolyline')), 'a stored key for a removed TASK 748 id is an unknown id: ignored with a warning');
assert.deepStrictEqual(shortcutById('tool.circle').keys, [k('q')], 'the good entry next to them is kept');
assert.strictEqual(warns.length, 7, 'each bad entry is warned about (no silent drop): ' + JSON.stringify(warns));
for (const bad of ['garbage', 7, [], { v: 2, keys: {} }, { v: 1, keys: [] }, { v: 1 }]) {
  warns.length = 0;
  set(bad);
  assert(SHORTCUTS.every((s) => shortcutById(s.id) === s), 'a malformed setting: every default, no throw: ' + JSON.stringify(bad));
  assert.strictEqual(warns.length, 1, 'and one warning: ' + JSON.stringify(bad));
}
console.warn = warn0;
assert.deepStrictEqual(userKeysOf(null), {}, 'nothing stored = nothing changed');
const src = fs.readFileSync(path.join(ROOT, 'packages/ui/shortcuts.js'), 'utf8');
assert(!/\bcatch\b/.test(src), 'shortcuts.js validates the shape: no catch at all');
assert(!/localStorage/.test(src), 'shortcuts.js reads the setting through the settings store only');
// reset all: back to the defaults, the setting holds no id
set({ v: 1, keys: { 'tool.line': [k('k')] } });
resetAllShortcuts();
assert(SHORTCUTS.every((s) => shortcutById(s.id) === s), 'Reset all: every default');
assert.deepStrictEqual(stored(), { v: 1, keys: {} }, 'Reset all stores no id');

// ── no handler reads the setting: only shortcuts.js names it ──
const walk = (d, out = []) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, n.name); if (n.isDirectory()) { if (!['node_modules', 'vendor'].includes(n.name)) walk(p, out); } else if (/\.m?js$/.test(n.name)) out.push(p); } return out; };
const readers = [...walk(path.join(ROOT, 'packages')), ...walk(path.join(ROOT, 'apps'))].filter((p) => /SHORTCUT_KEYS|USER_KEYS_SETTING/.test(fs.readFileSync(p, 'utf8')))
  .map((p) => path.relative(ROOT, p).split(path.sep).join('/')).sort();
assert.deepStrictEqual(readers, ['packages/core/settings-manager.js', 'packages/ui/shortcuts.js', 'packages/ui/style-panel.js'],
  'the setting is named only by its declaration, shortcuts.js and the Settings Reset that keeps it');

console.log(`shortcuts-747: ok (${FIXED.length} fixed, ${REFUSED_KEYS.length} refused keys)`);
