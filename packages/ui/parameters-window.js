// packages/ui/parameters-window.js — TASK 535 slice 4: the "fx Parameters" pop-up (docs/PARAMETERS-DESIGN.md F, O13).
// The shared tabbed dock panel as a modeless floating window over the canvas, holding the Parameters table (editable since TASK 677, slice 5).
//   createParametersWindow({ state, anchor, above, onClose, history }) -> { open, close, toggle, isOpen, destroy, el }
//   - history: { undo(), redo() } of the Design surface (the footer's history router), handed to the table for Ctrl+Z / Ctrl+Y typed in a cell.
//   - anchor(): the surface the window opens over (the Design canvas showing now; null = none). First run the window opens right-aligned at the
//     anchor's top (so never over the ribbon above the canvas, nor beside a phone-landscape rail), no taller than the anchor leaves; while there
//     is no anchor on screen (a host's Design tab is hidden behind another tab) the window is hidden with it. TASK 677: the opener is the footer.
//   - above: an element the first-run window stays above (the footer's Parameters button: in phone landscape the footer floats inside the canvas).
//   - Live: while OPEN a requestAnimationFrame tick compares a cheap signature of the rows (the same per-frame signature check the hosts' panelTick
//     does for the side panel); it rebuilds only on a change and otherwise only re-lights the hovered / selected rows. Closed = no tick.
//   - Keys typed in the window are not tool shortcuts (they stop at the window).
// Themed from the ribbon's own tokens so every host (light Studio, dark Shaper, paper Pen Plotter) gets its chrome look.

import { createTabbedDockPanel } from '#ui/tabbed-dock-panel.js';
import { createParameterTable } from '#ui/parameter-table.js';
import { docUnit } from '#core/settings-manager.js';

export const PARAMETERS_PERSIST_KEY = 'sk-parameters';
const SIZE = { w: 460, h: 360 };
const MIN_ROOM = 160; // the least height the first-run window opens with (below the anchor when that much room is left there)

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

const shownEl = (e) => !!e && e.getClientRects().length > 0;

export function createParametersWindow({ state, anchor = () => null, above = null, onClose = null, history = null } = {}) {
  injectStyles();
  const table = createParameterTable({ state, getUnit: docUnit, history });

  // first run: right-aligned at the top of the anchor (the canvas), above `above`; a remembered position wins (the dock merges it over this)
  const anchorEl = anchor();
  const a = shownEl(anchorEl) ? anchorEl.getBoundingClientRect() : null;
  const right = a ? Math.min(window.innerWidth, a.right) : window.innerWidth;
  const w = Math.min(SIZE.w, Math.max(280, (a ? a.width : window.innerWidth) - 24));
  const top = a ? Math.round(Math.max(0, a.top) + 8) : 80;
  const floor = Math.min(a ? a.bottom : window.innerHeight, window.innerHeight, shownEl(above) ? above.getBoundingClientRect().top : Infinity);
  const initial = { w, h: Math.min(SIZE.h, Math.max(MIN_ROOM, floor - top - 8)), left: Math.max(8, Math.round(right - w - 16)), top };

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
    const onScreen = shownEl(anchor());
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
