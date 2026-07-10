// Vertex snapping for drag operations.
//
// Collects vertex points from non-moving shapes as snap candidates. When
// any vertex of the moving set comes within `threshold` of a candidate,
// the drag delta is adjusted so the closest pair snaps exactly.

import { state } from "./state.js";
import { SVG_NS } from "./dom.js";

const SAMPLES_PER_PATH = 32; // sample arbitrary paths at this resolution

/** Collect snap-candidate points from every visible shape NOT in `excludeIds`. */
export function gatherSnapCandidates(excludeIds) {
    const pts = [];
    for (const layer of state.layers) {
        if (!layer.visible) continue;
        for (const s of layer.shapes) {
            if (excludeIds.has(s.id)) continue;
            for (const v of shapeVertices(s)) pts.push(v);
        }
    }
    return pts;
}

/** Vertex points to extract per shape type. */
export function shapeVertices(s) {
    switch (s.type) {
        case "line":     return [[s.x1, s.y1], [s.x2, s.y2]];
        case "rect":     return [
            [s.x, s.y], [s.x + s.w, s.y],
            [s.x + s.w, s.y + s.h], [s.x, s.y + s.h],
        ];
        case "ellipse":  return [
            [s.cx, s.cy],
            [s.cx - s.rx, s.cy], [s.cx + s.rx, s.cy],
            [s.cx, s.cy - s.ry], [s.cx, s.cy + s.ry],
        ];
        case "polyline": return s.points.map(p => [p[0], p[1]]);
        case "path":     return samplePathVertices(s.d);
    }
    return [];
}

// Off-screen <path> reused for getPointAtLength sampling.
let _pathProbe = null;
function samplePathVertices(d) {
    if (!_pathProbe) {
        const svg = document.createElementNS(SVG_NS, "svg");
        svg.style.position = "absolute"; svg.style.width = svg.style.height = "0";
        svg.style.visibility = "hidden";
        const p = document.createElementNS(SVG_NS, "path");
        svg.appendChild(p);
        document.body.appendChild(svg);
        _pathProbe = p;
    }
    _pathProbe.setAttribute("d", d);
    let total;
    try { total = _pathProbe.getTotalLength(); } catch { return []; }
    if (!total) return [];
    const out = [];
    for (let i = 0; i <= SAMPLES_PER_PATH; i++) {
        const pt = _pathProbe.getPointAtLength((i / SAMPLES_PER_PATH) * total);
        out.push([pt.x, pt.y]);
    }
    return out;
}

/** Compute a snap correction for a drag.
 *
 *  `movingVertices` are the vertex points of the shapes being moved at
 *  their *current* (already-translated) positions. `candidates` are the
 *  static snap targets. `threshold` is in document mm — scale up if you
 *  want a larger snap radius.
 *
 *  Returns { dx, dy, snapPoint } if any pair is within threshold, else null.
 *  The caller adds (dx, dy) to its drag translation to snap. */
export function findSnapDelta(movingVertices, candidates, threshold) {
    let best = null;
    let bestDist = threshold;
    for (const [mx, my] of movingVertices) {
        for (const [cx, cy] of candidates) {
            const d = Math.hypot(cx - mx, cy - my);
            if (d < bestDist) {
                bestDist = d;
                best = { dx: cx - mx, dy: cy - my, snapPoint: [cx, cy] };
            }
        }
    }
    return best;
}
