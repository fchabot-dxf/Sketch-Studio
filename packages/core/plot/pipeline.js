// High-level pipeline: shapes → polylines → optimized polylines, and
// optionally → G-code. Each toolpath is processed independently.
//
// A toolpath here is a minimal { id, name, shapes, settings } record.
// Callers (preview / export) translate the app's state.toolpaths into
// this shape so this module stays decoupled from the rest of the app.

import { shapeToPolyline } from "./polylines/index.js";
import { optimize } from "./optimize/index.js";
import { renderGcode } from "./gcode/render.js";

/** Flatten one toolpath's shapes into a list of polylines. */
export function flattenToolpath(shapes) {
    const out = [];
    for (const s of shapes) {
        const poly = shapeToPolyline(s);
        if (poly && poly.length >= 2) out.push(poly);
    }
    return out;
}

/** Run vpype's pipeline on a list of polylines. */
export function optimizePolylines(polylines, opts = {}) {
    return optimize(polylines, opts);
}

/** Convenience: shapes → optimized polylines in one call. */
export function toolpathToPolylines(shapes, opts = {}) {
    return optimizePolylines(flattenToolpath(shapes), opts);
}

/** Convenience: shapes → G-code text. */
export function toolpathToGcode(shapes, settings) {
    const polylines = toolpathToPolylines(shapes, {
        mergeTol: settings.mergeTol ?? 0.05,
        simplifyTol: settings.simplifyTol ?? 0.1,
    });
    return renderGcode(polylines, settings);
}
