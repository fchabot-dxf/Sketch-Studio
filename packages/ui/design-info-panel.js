// packages/ui/design-info-panel.js — the shared, data-driven Design OVERVIEW/MANAGE panel (S5b).
// Drops into a TabbedDockPanel tab (render(body)). Lists the sketch's constraints + a DOF readout, read from the
// SHARED state/engine. This is OVERVIEW/MANAGE only — the on-canvas glyphs, inline dim-edit, and snap/hover GUI
// STAY on the canvas; this panel never replaces them.
// Clicking a constraint row toggles state.selectedConstraints — the shared renderer ALREADY highlights selected
// constraints on the canvas, so the dock↔canvas highlight is automatic (no new plumbing).
// App-agnostic: imports only #core (constraint-status). Themed via --sk-*/--sk-dock-*. Self-contained styles.

import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { constraintSketch, addSketch, activateSketch, DEFAULT_SKETCH_ID, DEFAULT_SKETCH_NAME,
  recordUndo, setSketchLocked, soloSketch, isSoloed, moveSketchBy, reorderSketch, moveSelectionToSketch, moveTargets } from '#core/sketch-model.js'; // SKETCH-1b/2a: gated tree + multi-sketch; TASK 577: sketches as layers
import { showNotification } from '#ui/notification-manager.js';
import { formatConstraintValue } from '#ui/svg-renderer.js';
import { labelGeometry, constraintGeometryText } from '#ui/geometry-labels.js';

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
  symmetric:    { icon: '⇹', label: 'Symmetric' },
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
.sk-info-lbl { white-space: nowrap; }
.sk-info-geo { flex: 1; min-width: 0; opacity: 0.75; overflow-wrap: anywhere; }
.sk-info-geo::before { content: '· '; }
.sk-info-row.err { color: var(--sk-error, #e5484d); }
.sk-info-row.err.sel { color: #fff; background: var(--sk-error, #e5484d); }
/* A light sub-header per constraint type inside an expanded sketch. */
.sk-info-grp { font-size: 0.8em; font-weight: 700; letter-spacing: 0.03em; opacity: 0.55; padding: 4px 6px 1px; }
.sk-info-grp.err { color: var(--sk-error, #e5484d); opacity: 0.9; }
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
/* TASK 577: sketches as layers: the per-sketch buttons (move up / down, solo, lock), the drag handle and the move-selection menu. */
.sk-sketch-btn { background: transparent; border: 0; color: inherit; cursor: pointer; opacity: 0.55; font-size: 0.95em; padding: 0 2px; line-height: 1; }
.sk-sketch-btn:hover:not(:disabled) { opacity: 1; }
.sk-sketch-btn:disabled { opacity: 0.2; cursor: default; }
.sk-sketch-btn.on { opacity: 1; color: var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-grip { cursor: grab; touch-action: none; opacity: 0.45; font-size: 0.9em; width: 1em; text-align: center; }
.sk-sketch-node.is-locked .sk-sketch-name { opacity: 0.75; }
.sk-sketch-node.drop-before > .sk-sketch-head { box-shadow: inset 0 2px 0 var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-node.drop-after > .sk-sketch-head { box-shadow: inset 0 -2px 0 var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-node.dragging { opacity: 0.5; }
.sk-tree-move { flex: 0 1 auto; max-width: 10em; font: inherit; font-size: 0.85em; color: inherit; background: var(--sk-info-head, rgba(127,127,127,0.12));
  border: 1px solid var(--sk-info-head, rgba(127,127,127,0.3)); border-radius: 5px; padding: 1px 2px; }
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

// The row's type label (Radius/Diameter are distance dimensions); also the key rows are grouped by.
function rowLabel(c) {
  return c.isRadius || c.type === 'radius' ? 'Radius'
    : c.isDiameter || c.dimMode === 'diameter' || c.type === 'diameter' ? 'Diameter'
      : c.type === 'angle' ? 'Angle' : typeMeta(c.type).label;
}
const GROUP_ORDER = Object.values(TYPE_META).map((m) => m.label).flatMap((l) => (l === 'Distance' ? [l, 'Radius', 'Diameter'] : [l]));

// Constraints the solver reports as unsatisfied. Constraints carry no id, so a row matches the solver's entry by
// id when there is one, else by type + joints + shapes (skipped when the constraint binds neither).
function constraintKey(c) {
  const js = Array.isArray(c.joints) ? c.joints : [], ss = Array.isArray(c.shapes) ? c.shapes : [];
  return (js.length || ss.length) ? `${c.type}|${js.join(',')}|${ss.join(',')}|${c.value}` : null;
}
function failingConstraints(engine, cons) {
  const stats = engine && engine.getSolveStats && engine.getSolveStats();
  const errs = stats && Array.isArray(stats.constraintErrors) ? stats.constraintErrors : [];
  const ids = new Set(errs.map((e) => e.id).filter((id) => id != null));
  const keys = new Set(errs.map(constraintKey).filter(Boolean));
  return new Set(cons.filter((c) => !(c.isDriven || c.driven) && ((c.id != null && ids.has(c.id)) || keys.has(constraintKey(c)))));
}

// TASK 485: picking a dimension / constraint in a list selects the CONSTRAINT, not the geometry that was selected before (`extend` = Shift
// keeps it): otherwise Delete removed the constraint AND that geometry. Shared by this panel and the Parameters window (TASK 535-4).
export function toggleConstraintSelection(state, c, extend = false) {
  if (!extend) { if (state.selectedShapes instanceof Set) state.selectedShapes.clear(); if (state.selectedJoints instanceof Set) state.selectedJoints.clear(); }
  if (!(state.selectedConstraints instanceof Set)) state.selectedConstraints = new Set();
  if (state.selectedConstraints.has(c)) state.selectedConstraints.delete(c);
  else state.selectedConstraints.add(c);
}

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
  const knownSketchIds = new Set(); // sketches already seen — a new one starts collapsed, then follows the caret
  const el = document.createElement('div'); el.className = 'sk-info';
  const dofEl = document.createElement('div'); dofEl.className = 'sk-info-dof';
  const listEl = document.createElement('div'); listEl.className = 'sk-info-list';
  el.append(dofEl, listEl);

  function totalDOF() {
    try {
      const { dof } = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes || [], constraints: state.constraints || [] });
      return dof;
    } catch (_) { return null; }
  }

  // One constraint row (icon + label + geometry + value), click toggles state.selectedConstraints (the renderer
  // auto-highlights); hovering sets state.hoveredConstraint, which the renderer lights up with the geometry it binds.
  // SKETCH-3: `linkTo` (the other sketch name(s)) marks a CROSS-SKETCH link — a `⇄ Sketch N` reference + a .sk-link-row.
  let geoLabel = labelGeometry([]);
  let failing = new Set();
  let hoveredByPanel = null;
  function buildRow(c, sel, linkTo) {
    const m = typeMeta(c.type);
    const label = rowLabel(c);
    const row = document.createElement('button'); row.type = 'button'; row.className = 'sk-info-row' + (linkTo ? ' sk-link-row' : '') + (failing.has(c) ? ' err' : '');
    if (sel && sel.has(c)) row.classList.add('sel');
    const driven = (c.isDriven || c.driven) ? ' <span class="sk-info-val">(ref)</span>' : '';
    const val = (typeof c.value === 'number') ? ` <span class="sk-info-val">${formatConstraintValue(c)}</span>` : '';
    const link = linkTo ? ` <span class="sk-link-to" title="Cross-sketch link">⇄ ${linkTo}</span>` : '';
    const geo = constraintGeometryText(c, (state && state.shapes) || [], geoLabel);
    row.innerHTML = `<span class="sk-info-ic">${m.icon}</span><span class="sk-info-lbl">${label}</span><span class="sk-info-geo">${geo}</span>${val}${driven}${link}`;
    row.addEventListener('mouseenter', () => { hoveredByPanel = c; state.hoveredConstraint = c; });
    row.addEventListener('mouseleave', () => { if (state.hoveredConstraint === c) state.hoveredConstraint = null; if (hoveredByPanel === c) hoveredByPanel = null; });
    row.addEventListener('click', (ev) => {
      toggleConstraintSelection(state, c, !!(ev && ev.shiftKey));
      refresh(); // update the row highlight; the canvas auto-highlights via the renderer reading the Set
    });
    return row;
  }

  // TASK 577: drag a sketch's grip to reorder (pointer events: a mouse and a finger alike). The drop position is read from the sketch
  // nodes' rectangles; the order change is reorderSketch (one undo step), the same function the up / down buttons use.
  function startReorder(e, grip, node, sk) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const nodes = () => [...listEl.querySelectorAll('.sk-sketch-node')];
    let drop = null; // { index } = the final index in state.sketches
    node.classList.add('dragging');
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer has no capture: the move / up listeners below still run on the grip */ }
    const slot = (y) => {
      const list = nodes(); const from = state.sketches.findIndex((s) => s.id === sk.id);
      let to = list.length - 1;
      for (let i = 0; i < list.length; i++) { const r = list[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { to = i > from ? i - 1 : i; break; } }
      return Math.max(0, to);
    };
    const mark = (to) => {
      const list = nodes(); const from = state.sketches.findIndex((s) => s.id === sk.id);
      list.forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      if (to === from || !list[to]) return;
      list[to].classList.add(to < from ? 'drop-before' : 'drop-after');
    };
    const onMove = (ev) => { drop = { index: slot(ev.clientY) }; mark(drop.index); };
    const finish = (ev) => {
      grip.removeEventListener('pointermove', onMove); grip.removeEventListener('pointerup', finish); grip.removeEventListener('pointercancel', cancel);
      try { grip.releasePointerCapture(ev.pointerId); } catch (_) { /* nothing captured */ }
      const to = drop ? drop.index : null;
      if (to != null) reorderSketch(state, sk.id, to);
      refresh();
    };
    const cancel = (ev) => { drop = null; finish(ev); };
    grip.addEventListener('pointermove', onMove); grip.addEventListener('pointerup', finish); grip.addEventListener('pointercancel', cancel);
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
    geoLabel = labelGeometry((state && state.shapes) || []);
    failing = failingConstraints(engine, cons);

    // Rows grouped by type under a light "<Type> · <n>" sub-header; failing constraints first, in the error colour.
    function appendGrouped(wrap, items) {
      const groups = new Map();
      const add = (key, it, err) => { if (!groups.has(key)) groups.set(key, { err, items: [] }); groups.get(key).items.push(it); };
      for (const it of items) add(failing.has(it.c) ? 'Problems' : rowLabel(it.c), it, failing.has(it.c));
      const rank = (k) => (k === 'Problems' ? -1 : (GROUP_ORDER.indexOf(k) < 0 ? GROUP_ORDER.length : GROUP_ORDER.indexOf(k)));
      for (const k of [...groups.keys()].sort((a, b) => rank(a) - rank(b))) {
        const g = groups.get(k);
        const h = document.createElement('div'); h.className = 'sk-info-grp' + (g.err ? ' err' : ''); h.textContent = `${k} · ${g.items.length}`;
        wrap.appendChild(h);
        for (const it of g.items) wrap.appendChild(buildRow(it.c, sel, it.linkTo));
      }
    }

    // SKETCH-1b: when opted in, a sketch-ROOTED tree — a Sketch node per state.sketches with its constraints nested as
    // children (bucketed via constraintSketch; single-sketch → all under 'Sketch 1'). DEFAULT (off) = the FLAT list →
    // SketchStudio byte-identical. (Multi-sketch UX = S-2; cross-sketch links = S-3.)
    if (showSketchTree) {
      // SKETCH-2a: header with a '+' new-sketch action (appends 'Sketch N' + activates it; snapshots for undo).
      const hdr = document.createElement('div'); hdr.className = 'sk-tree-hdr';
      const title = document.createElement('span'); title.className = 'sk-tree-title'; title.textContent = 'Sketches';
      const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'sk-tree-add'; addBtn.title = 'New sketch'; addBtn.textContent = '+';
      addBtn.addEventListener('click', () => { recordUndo(state, 'new sketch'); const sk = addSketch(state); activateSketch(state, sk.id); refresh(); });
      // TASK 577: "Move selection to sketch": the same moveSelectionToSketch the canvas context menu runs
      const moveSel = document.createElement('select'); moveSel.className = 'sk-tree-move'; moveSel.title = 'Move the selected shapes to a sketch';
      moveSel.setAttribute('aria-label', 'Move selection to sketch');
      const ph = document.createElement('option'); ph.value = ''; ph.textContent = 'Move to sketch…'; moveSel.appendChild(ph);
      for (const t of moveTargets(state)) { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; moveSel.appendChild(o); }
      moveSel.addEventListener('change', () => {
        const target = moveSel.value; if (!target) return;
        const r = moveSelectionToSketch(state, target);
        if (!r.ok) showNotification('Cannot move to that sketch: ' + r.reason + '.', 'warning');
        refresh();
      });
      hdr.append(title, moveSel, addBtn); listEl.appendChild(hdr);

      const sketches = (state && Array.isArray(state.sketches) && state.sketches.length) ? state.sketches : [{ id: DEFAULT_SKETCH_ID, name: DEFAULT_SKETCH_NAME }];
      const activeId = (state && state.activeSketchId) || DEFAULT_SKETCH_ID;
      const nameById = new Map(sketches.map((s) => [s.id, s.name])); // SKETCH-3: for the cross-sketch link reference
      for (const sk of sketches) {
        if (!knownSketchIds.has(sk.id)) { knownSketchIds.add(sk.id); collapsedSketchIds.add(sk.id); } // collapsed by default
        const kids = cons.filter((c) => { const s = constraintSketch(c, state); return s === sk.id || (s instanceof Set && s.has(sk.id)); });
        const collapsed = collapsedSketchIds.has(sk.id);
        const node = document.createElement('div'); node.className = 'sk-sketch-node' + (sk.visible === false ? ' is-hidden' : '') + (sk.locked === true ? ' is-locked' : ''); node.dataset.sketchId = sk.id;
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
            if (save && v && v !== sk.name) { recordUndo(state, 'rename sketch'); sk.name = v; }
            refresh();
          };
          input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } });
          input.addEventListener('blur', () => finish(true));
          name.replaceWith(input); input.focus(); input.select();
        });
        const dot = document.createElement('span'); dot.className = 'sk-sketch-dot'; dot.textContent = '●';
        const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'sk-sketch-eye';
        eye.textContent = sk.visible === false ? '◌' : '◉'; eye.title = sk.visible === false ? 'Show sketch' : 'Hide sketch';
        eye.addEventListener('click', (e) => { e.stopPropagation(); recordUndo(state, 'toggle sketch visibility'); sk.visible = sk.visible === false; state.soloMemory = null; refresh(); });
        const count = document.createElement('span'); count.className = 'sk-info-val'; count.textContent = String(kids.length);
        // TASK 577: grip (drag to reorder), up / down (touch + keyboard twins of the drag), solo, lock. Each acts through the model.
        const stop = (fn) => (e) => { e.stopPropagation(); fn(); refresh(); };
        const idx = sketches.indexOf(sk);
        const grip = document.createElement('span'); grip.className = 'sk-sketch-grip'; grip.textContent = '⠿'; grip.title = 'Drag to reorder';
        grip.addEventListener('click', (e) => e.stopPropagation());
        grip.addEventListener('pointerdown', (e) => startReorder(e, grip, node, sk));
        const mkBtn = (cls, text, title, onClick, disabled) => {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'sk-sketch-btn ' + cls; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
          if (disabled) b.disabled = true; b.addEventListener('click', stop(onClick)); return b;
        };
        const up = mkBtn('sk-sketch-up', '▴', 'Move sketch up', () => moveSketchBy(state, sk.id, -1), idx === 0);
        const down = mkBtn('sk-sketch-down', '▾', 'Move sketch down', () => moveSketchBy(state, sk.id, 1), idx === sketches.length - 1);
        const soloed = isSoloed(state, sk.id);
        const solo = mkBtn('sk-sketch-solo' + (soloed ? ' on' : ''), '◎', soloed ? 'Show all sketches again' : 'Show only this sketch', () => soloSketch(state, sk.id));
        const locked = sk.locked === true;
        const lock = mkBtn('sk-sketch-lock' + (locked ? ' on' : ''), locked ? '🔒' : '🔓', locked ? 'Unlock sketch' : 'Lock sketch', () => {
          const r = setSketchLocked(state, sk.id, !locked);
          if (!r.ok) showNotification('Cannot lock "' + sk.name + '": ' + r.reason + '.', 'warning');
        });
        head.append(grip, caret, name, dot, up, down, solo, lock, eye, count);
        // activating = new geometry goes here: a LOCKED sketch refuses (activateSketch); its lock button unlocks it
        head.addEventListener('click', () => { if (locked) showNotification('"' + sk.name + '" is locked: unlock it to draw in it.', 'info'); activateSketch(state, sk.id); refresh(); }); // activate (sub-elements stop their own clicks)
        node.appendChild(head);
        if (!collapsed) {
          const childWrap = document.createElement('div'); childWrap.className = 'sk-sketch-children';
          if (!kids.length) { const e = document.createElement('div'); e.className = 'sk-sketch-empty'; e.textContent = 'No constraints yet.'; childWrap.appendChild(e); }
          else appendGrouped(childWrap, kids.map((c) => {
            const cs = constraintSketch(c, state); // a Set → spanning → a cross-sketch link naming the OTHER sketch(es)
            const linkTo = (cs instanceof Set) ? [...cs].filter((id) => id !== sk.id).map((id) => nameById.get(id) || id).join(', ') : null;
            return { c, linkTo };
          }));
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
    destroy: () => { if (hoveredByPanel && state.hoveredConstraint === hoveredByPanel) state.hoveredConstraint = null; try { el.remove(); } catch (_) {} },
  };
}
