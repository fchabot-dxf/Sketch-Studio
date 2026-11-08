// packages/core/cutter-profile.js — TASK 464: the cross-section of a ROUND-bit cut for each declared cutter shape, as TERRACES.
// PURE. The shape is the cut record's declared `cutterShape` ('endmill' | 'ballnose' | 'vbit') + `cutterAngle` (V-bit included
// angle, the VBIT_PRESETS value; vbitHalfAngleTan stays the ONE V-bit helper). toolDia = the bit's widest diameter.
//
// A groove cut to `depth` (tip at `depth`) has depth D(x) at distance x from its centre line:
//   endmill   flat: D = depth for x <= r                                  (no terraces needed: the footprint IS the floor)
//   ballnose  the ball centre is r above the lowest point: D(x) = (depth - r) + sqrt(r^2 - x^2); at the surface (shallow cut,
//             depth < r) the groove is only sqrt(r^2 - (r-depth)^2) wide
//   vbit      D(x) = depth - x / tan(halfAngle), reaching the surface at x = depth * tan(halfAngle) (capped at the flute radius r)
// The relief model builds stair-steps: n terraces over half-widths e_j = xMax * j / n, each cut at D(mid of its step) (the
// innermost at the true depth), so each step is within half a step of the true profile.
import { vbitHalfAngleTan } from './vcarve.js';

// z-slices per groove (the triangle cost is ~ slices x the groove's ring count). 6 reads as a round bottom, 5 as a clean V.
export const SHAPE_SLICES = Object.freeze({ ballnose: 6, vbit: 5 });

/** Does this shape need terraces (is it anything but a flat endmill)? */
export const isShapedCutter = (shape) => shape === 'ballnose' || shape === 'vbit';

/** The depth profile D(x) and widest half-width xMax of a groove, or null for an endmill / a degenerate cut. */
export function cutterProfile(shape, toolDia, angle, depth) {
  const r = (Number(toolDia) || 0) / 2, d = Number(depth);
  if (!(r > 0) || !(d > 0)) return null;
  if (shape === 'ballnose') {
    const xMax = d < r ? Math.sqrt(r * r - (r - d) * (r - d)) : r;
    return { shape, r, xMax, depthAt: (x) => (d - r) + Math.sqrt(Math.max(0, r * r - x * x)) };
  }
  if (shape === 'vbit') {
    const t = vbitHalfAngleTan(Number(angle) || 90);
    return { shape, r, xMax: Math.min(r, d * t), depthAt: (x) => d - x / t };
  }
  return null;
}

/** The terraces of a shaped groove: [{ halfWidth, depth }] from the narrowest (deepest) to the widest (shallowest). */
export function cutterTerraces(shape, toolDia, angle, depth, n = SHAPE_SLICES[shape] || 1) {
  const p = cutterProfile(shape, toolDia, angle, depth);
  if (!p) return [];
  const out = [];
  for (let j = 1; j <= n; j++) {
    const e = (p.xMax * j) / n, mid = (p.xMax * (j - 0.5)) / n;
    out.push({ halfWidth: e, depth: j === 1 ? Number(depth) : Math.max(1e-6, p.depthAt(mid)) });
  }
  return out;
}
