// apps/penplotter/src/draw-stage.js — mount the Draw stage (PP-3a). Builds the canvas scaffold into the router's
// #stage-draw, resolves the DOM refs (initDom, AFTER the scaffold is in the DOM), seeds the default art layer, fits
// + renders. NO interaction yet (PP-3b). Draw is the plotter's OWN store (state.artLayers) — the solver never sees it.

import { state, initLayers } from "./state.js";
import { initDom, canvasWrap } from "./dom.js";
import { fitViewport } from "./viewport.js";
import { renderArt } from "./render-art.js";

const SCAFFOLD = `
  <div id="canvasWrap">
    <svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="docInfo"></div>
    <div id="toast"></div>
    <div id="layers" hidden></div>
    <div id="dropOverlay" hidden></div>
  </div>`;

let _ro = null;

// Called ONCE by the router on first Draw-stage entry. Returns { onEnter } for re-fit on subsequent entries.
export function mountDrawStage(view) {
  view.innerHTML = SCAFFOLD;
  initDom(view);              // resolve #canvas / #canvasWrap / ... now that the scaffold is in the DOM
  initLayers();              // the plotter's default art layer (its OWN store; the #core solver never sees it)
  fitViewport();
  renderArt();

  // GRIEVANCE-1 pattern: an element-only resize (router show/hide of the stage, a panel drag) does NOT fire
  // window.resize, so a ResizeObserver on the canvas wrap re-fits + redraws. Guards a zero-size (hidden) rect.
  try {
    if (typeof ResizeObserver !== "undefined" && canvasWrap) {
      _ro = new ResizeObserver(() => {
        if (!canvasWrap) return;
        const r = canvasWrap.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        fitViewport();
        renderArt();
      });
      _ro.observe(canvasWrap);
    }
  } catch (_) {}

  // Dev/test seam: lets the PP-3a live-check seed shapes + re-render before interaction (PP-3b) exists.
  if (typeof window !== "undefined") window.__draw = { state, renderArt, fitViewport };

  return { onEnter };
}

// Re-fit whenever the Draw stage becomes visible again: a hidden absolute stage has a 0-size rect, so a load-time
// fit would be stale. Mirrors Shaper's mount-on-enter for the design/vcarve stages.
function onEnter() {
  if (!canvasWrap) return;
  const r = canvasWrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) { fitViewport(); renderArt(); }
}
