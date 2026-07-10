// Douglas–Peucker polyline simplification. Recursively drops vertices
// whose perpendicular distance from the line through the endpoints of
// the current segment is below `tolerance`. Iterative implementation
// (deep recursion stalls on very long paths).

import { perpDist } from "../geom/perp-dist.js";

export function douglasPeucker(points, tolerance) {
    if (points.length <= 2) return points.slice();

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;

    // Stack of [start, end] index ranges to process.
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const [s, e] = stack.pop();
        let maxDist = 0, maxIdx = -1;
        for (let i = s + 1; i < e; i++) {
            const d = perpDist(points[i], points[s], points[e]);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxIdx !== -1 && maxDist > tolerance) {
            keep[maxIdx] = 1;
            stack.push([s, maxIdx], [maxIdx, e]);
        }
    }

    const out = [];
    for (let i = 0; i < points.length; i++) {
        if (keep[i]) out.push(points[i]);
    }
    return out;
}
