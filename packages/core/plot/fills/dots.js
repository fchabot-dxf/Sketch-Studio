// Dots — uniform square-grid of dots inside the shape. Each dot is a tiny
// 0.1 mm line segment (vpype + DDCS treat a stroke as one pen dab).
//
// Unlike stipple (rows staggered into a 60° honeycomb lattice), the rows
// here line up into a plain square grid. Spacing controls density.

import { closedPolygonFor, polygonBounds, pointInPolygon, makeLineShape, SPACING, coerceParam } from "./utils.js";

const DOT_LENGTH = 0.1;

export function generate(shape, { spacing = 2 } = {}) {
    spacing = coerceParam(SPACING, spacing); // TASK 453: spacing <= 0 / NaN would never advance the grid
    const poly = closedPolygonFor(shape);
    if (!poly) return [];
    const { minX, minY, maxX, maxY } = polygonBounds(poly);

    const out = [];
    for (let y = minY + spacing * 0.5; y < maxY; y += spacing) {
        for (let x = minX + spacing * 0.5; x < maxX; x += spacing) {
            if (!pointInPolygon([x, y], poly)) continue;
            out.push(makeLineShape([x, y], [x + DOT_LENGTH, y]));
        }
    }
    return out;
}
