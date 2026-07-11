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

// S3-2: the machine SETTINGS block (doc size / unit / feeds / pen-heights / tolerance / auto-recalc) moved to the
// Toolpath tab ("doesn't belong in Export", user-decided). Export now shows ONLY the export action; the pen-width
// simulation is the canvas view set in onEnter.
// LAYOUT-UNIFY: same column template as Design/Toolpath — reserved top strip + body ROW (panel LEFT, canvas RIGHT).
const SCAFFOLD = `
  <div id="exportRoot">
    <div class="tp-strip">Export</div>
    <div class="tp-body">
      <aside id="exportPanel">
        <div class="dp-head">Export</div>
        <div class="tp-note">Machine settings (doc size, feeds, pen heights, tolerance) are in the <b>Toolpath</b> tab.</div>
        <button id="exportBtn" class="dp-btn dp-primary">Export G-code (.zip)</button>
      </aside>
    </div>
  </div>`;

export function mountExportStage(view) {
  view.innerHTML = SCAFFOLD;
  installExportButton();  // wires #exportBtn -> per-toolpath gcode -> zip -> download
  if (typeof window !== "undefined") window.__export = { buildGcodeEntries }; // dev/test seam: inspect the gcode
  return { onEnter };
}

function onEnter() {
  const wrap = canvasWrap;
  if (!wrap) return;
  // LAYOUT-UNIFY: adopt the shared canvas into the body ROW AFTER the panel -> panel LEFT, canvas RIGHT.
  const body = document.querySelector("#exportRoot .tp-body");
  if (body && wrap.parentNode !== body) body.appendChild(wrap);
  state.preview.showToolpath = true;
  state.preview.simulatePens = true;    // the pen-width simulation view
  const r = wrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) { if (needsFit()) fitViewport(); else applyViewport(); }
  recalcPreview();
  renderArt();
}
