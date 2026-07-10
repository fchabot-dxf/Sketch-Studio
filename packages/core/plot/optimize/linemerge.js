// Merge polylines whose endpoints touch (within `tolerance` mm). Two
// segments that share an endpoint become one, dramatically reducing pen
// lifts for the plotter. Repeats until no more joins are possible.

import { dist } from "../geom/distance.js";

export function linemerge(polylines, tolerance = 0.05) {
    const remaining = polylines.map(p => p.slice());
    const merged = [];

    while (remaining.length > 0) {
        let current = remaining.shift();
        let extended = true;
        while (extended) {
            extended = false;
            for (let i = 0; i < remaining.length; i++) {
                const other = remaining[i];
                const cStart = current[0];
                const cEnd = current[current.length - 1];
                const oStart = other[0];
                const oEnd = other[other.length - 1];

                if (dist(cEnd, oStart) <= tolerance) {
                    current = current.concat(other.slice(1));
                } else if (dist(cEnd, oEnd) <= tolerance) {
                    current = current.concat(other.slice(0, -1).reverse());
                } else if (dist(oEnd, cStart) <= tolerance) {
                    current = other.slice(0, -1).concat(current);
                } else if (dist(oStart, cStart) <= tolerance) {
                    current = other.slice(1).reverse().concat(current);
                } else {
                    continue;
                }
                remaining.splice(i, 1);
                extended = true;
                break;
            }
        }
        merged.push(current);
    }
    return merged;
}
