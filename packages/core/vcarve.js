// packages/core/vcarve.js — the PURE offset-stack core for V-carving (VCARVE-2, VCARVE-4, VCARVE-5a). No DOM.
//
// vcarveContours(boundary, { dStep, halfAngleTan, maxIters? }) → [{ polygon, depth }]: STACK a closed region's inward
// offset contours at increasing inset d (d = dStep, 2·dStep, …). At inset d a V-bit cuts to depth d/halfAngleTan so the
// groove HALF-WIDTH = d just reaches the boundary.
//
// VCARVE-5a: powered by Angus Johnson's Clipper (#core/plot/clip.js). Unlike polygon-offset (which returned [] on thin
// necks/splits), Clipper splits pinched regions into independent closed rings, allowing each island (letters B, 8, S,
// dumbbells) to continue insetting until its own local medial axis ridge collapses.
//
// PURITY (the S-4a/S-4e split): the HOST computes `boundary` (the loop polygon — `loopPolygon`, which needs the DOM for
// arcs) and passes it in; this module NEVER touches the DOM.
//
// VCARVE-4: deriveVcarveContours is the SINGLE canonical derivation shared between UI preview and machine SVG export.

import { ClipperLib, CLIP_SCALE } from './plot/clip.js';
import { sweptPath } from './polygon-offset.js';

export function vbitHalfAngleTan(angle) {
  const halfAngle = (Number(angle) || 90) / 2;
  return Math.tan((halfAngle * Math.PI) / 180);
}

function toClipperPath(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return null;
  const p = poly.map((pt) => ({
    X: Math.round((pt.x ?? pt[0]) * CLIP_SCALE),
    Y: Math.round((pt.y ?? pt[1]) * CLIP_SCALE),
  }));
  if (p.length > 1) {
    const a = p[0], b = p[p.length - 1];
    if (a.X === b.X && a.Y === b.Y) p.pop();
  }
  return p.length >= 3 ? p : null;
}

export function vcarveContours(boundary, { dStep, halfAngleTan, maxIters = 1000, holes = [] } = {}) {
  const out = [];
  const step = Number(dStep);
  const tan = Number(halfAngleTan);
  if (!(step > 0) || !(tan > 0)) return out;

  const outerPath = toClipperPath(boundary);
  if (!outerPath) return out;
  if (!ClipperLib.Clipper.Orientation(outerPath)) outerPath.reverse();

  const co = new ClipperLib.ClipperOffset(2 /* miterLimit */, 0.25 * CLIP_SCALE /* arcTolerance */);
  co.AddPath(outerPath, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

  if (Array.isArray(holes)) {
    for (const h of holes) {
      const hp = toClipperPath(h);
      if (!hp) continue;
      // In ClipperOffset, holes MUST have negative orientation (Orientation === false) so -delta outsets the hole
      if (ClipperLib.Clipper.Orientation(hp)) hp.reverse();
      co.AddPath(hp, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    }
  }

  for (let i = 1; i <= maxIters; i++) {
    const d = step * i;
    const sol = new ClipperLib.Paths();
    co.Execute(sol, -d * CLIP_SCALE);
    if (!sol.length) break; // every island has reached its local medial axis ridge -> STOP
    for (let s = 0; s < sol.length; s++) {
      const ring = sol[s];
      if (ring.length < 3) continue;
      const pts = ring.map((pt) => ({ x: pt.X / CLIP_SCALE, y: pt.Y / CLIP_SCALE }));
      out.push({ polygon: pts, depth: d / tan });
      if (out.length >= maxIters * 2) return out; // island explosion guard
    }
  }
  return out;
}

export function deriveVcarveContours(boundary, record, { maxContours = 200, holes = [] } = {}) {
  if (!Array.isArray(boundary) || boundary.length < 3 || !record) return [];
  const angle = record.vbit?.angle ?? 90;
  const tan = vbitHalfAngleTan(angle);
  const dStep = Number(record.dStep) > 0 ? Number(record.dStep) : 0.5;
  const maxDepth = Number(record.maxDepth) > 0 ? Number(record.maxDepth) : 6;
  const maxIters = Math.max(1, Math.min(maxContours, Math.floor((maxDepth * tan) / dStep + 1e-6)));
  return vcarveContours(boundary, { dStep, halfAngleTan: tan, maxIters, holes });
}

// TASK 447: the REAL footprint of each contour ring — a V-bit cutting at depth z has surface half-width z * tan(halfAngle),
// which for the contour at inset d (z = d/tan) is exactly d. One swept band (capsules, nonzero) per ring, in contour order.
export function deriveVcarveFootprint(contours, record) {
  const tan = vbitHalfAngleTan(record && record.vbit ? record.vbit.angle : 90);
  return (contours || []).map((c) => {
    const halfWidth = c.depth * tan;
    return { depth: c.depth, halfWidth, fillRule: 'nonzero', rings: sweptPath(c.polygon, halfWidth, { closed: true }) };
  });
}
