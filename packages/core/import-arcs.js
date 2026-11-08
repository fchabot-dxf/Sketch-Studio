// packages/core/import-arcs.js — the ONE place an IMPORTED circular arc becomes a #core arc shape (TASK 478). Used by the DXF importer
// (ARC entities, polyline bulges) and by the SVG importer (a circular path `A` command), so both produce exactly what the arc
// tool stores. PURE (no DOM).
//
// The #core arc: { type:'arc', subType:'CENTER', joints:[centre, start, end], largeArc, sweep } in the Y-DOWN world, with the SVG
// meaning of the two flags (sweep true = the positive-angle direction = clockwise on screen); see geometry.calculateArcPath.
// The centre is a joint of its own; the START and END joints are the endpoints the arc SHARES with its neighbouring segments, so a
// profile stays a connected, closed loop.

/** The arc shape. `joints` = [centreId, startId, endId]; flags are booleans in world (Y-down) terms. */
export function arcShape(id, centreId, startId, endId, { largeArc, sweep }) {
  return { id, type: 'arc', subType: 'CENTER', joints: [centreId, startId, endId], largeArc: !!largeArc, sweep: !!sweep };
}

/**
 * The centre of the circular arc an SVG `A rx rx rot fA fS x2 y2` draws from (x1, y1) — SVG implementation notes F.6.5 with
 * rx = ry (the rotation field means nothing for a circle). A radius too small to span the endpoints grows to the half chord
 * (F.6.6). Returns { cx, cy, r } in the path's own user space, or null when the arc is degenerate (same endpoints / no radius).
 */
export function svgCircularArcCentre(x1, y1, r, largeArc, sweep, x2, y2) {
  r = Math.abs(r);
  if (!(r > 0) || (x1 === x2 && y1 === y2)) return null;
  const hx = (x1 - x2) / 2, hy = (y1 - y2) / 2, half = Math.hypot(hx, hy);
  if (half > r) r = half;                                   // F.6.6: grow a radius that cannot span the endpoints
  const d2 = r * r - half * half;
  const k = Math.sqrt(Math.max(0, d2) / (half * half));      // distance from the chord midpoint to the centre, over the half chord
  const sign = (!!largeArc === !!sweep) ? -1 : 1;            // F.6.5: the flags pick which of the two centres
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  // the centre lies on the chord's perpendicular bisector: (x1p, y1p) rotated, sign per the flags
  return { cx: mx + sign * k * hy, cy: my - sign * k * hx, r };
}

/** Is the 2x3 matrix [a,b,c,d,e,f] a SIMILARITY (uniform scale + rotation, optionally flipped; no skew, no non-uniform scale)? */
export function isSimilarity(m, tol = 1e-9) {
  const [a, b, c, d] = m;
  const s1 = Math.hypot(a, b), s2 = Math.hypot(c, d);
  if (!(s1 > 0) || !(s2 > 0)) return false;
  return Math.abs(s1 - s2) <= tol * Math.max(s1, s2) && Math.abs(a * c + b * d) <= tol * s1 * s2;
}
