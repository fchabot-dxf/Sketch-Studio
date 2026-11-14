// packages/ui/tool-ribbon.js — the shared, SketchStudio-style tool ribbon (S7a).
// Grouped, icon-over-label tool buttons over the SHARED sketch: Create / Inspect / Constrain. App-agnostic
// chrome — each button wires to the SAME shared tool-switch (switchToTool) the keyboard + the simple palette use,
// so the on-canvas behaviour is unchanged. A host appends its OWN app-specific groups (Edit / Actions / …) via
// `extraGroups`, and `on` surfaces button events. Themed via --sk-* (light defaults → SketchStudio; a dark :root
// → Shaper) from the SAME component. Self-contained: injects its <style> once + inject-IF-MISSING icon symbols
// (reuses cursor-manager's ICONS, the single source of truth) so #icon-* resolve in any host.

import { switchToTool, toggleFixedSelection, selectionLockState } from '#ui/input-manager.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { TOOL_MODES, RECT_MODES } from '#core/constants.js';
import { doCombine, doUncombine } from '#ui/profile-actions.js';
import { createParametersWindow } from '#ui/parameters-window.js';
import { beginMirror } from '#ui/input-handlers/mirror-tool.js';
import { SHORT_VIEWPORT_QUERY, isShortViewport } from '#ui/short-viewport.js';

// The SHARED sketcher groups (icon = cursor-manager symbol id; label = the SketchStudio button label).
const CREATE = [
  { tool: TOOL_MODES.SELECT, icon: 'icon-tool-select',  label: 'Select' },
  { tool: TOOL_MODES.LINE,   icon: 'icon-tool-line',    label: 'Line' },
  { tool: TOOL_MODES.RECT,   icon: 'icon-tool-rect-2pt', label: 'Rect', rectDropdown: true },
  { tool: TOOL_MODES.CIRCLE, icon: 'icon-tool-circle',  label: 'Circle' },
  { tool: TOOL_MODES.POLYGON, icon: 'icon-tool-polygon', label: 'Polygon' }, // TASK 483: regular polygon; TASK 596: its side count is an on-canvas box after the centre click
  { tool: TOOL_MODES.ARC,    icon: 'icon-tool-arc-cse', label: 'Arc' }, // single-mode in the source (no dropdown)
  { tool: TOOL_MODES.BEZIER, icon: 'icon-tool-bezier',  label: 'Bezier' }, // UNIFY-3-tool: shared pen tool (all apps)
  // TASK 585: like Fusion's Create > Mirror (owner: "always the create menu"). `begin` runs when the button starts the tool (the pre-selection).
  { tool: TOOL_MODES.MIRROR, icon: 'icon-tool-mirror',  label: 'Mirror', title: 'Mirror: the objects, then the mirror line, then Enter', begin: beginMirror },
];
// TRACE-1: Edit/modify tools — trim + break. No cursor-manager symbols yet; icons provided as SVG inline.
const EDIT = [
  { tool: TOOL_MODES.TRIM,  iconSvg: '<path d="M4 12h6M14 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="#ef4444"/>', label: 'Trim' },
  { tool: TOOL_MODES.BREAK, iconSvg: '<path d="M5 12h5M14 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" stroke="#fbbf24" stroke-width="2" fill="none"/>', label: 'Break' },
  { tool: TOOL_MODES.FILLET, iconSvg: '<path d="M5 19V12a7 7 0 0 1 7-7h7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M5 12V5h7" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="2 2" fill="none"/>', label: 'Fillet' },
];

// Profile actions (COMBINE / UNCOMBINE): opt-in for hosts declaring profiles: true
const PROFILE_ACTIONS = [
  { action: 'combine', id: 'btn-combine', iconSvg: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="8.5" y="8.5" width="7" height="7" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.5" fill="none"/>', label: 'Combine', title: 'Combine Shapes (Ctrl+Shift+C)' },
  { action: 'uncombine', id: 'btn-uncombine', iconSvg: '<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2" fill="none"/><rect x="8.5" y="8.5" width="7" height="7" stroke="currentColor" stroke-width="1.4" fill="none"/>', label: 'Uncomb', title: 'Uncombine Profile (Ctrl+Shift+U)' },
];
const INSPECT = [
  { tool: TOOL_MODES.DIMENSION, icon: 'icon-tool-dim', label: 'Dim' },
];
// TASK 535-4: the Parameters window opener. Default ON for every host of the Design tab (ONE declaration); a host opts OUT with
// createToolRibbon({ parameters: false }) (Trace, decision O14).
const PARAMETERS = { action: 'parameters', id: 'btn-parameters', iconSvg: '<text x="12" y="16.5" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="13" fill="currentColor" stroke="none">fx</text>', label: 'Params', title: 'Parameters (fx)', ariaLabel: 'Parameters', popup: true };
const CONSTRAIN = [
  { tool: TOOL_MODES.COINCIDENT,          icon: 'icon-coincident',   label: 'Coinc' },
  { tool: TOOL_MODES.HORIZONTAL_VERTICAL, icon: 'icon-hv',           label: 'H/V' },
  { tool: TOOL_MODES.PARALLEL,            icon: 'icon-parallel',     label: 'Para' },
  { tool: TOOL_MODES.PERPENDICULAR,       icon: 'icon-perpendicular', label: 'Perp' },
  { tool: TOOL_MODES.COLLINEAR,           icon: 'icon-collinear',    label: 'Coll' },
  { tool: TOOL_MODES.TANGENT,             icon: 'icon-tangent',      label: 'Tang' },
  { tool: TOOL_MODES.EQUAL,               icon: 'icon-equal',        label: 'Equal' },
  { tool: TOOL_MODES.MIDPOINT,            icon: 'icon-midpoint',     label: 'Mid' },
  { tool: TOOL_MODES.SYMMETRIC,           icon: 'icon-symmetric',    label: 'Sym' },   // task 563: entity, entity, then the symmetry line
];
// Lock is an ACTION (not a drawing mode): the same toggleFixedSelection as the F key and the context menu.
const LOCK = { action: 'lock', id: 'btn-lock', icon: 'icon-lock', label: 'Lock', title: 'Lock / Unlock (F)' };
// Rect variants (the dropdown) — sets state.rectMode + swaps the rect button's icon/label, like ui-manager.
const RECT_VARIANTS = [
  { mode: RECT_MODES.TWO_POINT,   icon: 'icon-tool-rect-2pt',    label: '2-Point (Corner)' },
  { mode: RECT_MODES.CENTER,      icon: 'icon-tool-rect-center', label: 'Center Point' },
  { mode: RECT_MODES.THREE_POINT, icon: 'icon-tool-rect-3pt',    label: '3-Point' },
];

// Every #icon-* the ribbon references (for inject-if-missing).
const ICON_IDS = [
  ...CREATE.map(t => t.icon), ...INSPECT.map(t => t.icon), ...CONSTRAIN.map(t => t.icon), LOCK.icon,
  ...RECT_VARIANTS.map(v => v.icon),
];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-ribbon-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-ribbon-styles';
  s.textContent = `
.sk-ribbon { display: flex; align-items: stretch; gap: 4px; background: var(--sk-ribbon-bg, #fff);
  padding: 4px 2px; font: 12px system-ui, sans-serif; box-sizing: border-box;
  overflow-x: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x; scrollbar-width: thin; }
.sk-ribbon * { box-sizing: border-box; }
@media (hover: none) {
  /* Touch devices: hide the scrollbar but keep native horizontal panning/swipe */
  .sk-ribbon { scrollbar-width: none; }
  .sk-ribbon::-webkit-scrollbar { display: none; }
}
.sk-ribbon-group { display: flex; flex-direction: column; align-items: center; padding: 0 8px;
  flex-shrink: 0; border-right: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
.sk-ribbon-group:last-child { border-right: 0; }
.sk-ribbon-btns { display: flex; gap: 2px; }
.sk-ribbon-group-label { font-size: 8px; font-weight: 900; text-transform: uppercase; margin-top: 4px;
  color: var(--sk-ribbon-grouplabel, #cbd5e1); letter-spacing: 0.02em; }
.sk-ribbon-btn { position: relative; display: flex; flex-direction: column; align-items: center;
  justify-content: center; width: 48px; height: 56px; border-radius: 6px; border: 1px solid transparent;
  background: transparent; color: var(--sk-ribbon-fg, inherit); cursor: pointer; transition: all 0.15s;
  user-select: none; -webkit-tap-highlight-color: transparent; }
.sk-ribbon-btn:hover { background: var(--sk-ribbon-hover, #f0f0f0); }
.sk-ribbon-btn:active { transform: scale(0.95); }
.sk-ribbon-btn[aria-haspopup]:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: -2px; } /* the pop-up opener only (TASK 535-4) */
.sk-ribbon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.sk-ribbon-btn:disabled:hover { background: transparent; transform: none; }
.sk-ribbon-btn[aria-pressed="true"] { background: var(--sk-ribbon-hover, #f0f0f0); border-color: var(--sk-ribbon-sep, #cbd5e1);
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.1); }
.sk-ribbon-btn.active { background: var(--sk-selection, #3B82F6); color: #fff;
  border-color: var(--sk-selection-border, #1E40AF); box-shadow: inset 0 2px 4px rgba(0,0,0,0.1); }
.sk-ribbon-btn.active .sk-ribbon-ic { color: #fff; }
.sk-ribbon-ic { width: 18px; height: 18px; display: block; }
.sk-ribbon-lbl { font-size: 8px; font-weight: 900; text-transform: uppercase; margin-top: 4px; white-space: nowrap; }
.sk-ribbon-dd { position: relative; }
.sk-ribbon-dd-ind { position: absolute; bottom: 2px; right: 2px; width: 0; height: 0;
  border-left: 3px solid transparent; border-right: 3px solid transparent;
  border-top: 3px solid var(--sk-ribbon-grouplabel, #94a3b8); }
.sk-ribbon-btn.active .sk-ribbon-dd-ind { border-top-color: #fff; }
.sk-ribbon-menu { display: none; position: fixed; left: 0; top: 0; z-index: 9999; min-width: 160px; overflow-y: auto;
  padding: 4px 0; background: var(--sk-ribbon-menu-bg, #fff); border: 1px solid var(--sk-ribbon-sep, #cbd5e1);
  border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
.sk-ribbon-menu.show { display: block; }
.sk-ribbon-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
  font-size: 11px; font-weight: 600; white-space: nowrap; color: var(--sk-ribbon-fg, inherit); }
.sk-ribbon-menu-item:hover { background: var(--sk-ribbon-hover, #f3f4f6); }
.sk-ribbon-menu-item.active { background: var(--sk-selection, #3B82F6); color: #fff; }
.sk-ribbon-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
/* TASK 562: a finger. Buttons >= 44 px (here 62 x 60), labels >= 12 px, menu rows 44 px. Desktop (a mouse) is untouched. */
@media (pointer: coarse) {
  .sk-ribbon-btn { width: 62px; height: 60px; }
  .sk-ribbon-lbl, .sk-ribbon-group-label { font-size: 12px; font-weight: 700; }
  .sk-ribbon-menu-item { min-height: 44px; font-size: 14px; }
}
/* TASK 562: at phone width an edge fade says the ribbon scrolls: the JS sets data-fade (left / right / both) from the scroll position. */
@media (max-width: 640px) {
  .sk-ribbon[data-fade="right"] { -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%); }
  .sk-ribbon[data-fade="left"] { -webkit-mask-image: linear-gradient(to right, transparent 0, #000 28px); mask-image: linear-gradient(to right, transparent 0, #000 28px); }
  .sk-ribbon[data-fade="both"] { -webkit-mask-image: linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%); }
}
/* TASK 602: a SHORT viewport (a phone in landscape, #ui/short-viewport.js) has width to spare and no height: the ribbon is a vertical ICON RAIL on
   the LEFT of its design frame. render(container) marks the container sk-ribbon-host and the container's parent sk-ribbon-frame (every host's
   Design view: [ribbon container, then the work area]). The frame becomes two columns: the rail, then the work area. Icons only, 48 x 48 buttons; the label stays in the button (visually hidden) so it is
   still the accessible name, and the button's title. The rail scrolls vertically under a finger. Nothing changes outside this query.
   display needs !important: each host styles its frame by id (#design-view { display: flex }), and an id beats any class; :not([hidden])
   keeps a host's own hidden frame hidden. */
@media ${SHORT_VIEWPORT_QUERY} {
  .sk-ribbon-frame:not([hidden]) { display: grid !important; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);
    flex: 1 1 auto; min-height: 0; }
  .sk-ribbon-frame > * { grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; }
  .sk-ribbon-frame > .sk-ribbon-host { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; width: auto; padding: 0;
    overflow: hidden; border-bottom: 0; border-right: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
  .sk-ribbon { flex: 1 1 auto; flex-direction: column; align-items: center; min-height: 0; height: 100%; gap: 0; padding: 2px;
    overflow-x: hidden; overflow-y: auto; touch-action: pan-y; -webkit-mask-image: none; mask-image: none; }
  .sk-ribbon-group { flex-direction: column; padding: 4px 0; border-right: 0; border-bottom: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
  .sk-ribbon-group:last-child { border-bottom: 0; }
  .sk-ribbon-btns { flex-direction: column; }
  .sk-ribbon-group-label { display: none; }
  .sk-ribbon-btn { width: 48px; height: 48px; }
  .sk-ribbon-ic { width: 24px; height: 24px; }
  .sk-ribbon-lbl { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
}
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

function iconSvg(iconId, cls = 'sk-ribbon-ic') {
  // The symbol's content carries its own strokes/fills (incl. red --icon-accent parts); the outer svg supplies
  // the inheriting currentColor. width/height on <use> scales each symbol's own viewBox into the 24-box.
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><use href="#${iconId}" width="24" height="24"/></svg>`;
}

/**
 * createToolRibbon({ state, extraGroups, on, onToolClick }) → { el, render(container), refresh, destroy }
 *   Renders Create + Inspect + Constrain (icon-over-label .sk-ribbon-btn); the rect button gets a 2pt/center/3pt
 *   variant dropdown (sets state.rectMode). refresh() syncs .active to state.currentTool.
 *   extraGroups: [{ label, buttons:[{ icon?|svg?, label?, title?, id?, event?, onClick? }] }] — host-appended.
 *   on(name, detail): optional event hook ('tool' on a tool switch, 'rectMode', 'action' for extra buttons).
 *   parameters (default true): the "fx Parameters" button + its pop-up window in the Inspect group; false = a declared opt-out (Trace).
 *   onToolClick(tool): optional host override — when given, a tool-button click (and a rect-variant select, after
 *     state.rectMode is set) calls THIS instead of the internal switchToTool, so a host (e.g. SketchStudio) routes
 *     tool activation to its OWN rich handler. When absent, the ribbon uses switchToTool (Shaper/standalone path).
 */
export function createToolRibbon({ state, extraGroups = [], on = null, onToolClick = null, profiles = false, parameters = true, notify = null } = {}) {
  injectStyles();
  ensureIconSymbols(ICON_IDS);

  const el = document.createElement('div'); el.className = 'sk-ribbon';
  const toolBtns = []; // { btn, tool } — for active-sync
  const menus = [];    // TASK 607: popovers on document.body, removed in destroy()
  // TASK 535-4: the Parameters window is made on first use; closing it (button, X, Esc) returns focus to its button.
  let paramsWin = null;
  const parametersWindow = () => paramsWin || (paramsWin = createParametersWindow({
    state, anchorEl: el, onClose: () => { refresh(); const b = el.querySelector('#btn-parameters'); if (b) b.focus(); },
  }));

  const fire = (name, detail) => { if (typeof on === 'function') { try { on(name, detail); } catch (_) {} } };
  function selectTool(tool, begin = null) {
    state.closeDrawStep(); // TASK 549: picking a tool in the middle of a draw cancels it (nothing committed: no orphan point, no undo step)
    if (typeof onToolClick === 'function') { try { onToolClick(tool); } catch (_) {} } // host owns activation
    else { try { switchToTool(state, tool); } catch (_) {} }                            // default: shared tool-switch
    if (begin) begin(state); // TASK 585: a tool declared with `begin` (Mirror) starts its pick from the state the switch left
    fire('tool', tool);
    refresh();
  }

  function group(label, frag) {
    const g = document.createElement('div'); g.className = 'sk-ribbon-group';
    const row = document.createElement('div'); row.className = 'sk-ribbon-btns'; row.appendChild(frag);
    const lab = document.createElement('div'); lab.className = 'sk-ribbon-group-label'; lab.textContent = label;
    g.append(row, lab); return g;
  }
  function toolButton(t) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn';
    if (t.id) b.id = t.id;
    else if (t.tool) b.id = 'tool-' + t.tool;
    else if (t.action) b.id = 'action-' + t.action;
    b.title = t.title || t.label;
    if (t.tool) b.dataset.tool = t.tool;
    if (t.action) b.dataset.action = t.action;
    if (t.ariaLabel) b.setAttribute('aria-label', t.ariaLabel);
    if (t.popup) { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-pressed', 'false'); }
    // Support both symbol-id icons (icon) and raw inline SVG paths (iconSvg) for newer tools
    const icon = t.iconSvg
      ? `<svg class="sk-ribbon-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">${t.iconSvg}</svg>`
      : iconSvg(t.icon);
    b.innerHTML = icon + `<span class="sk-ribbon-lbl">${t.label}</span>`;
    b.addEventListener('click', () => {
      if (t.action) {
        if (typeof t.onClick === 'function') t.onClick();
        if (t.action === 'lock') { toggleFixedSelection(state); refresh(); }
        else if (t.action === 'combine') doCombine(state, notify || undefined);
        else if (t.action === 'uncombine') doUncombine(state, notify || undefined);
        else if (t.action === 'parameters') { parametersWindow().toggle(); refresh(); }
        fire('action', { id: b.id, action: t.action });
      } else {
        selectTool(t.tool, t.begin);
      }
    });
    if (t.tool) toolBtns.push({ btn: b, tool: t.tool });
    return b;
  }
  function rectButton(t) {
    const wrap = document.createElement('div'); wrap.className = 'sk-ribbon-dd';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn';
    b.dataset.tool = t.tool; b.title = t.label;
    if (t.tool) b.id = 'tool-' + t.tool;
    b.innerHTML = iconSvg(t.icon) + `<span class="sk-ribbon-lbl">${t.label}</span><span class="sk-ribbon-dd-ind"></span>`;
    const useEl = b.querySelector('use');
    toolBtns.push({ btn: b, tool: t.tool });

    const menu = document.createElement('div'); menu.className = 'sk-ribbon-menu';
    RECT_VARIANTS.forEach((v) => {
      const item = document.createElement('div'); item.className = 'sk-ribbon-menu-item'; item.dataset.mode = v.mode;
      item.innerHTML = iconSvg(v.icon, '') + `<span>${v.label}</span>`;
      if (state && state.rectMode === v.mode) item.classList.add('active');
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (state) state.rectMode = v.mode;
        if (useEl) useEl.setAttribute('href', '#' + v.icon);
        menu.querySelectorAll('.sk-ribbon-menu-item').forEach(i => i.classList.toggle('active', i.dataset.mode === v.mode));
        closeMenu();
        selectTool(t.tool);     // switch to rect with the chosen variant
        fire('rectMode', v.mode);
      });
      menu.appendChild(item);
    });
    // TASK 607: the variants menu is a POPOVER: it lives on document.body (a ribbon is a scroll box and clips any child, absolute or fixed under a
    // mask) and is placed from the button's rect, kept inside the viewport: below the button in the bar, beside it in the short-viewport rail.
    // It closes on Esc, an outside click, the ribbon scrolling and the window resizing; the listeners exist only while it is open.
    const closeMenu = () => {
      menu.classList.remove('show');
      document.removeEventListener('click', onOutside); document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', closeMenu); el.removeEventListener('scroll', closeMenu);
    };
    const onOutside = (ev) => { if (!menu.contains(ev.target)) closeMenu(); };
    const onKey = (ev) => { if (ev.key === 'Escape') closeMenu(); };
    const openMenu = () => {
      menu.classList.add('show');
      const r = b.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, pad = 4;
      menu.style.maxHeight = (vh - 2 * pad) + 'px';
      const w = menu.offsetWidth, h = menu.offsetHeight;
      const beside = isShortViewport();
      const left = beside ? r.right + pad : r.left, top = beside ? r.top : r.bottom + 2;
      menu.style.left = Math.round(Math.max(pad, Math.min(left, vw - w - pad))) + 'px';
      menu.style.top = Math.round(Math.max(pad, Math.min(top, vh - h - pad))) + 'px';
      document.addEventListener('click', onOutside); document.addEventListener('keydown', onKey);
      window.addEventListener('resize', closeMenu); el.addEventListener('scroll', closeMenu);
    };
    b.addEventListener('click', (ev) => {
      ev.stopPropagation(); selectTool(t.tool);
      if (menu.classList.contains('show')) closeMenu(); else openMenu();
    });
    menus.push(menu);
    document.body.appendChild(menu);
    wrap.append(b);
    return wrap;
  }
  function extraButton(bd) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn';
    if (bd.id) b.id = bd.id; b.title = bd.title || bd.label || '';
    b.innerHTML = (bd.icon ? iconSvg(bd.icon) : (bd.svg || '')) + `<span class="sk-ribbon-lbl">${bd.label || ''}</span>`;
    b.addEventListener('click', () => { try { bd.onClick && bd.onClick(); } catch (_) {} fire('action', { id: bd.id, event: bd.event }); });
    return b;
  }

  function buildGroup(label, defs, makeBtn) {
    const frag = document.createDocumentFragment();
    defs.forEach(d => frag.appendChild(makeBtn(d)));
    el.appendChild(group(label, frag));
  }
  // CREATE (rect gets the dropdown), EDIT (trim/break/fillet + opt-in profile actions), INSPECT, CONSTRAIN
  buildGroup('Create', CREATE, (t) => (t.rectDropdown ? rectButton(t) : toolButton(t)));
  const modifyTools = profiles ? [...EDIT, ...PROFILE_ACTIONS] : EDIT;
  buildGroup('Modify', modifyTools, toolButton);  // TRACE-1: trim + break
  buildGroup('Inspect', parameters ? [...INSPECT, PARAMETERS] : INSPECT, toolButton);
  buildGroup('Constrain', [...CONSTRAIN, LOCK], toolButton);
  const lockBtn = el.querySelector('#btn-lock');
  // Selection changes arrive through pointer / key input (no selection event exists), so re-sync after them.
  const syncSoon = () => setTimeout(refresh, 0);
  document.addEventListener('pointerup', syncSoon);
  document.addEventListener('keyup', syncSoon);

  // EDIT: shared built-in Undo / Redo (all hosts)
  const editFrag = document.createDocumentFragment();
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'sk-ribbon-btn';
  undoBtn.id = 'btn-undo';
  undoBtn.title = 'Undo (Ctrl+Z)';
  undoBtn.innerHTML = `<svg class="sk-ribbon-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7v6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sk-ribbon-lbl">Undo</span>`;
  undoBtn.addEventListener('click', () => {
    if (state && typeof state.undo === 'function') state.undo();
    fire('action', { id: 'btn-undo', action: 'undo' });
    refresh();
  });

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'sk-ribbon-btn';
  redoBtn.id = 'btn-redo';
  redoBtn.title = 'Redo (Ctrl+Y, Ctrl+Shift+Z)';
  redoBtn.innerHTML = `<svg class="sk-ribbon-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 7v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sk-ribbon-lbl">Redo</span>`;
  redoBtn.addEventListener('click', () => {
    if (state && typeof state.redo === 'function') state.redo();
    fire('action', { id: 'btn-redo', action: 'redo' });
    refresh();
  });
  editFrag.append(undoBtn, redoBtn);
  el.appendChild(group('Edit', editFrag));

  // app-specific groups (Actions / …) appended by the host
  (extraGroups || []).forEach((grp) => {
    const frag = document.createDocumentFragment();
    (grp.buttons || []).forEach(bd => frag.appendChild(extraButton(bd)));
    el.appendChild(group(grp.label || '', frag));
  });

  const unlistenHistory = (state && typeof state.addHistoryListener === 'function')
    ? state.addHistoryListener(() => refresh())
    : null;

  function refresh() {
    const cur = state && state.currentTool;
    toolBtns.forEach(({ btn, tool }) => btn.classList.toggle('active', tool === cur));
    const canUndo = (state && typeof state.canUndo === 'function') ? state.canUndo() : Boolean(state && state.history && state.history.length > 0);
    const canRedo = (state && typeof state.canRedo === 'function') ? state.canRedo() : Boolean(state && state.redoStack && state.redoStack.length > 0);
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
    const lock = state ? selectionLockState(state) : { has: false, locked: false };
    lockBtn.disabled = !lock.has;
    lockBtn.setAttribute('aria-pressed', String(lock.locked));
    const paramsBtn = el.querySelector('#btn-parameters');
    if (paramsBtn) paramsBtn.setAttribute('aria-pressed', String(!!(paramsWin && paramsWin.isOpen())));
  }

  // TASK 562: the edge-fade cue. Each side fades only while there is more ribbon that way (CSS applies it at <= 640 px).
  function syncFade() {
    const max = el.scrollWidth - el.clientWidth;
    const more = { left: max > 2 && el.scrollLeft > 2, right: max > 2 && el.scrollLeft < max - 2 };
    el.dataset.fade = more.left && more.right ? 'both' : more.left ? 'left' : more.right ? 'right' : 'none';
  }
  el.addEventListener('scroll', syncFade, { passive: true });
  window.addEventListener('resize', syncFade);
  const fadeObserver = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(syncFade) : null;
  if (fadeObserver) fadeObserver.observe(el);

  refresh();
  return {
    el,
    // TASK 602: the container is the ribbon's host and its parent the design frame (the short-viewport rail layout above keys on both classes)
    render: (container) => {
      if (container) {
        container.appendChild(el);
        container.classList.add('sk-ribbon-host');
        if (container.parentElement) container.parentElement.classList.add('sk-ribbon-frame');
      }
      refresh(); syncFade(); return el;
    },
    refresh,
    destroy: () => {
      if (unlistenHistory) unlistenHistory();
      if (paramsWin) paramsWin.destroy();
      document.removeEventListener('pointerup', syncSoon);
      document.removeEventListener('keyup', syncSoon);
      window.removeEventListener('resize', syncFade);
      if (fadeObserver) fadeObserver.disconnect();
      menus.forEach(m => m.remove());
      try { el.remove(); } catch (_) {}
    },
  };
}
