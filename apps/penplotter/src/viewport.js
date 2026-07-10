// apps/penplotter/src/viewport.js — UNIFY-6: the plotter canvas is now a THIN ADAPTER over the SHARED #ui view.
// The single source of truth for pan/zoom is the #ui sketch's viewBox rect, state.coreSketch.view = {x,y,w,h}
// (the same object the Design sketcher pans/zooms). So Design + Fill/Toolpath/Export share ONE view -> pan/zoom is
// identical across all 4 tabs and persists across tab switches, like Studio/Shaper. This retires the old
// {scale,panX,panY} model — state.viewport is now just a DERIVED CACHE (px-per-world scale + top-left) kept in sync
// by applyViewport, so interaction.js's pick-threshold reads (state.viewport.scale) keep working unchanged.

import { state } from "./state.js";
import { canvas, canvasWrap, docInfoEl } from "./dom.js";

let _fitted = false; // one initial doc-fit (whichever canvas is shown first at a real size does it)
export function needsFit() { return !_fitted; }
export function markFitted() { _fitted = true; }

// The shared view. #ui MODEL (see #ui/input-manager updateViewBox): view = {x,y,w,h} where (x,y) is the viewBox
// CENTER and the viewBox is "(x - w/2) (y - h/2) w h". state.coreSketch.view once the Design sketcher has mounted;
// a doc-centered fallback before that.
export function sharedView() {
  const v = state.coreSketch && state.coreSketch.view;
  if (v) return v;
  if (!state._viewFallback) state._viewFallback = { x: state.doc.w / 2, y: state.doc.h / 2, w: state.doc.w, h: state.doc.h };
  return state._viewFallback;
}

// Pure doc-fit in the #ui model: (x,y) = the doc CENTER, (w,h) = the world window covering the doc + margin.
export function fitRectForDoc(wrapW, wrapH) {
  const margin = 24;
  const sx = (wrapW - margin * 2) / state.doc.w, sy = (wrapH - margin * 2) / state.doc.h;
  const scale = Math.max(0.001, Math.min(sx, sy)); // px per world unit
  return { x: state.doc.w / 2, y: state.doc.h / 2, w: wrapW / scale, h: wrapH / scale };
}

export function fitViewport() {
  const wrap = canvasWrap && canvasWrap.getBoundingClientRect();
  if (!wrap || !(wrap.width > 0 && wrap.height > 0)) return; // hidden host / no size -> no-op (don't mark fitted)
  Object.assign(sharedView(), fitRectForDoc(wrap.width, wrap.height));
  _fitted = true;
  applyViewport();
}

export function applyViewport() {
  const wrap = canvasWrap && canvasWrap.getBoundingClientRect();
  if (!wrap) return;
  const v = sharedView();
  canvas.setAttribute("width", wrap.width);
  canvas.setAttribute("height", wrap.height);
  // Center-based, IDENTICAL to #ui updateViewBox -> #canvas shows the SAME world region as #design-canvas.
  canvas.setAttribute("viewBox", `${v.x - v.w / 2} ${v.y - v.h / 2} ${v.w} ${v.h}`);
  canvas.style.transform = "";
  // Sync the derived cache (px-per-world scale + top-left) so interaction.js pick thresholds keep working.
  const scale = v.w > 0 ? wrap.width / v.w : 1;
  state.viewport.scale = scale; state.viewport.panX = v.x; state.viewport.panY = v.y;
  if (docInfoEl) {
    const inch = state.docUnit === "in", conv = inch ? 1 / 25.4 : 1;
    const fmt = (mm) => (inch ? (mm * conv).toFixed(2) : Math.round(mm * conv));
    docInfoEl.textContent = `${fmt(state.doc.w)} × ${fmt(state.doc.h)} ${inch ? "in" : "mm"}  ·  ${(scale * 25.4 / 96).toFixed(2)}× display`;
  }
}

export function screenToSvg(clientX, clientY) {
  const pt = canvas.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = canvas.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const s = pt.matrixTransform(ctm.inverse());
  return { x: s.x, y: s.y };
}

// Wheel zoom that keeps the point under the cursor stationary — mutates the SHARED view (shrink/grow the viewBox).
export function installWheelZoom() {
  canvasWrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const before = screenToSvg(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1; // scroll up -> zoom in -> shrink the viewBox
    const v = sharedView();
    v.w = Math.max(0.01, v.w * factor); v.h = Math.max(0.01, v.h * factor);
    applyViewport();
    const after = screenToSvg(e.clientX, e.clientY);
    v.x -= (after.x - before.x); v.y -= (after.y - before.y); // keep the cursor's world point put
    applyViewport();
  }, { passive: false });
}
