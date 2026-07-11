// apps/penplotter/src/toolpath-stage.js — the Toolpath stage (the plotter WORKBENCH).
//  PP-4a: the compute backbone — shared re-parented canvas + the optimized overlay + Recalculate.
//  PP-4b: the OPS panel (toolpath-layers-panel): pens-as-folders -> outline/fill toolpaths, target, reorder, feeds,
//         export flags, PEN ASSIGN.  MERGE-1: the fill/outline editor (active-layer-panel) is inline here.
//  S3: the PENS palette (plot-colors-panel — was stranded in the permanently-hidden drawHost) + the MACHINE settings
//      (settings.js — relocated out of Export) live here too. Everything a toolpath needs is now on one tab.
// Draw/Toolpath/Export SHARE one plotter canvas (INTEGRATION.md); it is re-parented into #toolpathRoot on entry.

import { state } from "./state.js";
import { canvasWrap } from "./dom.js";
import { fitViewport, applyViewport, needsFit } from "./viewport.js"; // UNIFY-6: fit once, then apply the shared view
import { renderArt } from "./render-art.js";
import { recalcPreview } from "./preview.js";
import { installToolpathLayersPanel, renderToolpathLayersPanel } from "./toolpath-layers-panel.js";
import { installActiveLayerPanel, renderActiveLayerPanel } from "./active-layer-panel.js"; // MERGE-1: the fill/outline editor, inline
import { installPlotColorsPanel, renderPlotColorsPanel } from "./plot-colors-panel.js";     // S3-1: pens surfaced here
import { installSettingsPanel, loadDefaults } from "./settings.js";                          // S3-2: machine settings relocated here

const SCAFFOLD = `
  <div id="toolpathRoot">
    <aside id="toolpathPanel">
      <div class="dp-head">Toolpath ops</div>
      <div class="dp-row">
        <button id="addOutlineTp" class="dp-btn">+ Outline</button>
        <button id="addFillTp" class="dp-btn">+ Fill</button>
      </div>
      <div class="dp-row">
        <button id="exportAll" class="dp-btn">Export all</button>
        <button id="exportNone" class="dp-btn">Export none</button>
      </div>
      <button id="recalcBtn" class="dp-btn dp-primary">Recalculate</button>
      <div id="toolpathLayers" class="dp-list"></div>
      <div class="dp-head" id="activeLayerHead">Selected op</div>
      <div id="activeLayerContent"></div>
      <div class="dp-head">Pens</div>
      <button id="addPlotColor" class="dp-btn">+ Pen</button>
      <div id="plotColors" class="dp-list"></div>
      <div class="dp-head">Machine</div>
      <div class="field"><label>Width <small class="doc-unit-label">mm</small></label><input id="docW" type="number"></div>
      <div class="field"><label>Height <small class="doc-unit-label">mm</small></label><input id="docH" type="number"></div>
      <div class="field"><label>Unit</label><select id="docUnit"><option value="mm">mm</option><option value="in">in</option></select></div>
      <div class="field"><label>Pen up Z</label><input id="penUpZ" type="number" step="any"></div>
      <div class="field"><label>Pen down Z</label><input id="penDownZ" type="number" step="any"></div>
      <div class="field"><label>Draw feed</label><input id="drawFeed" type="number"></div>
      <div class="field"><label>Z feed</label><input id="zFeed" type="number"></div>
      <div class="field"><label>Tolerance <small>mm</small></label><input id="tol" type="number" step="any"></div>
      <div class="field"><label>Auto-recalc</label><input id="autoRecalcToggle" type="checkbox"></div>
    </aside>
  </div>`;

export function mountToolpathStage(view) {
  view.innerHTML = SCAFFOLD;
  installToolpathLayersPanel(); // wires #addOutlineTp/#addFillTp/#exportAll/#exportNone/#recalcBtn
  installActiveLayerPanel(() => { recalcPreview(); renderArt(); }); // MERGE-1: fill/outline edits recompute the overlay live
  installPlotColorsPanel();     // S3-1: pens add/rename/recolor/width/delete-with-reassign (was hidden in drawHost)
  installSettingsPanel();       // S3-2: doc size / unit / feeds / pen-heights / tolerance / auto-recalc (was in Export)
  loadDefaults();               // hydrate the settings inputs from state.settings
  return { onEnter };
}

// On entry: adopt the shared canvas, switch to toolpath view, recompute + render (art + optimized overlay + panels).
function onEnter() {
  const wrap = canvasWrap;
  if (!wrap) return;
  const root = document.getElementById("toolpathRoot");
  const panel = document.getElementById("toolpathPanel");
  if (root && panel && wrap.parentNode !== root) root.insertBefore(wrap, panel); // adopt (canvas left, panel right)
  state.preview.showToolpath = true;
  state.preview.simulatePens = false; // PP-6: diagnostic overlay here (the pen-width sim is Export only)
  const r = wrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) { if (needsFit()) fitViewport(); else applyViewport(); }
  recalcPreview();            // fresh optimized path on entry (an explicit recompute, like the button)
  renderArt();                // art + the optimized overlay (renderArt also refreshes the ops + pens panels)
  renderToolpathLayersPanel();
  renderActiveLayerPanel();   // MERGE-1: show the selected op's fill/outline editor inline
  renderPlotColorsPanel();    // S3-1: show the pens palette
}
