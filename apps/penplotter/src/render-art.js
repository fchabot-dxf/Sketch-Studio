// apps/penplotter/src/render-art.js — the plotter-CANVAS renderer for Fill/Toolpath/Export: paper + grid + the
// optimized toolpath / pen-width simulation overlay. UNIFY-7 retired the dormant art-layer drawing + selection halo:
// geometry now lives in the #core sketch (drawn by the Design sketcher + the pen-color underlay); the plotter canvas
// only shows the toolpath preview over the paper/grid. Toolpaths resolve #core geometry via UNIFY-2 (resolveCoreShapes).

import { state } from "./state.js";
import { canvas, SVG_NS } from "./dom.js";
import { requestPreview, buildToolpathOverlay, buildSimulationOverlay } from "./preview.js";
import { renderPlotColorsPanel } from "./plot-colors-panel.js";
import { renderToolpathLayersPanel } from "./toolpath-layers-panel.js";

export function renderArt() {
    if (!canvas) return;
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    canvas.appendChild(buildPaper());
    canvas.appendChild(buildGrid());

    // The OPTIMIZED toolpath overlay (Toolpath/Fill) or the pen-width sim (Export). requestPreview recomputes via
    // #core/plot (vpype linemerge/sort/simplify), gated by autoRecalc; it resolves #core geometry (UNIFY-2). Fill/
    // Toolpath set showToolpath=true; Export also sets simulatePens.
    if (state.preview && state.preview.showToolpath) {
        requestPreview();
        if (state.preview.simulatePens) {
            const g = buildSimulationOverlay();  // pen-width "ink on paper" sim (Export)
            if (g) canvas.appendChild(g);
        } else {
            const r = buildToolpathOverlay();    // returns { overlay, stats }
            if (r && r.overlay) canvas.appendChild(r.overlay);
        }
    }

    // Keep the pen panels in sync each render (guarded — they only exist post-mount).
    if (typeof document !== "undefined" && document.getElementById("plotColors")) renderPlotColorsPanel();
    if (typeof document !== "undefined" && document.getElementById("toolpathLayers")) renderToolpathLayersPanel();
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
