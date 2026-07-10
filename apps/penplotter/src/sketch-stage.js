// apps/penplotter/src/sketch-stage.js — the merged 'Design' tab: the shared #core/#ui sketcher, embedded UNCHANGED.
// Its OWN <svg> canvas (NOT the plotter #canvasWrap), a RAF tied to the active stage (start on enter / stop on
// leave), and — host-side, #ui byte-identical — a FREEHAND tool (UNIFY-4b) + a pen-color UNDERLAY (UNIFY-4c).
//
// UNIFY-4c: a per-shape DIGITAL color (state.shapeColors) editable via a Design-tab color control, drawn beneath the
// sketcher in its MAPPED PHYSICAL pen color (penColorForShape) by an underlay <svg> — rendered ON CHANGE
// (dirty-flagged), NOT per frame. The sketcher draws the DOF/scaffold on the transparent canvas ON TOP.
// PP-7b's "Bake to Draw" stays DORMANT (one-store; toolpaths target #core directly via UNIFY-2). Host wiring ONLY.

import { mountSketch } from '#ui/sketch-canvas.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js'; // PP-7b/UNIFY-4c: #core shape -> polyline
import { state, makeArtLayer, uid, penColorForShape } from './state.js'; // UNIFY-4c: mapped physical pen color
import { installFreehandTool } from './freehand-tool.js';               // UNIFY-4b: plotter-side Freehand -> #core beziers

const PANEL_COLLAPSED_KEY = 'penplotter-sketch-panel-collapsed';
const FREEHAND_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 16 C 7 6, 10 6, 12 12 S 17 18, 21 8"/></svg>';

// The Design-tab DOM: the shared ribbon on top, a collapsible panel (Freehand lives in the ribbon; Bake + the
// per-shape color control live here), and the canvas WRAP holding the pen-color underlay BENEATH the sketcher svg.
const SCAFFOLD = `
  <div id="design-view">
    <div id="design-ribbon"></div>
    <div id="design-body">
      <aside id="design-panel">
        <button id="design-panel-toggle" title="Collapse panel" aria-label="Toggle panel">&#9664;</button>
        <div id="design-panel-actions">
          <button id="bakeToDraw" class="dp-btn dp-primary" title="Solve, then bake the sketch geometry into a Draw art layer">Bake to Draw</button>
          <div id="shape-color-row" class="dp-field">
            <label for="shapeColor">Pen color</label>
            <input id="shapeColor" type="color" value="#000000" disabled title="Select a shape, then pick its digital color">
          </div>
        </div>
        <div id="design-panel-info"></div>
      </aside>
      <div id="design-canvas-wrap">
        <svg id="pen-underlay" viewBox="-60 -45 120 90" preserveAspectRatio="xMidYMid meet"></svg>
        <svg id="design-canvas" viewBox="-60 -45 120 90" preserveAspectRatio="xMidYMid meet"></svg>
      </div>
    </div>
  </div>`;

export function mountSketchStage(view, ctx = {}) {
  view.innerHTML = SCAFFOLD;
  const underlay = view.querySelector('#pen-underlay');
  const designCanvas = view.querySelector('#design-canvas');
  const colorInput = view.querySelector('#shapeColor');

  let controller = null, infoPanel = null, ribbon = null, lastSig = '', lastUSig = '', underlayDirty = true;

  // UNIFY-throttle: a shape is STATIC (drawn by the color underlay; SKIPPED by the per-frame sketcher — perf, and its
  // joint glyphs are suppressed) ONLY when the plotter has MARKED it static (state.staticShapeIds — imported/dense
  // geometry) AND it is not currently selected. Freehand/drawn/selected geometry is LIVE: the sketcher draws it with
  // its JOINTS (editable). Selecting a static shape ACTIVATES it (live); deselecting returns it to static. #14: this
  // is why a fresh freehand bezier shows its endpoint joints (it's never marked static -> live).
  const isStatic = (sh) => state.staticShapeIds.has(sh.id) &&
    !(controller && controller.state.selectedShapes && controller.state.selectedShapes.has(sh.id));

  // UNIFY-throttle: gate the per-frame solve to when geometry is being MANIPULATED (a drag, a selected/active edit).
  // Idle frames skip solve (each call is ~1.3s at 13k joints); the last-solved geometry stays put. Discrete changes
  // solve explicitly (after mount / freehand commit). Studio/Shaper (no shouldSolve) always solve -> byte-identical.
  const shouldSolve = () => {
    const s = controller && controller.state;
    return !!(s && (s.drag || s.active || (s.selectedShapes && s.selectedShapes.size > 0)));
  };

  // UNIFY-4c: keep the underlay's viewBox aligned with the sketcher's (pan/zoom mutates the canvas viewBox). CHEAP —
  // a per-frame attribute copy, NOT a re-render; the path rebuild is dirty-flagged (renderUnderlay).
  const syncUnderlayView = () => {
    if (!underlay || !designCanvas) return;
    const vb = designCanvas.getAttribute('viewBox');
    if (vb && underlay.getAttribute('viewBox') !== vb) underlay.setAttribute('viewBox', vb);
  };
  // Rebuild the underlay paths: each #core shape flattened (coreShapeToPolyline) + stroked in its MAPPED pen color.
  const renderUnderlay = () => {
    if (!underlay || !controller) return;
    const s = controller.state, parts = [];
    for (const sh of s.shapes) {
      if (!isStatic(sh)) continue; // live (selected) shapes are drawn by the sketcher (DOF) — not the underlay
      const pts = coreShapeToPolyline(sh, s.joints);
      if (!pts || pts.length < 2) continue;
      const d = 'M ' + pts.map(p => p[0] + ' ' + p[1]).join(' L ');
      parts.push('<path data-shape-id="' + sh.id + '" d="' + d + '" fill="none" stroke="' + penColorForShape(sh.id) + '" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round"/>');
    }
    underlay.innerHTML = parts.join('');
  };

  // Signature-gated ribbon/info refresh (Shaper's panelTick) + the UNIFY-4b selection mirror + UNIFY-4c underlay
  // sync/render + the color control's reflect.
  const panelTick = () => {
    if (!controller) return;
    const s = controller.state;
    // UNIFY-4b: mirror the #core selection -> the plotter's selectedShapeIds (Design-active only) for toolpath targeting.
    if (s.selectedShapes) state.selectedShapeIds = new Set(s.selectedShapes);
    // UNIFY-4c: reflect the selected shape's digital color into the picker (enable when a shape is selected).
    const selIds = s.selectedShapes ? [...s.selectedShapes] : [];
    if (colorInput) {
      colorInput.disabled = selIds.length === 0;
      if (selIds.length && state.shapeColors.has(selIds[0]) && document.activeElement !== colorInput) {
        colorInput.value = state.shapeColors.get(selIds[0]);
      }
    }
    let vsum = 0; for (const c of s.constraints) if (typeof c.value === 'number') vsum += c.value;
    const nShapes = (s.shapes && s.shapes.length) || 0;
    const nJoints = (s.joints && s.joints.size) || 0;
    const sig = s.constraints.length + ':' + nShapes + ':' + nJoints + ':' + vsum.toFixed(1) + ':' +
      (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool;
    if (sig !== lastSig) { lastSig = sig; if (ribbon) ribbon.refresh(); if (infoPanel) infoPanel.refresh(); }
    // UNIFY-throttle: dirty the underlay on shape-count / SELECTION change (a shape entering/leaving the live set),
    // NOT on per-frame joint moves — so dragging a live shape does NOT rebuild the (static) underlay's many paths.
    const uSig = nShapes + '|' + state.staticShapeIds.size + '|' + (s.selectedShapes ? [...s.selectedShapes].sort().join(',') : '');
    if (uSig !== lastUSig) { lastUSig = uSig; underlayDirty = true; }
    syncUnderlayView();                                   // per frame (cheap) — alignment during pan/zoom
    if (underlayDirty) { renderUnderlay(); underlayDirty = false; } // rebuild paths only on change
  };

  // Mount the shared sketcher ONCE into the stage's OWN svg (isActive gates its document-level input listeners).
  controller = mountSketch(designCanvas, { isActive: ctx.isActive || (() => true), onRender: panelTick, isStatic, shouldSolve });
  state.coreSketch = controller.state; // UNIFY-2: a toolpath can target this #core geometry directly
  try { controller.engine.solve(500); } catch (_) {} // UNIFY-throttle: converge the seed once (per-frame solve is now gated)

  // Design UI: the shared info/DOF panel + the shared tool ribbon (+ a host FREEHAND button via extraGroups; #ui
  // unchanged). A #core tool click ('tool') de-highlights Freehand; the plotter-side capture tool does the drawing.
  infoPanel = createDesignInfoPanel({ state: controller.state, engine: controller.engine, showSketchTree: true });
  infoPanel.render(view.querySelector('#design-panel-info'));
  const freehandActive = (on) => { const b = view.querySelector('#freehand-btn'); if (b) b.classList.toggle('active', on); };
  ribbon = createToolRibbon({
    state: controller.state,
    extraGroups: [{ label: 'Draw', buttons: [{
      id: 'freehand-btn', label: 'Freehand', svg: FREEHAND_ICON, title: 'Freehand — draw a stroke, fitted to smooth beziers',
      onClick: () => { controller.state.currentTool = 'freehand'; ribbon.refresh(); freehandActive(true); },
    }] }],
    on: (name) => { if (name === 'tool') freehandActive(false); },
  });
  ribbon.render(view.querySelector('#design-ribbon'));
  installFreehandTool(designCanvas, controller, { onCommit: () => { underlayDirty = true; } });

  // Collapsible side panel (persisted).
  const panel = view.querySelector('#design-panel');
  const toggle = view.querySelector('#design-panel-toggle');
  const setCollapsed = (c) => {
    panel.classList.toggle('collapsed', c);
    toggle.textContent = c ? '▶' : '◀';
    toggle.title = c ? 'Expand panel' : 'Collapse panel';
    try { localStorage.setItem(PANEL_COLLAPSED_KEY, c ? '1' : '0'); } catch (_) { /* storage blocked */ }
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(PANEL_COLLAPSED_KEY) === '1'; } catch (_) {}
  setCollapsed(collapsed);
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  // UNIFY-4c: the per-shape DIGITAL color control — apply the picked color to every selected #core shape, then
  // re-render the underlay (which maps digital -> the nearest physical pen color).
  if (colorInput) colorInput.addEventListener('input', () => {
    const ids = controller.state.selectedShapes ? [...controller.state.selectedShapes] : [];
    for (const id of ids) state.shapeColors.set(id, colorInput.value);
    underlayDirty = true; renderUnderlay();
  });

  // PP-7b "Bake to Draw" — DORMANT (one store; toolpaths target #core directly). Kept until UNIFY-7 retires it.
  const bake = () => {
    controller.engine.solve(500);
    const s = controller.state, shapes = [];
    for (const sh of s.shapes) { const pts = coreShapeToPolyline(sh, s.joints); if (pts.length >= 2) shapes.push({ id: uid('s'), type: 'polyline', points: pts }); }
    if (!shapes.length) return;
    const layer = makeArtLayer('Sketch bake'); layer.shapes = shapes;
    state.artLayers.push(layer); state.activeArtLayerId = layer.id;
    if (ctx.navigate) ctx.navigate('draw');
  };
  const bakeBtn = view.querySelector('#bakeToDraw');
  if (bakeBtn) bakeBtn.addEventListener('click', bake);

  if (typeof window !== 'undefined') window.__sketch = { controller, panelTick, bake, renderUnderlay }; // dev/test seam

  // RAF lifecycle tied to the active stage. onEnter re-renders the underlay (catches palette edits made on other tabs).
  return {
    onEnter: () => { controller.start(); underlayDirty = true; },
    onLeave: () => controller.stop(),
  };
}
