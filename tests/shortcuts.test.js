// tests/shortcuts.test.js: TASK 727. THE keyboard-shortcut declaration (packages/ui/shortcuts.js) against the code that binds keys.
//  1. the table is well formed (unique ids, known hosts / groups / scopes, one key per combo);
//  2. every declared shortcut is wired: its id is a string literal in a source file that imports shortcuts.js;
//  3. every id a source file asks for is declared;
//  4. no handler compares keys on its own: outside shortcuts.js, a raw key comparison is allowed only in the EXEMPT files (widget-local
//     keys: Enter / Esc in a value box, menu and tab-list arrows, a focus trap, Esc closing a modal / popover / drawer), each with its
//     reason and its exact count, so a new one fails here until it is declared or exempted on purpose;
//  5. no two shortcuts of one app bind the same key in scopes that are live together (the 727 stop condition);
//  6. the matcher keeps today's modifier rules (the letters ignore Shift; TASK 740: they never fire with Ctrl / Cmd / Alt; Ctrl+S needs no Shift; ...);
//  7. the per-app lists (what Settings > Shortcuts shows) and the key caps;
//  8. every SIDEBAR_ICONS.<key> an app names exists, and the footer's gear is the drawer's gear artwork;
//  9. TASK 740: every ribbon button (tool, constraint, Lock, Combine) names a declared shortcut whose key opens that button's tool, a host's own
//     ribbon button is exempt only with its reason here, every button title reads the table, and the Parameters window has its key.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHORTCUTS, APP_HOSTS, matchesShortcut, matchShortcut, shortcutsForHost, comboCaps, comboMatches, shortcutById } from '#ui/shortcuts.js';
import { undoRedoKeyAction } from '#ui/history-control.js';
import { clipboardKeyAction } from '#ui/clipboard.js';
import { SIDEBAR_ICONS, GEAR_GLYPH } from '#ui/app-sidebar.js';
import { RIBBON_TOOLS } from '#ui/tool-ribbon.js';
import { TOOL_SHORTCUTS, TOOL_BEGIN } from '#ui/input-manager.js';
import { titleWithShortcut, shortcutHint } from '#ui/shortcuts.js';
import { TOOL_MODES, CONSTRAINT_TOOLS } from '#core/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
function sources() {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) { if (!['node_modules', 'vendor', 'tests', 'dist'].includes(n.name)) walk(p); }
      else if (/\.m?js$/.test(n.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'packages')); walk(path.join(ROOT, 'apps'));
  return out.map((p) => ({ file: rel(p), text: fs.readFileSync(p, 'utf8') }));
}
const SRC = sources();
const DECL = 'packages/ui/shortcuts.js', LIST = 'packages/ui/shortcuts-list.js';

// ── 1. well formed ──
const GROUPS = ['Tools', 'Constrain', 'Edit', 'Sketch', 'Drawing', 'View'];
const ids = SHORTCUTS.map((s) => s.id);
assert.strictEqual(new Set(ids).size, ids.length, 'unique ids');
for (const s of SHORTCUTS) {
  assert(/^[a-z]+(\.[a-zA-Z]+)+$/.test(s.id), 'id form: ' + s.id);
  assert(typeof s.label === 'string' && s.label, 'label: ' + s.id);
  assert(GROUPS.includes(s.group), 'group: ' + s.id + ' ' + s.group);
  assert(s.hosts.length && s.hosts.every((h) => APP_HOSTS.includes(h)), 'hosts: ' + s.id);
  assert(/^(app|canvas|tool:[a-z]+|stage:[a-z]+)$/.test(s.scope), 'scope: ' + s.id + ' ' + s.scope);
  assert(s.keys.length, 'keys: ' + s.id);
  for (const c of s.keys) {
    assert.strictEqual(['key', 'code', 'chars'].filter((k) => c[k] !== undefined).length, 1, 'one of key / code / chars: ' + s.id);
    for (const m of ['mod', 'shift', 'alt']) assert([undefined, true, false].includes(c[m]), m + ': ' + s.id);
  }
}
assert.throws(() => shortcutById('no.such'), /no shortcut "no.such"/, 'an undeclared id throws');

// ── 2. every declared shortcut is wired, 3. every asked id is declared ──
const ID_LITERAL = /['"]([a-z]+(?:\.[a-zA-Z]+)+)['"]/g;
const users = SRC.filter((f) => f.file !== DECL && f.file !== LIST && /from ['"]#ui\/shortcuts\.js['"]/.test(f.text));
const PREFIXES = new Set(ids.map((id) => id.split('.')[0]));
const asked = new Map(); // id -> [files]
for (const f of users) {
  for (const m of f.text.matchAll(ID_LITERAL)) {
    if (!PREFIXES.has(m[1].split('.')[0]) || /\.js$/.test(m[1])) continue;
    if (!asked.has(m[1])) asked.set(m[1], []);
    asked.get(m[1]).push(f.file);
  }
}
const unwired = ids.filter((id) => !asked.has(id));
assert.deepStrictEqual(unwired, [], 'declared shortcuts no handler asks for: ' + unwired.join(', '));
const undeclared = [...asked.keys()].filter((id) => !ids.includes(id) && /^(tool|edit|file|sketch|draw|dim|line|bezier|mirror|pattern|fillet|view|plotter)\./.test(id));
assert.deepStrictEqual(undeclared, [], 'ids asked for but not declared: ' + undeclared.join(', '));

// ── 4. no undeclared key handler ──
const EV = '\\b(?:e|ev|evt|event)';
const RAW = [
  new RegExp(EV + '\\.(?:key|code)\\b\\s*(?:===|!==|==|!=)', 'g'),
  new RegExp('(?:===|!==)\\s*' + EV + '\\.(?:key|code)\\b', 'g'),
  new RegExp(EV + '\\.(?:key|code)\\.to(?:Lower|Upper)Case\\(', 'g'),
  /\.test\(\s*(?:\w+\.)?key\s*\)/g,
  new RegExp('\\[\\s*' + EV + '\\.(?:key|code)\\b', 'g'),
  new RegExp('switch\\s*\\(\\s*' + EV + '\\.(?:key|code)', 'g'),
  /(?<![.\w])key\s*===\s*['"]/g, // a bare `key` alias (const key = e.key...)
];
const rawCount = (text) => RAW.reduce((n, re) => n + (text.match(re) || []).length, 0);
// widget-local keys, out of the declaration by agreement (TASK 727 ruling 5): file -> [count, reason]
const EXEMPT = {
  'packages/ui/account-avatar.js': [2, 'the account menu popover: Esc closes it, Tab stays inside it (a widget-local key, like the footer confirm)'],
  'packages/ui/app-footer.js': [3, 'the Clear-sketch confirm modal: Esc = its Cancel, Tab focus trap; TASK 880: Esc closes the folded stage controls card'],
  'packages/ui/app-sidebar.js': [9, 'the drawer: inline rename / ask inputs (Enter / Esc), Enter on the name, Esc closes it, Tab focus trap'],
  'packages/ui/context-menu.js': [13, 'the open context menu: arrows / Enter / Esc / submenu navigation'],
  'packages/ui/design-info-panel.js': [2, 'the inline rename input: Enter / Esc'],
  'packages/ui/diagnostic-log.js': [1, 'the Log panel: Esc closes it'],
  'packages/ui/document-tabs.js': [5, 'the document tab list: arrows / Home / End move, Delete closes the focused tab'],
  'packages/ui/file-dialog.js': [7, 'TASK 759 / Drive browser: the Save as / Open dialog tabs (arrows / Home / End), Enter in name field, Enter / Esc in New-folder input'],
  'packages/ui/hint.js': [1, 'TASK 772: open info hint: Esc dismisses it'],
  'packages/ui/cursor-tooltip.js': [1, 'TASK 805: the cursor tooltip: Esc dismisses it (widget-local, like the info hint above)'],
  'packages/ui/input-handlers/fillet-tool.js': [2, 'the fillet radius box: Enter / Esc'],
  'packages/ui/input-handlers/live-dimension-input.js': [5, 'the on-canvas value boxes: Tab / Enter / Esc / Delete (and the legacy box Enter)'],
  'packages/ui/input-handlers/offset-tool.js': [2, 'the offset distance box: Enter / Esc'],
  'packages/ui/input-handlers/pattern-tool.js': [8, 'the Pattern window and its value boxes: Enter / Esc / arrow steps'],
  'packages/ui/input-handlers/text-tool.js': [3, 'TASK 845: the text editor box: Esc = Cancel, Ctrl / Cmd + Enter (Enter in a one-line field) = OK; the textarea keeps Enter for a new line'],
  'packages/ui/mobile-drawer.js': [1, 'the mobile drawer: Esc closes it'],
  'packages/ui/numeric-input-manager.js': [5, 'the numeric value boxes: Enter / Esc / Tab'],
  'packages/ui/parameter-table.js': [2, 'the parameter table cells: Enter / Esc'],
  'packages/ui/parameters-window.js': [1, 'the Parameters window: typing there is not a tool key (Esc is the window\'s)'],
  'packages/ui/project-manager.js': [7, 'the Projects modal: Enter / arrows / context-menu key in the grid, Esc closes, Tab focus trap'],
  'packages/ui/shortcuts-list.js': [1, 'TASK 747: Settings > Shortcuts capturing a new key swallows the release of the key it captured (its code)'],
  'packages/ui/style-panel.js': [7, 'the Settings panel: inline preset question (Enter / Esc), tab-list arrows, Esc closes it'],
  'packages/ui/tabbed-dock-panel.js': [1, 'a dock window: Esc closes it'],
  'packages/ui/template-picker.js': [4, 'the template picker modal: Esc closes, Enter in its fields'],
  'packages/ui/tool-ribbon.js': [1, 'an open ribbon dropdown: Esc closes it'],
  'packages/ui/transform-box.js': [2, 'the transform box typed angle / scale: Enter / Esc'], // TASK 753
  'apps/penplotter/src/settings.js': [1, 'the plotter settings modal: Esc = Cancel'],
  'apps/penplotter/src/toolpath-layers-panel.js': [2, 'the toolpath rename input: Enter / Esc'],
  'apps/penplotter/src/ui-dialog.js': [4, 'the plotter dialogs: Enter / Esc'],
  'apps/shaper/src/main.js': [3, 'TASK 772: Sync New-folder input: Enter / Esc (+ SettingsManager key === \'DOC_UNIT\')'],
  'apps/shaper/src/cut-panel.js': [4, "TASK 810: the Roughing / Contour card's tab bar: Arrow Left / Right move along its tabs (the tablist pattern) (+ SettingsManager key === 'DOC_UNIT')"],
  'apps/shaper/src/prepare-view.js': [3, "TASK 810: a Roughing boundary Pick: Esc cancels it (widget-local, while picking); TASK S2: Esc ends Add shapes mode (= Done; widget-local, listened to only while the mode is on) (+ SettingsManager key === 'DOC_UNIT')"],
  'apps/shaper/src/op-list.js': [2, 'TASK 745: the operations list: Arrow Up / Down on a focused drag grip move its row (no arrow buttons)'],
  'apps/shaper/src/hint.js': [1, 'TASK S2: an Esc that hides the showing hint tooltip does only that (widget-local: it is marked handled, so an open operation is not cancelled by it)'],
  'apps/shaper/src/orient-view.js': [1, 'TASK 808: the Orient view is a modal dialog: Escape cancels it (the card button Cancel), whatever the canvas shortcut table says'],
};
const found = {};
for (const f of SRC) {
  if (f.file === DECL || !/keydown|keyup|keypress|KeyDown/.test(f.text)) continue;
  const n = rawCount(f.text);
  if (n) found[f.file] = n;
}
const wantCounts = Object.fromEntries(Object.entries(EXEMPT).map(([k, v]) => [k, v[0]]));
assert.deepStrictEqual(found, wantCounts, 'raw key comparisons outside shortcuts.js (declare the shortcut, or exempt a widget-local key here with its reason)');

// ── 5. no two shortcuts of one app on the same key in scopes live together ──
// 'app' and 'canvas' are live together; a tool / stage scope is live alone with 'app' (a tool's handler runs first and shadows the
// canvas letters). Between two combos, a combo that REQUIRES a modifier the other ignores is handled first (Ctrl+S, Ctrl+C, Ctrl+Z,
// Ctrl+Shift+C all run before the letters), so only combos of equal specificity can collide.
const live = (a, b) => a === b || a === 'app' || b === 'app';
const keyOverlap = (a, b) => {
  const set = (c) => (c.chars !== undefined ? [...c.chars] : c.key !== undefined ? [c.key.toLowerCase()] : ['code:' + c.code]);
  return set(a).some((k) => set(b).includes(k));
};
const sameSpecificity = (a, b) => ['mod', 'shift', 'alt'].every((m) => (a[m] === true) === (b[m] === true));
const modsCompatible = (a, b) => ['mod', 'shift', 'alt'].every((m) => a[m] === undefined || b[m] === undefined || a[m] === b[m]);
function clashesOf(table) {
  const out = [];
  for (const host of APP_HOSTS) {
    const list = table.filter((s) => s.hosts.includes(host));
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      if (!live(A.scope, B.scope)) continue;
      for (const a of A.keys) for (const b of B.keys) {
        if (keyOverlap(a, b) && modsCompatible(a, b) && sameSpecificity(a, b)) out.push(`${host}: ${A.id} / ${B.id}`);
      }
    }
  }
  return out;
}
// the checker itself: the T conflict 727 found (the tuning panel's T beside Perpendicular) is caught; Fillet's R beside Rectangle is not one
assert.deepStrictEqual(clashesOf([shortcutById('tool.perpendicular'), { id: 'dev.tuning', hosts: ['sketchstudio'], scope: 'app', keys: [{ key: 't' }] }]), ['sketchstudio: tool.perpendicular / dev.tuning']);
assert.deepStrictEqual(clashesOf([shortcutById('tool.rect'), shortcutById('fillet.radius'), shortcutById('file.save'), shortcutById('tool.select')]), []);
const clashes = clashesOf(SHORTCUTS);
assert.deepStrictEqual(clashes, [], 'one key, two meanings in one context');

// ── 6. the matcher keeps today's modifier rules ──
const ev = (key, mods = {}, extra = {}) => ({ key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt, ...extra });
assert(matchesShortcut(ev('l'), 'tool.line') && matchesShortcut(ev('L', { shift: true }), 'tool.line'), 'L / Shift+L = Line');
// TASK 740 (owner turn 2103): the tool and constraint letters never fire with Ctrl / Cmd / Alt held: Ctrl+D (bookmark), Ctrl+R (reload), Ctrl+L,
// Ctrl+A, Ctrl+E ... are the browser's again. Shift is ignored as before, except where Shift+letter is its own shortcut.
assert(!matchesShortcut(ev('d', { ctrl: true }), 'tool.dimension') && matchesShortcut(ev('d'), 'tool.dimension'), 'Ctrl+D is NOT Dimension; D is');
const LETTER_IDS = SHORTCUTS.filter((s) => s.scope === 'canvas' && (s.group === 'Tools' || s.group === 'Constrain')).map((s) => s.id); // the Design canvas letters (not Pen Plotter's retired, unlisted art-tool letters: unchanged)
for (const k of 'abcdefghijklmnopqrstuvwxyz') {
  for (const mods of [{ ctrl: true }, { meta: true }, { alt: true }, { ctrl: true, shift: true }]) {
    assert.strictEqual(matchShortcut(ev(k, mods), LETTER_IDS), null, `${JSON.stringify(mods)}+${k} is no tool / constraint key`);
  }
}
assert(matchesShortcut(ev('T', { shift: true }), 'tool.perpendicular') && matchesShortcut(ev('F', { shift: true }), 'sketch.fix'), 'Shift still ignored on the older letters');
// the Shift+letter pairs (TASK 740; TASK 760: C / Shift+C): the plain letter is one shortcut, Shift+letter the other
assert.strictEqual(matchShortcut(ev('c'), LETTER_IDS), 'tool.circle'); assert.strictEqual(matchShortcut(ev('C', { shift: true }), LETTER_IDS), 'tool.closePath');
assert.strictEqual(matchShortcut(ev('b'), LETTER_IDS), 'tool.bezier'); assert.strictEqual(matchShortcut(ev('B', { shift: true }), LETTER_IDS), 'tool.break');
assert.strictEqual(matchShortcut(ev('m'), LETTER_IDS), 'tool.mirror'); assert.strictEqual(matchShortcut(ev('M', { shift: true }), LETTER_IDS), 'tool.midpoint');
assert.strictEqual(matchShortcut(ev('p'), [...LETTER_IDS, 'view.parameters']), 'tool.polygon');
assert.strictEqual(matchShortcut(ev('P', { shift: true }), [...LETTER_IDS, 'view.parameters']), 'view.parameters');
assert(!matchesShortcut(ev('p', { ctrl: true, shift: true }), 'view.parameters') && !matchesShortcut(ev('p'), 'view.parameters'), 'Ctrl+Shift+P / P are not Parameters');
assert(matchesShortcut(ev('k'), 'sketch.construction') && matchesShortcut(ev('K', { shift: true }), 'sketch.construction'), 'K / Shift+K');
assert(!matchesShortcut(ev('k', { ctrl: true }), 'sketch.construction') && !matchesShortcut(ev('k', { alt: true }), 'sketch.construction'), 'Ctrl+K / Alt+K are not Construction');
assert(matchesShortcut(ev('s', { ctrl: true }), 'file.save') && matchesShortcut(ev('S', { meta: true }), 'file.save'), 'Ctrl+S / Cmd+S');
assert(!matchesShortcut(ev('s', { ctrl: true, shift: true }), 'file.save') && !matchesShortcut(ev('s'), 'file.save'), 'Ctrl+Shift+S / S are not Save');
assert.deepStrictEqual(['z', 'Z', 'y', 'Y'].map((k) => undoRedoKeyAction(ev(k, { ctrl: true }))), ['undo', 'undo', 'redo', 'redo']);
assert.strictEqual(undoRedoKeyAction(ev('Z', { ctrl: true, shift: true })), 'redo', 'Ctrl+Shift+Z = Redo');
assert.strictEqual(undoRedoKeyAction(ev('Y', { meta: true, shift: true })), 'redo', 'Cmd+Shift+Y = Redo (Shift ignored on Y, as before)');
assert.strictEqual(undoRedoKeyAction(ev('z', { ctrl: true, alt: true })), 'undo', 'Alt ignored on Undo, as before');
assert.strictEqual(undoRedoKeyAction(ev('z')), null, 'a bare Z is nothing');
assert.deepStrictEqual(['c', 'x', 'v'].map((k) => clipboardKeyAction(ev(k, { ctrl: true }))), ['copy', 'cut', 'paste']);
assert.strictEqual(clipboardKeyAction(ev('c', { ctrl: true, alt: true })), null, 'Ctrl+Alt+C is not Copy');
assert.strictEqual(matchShortcut(ev('g', { ctrl: true }), ['sketch.group', 'sketch.ungroup']), 'sketch.group');
assert.strictEqual(matchShortcut(ev('G', { ctrl: true, shift: true }), ['sketch.group', 'sketch.ungroup']), 'sketch.ungroup');
assert(matchesShortcut(ev('C', { ctrl: true, shift: true }), 'sketch.combine') && matchesShortcut(ev('u', { meta: true, shift: true }), 'sketch.uncombine'));
assert(['0', '7', '.'].every((k) => matchesShortcut(ev(k), 'draw.typeValue')) && !matchesShortcut(ev('-'), 'draw.typeValue'), 'digits and the point type a size');
assert(matchesShortcut(ev('-'), 'dim.typeValue'), 'a dimension also takes a minus');
assert(!matchesShortcut(ev(undefined), 'draw.typeValue') && !matchesShortcut(ev('Enter'), 'draw.typeValue'), 'no key / a named key types nothing');
assert(matchesShortcut({ key: ' ', code: 'Space' }, 'view.panHold'), 'Space (by code) = hold to pan');
assert(matchesShortcut(ev('Escape', { shift: true }), 'edit.cancel'), 'Esc ignores modifiers');
// TASK 727 ruling 3: a Delete aimed at a focused document tab is the tab's, not the canvas Delete; Backspace and other targets unchanged
const tabTarget = { closest: (sel) => (sel === '.sk-doctab-main' ? {} : null) };
const canvasTarget = { closest: () => null };
assert(!matchesShortcut(ev('Delete', {}, { target: tabTarget }), 'edit.delete'), 'Delete on a focused document tab is not the canvas Delete');
assert(matchesShortcut(ev('Delete', {}, { target: canvasTarget }), 'edit.delete'), 'Delete elsewhere is');
assert(matchesShortcut(ev('Backspace', {}, { target: tabTarget }), 'edit.delete'), 'Backspace keeps its behaviour (only Delete is the tab\'s)');
assert(comboMatches({ key: 'a' }, ev('A')) && !comboMatches({ key: 'a', mod: false }, ev('a', { meta: true })), 'comboMatches');

// ── 7. per-app lists + key caps ──
const listIds = (h) => shortcutsForHost(h).map((s) => s.id);
for (const h of APP_HOSTS) {
  const l = listIds(h);
  for (const id of ['tool.line', 'tool.rect', 'tool.circle', 'tool.dimension', 'edit.undo', 'edit.redo', 'edit.delete', 'edit.cancel', 'file.save', 'sketch.construction']) assert(l.includes(id), h + ' lists ' + id);
  assert(!SHORTCUTS.some((s) => s.id.startsWith('plotter.art.') || s.id === 'plotter.finishPolyline'), h + ': the retired art-tool keys are not declared (TASK 748)');
}
assert(listIds('shaper').includes('sketch.group') && listIds('shaper').includes('sketch.combine'), 'Shaper lists Group and Combine');
for (const h of APP_HOSTS) assert(listIds(h).includes('sketch.group') && listIds(h).includes('sketch.ungroup'), h + ' lists Group / Ungroup (TASK 756: user groups in every app)');
for (const h of ['sketchstudio', 'penplotter', 'trace']) assert(!listIds(h).includes('sketch.combine'), h + ' does not list the Shaper Combine');
assert(listIds('penplotter').includes('view.panHold') && !listIds('sketchstudio').includes('view.panHold'), 'Hold Space to pan: Pen Plotter only');
assert(!SHORTCUTS.some((s) => s.hosts.includes('sketchstudio') && s.keys.some((c) => c.key === 't') && s.id !== 'tool.perpendicular'), 'SketchStudio: T is only Perpendicular (ruling 1)');
assert.deepStrictEqual(comboCaps(shortcutById('edit.undo').keys[0]), ['Ctrl', 'Z']);
assert.deepStrictEqual(comboCaps(shortcutById('edit.undo').keys[0], { mac: true }), ['Cmd', 'Z']);
assert.deepStrictEqual(comboCaps(shortcutById('sketch.ungroup').keys[0]), ['Ctrl', 'Shift', 'G']);
assert.deepStrictEqual(comboCaps(shortcutById('tool.line').keys[0]), ['L']);
assert.deepStrictEqual(comboCaps(shortcutById('edit.cancel').keys[0]), ['Esc']);
assert.deepStrictEqual(comboCaps(shortcutById('draw.typeValue').keys[0]), ['0-9', '.']);
assert.deepStrictEqual(comboCaps(shortcutById('view.panHold').keys[0]), ['Space']);

// ── 8. SIDEBAR_ICONS keys the apps name exist; one gear drawing ──
const named = new Set();
for (const f of SRC.filter((x) => x.file.startsWith('apps/'))) for (const m of f.text.matchAll(/SIDEBAR_ICONS\.([A-Za-z_$][\w$]*)/g)) named.add(m[1]);
assert(named.has('gear'), 'the apps name SIDEBAR_ICONS.gear (Shaper Settings, SketchStudio Tune solver)');
const missing = [...named].filter((k) => typeof SIDEBAR_ICONS[k] !== 'string' || !SIDEBAR_ICONS[k].includes('<svg'));
assert.deepStrictEqual(missing, [], 'SIDEBAR_ICONS keys the apps use but the table lacks');
assert(SIDEBAR_ICONS.gear.includes(GEAR_GLYPH) && SIDEBAR_ICONS.style.includes(GEAR_GLYPH), 'gear / style draw the one gear glyph');
const footer = fs.readFileSync(path.join(ROOT, 'packages/ui/app-footer.js'), 'utf8');
assert(/import \{ GEAR_GLYPH \} from '#ui\/app-sidebar\.js'/.test(footer) && !footer.includes('<circle cx="9" cy="9" r="2.5"/>'), 'the footer gear wraps GEAR_GLYPH, no second copy of the drawing');

// ── 9. TASK 740: every ribbon button has its key ──
const asButton = (t) => t.tool || t.action;
for (const t of RIBBON_TOOLS) {
  assert(typeof t.shortcut === 'string', 'ribbon button without a shortcut: ' + asButton(t));
  const s = shortcutById(t.shortcut);
  assert(s.hosts.length === APP_HOSTS.length || t.action === 'combine' || t.action === 'uncombine', t.shortcut + ': every app has the shared ribbon button');
}
// a tool button's key opens THAT tool: through TOOL_SHORTCUTS (switchToTool), or H / E's own branch (it applies to a preselection first, then
// switches to the same tool); Lock = sketch.fix (toggleFixedSelection), Combine / Uncombine = their own Ctrl+Shift keys
const OWN_BRANCH = { 'tool.horizontalVertical': TOOL_MODES.HORIZONTAL_VERTICAL, 'tool.equal': TOOL_MODES.EQUAL };
for (const t of RIBBON_TOOLS.filter((x) => x.tool)) {
  assert.strictEqual(TOOL_SHORTCUTS[t.shortcut] || OWN_BRANCH[t.shortcut], t.tool, `${t.shortcut} opens ${t.tool}`);
}
assert.deepStrictEqual(RIBBON_TOOLS.filter((x) => x.action).map((x) => [x.action, x.shortcut]), [['combine', 'sketch.combine'], ['uncombine', 'sketch.uncombine'], ['lock', 'sketch.fix']]);
const ribbonTools = new Set(RIBBON_TOOLS.map((t) => t.tool).filter(Boolean));
assert(CONSTRAINT_TOOLS.every((c) => ribbonTools.has(c)), 'every constraint tool has a ribbon button (so a key)');
const toolKeyIds = Object.keys(TOOL_SHORTCUTS);
assert.strictEqual(new Set(toolKeyIds.map((id) => TOOL_SHORTCUTS[id])).size, toolKeyIds.length, 'one key per tool');
assert(toolKeyIds.every((id) => ids.includes(id)), 'every TOOL_SHORTCUTS id is declared');
assert.deepStrictEqual(Object.keys(TOOL_BEGIN).sort(), [TOOL_MODES.CIRCULAR_PATTERN, TOOL_MODES.MIRROR, TOOL_MODES.RECTANGULAR_PATTERN, TOOL_MODES.CLOSE_PATH].sort(), 'the tools that start a pick when switched to (TASK 760: Close path closes the selection chains)');
const ribbonSrc = fs.readFileSync(path.join(ROOT, 'packages/ui/tool-ribbon.js'), 'utf8');
assert(!/\bbegin:/.test(ribbonSrc), 'no ribbon button carries its own begin (one TOOL_BEGIN, so the key and the button start the same pick)');
// a host's own ribbon button (extraGroups) is exempt only here, with its reason
const BUTTON_EXEMPT = {
  'freehand-btn': 'Pen Plotter\'s own Draw > Freehand button (extraGroups): it sets the plotter-side capture tool in sketch-stage.js, not a shared tool; a key would need Pen Plotter key code (asked in the TASK 740 report)',
};
const hostButtons = [];
for (const f of SRC.filter((x) => x.file.startsWith('apps/'))) {
  for (const m of f.text.matchAll(/extraGroups:\s*\[([\s\S]*?)\]\s*\}\s*\]/g)) for (const b of m[1].matchAll(/\bid:\s*'([\w-]+)'/g)) hostButtons.push(b[1]);
}
assert.deepStrictEqual(hostButtons.sort(), Object.keys(BUTTON_EXEMPT).sort(), 'a host ribbon button needs a key, or an exemption with its reason here');
// every button title reads the table (no key written by hand into a title)
assert.strictEqual((ribbonSrc.match(/\btitleWithShortcut\(/g) || []).length, 2, 'the tool button and the variant button titles read the table');
assert(!/\((?:Ctrl\+|Shift\+|[A-Z])\)/.test(ribbonSrc.replace(/\/\/.*$/gm, '')), 'no key written by hand into a ribbon title');
assert.strictEqual(titleWithShortcut('Line', 'tool.line'), 'Line (L)');
assert.strictEqual(titleWithShortcut('Break', 'tool.break', { mac: false }), 'Break (Shift+B)');
assert.strictEqual(titleWithShortcut('Combine Shapes', 'sketch.combine', { mac: false }), 'Combine Shapes (Ctrl+Shift+C)');
assert.strictEqual(titleWithShortcut('Combine Shapes', 'sketch.combine', { mac: true }), 'Combine Shapes (Cmd+Shift+C)');
assert.strictEqual(shortcutHint('sketch.fix'), 'F');
// the Parameters window: Shift+P in the three apps that have it (Trace has none, O14), bound by the footer to its own button
assert.deepStrictEqual(shortcutById('view.parameters').hosts, ['sketchstudio', 'shaper', 'penplotter']);
assert.strictEqual(shortcutHint('view.parameters'), 'Shift+P');
assert(!listIds('trace').includes('view.parameters') && listIds('shaper').includes('view.parameters'), 'Trace lists no Parameters key');
const footerSrc = fs.readFileSync(path.join(ROOT, 'packages/ui/app-footer.js'), 'utf8');
assert(/matchesShortcut\(e, 'view\.parameters'\)[\s\S]{0,120}paramsBtn\.click\(\)/.test(footerSrc), 'the key clicks the Parameters button (the same toggle)');
for (const h of APP_HOSTS) for (const t of RIBBON_TOOLS) if (shortcutById(t.shortcut).hosts.includes(h)) assert(listIds(h).includes(t.shortcut), `${h} lists ${t.shortcut}`);

console.log(`shortcuts: ok (${SHORTCUTS.length} declared, ${asked.size} ids asked for in ${users.length} files, ${Object.keys(EXEMPT).length} widget-local files exempt)`);
