// packages/ui/context-menu.js — the ONE shared right-click menu (task 493): a small floating list, themed through
// the --sk-* tokens like the sidebar. showContextMenu() is the component; contextMenuItems() is the declared item
// list per target kind (dimension / geometry). Hosts never build their own copy: input-manager.js picks the target
// and passes the existing actions in, so every entry runs the same function as its key / ribbon twin.

import { CONSTRAINT_TYPES } from '#core/constants.js';

const STYLE_ID = 'sk-context-menu-styles';
const CSS = `
.sk-context-menu { position: fixed; z-index: 100000; min-width: 190px; padding: 4px 0; outline: none; user-select: none;
  background: var(--sk-sidebar-bg, var(--sk-header-bg, #fff)); color: var(--sk-sidebar-fg, var(--sk-header-fg, #1e293b));
  border: 1px solid var(--sk-sidebar-sep, rgba(127,127,127,0.35)); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.25);
  font: 600 12px system-ui, sans-serif; }
.sk-context-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
.sk-context-item.active:not(.disabled), .sk-context-item:hover:not(.disabled) { background: var(--sk-sidebar-hover, rgba(127,127,127,0.18)); }
.sk-context-item.disabled { opacity: 0.45; cursor: not-allowed; }
.sk-context-check { width: 14px; flex: 0 0 14px; text-align: center; color: var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); }
.sk-context-menu.touch { min-width: 220px; font-size: 14px; }
.sk-context-menu.touch .sk-context-item { min-height: 44px; padding: 0 16px; }
.sk-context-sub { z-index: 100001; }
.sk-context-arrow { margin-left: auto; padding-left: 14px; opacity: 0.7; }
.sk-context-reason { margin-left: auto; padding-left: 12px; font-weight: 500; opacity: 0.8; }
`;

let current = null; // { el, close }

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; document.head.appendChild(s);
}

export function closeContextMenu() { if (current) current.close(); }
export function isContextMenuOpen() { return !!current; }

// TASK 562: how far from a FINGER the menu opens (px): the pressed item stays visible beside it.
const TOUCH_GAP = 40;
const isCoarsePointer = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/**
 * showContextMenu({ x, y, items:[{ id, label, checked?, disabled?, reason?, onSelect }], returnFocusTo?, touch? })
 * Closes on Escape, an outside click, a selection, or a scroll / zoom. Arrows move, Enter selects.
 * touch (a finger opened it: the long-press, or any coarse-pointer device): rows are >= 44 px tall and the menu opens BESIDE the point
 * (right of it, else left, else below / above it) instead of with its corner on it, so the finger does not cover the menu or the pressed item.
 */
export function showContextMenu({ x, y, items, returnFocusTo = null, touch = false }) {
  closeContextMenu();
  injectStyles();
  const el = document.createElement('div');
  const fingers = !!touch || isCoarsePointer();
  el.className = 'sk-context-menu' + (fingers ? ' touch' : ''); el.setAttribute('role', 'menu'); el.tabIndex = -1;
  let active = -1;
  const rows = items.map((it, i) => {
    const row = document.createElement('div');
    row.className = 'sk-context-item' + (it.disabled ? ' disabled' : '');
    row.dataset.id = it.id; row.setAttribute('role', it.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (it.checked !== undefined) row.setAttribute('aria-checked', String(!!it.checked));
    if (it.disabled) row.setAttribute('aria-disabled', 'true');
    const check = document.createElement('span'); check.className = 'sk-context-check'; check.textContent = it.checked ? '✓' : '';
    const label = document.createElement('span'); label.textContent = it.label;
    row.append(check, label);
    if (it.submenu) { const ar = document.createElement('span'); ar.className = 'sk-context-arrow'; ar.textContent = '▸'; row.append(ar); row.setAttribute('aria-haspopup', 'menu'); }
    if (it.disabled && it.reason) { const r = document.createElement('span'); r.className = 'sk-context-reason'; r.textContent = it.reason; row.append(r); }
    row.addEventListener('pointermove', () => { setActive(i); if (it.submenu) openSub(i); else closeSub(); });
    row.addEventListener('click', (ev) => { ev.stopPropagation(); if (it.submenu) openSub(i); else choose(i); });
    el.appendChild(row);
    return row;
  });
  function setActive(i) { active = i; rows.forEach((r, k) => r.classList.toggle('active', k === i)); }
  // TASK 577: a row with `submenu: [items]` opens a flyout beside it (hover, click or ArrowRight); the flyout's rows are ordinary rows.
  let sub = null; // { el, rows, items, active, owner }
  function closeSub() { if (sub) { sub.el.remove(); sub = null; } }
  function openSub(i) {
    const it = items[i];
    if (!it || it.disabled || !it.submenu) return;
    if (sub && sub.owner === i) return;
    closeSub();
    const sel = document.createElement('div');
    sel.className = 'sk-context-menu sk-context-sub' + (fingers ? ' touch' : ''); sel.setAttribute('role', 'menu');
    const s = { el: sel, items: it.submenu, rows: [], active: -1, owner: i };
    it.submenu.forEach((si, k) => {
      const row = document.createElement('div'); row.className = 'sk-context-item' + (si.disabled ? ' disabled' : '');
      row.dataset.id = si.id; row.setAttribute('role', 'menuitem'); if (si.disabled) row.setAttribute('aria-disabled', 'true');
      const check = document.createElement('span'); check.className = 'sk-context-check'; check.textContent = si.checked ? '✓' : '';
      const label = document.createElement('span'); label.textContent = si.label; row.append(check, label);
      if (si.disabled && si.reason) { const r = document.createElement('span'); r.className = 'sk-context-reason'; r.textContent = si.reason; row.append(r); }
      row.addEventListener('pointermove', () => setSubActive(k));
      row.addEventListener('click', (ev) => { ev.stopPropagation(); chooseSub(k); });
      sel.appendChild(row); s.rows.push(row);
    });
    sel.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(sel);
    const pr = rows[i].getBoundingClientRect(), w = sel.offsetWidth, h = sel.offsetHeight;
    const left = pr.right + w + 4 <= window.innerWidth ? pr.right : Math.max(0, pr.left - w);
    sel.style.left = left + 'px'; sel.style.top = Math.max(0, Math.min(pr.top, window.innerHeight - h - 4)) + 'px';
    sub = s;
  }
  function setSubActive(k) { if (!sub) return; sub.active = k; sub.rows.forEach((r, n) => r.classList.toggle('active', n === k)); }
  function chooseSub(k) { const si = sub && sub.items[k]; if (!si || si.disabled) return; close(); si.onSelect(); }
  function stepSub(dir) {
    if (!sub || !sub.items.some((x) => !x.disabled)) return;
    let k = sub.active; do { k = (k + dir + sub.items.length) % sub.items.length; } while (sub.items[k].disabled); setSubActive(k);
  }
  function choose(i) {
    const it = items[i];
    if (!it || it.disabled) return;
    if (it.submenu) { openSub(i); stepSub(1); return; }
    close();
    it.onSelect();
  }
  function step(dir) {
    if (!items.some(it => !it.disabled)) return;
    let i = active;
    do { i = (i + dir + items.length) % items.length; } while (items[i].disabled);
    setActive(i);
  }
  const onKey = (e) => {
    if (sub && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'ArrowLeft' || e.key === 'Escape')) {
      if (e.key === 'ArrowDown') stepSub(1); else if (e.key === 'ArrowUp') stepSub(-1); else if (e.key === 'Enter') chooseSub(sub.active); else closeSub();
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (e.key === 'ArrowRight' && items[active] && items[active].submenu) { openSub(active); stepSub(1); e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'Enter') choose(active);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const onOutside = (e) => { if (!el.contains(e.target) && !(sub && sub.el.contains(e.target))) close(); };
  const onPanZoom = () => close();
  function close() {
    if (current && current.el === el) current = null;
    closeSub();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('wheel', onPanZoom, true);
    document.removeEventListener('scroll', onPanZoom, true);
    document.removeEventListener('panzoom:viewportChanged', onPanZoom);
    window.removeEventListener('resize', onPanZoom);
    el.remove();
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') returnFocusTo.focus({ preventScroll: true });
  }
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = x, top = y;
  if (fingers) {
    // beside the finger, never under it: right of it, else left of it, else (a phone: the finger is mid-screen) above or below it
    if (x + TOUCH_GAP + w + 4 <= window.innerWidth) { left = x + TOUCH_GAP; top = y - h / 2; }
    else if (x - TOUCH_GAP - w >= 0) { left = x - TOUCH_GAP - w; top = y - h / 2; }
    else { left = x - w / 2; top = y + TOUCH_GAP + h + 4 <= window.innerHeight ? y + TOUCH_GAP : y - TOUCH_GAP - h; }
  }
  el.style.left = Math.max(0, Math.min(left, window.innerWidth - w - 4)) + 'px';
  el.style.top = Math.max(0, Math.min(top, window.innerHeight - h - 4)) + 'px';
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('wheel', onPanZoom, true);
  document.addEventListener('scroll', onPanZoom, true);
  document.addEventListener('panzoom:viewportChanged', onPanZoom);
  window.addEventListener('resize', onPanZoom);
  el.focus({ preventScroll: true });
  current = { el, close };
  return el;
}

// The constraints whose GLYPH opens the 'constraint' menu (its Delete): every geometric constraint. (A distance / angle is a dimension:
// its own menu.) Task 571: the glyph wins the right-click over the geometry under it, so a geometric glyph must always open a menu.
export const CONSTRAINT_MENU_TYPES = Object.freeze(Object.values(CONSTRAINT_TYPES).filter(t => t !== CONSTRAINT_TYPES.DISTANCE && t !== CONSTRAINT_TYPES.ANGLE));

// TASK 577: "Move to sketch ▸" is ONE row with a submenu: every sketch (a locked one, and the one the selection is already in, greyed out
// with its reason) plus "New sketch…" (the selection moves into a new sketch). Only when the document has 2+ sketches.
function sketchSubmenu(actions) {
  const targets = actions.sketchTargets();
  if (!targets.length) return [];
  return [{ id: 'geo-move', label: 'Move to sketch', submenu: [
    ...targets.map((sk) => ({ id: 'geo-move-' + sk.id, label: sk.name, disabled: !!sk.disabled, reason: sk.reason, onSelect: () => actions.moveToSketch(sk.id) })),
    { id: 'geo-move-new', label: 'New sketch…', onSelect: () => actions.moveToNewSketch() },
  ] }];
}

/**
 * The declared item list per target kind. `actions` are the EXISTING functions (see input-manager.js):
 *   toggleDriving(constraint) — toggleDriving + its notifications; deleteSelection(); toggleLock(); lockState() → { locked };
 *   sketchTargets() → every sketch with { disabled, reason } for a locked one / the selection's own, moveToSketch(id), moveToNewSketch() (TASK 577).
 */
export function contextMenuItems(kind, { target, actions }) {
  if (kind === 'dimension') {
    const driven = !!(target.constraint.isDriven || target.constraint.driven);
    return [
      { id: 'dim-driving', label: 'Driving dimension', checked: !driven, onSelect: () => { if (driven) actions.toggleDriving(target.constraint); } },
      { id: 'dim-reference', label: 'Reference dimension', checked: driven, onSelect: () => { if (!driven) actions.toggleDriving(target.constraint); } },
      { id: 'dim-delete', label: 'Delete dimension', onSelect: () => actions.deleteSelection() },
    ];
  }
  if (kind === 'constraint') {
    return [
      { id: 'con-delete', label: 'Delete constraint', onSelect: () => actions.deleteSelection() },
    ];
  }
  if (kind === 'geometry') {
    const locked = actions.lockState().locked;
    return [
      { id: 'geo-lock', label: locked ? 'Unlock' : 'Lock', checked: locked, onSelect: () => actions.toggleLock() },
      { id: 'geo-delete', label: 'Delete', onSelect: () => actions.deleteSelection() },
      // TASK 577: sketches as layers: one entry per sketch the selection can move to (a flat list: the menu has no submenus)
      ...(actions.sketchTargets ? sketchSubmenu(actions) : []),
    ];
  }
  return [];
}
