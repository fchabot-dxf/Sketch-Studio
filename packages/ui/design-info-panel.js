// packages/ui/design-info-panel.js — the shared, data-driven Design OVERVIEW/MANAGE panel (S5b).
// Drops into a TabbedDockPanel tab (render(body)). Lists the sketch's constraints + a DOF readout, read from the
// SHARED state/engine. This is OVERVIEW/MANAGE only — the on-canvas glyphs, inline dim-edit, and snap/hover GUI
// STAY on the canvas; this panel never replaces them.
// Clicking a constraint row toggles state.selectedConstraints — the shared renderer ALREADY highlights selected
// constraints on the canvas, so the dock↔canvas highlight is automatic (no new plumbing).
// App-agnostic: imports only #core (constraint-status). Themed via --sk-*/--sk-dock-*. Self-contained styles.

import { analyzeConstraintStatus } from '#core/constraint-status.js';

// constraint type → row icon + label (keys = CONSTRAINT_TYPES values from #core/constants.js)
const TYPE_META = {
  coincident:   { icon: '⊙', label: 'Coincident' },
  horizontal:   { icon: '─', label: 'Horizontal' },
  vertical:     { icon: '│', label: 'Vertical' },
  parallel:     { icon: '∥', label: 'Parallel' },
  perpendicular:{ icon: '⊥', label: 'Perpendicular' },
  collinear:    { icon: '┅', label: 'Collinear' },
  tangent:      { icon: '◜', label: 'Tangent' },
  pointOnLine:  { icon: '•', label: 'Point on line' },
  distance:     { icon: '↔', label: 'Distance' },
  equal:        { icon: '=', label: 'Equal' },
  angle:        { icon: '∠', label: 'Angle' },
  midpoint:     { icon: '◐', label: 'Midpoint' },
};

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-info-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style');
  s.id = 'sk-info-styles';
  s.textContent = `
.sk-info { display: flex; flex-direction: column; gap: 6px; font: 12px system-ui, sans-serif; color: inherit; }
.sk-info-dof { padding: 4px 6px; border-radius: 6px; background: var(--sk-info-head, rgba(127,127,127,0.12));
  opacity: 0.92; }
.sk-info-dof b { font-weight: 700; }
.sk-info-list { display: flex; flex-direction: column; gap: 2px; }
.sk-info-empty { opacity: 0.55; padding: 4px 6px; font-style: italic; }
.sk-info-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer;
  background: transparent; color: inherit; border: 0; border-radius: 6px; padding: 5px 8px; font: inherit; }
.sk-info-row:hover { background: var(--sk-info-hover, rgba(127,127,127,0.14)); }
.sk-info-row.sel { background: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); color: #fff; }
.sk-info-ic { width: 1.1em; text-align: center; opacity: 0.85; }
.sk-info-lbl { flex: 1; }
.sk-info-val { opacity: 0.8; font-variant-numeric: tabular-nums; }
`;
  document.head.appendChild(s);
  stylesInjected = true;
}

function typeMeta(t) { return TYPE_META[t] || { icon: '◦', label: String(t || 'constraint') }; }

/**
 * createDesignInfoPanel({ state, engine }) → { el, render(container), refresh, destroy }
 *   Reads state.constraints / state.selectedConstraints / state.joints / state.shapes (the shared sketch state).
 *   render(container) appends el (drop into a TabbedDockPanel tab: render: (body) => infoPanel.render(body)).
 *   refresh() re-renders from current state (host calls it on constraint changes).
 */
export function createDesignInfoPanel({ state, engine } = {}) {
  injectStyles();
  const el = document.createElement('div'); el.className = 'sk-info';
  const dofEl = document.createElement('div'); dofEl.className = 'sk-info-dof';
  const listEl = document.createElement('div'); listEl.className = 'sk-info-list';
  el.append(dofEl, listEl);

  function totalDOF() {
    try {
      const { jointDOFs } = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes || [], constraints: state.constraints || [] });
      let sum = 0; for (const v of jointDOFs.values()) sum += v; return sum;
    } catch (_) { return null; }
  }

  function refresh() {
    const cons = (state && Array.isArray(state.constraints)) ? state.constraints : [];
    const sel = (state && state.selectedConstraints instanceof Set) ? state.selectedConstraints : null;
    const dof = totalDOF();
    let solved = '';
    try { const stats = engine && engine.getSolveStats && engine.getSolveStats(); if (stats && typeof stats.converged === 'boolean') solved = ` · ${stats.converged ? '✓ solved' : '… solving'}`; } catch (_) {}
    const dofTxt = (dof != null) ? ` · DOF <b>${dof}</b> · ${dof === 0 ? 'fully constrained' : dof + ' free'}` : '';
    dofEl.innerHTML = `<b>${cons.length}</b> constraint${cons.length === 1 ? '' : 's'}${dofTxt}${solved}`;

    listEl.innerHTML = '';
    if (!cons.length) { const e = document.createElement('div'); e.className = 'sk-info-empty'; e.textContent = 'No constraints yet.'; listEl.appendChild(e); return; }
    cons.forEach((c) => {
      const m = typeMeta(c.type);
      const row = document.createElement('button'); row.type = 'button'; row.className = 'sk-info-row';
      if (sel && sel.has(c)) row.classList.add('sel');
      const driven = (c.isDriven || c.driven) ? ' <span class="sk-info-val">(ref)</span>' : '';
      const val = (typeof c.value === 'number') ? ` <span class="sk-info-val">${c.value.toFixed(1)}</span>` : '';
      row.innerHTML = `<span class="sk-info-ic">${m.icon}</span><span class="sk-info-lbl">${m.label}</span>${val}${driven}`;
      row.addEventListener('click', () => {
        if (!(state.selectedConstraints instanceof Set)) state.selectedConstraints = new Set();
        if (state.selectedConstraints.has(c)) state.selectedConstraints.delete(c);
        else state.selectedConstraints.add(c);
        refresh(); // update the row highlight; the canvas auto-highlights via the renderer reading the Set
      });
      listEl.appendChild(row);
    });
  }

  refresh();
  return {
    el,
    render: (container) => { if (container) container.appendChild(el); refresh(); return el; },
    refresh,
    destroy: () => { try { el.remove(); } catch (_) {} },
  };
}
