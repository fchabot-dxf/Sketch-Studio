// apps/penplotter/src/export-stage.js — the EXPORT stage (PP-6): the epic payoff — real G-code out.
// Shares the plotter canvas (re-parented in) with showToolpath + simulatePens = the PEN-WIDTH "ink on paper" sim.
// The panel = document + plotter settings (settings.js) + the Export button (export.js: per-toolpath gcode -> zip
// -> download via #core/plot vpype). Draw/Fill/Toolpath reset simulatePens=false so only Export shows the sim.

import { state } from "./state.js";
import { canvasWrap } from "./dom.js";
import { fitViewport, applyViewport, needsFit } from "./viewport.js"; // UNIFY-6: fit once, then apply the shared view
import { renderArt } from "./render-art.js";
import { recalcPreview } from "./preview.js";
import { installExportButton, buildGcodeEntries } from "./export.js";
import { installSettingsPanel, loadDefaults } from "./settings.js";

const SCAFFOLD = `
  <div id="exportRoot">
    <aside id="exportPanel">
      <div class="dp-head">Document</div>
      <div class="field"><label>Width <small class="doc-unit-label">mm</small></label><input id="docW" type="number"></div>
      <div class="field"><label>Height <small class="doc-unit-label">mm</small></label><input id="docH" type="number"></div>
      <div class="field"><label>Unit</label><select id="docUnit"><option value="mm">mm</option><option value="in">in</option></select></div>
      <div class="dp-head">Plotter</div>
      <div class="field"><label>Pen up Z</label><input id="penUpZ" type="number" step="any"></div>
      <div class="field"><label>Pen down Z</label><input id="penDownZ" type="number" step="any"></div>
      <div class="field"><label>Draw feed</label><input id="drawFeed" type="number"></div>
      <div class="field"><label>Z feed</label><input id="zFeed" type="number"></div>
      <div class="field"><label>Tolerance <small>mm</small></label><input id="tol" type="number" step="any"></div>
      <div class="field"><label>Auto-recalc</label><input id="autoRecalcToggle" type="checkbox"></div>
      <button id="exportBtn" class="dp-btn dp-primary">Export G-code (.zip)</button>
    </aside>
  </div>`;

export function mountExportStage(view) {
  view.innerHTML = SCAFFOLD;
  installSettingsPanel(); // wires doc-size / feeds / tolerance / autoRecalc inputs
  loadDefaults();         // hydrate the settings inputs from state.settings
  installExportButton();  // wires #exportBtn -> per-toolpath gcode -> zip -> download
  if (typeof window !== "undefined") window.__export = { buildGcodeEntries }; // dev/test seam: inspect the gcode
  return { onEnter };
}

function onEnter() {
  const wrap = canvasWrap;
  if (!wrap) return;
  const root = document.getElementById("exportRoot");
  const panel = document.getElementById("exportPanel");
  if (root && panel && wrap.parentNode !== root) root.insertBefore(wrap, panel); // adopt the shared canvas
  state.preview.showToolpath = true;
  state.preview.simulatePens = true;    // the pen-width simulation view
  const r = wrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) { if (needsFit()) fitViewport(); else applyViewport(); }
  recalcPreview();
  renderArt();
}
