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
//          false = must not be held, absent = ignored (today's behaviour: the tool letters ignore every modifier, so Ctrl+D still opens
//          Dimension). notIn: a CSS selector; a key aimed at an element inside it is not this shortcut (it belongs to that element).
//   note   a few grey words, only where the row would otherwise mislead.
//   listed false = bound but not shown in the list (with the reason beside it).
// Remapping later: a user's own keys would REPLACE `keys` per id (stored like the other settings) before matching and listing;
// the handlers already ask by id, so no handler changes.

export const APP_HOSTS = Object.freeze(['sketchstudio', 'shaper', 'penplotter', 'trace']);
const ALL = APP_HOSTS;

const DOC_TAB = '.sk-doctab-main'; // document-tabs.js: a focused document tab owns Delete (it closes that tab)
const letter = (ch) => ({ key: ch });
const plain = (k) => ({ key: k });

const tool = (id, ch, label, group = 'Tools') => ({ id, label, group, hosts: ALL, scope: 'canvas', keys: [letter(ch)] });
const artTool = (name, ch) => ({ id: 'plotter.art.' + name, label: 'Art tool: ' + name, group: 'Tools', hosts: ['penplotter'], scope: 'stage:toolpath', keys: [letter(ch)],
  listed: false }); // the retired Draw art tools (UNIFY-7b): the key still sets Pen Plotter's tool state, nothing a user should look for

export const SHORTCUTS = Object.freeze([
  // ── Tools (input-manager.js, the Design canvas of every app) ──
  tool('tool.line', 'l', 'Line'),
  tool('tool.rect', 'r', 'Rectangle'),
  tool('tool.circle', 'c', 'Circle'),
  tool('tool.arc', 'a', 'Arc'),
  tool('tool.select', 's', 'Select'),
  tool('tool.pan', 'v', 'Pan'),
  tool('tool.dimension', 'd', 'Dimension'),
  // ── Constrain ──
  tool('tool.coincident', 'x', 'Coincident', 'Constrain'),
  tool('tool.perpendicular', 't', 'Perpendicular', 'Constrain'),
  tool('tool.tangent', 'o', 'Tangent', 'Constrain'),
  tool('tool.collinear', 'i', 'Collinear', 'Constrain'),
  tool('tool.horizontalVertical', 'h', 'Horizontal / Vertical', 'Constrain'),
  tool('tool.parallel', 'q', 'Parallel', 'Constrain'),
  tool('tool.equal', 'e', 'Equal', 'Constrain'),
  { id: 'sketch.fix', label: 'Fix / Unfix', group: 'Constrain', hosts: ALL, scope: 'canvas', keys: [letter('f')] },
  // ── Edit ──
  { id: 'edit.undo', label: 'Undo', group: 'Edit', hosts: ALL, scope: 'app', keys: [{ key: 'z', mod: true, shift: false }] }, // history-control.js
  { id: 'edit.redo', label: 'Redo', group: 'Edit', hosts: ALL, scope: 'app', keys: [{ key: 'y', mod: true }, { key: 'z', mod: true, shift: true }] },
  { id: 'edit.copy', label: 'Copy', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'c', mod: true, shift: false, alt: false }] }, // clipboard.js
  { id: 'edit.cut', label: 'Cut', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'x', mod: true, shift: false, alt: false }] },
  { id: 'edit.paste', label: 'Paste', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'v', mod: true, shift: false, alt: false }] },
  { id: 'edit.delete', label: 'Delete', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [{ key: 'Delete', notIn: DOC_TAB }, plain('Backspace')] },
  // Esc is ONE meaning, Cancel: every open layer handles it (the drawing tool, a pending constraint, the Solver Tuning panel, Pen Plotter's
  // interaction or selection), each in its own handler, all asking for this id.
  { id: 'edit.cancel', label: 'Cancel', group: 'Edit', hosts: ALL, scope: 'canvas', keys: [plain('Escape')] },
  { id: 'file.save', label: 'Save', group: 'Edit', hosts: ALL, scope: 'app', keys: [{ key: 's', mod: true, shift: false, alt: false }] }, // sidebar-projects.js
  // ── Sketch ──
  { id: 'sketch.construction', label: 'Construction on / off', group: 'Sketch', hosts: ALL, scope: 'app', keys: [{ key: 'k', mod: false, alt: false }] }, // design-browser.js
  { id: 'sketch.group', label: 'Group', group: 'Sketch', hosts: ['shaper'], scope: 'canvas', keys: [{ key: 'g', mod: true, shift: false }] }, // apps/shaper/src/main.js
  { id: 'sketch.ungroup', label: 'Ungroup', group: 'Sketch', hosts: ['shaper'], scope: 'canvas', keys: [{ key: 'g', mod: true, shift: true }] },
  { id: 'sketch.combine', label: 'Combine', group: 'Sketch', hosts: ['shaper'], scope: 'canvas', keys: [{ key: 'c', mod: true, shift: true }] }, // the profiles opt-in
  { id: 'sketch.uncombine', label: 'Uncombine', group: 'Sketch', hosts: ['shaper'], scope: 'canvas', keys: [{ key: 'u', mod: true, shift: true }] },
  // ── Drawing (only while a tool is at work; its handler runs before the canvas letters) ──
  { id: 'draw.typeValue', label: 'Type a size', group: 'Drawing', hosts: ALL, scope: 'tool:shape', keys: [{ chars: '0123456789.' }], note: 'while drawing' }, // rect / circle / slot
  { id: 'dim.typeValue', label: 'Type the dimension value', group: 'Drawing', hosts: ALL, scope: 'tool:dimension', keys: [{ chars: '0123456789.-' }], note: 'while placing a dimension' },
  { id: 'dim.place', label: 'Place the dimension', group: 'Drawing', hosts: ALL, scope: 'tool:dimension', keys: [plain('Enter')] },
  { id: 'line.finish', label: 'Finish the line', group: 'Drawing', hosts: ALL, scope: 'tool:line', keys: [plain('Enter')] },
  { id: 'bezier.finish', label: 'Finish the curve', group: 'Drawing', hosts: ALL, scope: 'tool:bezier', keys: [plain('Enter')] },
  { id: 'mirror.finish', label: 'Finish the mirror', group: 'Drawing', hosts: ALL, scope: 'tool:mirror', keys: [plain('Enter')] },
  { id: 'pattern.ok', label: 'Finish the pattern', group: 'Drawing', hosts: ALL, scope: 'tool:pattern', keys: [plain('Enter')] },
  { id: 'fillet.radius', label: 'Fillet radius', group: 'Drawing', hosts: ALL, scope: 'tool:fillet', keys: [letter('r')], note: 'in Fillet' },
  // ── View (Pen Plotter's Toolpath / Export stages: keyboard.js) ──
  { id: 'view.panHold', label: 'Hold to pan', group: 'View', hosts: ['penplotter'], scope: 'stage:toolpath', keys: [{ code: 'Space' }] },
  { id: 'plotter.finishPolyline', label: 'Finish the polyline', group: 'Drawing', hosts: ['penplotter'], scope: 'stage:toolpath', keys: [plain('Enter')],
    listed: false }, // the retired art polyline tool's Enter: nothing starts one any more
  artTool('select', 'v'), artTool('rotate', 't'), artTool('scale', 's'), artTool('line', 'l'), artTool('rect', 'r'),
  artTool('ellipse', 'e'), artTool('polyline', 'p'), artTool('freehand', 'f'), artTool('scissors', 'x'), artTool('node', 'n'),
]);

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

/** The declared shortcut, or a throw: a handler asking for an id the table does not have is a bug, not a silent miss. */
export function shortcutById(id) {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`shortcuts.js: no shortcut "${id}" is declared`);
  return s;
}

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

/** Is `e` the shortcut `id`? */
export function matchesShortcut(e, id) {
  return shortcutById(id).keys.some((c) => comboMatches(c, e));
}

/** The first of `ids` that `e` is, or null. */
export function matchShortcut(e, ids) {
  for (const id of ids) if (matchesShortcut(e, id)) return id;
  return null;
}

/** The shortcuts the list shows for one app, in table order. */
export function shortcutsForHost(hostId) {
  return SHORTCUTS.filter((s) => s.listed !== false && s.hosts.includes(hostId));
}

const KEY_NAMES = { escape: 'Esc', delete: 'Delete', backspace: 'Backspace', enter: 'Enter' };
const CODE_NAMES = { Space: 'Space' };
function charsCaps(chars) {
  const digits = '0123456789';
  const rest = [...chars].filter((ch) => !digits.includes(ch));
  return [digits.split('').every((d) => chars.includes(d)) ? '0-9' : null, ...rest].filter(Boolean);
}
/** The key caps of one combo, e.g. ['Ctrl', 'Shift', 'Z'] (['Cmd', ...] when `mac`). Only the HELD modifiers show. */
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

/** Is this a Mac (Cmd instead of Ctrl in the list)? */
export function isMacPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  const p = nav ? String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '') : '';
  return /mac|iphone|ipad/i.test(p);
}
