// packages/ui/tool-ribbon.js — the shared, SketchStudio-style tool ribbon (S7a).
// Grouped, icon-over-label tool buttons over the SHARED sketch: Create / Inspect / Constrain. App-agnostic
// chrome — each button wires to the SAME shared tool-switch (switchToTool) the keyboard + the simple palette use,
// so the on-canvas behaviour is unchanged. A host appends its OWN app-specific groups (Edit / Actions / …) via
// `extraGroups`, and `on` surfaces button events. Themed via --sk-* (light defaults → SketchStudio; a dark :root
// → Shaper) from the SAME component. Self-contained: injects its <style> once + inject-IF-MISSING icon symbols
// (reuses cursor-manager's ICONS, the single source of truth) so #icon-* resolve in any host.

import { switchToTool } from '#ui/input-manager.js';
import { ensureIconSymbols } from '#ui/cursor-manager.js';
import { TOOL_MODES, RECT_MODES } from '#core/constants.js';

// The SHARED sketcher groups (icon = cursor-manager symbol id; label = the SketchStudio button label).
const CREATE = [
  { tool: TOOL_MODES.SELECT, icon: 'icon-tool-select',  label: 'Select' },
  { tool: TOOL_MODES.LINE,   icon: 'icon-tool-line',    label: 'Line' },
  { tool: TOOL_MODES.RECT,   icon: 'icon-tool-rect-2pt', label: 'Rect', rectDropdown: true },
  { tool: TOOL_MODES.CIRCLE, icon: 'icon-tool-circle',  label: 'Circle' },
  { tool: TOOL_MODES.ARC,    icon: 'icon-tool-arc-cse', label: 'Arc' }, // single-mode in the source (no dropdown)
  { tool: TOOL_MODES.BEZIER, icon: 'icon-tool-bezier',  label: 'Bezier' }, // UNIFY-3-tool: shared pen tool (all apps)
];
// TRACE-1: Edit/modify tools — trim + break. No cursor-manager symbols yet; icons provided as SVG inline.
const EDIT = [
  { tool: TOOL_MODES.TRIM,  iconSvg: '<path d="M4 12h6M14 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="#ef4444"/>', label: 'Trim' },
  { tool: TOOL_MODES.BREAK, iconSvg: '<path d="M5 12h5M14 12h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" stroke="#fbbf24" stroke-width="2" fill="none"/>', label: 'Break' },
];
const INSPECT = [
  { tool: TOOL_MODES.DIMENSION, icon: 'icon-tool-dim', label: 'Dim' },
];
const CONSTRAIN = [
  { tool: TOOL_MODES.COINCIDENT,          icon: 'icon-coincident',   label: 'Coinc' },
  { tool: TOOL_MODES.HORIZONTAL_VERTICAL, icon: 'icon-hv',           label: 'H/V' },
  { tool: TOOL_MODES.PARALLEL,            icon: 'icon-parallel',     label: 'Para' },
  { tool: TOOL_MODES.PERPENDICULAR,       icon: 'icon-perpendicular', label: 'Perp' },
  { tool: TOOL_MODES.COLLINEAR,           icon: 'icon-collinear',    label: 'Coll' },
  { tool: TOOL_MODES.TANGENT,             icon: 'icon-tangent',      label: 'Tang' },
  { tool: TOOL_MODES.EQUAL,               icon: 'icon-equal',        label: 'Equal' },
  { tool: TOOL_MODES.MIDPOINT,            icon: 'icon-midpoint',     label: 'Mid' },
];
// Rect variants (the dropdown) — sets state.rectMode + swaps the rect button's icon/label, like ui-manager.
const RECT_VARIANTS = [
  { mode: RECT_MODES.TWO_POINT,   icon: 'icon-tool-rect-2pt',    label: '2-Point (Corner)' },
  { mode: RECT_MODES.CENTER,      icon: 'icon-tool-rect-center', label: 'Center Point' },
  { mode: RECT_MODES.THREE_POINT, icon: 'icon-tool-rect-3pt',    label: '3-Point' },
];

// Every #icon-* the ribbon references (for inject-if-missing).
const ICON_IDS = [
  ...CREATE.map(t => t.icon), ...INSPECT.map(t => t.icon), ...CONSTRAIN.map(t => t.icon),
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
  padding: 4px 2px; font: 12px system-ui, sans-serif; box-sizing: border-box; }
.sk-ribbon * { box-sizing: border-box; }
.sk-ribbon-group { display: flex; flex-direction: column; align-items: center; padding: 0 8px;
  border-right: 1px solid var(--sk-ribbon-sep, #e2e8f0); }
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
.sk-ribbon-menu { display: none; position: absolute; top: 100%; left: 0; z-index: 9999; min-width: 160px;
  padding: 4px 0; background: var(--sk-ribbon-menu-bg, #fff); border: 1px solid var(--sk-ribbon-sep, #cbd5e1);
  border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); }
.sk-ribbon-menu.show { display: block; }
.sk-ribbon-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
  font-size: 11px; font-weight: 600; white-space: nowrap; color: var(--sk-ribbon-fg, inherit); }
.sk-ribbon-menu-item:hover { background: var(--sk-ribbon-hover, #f3f4f6); }
.sk-ribbon-menu-item.active { background: var(--sk-selection, #3B82F6); color: #fff; }
.sk-ribbon-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
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
 *   onToolClick(tool): optional host override — when given, a tool-button click (and a rect-variant select, after
 *     state.rectMode is set) calls THIS instead of the internal switchToTool, so a host (e.g. SketchStudio) routes
 *     tool activation to its OWN rich handler. When absent, the ribbon uses switchToTool (Shaper/standalone path).
 */
export function createToolRibbon({ state, extraGroups = [], on = null, onToolClick = null } = {}) {
  injectStyles();
  ensureIconSymbols(ICON_IDS);

  const el = document.createElement('div'); el.className = 'sk-ribbon';
  const toolBtns = []; // { btn, tool } — for active-sync

  const fire = (name, detail) => { if (typeof on === 'function') { try { on(name, detail); } catch (_) {} } };
  function selectTool(tool) {
    if (typeof onToolClick === 'function') { try { onToolClick(tool); } catch (_) {} } // host owns activation
    else { try { switchToTool(state, tool); } catch (_) {} }                            // default: shared tool-switch
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
    b.dataset.tool = t.tool; b.title = t.label;
    // Support both symbol-id icons (icon) and raw inline SVG paths (iconSvg) for newer tools
    const icon = t.iconSvg
      ? `<svg class="sk-ribbon-ic" viewBox="0 0 24 24" fill="none" aria-hidden="true">${t.iconSvg}</svg>`
      : iconSvg(t.icon);
    b.innerHTML = icon + `<span class="sk-ribbon-lbl">${t.label}</span>`;
    b.addEventListener('click', () => selectTool(t.tool));
    toolBtns.push({ btn: b, tool: t.tool });
    return b;
  }
  function rectButton(t) {
    const wrap = document.createElement('div'); wrap.className = 'sk-ribbon-dd';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-ribbon-btn';
    b.dataset.tool = t.tool; b.title = t.label;
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
        menu.classList.remove('show');
        selectTool(t.tool);     // switch to rect with the chosen variant
        fire('rectMode', v.mode);
      });
      menu.appendChild(item);
    });
    b.addEventListener('click', (ev) => { ev.stopPropagation(); selectTool(t.tool); menu.classList.toggle('show'); });
    document.addEventListener('click', () => menu.classList.remove('show')); // close on outside click
    wrap.append(b, menu);
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
  // CREATE (rect gets the dropdown), EDIT (trim/break), INSPECT, CONSTRAIN
  buildGroup('Create', CREATE, (t) => (t.rectDropdown ? rectButton(t) : toolButton(t)));
  buildGroup('Edit', EDIT, toolButton);  // TRACE-1: trim + break
  buildGroup('Inspect', INSPECT, toolButton);
  buildGroup('Constrain', CONSTRAIN, toolButton);
  // app-specific groups (Edit / Actions / …) appended by the host
  (extraGroups || []).forEach((grp) => {
    const frag = document.createDocumentFragment();
    (grp.buttons || []).forEach(bd => frag.appendChild(extraButton(bd)));
    el.appendChild(group(grp.label || '', frag));
  });

  function refresh() {
    const cur = state && state.currentTool;
    toolBtns.forEach(({ btn, tool }) => btn.classList.toggle('active', tool === cur));
  }

  refresh();
  return {
    el,
    render: (container) => { if (container) container.appendChild(el); refresh(); return el; },
    refresh,
    destroy: () => { try { el.remove(); } catch (_) {} },
  };
}
