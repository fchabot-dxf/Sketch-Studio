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
// SP1h4: push a circular arc (radius r, centre c) from `from` to `to`, the SHORT way, sampled ~every 22.5°. Used by
// the ROUND join to fill a convex gap with the tool-radius arc (endpoints included → connects cleanly to the edges).
function pushArc(out, c, from, to, r) {
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  let da = Math.atan2(to.y - c.y, to.x - c.x) - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 8)));
  for (let k = 0; k <= steps; k++) { const a = a0 + da * (k / steps); out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }); }
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

// offsetPolygon(points, distance, opts?) → points[]. POSITIVE = OUTWARD, NEGATIVE = INWARD (winding-normalized).
// opts.join: 'miter' (default — unchanged) or 'round' (SP1h4 — convex GAPS filled with a tool-radius arc; reflex
// corners still trim at the intersection). SP1h2: miter-joined parallel offset for SIMPLE loops. SP1h3 hardens it:
// tiny-edge dedupe; over-inset detection (edge-direction reversal — robust to the inverted-ghost that keeps the same
// winding) + collapsed-area; and a SELF-INTERSECTION guard (thin necks / concave folds). When the offset would
// self-cross or invert, returns [] (a CLEAN empty — no garbage). FULL self-intersection CLIPPING is deferred.
export function offsetPolygon(points, distance, opts = {}) {
  if (!Number.isFinite(distance)) return [];
  const round = opts && opts.join === 'round';
  const pts = dedupe(points, 1e-7);
  const n = pts.length;
  if (n < 3) return [];
  if (distance === 0) return pts.map((p) => ({ x: p.x, y: p.y }));

  const area0 = signedArea(pts);
  if (Math.abs(area0) < EPS) return []; // degenerate (collinear / zero area)
  // Normalize so POSITIVE distance is OUTWARD irrespective of the input winding (loops here are CCW, but be robust).
  const d = area0 > 0 ? distance : -distance;
  const absd = Math.abs(distance);
  const sdsa = Math.sign(distance) * Math.sign(area0); // round-join gap test: convex-outward / reflex-inward

  // Per-edge offset segment (shift both endpoints along the OUTWARD normal = −perpendicularNormal for CCW).
  const seg = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const { nx, ny, len } = perpendicularNormal(a, b);
    if (len < EPS) { seg[i] = null; continue; } // degenerate edge (shouldn't survive dedupe) — skip
    const ox = -nx * d, oy = -ny * d;
    seg[i] = { a: { x: a.x + ox, y: a.y + oy }, b: { x: b.x + ox, y: b.y + oy } };
  }

  // Join each input vertex i (shared by edge i-1 and edge i). MITER → the intersection of the two offset lines.
  // ROUND → at a convex GAP (the offset side opens up), an arc of radius |distance| about the vertex (the tool can't
  // cut a sharp corner); reflex corners still trim at the intersection.
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = seg[(i - 1 + n) % n], cur = seg[i];
    if (!prev && !cur) continue;
    if (!prev) { out.push({ x: cur.a.x, y: cur.a.y }); continue; }
    if (!cur) { out.push({ x: prev.b.x, y: prev.b.y }); continue; }
    if (round) {
      const v = pts[i], p0 = pts[(i - 1 + n) % n], p2 = pts[(i + 1) % n];
      const turn = (v.x - p0.x) * (p2.y - v.y) - (v.y - p0.y) * (p2.x - v.x); // >0 = left turn
      if (sdsa * turn > EPS) { pushArc(out, v, prev.b, cur.a, absd); continue; } // convex gap → round it
    }
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

// openPolygon(points, radius, offset?) → points[] : the morphological OPENING of a closed region by a disk of
// `radius` (the tool) — the FOOTPRINT a round tool of this radius actually clears. ERODE by (radius + offset), then
// DILATE by radius with ROUND joins. Result: straight walls reach the boundary (less an optional `offset` margin),
// CONVEX corners are left ROUNDED by the tool radius (a small bit reaches into corners; a big bit rounds them off).
// radius/offset too big for the feature → the erosion collapses → [] (clean empty, no garbage). SP1h4 — POCKET look.
export function openPolygon(points, radius, offset = 0) {
  const r = Number(radius) || 0;
  const off = Number(offset) || 0;
  if (r <= 0) return offsetPolygon(points, -off); // no tool → just the (optionally) inset region
  const eroded = offsetPolygon(points, -(r + off));
  if (eroded.length < 3) return [];
  return offsetPolygon(eroded, r, { join: 'round' });
}
