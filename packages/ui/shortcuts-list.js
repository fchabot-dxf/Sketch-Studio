// packages/ui/shortcuts-list.js: the Settings > Shortcuts tab (TASK 727). A plain, read-only list of the showing app's keyboard shortcuts,
// read from THE declaration (shortcuts.js): key caps + the action name, under short headings, with a filter box. Cmd instead of Ctrl on a Mac.
// createShortcutsList({ hostId, mac }) -> { el, setFilter(text) }

import { shortcutsForHost, comboCaps, comboIsChord, isMacPlatform } from '#ui/shortcuts.js';

const GROUP_ORDER = ['Tools', 'Constrain', 'Edit', 'Sketch', 'Drawing', 'View'];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-shortcuts-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-shortcuts-styles';
  s.textContent = `
.sk-shortcuts { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.sk-shortcuts-filter { width: 100%; box-sizing: border-box; padding: 4px 6px; border-radius: 4px; background: transparent; color: inherit;
  border: 1px solid var(--sk-style-sep, #cbd5e1); font: inherit; }
.sk-shortcuts-group { display: flex; flex-direction: column; gap: 4px; }
.sk-shortcuts-group[hidden], .sk-shortcut-row[hidden], .sk-shortcuts-empty[hidden] { display: none; }
.sk-shortcuts-head { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--sk-style-muted, #64748b); }
.sk-shortcut-row { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.sk-shortcut-keys { flex: 0 0 auto; min-width: 72px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.sk-shortcut-keys kbd { display: inline-block; min-width: 18px; padding: 1px 5px; text-align: center; border-radius: 4px; font: 600 11px/16px system-ui, sans-serif;
  border: 1px solid var(--sk-style-sep, #cbd5e1); border-bottom-width: 2px; background: var(--sk-style-key-bg, rgba(127,127,127,0.08)); }
.sk-shortcut-or { color: var(--sk-style-muted, #64748b); padding: 0 2px; }
.sk-shortcut-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.sk-shortcut-note { color: var(--sk-style-muted, #94a3b8); font-size: 11px; }
.sk-shortcuts-empty { color: var(--sk-style-muted, #64748b); }
@media (pointer: coarse) { .sk-shortcuts-filter { min-height: 44px; font-size: 14px; } .sk-shortcut-row { font-size: 14px; } }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function createShortcutsList({ hostId, mac = isMacPlatform() } = {}) {
  injectStyles();
  const el = document.createElement('div'); el.className = 'sk-shortcuts';
  const filter = document.createElement('input'); filter.type = 'search'; filter.className = 'sk-shortcuts-filter';
  filter.placeholder = 'Filter'; filter.setAttribute('aria-label', 'Filter shortcuts');
  el.appendChild(filter);

  const rows = []; // { row, text, group }
  const groups = new Map();
  const list = shortcutsForHost(hostId);
  const order = [...GROUP_ORDER, ...new Set(list.map((s) => s.group).filter((g) => !GROUP_ORDER.includes(g)))];
  for (const g of order) {
    const items = list.filter((s) => s.group === g);
    if (!items.length) continue;
    const sec = document.createElement('section'); sec.className = 'sk-shortcuts-group'; sec.dataset.group = g;
    const h = document.createElement('h4'); h.className = 'sk-shortcuts-head'; h.textContent = g;
    sec.appendChild(h);
    for (const s of items) {
      const row = document.createElement('div'); row.className = 'sk-shortcut-row'; row.dataset.id = s.id;
      const keys = document.createElement('span'); keys.className = 'sk-shortcut-keys';
      const capsText = [];
      s.keys.forEach((c, i) => {
        if (i) { const or = document.createElement('span'); or.className = 'sk-shortcut-or'; or.textContent = '/'; keys.appendChild(or); }
        const caps = comboCaps(c, { mac });
        caps.forEach((cap, j) => {
          if (j) keys.appendChild(document.createTextNode(comboIsChord(c) ? '+' : ' '));
          const k = document.createElement('kbd'); k.textContent = cap; keys.appendChild(k);
        });
        capsText.push(caps.join(comboIsChord(c) ? '+' : ' '));
      });
      const label = document.createElement('span'); label.className = 'sk-shortcut-label'; label.textContent = s.label;
      if (s.note) { const n = document.createElement('span'); n.className = 'sk-shortcut-note'; n.textContent = ' ' + s.note; label.appendChild(n); }
      row.append(keys, label);
      sec.appendChild(row);
      rows.push({ row, group: g, text: (capsText.join(' ') + ' ' + s.label).toLowerCase() });
    }
    groups.set(g, sec);
    el.appendChild(sec);
  }
  const empty = document.createElement('div'); empty.className = 'sk-shortcuts-empty'; empty.textContent = 'No shortcut matches.'; empty.hidden = true;
  el.appendChild(empty);

  function setFilter(text) {
    const q = String(text || '').trim().toLowerCase();
    let shown = 0;
    for (const r of rows) { r.row.hidden = !!q && !r.text.includes(q); if (!r.row.hidden) shown++; }
    for (const [g, sec] of groups) sec.hidden = !rows.some((r) => r.group === g && !r.row.hidden);
    empty.hidden = shown > 0;
  }
  filter.addEventListener('input', () => setFilter(filter.value));
  return { el, setFilter };
}
