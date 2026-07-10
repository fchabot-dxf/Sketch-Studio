// apps/penplotter/src/sketch-stage.js — PP-7a/PP-7b: the OPTIONAL Sketch stage IS the shared #core/#ui Design tab,
// embedded UNCHANGED — the very same sketcher Studio & Shaper mount. It gets its OWN <svg> canvas (NOT the shared
// plotter #canvasWrap), the CAD DOF-color --sk-* palette (distinct from the warm pen stages), and a RAF tied to the
// active stage (start on enter / stop on leave) so the solve->draw loop never runs while hidden. MIRRORS
// apps/shaper/src/main.js's ensureSketch / buildDesignUI / panelTick.
//
// PP-7b — the SEAM: a "Bake to Draw" action solves the sketch, flattens each solved #core shape into a plotter art
// polyline via #core/core-shape-to-polyline, drops them into a NEW art layer, and hands off to Draw. From there the
// existing Draw/Fill/Toolpath/Export pipeline carries the geometry to G-code (the DOF->pen-color switch happens at
// the bake: the sketch stays DOF-colored SOURCE; the baked layer is pen-color art). Host wiring ONLY — #ui/#core
// stay BYTE-IDENTICAL, so the Studio & Shaper Design tabs cannot regress.

import { mountSketch } from '#ui/sketch-canvas.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';
import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js'; // PP-7b: the #core sketch -> polyline seam
import { state, makeArtLayer, uid } from './state.js';                  // PP-7b: bake into the plotter art store
import { installFreehandTool } from './freehand-tool.js';               // UNIFY-4b: plotter-side Freehand -> #core beziers

const FREEHAND_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 16 C 7 6, 10 6, 12 12 S 17 18, 21 8"/></svg>';

const PANEL_COLLAPSED_KEY = 'penplotter-sketch-panel-collapsed';

// The Design-tab DOM contract (identical shape to apps/shaper/index.html #design-view): a full-width tool ribbon on
// top, a collapsible panel (the "Bake to Draw" action + the info/DOF panel) beside the sketcher's own svg canvas.
const SCAFFOLD = `
  <div id="design-view">
    <div id="design-ribbon"></div>
    <div id="design-body">
      <aside id="design-panel">
        <button id="design-panel-toggle" title="Collapse panel" aria-label="Toggle panel">&#9664;</button>
        <div id="design-panel-actions">
          <button id="bakeToDraw" class="dp-btn dp-primary" title="Solve, then bake the sketch geometry into a Draw art layer">Bake to Draw</button>
        </div>
        <div id="design-panel-info"></div>
      </aside>
      <svg id="design-canvas" viewBox="-60 -45 120 90" preserveAspectRatio="xMidYMid meet"></svg>
    </div>
  </div>`;

export function mountSketchStage(view, ctx = {}) {
  view.innerHTML = SCAFFOLD;

  let controller = null, infoPanel = null, ribbon = null, lastSig = '';

  // Signature-gated refresh of the ribbon + info panel, driven by mountSketch's onRender each solved frame (active
  // tool / constraint count / values / selection / geometry counts). Mirrors Shaper's panelTick — the sig includes
  // shapes/joints so DRAWING geometry (which may add no constraint) still refreshes the DOF readout.
  const panelTick = () => {
    if (!controller) return;
    const s = controller.state;
    // UNIFY-4b selection reconcile: mirror the #core selection -> the plotter's selectedShapeIds each frame (only
    // runs while Design is active, so it can't clobber a pen-stage selection), so a selected #core shape (incl. a
    // freehand bezier) flows into the existing selection-based toolpath targeting (collectToolpathShapes fallback).
    if (s.selectedShapes) state.selectedShapeIds = new Set(s.selectedShapes);
    let vsum = 0; for (const c of s.constraints) if (typeof c.value === 'number') vsum += c.value;
    const nShapes = (s.shapes && s.shapes.length) || 0;
    const nJoints = (s.joints && s.joints.size) || 0;
    const sig = s.constraints.length + ':' + nShapes + ':' + nJoints + ':' + vsum.toFixed(1) + ':' +
      (s.selectedConstraints ? s.selectedConstraints.size : 0) + ':' + s.currentTool;
    if (sig !== lastSig) { lastSig = sig; if (ribbon) ribbon.refresh(); if (infoPanel) infoPanel.refresh(); }
  };

  // Mount the shared sketcher ONCE into the stage's OWN svg. isActive (from the router) gates the document-level
  // input listeners to the Sketch stage, so an inactive tab can't hijack the pen-stage keyboard/wheel.
  controller = mountSketch(view.querySelector('#design-canvas'), {
    isActive: ctx.isActive || (() => true),
    onRender: panelTick,
  });
  state.coreSketch = controller.state; // UNIFY-2: expose the #core sketch store so a toolpath can target it directly

  // Design UI (buildDesignUI mirror): the shared full-width tool ribbon on top + the live constraint/DOF info panel
  // beside the untouched canvas. Both are the SAME #ui factories Studio & Shaper use, read from the shared state.
  infoPanel = createDesignInfoPanel({ state: controller.state, engine: controller.engine, showSketchTree: true });
  infoPanel.render(view.querySelector('#design-panel-info'));
  // UNIFY-4b: add a FREEHAND button to the shared ribbon via the host extraGroups seam (#ui unchanged). It is an
  // action button (not a #ui tool-mode) that sets state.currentTool='freehand'; the plotter-side capture listener
  // (installFreehandTool) does the drawing. A real #core tool click ('tool' event) deactivates it.
  const freehandActive = (on) => { const b = view.querySelector('#freehand-btn'); if (b) b.classList.toggle('active', on); };
  ribbon = createToolRibbon({
    state: controller.state,
    extraGroups: [{ label: 'Draw', buttons: [{
      id: 'freehand-btn', label: 'Freehand', svg: FREEHAND_ICON, title: 'Freehand — draw a stroke, fitted to smooth beziers',
      onClick: () => { controller.state.currentTool = 'freehand'; ribbon.refresh(); freehandActive(true); },
    }] }],
    on: (name) => { if (name === 'tool') freehandActive(false); }, // a #core tool switch turns Freehand off
  });
  ribbon.render(view.querySelector('#design-ribbon'));
  // The plotter-side Freehand capture tool on the sketcher's OWN canvas: stroke -> fitCubic -> makeBezier -> #core.
  installFreehandTool(view.querySelector('#design-canvas'), controller);

  // Collapsible side panel: chevron toggles a thin strip <-> full panel (canvas reflows wider); persisted.
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

  // PP-7b — "Bake to Draw": solve the sketch, flatten each solved #core shape to a plotter art polyline, drop them
  // into a NEW art layer, and hand off to Draw. The #core sketch stays the SOURCE (re-baking re-derives); the art
  // layer is its baked projection into the pen-color world.
  const bake = () => {
    controller.engine.solve(500); // ensure final solved positions (belt-and-suspenders over the RAF)
    const s = controller.state;
    const shapes = [];
    for (const sh of s.shapes) {
      const pts = coreShapeToPolyline(sh, s.joints);
      if (pts.length >= 2) shapes.push({ id: uid('s'), type: 'polyline', points: pts });
    }
    if (!shapes.length) return; // nothing solved to bake
    const layer = makeArtLayer('Sketch bake');
    layer.shapes = shapes;
    state.artLayers.push(layer);
    state.activeArtLayerId = layer.id;
    if (ctx.navigate) ctx.navigate('draw'); // hand off to the pen-color pipeline (Draw/Fill/Toolpath/Export)
  };
  const bakeBtn = view.querySelector('#bakeToDraw');
  if (bakeBtn) bakeBtn.addEventListener('click', bake);

  if (typeof window !== 'undefined') window.__sketch = { controller, panelTick, bake }; // dev/test seam

  // RAF lifecycle tied to the active stage — the same start()/stop() Shaper drives from showMode: run the
  // solve->draw loop only while Sketch is showing. onEnter is idempotent (mountSketch's start guards a 2nd RAF).
  return {
    onEnter: () => controller.start(),
    onLeave: () => controller.stop(),
  };
}
