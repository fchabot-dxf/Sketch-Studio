// Canvas viewport: fit-to-doc, pan, zoom, and screen↔SVG coord conversion.
//
// Zoom model: viewBox-based. The SVG element fills the wrap at fixed
// pixel dimensions; zoom and pan are expressed by sliding/shrinking the
// viewBox window over the document's user-space coordinates. This
// avoids the previous setAttribute(width, hugeNumber) approach which
// hit browser SVG dimension limits at deep zoom and made the content
// appear to stop growing once the canvas filled the wrap.
//
// Coordinate conventions:
//   state.viewport.scale  — pixels per mm (user-space → screen)
//   state.viewport.panX   — user-space x of the viewBox top-left (mm)
//   state.viewport.panY   — user-space y of the viewBox top-left (mm)

import { state } from "./state.js";
import { canvas, canvasWrap, docInfoEl } from "./dom.js";

export function fitViewport() {
    const wrap = canvasWrap.getBoundingClientRect();
    const margin = 24;
    const sx = (wrap.width - margin * 2) / state.doc.w;
    const sy = (wrap.height - margin * 2) / state.doc.h;
    state.viewport.scale = Math.max(0.001, Math.min(sx, sy));
    // Center the doc inside the viewBox. The viewBox covers the wrap
    // in user-space (wrap.width / scale × wrap.height / scale); the
    // doc is centered within that window.
    state.viewport.panX = (state.doc.w - wrap.width  / state.viewport.scale) / 2;
    state.viewport.panY = (state.doc.h - wrap.height / state.viewport.scale) / 2;
    applyViewport();
}

export function applyViewport() {
    const wrap = canvasWrap.getBoundingClientRect();
    const { scale, panX, panY } = state.viewport;
    // Canvas always fills the wrap exactly — no CSS transform pan, no
    // ever-growing setAttribute width. All movement is in the viewBox.
    canvas.setAttribute("width",  wrap.width);
    canvas.setAttribute("height", wrap.height);
    const vbW = wrap.width  / scale;
    const vbH = wrap.height / scale;
    canvas.setAttribute("viewBox", `${panX} ${panY} ${vbW} ${vbH}`);
    canvas.style.transform = "";
    const inch = state.docUnit === "in";
    const conv = inch ? 1 / 25.4 : 1;
    const fmt = (mm) => (inch ? (mm * conv).toFixed(2) : Math.round(mm * conv));
    const unit = inch ? "in" : "mm";
    docInfoEl.textContent = `${fmt(state.doc.w)} × ${fmt(state.doc.h)} ${unit}  ·  ${(scale * 25.4 / 96).toFixed(2)}× display`;
}

export function screenToSvg(clientX, clientY) {
    const pt = canvas.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = canvas.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const s = pt.matrixTransform(ctm.inverse());
    return { x: s.x, y: s.y };
}

// Wheel zoom that keeps the point under the cursor stationary.
export function installWheelZoom() {
    canvasWrap.addEventListener("wheel", (e) => {
        e.preventDefault();
        const before = screenToSvg(e.clientX, e.clientY);
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        // No upper bound — viewBox-based zoom doesn't suffer from the
        // browser's SVG max-dimension cap. Lower bound keeps the doc
        // from vanishing.
        state.viewport.scale = Math.max(0.001, state.viewport.scale * factor);
        applyViewport();
        const after = screenToSvg(e.clientX, e.clientY);
        // Slide the viewBox so the cursor's user-space coord stays put:
        // if `after` is left/above `before`, shift the viewBox left/up
        // by the same user-space delta.
        state.viewport.panX -= (after.x - before.x);
        state.viewport.panY -= (after.y - before.y);
        applyViewport();
    }, { passive: false });
}
