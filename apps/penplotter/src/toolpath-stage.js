// apps/penplotter/src/toolpath-stage.js — the Toolpath stage (PP-4a: the pipeline backbone).
// Draw/Fill/Toolpath/Export SHARE ONE plotter canvas (INTEGRATION.md: only Sketch has its own). The shared
// #canvasWrap (built + wired by the Draw stage) is RE-PARENTED into the active stage on entry — no duplicate ids,
// no duplicate render, one shared state. Here it is adopted into #toolpathRoot with state.preview.showToolpath=true,
// so renderArt draws the OPTIMIZED toolpath overlay (preview.buildToolpathOverlay, via #core/plot vpype) over the art.
// PP-4b adds the full ops panel (pens/order/feeds/up-down/target-editing); this slice is preview + overlay + recalc.

import { state } from "./state.js";
import { canvasWrap } from "./dom.js";
import { fitViewport } from "./viewport.js";
import { renderArt } from "./render-art.js";
import { recalcPreview } from "./preview.js";

const SCAFFOLD = `
  <div id="toolpathRoot">
    <aside id="toolpathPanel">
      <div class="dp-head">Toolpath</div>
      <p class="tp-note">The optimized plot path (vpype linemerge / sort / simplify) is previewed over the art.</p>
      <button id="recalcBtn" class="dp-btn dp-primary">Recalculate</button>
      <p class="tp-note">Pens · order · feeds · up/down · target-editing land in PP-4b.</p>
    </aside>
  </div>`;

export function mountToolpathStage(view) {
  view.innerHTML = SCAFFOLD;
  const rb = view.querySelector("#recalcBtn");
  if (rb) rb.onclick = () => { recalcPreview(); renderArt(); }; // force a recompute regardless of autoRecalc
  return { onEnter };
}

// On entry: adopt the shared canvas, switch to toolpath view, recompute + render (art + optimized overlay).
function onEnter() {
  const wrap = canvasWrap;
  if (!wrap) return; // Draw mounts the canvas at startup, so this is populated
  const root = document.getElementById("toolpathRoot");
  const panel = document.getElementById("toolpathPanel");
  if (root && panel && wrap.parentNode !== root) root.insertBefore(wrap, panel); // adopt (canvas left, panel right)
  state.preview.showToolpath = true;
  const r = wrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) fitViewport();
  recalcPreview(); // fresh optimized path on entry (honors nothing — an explicit recompute, like the button)
  renderArt();     // art + the optimized toolpath overlay
}
