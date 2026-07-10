// Geometry for the scissors / trim tool.
//
// The classic VCarve/Fusion "scissors": clicking a vector removes the
// span of it between the two nearest points where it crosses other
// vectors (or itself). Whatever remains stays as an (open) path — you can
// snip again or rejoin the ends afterwards.
//
// Everything here is pure (no DOM) so it can be unit-tested; the caller
// (interaction.js) converts shapes to point lists and back.

/** Segment AB × segment CD intersection. Returns { x, y, t, u } where t is
 *  the fraction along AB and u along CD, or null if they don't cross within
 *  both segments. Endpoints count (so touching vectors register a cut). */
export function segIntersect(a, b, c, d) {
    const r0 = b[0] - a[0], r1 = b[1] - a[1];
    const s0 = d[0] - c[0], s1 = d[1] - c[1];
    const denom = r0 * s1 - r1 * s0;
    if (Math.abs(denom) < 1e-12) return null; // parallel / collinear
    const qp0 = c[0] - a[0], qp1 = c[1] - a[1];
    const t = (qp0 * s1 - qp1 * s0) / denom;
    const u = (qp0 * r1 - qp1 * r0) / denom;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { x: a[0] + t * r0, y: a[1] + t * r1, t: clamp01(t), u: clamp01(u) };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Segment count of a polyline: N points → N-1 segments open, N closed. */
function segCount(pts, closed) { return closed ? pts.length : pts.length - 1; }

function segEnd(pts, i, closed) { return pts[(i + 1) % pts.length] || pts[i + 1]; }

/** Point at global parameter `g` (= segmentIndex + fraction) on the path. */
export function pointAt(pts, closed, g) {
    const n = segCount(pts, closed);
    let i = Math.floor(g);
    let f = g - i;
    if (i >= n) { i = n - 1; f = 1; }
    if (i < 0) { i = 0; f = 0; }
    const a = pts[i], b = closed ? pts[(i + 1) % pts.length] : pts[i + 1];
    return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])];
}

/** Global parameter of the closest point on the path to `pt`. */
export function nearestParam(pts, closed, pt) {
    let best = 0, bestD = Infinity;
    const n = segCount(pts, closed);
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = closed ? pts[(i + 1) % pts.length] : pts[i + 1];
        const vx = b[0] - a[0], vy = b[1] - a[1];
        const len2 = vx * vx + vy * vy || 1e-12;
        let t = ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / len2;
        t = clamp01(t);
        const dx = pt[0] - (a[0] + t * vx), dy = pt[1] - (a[1] + t * vy);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i + t; }
    }
    return best;
}

/** Sorted global parameters where `target` crosses any segment of any
 *  cutter polyline. Near-duplicate cuts are merged. */
export function crossingParams(targetPts, closed, cutters) {
    const n = segCount(targetPts, closed);
    const params = [];
    for (let i = 0; i < n; i++) {
        const a = targetPts[i], b = closed ? targetPts[(i + 1) % targetPts.length] : targetPts[i + 1];
        for (const cut of cutters) {
            const cn = segCount(cut.pts, cut.closed);
            for (let j = 0; j < cn; j++) {
                const c = cut.pts[j], d = cut.closed ? cut.pts[(j + 1) % cut.pts.length] : cut.pts[j + 1];
                const hit = segIntersect(a, b, c, d);
                if (hit) params.push(i + hit.t);
            }
        }
    }
    params.sort((x, y) => x - y);
    const merged = [];
    for (const p of params) {
        if (!merged.length || Math.abs(p - merged[merged.length - 1]) > 1e-6) merged.push(p);
    }
    return merged;
}

/** Extract the sub-path from global param `from` to `to` (from < to; `to`
 *  may exceed the segment count to wrap a closed path). Returns points. */
function slicePath(pts, closed, from, to) {
    const out = [pointAt(pts, closed, from)];
    const startSeg = Math.floor(from + 1e-9);
    const endSeg = Math.floor(to - 1e-9);
    for (let k = startSeg + 1; k <= endSeg; k++) {
        out.push(pts[k % pts.length]);
    }
    out.push(pointAt(pts, closed, to));
    // Drop near-duplicate consecutive points.
    const clean = [];
    for (const p of out) {
        const last = clean[clean.length - 1];
        if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) clean.push([p[0], p[1]]);
    }
    return clean;
}

/** Bounds {from,to} of the span the click falls in (the part that gets
 *  removed). For a closed path the span wraps via the last→first cut. */
function spanAt(pts, closed, cutParams, clickPt) {
    if (cutParams.length < 2) return null; // nothing bounding a cut
    const click = nearestParam(pts, closed, clickPt);
    const n = segCount(pts, closed);
    if (closed) {
        for (let i = 0; i < cutParams.length; i++) {
            const a = cutParams[i];
            const b = i + 1 < cutParams.length ? cutParams[i + 1] : cutParams[0] + n;
            const c = i + 1 < cutParams.length ? click : (click < cutParams[0] ? click + n : click);
            if (c >= a && c <= b) return { from: a, to: b, n, closed: true };
        }
        return null;
    }
    const bounds = [0, ...cutParams, n];
    for (let i = 0; i < bounds.length - 1; i++) {
        if (click >= bounds[i] && click <= bounds[i + 1]) return { from: bounds[i], to: bounds[i + 1], n, closed: false };
    }
    return null;
}

/** The points of the span that WOULD be removed at the click — for the
 *  hover highlight. Returns null if there's no bounded span here. */
export function removedSpanAt(pts, closed, cutParams, clickPt) {
    const s = spanAt(pts, closed, cutParams, clickPt);
    if (!s) return null;
    const piece = slicePath(pts, closed, s.from, s.to);
    return piece.length >= 2 ? piece : null;
}

/** Remove the span of the path containing the click. Returns an array of
 *  the resulting (open) point-lists kept — 0, 1, or 2 pieces. */
export function trimSpanAt(pts, closed, cutParams, clickPt) {
    const s = spanAt(pts, closed, cutParams, clickPt);
    if (!s) return null;
    if (s.closed) {
        // Keep the complement: from the span end around to its start (+n).
        const piece = slicePath(pts, closed, s.to, s.from + s.n);
        return piece.length >= 2 ? [piece] : null;
    }
    const pieces = [];
    if (s.from > 1e-6) pieces.push(slicePath(pts, closed, 0, s.from));
    if (s.to < s.n - 1e-6) pieces.push(slicePath(pts, closed, s.to, s.n));
    return pieces.filter(p => p.length >= 2);
}
