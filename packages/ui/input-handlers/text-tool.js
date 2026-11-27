// packages/ui/input-handlers/text-tool.js — TASK 845: the Design tab's TEXT tool and THE text editor (the inline box), every app.
//
// The tool: a click places a new text's ANCHOR (the start of its baseline; it snaps like every tool, and a locked snap on a point makes the
// anchor coincident with it) and opens the editor there. The editor is the ONE place a text is typed and styled, for a new text and for an
// existing one (the Select tool's double click / double tap on a text, the canvas menu's "Edit text": openTextEditor):
//   the string (a textarea: Enter = a new line), the font (the bundled outline and single-line fonts, the user's own fonts of this session,
//   "Load your own font..."), the size (the height of a capital, in the document unit), the letter spacing (document unit), the line spacing
//   (a factor of the font's line height) and the alignment (left / centre / right of the anchor).
// Every change shows at once on the canvas (the text's letters are rebuilt: #core/text.js editText). OK (or Ctrl+Enter, Enter in a field, a
// press anywhere outside the box, another tool) commits: ONE undo step for the whole edit (captured when the box opened); Cancel / Esc puts the
// text back as it was (a text being placed is removed). An empty text is never kept.
// "Convert to shapes" (convertSelectedText: the canvas menu) turns the selected text into ordinary curves: one undo step.

import { addText, editText, removeText, convertTextToShapes, TEXT_ALIGNS, TEXT_DEFAULTS, TEXT_FALLBACK, TEXT_STYLE_KEYS } from '#core/text.js';
import { groupCommands } from '#core/group-model.js';
import { applySnapConstraint, SNAP_JOIN } from '#core/snap-constraints.js';
import { lengthText } from '#core/settings-manager.js';
import { fontLibrary, textFace, fallbackNote, USER_FONT_ACCEPT } from '#ui/text-fonts.js';
import { placeAnchoredBox, parseBoxValue } from '#ui/numeric-input-manager.js';
import { listenOutsidePress } from '#ui/outside-press.js';
import { showNotification } from '#ui/notification-manager.js';

export const TEXT_EDITOR_CLASS = 'sk-text-editor';
export const TEXT_UNDO_LABELS = Object.freeze({ add: 'text', edit: 'edit text', convert: 'convert text to shapes' });
const PHONE_QUERY = '(max-width: 640px), (pointer: coarse)';
const ALIGN_ICONS = {
  left: '<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>',
  center: '<path d="M4 5h14M7.5 9h7M4 13h14M7.5 17h7"/>',
  right: '<path d="M5 5h14M10 9h9M5 13h14M10 17h9"/>',
};
const ALIGN_LABELS = { left: 'Align left', center: 'Align centre', right: 'Align right' };

let session = null; // { state, svg, text, isNew, snapshot, original, snap, el, parts, stopOutside, notify }

const styleOf = (t) => Object.fromEntries(['text', ...TEXT_STYLE_KEYS].map((k) => [k, t[k]]));
const sameStyle = (a, b) => ['text', ...TEXT_STYLE_KEYS].every((k) => a[k] === b[k]);

/** A press with the Text tool: with the editor open it commits it (that press places nothing); else a new text at the press (a locked snap's point). */
export function handleTextPointerDown(e, svg, state, snap, w, notify = showNotification) {
  if (e.button !== undefined && e.button !== 0) return false;
  if (session) { commitTextEditor(); return true; }
  const at = snap && snap.isLocked && snap.pt ? snap.pt : w;
  const snapshot = state.captureUndoSnapshot();
  const style = { ...TEXT_DEFAULTS, ...(state.textStyle || {}) };
  const text = addText(state, { x: at.x, y: at.y }, { ...style, text: '' }, null);
  open({ state, svg, text, isNew: true, snapshot, snap: snap && snap.isLocked ? snap : null, notify });
  return true;
}

/** Open the editor on an existing text (a double click on it, the canvas menu's Edit text). */
export function openTextEditor(state, svg, text, notify = showNotification) {
  if (!text) return false;
  if (session) commitTextEditor();
  open({ state, svg, text, isNew: false, snapshot: state.captureUndoSnapshot(), snap: null, notify });
  return true;
}

function open(s) {
  s.original = styleOf(s.text);
  session = s;
  buildEditor(s);
  rebuild(s);
}

// the text's letters from its face (now, or once its font has downloaded); the note says what the user should know
function rebuild(s) {
  const r = textFace(s.text, fontLibrary);
  if (!r.face) {
    setNote(s, 'Loading the font…');
    r.wait.then(() => { if (session === s) rebuild(s); }, (err) => { if (session === s) setNote(s, `The font could not be loaded: ${err.message}`, true); });
    return;
  }
  const { missing } = editText(s.state, s.text, {}, r.face);
  const notes = [];
  if (r.fallback) notes.push(fallbackNote(s.text));
  if (missing.length) notes.push(`${r.face.name} has no letter for: ${missing.join(' ')}`);
  setNote(s, notes.join(' '), false);
}

function setNote(s, msg, error = false) {
  if (!s.parts) return;
  s.parts.note.textContent = msg || '';
  s.parts.note.classList.toggle('sk-text-note-error', !!error);
}

// one change from the box: the record's fields, then the letters
function change(s, changes) {
  editText(s.state, s.text, changes, null);
  rebuild(s);
}

/** OK: keep the edit as ONE undo step (an unchanged edit makes none; an empty new text is removed, an emptied text is put back). */
export function commitTextEditor() {
  const s = session;
  if (!s) return;
  close(s);
  const { state, text } = s;
  if (!state.shapes.includes(text)) return; // an undo while the box was open took the text away
  const empty = !String(text.text || '').trim();
  if (s.isNew) {
    if (empty) { removeText(state, text); return; }
    state.saveStateForce(TEXT_UNDO_LABELS.add, s.snapshot);
    if (s.snap) applySnapConstraint(state, text.joints[0], s.snap, { join: SNAP_JOIN.GLUE }); // the anchor on the point it was placed on (the same step); a text is no curve: glued (TASK 1045)
    state.textStyle = Object.fromEntries(TEXT_STYLE_KEYS.map((k) => [k, text[k]])); // the next text starts in this style
    return;
  }
  if (empty) { restore(s); s.notify('A text needs at least one character (Delete removes the text)', 'warning'); return; }
  if (!sameStyle(s.original, styleOf(text))) state.saveStateForce(TEXT_UNDO_LABELS.edit, s.snapshot);
}

/** TASK 1030 (I-05): the text editor is open (a text being placed or edited). */
export function textEditorOpen() { return !!session; }

/** Cancel / Esc: the text as it was (a text being placed is removed). No undo step. */
export function cancelTextEditor() {
  const s = session;
  if (!s) return;
  close(s);
  if (!s.state.shapes.includes(s.text)) return;
  if (s.isNew) removeText(s.state, s.text); else restore(s);
}

function restore(s) {
  editText(s.state, s.text, s.original, null);
  const r = textFace(s.text, fontLibrary);
  if (r.face) editText(s.state, s.text, {}, r.face);
}

function close(s) {
  if (session === s) session = null;
  if (s.stopOutside) s.stopOutside();
  if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
  s.el = null; s.parts = null;
}

/** The canvas menu's text entries (context-menu.js groupMenuItems, when the selection is ONE text): Edit text, Convert to shapes. */
export function textMenuActions(state, getSvg, notify = showNotification) {
  return {
    editText: () => { const t = selectedText(state); return t ? openTextEditor(state, getSvg(), t, notify) : false; },
    convertText: () => convertSelectedText(state, notify),
  };
}

// the ONE selected text (groupCommands().text), or null
function selectedText(state) {
  const id = groupCommands(state).text;
  return id ? (state.shapes || []).find((s) => s.id === id) || null : null;
}

/** Convert to shapes: the selected text becomes ordinary curves (#core/text.js convertTextToShapes). ONE undo step. -> true when converted. */
export function convertSelectedText(state, notify = showNotification) {
  const t = selectedText(state);
  if (!t) { notify('Select one text to convert it to shapes', 'warning'); return false; }
  if (session && session.text === t) commitTextEditor();
  state.saveState(TEXT_UNDO_LABELS.convert);
  convertTextToShapes(state, t); // TASK 878: the curves show: no message
  return true;
}

// ---- the box ----------------------------------------------------------------------------------------------------------------------

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.id = 'sk-text-editor-styles';
  s.textContent = `
.${TEXT_EDITOR_CLASS} { position: fixed; z-index: 9000; box-sizing: border-box; width: 300px; display: flex; flex-direction: column; gap: 6px; padding: 8px;
  background: var(--sk-ribbon-menu-bg, #fff); color: var(--sk-ribbon-fg, #1f2937); border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.22); font: 12px system-ui, sans-serif; }
.${TEXT_EDITOR_CLASS} * { box-sizing: border-box; }
.${TEXT_EDITOR_CLASS} textarea { width: 100%; min-height: 48px; resize: vertical; padding: 4px 6px; font: 14px system-ui, sans-serif; color: inherit;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 3px; background: transparent; }
.${TEXT_EDITOR_CLASS} select, .${TEXT_EDITOR_CLASS} input[type=text] { height: 26px; padding: 2px 6px; font: 12px system-ui, sans-serif; color: inherit; min-width: 0;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 3px; background: var(--sk-ribbon-menu-bg, #fff); }
.${TEXT_EDITOR_CLASS} select { width: 100%; }
.${TEXT_EDITOR_CLASS} input[aria-invalid=true] { border-color: var(--sk-error, #ef4444); outline: 1px solid var(--sk-error, #ef4444); }
.sk-text-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.sk-text-grid label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; opacity: 0.9; }
.sk-text-grid input[type=text] { width: 100%; }
.sk-text-row { display: flex; align-items: center; gap: 6px; }
.sk-text-align { display: inline-flex; border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 3px; overflow: hidden; }
.sk-text-align button { width: 30px; height: 26px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.sk-text-align button + button { border-left: 1px solid var(--sk-ribbon-sep, #cbd5e1); }
.sk-text-align button[aria-pressed=true] { background: rgba(59, 130, 246, 0.18); color: var(--sk-selection, #3B82F6); }
.sk-text-align svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
.sk-text-spacer { flex: 1 1 auto; }
.sk-text-row > button { height: 26px; min-width: 64px; padding: 0 12px; border-radius: 3px; font: 600 12px system-ui, sans-serif; cursor: pointer;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); background: var(--sk-ribbon-menu-bg, #fff); color: inherit; }
.sk-text-row > .sk-text-ok { background: var(--sk-selection, #3B82F6); border-color: var(--sk-selection, #3B82F6); color: #fff; }
.sk-text-note { font-size: 11px; opacity: 0.8; min-height: 0; }
.sk-text-note:empty { display: none; }
.sk-text-note-error { color: var(--sk-error, #ef4444); opacity: 1; }
.${TEXT_EDITOR_CLASS}.sk-text-docked { left: 8px !important; right: 8px; width: auto; top: 8px !important; }
@media (pointer: coarse) {
  .${TEXT_EDITOR_CLASS} textarea { font-size: 16px; }
  .${TEXT_EDITOR_CLASS} select, .${TEXT_EDITOR_CLASS} input[type=text], .sk-text-row > button { height: 44px; font-size: 16px; }
  .sk-text-align button { width: 44px; height: 44px; }
}
`;
  document.head.appendChild(s);
}

const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };
const fmtLen = (v) => lengthText(v, { show: 'compact' });

function fillFonts(select, current) {
  select.textContent = '';
  const groups = [['outline', 'Outline fonts (closed letters)'], ['single', 'Single-line fonts (engraving, pen)'], ['user', 'Your fonts (this session)']];
  const list = fontLibrary.list();
  for (const [key, label] of groups) {
    const items = list.filter((f) => (key === 'user' ? f.user : !f.user && f.kind === key));
    if (!items.length) continue;
    const og = el('optgroup', { label });
    for (const f of items) { const o = el('option', { value: f.name }); o.textContent = f.name; og.appendChild(o); }
    select.appendChild(og);
  }
  if (!list.some((f) => f.name === current)) { const o = el('option', { value: current }); o.textContent = `${current} (not loaded)`; select.insertBefore(o, select.firstChild); }
  const load = el('option', { value: '', 'data-load': '1' }); load.textContent = 'Load your own font…';
  select.appendChild(load);
  select.value = current;
}

function buildEditor(s) {
  injectStyles();
  const { text } = s;
  const box = el('div', { class: TEXT_EDITOR_CLASS, role: 'dialog', 'aria-label': s.isNew ? 'New text' : 'Edit text' });
  const ta = el('textarea', { class: 'sk-text-input', rows: '2', 'aria-label': 'Text', placeholder: 'Type the text', spellcheck: 'false' });
  ta.value = text.text || '';
  const font = el('select', { class: 'sk-text-font', 'aria-label': 'Font' });
  fillFonts(font, text.font);
  const grid = el('div', { class: 'sk-text-grid' });
  const field = (cls, label, title, value) => {
    const l = el('label', { title }); l.append(label);
    const i = el('input', { type: 'text', class: cls, inputmode: 'decimal', 'aria-label': title }); i.value = value;
    l.appendChild(i); grid.appendChild(l); return i;
  };
  const size = field('sk-text-size', 'Size', 'Size: the height of a capital letter', fmtLen(text.size));
  const spacing = field('sk-text-spacing', 'Letter', 'Letter spacing: extra space between letters', fmtLen(text.letterSpacing || 0));
  const line = field('sk-text-line', 'Line', 'Line spacing: a factor of the font\'s line height', String(text.lineSpacing ?? 1));
  const align = el('div', { class: 'sk-text-align', role: 'group', 'aria-label': 'Alignment' });
  const alignBtns = TEXT_ALIGNS.map((a) => {
    const b = el('button', { type: 'button', 'data-align': a, 'aria-label': ALIGN_LABELS[a], title: ALIGN_LABELS[a], 'aria-pressed': String(text.align === a) }, `<svg viewBox="0 0 22 22">${ALIGN_ICONS[a]}</svg>`);
    align.appendChild(b); return b;
  });
  const cancel = el('button', { type: 'button', class: 'sk-text-cancel' }); cancel.textContent = 'Cancel';
  const ok = el('button', { type: 'button', class: 'sk-text-ok' }); ok.textContent = 'OK';
  const row1 = el('div', { class: 'sk-text-row' }); row1.appendChild(font);
  const row2 = el('div', { class: 'sk-text-row' }); row2.append(align, el('span', { class: 'sk-text-spacer' }), cancel, ok);
  const note = el('div', { class: 'sk-text-note', 'aria-live': 'polite' });
  const file = el('input', { type: 'file', class: 'sk-text-file', accept: USER_FONT_ACCEPT, hidden: '' });
  box.append(ta, row1, grid, row2, note, file);
  s.el = box; s.parts = { ta, font, size, spacing, line, alignBtns, ok, cancel, note, file };

  ta.addEventListener('input', () => change(s, { text: ta.value }));
  font.addEventListener('change', () => {
    const opt = font.selectedOptions && font.selectedOptions[0];
    if (opt && opt.getAttribute('data-load')) { font.value = s.text.font; file.click(); return; }
    const f = fontLibrary.list().find((x) => x.name === font.value);
    if (f) change(s, { font: f.name, fontKind: f.kind, fallback: TEXT_FALLBACK[f.kind] });
  });
  file.addEventListener('change', () => {
    const picked = file.files && file.files[0];
    file.value = '';
    if (!picked) return;
    setNote(s, `Reading ${picked.name}…`);
    picked.arrayBuffer().then((bytes) => fontLibrary.addFontFile(bytes, picked.name)).then((face) => {
      if (session !== s) return;
      fillFonts(font, face.name);
      change(s, { font: face.name, fontKind: face.kind, fallback: TEXT_FALLBACK[face.kind] });
    }, (err) => { if (session === s) setNote(s, `This font could not be read: ${err.message}`, true); });
  });
  const lengthField = (input, key, valid) => input.addEventListener('input', () => {
    const v = parseBoxValue(input.value, 'length');
    const good = Number.isFinite(v) && valid(v);
    input.setAttribute('aria-invalid', String(!good));
    if (good) change(s, { [key]: v });
  });
  lengthField(size, 'size', (v) => v > 0);
  lengthField(spacing, 'letterSpacing', (v) => v > -s.text.size);
  line.addEventListener('input', () => {
    const v = Number(String(line.value).replace(',', '.'));
    const good = Number.isFinite(v) && v > 0;
    line.setAttribute('aria-invalid', String(!good));
    if (good) change(s, { lineSpacing: v });
  });
  for (const b of alignBtns) b.addEventListener('click', () => {
    for (const x of alignBtns) x.setAttribute('aria-pressed', String(x === b));
    change(s, { align: b.getAttribute('data-align') });
  });
  ok.addEventListener('click', () => commitTextEditor());
  cancel.addEventListener('click', () => cancelTextEditor());
  // the box's keys are its own (never the canvas's shortcuts): Esc = Cancel, Ctrl / Cmd + Enter = OK (Enter in a one-line field = OK)
  box.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // TASK 1030 (I-02): the box's Esc is the canvas Esc too (input-manager: in the Text tool ONE Esc cancels and leaves the tool)
    if (e.key === 'Escape') { e.preventDefault(); cancelTextEditor(); window.dispatchEvent(new CustomEvent('liveDimensionCancelled')); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target.tagName === 'INPUT')) { e.preventDefault(); commitTextEditor(); }
  });

  document.body.appendChild(box);
  const docked = typeof window !== 'undefined' && window.matchMedia && window.matchMedia(PHONE_QUERY).matches;
  if (docked) box.classList.add('sk-text-docked');
  else {
    const a = s.state.joints.get(text.joints[0]);
    placeAnchoredBox({ el: box, svg: s.svg, world: a ? { x: a.x, y: a.y } : null });
  }
  // a PRESS outside the box commits (the click that ends the press which opened the box must not: clicks are left to the press before them)
  s.stopOutside = listenOutsidePress((ev) => { if (ev.type === 'pointerdown' && session === s && s.el && !s.el.contains(ev.target)) commitTextEditor(); });
  // the keyboard goes to the text once the press that opened the box is over (the canvas takes the focus on every press: input-manager.js)
  setTimeout(() => { if (session === s) { ta.focus(); if (!s.isNew) ta.select(); } }, 0);
}
