// apps/penplotter/src/core-geometry.js — UNIFY-2 seam: a toolpath can TARGET #core SKETCH geometry DIRECTLY (no
// bake). resolveCoreShapes maps #core sketch shape ids -> plotter polyline shapes via coreShapeToPolyline (PP-7b) at
// COLLECT-TIME, so the existing outline/fill/vpype pipeline carries them unchanged. Additive + COEXISTS with the art
// store targeting (UNIFY-7 later retires the art store + the bake button). `state.coreSketch` is the #core sketch's
// controller.state (shapes + joints Map), set by sketch-stage on mount.

import { state, toolpathPenId, penIdForShape } from "./state.js";
import { coreShapeToPolyline } from "#core/core-shape-to-polyline.js";

// Resolve the target ids that name #core SKETCH geometry -> plotter polyline shapes (KEEP the #core id so toolpath
// targeting / overlays / hit-tests key off it). Ids that don't name a #core shape are ignored (they name art shapes,
// resolved by the caller against state.artLayers). Returns [] when no sketch is mounted.
export function resolveCoreShapes(ids) {
    const cs = state.coreSketch;
    if (!cs || !cs.shapes) return [];
    const want = ids ? new Set(ids) : null;
    const out = [];
    for (const sh of cs.shapes) {
        if (want && !want.has(sh.id)) continue;
        const pts = coreShapeToPolyline(sh, cs.joints);
        if (pts && pts.length >= 2) out.push({ id: sh.id, type: "polyline", points: pts });
    }
    return out;
}

/** TASK 440: ONE shapes-of-a-toolpath function used by preview, export, and interaction.
 *  Resolves target geometry from either explicit targetShapeIds, explicit targetArtLayerId,
 *  or the #core sketch (matching the toolpath's pen, or all shapes when no pen assigned). */
export function collectToolpathShapes(tp) {
    if (!tp) return [];

    // 1. Explicit targetShapeIds takes precedence
    if (tp.targetShapeIds && tp.targetShapeIds.length > 0) {
        const ids = new Set(tp.targetShapeIds);
        const out = [];
        const found = new Set();
        for (const al of state.artLayers) {
            for (const s of al.shapes) {
                if (ids.has(s.id)) {
                    out.push(s);
                    found.add(s.id);
                }
            }
        }
        const rest = tp.targetShapeIds.filter(id => !found.has(id));
        if (rest.length) out.push(...resolveCoreShapes(rest));
        return out;
    }

    // 2. Explicit targetArtLayerId
    if (tp.targetArtLayerId) {
        const al = state.artLayers.find(l => l.id === tp.targetArtLayerId);
        return al ? al.shapes.slice() : [];
    }

    // 3. Toolpath targeting #core sketch geometry (e.g. default starter toolpath)
    const cs = state.coreSketch;
    if (cs && cs.shapes && cs.shapes.length > 0) {
        const tpPen = toolpathPenId(tp);
        const matchingIds = [];
        for (const sh of cs.shapes) {
            const shPen = penIdForShape(sh.id);
            if (tpPen != null) {
                if (shPen === tpPen) matchingIds.push(sh.id);
            } else {
                if (state.plotColors.length === 0 || shPen === null) {
                    matchingIds.push(sh.id);
                }
            }
        }
        if (matchingIds.length > 0) {
            return resolveCoreShapes(matchingIds);
        }
    }

    // 4. Fallback for legacy art layers when no sketch shapes exist
    if (state.artLayers && state.artLayers.length > 0 && (!cs || !cs.shapes || !cs.shapes.length)) {
        const tpPen = toolpathPenId(tp);
        const out = [];
        for (const al of state.artLayers) {
            for (const s of al.shapes) {
                const shPen = penIdForShape(s.id);
                if (tpPen != null) {
                    if (shPen === tpPen) out.push(s);
                } else {
                    if (state.plotColors.length === 0 || shPen === null) out.push(s);
                }
            }
        }
        if (out.length > 0) return out;
    }

    return [];
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
