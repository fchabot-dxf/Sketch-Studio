// Replace each shape's outline with a series of dashes. The whole polyline
// is walked at constant speed; alternating segments are emitted as dashes
// while gap segments are skipped.

import { shapeToPolyline, polylineShape } from "./utils.js";

export function apply(shape, { dash_length = 2, dash_gap = 1 } = {}) {
    const poly = shapeToPolyline(shape);
    if (!poly || poly.length < 2) return [shape];

    const period = dash_length + dash_gap;
    const out = [];
    let current = [];           // current dash being built
    let phase = 0;              // distance walked so far inside the current period

    for (let i = 1; i < poly.length; i++) {
        const [ax, ay] = poly[i - 1];
        const [bx, by] = poly[i];
        const segLen = Math.hypot(bx - ax, by - ay);
        if (segLen === 0) continue;
        const dx = (bx - ax) / segLen;
        const dy = (by - ay) / segLen;

        let walked = 0;
        // Begin from the current accumulated phase.
        let dashStart = phase;
        while (walked < segLen) {
            const inDash = dashStart < dash_length;
            const limit = inDash ? dash_length - dashStart : period - dashStart;
            const advance = Math.min(limit, segLen - walked);
            if (inDash) {
                const x0 = ax + dx * walked, y0 = ay + dy * walked;
                const x1 = ax + dx * (walked + advance), y1 = ay + dy * (walked + advance);
                if (current.length === 0) current.push([x0, y0]);
                current.push([x1, y1]);
            } else if (current.length >= 2) {
                out.push(polylineShape(current));
                current = [];
            }
            walked += advance;
            dashStart += advance;
            if (dashStart >= period) dashStart -= period;
        }
        phase = dashStart;
    }
    if (current.length >= 2) out.push(polylineShape(current));
    return out;
}
