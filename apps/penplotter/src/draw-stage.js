// apps/penplotter/src/draw-stage.js — mount the Draw stage.
//  PP-3a: scaffold + state/dom/viewport + trimmed art render.
//  PP-3b: live interaction (tools/handlers/keyboard/history/transform HUD).
//  PP-3c: the side panel — SVG import + art LAYERS (add/rename/hide/reorder/merge) + PENS (plot colors).
// Draw is the plotter's OWN store (state.artLayers) — the #core solver never sees it. Art-only:
// state.preview.showToolpath is forced false (the Toolpath stage owns that overlay).

import { state, initLayers } from "./state.js";
import { initDom, canvasWrap } from "./dom.js";
import { fitViewport, applyViewport, needsFit, installWheelZoom } from "./viewport.js"; // UNIFY-6: shared-view fit + wheel-zoom
import { renderArt } from "./render-art.js";
import { installCanvasHandlers } from "./interaction.js";       // UNIFY-7: canvas pan + toolpath selection (art tools retired)
import { installKeyboard } from "./keyboard.js";
import { installHistory } from "./history.js";
import { installPlotColorsPanel } from "./plot-colors-panel.js"; // the pen palette editor (pipeline)
// UNIFY-7: retired the art-UI installers — installToolbar/setTool (tools.js), installTransformHud (rotate/scale HUD),
// installLayerButtons (layers-panel, DELETED), installSvgImport (art importer; import goes to #core via the Design tab).

const TOOLS = [
  ["select", "Select"], ["line", "Line"], ["rect", "Rect"], ["ellipse", "Ellipse"],
  ["polyline", "Polyline"], ["freehand", "Freehand"], ["node", "Node"], ["scissors", "Scissors"],
  ["rotate", "Rotate"], ["scale", "Scale"],
];
const TOOLBAR = TOOLS.map(([t, label]) => `<button class="tool" data-tool="${t}" title="${label}">${label}</button>`).join("");

const SCAFFOLD = `
  <div id="drawRoot">
    <div id="canvasWrap">
      <svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="allTools">${TOOLBAR}</div>
      <div id="coords"></div>
      <div id="docInfo"></div>
      <div id="toast"></div>
      <div id="dropOverlay">Drop an SVG to import</div>
      <div id="transformHud" hidden>
        <span id="transformHudLabel"></span>
        <input id="transformHudInput" type="number" step="any">
        <span id="transformHudUnit"></span>
        <button id="transformHudOk">OK</button>
        <button id="transformHudCancel">Cancel</button>
      </div>
    </div>
    <aside id="drawPanel">
      <section class="dp-sec">
        <button id="importBtn" class="dp-btn dp-primary">Import SVG</button>
        <input id="importFile" type="file" accept=".svg,image/svg+xml" hidden>
      </section>
      <section class="dp-sec">
        <div class="dp-head">Layers</div>
        <div class="dp-row">
          <button id="addLayer" class="dp-btn">+ Layer</button>
          <button id="clearLayer" class="dp-btn">Clear</button>
          <button id="mergeShapes" class="dp-btn">Merge</button>
        </div>
        <div id="layers" class="dp-list"></div>
      </section>
      <section class="dp-sec">
        <div class="dp-head">Pens</div>
        <button id="addPlotColor" class="dp-btn">+ Pen</button>
        <div id="plotColors" class="dp-list"></div>
      </section>
    </aside>
  </div>`;

let _ro = null;

// Called ONCE by the router on first Draw-stage entry. Returns { onEnter } for re-fit on subsequent entries.
export function mountDrawStage(view) {
  view.innerHTML = SCAFFOLD;
  initDom(view);                          // resolve #canvas / #canvasWrap / #layers / #plotColors / HUD
  state.preview.showToolpath = false;     // Draw is ART-ONLY (the toolpath overlay is the Toolpath stage)

  // Canvas interaction: pan + toolpath selection/target-editing (installCanvasHandlers), wheel-zoom, keyboard
  // (pan/Esc), and undo/redo history. The art drawing tools (draw/rotate/scale/node/scissors/freehand-to-art) are
  // dormant in interaction.js — retired fully in UNIFY-7b.
  installCanvasHandlers();
  installWheelZoom();                     // UNIFY-6: wheel-zoom the SHARED view on the plotter canvas
  installKeyboard();
  installHistory(() => renderArt());
  installPlotColorsPanel();               // the pen palette editor (pipeline)

  initLayers();                           // UNIFY-7: now seeds ONLY the default toolpath (no art layer)
  fitViewport();
  renderArt();                            // renders the canvas + the layers/pens panels

  // GRIEVANCE-1 pattern: element-only resizes (router show/hide, panel drag) don't fire window.resize.
  try {
    if (typeof ResizeObserver !== "undefined" && canvasWrap) {
      _ro = new ResizeObserver(() => {
        if (!canvasWrap) return;
        const r = canvasWrap.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        if (needsFit()) fitViewport(); else applyViewport(); // UNIFY-6: keep the shared view; refit only if unfit
        renderArt();
      });
      _ro.observe(canvasWrap);
    }
  } catch (_) {}

  if (typeof window !== "undefined") window.__draw = { state, renderArt, fitViewport };
  return { onEnter };
}

function onEnter() {
  const wrap = canvasWrap;
  if (!wrap) return;
  // PP-4a: reclaim the SHARED canvas (the Toolpath/Fill/Export stages borrow it) back into #drawRoot, and switch
  // back to art-only (no toolpath overlay). insertBefore #drawPanel keeps the canvas on the left, panel on the right.
  const root = document.getElementById("drawRoot");
  const panel = document.getElementById("drawPanel");
  if (root && panel && wrap.parentNode !== root) root.insertBefore(wrap, panel);
  state.preview.showToolpath = false;
  state.preview.simulatePens = false; // PP-6: only the Export stage shows the pen-width sim
  const r = wrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) { if (needsFit()) fitViewport(); else applyViewport(); renderArt(); }
}
