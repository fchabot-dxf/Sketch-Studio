// Stipple — uniform offset-grid of dots inside the shape. Each dot is
// emitted as a tiny line segment (0.1 mm) which both vpype and the DDCS
// treat as a stroke = single pen-down/pen-up dab.
//
// Spacing controls density (smaller = denser).

import { closedPolygonFor, polygonBounds, pointInPolygon, makeLineShape } from "./utils.js";

const DOT_LENGTH = 0.1;

export function generate(shape, { spacing = 2 } = {}) {
    const poly = closedPolygonFor(shape);
    if (!poly) return [];
    const { minX, minY, maxX, maxY } = polygonBounds(poly);

    const out = [];
    let rowIdx = 0;
    for (let y = minY + spacing * 0.5; y < maxY; y += spacing) {
        const xOff = (rowIdx++ % 2) * spacing * 0.5; // honeycomb-style staggering
        for (let x = minX + spacing * 0.5 + xOff; x < maxX; x += spacing) {
            if (!pointInPolygon([x, y], poly)) continue;
            out.push(makeLineShape([x, y], [x + DOT_LENGTH, y]));
        }
    }
    return out;
}
