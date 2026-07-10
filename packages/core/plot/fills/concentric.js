// Nested copies of the shape, shrinking inward by `spacing` each step. rect + ellipse get exact closed-form
// insets; polyline/path (possibly concave) delegate to Clipper offsetRings (#core/plot/clip.js) — clean mitred
// rings that handle concavity and split when an arm pinches off. Ported (PP-2b-2), pure.
import { ELLIPSE_SEGMENTS, makePolylineShape, closedPolygonFor } from "./utils.js";
import { offsetRings } from "../clip.js";

const MAX_ITERATIONS = 500;

// `offset` sets where the first ring sits: ring i is inset by offset + i*spacing, from i = 0. offset 0 = first ring
// ON the outline; negative = start outside (bleed); positive = inset.
export function generate(shape, { spacing = 2, offset = 0 } = {}) {
    spacing = Math.max(0.1, spacing);

    if (shape.type === "rect") {
        const out = [];
        for (let i = 0; i <= MAX_ITERATIONS; i++) {
            const inset = offset + i * spacing;
            const nw = shape.w - inset * 2;
            const nh = shape.h - inset * 2;
            if (nw <= 0 || nh <= 0) { if (inset > 0) break; else continue; }
            const x = shape.x + inset, y = shape.y + inset;
            out.push(makePolylineShape([
                [x, y], [x + nw, y],
                [x + nw, y + nh], [x, y + nh],
                [x, y],
            ]));
        }
        return out;
    }

    if (shape.type === "ellipse") {
        const out = [];
        for (let i = 0; i <= MAX_ITERATIONS; i++) {
            const rx = shape.rx - (offset + i * spacing);
            const ry = shape.ry - (offset + i * spacing);
            if (rx <= spacing * 0.5 || ry <= spacing * 0.5) break;
            const pts = [];
            for (let k = 0; k <= ELLIPSE_SEGMENTS; k++) {
                const t = (k / ELLIPSE_SEGMENTS) * Math.PI * 2;
                pts.push([shape.cx + Math.cos(t) * rx, shape.cy + Math.sin(t) * ry]);
            }
            out.push(makePolylineShape(pts));
        }
        return out;
    }

    if (shape.type === "polyline" || shape.type === "path") {
        const polygon = closedPolygonFor(shape);
        if (!polygon || polygon.length < 4) return [];
        return offsetRings(polygon, spacing, offset, MAX_ITERATIONS)
            .map(makePolylineShape);
    }

    return [];
}
