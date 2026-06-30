// packages/ui/design-info-panel.js — the shared, data-driven Design OVERVIEW/MANAGE panel (S5b).
// Drops into a TabbedDockPanel tab (render(body)). Lists the sketch's constraints + a DOF readout, read from the
// SHARED state/engine. This is OVERVIEW/MANAGE only — the on-canvas glyphs, inline dim-edit, and snap/hover GUI
// STAY on the canvas; this panel never replaces them.
// Clicking a constraint row toggles state.selectedConstraints — the shared renderer ALREADY highlights selected
// constraints on the canvas, so the dock↔canvas highlight is automatic (no new plumbing).
// App-agnostic: imports only #core (constraint-status). Themed via --sk-*/--sk-dock-*. Self-contained styles.

import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { constraintSketch, addSketch, activateSketch, DEFAULT_SKETCH_ID, DEFAULT_SKETCH_NAME } from '#core/sketch-model.js'; // SKETCH-1b/2a: gated tree + multi-sketch

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
/* SKETCH-1b: the gated sketch-tree — a Sketch node with its constraints nested as children. */
.sk-tree-hdr { display: flex; align-items: center; gap: 6px; padding: 2px 4px 4px; }
.sk-tree-title { flex: 1; font-size: 0.85em; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.55; }
.sk-tree-add { background: transparent; border: 1px solid var(--sk-info-head, rgba(127,127,127,0.3)); color: inherit;
  border-radius: 5px; width: 20px; height: 20px; line-height: 1; cursor: pointer; font: 14px system-ui, sans-serif; opacity: 0.85; }
.sk-tree-add:hover { background: var(--sk-info-hover, rgba(127,127,127,0.14)); opacity: 1; }
.sk-sketch-node { display: flex; flex-direction: column; }
.sk-sketch-head { display: flex; align-items: center; gap: 6px; padding: 4px 6px; font-weight: 600; opacity: 0.92;
  cursor: pointer; user-select: none; border-radius: 6px; }
.sk-sketch-head:hover { background: var(--sk-info-hover, rgba(127,127,127,0.14)); }
/* SKETCH-2a: the ACTIVE sketch (new geometry lands in it) — accent bar + bold name + a dot. */
.sk-sketch-head.is-active { background: var(--sk-info-head, rgba(127,127,127,0.12)); box-shadow: inset 2px 0 0 var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-head.is-active .sk-sketch-name { font-weight: 800; }
.sk-sketch-head.is-active .sk-sketch-dot { opacity: 1; }
.sk-sketch-dot { color: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); opacity: 0; font-size: 0.7em; }
.sk-sketch-tw { opacity: 0.55; font-size: 0.8em; width: 1em; text-align: center; cursor: pointer; }
.sk-sketch-tw:hover { opacity: 0.9; }
/* SKETCH-2b: inline rename field + the visibility (eye) toggle + a dimmed hidden node. */
.sk-sketch-rename { flex: 1; min-width: 0; font: inherit; font-weight: 600; color: inherit; padding: 1px 4px;
  background: var(--sk-info-head, rgba(127,127,127,0.14)); border: 1px solid var(--sk-dock-accent, var(--sk-selection, #4c9aff)); border-radius: 4px; }
.sk-sketch-eye { background: transparent; border: 0; color: inherit; cursor: pointer; opacity: 0.55; font-size: 0.95em; padding: 0 2px; line-height: 1; }
.sk-sketch-eye:hover { opacity: 1; }
.sk-sketch-node.is-hidden .sk-sketch-name { opacity: 0.5; font-style: italic; }
.sk-sketch-name { flex: 1; }
.sk-sketch-children { display: flex; flex-direction: column; gap: 2px; margin-left: 7px; padding-left: 7px;
  border-left: 1px solid var(--sk-info-head, rgba(127,127,127,0.18)); }
.sk-sketch-empty { opacity: 0.5; padding: 3px 6px; font-style: italic; font-size: 0.95em; }
/* SKETCH-3: a cross-sketch LINK row — a constraint whose joints span sketches; the reference names the other sketch. */
.sk-link-to { color: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); font-size: 0.85em; margin-left: 4px;
  white-space: nowrap; opacity: 0.95; }
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
export function createDesignInfoPanel({ state, engine, showSketchTree = false } = {}) {
  injectStyles();
  // SKETCH-1c: which sketch nodes are collapsed — PANEL/UI state only (survives re-renders; NOT the export-bound
  // sketch model, which feeds the <g> export). A pure presentation concern.
  const collapsedSketchIds = new Set();
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

  // One constraint row (icon + label + value), click toggles state.selectedConstraints (the renderer auto-highlights).
  // SKETCH-3: `linkTo` (the other sketch name(s)) marks a CROSS-SKETCH link — a `⇄ Sketch N` reference + a .sk-link-row.
  function buildRow(c, sel, linkTo) {
    const m = typeMeta(c.type);
    const row = document.createElement('button'); row.type = 'button'; row.className = 'sk-info-row' + (linkTo ? ' sk-link-row' : '');
    if (sel && sel.has(c)) row.classList.add('sel');
    const driven = (c.isDriven || c.driven) ? ' <span class="sk-info-val">(ref)</span>' : '';
    const val = (typeof c.value === 'number') ? ` <span class="sk-info-val">${c.value.toFixed(1)}</span>` : '';
    const link = linkTo ? ` <span class="sk-link-to" title="Cross-sketch link">⇄ ${linkTo}</span>` : '';
    row.innerHTML = `<span class="sk-info-ic">${m.icon}</span><span class="sk-info-lbl">${m.label}</span>${val}${driven}${link}`;
    row.addEventListener('click', () => {
      if (!(state.selectedConstraints instanceof Set)) state.selectedConstraints = new Set();
      if (state.selectedConstraints.has(c)) state.selectedConstraints.delete(c);
      else state.selectedConstraints.add(c);
      refresh(); // update the row highlight; the canvas auto-highlights via the renderer reading the Set
    });
    return row;
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

    // SKETCH-1b: when opted in, a sketch-ROOTED tree — a Sketch node per state.sketches with its constraints nested as
    // children (bucketed via constraintSketch; single-sketch → all under 'Sketch 1'). DEFAULT (off) = the FLAT list →
    // SketchStudio byte-identical. (Multi-sketch UX = S-2; cross-sketch links = S-3.)
    if (showSketchTree) {
      // SKETCH-2a: header with a '+' new-sketch action (appends 'Sketch N' + activates it; snapshots for undo).
      const hdr = document.createElement('div'); hdr.className = 'sk-tree-hdr';
      const title = document.createElement('span'); title.className = 'sk-tree-title'; title.textContent = 'Sketches';
      const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'sk-tree-add'; addBtn.title = 'New sketch'; addBtn.textContent = '+';
      addBtn.addEventListener('click', () => { try { state.saveState && state.saveState(); } catch (_) {} const sk = addSketch(state); activateSketch(state, sk.id); refresh(); });
      hdr.append(title, addBtn); listEl.appendChild(hdr);

      const sketches = (state && Array.isArray(state.sketches) && state.sketches.length) ? state.sketches : [{ id: DEFAULT_SKETCH_ID, name: DEFAULT_SKETCH_NAME }];
      const activeId = (state && state.activeSketchId) || DEFAULT_SKETCH_ID;
      const nameById = new Map(sketches.map((s) => [s.id, s.name])); // SKETCH-3: for the cross-sketch link reference
      for (const sk of sketches) {
        const kids = cons.filter((c) => { const s = constraintSketch(c, state); return s === sk.id || (s instanceof Set && s.has(sk.id)); });
        const collapsed = collapsedSketchIds.has(sk.id);
        const node = document.createElement('div'); node.className = 'sk-sketch-node' + (sk.visible === false ? ' is-hidden' : '');
        // FOUR clean targets (each sub-element stops propagation): CARET → collapse; NAME dbl-click → rename; EYE →
        // visibility; the HEAD single-click → activate; the nested ROWS → select.
        const head = document.createElement('div'); head.className = 'sk-sketch-head' + (sk.id === activeId ? ' is-active' : '');
        const caret = document.createElement('span'); caret.className = 'sk-sketch-tw'; caret.textContent = collapsed ? '▸' : '▾';
        caret.addEventListener('click', (e) => { e.stopPropagation(); if (collapsedSketchIds.has(sk.id)) collapsedSketchIds.delete(sk.id); else collapsedSketchIds.add(sk.id); refresh(); });
        const name = document.createElement('span'); name.className = 'sk-sketch-name'; name.textContent = sk.name;
        name.addEventListener('dblclick', (e) => { // SKETCH-2b: inline rename
          e.stopPropagation();
          const input = document.createElement('input'); input.type = 'text'; input.className = 'sk-sketch-rename'; input.value = sk.name;
          let done = false;
          const finish = (save) => {
            if (done) return; done = true;
            const v = input.value.trim();
            if (save && v && v !== sk.name) { try { state.saveState && state.saveState(); } catch (_) {} sk.name = v; }
            refresh();
          };
          input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } });
          input.addEventListener('blur', () => finish(true));
          name.replaceWith(input); input.focus(); input.select();
        });
        const dot = document.createElement('span'); dot.className = 'sk-sketch-dot'; dot.textContent = '●';
        const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'sk-sketch-eye';
        eye.textContent = sk.visible === false ? '◌' : '◉'; eye.title = sk.visible === false ? 'Show sketch' : 'Hide sketch';
        eye.addEventListener('click', (e) => { e.stopPropagation(); try { state.saveState && state.saveState(); } catch (_) {} sk.visible = sk.visible === false; refresh(); });
        const count = document.createElement('span'); count.className = 'sk-info-val'; count.textContent = String(kids.length);
        head.append(caret, name, dot, eye, count);
        head.addEventListener('click', () => { activateSketch(state, sk.id); refresh(); }); // activate (sub-elements stop their own clicks)
        node.appendChild(head);
        if (!collapsed) {
          const childWrap = document.createElement('div'); childWrap.className = 'sk-sketch-children';
          if (!kids.length) { const e = document.createElement('div'); e.className = 'sk-sketch-empty'; e.textContent = 'No constraints yet.'; childWrap.appendChild(e); }
          else for (const c of kids) {
            const cs = constraintSketch(c, state); // a Set → spanning → a cross-sketch link naming the OTHER sketch(es)
            const linkTo = (cs instanceof Set) ? [...cs].filter((id) => id !== sk.id).map((id) => nameById.get(id) || id).join(', ') : null;
            childWrap.appendChild(buildRow(c, sel, linkTo));
          }
          node.appendChild(childWrap);
        }
        listEl.appendChild(node);
      }
      return;
    }

    if (!cons.length) { const e = document.createElement('div'); e.className = 'sk-info-empty'; e.textContent = 'No constraints yet.'; listEl.appendChild(e); return; }
    cons.forEach((c) => listEl.appendChild(buildRow(c, sel)));
  }

  refresh();
  return {
    el,
    render: (container) => { if (container) container.appendChild(el); refresh(); return el; },
    refresh,
    destroy: () => { try { el.remove(); } catch (_) {} },
  };
}
