// packages/core/cutter-profile.js — TASK 464: the cross-section of a ROUND-bit cut for each declared cutter shape, as TERRACES.
// PURE. The shape is the cut record's declared `cutterShape` ('endmill' | 'ballnose' | 'vbit' | TASK 842: 'taperball' | 'taperflat') + `cutterAngle` (V-bit
// included angle, the VBIT_PRESETS value; vbitHalfAngleTan stays the ONE V-bit helper). toolDia = the bit's widest diameter (TASK 842: a TAPERED bit's toolDia
// is its TIP diameter, its cone is `taper` = { taperAngle (degrees per side), shankDia (mm) }).
//
// A groove cut to `depth` (tip at `depth`) has depth D(x) at distance x from its centre line:
//   endmill   flat: D = depth for x <= r                                  (no terraces needed: the footprint IS the floor)
//   ballnose  the ball centre is r above the lowest point: D(x) = (depth - r) + sqrt(r^2 - x^2); at the surface (shallow cut,
//             depth < r) the groove is only sqrt(r^2 - (r-depth)^2) wide
//   vbit      D(x) = depth - x / tan(halfAngle), reaching the surface at x = depth * tan(halfAngle) (capped at the flute radius r)
//   TASK 842, the TAPERED bits: D(x) = depth - cutterHeightAt(x), the cutter's own surface (its height above its tip at radius x):
//   taperflat a flat tip of radius rt, then a cone of half-angle a: h = 0 for x <= rt, h = (x - rt) / tan a beyond
//   taperball a ball tip of radius rt, the cone TANGENT to it: the tangent point is at x_t = rt cos a, h_t = rt (1 - sin a); h = rt - sqrt(rt^2 - x^2) for
//             x <= x_t, h = h_t + (x - x_t) / tan a beyond
//   TASK 852, the BOWL bit (a flat bottom with rounded corners): `bowl` = { cornerRadius c }, 0 < c <= r. h = 0 for x <= r - c (the flat floor, diameter - 2 c wide), then
//             the quarter circle of the corner: h = c - sqrt(c^2 - (x - (r - c))^2), reaching h = c at the edge x = r. c = r IS the ball nose.
//   both are CAPPED by the shank (radius rs): the cutter is no wider than rs (a cut deeper than the cone is a straight wall at rs, as a V-bit at r).
// The relief model builds stair-steps: n terraces over half-widths e_j = xMax * j / n, each cut at D(mid of its step) (the
// innermost at the true depth), so each step is within half a step of the true profile.

/** tan(half the V-bit's INCLUDED angle) (90 -> 1, 60 -> tan 30). The ONE V-bit helper (TASK 741: its home since V-carve was removed). */
export function vbitHalfAngleTan(angle) {
  const halfAngle = (Number(angle) || 90) / 2;
  return Math.tan((halfAngle * Math.PI) / 180);
}


/** TASK 842: is this shape a TAPERED bit (a cone from its tip, capped by its shank: `taper` = { taperAngle, shankDia })? */
export const isTaperedCutter = (shape) => shape === 'taperball' || shape === 'taperflat';
/** Does this shape need terraces (is it anything but a flat endmill)? */
export const isShapedCutter = (shape) => shape === 'ballnose' || shape === 'vbit' || shape === 'bowl' || isTaperedCutter(shape);

// the cone of a tapered bit: tip radius, half-angle tan, shank radius, the ball's tangent point (x_t, h_t); null when it is not a valid cone
function taperGeom(shape, toolDia, taper) {
  const rt = (Number(toolDia) || 0) / 2, a = Number(taper && taper.taperAngle), rs = (Number(taper && taper.shankDia) || 0) / 2;
  if (!(rt > 0) || !(a > 0 && a < 90) || !(rs > rt)) return null;
  const rad = (a * Math.PI) / 180, t = Math.tan(rad);
  const ball = shape === 'taperball';
  return { rt, t, rs, xt: ball ? rt * Math.cos(rad) : rt, ht: ball ? rt * (1 - Math.sin(rad)) : 0, ball };
}

// TASK 852: a bowl bit's corner radius (mm) when it is valid for the diameter (0 < c <= r, up to rounding), else null (never guessed or clamped)
function bowlCorner(toolDia, extra) {
  const r = (Number(toolDia) || 0) / 2, c = Number(extra && extra.cornerRadius);
  return r > 0 && c > 0 && c <= r * (1 + 1e-12) ? { r, c: Math.min(c, r) } : null;
}
// the bowl's height above its lowest point at radius x (0 <= x <= r)
const bowlHeight = (g, x) => (x <= g.r - g.c ? 0 : g.c - Math.sqrt(Math.max(0, g.c * g.c - (x - (g.r - g.c)) ** 2)));

/**
 * TASK 842: the HEIGHT of a tapered cutter's surface above its tip at radius x (mm), or null beyond its widest radius (the shank: a straight side) or for a
 * shape that is not tapered / an invalid cone. `toolDia` = the tip diameter; `taper` = { taperAngle (degrees per side), shankDia (mm) }. TASK 852: a BOWL bit
 * too (`toolDia` = its diameter, `taper` = { cornerRadius }).
 */
export function cutterHeightAt(shape, toolDia, x, taper) {
  if (shape === 'bowl') { // TASK 852: `taper` = the bit's extra fields ({ cornerRadius })
    const g = bowlCorner(toolDia, taper), ax = Math.abs(Number(x));
    return g && ax <= g.r ? bowlHeight(g, ax) : null;
  }
  if (!isTaperedCutter(shape)) return null;
  const g = taperGeom(shape, toolDia, taper), r = Math.abs(Number(x));
  if (!g || !(r <= g.rs)) return null;
  if (r <= g.xt) return g.ball ? g.rt - Math.sqrt(Math.max(0, g.rt * g.rt - r * r)) : 0;
  return g.ht + (r - g.xt) / g.t;
}

/** The depth profile D(x) and widest half-width xMax of a groove, or null for an endmill / a degenerate cut. TASK 842: `taper` = a tapered bit's cone. */
export function cutterProfile(shape, toolDia, angle, depth, taper = null) {
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
  if (shape === 'bowl') { // TASK 852: the flat floor, then the corner's quarter circle; as wide as the bit once the cut is deeper than the corner
    const g = bowlCorner(toolDia, taper);
    if (!g) return null;
    const xMax = d >= g.c ? g.r : (g.r - g.c) + Math.sqrt(g.c * g.c - (g.c - d) * (g.c - d));
    return { shape, r, xMax, depthAt: (x) => d - bowlHeight(g, Math.min(Math.abs(x), g.r)) };
  }
  if (isTaperedCutter(shape)) {
    const g = taperGeom(shape, toolDia, taper);
    if (!g) return null;
    // where the cutter's surface reaches the top of the cut (height = d): on the ball / the flat tip, or on the cone; never wider than the shank
    const reach = d <= g.ht ? Math.sqrt(Math.max(0, g.rt * g.rt - (g.rt - d) * (g.rt - d))) : g.xt + (d - g.ht) * g.t;
    return { shape, r, xMax: Math.min(g.rs, reach), depthAt: (x) => d - cutterHeightAt(shape, toolDia, Math.min(x, g.rs), taper) };
  }
  return null;
}

/**
 * TASK 852b (owner: the bowl's rounded corner "looks like stepped"): the terraces of a shaped groove are placed by a declared HEIGHT TOLERANCE, not a fixed
 * count: TERRACE_STEP_MM is the tallest a step may be (the stepped surface then stands within a step of the true profile), up to TERRACE_MAX terraces (a
 * deeper groove would need more than the 3D view can afford: there each step is H / TERRACE_MAX high, said in the WORK-LOG).
 */
export const TERRACE_STEP_MM = 0.05;
export const TERRACE_MAX = 64;
const TERRACE_MIN = 2;

/** How many terraces a groove gets: its drop from the centre to the widest edge (H) over TERRACE_STEP_MM, between TERRACE_MIN and TERRACE_MAX; 0 for none. */
export function terraceCount(shape, toolDia, angle, depth, taper = null) {
  const p = cutterProfile(shape, toolDia, angle, depth, taper);
  if (!p) return 0;
  const H = Number(depth) - p.depthAt(p.xMax);
  return Math.min(TERRACE_MAX, Math.max(TERRACE_MIN, Math.ceil(H / TERRACE_STEP_MM)));
}

/**
 * The terraces of a shaped groove: [{ halfWidth, depth }] from the narrowest (deepest) to the widest (shallowest). TASK 842: `taper` = a tapered bit's cone.
 * TASK 852b: the terraces are EQUAL STEPS IN HEIGHT: terrace j reaches out to where the profile has dropped j H / n (bisection on the one profile function, so the
 * steep rim of a ball or bowl gets as fine steps as its flat middle), cut to the depth at the middle of its band (the innermost at the true depth): the step is
 * H / n high. `count` defaults to terraceCount.
 */
export function cutterTerraces(shape, toolDia, angle, depth, taper = null, count = terraceCount(shape, toolDia, angle, depth, taper)) {
  const p = cutterProfile(shape, toolDia, angle, depth, taper), n = count;
  if (!p || !(n >= 1)) return [];
  const d = Number(depth), H = d - p.depthAt(p.xMax), out = [];
  for (let j = 1; j <= n; j++) {
    let e = p.xMax;
    if (j < n) { // the widest x where the profile has dropped at most j H / n (the drop never decreases with x)
      let lo = 0, hi = p.xMax;
      for (let it = 0; it < 48; it++) { const m = (lo + hi) / 2; if (d - p.depthAt(m) <= (H * j) / n) lo = m; else hi = m; }
      e = lo;
    }
    out.push({ halfWidth: e, depth: j === 1 ? d : Math.max(1e-6, d - (H * (j - 0.5)) / n) });
  }
  return out;
}
