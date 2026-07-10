// Exact toolpath preview. Runs the vpype pipeline (linemerge / linesort
// / linesimplify) entirely in the browser via app/js/vpype/, producing
// the same polylines the plotter will draw. No backend required.

import { state } from "./state.js";
import { SVG_NS, toast } from "./dom.js";
import { toolpathColor, orderedToolpaths, penWidthFor } from "./state.js";
import { toolpathToPolylines } from "#core/plot/index.js";        // PP-4a: shared vpype pipeline
import { expandLayerWithFill } from "#core/plot/fills/index.js";  // PP-4a: shared fill registry
import { expandLayerOutline } from "#core/plot/outlines/index.js"; // PP-4a: shared outline registry
import { resolveCoreShapes, coreSketchSig } from "./core-geometry.js"; // UNIFY-2: target #core geometry directly

const DEBOUNCE_MS = 350;

// Resting toolpath colour in the diagnostic (non-simulation) overlay. The
// pen colour usually matches the artwork it traces, so drawing in the pen
// colour makes the path vanish on top of the full-opacity SVG. Use pink
// throughout — thin solid when idle, heavier/dashed on hover & select.
// (Real pen colours show in the simulation view + the Pens panel.)
const TP_DIAG_COLOR = "#ff2e88";

// ---- cache state (also stored on `state.preview` for visibility) ----
state.preview.cache = state.preview.cache || {
    polylineLayers: [],       // [{ id, name, strokes: [[[x,y],...]] }]
    sourceHash: null,         // hash of the input that produced the cache
    fetching: false,
    error: null,
};

let debounceTimer = null;

/** Hash of all inputs that affect the optimized polylines. */
function sourceHash() {
    return JSON.stringify({
        tol: state.settings.tolerance_mm,
        artLayers: state.artLayers.map(al => ({
            v: al.visible, n: al.name, c: al.color,
            s: al.shapes.map(sh => [
                sh.type,
                ...Object.entries(sh)
                    .filter(([k]) => k !== "id" && k !== "type" && !k.startsWith("_"))
                    .map(([_, v]) => Array.isArray(v) ? v.flat() : v),
            ]),
        })),
        toolpaths: state.toolpaths.map(tp => ({
            n: tp.name, e: tp.export, t: tp.type, tt: tp.targetType,
            al: tp.targetArtLayerId, sids: tp.targetShapeIds,
            pw: penWidthFor(tp), do: tp.drawOutline,
            fill: tp.fill, outline: tp.outline,
        })),
        core: coreSketchSig(), // UNIFY-2: recompute when targeted #core geometry moves/changes
    });
}

/** Ensure the preview cache is up-to-date with current state. Debounced.
 *  In manual mode (state.autoRecalc false) this is a no-op once an initial
 *  preview exists — edits leave the cache stale until recalcPreview() runs. */
export function requestPreview() {
    const wantHash = sourceHash();
    const cache = state.preview.cache;
    if (cache.sourceHash === wantHash && !cache.error) return; // already current
    // Manual mode: don't auto-recompute on edits. Still build the very first
    // preview so a freshly loaded project shows its toolpaths un-prompted.
    if (!state.autoRecalc && cache.sourceHash !== null) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchPreview(wantHash), DEBOUNCE_MS);
}

/** Force a recompute now, regardless of autoRecalc (the Recalculate button). */
export function recalcPreview() {
    clearTimeout(debounceTimer);
    fetchPreview(sourceHash());
}

/** True when the cached toolpath no longer reflects the current artwork —
 *  i.e. a recalculate is pending. Used to flag the Recalculate button. */
export function isPreviewStale() {
    const cache = state.preview.cache;
    if (cache.fetching || cache.sourceHash === null) return false;
    return cache.sourceHash !== sourceHash();
}

async function fetchPreview(hashAtRequestTime) {
    const cache = state.preview.cache;
    cache.fetching = true;
    cache.error = null;
    notifyRenderer();

    try {
        // Resolve each exportable toolpath into a set of optimized polylines
        // using the in-browser vpype pipeline. The output shape matches what
        // the old /api/preview endpoint returned: one entry per toolpath,
        // each with a name + an array of strokes (point arrays).
        const layers = [];
        const opts = {
            mergeTol: 0.05,
            simplifyTol: state.settings.tolerance_mm || 0.1,
        };
        // Built in draw order (panel top→bottom) so overlays append earlier
        // ops first (underneath) and later ops last (on top) — the sim then
        // mirrors the real completion order.
        for (const tp of orderedToolpaths()) {
            if (!tp.visible || tp.export === false) continue;
            const targetShapes = resolveToolpathShapes(tp);
            if (!targetShapes.length) continue;
            // A fill toolpath plots HATCH LINES inside each shape, not
            // its outline. An outline toolpath plots the outline (with
            // optional dash/jagged styling and pass repetition). Expand
            // accordingly — same as the export pipeline does — before
            // running the vpype optimizer.
            const finalShapes = expandToolpathShapes(tp, targetShapes);
            if (!finalShapes.length) continue;
            const strokes = toolpathToPolylines(finalShapes, opts);
            if (!strokes.length) continue;
            // hitShapes = the geometry users click to select this
            // toolpath in the preview. For fills, that's the original
            // shape AREA (so you don't have to hit a thin hatch line);
            // for outlines, null and we fall back to thick invisible
            // strokes over the polylines.
            layers.push({
                id: tp.id, name: tp.name, type: tp.type, strokes,
                hitShapes: tp.type === "fill" ? targetShapes : null,
            });
        }
        cache.polylineLayers = layers;
        cache.sourceHash = hashAtRequestTime;
    } catch (e) {
        cache.error = e.message;
        toast("Preview: " + e.message, true);
    } finally {
        cache.fetching = false;
        notifyRenderer();
    }
}

/** Apply outline/fill expansion to a toolpath's target shapes — same
 *  logic the G-code export uses, so preview and plot match exactly. */
function expandToolpathShapes(tp, targetShapes) {
    if (tp.type === "fill") {
        // Hatch the inside; ignore the outline.
        const filled = expandLayerWithFill({ ...tp, shapes: targetShapes });
        return filled.slice(targetShapes.length);
    }
    // Outline: trace the shape's contour, possibly dashed / jagged / multi-pass.
    if (tp.drawOutline === false) return [];
    return expandLayerOutline(targetShapes, tp.outline);
}

/** Resolve a toolpath's `targetShapeIds` (or `targetArtLayerId`) into
 *  the underlying shape objects from state.artLayers. */
export function resolveToolpathShapes(tp) {
    if (tp.targetShapeIds && tp.targetShapeIds.length) {
        const ids = new Set(tp.targetShapeIds);
        const out = [];
        const found = new Set();
        for (const al of state.artLayers) {
            for (const s of al.shapes) if (ids.has(s.id)) { out.push(s); found.add(s.id); }
        }
        // UNIFY-2: any target id NOT in the art store may name #core SKETCH geometry -> resolve it directly
        // (coreShapeToPolyline at collect-time, no bake). Coexists with art targeting.
        const rest = tp.targetShapeIds.filter(id => !found.has(id));
        if (rest.length) out.push(...resolveCoreShapes(rest));
        return out;
    }
    if (tp.targetArtLayerId) {
        const al = state.artLayers.find(l => l.id === tp.targetArtLayerId);
        return al ? al.shapes.slice() : [];
    }
    return [];
}

// Late-resolved import to avoid a circular eval.
let _render = null;
async function notifyRenderer() {
    if (!_render) _render = (await import("./render-art.js")).renderArt; // PP-4a: Draw's trimmed renderer
    _render();
}

/** Build the toolpath overlay <g> from the cached preview data. */
export function buildToolpathOverlay() {
    const overlay = document.createElementNS(SVG_NS, "g");
    overlay.setAttribute("data-overlay", "toolpath");
    overlay.setAttribute("fill", "none");

    // Direction arrow placed at the start of each stroke (marker-start).
    // orient="auto" rotates it to the first segment, so it signals where
    // the pen starts AND which way the path runs.
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "tpStartArrow");
    marker.setAttribute("orient", "auto");
    marker.setAttribute("markerUnits", "userSpaceOnUse");
    marker.setAttribute("markerWidth", "1.4");
    marker.setAttribute("markerHeight", "1.4");
    marker.setAttribute("refX", "0");
    marker.setAttribute("refY", "0.7");
    const tri = document.createElementNS(SVG_NS, "path");
    tri.setAttribute("d", "M0,0 L1.4,0.7 L0,1.4 Z");
    tri.setAttribute("fill", TP_DIAG_COLOR);
    marker.appendChild(tri);
    defs.appendChild(marker);
    overlay.appendChild(defs);

    const cache = state.preview.cache;
    let stats = { strokeCount: 0, drawDist: 0, travelDist: 0,
                  fetching: cache.fetching, error: cache.error };

    let lastPoint = null;
    for (const layer of cache.polylineLayers) {
        const tp = findToolpath(layer);
        if (tp && !tp.visible) continue;
        const color = TP_DIAG_COLOR;
        // "Active" highlight applies to anything in the multi-selection
        // (so box-selected toolpaths all light up together) as well as
        // the single click-active toolpath.
        const isActive = tp && (
            tp.id === state.activeToolpathId ||
            state.selectedToolpathIds.has(tp.id)
        );

        const layerG = document.createElementNS(SVG_NS, "g");
        layerG.setAttribute("stroke", color);
        layerG.classList.add("tp-group");
        if (isActive) layerG.classList.add("tp-active");
        // data-toolpath-id lets interaction.js pick up clicks on any
        // descendant polyline/dot/hit-zone and resolve back to the toolpath.
        if (tp) layerG.setAttribute("data-toolpath-id", tp.id);

        // Hit zone — invisible, but pickable. For fill toolpaths it's
        // the original shape interior (so users click the AREA, not a
        // thin hatch line that's easy to miss and easy to confuse with
        // a stroke toolpath). For outlines it's a wide transparent
        // twin of each polyline.
        const hitG = document.createElementNS(SVG_NS, "g");
        hitG.classList.add("tp-hit");
        if (layer.type === "fill" && layer.hitShapes) {
            for (const sh of layer.hitShapes) {
                const el = makeHitShapeElement(sh, color);
                if (el) hitG.appendChild(el);
            }
        } else {
            for (const stroke of layer.strokes) {
                if (stroke.length < 2) continue;
                const hp = document.createElementNS(SVG_NS, "polyline");
                hp.setAttribute("points", stroke.map(p => `${p[0]},${p[1]}`).join(" "));
                hp.setAttribute("fill", "none");
                // Painted in the toolpath colour but invisible until hover
                // (CSS fades stroke-opacity in). Still pickable — a paint
                // at opacity 0 keeps pointer-events:stroke working.
                hp.setAttribute("stroke", color);
                hp.setAttribute("stroke-opacity", "0");
                hp.setAttribute("stroke-width", "3");
                hp.setAttribute("vector-effect", "non-scaling-stroke");
                hp.style.pointerEvents = "stroke";
                hp.style.cursor = "pointer";
                hitG.appendChild(hp);
            }
        }
        layerG.appendChild(hitG);

        // Visible geometry — rendered on top of the hit zone so
        // the user sees the actual strokes in their plot color.
        const visibleG = document.createElementNS(SVG_NS, "g");
        visibleG.classList.add("tp-visible");

        for (const stroke of layer.strokes) {
            if (stroke.length < 2) continue;

            if (lastPoint) {
                const [tx, ty] = lastPoint;
                const [sx, sy] = stroke[0];
                const travel = document.createElementNS(SVG_NS, "line");
                travel.setAttribute("x1", tx); travel.setAttribute("y1", ty);
                travel.setAttribute("x2", sx); travel.setAttribute("y2", sy);
                travel.setAttribute("stroke", "#22c55e"); // travel moves: green
                travel.setAttribute("stroke-width", "0.6");
                travel.setAttribute("stroke-dasharray", "1.5 1.5");
                travel.setAttribute("vector-effect", "non-scaling-stroke");
                travel.setAttribute("pointer-events", "none");
                overlay.appendChild(travel);
                stats.travelDist += Math.hypot(sx - tx, sy - ty);
            }

            const poly = document.createElementNS(SVG_NS, "polyline");
            poly.setAttribute("points", stroke.map(p => `${p[0]},${p[1]}`).join(" "));
            // Thin idle line; hover (2.4) and selected-dashes (1.2) sit
            // heavier on top so the touched/selected path reads clearly.
            poly.setAttribute("stroke-width", "0.8");
            poly.setAttribute("vector-effect", "non-scaling-stroke");
            poly.setAttribute("opacity", "0.95");
            poly.setAttribute("pointer-events", "none");
            poly.setAttribute("marker-start", "url(#tpStartArrow)");
            visibleG.appendChild(poly);

            stats.drawDist += strokeLength(stroke);
            stats.strokeCount++;
            lastPoint = stroke[stroke.length - 1];
        }

        layerG.appendChild(visibleG);
        // Selected toolpath → pink dashed lines on top (matches the select
        // hover ghost); no colour halo.
        if (isActive) layerG.appendChild(selectionDashes(layer.strokes));
        overlay.appendChild(layerG);
    }

    return { overlay, stats };
}

/** Pink dashed overlay tracing a toolpath's strokes — the selection cue. */
function selectionDashes(strokes) {
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("fill", "none");
    g.setAttribute("stroke", "#ff2e88");
    g.setAttribute("stroke-opacity", "0.65");
    g.setAttribute("stroke-width", "2.8");
    g.setAttribute("stroke-dasharray", "3 2");
    g.setAttribute("stroke-linecap", "round");
    g.setAttribute("stroke-linejoin", "round");
    g.setAttribute("pointer-events", "none");
    for (const stroke of strokes) {
        if (stroke.length < 2) continue;
        const pl = document.createElementNS(SVG_NS, "polyline");
        pl.setAttribute("points", stroke.map(p => `${p[0]},${p[1]}`).join(" "));
        // vector-effect doesn't inherit — must be on the polyline itself, or
        // the 0.6 width is interpreted in mm and scales up thick when zoomed.
        pl.setAttribute("vector-effect", "non-scaling-stroke");
        g.appendChild(pl);
    }
    return g;
}

// Polyline layers now come from our own pipeline carrying the toolpath
// id directly, so resolution is exact — no name-sanitization hop needed.
function findToolpath(layerOrId) {
    const id = typeof layerOrId === "string" ? layerOrId : layerOrId?.id;
    if (!id) return null;
    return state.toolpaths.find(tp => tp.id === id) || null;
}

function strokeLength(stroke) {
    let d = 0;
    for (let i = 1; i < stroke.length; i++) {
        d += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
    }
    return d;
}

/** "Simulation" overlay — simulated pen widths with round caps. */
export function buildSimulationOverlay() {
    const overlay = document.createElementNS(SVG_NS, "g");
    overlay.setAttribute("data-overlay", "simulation");
    overlay.setAttribute("fill", "none");

    const cache = state.preview.cache;
    for (const layer of cache.polylineLayers) {
        const tp = findToolpath(layer);
        if (tp && !tp.visible) continue;
        // Simulation = same plot color as Toolpath mode, but rendered at
        // the toolpath's pen width with round caps so it looks like ink
        // on paper.
        const color = toolpathColor(tp);
        const penWidth = penWidthFor(tp);
        // "Active" highlight applies to anything in the multi-selection
        // (so box-selected toolpaths all light up together) as well as
        // the single click-active toolpath.
        const isActive = tp && (
            tp.id === state.activeToolpathId ||
            state.selectedToolpathIds.has(tp.id)
        );

        const layerG = document.createElementNS(SVG_NS, "g");
        layerG.classList.add("tp-group");
        if (isActive) layerG.classList.add("tp-active");
        if (tp) layerG.setAttribute("data-toolpath-id", tp.id);

        // Hit zone — same logic as the toolpath overlay: fills click on
        // their area, outlines on a thickened invisible twin.
        const hitG = document.createElementNS(SVG_NS, "g");
        hitG.classList.add("tp-hit");
        if (layer.type === "fill" && layer.hitShapes) {
            for (const sh of layer.hitShapes) {
                const el = makeHitShapeElement(sh, color);
                if (el) hitG.appendChild(el);
            }
        } else {
            for (const stroke of layer.strokes) {
                if (stroke.length < 2) continue;
                const hp = document.createElementNS(SVG_NS, "polyline");
                hp.setAttribute("points", stroke.map(p => `${p[0]},${p[1]}`).join(" "));
                hp.setAttribute("fill", "none");
                hp.setAttribute("stroke", color);
                hp.setAttribute("stroke-opacity", "0");
                hp.setAttribute("stroke-width", Math.max(3, penWidth + 1));
                hp.setAttribute("vector-effect", "non-scaling-stroke");
                hp.style.pointerEvents = "stroke";
                hp.style.cursor = "pointer";
                hitG.appendChild(hp);
            }
        }
        layerG.appendChild(hitG);

        // Visible "ink" strokes — full opacity always.
        const visibleG = document.createElementNS(SVG_NS, "g");
        visibleG.classList.add("tp-visible");
        visibleG.setAttribute("stroke", color);
        visibleG.setAttribute("stroke-width", penWidth);
        visibleG.setAttribute("stroke-linecap", "round");
        visibleG.setAttribute("stroke-linejoin", "round");
        for (const stroke of layer.strokes) {
            if (stroke.length < 2) continue;
            const p = document.createElementNS(SVG_NS, "polyline");
            p.setAttribute("points", stroke.map(pt => `${pt[0]},${pt[1]}`).join(" "));
            p.setAttribute("pointer-events", "none");
            visibleG.appendChild(p);
        }
        layerG.appendChild(visibleG);
        if (isActive) layerG.appendChild(selectionDashes(layer.strokes));

        overlay.appendChild(layerG);
    }
    return overlay;
}

/** Build an invisible "hit" SVG element for a shape — used so clicks
 *  on a fill toolpath's area resolve to that toolpath. */
function makeHitShapeElement(shape, color = "transparent") {
    let el;
    switch (shape.type) {
        case "line":
            el = document.createElementNS(SVG_NS, "line");
            el.setAttribute("x1", shape.x1); el.setAttribute("y1", shape.y1);
            el.setAttribute("x2", shape.x2); el.setAttribute("y2", shape.y2);
            // A line has no interior — fall back to stroke hit testing.
            // Coloured but invisible until hover (see area-shape note below).
            el.setAttribute("stroke", color);
            el.setAttribute("stroke-opacity", "0");
            el.setAttribute("stroke-width", "3");
            el.setAttribute("fill", "none");
            el.setAttribute("vector-effect", "non-scaling-stroke");
            el.style.pointerEvents = "stroke";
            el.style.cursor = "pointer";
            return el;
        case "rect":
            el = document.createElementNS(SVG_NS, "rect");
            el.setAttribute("x", shape.x); el.setAttribute("y", shape.y);
            el.setAttribute("width", shape.w); el.setAttribute("height", shape.h);
            break;
        case "ellipse":
            el = document.createElementNS(SVG_NS, "ellipse");
            el.setAttribute("cx", shape.cx); el.setAttribute("cy", shape.cy);
            el.setAttribute("rx", shape.rx); el.setAttribute("ry", shape.ry);
            break;
        case "polyline":
            el = document.createElementNS(SVG_NS, "polyline");
            el.setAttribute("points", shape.points.map(p => `${p[0]},${p[1]}`).join(" "));
            break;
        case "path":
            el = document.createElementNS(SVG_NS, "path");
            el.setAttribute("d", shape.d);
            break;
        default:
            return null;
    }
    // Painted in the toolpath colour but invisible until hover, when CSS
    // fades fill-opacity in as the tint feedback. fill-opacity 0 still
    // hit-tests, so the interior stays pickable.
    el.setAttribute("fill", color);
    el.setAttribute("fill-opacity", "0");
    el.setAttribute("stroke", "none");
    el.style.pointerEvents = "fill";
    el.style.cursor = "pointer";
    return el;
}
