// apps/penplotter/src/toolpath-stage.js — the Toolpath stage.
//  PP-4a: the compute backbone — shared re-parented canvas + the optimized overlay + Recalculate.
//  PP-4b: the full OPS panel (toolpath-layers-panel): pens-as-folders -> outline/fill toolpaths, target (layer or
//  selection), reorder, feeds/up-down, export flags, and PEN ASSIGN (tp.plotColorId). Completes the Toolpath stage.
// Draw/Fill/Toolpath/Export SHARE one plotter canvas (INTEGRATION.md); it is re-parented into #toolpathRoot on entry.

import { state } from "./state.js";
import { canvasWrap } from "./dom.js";
import { fitViewport, applyViewport, needsFit } from "./viewport.js"; // UNIFY-6: fit once, then apply the shared view
import { renderArt } from "./render-art.js";
import { recalcPreview } from "./preview.js";
import { installToolpathLayersPanel, renderToolpathLayersPanel } from "./toolpath-layers-panel.js";
import { installActiveLayerPanel, renderActiveLayerPanel } from "./active-layer-panel.js"; // MERGE-1: the fill/outline editor, inline

// MERGE-1: Fill folded in. #activeLayerContent (the retired Fill tab's editor) now lives HERE, below the ops list —
// clicking an op row (toolpath-layers-panel wires activeToolpathId + renderActiveLayerPanel) shows its pattern/style
// editor inline next to pen/order/export. Previously renderActiveLayerPanel() ran with no container in this tab (the
// editor mounted only in the Fill tab) -> "each toolpath has nothing to edit".
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
      <div class="dp-head">Selected op</div>
      <div id="activeLayerContent"></div>
    </aside>
  </div>`;

export function mountToolpathStage(view) {
  view.innerHTML = SCAFFOLD;
  installToolpathLayersPanel(); // wires #addOutlineTp/#addFillTp/#exportAll/#exportNone/#recalcBtn
  installActiveLayerPanel(() => { recalcPreview(); renderArt(); }); // MERGE-1: fill/outline edits recompute the overlay live
  return { onEnter };
}

// On entry: adopt the shared canvas, switch to toolpath view, recompute + render (art + optimized overlay + panel).
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
  renderArt();                // art + the optimized overlay (renderArt also refreshes the ops panel)
  renderToolpathLayersPanel();
  renderActiveLayerPanel();   // MERGE-1: show the selected op's fill/outline editor inline
}
