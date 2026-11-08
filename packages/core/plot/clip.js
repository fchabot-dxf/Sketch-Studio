// packages/core/plot/clip.js — ROBUST polygon boolean + offset engine for #core/plot, on the vendored Clipper
// library (Angus Johnson's Vatti clipping/offsetting). Ported from the penplotter (PP-2b-1). Pure ops (no DOM).
//
// BOUNDARY (north star #2 — TWO DISTINCT capabilities, each ONE home):
//   - #core/polygon-offset.js = PURE simple-loop CAD offset: one ring in, one ring out, returns [] on a split.
//     KEPT for Shaper export + vcarve (byte-exact, zero-dep). NOT rerouted through Clipper.
//   - THIS (clip.js) = ROBUST art/fill boolean + offset: SPLITS a ring into many, handles concave regions + holes
//     + boolean unions. The plotter's fills (arbitrary art) need this; polygon-offset cannot do it by design.
// Eventual UNIFY (route polygon-offset's simple case through Clipper so there is one offset impl) = TRACKED DEBT.
//
// Clipper works in integer coordinates, so everything is scaled by CLIP_SCALE in and divided back out.

import "./vendor/clipper-node-shim.js"; // MUST precede clipper: self -> globalThis so the browser UMD loads in Node
import ClipperLib from "./vendor/clipper.js";

export { ClipperLib };

// 1000 -> sub-micron precision for mm-scale artwork; well within the integer-coordinate budget.
export const CLIP_SCALE = 1000;

/** [[x,y],...] -> Clipper path [{X,Y},...], dropping a duplicate closing point. */
export function toClipper(points) {
    const path = points.map(p => ({ X: Math.round(p[0] * CLIP_SCALE), Y: Math.round(p[1] * CLIP_SCALE) }));
    if (path.length > 1) {
        const a = path[0], b = path[path.length - 1];
        if (a.X === b.X && a.Y === b.Y) path.pop();
    }
    return path;
}

/** Clipper path -> [[x,y],...] in source units, explicitly closed. */
export function fromClipper(path) {
    const pts = path.map(pt => [pt.X / CLIP_SCALE, pt.Y / CLIP_SCALE]);
    if (pts.length) pts.push([pts[0][0], pts[0][1]]);
    return pts;
}

/** Offset a closed polygon by `amount` mm: positive shrinks INWARD (inset), negative grows OUTWARD (bleed).
 *  Returns the resulting closed ring(s) — an inset can SPLIT a concave shape into several; an outward grow is one. */
export function insetPolygon(polygon, amount) {
    const path = toClipper(polygon);
    if (path.length < 3) return [];
    if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
    const co = new ClipperLib.ClipperOffset(2 /* miterLimit */, 0.25 * CLIP_SCALE);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const sol = new ClipperLib.Paths();
    co.Execute(sol, -amount * CLIP_SCALE); // negative delta = inward
    return sol.filter(r => r.length >= 3).map(fromClipper);
}

/** Boolean union of polygons into their combined outline. Each input is a closed ring [[x,y],...]. Returns the
 *  merged boundary as an array of closed rings in source units — usually one outer ring, plus extras for holes /
 *  disjoint pieces. */
export function unionPolygons(polygons) {
    const clipper = new ClipperLib.Clipper();
    let added = 0;
    for (const poly of polygons) {
        const path = toClipper(poly);
        if (path.length >= 3) { clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true); added++; }
    }
    if (!added) return [];
    const sol = new ClipperLib.Paths();
    clipper.Execute(ClipperLib.ClipType.ctUnion, sol,
        ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return sol.filter(r => r.length >= 3).map(fromClipper);
}

/** Concentric offsets of a closed polygon. Ring i is inset by `offset + i*spacing`, starting at i = 0 — so with
 *  offset 0 the FIRST ring is the outline itself. A negative offset starts OUTSIDE (overdraw/bleed). Returns an
 *  array of closed point-rings — MORE THAN ONE per step when the shape pinches and splits. Robust on concave
 *  shapes (mitred corners, no self-intersection) where a naive per-vertex offset tangles. */
export function offsetRings(polygon, spacing, offset = 0, maxRings = 500) {
    const path = toClipper(polygon);
    if (path.length < 3) return [];
    if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
    const co = new ClipperLib.ClipperOffset(2 /* miterLimit */, 0.25 * CLIP_SCALE);
    co.AddPath(path, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const rings = [];
    for (let i = 0; i < maxRings; i++) {
        const inset = offset + i * spacing;
        const sol = new ClipperLib.Paths();
        co.Execute(sol, -inset * CLIP_SCALE);
        if (!sol.length) {
            if (inset > 0) break;
            continue;
        }
        for (const ring of sol) {
            if (ring.length >= 3) rings.push(fromClipper(ring));
        }
    }
    return rings;
}

// ── REGIONS (TASK 459): a region is { outer, holes } — outer ring + the holes inside it, rings as [[x,y],...] explicitly
// closed (the fromClipper form). unionPolygons above is a FLAT nonzero union with no nesting, which cannot say "this ring
// is a hole" and would FILL the islands of an evenodd footprint (a pocket with an island). These helpers resolve a
// footprint's own fillRule ONCE into regions, then do the booleans on canonically oriented regions (outer positive, holes
// negative, so NonZero is exact for every later operation). Used by #core/relief-model (the 3D Review terraces).

function _regionsFromTree(tree) {
    const out = [];
    const walk = (node) => {                       // node = a non-hole contour; its children are its holes
        const holes = node.Childs().map(h => fromClipper(h.Contour()));
        out.push({ outer: fromClipper(node.Contour()), holes });
        for (const h of node.Childs()) for (const inner of h.Childs()) walk(inner); // islands inside holes
    };
    for (const top of tree.Childs()) walk(top);
    return out.filter(r => r.outer.length >= 4);
}

function _execTree(type, subjPaths, clipPaths, subjFill, clipFill) {
    const clipper = new ClipperLib.Clipper();
    if (subjPaths.length) clipper.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
    if (clipPaths.length) clipper.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
    const tree = new ClipperLib.PolyTree();
    clipper.Execute(type, tree, subjFill, clipFill);
    return _regionsFromTree(tree);
}

/** rings ([[x,y],...][]) + a fill rule ('evenodd' | 'nonzero') -> regions. evenodd: nested rings alternate solid/hole. */
export function regionsFromRings(rings, fillRule = 'nonzero') {
    const paths = rings.map(toClipper).filter(p => p.length >= 3);
    if (!paths.length) return [];
    const fill = fillRule === 'evenodd' ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero;
    return _execTree(ClipperLib.ClipType.ctUnion, paths, [], fill, fill);
}

function _regionPaths(regions) {
    const paths = [];
    for (const r of regions) {
        const o = toClipper(r.outer); if (o.length < 3) continue;
        if (!ClipperLib.Clipper.Orientation(o)) o.reverse();
        paths.push(o);
        for (const h of r.holes) {
            const hp = toClipper(h); if (hp.length < 3) continue;
            if (ClipperLib.Clipper.Orientation(hp)) hp.reverse();
            paths.push(hp);
        }
    }
    return paths;
}

const _NZ = () => ClipperLib.PolyFillType.pftNonZero;
/** Union of any number of region lists -> regions. */
export function unionRegions(...lists) {
    const paths = lists.flatMap(_regionPaths);
    return paths.length ? _execTree(ClipperLib.ClipType.ctUnion, paths, [], _NZ(), _NZ()) : [];
}
/** a minus b -> regions. */
export function diffRegions(a, b) {
    const pa = _regionPaths(a);
    return pa.length ? _execTree(ClipperLib.ClipType.ctDifference, pa, _regionPaths(b), _NZ(), _NZ()) : [];
}
/** a intersect b -> regions. */
export function intersectRegions(a, b) {
    const pa = _regionPaths(a), pb = _regionPaths(b);
    return pa.length && pb.length ? _execTree(ClipperLib.ClipType.ctIntersection, pa, pb, _NZ(), _NZ()) : [];
}
