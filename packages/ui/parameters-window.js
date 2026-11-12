// packages/ui/parameters-window.js — TASK 535 slice 4: the "fx Parameters" pop-up (docs/PARAMETERS-DESIGN.md F, O13).
// The shared tabbed dock panel as a modeless floating window over the canvas, holding the read-only Parameters table.
//   createParametersWindow({ state, anchorEl, onClose }) -> { open, close, toggle, isOpen, destroy, el }
//   - anchorEl: the ribbon element. First run the window opens just below it (never over it); while the anchor is not on screen (a host's
//     Design tab is hidden behind another tab) the window is hidden with it.
//   - Live: while OPEN a requestAnimationFrame tick compares a cheap signature of the rows (the same per-frame signature check the hosts' panelTick
//     does for the side panel); it rebuilds only on a change and otherwise only re-lights the hovered / selected rows. Closed = no tick.
//   - Keys typed in the window are not tool shortcuts (they stop at the window).
// Themed from the ribbon's own tokens so every host (light Studio, dark Shaper, paper Pen Plotter) gets its chrome look.

import { createTabbedDockPanel } from '#ui/tabbed-dock-panel.js';
import { createParameterTable } from '#ui/parameter-table.js';
import SettingsManager from '#core/settings-manager.js';

export const PARAMETERS_PERSIST_KEY = 'sk-parameters';
const SIZE = { w: 460, h: 360 };

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-pwin-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-pwin-styles';
  s.textContent = `
.sk-pwin { --sk-dock-bg: var(--sk-ribbon-bg, #fff); --sk-dock-text: var(--sk-ribbon-fg, #1f2937); --sk-dock-border: var(--sk-ribbon-sep, #cbd5e1);
  --sk-dock-hover: var(--sk-ribbon-hover, #f0f0f0); --sk-info-head: var(--sk-ribbon-hover, rgba(127,127,127,0.12)); --sk-info-hover: var(--sk-ribbon-hover, rgba(127,127,127,0.14));
  box-shadow: 0 10px 30px rgba(0,0,0,0.22); backdrop-filter: none; -webkit-backdrop-filter: none; }
.sk-pwin .sk-dock-tab { opacity: 1; font-weight: 700; cursor: default; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

export function createParametersWindow({ state, anchorEl = null, onClose = null } = {}) {
  injectStyles();
  const getUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';
  const table = createParameterTable({ state, getUnit });

  // first run: right-aligned just below the anchor (the ribbon); a remembered position wins (the dock merges it over this)
  const a = anchorEl && anchorEl.getBoundingClientRect ? anchorEl.getBoundingClientRect() : null;
  const w = Math.min(SIZE.w, Math.max(280, window.innerWidth - 24));
  const initial = { w, h: SIZE.h, left: Math.max(8, window.innerWidth - w - 16), top: a ? Math.round(a.bottom + 8) : 80 };

  const dock = createTabbedDockPanel({
    tabs: [{ label: 'Parameters', render: (body) => body.appendChild(table.el) }],
    persistKey: PARAMETERS_PERSIST_KEY, open: false, closable: true, title: 'Parameters', initial, narrowSheet: true,
    onClose: () => { stop(); if (typeof onClose === 'function') onClose(); },
  });
  dock.el.classList.add('sk-pwin');
  dock.el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); }); // typing here is not a tool shortcut (Esc is the dock's)

  let raf = null;
  const tick = () => {
    raf = null;
    if (!dock.isOpen()) return;
    const onScreen = !anchorEl || anchorEl.offsetParent !== null;
    dock.el.style.display = onScreen ? '' : 'none';
    if (onScreen) table.refresh();
    raf = requestAnimationFrame(tick);
  };
  const start = () => { if (raf == null) raf = requestAnimationFrame(tick); };
  function stop() { if (raf != null) { cancelAnimationFrame(raf); raf = null; } }

  const api = {
    el: dock.el, table,
    isOpen: () => dock.isOpen(),
    open: () => { table.refresh(); dock.open(); start(); },
    close: () => { dock.close(); stop(); },
    toggle: () => (dock.isOpen() ? api.close() : api.open()),
    destroy: () => { stop(); table.destroy(); dock.destroy(); },
  };
  return api;
}
