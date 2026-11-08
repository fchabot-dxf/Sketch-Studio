// The classic vpype pipeline, in order:
//   1. linemerge — join touching segments (fewer pen lifts)
//   2. linesort   — reorder for minimum travel
//   3. linesimplify — drop redundant vertices
//
// This is what `vpype read in.svg linemerge linesort linesimplify ...`
// runs server-side. Pure functions, no I/O, easy to test.

import { linemerge } from "./linemerge.js";
import { linesort } from "./linesort.js";
import { linesimplify } from "./linesimplify.js";
import { TOLERANCE_FIELD } from "../gcode/params.js";
import { coerceParam } from "../params.js";

export { linemerge, linesort, linesimplify };

export function optimize(polylines, { mergeTol = 0.05, simplifyTol = 0.1 } = {}) {
    const merged = linemerge(polylines, mergeTol);
    const sorted = linesort(merged);
    const simplified = linesimplify(sorted, coerceParam(TOLERANCE_FIELD, simplifyTol)); // TASK 453: 0 / negative / NaN tolerance never reaches the simplifier
    return simplified;
}
