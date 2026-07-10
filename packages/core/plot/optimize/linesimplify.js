// Apply Douglas–Peucker to every polyline. Acts as a noise/precision
// reducer — vpype's default is 0.05 mm. Smaller tolerance = more
// faithful curves at the cost of more G-code lines.

import { douglasPeucker } from "./douglas-peucker.js";

export function linesimplify(polylines, tolerance = 0.05) {
    return polylines.map(p => douglasPeucker(p, tolerance));
}
