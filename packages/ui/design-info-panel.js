// packages/ui/design-info-panel.js — the shared, data-driven Design OVERVIEW/MANAGE panel (S5b).
// Drops into a TabbedDockPanel tab (render(body)). Lists the sketch's constraints + a DOF readout, read from the
// SHARED state/engine. This is OVERVIEW/MANAGE only — the on-canvas glyphs, inline dim-edit, and snap/hover GUI
// STAY on the canvas; this panel never replaces them.
// Clicking a constraint row toggles state.selectedConstraints — the shared renderer ALREADY highlights selected
// constraints on the canvas, so the dock↔canvas highlight is automatic (no new plumbing).
// App-agnostic: imports only #core (constraint-status). Themed via --sk-*/--sk-dock-*. Self-contained styles.

import { constraintSketch, addSketch, activateSketch, DEFAULT_SKETCH_ID, DEFAULT_SKETCH_NAME,
  recordUndo, setSketchLocked, showOnlySketch, reorderSketch } from '#core/sketch-model.js'; // SKETCH-1b/2a: gated tree + multi-sketch; TASK 577: sketches as layers
import { deleteSketch } from '#core/delete-manager.js';
import { showContextMenu } from '#ui/context-menu.js';
import { createLongPress } from '#ui/long-press.js';
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
.sk-sketch-head { display: flex; align-items: center; gap: 6px; padding: 3px 6px; font-weight: 600; opacity: 0.92;
  user-select: none; border-radius: 6px; }
.sk-sketch-head:hover { background: var(--sk-info-hover, rgba(127,127,127,0.14)); }
/* SKETCH-2a: the ACTIVE sketch (new geometry lands in it) — accent bar + bold name + a dot. */
.sk-sketch-head.is-active { background: var(--sk-info-head, rgba(127,127,127,0.12)); box-shadow: inset 2px 0 0 var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-head.is-active .sk-sketch-name { font-weight: 800; }
.sk-sketch-tw { opacity: 0.55; font-size: 0.8em; width: 1em; text-align: center; cursor: pointer; }
.sk-sketch-tw:hover { opacity: 0.9; }
/* SKETCH-2b: inline rename field + the visibility (eye) toggle + a dimmed hidden node. */
.sk-sketch-rename { flex: 1; min-width: 0; font: inherit; font-weight: 600; color: inherit; padding: 1px 4px;
  background: var(--sk-info-head, rgba(127,127,127,0.14)); border: 1px solid var(--sk-dock-accent, var(--sk-selection, #4c9aff)); border-radius: 4px; }
.sk-sketch-node.is-hidden .sk-sketch-name { opacity: 0.5; font-style: italic; }
/* TASK 577: sketches as layers (Fusion browser row): eye | sketch icon (+ purple lock badge) | name | activate radio. */
.sk-sketch-eye, .sk-sketch-radio { background: transparent; border: 0; color: inherit; cursor: pointer; width: 26px; height: 26px; padding: 0; flex: none;
  display: flex; align-items: center; justify-content: center; border-radius: 6px; }
.sk-sketch-eye { opacity: 0.7; }
.sk-sketch-eye:hover, .sk-sketch-radio:hover:not(:disabled) { background: var(--sk-info-hover, rgba(127,127,127,0.18)); opacity: 1; }
.sk-sketch-radio { opacity: 0.8; }
.sk-sketch-radio:disabled { opacity: 0.3; cursor: not-allowed; }
.sk-sketch-eye svg, .sk-sketch-radio svg { display: block; }
.sk-sketch-icon { position: relative; width: 26px; height: 26px; flex: none; display: flex; align-items: center; justify-content: center; }
.sk-sketch-lockbadge { position: absolute; right: -3px; bottom: -3px; width: 15px; height: 15px; border-radius: 4px; background: #7c3aed; display: flex; align-items: center; justify-content: center; }
.sk-sketch-name { flex: 1; min-width: 0; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: pan-y; padding: 5px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sk-sketch-node.is-locked .sk-sketch-name { opacity: 0.7; }
.sk-sketch-node.drop-before > .sk-sketch-head { box-shadow: inset 0 3px 0 var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-node.drop-after > .sk-sketch-head { box-shadow: inset 0 -3px 0 var(--sk-dock-accent, var(--sk-selection, #4c9aff)); }
.sk-sketch-node.dragging { opacity: 0.45; }
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

// TASK 577: the sketch row icons: inline SVG copied from the owner-approved mockup (stroke icons use currentColor; the sketch icon and the lock badge carry their own colours).
const ICONS = {
  eye: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  eyeOff: '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 2l12 12M6.3 4A7 7 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M10.1 11.9A6 6 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11 11 0 0 1 2.3-2.8"/></svg>',
  sketch: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="15" rx="2.5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="1.2"/><path d="M5.5 15L8.5 7.5 14 10.5" stroke="#2563eb" stroke-width="1.6" stroke-linejoin="round"/><circle cx="5.5" cy="15" r="1.6" fill="#ffffff" stroke="#2563eb" stroke-width="1.2"/><circle cx="8.5" cy="7.5" r="1.6" fill="#ffffff" stroke="#2563eb" stroke-width="1.2"/><circle cx="14" cy="10.5" r="1.6" fill="#ffffff" stroke="#2563eb" stroke-width="1.2"/><path d="M15.5 16.5l5-5" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/><path d="M14.3 17.7l1.2-1.2" stroke="#334155" stroke-width="1.6" stroke-linecap="round"/></svg>',
  lockBadge: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#ffffff" stroke-width="2" aria-hidden="true"><rect x="3" y="7.5" width="10" height="6.5" rx="1"/><path d="M5.3 7.5V5.3a2.7 2.7 0 0 1 5.4 0v2.2"/></svg>',
  radioOn: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="9" r="3.5" fill="currentColor"/></svg>',
  radioOff: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/></svg>',
  right: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
  down: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>',
};

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
  const listEl = document.createElement('div'); listEl.className = 'sk-info-list';
  el.append(listEl);


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

  // TASK 577: drag a sketch's NAME to reorder (pointer events: a mouse and a finger alike; a mouse drags after a few px, a finger after a
  // short hold so a quick swipe still scrolls). The drop position is read from the sketch nodes' rectangles; the change is reorderSketch
  // (one undo step). A touch HOLD that stays still opens the row menu through the ONE long-press detector (task 562).
  const DRAG_HOLD_MS = 250, DRAG_SLOP = 4;
  function wireRow(head, name, node, sk, openMenu) {
    let lastType = 'mouse';
    head.addEventListener('contextmenu', (e) => { e.preventDefault(); if (lastType !== 'touch') openMenu(e.clientX, e.clientY, false); }); // a touch hold is the long press below
    const lp = createLongPress({ onFire: (x, y) => { cancelDrag(); openMenu(x, y, true); } });
    let drag = null; // { id, x, y, armed, moved, timer, drop }
    const nodes = () => [...listEl.querySelectorAll('.sk-sketch-node')];
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
    function cancelDrag() {
      if (!drag) return;
      clearTimeout(drag.timer); drag = null; node.classList.remove('dragging');
      nodes().forEach((n) => n.classList.remove('drop-before', 'drop-after'));
    }
    head.addEventListener('pointerdown', (e) => {
      lastType = e.pointerType || 'mouse';
      if (e.target.closest && e.target.closest('button')) return; // the eye / radio act alone
      if (e.button !== undefined && e.button !== 0) return;
      const touch = lastType === 'touch';
      if (touch) lp.start(e);
      if (e.target !== name) return;
      const d = { id: e.pointerId, x: e.clientX, y: e.clientY, armed: !touch, moved: false, drop: null, timer: null };
      if (touch) d.timer = setTimeout(() => { d.armed = true; }, DRAG_HOLD_MS);
      drag = d;
      try { name.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer has no capture: the move / up listeners below still run on the name */ }
    });
    name.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (e.pointerType === 'touch') lp.move(e);
      if (!drag.armed) { if (far > 8) { lp.cancel(); cancelDrag(); } return; } // a finger that moved before the hold is a scroll, not a drag
      if (!drag.moved && far <= DRAG_SLOP) return;
      if (!drag.moved) { drag.moved = true; lp.cancel(); node.classList.add('dragging'); }
      drag.drop = slot(e.clientY); mark(drag.drop);
    });
    // a touch drag must not scroll the panel: the hold armed it, so the browser's own pan is cancelled from here on
    name.addEventListener('touchmove', (e) => { if (drag && drag.armed && e.cancelable) e.preventDefault(); }, { passive: false });
    const end = (e, commit) => {
      lp.cancel();
      if (!drag || e.pointerId !== drag.id) return;
      const to = commit && drag.moved ? drag.drop : null;
      try { name.releasePointerCapture(e.pointerId); } catch (_) { /* nothing captured */ }
      cancelDrag();
      if (to != null) { reorderSketch(state, sk.id, to); refresh(); }
    };
    name.addEventListener('pointerup', (e) => end(e, true));
    name.addEventListener('pointercancel', (e) => end(e, false));
    head.addEventListener('pointerup', () => lp.cancel());
  }

  function refresh() {
    const cons = (state && Array.isArray(state.constraints)) ? state.constraints : [];
    const sel = (state && state.selectedConstraints instanceof Set) ? state.selectedConstraints : null;
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
      hdr.append(title, addBtn); listEl.appendChild(hdr);

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
        const caret = document.createElement('span'); caret.className = 'sk-sketch-tw' + (collapsed ? ' is-collapsed' : ''); caret.innerHTML = collapsed ? ICONS.right : ICONS.down;
        caret.addEventListener('click', (e) => { e.stopPropagation(); if (collapsedSketchIds.has(sk.id)) collapsedSketchIds.delete(sk.id); else collapsedSketchIds.add(sk.id); refresh(); });
        const name = document.createElement('span'); name.className = 'sk-sketch-name'; name.textContent = sk.name;
        const locked = sk.locked === true;
        // inline rename (SKETCH-2b): a double click on the name, or "Rename" in the row menu
        const startRename = () => {
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
        };
        name.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(); });
        const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'sk-sketch-eye';
        eye.innerHTML = sk.visible === false ? ICONS.eyeOff : ICONS.eye; eye.title = sk.visible === false ? 'Show sketch' : 'Hide sketch'; eye.setAttribute('aria-label', eye.title);
        eye.addEventListener('click', (e) => { e.stopPropagation(); recordUndo(state, 'toggle sketch visibility'); sk.visible = sk.visible === false; refresh(); });
        const icon = document.createElement('span'); icon.className = 'sk-sketch-icon'; icon.innerHTML = ICONS.sketch;
        if (locked) { const badge = document.createElement('span'); badge.className = 'sk-sketch-lockbadge'; badge.title = 'Locked'; badge.innerHTML = ICONS.lockBadge; icon.appendChild(badge); }
        const isActive = sk.id === activeId;
        const radio = document.createElement('button'); radio.type = 'button'; radio.className = 'sk-sketch-radio' + (isActive ? ' on' : '');
        radio.innerHTML = isActive ? ICONS.radioOn : ICONS.radioOff; radio.setAttribute('role', 'radio'); radio.setAttribute('aria-checked', isActive ? 'true' : 'false');
        radio.title = locked ? 'Locked: unlock it to draw in it' : (isActive ? 'The active sketch' : 'Make this the active sketch'); radio.setAttribute('aria-label', 'Make "' + sk.name + '" the active sketch');
        if (locked) radio.disabled = true;
        radio.addEventListener('click', (e) => { e.stopPropagation(); activateSketch(state, sk.id); refresh(); });
        // the row menu (right click; a touch hold): Lock / Unlock, Show only this sketch, Rename, Delete
        const openMenu = (x, y, touch) => showContextMenu({ x, y, touch, returnFocusTo: head, items: [
          { id: 'sk-lock', label: locked ? 'Unlock' : 'Lock', onSelect: () => {
            const r = setSketchLocked(state, sk.id, !locked);
            if (!r.ok) showNotification('Cannot lock "' + sk.name + '": ' + r.reason + '.', 'warning');
            refresh();
          } },
          { id: 'sk-only', label: 'Show only this sketch', onSelect: () => { showOnlySketch(state, sk.id); refresh(); } },
          { id: 'sk-rename', label: 'Rename', onSelect: startRename },
          { id: 'sk-delete', label: 'Delete', onSelect: () => {
            const r = deleteSketch(state, sk.id);
            if (!r.ok) showNotification('Cannot delete "' + sk.name + '": ' + r.reason + '.', 'warning');
            refresh();
          } },
        ] });
        wireRow(head, name, node, sk, openMenu);
        head.append(caret, eye, icon, name, radio);
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
