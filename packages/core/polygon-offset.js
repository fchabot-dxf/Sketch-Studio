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

function signedArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return s / 2;
}

export function offsetPolygon(points, distance) {
  const n = points && points.length;
  if (!n || n < 3 || !Number.isFinite(distance)) return [];
  if (distance === 0) return points.map((p) => ({ x: p.x, y: p.y }));

  const area0 = signedArea(points);
  if (area0 === 0) return []; // degenerate (collinear)
  // Normalize so POSITIVE distance is OUTWARD irrespective of the input winding (loops here are CCW, but be robust).
  const d = area0 > 0 ? distance : -distance;

  // Per-edge offset segment (shift both endpoints along the OUTWARD normal). For a CCW polygon the interior is to the
  // LEFT, so perpendicularNormal (left normal) is INWARD → outward = its negation.
  const seg = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const { nx, ny, len } = perpendicularNormal(a, b);
    if (len === 0) { seg[i] = null; continue; } // degenerate edge — skip
    const ox = -nx * d, oy = -ny * d; // outward (CCW) × distance
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
  // Over-inset detection: a VALID offset preserves every edge's DIRECTION. If any offset edge reversed, the offset
  // crossed itself (offset-in > the local feature) → degenerate. (A bare winding-sign test misses this — the inverted
  // ghost polygon can keep the same winding.) Plus a collapsed-area guard for the exact-inradius case.
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], oa = out[i], ob = out[(i + 1) % n];
    if (!oa || !ob) continue;
    if ((b.x - a.x) * (ob.x - oa.x) + (b.y - a.y) * (ob.y - oa.y) < 0) return []; // edge reversed → inverted
  }
  if (Math.abs(signedArea(out)) < 1e-9) return []; // collapsed to a point/line
  return out;
}
