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

// TOOLPATH-POLISH: the panel reads like the LEGACY (SketchStudio/legacy pen plotter) — <section>+<h2> blocks with
// border-bottom separation, a 2-col .field grid, scrollable lists — in the legacy order: Pens / Toolpath Operations /
// Active Toolpath / Plotter Settings. (Part B relocates doc-size + auto-recalc into modals.)
const SCAFFOLD = `
  <div id="toolpathRoot">
    <aside id="toolpathPanel">
      <section>
        <h2>Pens</h2>
        <div id="plotColors" class="dp-list"></div>
        <div class="layer-actions"><button class="btn" id="addPlotColor" title="Add a pen">+ Pen</button></div>
      </section>
      <section>
        <h2>Toolpath Operations</h2>
        <div id="toolpathLayers" class="dp-list"></div>
        <div class="layer-actions"><button class="btn" id="recalcBtn" title="Recompute the toolpath from the artwork">Recalculate</button></div>
        <div class="layer-actions">
          <button class="btn" id="addOutlineTp">+ Outline</button>
          <button class="btn" id="addFillTp">+ Fill</button>
        </div>
        <div class="layer-actions">
          <button class="btn" id="exportAll" title="Select every toolpath for export">Select all</button>
          <button class="btn" id="exportNone" title="Deselect every toolpath">Deselect all</button>
        </div>
      </section>
      <section id="activeLayerPanel">
        <h2 id="activeLayerHead">Active Toolpath</h2>
        <div id="activeLayerContent"></div>
      </section>
      <section>
        <h2>Plotter Settings</h2>
        <div class="field"><label>Width <small class="doc-unit-label">mm</small></label><input id="docW" type="number"></div>
        <div class="field"><label>Height <small class="doc-unit-label">mm</small></label><input id="docH" type="number"></div>
        <div class="field"><label>Unit</label><select id="docUnit"><option value="mm">mm</option><option value="in">in</option></select></div>
        <div class="field"><label>Pen up Z <small>mm clear</small></label><input id="penUpZ" type="number" step="0.1"></div>
        <div class="field"><label>Pen down Z <small>mm</small></label><input id="penDownZ" type="number" step="0.1"></div>
        <div class="field"><label>Draw feed <small>mm/min</small></label><input id="drawFeed" type="number" step="100"></div>
        <div class="field"><label>Z feed <small>mm/min</small></label><input id="zFeed" type="number" step="100"></div>
        <div class="field"><label>Simplify tol <small>mm</small></label><input id="tol" type="number" step="0.01"></div>
        <div class="field"><label>Auto-recalc</label><input id="autoRecalcToggle" type="checkbox"></div>
      </section>
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
