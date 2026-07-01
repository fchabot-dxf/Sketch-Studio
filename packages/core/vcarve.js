// packages/core/vcarve.js — the PURE offset-stack core for V-carving (VCARVE-2). No DOM.
//
// vcarveContours(boundary, { dStep, halfAngleTan, maxIters? }) → [{ polygon, depth }]: STACK a closed region's inward
// offset contours at increasing inset d (d = dStep, 2·dStep, …). At inset d a V-bit cuts to depth d/halfAngleTan so the
// groove HALF-WIDTH = d just reaches the boundary. `offsetPolygon(boundary, −d)` returns [] precisely when the inset
// OVER-COLLAPSES (its self-intersection / over-inset guard) — that point is the local MEDIAL AXIS, so the loop
// terminates there (FINITE; the engine implicitly traces the axis without computing it).
//
// PURITY (the S-4a/S-4e split): the HOST computes `boundary` (the loop polygon — `loopPolygon`, which needs the DOM for
// arcs) and passes it in; this module NEVER touches the DOM. Additive — NO consumer yet (the Prepare cut-mode is
// VCARVE-3, the gated export is VCARVE-4) → both apps byte-identical. Reuses #core/polygon-offset.

import { offsetPolygon } from './polygon-offset.js';

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
