// packages/ui/design-tool-palette.js — the shared Design tool palette (S5c2). Drops into a TabbedDockPanel tab.
// Buttons for the draw tools + the constraint tools; each just calls the EXISTING shared tool-switch
// (switchToTool from #ui/input-manager) — the same path the keyboard shortcuts use. The active tool highlights.
// Constraints are TOOL-driven: a button switches to that constraint tool, then the on-canvas selection applies it
// via the existing handlers (no new apply path). App-agnostic; themed via --sk-*/--sk-dock-*; self-contained CSS.

import { switchToTool } from '#ui/input-manager.js';
import { TOOL_MODES } from '#core/constants.js';

const DRAW = [
  { tool: TOOL_MODES.SELECT, icon: '▱', label: 'Select' },
  { tool: TOOL_MODES.LINE,   icon: '╱', label: 'Line' },
  { tool: TOOL_MODES.RECT,   icon: '▭', label: 'Rectangle' },
  { tool: TOOL_MODES.CIRCLE, icon: '○', label: 'Circle' },
  { tool: TOOL_MODES.ARC,    icon: '◜', label: 'Arc' },
];
const CONSTRAIN = [
  { tool: TOOL_MODES.COINCIDENT,    icon: '⊙', label: 'Coincident' },
  { tool: TOOL_MODES.PERPENDICULAR, icon: '⊥', label: 'Perpendicular' },
  { tool: TOOL_MODES.PARALLEL,      icon: '∥', label: 'Parallel' },
  { tool: TOOL_MODES.EQUAL,         icon: '=', label: 'Equal' },
  { tool: TOOL_MODES.DIMENSION,     icon: '↔', label: 'Dimension' },
];

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-tool-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-tool-styles';
  s.textContent = `
.sk-tool-palette { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
.sk-tool-group { display: flex; flex-wrap: wrap; gap: 3px; }
.sk-tool-sep { align-self: stretch; width: 1px; background: var(--sk-dock-border, rgba(127,127,127,0.3)); margin: 0 2px; }
.sk-tool-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 30px; height: 28px;
  border: 1px solid var(--sk-dock-border, rgba(127,127,127,0.25)); border-radius: 6px; background: transparent;
  color: inherit; cursor: pointer; font: 14px system-ui, sans-serif; opacity: 0.82; }
.sk-tool-btn:hover { background: var(--sk-info-hover, rgba(127,127,127,0.14)); opacity: 1; }
.sk-tool-btn.active { background: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); color: #fff; border-color: transparent; opacity: 1; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

/**
 * createDesignToolPalette({ state }) → { el, render(container), refresh, destroy }
 *   Renders draw + constrain tool buttons; click → switchToTool(state, tool). refresh() syncs the active
 *   highlight to state.currentTool (host calls it on tool change, e.g. via the dock's render loop).
 */
export function createDesignToolPalette({ state } = {}) {
  injectStyles();
  const el = document.createElement('div'); el.className = 'sk-tool-palette';
  const btns = [];
  const addGroup = (tools) => {
    const g = document.createElement('div'); g.className = 'sk-tool-group';
    tools.forEach((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-tool-btn';
      b.dataset.tool = t.tool; b.title = t.label; b.setAttribute('aria-label', t.label);
      b.innerHTML = `<span class="sk-tool-ic">${t.icon}</span>`;
      b.addEventListener('click', () => { try { switchToTool(state, t.tool); } catch (_) {} refresh(); });
      g.appendChild(b); btns.push(b);
    });
    el.appendChild(g);
  };
  addGroup(DRAW);
  const sep = document.createElement('div'); sep.className = 'sk-tool-sep'; el.appendChild(sep);
  addGroup(CONSTRAIN);

  function refresh() {
    const cur = state && state.currentTool;
    btns.forEach((b) => b.classList.toggle('active', b.dataset.tool === cur));
  }

  refresh();
  return {
    el,
    render: (container) => { if (container) container.appendChild(el); refresh(); return el; },
    refresh,
    destroy: () => { try { el.remove(); } catch (_) {} },
  };
}
