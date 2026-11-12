// packages/core/geometry-bounds.js — axis-aligned bounding box over #core sketch geometry.
// Pure (#core, zero DOM): lines by endpoint joints, circles by center ± radius, arcs by analytical W3C SVG circular
// arc sweep extrema (start/end rim points + any cardinal angles crossed along the sweep, excluding the unrendered
// center joint), cubic beziers by analytical derivative extrema, and joint-only sketches by non-origin joints.

import { hiddenSketchIds, sketchOf } from './sketch-model.js';

const TAU = Math.PI * 2;
const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const normAngle = (a) => ((a % TAU) + TAU) % TAU;

function evalCubic1D(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicInteriorRoots1D(p0, p1, p2, p3) {
  // B'(t) / 3 = a*t^2 + 2*b*t + c = 0
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = p0 - 2 * p1 + p2;
  const c = -p0 + p1;
  const roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / (2 * b);
      if (t > 0 && t < 1) roots.push(t);
    }
    return roots;
  }
  const disc = b * b - a * c;
  if (disc < 0) return roots;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / a;
  const t2 = (-b + s) / a;
  if (t1 > 0 && t1 < 1) roots.push(t1);
  if (t2 > 0 && t2 < 1 && Math.abs(t2 - t1) > 1e-12) roots.push(t2);
  return roots;
}

/**
 * Computes the axis-aligned bounding box `{ minX, minY, maxX, maxY, w, h }` over a `#core` sketch state's
 * geometry, or returns `null` when the sketch contains no geometry.
 */
export function computeGeometryBounds(state) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasGeometry = false;
  const ext = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    hasGeometry = true;
  };

  const J = state && state.joints;
  const hidden = hiddenSketchIds(state); // geometry of a hidden sketch is not on the canvas, so it is not in the box
  const shapes = ((state && state.shapes) || []).filter((s) => !(s && hidden.has(sketchOf(s))));

  if (state && Array.isArray(state.shapes) && state.shapes.length > 0 && J) {
    for (const s of shapes) {
      if (!s) continue;
      if (s.type === 'line' && Array.isArray(s.joints)) {
        const a = J.get(s.joints[0]), b = J.get(s.joints[1]);
        if (a) ext(a.x, a.y);
        if (b) ext(b.x, b.y);
      } else if (s.type === 'circle' && Array.isArray(s.joints)) {
        const c = J.get(s.joints[0]);
        const r = Number(s.radius) || 0;
        if (c && r > 0) {
          ext(c.x - r, c.y - r);
          ext(c.x + r, c.y + r);
        } else if (c) {
          ext(c.x, c.y);
        }
      } else if (s.type === 'arc' && Array.isArray(s.joints)) {
        const [p1, p2, p3] = s.joints.map((id) => J.get(id));
        if (p1 && p2 && p3) {
          ext(p2.x, p2.y);
          ext(p3.x, p3.y);
          const r0 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const dx2 = (p2.x - p3.x) / 2;
          const dy2 = (p2.y - p3.y) / 2;
          const d2 = dx2 * dx2 + dy2 * dy2;
          if (r0 > 0 && d2 > 1e-18) {
            let la, sw;
            if (typeof s.largeArc === 'boolean' && typeof s.sweep === 'boolean') {
              la = s.largeArc;
              sw = s.sweep;
            } else {
              let diff = Math.atan2(p3.y - p1.y, p3.x - p1.x) - Math.atan2(p2.y - p1.y, p2.x - p1.x);
              while (diff <= -Math.PI) diff += TAU;
              while (diff > Math.PI) diff -= TAU;
              la = false;
              sw = diff > 0;
            }
            // W3C SVG F.6.5/F.6.6 endpoint-to-center conversion for M p2 A r0 r0 0 la sw p3
            const r = Math.max(r0, Math.sqrt(d2));
            const k = Math.sqrt(Math.max(0, (r * r - d2) / d2)) * (la === sw ? -1 : 1);
            const cx = (p2.x + p3.x) / 2 + k * dy2;
            const cy = (p2.y + p3.y) / 2 - k * dx2;
            const a1 = Math.atan2(p2.y - cy, p2.x - cx);
            const a2 = Math.atan2(p3.y - cy, p3.x - cx);
            const span = sw ? normAngle(a2 - a1) : normAngle(a1 - a2);
            for (const cAng of CARDINAL_ANGLES) {
              const d = sw ? normAngle(cAng - a1) : normAngle(a1 - cAng);
              if (d > 0 && d < span) {
                ext(cx + r * Math.cos(cAng), cy + r * Math.sin(cAng));
              }
            }
          }
        }
      } else if (s.type === 'bezier' && Array.isArray(s.joints) && s.c1 && s.c2) {
        const p0 = J.get(s.joints[0]), p3 = J.get(s.joints[1]);
        if (p0 && p3) {
          ext(p0.x, p0.y);
          ext(p3.x, p3.y);
          for (const t of cubicInteriorRoots1D(p0.x, s.c1[0], s.c2[0], p3.x)) {
            ext(evalCubic1D(p0.x, s.c1[0], s.c2[0], p3.x, t), evalCubic1D(p0.y, s.c1[1], s.c2[1], p3.y, t));
          }
          for (const t of cubicInteriorRoots1D(p0.y, s.c1[1], s.c2[1], p3.y)) {
            ext(evalCubic1D(p0.x, s.c1[0], s.c2[0], p3.x, t), evalCubic1D(p0.y, s.c1[1], s.c2[1], p3.y, t));
          }
        }
      } else if (Array.isArray(s.joints)) {
        for (const jid of s.joints) {
          const p = J.get(jid);
          if (p) ext(p.x, p.y);
        }
      }
    }
  } else if (J && typeof J.entries === 'function') {
    for (const [id, j] of J.entries()) {
      if (j && id !== 'j_origin' && !hidden.has(sketchOf(j)) && Number.isFinite(j.x) && Number.isFinite(j.y)) {
        ext(j.x, j.y);
      }
    }
  }

  if (!hasGeometry) return null;
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
