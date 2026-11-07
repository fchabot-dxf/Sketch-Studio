// packages/core/vcarve.js — the PURE offset-stack core for V-carving (VCARVE-2, VCARVE-4). No DOM.
//
// vcarveContours(boundary, { dStep, halfAngleTan, maxIters? }) → [{ polygon, depth }]: STACK a closed region's inward
// offset contours at increasing inset d (d = dStep, 2·dStep, …). At inset d a V-bit cuts to depth d/halfAngleTan so the
// groove HALF-WIDTH = d just reaches the boundary. `offsetPolygon(boundary, −d)` returns [] precisely when the inset
// OVER-COLLAPSES (its self-intersection / over-inset guard) — that point is the local MEDIAL AXIS, so the loop
// terminates there (FINITE; the engine implicitly traces the axis without computing it).
//
// NOTE on engine limitation (Risk 6): offsetPolygon returns [] on ANY thin-neck / self-intersection
// (polygon-offset.js:127), so the WHOLE stack terminates at the first pinch point across the region.
//
// PURITY (the S-4a/S-4e split): the HOST computes `boundary` (the loop polygon — `loopPolygon`, which needs the DOM for
// arcs) and passes it in; this module NEVER touches the DOM.
//
// VCARVE-4: deriveVcarveContours is the SINGLE canonical derivation shared between UI preview and machine SVG export.

import { offsetPolygon } from './polygon-offset.js';

export function vbitHalfAngleTan(angle) {
  const halfAngle = (Number(angle) || 90) / 2;
  if (halfAngle === 45) return 1.0; // Math.tan(π/4) = 0.9999999999999999 → floor() would drop the last contour
  return Math.tan((halfAngle * Math.PI) / 180);
}

export function vcarveContours(boundary, { dStep, halfAngleTan, maxIters = 1000 } = {}) {
  const out = [];
  if (!Array.isArray(boundary) || boundary.length < 3) return out;
  const step = Number(dStep);
  const tan = Number(halfAngleTan);
  if (!(step > 0) || !(tan > 0)) return out;
  for (let i = 1; i <= maxIters; i++) {
    const d = step * i;
    const contour = offsetPolygon(boundary, -d);
    if (!Array.isArray(contour) || contour.length < 3) break; // over-collapse → the local medial axis → STOP
    out.push({ polygon: contour, depth: d / tan });
  }
  return out;
}

export function deriveVcarveContours(boundary, record, { maxContours = 200 } = {}) {
  if (!Array.isArray(boundary) || boundary.length < 3 || !record) return [];
  const angle = record.vbit?.angle ?? 90;
  const tan = vbitHalfAngleTan(angle);
  const dStep = Number(record.dStep) > 0 ? Number(record.dStep) : 0.5;
  const maxDepth = Number(record.maxDepth) > 0 ? Number(record.maxDepth) : 6;
  const maxIters = Math.max(1, Math.min(maxContours, Math.floor((maxDepth * tan) / dStep + 1e-6)));
  return vcarveContours(boundary, { dStep, halfAngleTan: tan, maxIters });
}
