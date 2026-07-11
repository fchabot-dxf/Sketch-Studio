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
// S3: installPlotColorsPanel moved to toolpath-stage.js (the Pens palette is surfaced in the Toolpath tab now).
// UNIFY-7: retired the art-UI installers — installToolbar/setTool (tools.js), installTransformHud (rotate/scale HUD),
// installLayerButtons (layers-panel, DELETED), installSvgImport (art importer; import goes to #core via the Design tab).

// RENDER-FIX: the art-tool TOOLBAR (#allTools / .tool buttons) is DEAD scaffold — UNIFY-7 retired the art tools
// (installToolbar/setTool gone), but the toolbar lived INSIDE #canvasWrap and so rode along (visible) when
// Fill/Toolpath/Export re-parent the shared canvas. Removed. MERGE-1: also removed the dead #transformHud (the rotate/
// scale degree field — art rotate/scale is retired; a #core-joint rotate/scale is a later restore). #coords/#docInfo live.
const SCAFFOLD = `
  <div id="drawRoot">
    <div id="canvasWrap">
      <svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
      <div id="coords"></div>
      <div id="docInfo"></div>
      <div id="toast"></div>
      <div id="dropOverlay">Drop an SVG to import</div>
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
      <!-- S3: the Pens palette (#plotColors/#addPlotColor) moved to the Toolpath tab — it was stranded here in the
           permanently-hidden drawHost, so the user could never add/rename/recolor/width/delete a pen. -->
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
  // S3: the Pens palette is installed by toolpath-stage now (it was hidden in this drawHost).

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
