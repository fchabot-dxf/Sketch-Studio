// Trimmed DRAW-stage renderer (PP-3a). REBUILT from render.js's artwork path ONLY — paper + grid + the art layers
// (raw drawn shapes via shapes.makeShapeElement) + the selection halo. Deliberately does NOT touch render.js's
// downstream entanglements (fill/outline expansion, the toolpath/simulation preview, the 5 side panels, stats,
// banners) — those belong to the Fill / Toolpath / Export stages. Draw stays drawing-only.

import { state } from "./state.js";
import { findShape } from "./state.js";
import { canvas, SVG_NS, layersEl } from "./dom.js";
import { makeShapeElement } from "./shapes.js";
// PP-3c: refresh the Draw side panels each render (layer shape-counts, pen list). Circular with these panels (they
// import renderArt), but the calls are runtime-only so it resolves. Guarded — the panels only exist post-mount.
import { renderLayersPanel } from "./layers-panel.js";
import { renderPlotColorsPanel } from "./plot-colors-panel.js";
// PP-4a: the optimized toolpath overlay (drawn over the art in the Toolpath stage). preview computes via #core/plot
// and honors autoRecalc; circular (preview late-imports renderArt) but runtime-only, so it resolves.
import { requestPreview, buildToolpathOverlay } from "./preview.js";

export function renderArt() {
    if (!canvas) return;
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    canvas.appendChild(buildPaper());
    canvas.appendChild(buildGrid());

    for (const layer of state.artLayers) {
        if (!layer.visible) continue;
        const g = document.createElementNS(SVG_NS, "g");
        g.setAttribute("data-layer-id", layer.id);
        g.setAttribute("stroke", layer.color);
        g.setAttribute("fill", "none");
        g.setAttribute("stroke-width", "0.3");
        for (const shape of layer.shapes) g.appendChild(makeShapeElement(shape));
        canvas.appendChild(g);
    }

    // Selection halo (empty until PP-3b's interaction populates state.selectedShapeIds).
    if (state.selectedShapeIds && state.selectedShapeIds.size > 0) {
        canvas.appendChild(buildSelectionOverlay());
    }

    // PP-4a: the OPTIMIZED toolpath overlay — Toolpath stage only (state.preview.showToolpath). requestPreview
    // recomputes via #core/plot (vpype linemerge/sort/simplify), gated by autoRecalc; buildToolpathOverlay reads
    // the cache. Draw keeps showToolpath=false, so this is a no-op there.
    if (state.preview && state.preview.showToolpath) {
        requestPreview();
        const r = buildToolpathOverlay();      // returns { overlay, stats }
        if (r && r.overlay) canvas.appendChild(r.overlay);
    }

    // PP-3c: keep the Draw side panels in sync with the art (layer tree + pen list) on every render.
    if (layersEl) renderLayersPanel();
    if (typeof document !== "undefined" && document.getElementById("plotColors")) renderPlotColorsPanel();
}

function buildSelectionOverlay() {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("data-overlay", "selection");
    g.setAttribute("pointer-events", "none");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", "#111111");
    g.setAttribute("stroke-opacity", "0.65");
    g.setAttribute("stroke-width", "2");
    g.setAttribute("stroke-linejoin", "round");
    g.setAttribute("stroke-linecap", "round");
    for (const sid of state.selectedShapeIds) {
        const s = findShape(sid);
        if (!s) continue;
        const el = makeShapeElement(s);
        el.removeAttribute("fill"); el.style.fill = "none";
        el.removeAttribute("stroke");
        el.setAttribute("vector-effect", "non-scaling-stroke");
        el.classList.remove("shape");
        g.appendChild(el);
    }
    return g;
}

function buildPaper() {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", 0); r.setAttribute("y", 0);
    r.setAttribute("width", state.doc.w);
    r.setAttribute("height", state.doc.h);
    r.style.fill = "var(--canvas-bg)";
    r.setAttribute("stroke", "#c8bfa8");
    r.setAttribute("stroke-width", "1");
    r.setAttribute("vector-effect", "non-scaling-stroke");
    r.setAttribute("pointer-events", "none");
    return r;
}

function buildGrid() {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("stroke", "#e6ddc8");
    g.setAttribute("stroke-width", "0.1");
    g.setAttribute("vector-effect", "non-scaling-stroke");
    for (let x = 0; x <= state.doc.w; x += 10) {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", x); l.setAttribute("y1", 0);
        l.setAttribute("x2", x); l.setAttribute("y2", state.doc.h);
        g.appendChild(l);
    }
    for (let y = 0; y <= state.doc.h; y += 10) {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", 0); l.setAttribute("y1", y);
        l.setAttribute("x2", state.doc.w); l.setAttribute("y2", y);
        g.appendChild(l);
    }
    return g;
}
