// Resample the outline at small steps and perturb each sample perpendicular
// to the local tangent in a sawtooth pattern. Amplitude = mm to either side;
// frequency = sawtooth periods per mm of original outline length.

import { shapeToPolyline, polylineShape } from "./utils.js";

export function apply(shape, { amplitude = 0.8, frequency = 0.7 } = {}) {
    const poly = shapeToPolyline(shape);
    if (!poly || poly.length < 2) return [shape];

    // Step ~= 1/(4*frequency) so each sawtooth peak/trough is well-sampled.
    const step = Math.max(0.1, 1 / Math.max(0.05, frequency * 4));
    const resampled = resamplePolyline(poly, step);
    const out = [];
    let phase = 0;
    for (let i = 0; i < resampled.length; i++) {
        const [x, y] = resampled[i];
        // Tangent estimate from neighbors.
        const prev = resampled[Math.max(0, i - 1)];
        const next = resampled[Math.min(resampled.length - 1, i + 1)];
        const tx = next[0] - prev[0], ty = next[1] - prev[1];
        const tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl; // perpendicular

        // Sawtooth in [-1, +1].
        const phaseFrac = (phase * frequency) % 1;
        const saw = phaseFrac < 0.5 ? phaseFrac * 4 - 1 : 3 - phaseFrac * 4;

        out.push([x + nx * amplitude * saw, y + ny * amplitude * saw]);
        phase += step;
    }
    return [polylineShape(out)];
}

function resamplePolyline(poly, step) {
    const out = [poly[0]];
    let carry = 0;
    for (let i = 1; i < poly.length; i++) {
        const [ax, ay] = poly[i - 1];
        const [bx, by] = poly[i];
        const segLen = Math.hypot(bx - ax, by - ay);
        if (segLen === 0) continue;
        const dx = (bx - ax) / segLen, dy = (by - ay) / segLen;
        let d = step - carry;
        while (d < segLen) {
            out.push([ax + dx * d, ay + dy * d]);
            d += step;
        }
        carry = segLen - (d - step);
    }
    out.push(poly[poly.length - 1]);
    return out;
}
