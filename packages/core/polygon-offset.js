// packages/core/polygon-offset.js — parallel (Minkowski-style) offset of a closed polygon. PURE, no DOM.
//
// offsetPolygon(points, distance) → points[] : a PARALLEL offset of a closed polygon. POSITIVE distance = OUTWARD
// (the polygon grows), NEGATIVE = INWARD (shrinks) — regardless of the input winding (normalized internally).
// METHOD: shift each edge along its outward normal by `distance`, then MITER-join adjacent offset edges at the
// intersection of their (extended) offset lines (reuses #core/geometry.getLineIntersection). One offset vertex per
// input vertex. Convex corners miter outward; concave corners trim at the intersection.
//
// SCOPE (SP1h2): SIMPLE loops (convex / mild concave). DEFERRED to h3 (robustness): self-intersection on thin necks
// (an over-inset is DETECTED here — the winding flips → returns [] — but a partial collapse / a thin slot can still
// produce a self-crossing offset that this slice does NOT clip). Additive #core — nothing else imports it yet, so
// SketchStudio stays byte-identical; reused by SP1j export.

import { perpendicularNormal, getLineIntersection } from './geometry.js';

const EPS = 1e-9;

function signedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return s / 2;
}

// SP1h3: drop consecutive near-duplicate vertices (tiny / zero-length edges) so perpendicularNormal never sees a
// ~zero edge (no NaN normals, no runaway miters). Keeps genuine arc-sample curvature (only TRUE duplicates go).
function dedupe(points, tol) {
  const out = [];
  for (const p of (points || [])) { const last = out[out.length - 1]; if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) out.push({ x: p.x, y: p.y }); }
  while (out.length >= 2 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= tol) out.pop();
  return out;
}

const cross3 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
// True crossing of segments p1p2 & p3p4 (ignores shared endpoints / mere touching).
function segsCross(p1, p2, p3, p4) {
  const d1 = cross3(p3, p4, p1), d2 = cross3(p3, p4, p2), d3 = cross3(p1, p2, p3), d4 = cross3(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}
// SP1h3: does the (closed) polygon self-cross? O(n²) over non-adjacent edge pairs — the thin-neck / concave-fold guard.
function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; // skip shared-endpoint neighbours
      if (segsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

// offsetPolygon(points, distance) → points[]. POSITIVE = OUTWARD, NEGATIVE = INWARD (winding-normalized).
// SP1h2: miter-joined parallel offset for SIMPLE loops. SP1h3 hardens it: tiny-edge dedupe; over-inset detection
// (edge-direction reversal — robust to the inverted-ghost that keeps the same winding) + collapsed-area; and a
// SELF-INTERSECTION guard (thin necks / concave folds). When the offset would self-cross or invert, returns [] (a
// CLEAN empty — no garbage). FULL self-intersection CLIPPING (returning the valid sub-loops) is deferred past this
// slice; detect-and-empty is the contract here.
export function offsetPolygon(points, distance) {
  if (!Number.isFinite(distance)) return [];
  const pts = dedupe(points, 1e-7);
  const n = pts.length;
  if (n < 3) return [];
  if (distance === 0) return pts.map((p) => ({ x: p.x, y: p.y }));

  const area0 = signedArea(pts);
  if (Math.abs(area0) < EPS) return []; // degenerate (collinear / zero area)
  // Normalize so POSITIVE distance is OUTWARD irrespective of the input winding (loops here are CCW, but be robust).
  const d = area0 > 0 ? distance : -distance;

  // Per-edge offset segment (shift both endpoints along the OUTWARD normal = −perpendicularNormal for CCW).
  const seg = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const { nx, ny, len } = perpendicularNormal(a, b);
    if (len < EPS) { seg[i] = null; continue; } // degenerate edge (shouldn't survive dedupe) — skip
    const ox = -nx * d, oy = -ny * d;
    seg[i] = { a: { x: a.x + ox, y: a.y + oy }, b: { x: b.x + ox, y: b.y + oy } };
  }

  // Miter-join: each input vertex i (shared by edge i-1 and edge i) → the intersection of their offset lines.
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = seg[(i - 1 + n) % n], cur = seg[i];
    if (!prev && !cur) continue;
    if (!prev) { out.push({ x: cur.a.x, y: cur.a.y }); continue; }
    if (!cur) { out.push({ x: prev.b.x, y: prev.b.y }); continue; }
    const ip = getLineIntersection(prev.a, prev.b, cur.a, cur.b);
    out.push(ip ? { x: ip.x, y: ip.y } : { x: cur.a.x, y: cur.a.y }); // parallel (collinear) → no corner
  }

  if (out.length < 3) return [];
  // Over-inset: a valid offset preserves each edge's DIRECTION (parallel shift + miter; out[i] ↔ pts[i], 1:1 — no
  // bevels). An inverted (over-inset) edge reverses, even when the ghost keeps the same winding.
  if (out.length === n) {
    for (let i = 0; i < n; i++) {
      if (!seg[i]) continue;
      const a = pts[i], b = pts[(i + 1) % n], oa = out[i], ob = out[(i + 1) % n];
      if ((b.x - a.x) * (ob.x - oa.x) + (b.y - a.y) * (ob.y - oa.y) < -EPS) return []; // edge reversed → inverted
    }
  }
  if (Math.abs(signedArea(out)) < EPS) return []; // collapsed to a point/line
  if (selfIntersects(out)) return [];             // thin-neck / concave fold → clean empty (no garbage)
  return out;
}
