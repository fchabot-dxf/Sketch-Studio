// packages/ui/shortcuts-list.js: the Settings > Shortcuts tab (TASK 727; TASK 747: the user changes the keys here). The showing app's keyboard
// shortcuts, read from THE declaration (shortcuts.js): key caps + the action name, under short headings, with a filter box. Cmd instead of Ctrl on a Mac.
// TASK 747: a row's key caps are a button: press it, then the new key (a key with optional Ctrl / Cmd, Shift, Alt; a modifier alone waits for the
// key; Esc or a click elsewhere cancels; while it waits no app shortcut fires). A browser key is refused with its reason (REFUSED_KEYS); a key another
// shortcut uses shows "<key> is used by <action>" with Swap / Cancel (so does a row's Reset when another shortcut has taken its default since). A
// changed row is marked and has Reset; x removes the key ("none"); "Reset all
// shortcuts" (an inline confirm) puts every default back. The edits are shortcuts.js's (assignShortcut ...): this file only shows them. A fixed row
// (a `fixed` reason in the table) shows its keys and that reason, no button.
// createShortcutsList({ hostId, mac }) -> { el, setFilter(text), destroy() }

import {
  SHORTCUTS, shortcutsForHost, shortcutById, comboCaps, comboIsChord, comboText, isMacPlatform, isShortcutChanged, defaultShortcut, onShortcutsChange,
  setShortcutCapture, comboFromEvent, assignShortcut, swapShortcut, unassignShortcut, resetShortcut, resetAllShortcuts,
} from '#ui/shortcuts.js';
import { appById } from '#ui/app-registry.js';
import { track } from '#ui/analytics.js'; // TASK 747: 'shortcut-changed' (no key is ever sent)

const GROUP_ORDER = ['Tools', 'Constrain', 'Edit', 'Sketch', 'Drawing', 'View'];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-shortcuts-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-shortcuts-styles';
  s.textContent = `
.sk-shortcuts { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.sk-shortcuts-top { display: flex; gap: 6px; align-items: center; min-width: 0; }
.sk-shortcuts-filter { flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 4px 6px; border-radius: 4px; background: transparent; color: inherit;
  border: 1px solid var(--sk-style-sep, #cbd5e1); font: inherit; }
.sk-shortcuts-btn { flex: 0 0 auto; padding: 3px 8px; border-radius: 6px; cursor: pointer; background: transparent; color: inherit; font: inherit;
  border: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-shortcuts-btn:disabled { opacity: 0.45; cursor: default; }
.sk-shortcuts-btn-primary { background: var(--sk-selection, #3B82F6); color: #fff; border-color: transparent; }
.sk-shortcuts-confirm { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--sk-style-sep, #cbd5e1); border-radius: 6px; }
.sk-shortcuts-confirm-btns, .sk-shortcut-choices { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.sk-shortcuts-group { display: flex; flex-direction: column; gap: 4px; }
.sk-shortcuts-group[hidden], .sk-shortcut-row[hidden], .sk-shortcuts-empty[hidden], .sk-shortcuts-confirm[hidden], .sk-shortcut-row [hidden] { display: none; }
.sk-shortcuts-head { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--sk-style-muted, #64748b); }
.sk-shortcut-row { display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; row-gap: 4px; min-width: 0; padding-left: 4px;
  border-left: 3px solid transparent; }
.sk-shortcut-row.sk-shortcut-changed { border-left-color: var(--sk-selection, #3B82F6); }
.sk-shortcut-keys { flex: 0 0 auto; min-width: 72px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 2px 4px; margin: 0;
  border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; }
button.sk-shortcut-keys { cursor: pointer; border-color: var(--sk-style-sep, #cbd5e1); border-style: dashed; }
button.sk-shortcut-keys:hover { background: var(--sk-style-key-bg, rgba(127,127,127,0.08)); }
.sk-shortcut-changed button.sk-shortcut-keys { border-style: solid; border-color: var(--sk-selection, #3B82F6); }
.sk-shortcut-capturing button.sk-shortcut-keys { border-style: solid; border-color: var(--sk-selection, #3B82F6); box-shadow: 0 0 0 2px var(--sk-selection, #3B82F6) inset; }
.sk-shortcut-keys kbd { display: inline-block; min-width: 18px; padding: 1px 5px; text-align: center; border-radius: 4px; font: 600 11px/16px system-ui, sans-serif;
  border: 1px solid var(--sk-style-sep, #cbd5e1); border-bottom-width: 2px; background: var(--sk-style-key-bg, rgba(127,127,127,0.08)); }
.sk-shortcut-changed .sk-shortcut-keys kbd { color: var(--sk-selection, #3B82F6); border-color: var(--sk-selection, #3B82F6); }
.sk-shortcut-none, .sk-shortcut-wait { color: var(--sk-style-muted, #64748b); font-style: italic; }
.sk-shortcut-or { color: var(--sk-style-muted, #64748b); padding: 0 2px; }
.sk-shortcut-label { flex: 1 1 0; min-width: 0; overflow-wrap: anywhere; }
.sk-shortcut-note, .sk-shortcut-why { color: var(--sk-style-muted, #94a3b8); font-size: 11px; }
.sk-shortcut-why { flex: 1 0 100%; }
.sk-shortcut-act { flex: 0 0 auto; padding: 1px 6px; border-radius: 6px; cursor: pointer; background: transparent; color: inherit; font: inherit;
  border: 1px solid var(--sk-style-sep, #cbd5e1); }
.sk-shortcut-msg { flex: 1 0 100%; display: flex; flex-direction: column; gap: 4px; padding: 4px 6px; border-radius: 6px;
  background: var(--sk-style-key-bg, rgba(127,127,127,0.08)); }
.sk-shortcut-msg[data-kind="refused"], .sk-shortcut-msg[data-kind="conflict"] { color: var(--sk-style-warn, #b45309); }
.sk-shortcuts-empty { color: var(--sk-style-muted, #64748b); }
@media (pointer: coarse) {
  .sk-shortcuts-filter { min-height: 44px; font-size: 14px; }
  .sk-shortcut-row { font-size: 14px; }
  .sk-shortcuts-btn, .sk-shortcut-act, .sk-shortcut-keys { min-height: 44px; min-width: 44px; font-size: 14px; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const button = (cls, text, onClick) => { const b = make('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

export function createShortcutsList({ hostId, mac = isMacPlatform() } = {}) {
  injectStyles();
  const root = make('div', 'sk-shortcuts');
  const keysText = (keys) => keys.map((c) => comboText(c, { mac })).join(' / ');
  // a shortcut of another app only (Shaper's Group seen from SketchStudio) is named with its app
  const nameOf = (id) => { const s = defaultShortcut(id); return s.hosts.includes(hostId) ? s.label : `${s.label} (${s.hosts.map((h) => (appById(h) || { name: h }).name).join(', ')})`; };

  // ── the top: filter + Reset all (an inline confirm, no browser confirm()) ──
  const top = make('div', 'sk-shortcuts-top');
  const filter = make('input', 'sk-shortcuts-filter'); filter.type = 'search';
  filter.placeholder = 'Filter'; filter.setAttribute('aria-label', 'Filter shortcuts');
  const confirm = make('div', 'sk-shortcuts-confirm'); confirm.hidden = true; confirm.setAttribute('role', 'alertdialog');
  confirm.appendChild(make('span', null, 'Put every shortcut back to its default key (in all four apps)?'));
  const confirmBtns = make('div', 'sk-shortcuts-confirm-btns');
  const resetAllBtn = button('sk-shortcuts-btn sk-shortcuts-resetall', 'Reset all shortcuts', () => { endEdits(); confirm.hidden = false; confirmOk.focus(); });
  const confirmOk = button('sk-shortcuts-btn sk-shortcuts-btn-primary sk-shortcuts-confirm-ok', 'Reset all', () => { confirm.hidden = true; resetAllShortcuts(); resetAllBtn.focus(); });
  confirmBtns.append(button('sk-shortcuts-btn sk-shortcuts-confirm-cancel', 'Cancel', () => { confirm.hidden = true; resetAllBtn.focus(); }), confirmOk);
  confirm.appendChild(confirmBtns);
  top.append(filter, resetAllBtn);
  root.append(top, confirm);

  // ── the rows ──
  const rows = []; // { id, row, group, keysEl, clearBtn?, resetBtn?, msg?, text, state: null | 'capture' | 'conflict', pending, refused }
  const groups = new Map();
  const list = shortcutsForHost(hostId);
  const order = [...GROUP_ORDER, ...new Set(list.map((s) => s.group).filter((g) => !GROUP_ORDER.includes(g)))];
  for (const g of order) {
    const items = list.filter((s) => s.group === g);
    if (!items.length) continue;
    const sec = make('section', 'sk-shortcuts-group'); sec.dataset.group = g;
    sec.appendChild(make('h4', 'sk-shortcuts-head', g));
    for (const s of items) {
      const row = make('div', 'sk-shortcut-row'); row.dataset.id = s.id;
      const r = { id: s.id, row, group: g, text: '', state: null, pending: null, refused: null };
      r.keysEl = s.fixed ? make('span', 'sk-shortcut-keys sk-shortcut-fixed') : button('sk-shortcut-keys', undefined, () => (r.state === 'capture' ? endEdits() : startCapture(r)));
      if (s.fixed) r.keysEl.title = 'Cannot be changed: ' + s.fixed;
      const label = make('span', 'sk-shortcut-label', s.label);
      if (s.note) label.appendChild(make('span', 'sk-shortcut-note', ' ' + s.note));
      row.append(r.keysEl, label);
      if (s.fixed) row.appendChild(make('span', 'sk-shortcut-why', 'Fixed: ' + s.fixed));
      else {
        r.clearBtn = button('sk-shortcut-act sk-shortcut-clear', '×', () => { endEdits(); unassignShortcut(s.id); track('shortcut-changed'); });
        r.clearBtn.title = 'No key'; r.clearBtn.setAttribute('aria-label', `Remove the key of ${s.label}`);
        r.resetBtn = button('sk-shortcut-act sk-shortcut-reset', 'Reset', () => {
          endEdits();
          const res = resetShortcut(s.id);
          if (res.conflicts) { r.state = 'conflict'; r.pending = { keys: res.keys, conflicts: res.conflicts }; paint(r); } // another shortcut took the default since
        });
        r.msg = make('div', 'sk-shortcut-msg'); r.msg.setAttribute('role', 'status'); r.msg.hidden = true;
        row.append(r.clearBtn, r.resetBtn, r.msg);
      }
      sec.appendChild(row);
      rows.push(r);
    }
    groups.set(g, sec);
    root.appendChild(sec);
  }
  const empty = make('div', 'sk-shortcuts-empty', 'No shortcut matches.'); empty.hidden = true;
  root.appendChild(empty);

  function paintKeys(r, keys) {
    const parts = [];
    keys.forEach((c, i) => {
      if (i) parts.push(make('span', 'sk-shortcut-or', '/'));
      comboCaps(c, { mac }).forEach((cap, j) => { if (j) parts.push(document.createTextNode(comboIsChord(c) ? '+' : ' ')); parts.push(make('kbd', null, cap)); });
    });
    r.keysEl.replaceChildren(...(r.state === 'capture' ? [make('span', 'sk-shortcut-wait', 'press a key…')] : parts.length ? parts : [make('span', 'sk-shortcut-none', 'none')]));
  }
  function paintMsg(r) {
    const m = r.msg; m.replaceChildren(); m.hidden = !r.state; delete m.dataset.kind;
    if (r.state === 'capture') {
      m.dataset.kind = r.refused ? 'refused' : 'wait';
      m.appendChild(make('span', null, r.refused ? `${r.refused.text} cannot be a shortcut: it ${r.refused.reason}. Press another key (Esc cancels).`
        : `Press the new key for ${defaultShortcut(r.id).label} (Esc cancels).`));
    } else if (r.state === 'conflict') {
      const { keys, conflicts } = r.pending;
      const wanted = keysText(keys);
      const others = conflicts.map(nameOf);
      const swappable = conflicts.length === 1 && !defaultShortcut(conflicts[0]).fixed;
      m.dataset.kind = 'conflict';
      m.appendChild(make('span', 'sk-shortcut-conflict', `${wanted} is used by ${others.join(' and ')}`
        + (swappable || conflicts.length > 1 ? '.' : ', which cannot be changed.')));
      const choices = make('div', 'sk-shortcut-choices');
      if (swappable) {
        const old = keysText(shortcutById(r.id).keys);
        const swap = button('sk-shortcuts-btn sk-shortcuts-btn-primary sk-shortcut-swap', 'Swap', () => {
          const p = r.pending; endEdits(); swapShortcut(r.id, p.keys, p.conflicts[0]); track('shortcut-changed'); r.keysEl.focus();
        });
        swap.title = `${defaultShortcut(r.id).label} gets ${wanted}; ${others[0]} gets ${old || 'no key'}`;
        choices.appendChild(swap);
      }
      choices.appendChild(button('sk-shortcuts-btn sk-shortcut-cancel', 'Cancel', () => { endEdits(); r.keysEl.focus(); }));
      m.appendChild(choices);
    }
  }
  function paint(r) {
    const s = shortcutById(r.id);
    const changed = isShortcutChanged(r.id);
    r.row.classList.toggle('sk-shortcut-changed', changed);
    r.row.classList.toggle('sk-shortcut-capturing', r.state === 'capture');
    paintKeys(r, s.keys);
    const now = keysText(s.keys);
    r.text = (now + ' ' + s.label).toLowerCase();
    if (!r.msg) return; // a fixed row
    r.keysEl.setAttribute('aria-label', `${s.label}: ${now || 'no key'}. Change the key`);
    r.keysEl.title = changed ? `Changed (default ${keysText(defaultShortcut(r.id).keys)}). Click, then press the new key` : 'Click, then press the new key';
    r.clearBtn.hidden = !s.keys.length;
    r.resetBtn.hidden = !changed;
    r.resetBtn.title = `Back to ${keysText(defaultShortcut(r.id).keys)}`; r.resetBtn.setAttribute('aria-label', `${r.resetBtn.title} (${s.label})`);
    paintMsg(r);
  }
  function paintAll() {
    rows.forEach(paint);
    resetAllBtn.disabled = !SHORTCUTS.some((s) => isShortcutChanged(s.id));
    setFilter(filter.value);
  }

  // ── capturing a key: while a row waits, every key goes here first (the window, capture phase) and no shortcut matches (setShortcutCapture) ──
  let capture = null; // { r }
  const onKey = (e) => {
    e.preventDefault(); e.stopImmediatePropagation();
    const combo = comboFromEvent(e);
    if (!combo) return; // a modifier alone: wait for the key
    const r = capture.r;
    if (combo.cancel) { swallowRelease(e.code); endEdits(); r.keysEl.focus(); return; }
    const res = assignShortcut(r.id, combo);
    if (res.refused) { r.refused = { text: comboText(combo, { mac }), reason: res.refused }; paint(r); return; } // keeps waiting for another key
    swallowRelease(e.code);
    stopCapture();
    if (res.conflicts) { r.state = 'conflict'; r.pending = { keys: res.keys, conflicts: res.conflicts }; paint(r); return; }
    r.state = null; paint(r); r.keysEl.focus();
    if (res.done) track('shortcut-changed');
  };
  const onPress = (e) => { if (capture && !capture.r.row.contains(e.target)) endEdits(); }; // a click elsewhere cancels
  const onBlur = () => endEdits(); // the window lost the focus: no key can come, cancel
  // the captured key's release belongs to the capture too (a Space / Enter release would otherwise press the focused key button again)
  function swallowRelease(code) {
    const up = (e) => { if (e.code !== code) return; e.preventDefault(); e.stopImmediatePropagation(); window.removeEventListener('keyup', up, true); };
    window.addEventListener('keyup', up, true);
  }
  function startCapture(r) {
    endEdits();
    r.state = 'capture'; r.refused = null;
    capture = { r };
    setShortcutCapture(true);
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    window.addEventListener('blur', onBlur);
    paint(r);
  }
  function stopCapture() {
    if (!capture) return;
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPress, true);
    window.removeEventListener('blur', onBlur);
    setShortcutCapture(false);
    capture = null;
  }
  /** Ends a capture and an open conflict question (nothing changes). */
  function endEdits() {
    stopCapture();
    for (const r of rows) if (r.state) { r.state = null; r.pending = null; r.refused = null; paint(r); }
  }

  function setFilter(text) {
    const q = String(text || '').trim().toLowerCase();
    let shown = 0;
    for (const r of rows) { r.row.hidden = !!q && !r.text.includes(q); if (!r.row.hidden) shown++; }
    for (const [g, sec] of groups) sec.hidden = !rows.some((r) => r.group === g && !r.row.hidden);
    empty.hidden = shown > 0;
  }
  filter.addEventListener('input', () => setFilter(filter.value));

  const off = onShortcutsChange(paintAll); // an edit here, a Swap's other row, Reset all, a settings reload: every row follows at once
  paintAll();
  return { el: root, setFilter, destroy: () => { endEdits(); off(); root.remove(); } };
}
