// apps/penplotter/src/fill-stage.js — the FILL stage (PP-5). The 2nd tab over the SAME state.toolpaths: edits each
// toolpath's fill{pattern,params} + outline{style,params} via the registry-adapted active-layer-panel; the shared
// plotter canvas is re-parented in with showToolpath=true so the optimized overlay previews the FILL STROKES live.

import { state } from "./state.js";
import { canvasWrap } from "./dom.js";
import { fitViewport } from "./viewport.js";
import { renderArt } from "./render-art.js";
import { recalcPreview } from "./preview.js";
import { installActiveLayerPanel, renderActiveLayerPanel } from "./active-layer-panel.js";

const SCAFFOLD = `
  <div id="fillRoot">
    <aside id="activeLayerPanel">
      <h2>Fill</h2>
      <div id="activeLayerContent"></div>
    </aside>
  </div>`;

export function mountFillStage(view) {
  view.innerHTML = SCAFFOLD;
  // On any fill/outline edit: recompute (fetchPreview is sync) + redraw so the overlay shows the fill live.
  installActiveLayerPanel(() => { recalcPreview(); renderArt(); });
  return { onEnter };
}

function onEnter() {
  const wrap = canvasWrap;
  if (!wrap) return;
  const root = document.getElementById("fillRoot");
  const panel = document.getElementById("activeLayerPanel");
  if (root && panel && wrap.parentNode !== root) root.insertBefore(wrap, panel); // adopt the shared canvas
  state.preview.showToolpath = true;   // preview the toolpath (fill strokes) over the art
  state.preview.simulatePens = false;  // PP-6: diagnostic overlay here (the pen-width sim is Export only)
  const r = wrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) fitViewport();
  recalcPreview();
  renderArt();
  renderActiveLayerPanel();
}
