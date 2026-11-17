// packages/ui/shortcuts.js: THE declaration of every keyboard shortcut (TASK 727), shared by the four apps.
// Every keyboard handler asks this table whether a key is one of ITS shortcuts (matchesShortcut / matchShortcut, by id); no handler
// compares e.key itself. Settings > Shortcuts lists the table for the showing app (shortcuts-list.js). tests/shortcuts.test.js checks
// that every declared id is wired somewhere and that no shortcut handler compares keys on its own.
//
// A shortcut: { id, label, group, hosts, scope, keys, note?, listed? }
//   id     'area.name', referenced by its handler as a string literal.
//   label  the action name the list shows ("Line", "Undo").
//   group  the list heading: Tools, Constrain, Edit, Sketch, Drawing, View.
//   hosts  the apps whose handlers bind it (APP_IDS of app-registry.js).
//   scope  when it applies: 'app' (anywhere in the app), 'canvas' (the Design canvas has the keys), 'tool:<mode>' (only while that tool
//          is drawing: its handler runs before the canvas letters and shadows them), 'stage:toolpath' (Pen Plotter's Toolpath / Export).
//   keys   the combos (any one matches). A combo names ONE of: key (KeyboardEvent.key, any case), code (KeyboardEvent.code), chars
//          (any one of these typed characters). Per modifier, mod (Ctrl, or Cmd on a Mac) / shift / alt: true = must be held,
//          false = must not be held, absent = ignored. The tool and constraint letters FORBID Ctrl / Cmd and Alt (TASK 740, owner turn 2103:
//          Ctrl+D, Ctrl+R, Ctrl+L ... are the browser's) and ignore Shift, except where a Shift+letter is its own shortcut (then the plain
//          letter forbids Shift too). notIn: a CSS selector; a key aimed at an element inside it is not this shortcut (it belongs to that element).
//   note   a few grey words, only where the row would otherwise mislead.
//   listed false = bound but not shown in the list (with the reason beside it).
//   fixed  TASK 747: why the user cannot change this one's key (Settings > Shortcuts shows it); absent = the user can.
//
// TASK 747, the user's own keys: ONE setting (SHORTCUT_KEYS of #core/settings-manager.js, { v: 1, keys: { id: [combo...] } }, only the ids the
// user changed, [] = no key) REPLACES `keys` per id here, before matching (matchesShortcut / matchShortcut), listing (shortcutsForHost) and hints
// (shortcutHint / titleWithShortcut). SHORTCUTS stays the frozen DEFAULTS; shortcutById returns the shortcut as it is now. No handler reads the
// setting: they ask by id, as before. The conflict rule (shortcutConflicts), the refused keys (REFUSED_KEYS) and the edits (assignShortcut,
// swapShortcut, unassignShortcut, resetShortcut, resetAllShortcuts) live here too; shortcuts-list.js is their only UI.

import SettingsManager from '#core/settings-manager.js';

export const APP_HOSTS = Object.freeze(['sketchstudio', 'shaper', 'penplotter', 'trace']);
const ALL = APP_HOSTS;

const DOC_TAB = '.sk-doctab-main'; // document-tabs.js: a focused document tab owns Delete (it closes that tab)
const letter = (ch) => ({ key: ch });
const plain = (k) => ({ key: k });

// TASK 740: a tool / constraint key: the letter with no Ctrl / Cmd / Alt; `shift` true = Shift+letter, false = only without Shift (the letter's
// Shift+ form is another shortcut), absent = Shift ignored (as the letters always have).
const toolKey = (ch, shift) => ({ key: ch, mod: false, alt: false, ...(shift === undefined ? {} : { shift }) });
const tool = (id, ch, label, group = 'Tools', shift) => ({ id, label, group, hosts: ALL, scope: 'canvas', keys: [toolKey(ch, shift)] });

export const SHORTCUTS = Object.freeze([
  // ── Tools (input-manager.js, the Design canvas of every app) ──
  // Every ribbon tool and constraint has one (tool-ribbon.js RIBBON_TOOLS names each button's id; the button's title shows the key). TASK 740 kept
  // every older letter; the new ones are Fusion 360's where it has one and it is free, else a free letter of the name, else Shift + that letter.
  tool('tool.select', 's', 'Select'),
  tool('tool.pan', 'v', 'Pan'),
  tool('tool.line', 'l', 'Line'),
  tool('tool.rect', 'r', 'Rectangle'),
  tool('tool.slot', 'j', 'Slot'),            // TASK 740: no free letter in the name (S Select, L Line, O Tangent, T Perpendicular)
  tool('tool.circle', 'c', 'Circle', 'Tools', false), // Shift+C = Close path (TASK 760)
  tool('tool.polygon', 'p', 'Polygon', 'Tools', false), // Shift+P = Parameters
  tool('tool.arc', 'a', 'Arc'),
  tool('tool.bezier', 'b', 'Bezier', 'Tools', false),   // Shift+B = Break
  tool('tool.trim', 'w', 'Trim'),            // Fusion's T is our Perpendicular; no free letter in the name
  tool('tool.break', 'b', 'Break', 'Tools', true),      // B is Bezier
  tool('tool.closePath', 'c', 'Close path', 'Tools', true), // TASK 760: C is Circle (no free letter: every letter is taken)
  tool('tool.fillet', 'n', 'Fillet'),        // no free letter in the name (F Fix)
  tool('tool.mirror', 'm', 'Mirror', 'Tools', false),   // Shift+M = Midpoint
  tool('tool.circularPattern', 'u', 'Circular Pattern'),   // circUlar
  tool('tool.rectangularPattern', 'g', 'Rectangular Pattern'), // a Grid (rectanGular)
  tool('tool.offset', 'z', 'Offset'),        // Fusion's O is our Tangent; no free letter in the name
  tool('tool.dimension', 'd', 'Dimension'),
  // ── Constrain ──
  tool('tool.coincident', 'x', 'Coincident', 'Constrain'),
  tool('tool.horizontalVertical', 'h', 'Horizontal / Vertical', 'Constrain'),
  tool('tool.parallel', 'q', 'Parallel', 'Constrain'),
  tool('tool.perpendicular', 't', 'Perpendicular', 'Constrain'),
  tool('tool.collinear', 'i', 'Collinear', 'Constrain'),
  tool('tool.tangent', 'o', 'Tangent', 'Constrain'),
  tool('tool.equal', 'e', 'Equal', 'Constrain'),
  tool('tool.midpoint', 'm', 'Midpoint', 'Constrain', true), // M is Mirror
  tool('tool.symmetric', 'y', 'Symmetric', 'Constrain'),     // sYmmetric (S is Select)
  { id: 'sketch.fix', label: 'Fix / Unfix', group: 'Constrain', hosts: ALL, scope: 'canvas', keys: [toolKey('f')] },
  // ── Edit ──
  { id: 'edit.undo', label: 'Undo', group: 'Edit', hosts: ALL, scope: 'app', keys: [{ key: 'z', mod: true, shift: false }] }, // history-control.js
  { id: 'edit.redo', label: 'Redo', group: 'Edit', hosts: ALL, scope: 'app', keys: [{ key: 'y', mod: true }, { key: 'z', mod: true, shift: true }] },
  { id: 'edit.copy', label: 'Copy', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'c', mod: true, shift: false, alt: false }] }, // clipboard.js
  { id: 'edit.cut', label: 'Cut', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'x', mod: true, shift: false, alt: false }] },
  { id: 'edit.paste', label: 'Paste', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'v', mod: true, shift: false, alt: false }] },
  { id: 'edit.delete', label: 'Delete', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'Delete', notIn: DOC_TAB }, plain('Backspace')] },
  // Esc is ONE meaning, Cancel: every open layer handles it (the drawing tool, a pending constraint, the Solver Tuning panel, Pen Plotter's
  // interaction or selection), each in its own handler, all asking for this id.
  // TASK 747: fixed: Esc is also what cancels a key change in Settings > Shortcuts, so it cannot be captured.
  { id: 'edit.cancel', label: 'Cancel', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [plain('Escape')],
    fixed: 'Esc is the one Cancel everywhere (it also cancels a key change here)' },
  { id: 'file.save', label: 'Save', group: 'Edit', hosts: ALL, scope: 'app', keys: [{ key: 's', mod: true, shift: false, alt: false }] }, // sidebar-projects.js
  // ── Sketch ──
  { id: 'sketch.construction', label: 'Construction on / off', group: 'Sketch', hosts: ALL, scope: 'app', keys: [{ key: 'k', mod: false, alt: false }] }, // design-browser.js
  // TASK 756: every app (user groups are part of the shared Design tab): input-manager.js runs #ui/group-actions.js
  { id: 'sketch.group', label: 'Group', group: 'Sketch', hosts: ALL, scope: 'canvas', keys: [{ key: 'g', mod: true, shift: false }] },
  { id: 'sketch.ungroup', label: 'Ungroup', group: 'Sketch', hosts: ALL, scope: 'canvas', keys: [{ key: 'g', mod: true, shift: true }] },
  { id: 'sketch.combine', label: 'Combine', group: 'Sketch', hosts: ['shaper'], scope: 'canvas', keys: [{ key: 'c', mod: true, shift: true }] }, // the profiles opt-in
  { id: 'sketch.uncombine', label: 'Uncombine', group: 'Sketch', hosts: ['shaper'], scope: 'canvas', keys: [{ key: 'u', mod: true, shift: true }] },
  // ── Drawing (only while a tool is at work; its handler runs before the canvas letters) ──
  // (TASK 747: the typed digits are fixed: every digit is the key)
  { id: 'draw.typeValue', label: 'Type a size', group: 'Drawing', hosts: ALL, scope: 'tool:shape', keys: [{ chars: '0123456789.' }], note: 'while drawing',
    fixed: 'the digits you type are the size' }, // rect / circle / slot
  { id: 'dim.typeValue', label: 'Type the dimension value', group: 'Drawing', hosts: ALL, scope: 'tool:dimension', keys: [{ chars: '0123456789.-' }],
    fixed: 'the digits you type are the value' },
  { id: 'dim.place', label: 'Place the dimension', group: 'Drawing', hosts: ALL, scope: 'tool:dimension', keys: [plain('Enter')] },
  { id: 'line.finish', label: 'Finish the line', group: 'Drawing', hosts: ALL, scope: 'tool:line', keys: [plain('Enter')] },
  { id: 'bezier.finish', label: 'Finish the curve', group: 'Drawing', hosts: ALL, scope: 'tool:bezier', keys: [plain('Enter')] },
  { id: 'mirror.finish', label: 'Finish the mirror', group: 'Drawing', hosts: ALL, scope: 'tool:mirror', keys: [plain('Enter')] },
  { id: 'pattern.ok', label: 'Finish the pattern', group: 'Drawing', hosts: ALL, scope: 'tool:pattern', keys: [plain('Enter')] },
  { id: 'fillet.radius', label: 'Fillet radius', group: 'Drawing', hosts: ALL, scope: 'tool:fillet', keys: [letter('r')], note: 'in Fillet' },
  // ── View ──
  // TASK 740: the Parameters window (app-footer.js: the same toggle as its fx button, while that button shows; Trace has none, decision O14)
  { id: 'view.parameters', label: 'Parameters window', group: 'View', hosts: ['sketchstudio', 'shaper', 'penplotter'], scope: 'app', keys: [toolKey('p', true)] },
  // (Pen Plotter's Toolpath / Export stages: keyboard.js)
  { id: 'view.panHold', label: 'Hold to pan', group: 'View', hosts: ['penplotter'], scope: 'stage:toolpath', keys: [{ code: 'Space' }],
    fixed: 'held while you drag with the mouse' },
]);

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** The DECLARED shortcut (its default keys), or a throw: a handler asking for an id the table does not have is a bug, not a silent miss. */
export function defaultShortcut(id) {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`shortcuts.js: no shortcut "${id}" is declared`);
  return s;
}

// ── TASK 747: the user's own keys (ONE setting), applied here and nowhere else ──
export const USER_KEYS_SETTING = 'SHORTCUT_KEYS';
const USER_KEYS_VERSION = 1;
const COMBO_FIELDS = new Set(['key', 'code', 'chars', 'mod', 'shift', 'alt', 'notIn']);
const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
/** Is `c` a combo of the declared form (one of key / code / chars; mod / shift / alt each true, false or absent; an optional notIn; nothing else)? */
export function isCombo(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (!Object.keys(c).every((k) => COMBO_FIELDS.has(k))) return false;
  if (['key', 'code', 'chars'].filter((k) => c[k] !== undefined).length !== 1) return false;
  if (!['key', 'code', 'chars'].every((k) => c[k] === undefined || nonEmpty(c[k]))) return false;
  if (!['mod', 'shift', 'alt'].every((m) => c[m] === undefined || typeof c[m] === 'boolean')) return false;
  return c.notIn === undefined || nonEmpty(c.notIn);
}
/** The stored setting, validated: { id: frozen combos } for each known, changeable id with a well-formed list. Anything else is left out with a
 *  warning (that id keeps its default): an unknown id, a fixed one, a list that is not combos, a value of another shape. Never throws. */
export function userKeysOf(raw) {
  const out = {};
  if (raw === null || raw === undefined) return out;
  if (typeof raw !== 'object' || raw.v !== USER_KEYS_VERSION || !raw.keys || typeof raw.keys !== 'object' || Array.isArray(raw.keys)) {
    console.warn(`[shortcuts] the stored ${USER_KEYS_SETTING} is not { v: 1, keys: {...} }: every shortcut keeps its default key`);
    return out;
  }
  for (const [id, combos] of Object.entries(raw.keys)) {
    const s = BY_ID.get(id);
    if (!s) { console.warn(`[shortcuts] a stored key for an unknown shortcut "${id}" is ignored`); continue; }
    if (s.fixed) { console.warn(`[shortcuts] the stored key for "${id}" is ignored: it cannot be changed (${s.fixed})`); continue; }
    if (!Array.isArray(combos) || !combos.every(isCombo)) { console.warn(`[shortcuts] the stored key for "${id}" is not a list of combos: its default is kept`); continue; }
    out[id] = Object.freeze(combos.map((c) => Object.freeze({ ...c })));
  }
  return out;
}

let userKeys = {};            // id -> combos, from the setting (validated)
let current = BY_ID;          // id -> the shortcut as it is now (the declared one, or a copy with the user's keys)
const changeListeners = new Set();
function applyUserKeys() {
  userKeys = userKeysOf(SettingsManager.get(USER_KEYS_SETTING));
  current = new Map(SHORTCUTS.map((s) => [s.id, userKeys[s.id] ? Object.freeze({ ...s, keys: userKeys[s.id] }) : s]));
  for (const fn of changeListeners) fn();
}
applyUserKeys();
SettingsManager.subscribe((key) => { if (key === null || key === USER_KEYS_SETTING) applyUserKeys(); }); // null = a load / a reset of every setting

/** Call `fn()` whenever a shortcut's key changes (an edit, a reset, a settings reload); returns the unsubscribe. The tooltips and the list use it. */
export function onShortcutsChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }

/** The shortcut as it is NOW (its keys = the user's when changed), or a throw for an undeclared id. */
export function shortcutById(id) {
  defaultShortcut(id);
  return current.get(id);
}
/** Has the user changed this shortcut's key? */
export function isShortcutChanged(id) { defaultShortcut(id); return Object.prototype.hasOwnProperty.call(userKeys, id); }

const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : '');
const modOk = (want, held) => want === undefined || want === !!held;

/** Does keyboard event `e` match one combo? */
export function comboMatches(c, e) {
  if (!e) return false;
  if (c.key !== undefined && lower(e.key) !== lower(c.key)) return false;
  if (c.code !== undefined && e.code !== c.code) return false;
  if (c.chars !== undefined && !(typeof e.key === 'string' && e.key.length === 1 && c.chars.includes(e.key))) return false;
  if (!modOk(c.mod, e.ctrlKey || e.metaKey) || !modOk(c.shift, e.shiftKey) || !modOk(c.alt, e.altKey)) return false;
  if (c.notIn && e.target && typeof e.target.closest === 'function' && e.target.closest(c.notIn)) return false;
  return true;
}

/** TASK 740: the key of shortcut `id` as a tooltip shows it, e.g. 'L', 'Shift+B', 'Ctrl+Shift+C' (its first combo; Cmd on a Mac); '' when it has none. */
export function shortcutHint(id, { mac = isMacPlatform() } = {}) {
  const c = shortcutById(id).keys[0];
  return c ? comboText(c, { mac }) : '';
}

/** TASK 740: a button title with its key: titleWithShortcut('Line', 'tool.line') = 'Line (L)'; just the title when the shortcut has no key (TASK 747). */
export function titleWithShortcut(title, id, opts) {
  const hint = shortcutHint(id, opts);
  return hint ? `${title} (${hint})` : title;
}

// TASK 747: while the user is pressing a new key in Settings > Shortcuts, NO shortcut fires (every handler asks here, so this is the one switch).
let capturing = false;
/** Settings > Shortcuts only: true while it waits for a key (then no shortcut matches anything), false after. */
export function setShortcutCapture(on) { capturing = !!on; }

/** Is `e` the shortcut `id`? */
export function matchesShortcut(e, id) {
  const s = shortcutById(id);
  return !capturing && s.keys.some((c) => comboMatches(c, e));
}

/** The first of `ids` that `e` is, or null. */
export function matchShortcut(e, ids) {
  for (const id of ids) if (matchesShortcut(e, id)) return id;
  return null;
}

/** The shortcuts the list shows for one app, in table order, with their keys as they are now. */
export function shortcutsForHost(hostId) {
  return SHORTCUTS.filter((s) => s.listed !== false && s.hosts.includes(hostId)).map((s) => current.get(s.id));
}

// ── TASK 747: the conflict rule ──
// Shortcut A taking `combo` conflicts with another shortcut B when ALL hold:
//  1. A and B share an app (hosts);
//  2. their scopes are live together: the same scope, or either is 'app'. A 'tool:<mode>' key shadows the canvas letters while that tool draws (its
//     handler runs first: by design, never a conflict), two tools never draw at once, and Pen Plotter's 'stage:toolpath' never meets the Design 'canvas';
//  3. one key press is both (combosOverlap): the same key (any case; a chars combo is each of its characters; Space by code is the space key) and no
//     modifier that one requires held while the other requires it released;
// Every key B has NOW counts (B's own changes included), listed or not, changeable or not. The declared defaults have no conflict under this rule
// (tests/shortcuts-747.test.js).
const CODE_KEYS = { Space: ' ' };
const keysOfCombo = (c) => (c.chars !== undefined ? [...c.chars] : c.key !== undefined ? [lower(c.key)] : [CODE_KEYS[c.code] ?? 'code:' + c.code]);
/** Can one key press match both combos? */
export function combosOverlap(a, b) {
  const kb = keysOfCombo(b);
  if (!keysOfCombo(a).some((k) => kb.includes(k))) return false;
  return ['mod', 'shift', 'alt'].every((m) => a[m] === undefined || b[m] === undefined || a[m] === b[m]);
}
/** Are two scopes live at the same moment (rule 2)? */
export const scopesLiveTogether = (a, b) => a === b || a === 'app' || b === 'app';
/** The ids of the shortcuts `combo` would collide with if shortcut `id` took it (the rule above), in table order. `keysOf(id)` = that shortcut's
 *  keys (default: as they are now). Pure given keysOf. */
export function shortcutConflicts(id, combo, keysOf = (x) => shortcutById(x).keys) {
  const me = defaultShortcut(id);
  return SHORTCUTS.filter((o) => o.id !== id && o.hosts.some((h) => me.hosts.includes(h)) && scopesLiveTogether(me.scope, o.scope)
    && keysOf(o.id).some((c) => combosOverlap(c, combo))).map((o) => o.id);
}

// ── TASK 747: the keys a page cannot or must not take, declared once (Settings > Shortcuts shows the reason). A modifier absent here = any. ──
const zoom = (k) => ({ combo: { key: k, mod: true }, reason: 'zooms the page' });
const tabN = (n) => ({ combo: { key: String(n), mod: true }, reason: 'switches to a browser tab' });
export const REFUSED_KEYS = Object.freeze([
  { combo: { key: 'w', mod: true }, reason: 'closes the browser tab' },
  { combo: { key: 't', mod: true }, reason: 'opens or reopens a browser tab' },
  { combo: { key: 'n', mod: true }, reason: 'opens a new browser window' },
  { combo: { key: 'Tab', mod: true }, reason: 'switches browser tabs' },
  { combo: { key: 'PageUp', mod: true }, reason: 'switches browser tabs' },
  { combo: { key: 'PageDown', mod: true }, reason: 'switches browser tabs' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tabN),
  { combo: { key: 'Tab' }, reason: 'moves the keyboard focus' },
  { combo: { key: 'r', mod: true }, reason: 'reloads the page' },
  { combo: { key: 'F5' }, reason: 'reloads the page' },
  { combo: { key: 'l', mod: true }, reason: 'goes to the address bar' },
  { combo: { key: 'd', alt: true }, reason: 'goes to the address bar' },
  { combo: { key: 'F6' }, reason: 'goes to the address bar' },
  { combo: { key: 'f', mod: true }, reason: 'finds in the page' },
  { combo: { key: 'F3' }, reason: 'finds in the page' },
  { combo: { key: 'p', mod: true }, reason: 'prints the page' },
  ...['0', '=', '+', '-'].map(zoom),
  { combo: { key: 'F11' }, reason: 'turns full screen on and off' },
  { combo: { key: 'F12' }, reason: 'opens the developer tools' },
  { combo: { key: 'i', mod: true, shift: true }, reason: 'opens the developer tools' },
  { combo: { key: 'j', mod: true, shift: true }, reason: 'opens the developer tools' },
  { combo: { key: 'F4', alt: true }, reason: 'closes the window' },
  { combo: { key: 'q', mod: true }, reason: 'quits the browser' },
  { combo: { key: 'h', mod: true }, reason: 'hides the browser (Mac) or opens its history' },
  { combo: { key: 'm', mod: true }, reason: 'minimises the window (Mac)' },
  { combo: { key: 'ArrowLeft', alt: true }, reason: 'goes back a page (leaves the app)' },
  { combo: { key: 'ArrowRight', alt: true }, reason: 'goes forward a page' },
]);
/** Why `combo` may not be a shortcut (it is the browser's own key), or null. */
export function refusedReason(combo) {
  const r = REFUSED_KEYS.find((x) => combosOverlap(x.combo, combo));
  return r ? r.reason : null;
}

// ── TASK 747: a key pressed in Settings > Shortcuts, as a combo ──
const NOT_A_KEY_YET = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'OS', 'Hyper', 'Super',
  'Symbol', 'SymbolLock', 'Dead', 'Unidentified', 'Process']);
/** The combo a key press makes: { key, mod, shift, alt } (every modifier stated, exactly as pressed); { cancel: true } for Esc; null for a bare
 *  modifier (or a dead / unidentified key): keep waiting for a real key. */
export function comboFromEvent(e) {
  const k = e && e.key;
  if (!nonEmpty(k) || NOT_A_KEY_YET.has(k)) return null;
  if (k === 'Escape') return { cancel: true };
  return { key: k.length === 1 ? k.toLowerCase() : k, mod: !!(e.ctrlKey || e.metaKey), shift: !!e.shiftKey, alt: !!e.altKey };
}
const sameCombos = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── TASK 747: the edits. Each writes the ONE setting with only the changed ids (a list equal to the default drops its id). ──
function writeUserKeys(next) {
  const keys = {};
  for (const [id, combos] of Object.entries(next)) if (!sameCombos(combos, defaultShortcut(id).keys)) keys[id] = combos.map((c) => ({ ...c }));
  SettingsManager.set(USER_KEYS_SETTING, { v: USER_KEYS_VERSION, keys }, { persist: 'local' });
}
function changeable(id) {
  const s = defaultShortcut(id);
  if (s.fixed) throw new Error(`shortcuts.js: "${id}" cannot be changed (${s.fixed})`);
  return s;
}
// a captured key keeps the element a declared combo of the same key leaves to that element (Delete on a focused document tab stays the tab's)
function withDeclaredNotIn(id, combo) {
  const d = defaultShortcut(id).keys.find((c) => c.notIn && c.key !== undefined && lower(c.key) === lower(combo.key));
  return d ? { ...combo, notIn: d.notIn } : combo;
}
// the shortcuts these keys of `id` would collide with (each combo's conflicts, once each, in table order)
function conflictsOfKeys(id, keys) {
  const hit = new Set(keys.flatMap((c) => shortcutConflicts(id, c)));
  return SHORTCUTS.map((s) => s.id).filter((x) => hit.has(x));
}
/** Shortcut `id` takes `combo` (a captured { key, mod, shift, alt }) as its only key. Returns { refused: reason } | { conflicts: [ids], keys }
 *  (nothing changed; `keys` = what Swap would give it) | { same: true } (it is already its only key) | { done: true }. */
export function assignShortcut(id, combo) {
  changeable(id);
  const reason = refusedReason(combo);
  if (reason) return { refused: reason };
  const keys = [withDeclaredNotIn(id, combo)];
  if (sameCombos(shortcutById(id).keys, keys)) return { same: true };
  const conflicts = conflictsOfKeys(id, keys);
  if (conflicts.length) return { conflicts, keys };
  writeUserKeys({ ...userKeys, [id]: keys });
  return { done: true };
}
/** A conflict's Swap: `id` takes `keys` (what assignShortcut / resetShortcut answered), and `otherId` (its ONE conflict) takes the keys `id` had
 *  (none if it had none). The two shortcuts trade keys; nothing else is re-checked. Throws when `otherId` is not that one, changeable conflict (the
 *  list offers Swap only then) or when `keys` holds a refused key that is not the shortcut's default. */
export function swapShortcut(id, keys, otherId) {
  changeable(id); changeable(otherId);
  if (!Array.isArray(keys) || !keys.every(isCombo)) throw new Error('shortcuts.js: swap needs a list of combos');
  if (!sameCombos(keys, defaultShortcut(id).keys) && keys.some((c) => refusedReason(c))) throw new Error('shortcuts.js: a refused key cannot be swapped in');
  const conflicts = conflictsOfKeys(id, keys);
  if (conflicts.length !== 1 || conflicts[0] !== otherId) throw new Error(`shortcuts.js: swap ${id} / ${otherId}: its conflicts are ${JSON.stringify(conflicts)}`);
  writeUserKeys({ ...userKeys, [id]: keys, [otherId]: shortcutById(id).keys.map((k) => ({ ...k })) });
}
/** Shortcut `id` has no key (the list shows "none", its tooltip no key). */
export function unassignShortcut(id) { changeable(id); writeUserKeys({ ...userKeys, [id]: [] }); }
/** Shortcut `id` gets its default key back: { done: true } | { same: true } (not changed) | { conflicts: [ids], keys } when another shortcut has taken
 *  that key since (nothing changed; Swap gives it this one's present key). */
export function resetShortcut(id) {
  if (!isShortcutChanged(id)) return { same: true };
  const keys = defaultShortcut(id).keys;
  const conflicts = conflictsOfKeys(id, keys);
  if (conflicts.length) return { conflicts, keys };
  const next = { ...userKeys }; delete next[id];
  writeUserKeys(next);
  return { done: true };
}
/** Every shortcut gets its default key back. */
export function resetAllShortcuts() { writeUserKeys({}); }

const KEY_NAMES = { escape: 'Esc', delete: 'Delete', backspace: 'Backspace', enter: 'Enter', ' ': 'Space' };
const CODE_NAMES = { Space: 'Space' };
function charsCaps(chars) {
  const digits = '0123456789';
  const rest = [...chars].filter((ch) => !digits.includes(ch));
  return [digits.split('').every((d) => chars.includes(d)) ? '0-9' : null, ...rest].filter(Boolean);
}
/** The key caps of one combo, e.g. ['Ctrl', 'Shift', 'Z'] (['Cmd', ...] when `mac`). Only the HELD modifiers show. A `chars` combo's caps are
 *  alternatives (any one of them), not a chord: comboIsChord(c) tells the list how to join them. */
export function comboCaps(c, { mac = false } = {}) {
  const caps = [];
  if (c.mod === true) caps.push(mac ? 'Cmd' : 'Ctrl');
  if (c.alt === true) caps.push(mac ? 'Option' : 'Alt');
  if (c.shift === true) caps.push('Shift');
  if (c.code !== undefined) caps.push(CODE_NAMES[c.code] || c.code);
  else if (c.chars !== undefined) return [...caps, ...charsCaps(c.chars)];
  else caps.push(KEY_NAMES[lower(c.key)] || (c.key.length === 1 ? c.key.toUpperCase() : c.key));
  return caps;
}

/** Are the caps of `c` pressed together (Ctrl+Z) rather than any one of them (0-9 .)? */
export function comboIsChord(c) { return c.chars === undefined; }

/** One combo as text: 'Ctrl+Shift+Z', '0-9 .' (TASK 747: the tooltips, the list's filter and its messages read it). */
export function comboText(c, { mac = false } = {}) { return comboCaps(c, { mac }).join(comboIsChord(c) ? '+' : ' '); }

/** Is this a Mac (Cmd instead of Ctrl in the list)? */
export function isMacPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const p = nav ? String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '') : '';
  return /mac|iphone|ipad/i.test(p);
}
