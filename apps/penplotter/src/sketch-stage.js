// apps/penplotter/src/sketch-stage.js — PP-7a (north-star capstone): the OPTIONAL Sketch stage IS the shared
// #core/#ui Design tab, embedded UNCHANGED — the very same sketcher Studio & Shaper mount. It gets its OWN <svg>
// canvas (NOT the shared plotter #canvasWrap), the CAD DOF-color --sk-* palette (distinct from the warm pen
// stages), and a RAF tied to the active stage (start on enter / stop on leave) so the solve->draw loop never runs
// while hidden. MIRRORS apps/shaper/src/main.js's ensureSketch / buildDesignUI / panelTick. No seam to the plotter
// art yet (that's PP-7b: coreShapeToPolyline). Host wiring ONLY — #ui/#core stay BYTE-IDENTICAL, so the Studio &
// Shaper Design tabs cannot regress.

import { mountSketch } from '#ui/sketch-canvas.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';
import { createToolRibbon } from '#ui/tool-ribbon.js';

const PANEL_COLLAPSED_KEY = 'penplotter-sketch-panel-collapsed';

// The Design-tab DOM contract (identical shape to apps/shaper/index.html #design-view): a full-width tool ribbon on
// top, a collapsible info/DOF panel beside the sketcher's own svg canvas.
const SCAFFOLD = `
  <div id="design-view">
    <div id="design-ribbon"></div>
    <div id="design-body">
      <aside id="design-panel">
        <button id="design-panel-toggle" title="Collapse panel" aria-label="Toggle panel">&#9664;</button>
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

  // Design UI (buildDesignUI mirror): the shared full-width tool ribbon on top + the live constraint/DOF info panel
  // beside the untouched canvas. Both are the SAME #ui factories Studio & Shaper use, read from the shared state.
  infoPanel = createDesignInfoPanel({ state: controller.state, engine: controller.engine, showSketchTree: true });
  infoPanel.render(view.querySelector('#design-panel-info'));
  ribbon = createToolRibbon({ state: controller.state });
  ribbon.render(view.querySelector('#design-ribbon'));

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

  if (typeof window !== 'undefined') window.__sketch = { controller, panelTick }; // dev/test seam (headless verify)

  // RAF lifecycle tied to the active stage — the same start()/stop() Shaper drives from showMode: run the
  // solve->draw loop only while Sketch is showing. onEnter is idempotent (mountSketch's start guards a 2nd RAF).
  return {
    onEnter: () => controller.start(),
    onLeave: () => controller.stop(),
  };
}
