// Shape geometry helpers: build SVG elements, translate, serialize back to SVG strings.
// Pure functions — no DOM mutation outside the returned element.

import { SVG_NS } from "./dom.js";

const samePt = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** Editable node list for a shape: { pts, closed, kind } or null. Supports
 *  polylines and straight (M/L/Z-only) paths — the kinds whose vertices map
 *  cleanly to points. Used by the node-edit tool. */
export function getNodes(shape) {
    if (shape.type === "polyline") {
        const pts = shape.points.map(p => [p[0], p[1]]);
        let closed = false;
        if (pts.length > 2 && samePt(pts[0], pts[pts.length - 1])) { pts.pop(); closed = true; }
        return { pts, closed, kind: "polyline" };
    }
    if (shape.type === "path" && shape.d && !/[cCsSqQtTaA]/.test(shape.d)) {
        const nums = (shape.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
        if (pts.length < 2) return null;
        let closed = /[zZ]/.test(shape.d);
        if (pts.length > 2 && samePt(pts[0], pts[pts.length - 1])) { pts.pop(); closed = true; }
        return { pts, closed, kind: "path" };
    }
    return null;
}

/** Write an edited node list back onto the shape, preserving its kind and
 *  re-closing if it was closed. */
export function setNodes(shape, pts, closed) {
    if (shape.type === "polyline") {
        shape.points = closed ? [...pts.map(p => [p[0], p[1]]), [pts[0][0], pts[0][1]]] : pts.map(p => [p[0], p[1]]);
    } else { // straight path
        let d = "M " + pts.map(p => `${p[0]},${p[1]}`).join(" L ");
        if (closed) d += " Z";
        shape.d = d;
    }
}

export function makeShapeElement(shape) {
    let el;
    switch (shape.type) {
        case "line":
            el = document.createElementNS(SVG_NS, "line");
            el.setAttribute("x1", shape.x1); el.setAttribute("y1", shape.y1);
            el.setAttribute("x2", shape.x2); el.setAttribute("y2", shape.y2);
            break;
        case "rect":
            el = document.createElementNS(SVG_NS, "rect");
            el.setAttribute("x", shape.x); el.setAttribute("y", shape.y);
            el.setAttribute("width", shape.w); el.setAttribute("height", shape.h);
            break;
        case "ellipse":
            el = document.createElementNS(SVG_NS, "ellipse");
            el.setAttribute("cx", shape.cx); el.setAttribute("cy", shape.cy);
            el.setAttribute("rx", shape.rx); el.setAttribute("ry", shape.ry);
            break;
        case "polyline":
            el = document.createElementNS(SVG_NS, "polyline");
            el.setAttribute("points", shape.points.map(p => `${p[0]},${p[1]}`).join(" "));
            break;
        case "path":
            el = document.createElementNS(SVG_NS, "path");
            el.setAttribute("d", shape.d);
            break;
    }
    el.classList.add("shape");
    el.dataset.shapeId = shape.id;
    // Per-shape paint overrides (preserved from import) win over the
    // layer's <g> defaults. Tri-state semantics:
    //   undefined → inherit from layer's <g>
    //   null      → explicit "none" (no paint)
    //   string    → use as the color
    if (shape._fill        !== undefined) el.setAttribute("fill",   shape._fill   ?? "none");
    if (shape._stroke      !== undefined) el.setAttribute("stroke", shape._stroke ?? "none");
    if (shape._strokeWidth !== undefined) el.setAttribute("stroke-width", shape._strokeWidth);
    return el;
}

export function shapeToSvgString(s) {
    switch (s.type) {
        case "line":     return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`;
        case "rect":     return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}"/>`;
        case "ellipse":  return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}"/>`;
        case "polyline": return `<polyline points="${s.points.map(p => p[0] + "," + p[1]).join(" ")}"/>`;
        case "path":     return `<path d="${s.d}"/>`;
    }
    return "";
}

export function translateShape(s, dx, dy) {
    switch (s.type) {
        case "line":     s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; break;
        case "rect":     s.x += dx; s.y += dy; break;
        case "ellipse":  s.cx += dx; s.cy += dy; break;
        case "polyline": s.points = s.points.map(p => [p[0] + dx, p[1] + dy]); break;
        case "path":     s.d = translatePathD(s.d, dx, dy); break;
    }
}

// Translate absolute M/L/C/Q/T paths. Handles freehand output reliably;
// imported paths with arcs (A) or relative commands fall back to no-op.
export function translatePathD(d, dx, dy) {
    return d.replace(/([MLCQT])\s*((?:[-\d.eE+]+[ ,]+)*[-\d.eE+]+)/g, (m, cmd, nums) => {
        const arr = nums.trim().split(/[ ,]+/).map(Number);
        for (let i = 0; i < arr.length; i += 2) {
            arr[i] += dx;
            arr[i + 1] += dy;
        }
        return cmd + " " + arr.join(" ");
    });
}

/** Axis-aligned bounds of a shape: {minX, minY, maxX, maxY}. */
export function shapeBounds(s) {
    switch (s.type) {
        case "line":
            return { minX: Math.min(s.x1, s.x2), minY: Math.min(s.y1, s.y2),
                     maxX: Math.max(s.x1, s.x2), maxY: Math.max(s.y1, s.y2) };
        case "rect":
            return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
        case "ellipse":
            return { minX: s.cx - s.rx, minY: s.cy - s.ry,
                     maxX: s.cx + s.rx, maxY: s.cy + s.ry };
        case "polyline": {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const [x, y] of s.points) {
                if (x < minX) minX = x; if (y < minY) minY = y;
                if (x > maxX) maxX = x; if (y > maxY) maxY = y;
            }
            return { minX, minY, maxX, maxY };
        }
        case "path":
            return pathBounds(s.d);
    }
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** Combined bounds of a list of shapes. */
export function combinedBounds(shapes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) {
        const b = shapeBounds(s);
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
    }
    if (!isFinite(minX)) return null;
    return { minX, minY, maxX, maxY };
}

// Off-screen <path> for getBBox-based path bounds.
let _bboxProbe = null;
function pathBounds(d) {
    if (!_bboxProbe) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.position = "absolute"; svg.style.width = svg.style.height = "0";
        svg.style.visibility = "hidden";
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        svg.appendChild(p);
        document.body.appendChild(svg);
        _bboxProbe = p;
    }
    _bboxProbe.setAttribute("d", d);
    try {
        const b = _bboxProbe.getBBox();
        return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
    } catch {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
}

/** Centroid of a shape — used as the pivot for rotate/scale. */
export function shapeCenter(s) {
    switch (s.type) {
        case "line": return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2];
        case "rect": return [s.x + s.w / 2, s.y + s.h / 2];
        case "ellipse": return [s.cx, s.cy];
        case "polyline": {
            let sx = 0, sy = 0;
            for (const [x, y] of s.points) { sx += x; sy += y; }
            return [sx / s.points.length, sy / s.points.length];
        }
        case "path": {
            // Best-effort: use the path's starting M coordinate. Adequate for
            // freehand and most CAD exports; for arbitrary paths the visual
            // result may not pivot perfectly around the geometric centroid.
            const m = s.d.match(/M\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)/);
            return m ? [+m[1], +m[2]] : [0, 0];
        }
    }
    return [0, 0];
}

/** Rotate a shape by `angle` (radians) around (cx, cy). Note: rects become
 *  polylines after rotation (axis-aligned rectangles can't represent rotation).
 *  Ellipses only have their centers rotated; their axes stay aligned. */
export function rotateShape(s, angle, cx, cy) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const r = (x, y) => [cx + (x - cx) * cos - (y - cy) * sin,
                         cy + (x - cx) * sin + (y - cy) * cos];
    switch (s.type) {
        case "line":
            [s.x1, s.y1] = r(s.x1, s.y1);
            [s.x2, s.y2] = r(s.x2, s.y2);
            break;
        case "rect": {
            const x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
            const pts = [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]].map(([x,y]) => r(x,y));
            s.type = "polyline";
            s.points = pts;
            delete s.x; delete s.y; delete s.w; delete s.h;
            break;
        }
        case "ellipse":
            [s.cx, s.cy] = r(s.cx, s.cy);
            break;
        case "polyline":
            s.points = s.points.map(([x, y]) => r(x, y));
            break;
        case "path":
            s.d = transformPathD(s.d, r);
            break;
    }
}

/** Scale a shape by `factor` around (cx, cy). */
export function scaleShape(s, factor, cx, cy) {
    const sc = (x, y) => [cx + (x - cx) * factor, cy + (y - cy) * factor];
    switch (s.type) {
        case "line":
            [s.x1, s.y1] = sc(s.x1, s.y1);
            [s.x2, s.y2] = sc(s.x2, s.y2);
            break;
        case "rect": {
            const [nx, ny] = sc(s.x, s.y);
            const [ex, ey] = sc(s.x + s.w, s.y + s.h);
            s.x = nx; s.y = ny; s.w = ex - nx; s.h = ey - ny;
            break;
        }
        case "ellipse":
            [s.cx, s.cy] = sc(s.cx, s.cy);
            s.rx *= factor; s.ry *= factor;
            break;
        case "polyline":
            s.points = s.points.map(([x, y]) => sc(x, y));
            break;
        case "path":
            s.d = transformPathD(s.d, sc);
            break;
    }
}

function transformPathD(d, fn) {
    return d.replace(/([MLCQT])\s*((?:[-\d.eE+]+[ ,]+)*[-\d.eE+]+)/g, (m, cmd, nums) => {
        const arr = nums.trim().split(/[ ,]+/).map(Number);
        const out = [];
        for (let i = 0; i < arr.length; i += 2) {
            const [nx, ny] = fn(arr[i], arr[i + 1]);
            out.push(nx, ny);
        }
        return cmd + " " + out.join(" ");
    });
}

export function deepCopyShape(s) {
    return JSON.parse(JSON.stringify(s));
}
