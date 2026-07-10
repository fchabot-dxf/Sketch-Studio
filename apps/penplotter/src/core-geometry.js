// apps/penplotter/src/core-geometry.js — UNIFY-2 seam: a toolpath can TARGET #core SKETCH geometry DIRECTLY (no
// bake). resolveCoreShapes maps #core sketch shape ids -> plotter polyline shapes via coreShapeToPolyline (PP-7b) at
// COLLECT-TIME, so the existing outline/fill/vpype pipeline carries them unchanged. Additive + COEXISTS with the art
// store targeting (UNIFY-7 later retires the art store + the bake button). `state.coreSketch` is the #core sketch's
// controller.state (shapes + joints Map), set by sketch-stage on mount.

import { state } from "./state.js";
import { coreShapeToPolyline } from "#core/core-shape-to-polyline.js";

// Resolve the target ids that name #core SKETCH geometry -> plotter polyline shapes (KEEP the #core id so toolpath
// targeting / overlays / hit-tests key off it). Ids that don't name a #core shape are ignored (they name art shapes,
// resolved by the caller against state.artLayers). Returns [] when no sketch is mounted.
export function resolveCoreShapes(ids) {
    const cs = state.coreSketch;
    if (!cs || !cs.shapes) return [];
    const want = new Set(ids);
    const out = [];
    for (const sh of cs.shapes) {
        if (!want.has(sh.id)) continue;
        const pts = coreShapeToPolyline(sh, cs.joints);
        if (pts && pts.length >= 2) out.push({ id: sh.id, type: "polyline", points: pts });
    }
    return out;
}

// A compact signature of the #core geometry (id/type/radius + resolved joint coords) so preview's autoRecalc
// re-triggers when a targeted #core shape moves (solver) or changes. Empty when no sketch is mounted.
// NOTE: hashes ALL #core shapes; fine for hand sketches — revisit for dense imports (UNIFY-8 perf).
export function coreSketchSig() {
    const cs = state.coreSketch;
    if (!cs || !cs.shapes || !cs.shapes.length) return "";
    const parts = [];
    for (const sh of cs.shapes) {
        const js = (sh.joints || []).map(id => {
            const j = cs.joints.get(id);
            return j ? j.x.toFixed(3) + "," + j.y.toFixed(3) : "?";
        }).join(";");
        parts.push(sh.id + ":" + sh.type + ":" + (sh.radius != null ? sh.radius : "") + ":" + js);
    }
    return parts.join("|");
}
