// Shared helpers for the outline-style modules (PP-2c). The pattern they all build on: flatten a shape to a
// polyline, transform that polyline, re-emit. Pure, EXCEPT samplePath (path shapes) which needs the browser SVG
// engine (getTotalLength) — GUARDED so #core/plot loads/runs in Node (path outlines degrade to null there; browser
// gets full support). Same tracked reconciliation onto the pure parsePathSubpaths as PP-2a fromPath / fills utils.

const ELLIPSE_SEGMENTS = 96;

let _id = 0;
// TASK 453: the declared dash fields. dashed.apply walks the outline in steps of at most (dash_length + dash_gap) and
// would never advance for 0 + 0, so apply() coerces both at its entry with these.
export const DASH_LENGTH = { key: "dash_length", label: "Dash length", type: "number", default: 2, unit: "mm", min: 0.1, max: 100, step: 0.1 };
export const DASH_GAP    = { key: "dash_gap",    label: "Dash gap",    type: "number", default: 1, unit: "mm", min: 0,   max: 100, step: 0.1 };
export { coerceParam } from "../params.js";

export const outlineId = () => "out_" + (++_id);

// Flatten any shape to a polyline (list of [x, y]). Ellipses are sampled; paths use the guarded off-screen sampler.
export function shapeToPolyline(s) {
    switch (s.type) {
        case "line":
            return [[s.x1, s.y1], [s.x2, s.y2]];
        case "rect":
            return [
                [s.x, s.y], [s.x + s.w, s.y],
                [s.x + s.w, s.y + s.h], [s.x, s.y + s.h],
                [s.x, s.y],
            ];
        case "ellipse": {
            const pts = [];
            for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
                const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
                pts.push([s.cx + Math.cos(t) * s.rx, s.cy + Math.sin(t) * s.ry]);
            }
            return pts;
        }
        case "polyline":
            return s.points.map(p => [p[0], p[1]]);
        case "path":
            return samplePath(s.d);
    }
    return null;
}

let _sampler = null;
function samplePath(d) {
    if (typeof document === "undefined") return null; // #core is DOM-free; no browser SVG engine here
    if (!_sampler) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.position = "absolute";
        svg.style.width = svg.style.height = "0";
        svg.style.visibility = "hidden";
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.appendChild(p);
        document.body.appendChild(svg);
        _sampler = p;
    }
    _sampler.setAttribute("d", d);
    const total = _sampler.getTotalLength();
    if (!total) return null;
    const step = 0.5;
    const n = Math.max(2, Math.ceil(total / step));
    const out = [];
    for (let i = 0; i <= n; i++) {
        const pt = _sampler.getPointAtLength((i / n) * total);
        out.push([pt.x, pt.y]);
    }
    return out;
}

export function polylineShape(points) {
    return { id: outlineId(), type: "polyline", points };
}
