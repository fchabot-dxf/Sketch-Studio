// Reorder polylines so the pen-up travel between strokes is minimized.
// Greedy nearest-neighbor heuristic — for each completed polyline, the
// next one is whichever has an endpoint closest to the current endpoint
// (and gets reversed if its tail end is closer than its head). Not
// optimal (this is a TSP variant) but cheap and ~90% as good as more
// sophisticated approaches like 2-opt for typical plotter art.

import { distSq } from "../geom/distance.js";

export function linesort(polylines) {
    if (polylines.length <= 1) return polylines.map(p => p.slice());

    const remaining = polylines.map(p => p.slice());
    const sorted = [];

    let current = remaining.shift();
    sorted.push(current);

    while (remaining.length > 0) {
        const last = current[current.length - 1];
        let bestIdx = 0, bestDist = Infinity, bestReverse = false;
        for (let i = 0; i < remaining.length; i++) {
            const p = remaining[i];
            const d1 = distSq(last, p[0]);
            const d2 = distSq(last, p[p.length - 1]);
            if (d1 < bestDist) { bestDist = d1; bestIdx = i; bestReverse = false; }
            if (d2 < bestDist) { bestDist = d2; bestIdx = i; bestReverse = true; }
        }
        current = remaining.splice(bestIdx, 1)[0];
        if (bestReverse) current.reverse();
        sorted.push(current);
    }
    return sorted;
}
