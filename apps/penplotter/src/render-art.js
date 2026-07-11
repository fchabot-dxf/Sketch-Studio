// apps/penplotter/src/render-art.js — the plotter-CANVAS renderer for Fill/Toolpath/Export: paper + grid + the
// optimized toolpath / pen-width simulation overlay. UNIFY-7 retired the dormant art-layer drawing + selection halo:
// geometry now lives in the #core sketch (drawn by the Design sketcher + the pen-color underlay); the plotter canvas
// only shows the toolpath preview over the paper/grid. Toolpaths resolve #core geometry via UNIFY-2 (resolveCoreShapes).

import { state, penColorForShape } from "./state.js";
import { canvas, SVG_NS } from "./dom.js";
import { requestPreview, buildToolpathOverlay, buildSimulationOverlay } from "./preview.js";
import { renderPlotColorsPanel } from "./plot-colors-panel.js";
import { renderToolpathLayersPanel } from "./toolpath-layers-panel.js";
import { coreShapeToPolyline } from "#core/core-shape-to-polyline.js"; // RENDER-FIX: show the #core geometry on this canvas
import { paperGridMarkup } from "./paper-grid.js"; // DESIGN-PAPER-BOUNDS: shared paper+grid (also drawn on the Design canvas)

// S2: opts.skipPanels redraws ONLY the canvas (geometry + overlay), leaving the ops panel DOM intact — used by op-row
// hover so a cross-highlight doesn't rebuild the panel (which would detach the row listeners under the cursor).
export function renderArt(opts = {}) {
    if (!canvas) return;
    while (canvas.firstChild) canvas.removeChild(canvas.firstChild);

    const paper = document.createElementNS(SVG_NS, "g");
    paper.setAttribute("data-layer", "paper");
    paper.innerHTML = paperGridMarkup(state.doc); // shared helper (also used by the Design canvas)
    canvas.appendChild(paper);

    // RENDER-FIX: draw the #core geometry (drawn sketch + imported SVG) in its mapped pen colors, BENEATH the toolpath
    // overlay — the same geometry the Design tab shows via its sketcher/underlay. Without this the Fill/Toolpath/Export
    // canvas only shows paper/grid + whatever a toolpath TARGETS, so untargeted drawn/imported shapes were invisible.
    const geom = buildCoreGeometry();
    if (geom) canvas.appendChild(geom);

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

    // Keep the pen panels in sync each render (guarded — they only exist post-mount). Skipped for a canvas-only
    // redraw (op-row hover) so the panel DOM + its row listeners survive.
    if (!opts.skipPanels) {
        if (typeof document !== "undefined" && document.getElementById("plotColors")) renderPlotColorsPanel();
        if (typeof document !== "undefined" && document.getElementById("toolpathLayers")) renderToolpathLayersPanel();
    }
}

// RENDER-FIX: the #core sketch geometry (state.coreSketch = the sketcher's controller.state) flattened to polylines
// (coreShapeToPolyline, world/mm coords — same space the paper/grid + toolpath overlay use) and stroked in each
// shape's mapped physical PEN color (penColorForShape), so drawn + imported geometry is VISIBLE on Fill/Toolpath/
// Export. Reference-only (pointer-events off; non-scaling stroke); the toolpath overlay draws the plot on top.
function buildCoreGeometry() {
    const cs = state.coreSketch;
    if (!cs || !cs.shapes || !cs.shapes.length) return null;
    const sel = state.selectedShapeIds;
    // S2: cross-highlight — ghost (pink halo) the geometry the FOCUSED op plots (the hovered op ROW, else the active
    // op), so hovering/selecting an op row shows WHICH vectors it targets.
    const focusOp = state.toolpaths.find(t => t.id === (state.hoveredToolpathId || state.activeToolpathId));
    const focusIds = focusOp ? new Set(focusOp.targetShapeIds || []) : new Set();
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("data-layer", "core-geometry");
    g.setAttribute("fill", "none");
    for (const sh of cs.shapes) {
        const pts = coreShapeToPolyline(sh, cs.joints);
        if (!pts || pts.length < 2) continue;
        const ptsStr = pts.map(p => `${p[0]},${p[1]}`).join(" ");
        if (focusIds.has(sh.id)) { // op-target halo, drawn UNDER the shape stroke
            const halo = document.createElementNS(SVG_NS, "polyline");
            halo.setAttribute("points", ptsStr);
            halo.setAttribute("stroke", "#ff2e88"); halo.setAttribute("stroke-width", "3");
            halo.setAttribute("stroke-opacity", "0.5"); halo.setAttribute("stroke-linecap", "round");
            halo.setAttribute("stroke-linejoin", "round"); halo.setAttribute("vector-effect", "non-scaling-stroke");
            halo.setAttribute("pointer-events", "none");
            g.appendChild(halo);
        }
        const pl = document.createElementNS(SVG_NS, "polyline");
        pl.setAttribute("points", ptsStr);
        // WORKFLOW-FIX: tag with the #core shape id so a canvas click can map back to the shape (selection/targeting),
        // and HIGHLIGHT the current selection (thicker blue) so "click a vector -> it selects" is visible.
        pl.setAttribute("data-shape-id", sh.id);
        const selected = sel && sel.has(sh.id);
        pl.setAttribute("stroke", selected ? "#2563eb" : penColorForShape(sh.id));
        pl.setAttribute("stroke-width", selected ? "1.8" : "0.8");
        pl.setAttribute("stroke-linecap", "round");
        pl.setAttribute("stroke-linejoin", "round");
        pl.setAttribute("vector-effect", "non-scaling-stroke");
        pl.style.pointerEvents = "stroke"; // clickable on the line; interior clicks resolve geometrically (coreShapeAtPoint)
        pl.style.cursor = "pointer";
        g.appendChild(pl);
    }
    return g;
}

// (buildPaper/buildGrid were extracted to paper-grid.js `paperGridMarkup` — shared with the Design canvas.)
