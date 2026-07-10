// apps/penplotter/src/draw-stage.js — mount the Draw stage (PP-3a scaffold+render; PP-3b live interaction).
// Builds the canvas + toolbar + transform-HUD scaffold into the router's #stage-draw, resolves the DOM refs
// (initDom AFTER mount), seeds the default art layer, wires the interaction, fits + renders. Draw is the plotter's
// OWN store (state.artLayers) — the #core solver never sees it. Art-only: state.preview.showToolpath is forced
// false (the Toolpath stage owns that overlay), which neutralises interaction.js's toolpath-picking branches.

import { state, initLayers } from "./state.js";
import { initDom, canvasWrap } from "./dom.js";
import { fitViewport } from "./viewport.js";
import { renderArt } from "./render-art.js";
import { installToolbar, setTool } from "./tools.js";
import { installCanvasHandlers, installTransformHud } from "./interaction.js";
import { installKeyboard } from "./keyboard.js";
import { installHistory } from "./history.js";

// The draw tools (data-tool must match the tool names in tools.js / keyboard.js).
const TOOLS = [
  ["select", "Select"], ["line", "Line"], ["rect", "Rect"], ["ellipse", "Ellipse"],
  ["polyline", "Polyline"], ["freehand", "Freehand"], ["node", "Node"], ["scissors", "Scissors"],
  ["rotate", "Rotate"], ["scale", "Scale"],
];
const TOOLBAR = TOOLS.map(([t, label]) => `<button class="tool" data-tool="${t}" title="${label}">${label}</button>`).join("");

const SCAFFOLD = `
  <div id="canvasWrap">
    <svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
    <div id="allTools">${TOOLBAR}</div>
    <div id="coords"></div>
    <div id="docInfo"></div>
    <div id="toast"></div>
    <div id="layers" hidden></div>
    <div id="dropOverlay" hidden></div>
    <div id="transformHud" hidden>
      <span id="transformHudLabel"></span>
      <input id="transformHudInput" type="number" step="any">
      <span id="transformHudUnit"></span>
      <button id="transformHudOk">OK</button>
      <button id="transformHudCancel">Cancel</button>
    </div>
  </div>`;

let _ro = null;

// Called ONCE by the router on first Draw-stage entry. Returns { onEnter } for re-fit on subsequent entries.
export function mountDrawStage(view) {
  view.innerHTML = SCAFFOLD;
  initDom(view);                          // resolve #canvas / #canvasWrap / #allTools / HUD now that they exist
  state.preview.showToolpath = false;     // Draw is ART-ONLY — no toolpath overlay (that is the Toolpath stage)

  // Wire the interaction (mirrors the plotter boot(), Draw subset only; render -> renderArt).
  installToolbar();
  setTool(state.tool || "select");        // initialise the active tool class on the canvas + toolbar
  installCanvasHandlers();
  installTransformHud();
  installKeyboard();
  installHistory(() => renderArt());      // undo/redo restore re-renders the art

  initLayers();                           // the plotter's default art layer (its OWN store)
  fitViewport();
  renderArt();

  // GRIEVANCE-1 pattern: element-only resizes (router show/hide, panel drag) don't fire window.resize, so a
  // ResizeObserver on the canvas wrap re-fits + redraws. Guards a zero-size (hidden) rect.
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

  // Dev/test seam (kept from PP-3a): lets the live-check drive state + re-render.
  if (typeof window !== "undefined") window.__draw = { state, renderArt, fitViewport };

  return { onEnter };
}

// Re-fit whenever the Draw stage becomes visible again (a hidden absolute stage has a 0-size rect).
function onEnter() {
  if (!canvasWrap) return;
  const r = canvasWrap.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) { fitViewport(); renderArt(); }
}
