// Zigzag fill — connects parallel hatch lines into one continuous polyline
// for far fewer pen lifts than plain hatch.
//
// Works cleanly on convex shapes (one segment per scanline). For concave
// shapes some scanlines produce multiple segments — we still emit them, but
// the result mixes connected zigzag with isolated lines.

import { closedPolygonFor } from "./utils.js";
import { scanlineHatch } from "./hatch.js";

export function generate(shape, { angle = 45, spacing = 2 } = {}) {
    const poly = closedPolygonFor(shape);
    if (!poly) return [];
    const segs = scanlineHatch(poly, angle, spacing);
    if (segs.length === 0) return [];

    // Group segments by their (rotated) Y value — same Y = same scanline.
    // segs come back from scanlineHatch sorted top-to-bottom and left-to-right,
    // already in original coords. We bucket by row using the perpendicular
    // distance between segment starts.
    const rows = bucketRows(segs, spacing);

    // For each row, alternate the direction so consecutive rows connect
    // end-to-end. Multi-segment rows break the chain — emit those rows as
    // separate hatch lines.
    const out = [];
    let chain = [];
    let dir = 1;
    for (const row of rows) {
        if (row.length === 1) {
            const [a, b] = row[0];
            const ordered = dir > 0 ? [a, b] : [b, a];
            if (chain.length === 0) chain.push(ordered[0], ordered[1]);
            else chain.push(ordered[1]);
            dir *= -1;
        } else {
            if (chain.length >= 2) out.push({ id: "fill_zz_" + out.length, type: "polyline", points: chain });
            chain = [];
            dir = 1;
            // Spill the multi-segment row as plain hatch lines.
            for (const [a, b] of row) {
                out.push({ id: "fill_zz_l_" + out.length, type: "line",
                           x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
            }
        }
    }
    if (chain.length >= 2) out.push({ id: "fill_zz_" + out.length, type: "polyline", points: chain });
    return out;
}

function bucketRows(segs, spacing) {
    // Rough bucketing using each segment's midpoint Y. Within spacing/2,
    // segments are considered the same row.
    const rows = [];
    let current = [segs[0]];
    let curY = midY(segs[0]);
    for (let i = 1; i < segs.length; i++) {
        const y = midY(segs[i]);
        if (Math.abs(y - curY) < spacing * 0.5) {
            current.push(segs[i]);
        } else {
            rows.push(current);
            current = [segs[i]];
            curY = y;
        }
    }
    rows.push(current);
    return rows;
}

function midY(seg) { return (seg[0][1] + seg[1][1]) / 2; }
