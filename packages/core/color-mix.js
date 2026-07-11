// packages/core/color-mix.js — COLOR-MIX-1 (#11): pure color-MIX math. Approximate a digital color the physical pen
// palette can't hit by COMBINING pens (cross-hatch / stipple two pens -> a visual blend). This is the MATH ONLY;
// the fill-layering plot + the UI wiring are COLOR-MIX-2/3. Pure #core, no DOM, deterministic. Complements
// color-match.js (which picks the nearest SINGLE pen) — here we find the best WEIGHTED blend.
//
// MODEL (MVP — FLAGGED for the COLOR-MIX-2 review): LINEAR-RGB ADDITIVE blend + BEST PAIR. The visual result of
// interleaving two pens is approximated as the weighted average of their RGB (blend = sum w_i * rgb_i). We search
// every pen PAIR, project the target onto the RGB segment between them (clamped, closed-form least-squares over 2
// pens), and keep the minimum-residual pair. Deliberately simple:
//   - Real ink is SUBTRACTIVE (CMY-ish), not additive — additive RGB is the MVP approximation.
//   - Only 2 pens: a 3-pen (triangle / barycentric) blend can reach targets no single edge hits; deferred.
// Linear-RGB + best-pair reconstructs the canonical cases EXACTLY (orange = red+yellow ~.5/.5; grey = black+white)
// and is a clean, defensible MVP. Both extensions are noted in WORK-LOG for review.

import { parseHex, colorDistanceSq } from '#core/color-match.js';
import { generate as hatchGenerate } from '#core/plot/fills/hatch.js';

const DEFAULT_TOLERANCE = 16; // Euclidean RGB distance; within this of a single pen -> no mix needed.
const ZERO_WEIGHT = 1e-3;     // a blend weight at/below this collapses to the other pen (a single pen).
const ANGLE_STEP_DEG = 60;    // COLOR-MIX-2: distinct hatch angle per pen (0/60/120) so strokes INTERLEAVE, not overlap.

// Normalize a color input (hex string | [r,g,b] | {r,g,b}) -> { r, g, b } (0..255), or null.
function toRgb(c) {
  if (c == null) return null;
  if (typeof c === 'string') return parseHex(c);
  if (Array.isArray(c)) return c.length >= 3 ? { r: +c[0], g: +c[1], b: +c[2] } : null;
  if (typeof c === 'object' && 'r' in c && 'g' in c && 'b' in c) return { r: +c.r, g: +c.g, b: +c.b };
  return null;
}
// A palette pen carries an id (id | penId) and a color (hex | color) — lenient so a plotColors-like array fits.
const penIdOf = (p) => (p && (p.id != null ? p.id : (p.penId != null ? p.penId : null)));
const penRgbOf = (p) => toRgb(p && (p.hex != null ? p.hex : p.color));

/**
 * mixForColor(target, palette, opts?) -> [{ penId, weight }]
 *   Weights are in [0,1] and sum to 1; blend = sum(weight_i * penRGB_i) approximates `target`. A single pen within
 *   tolerance -> [{ that, 1 }] (no mix). Empty/unusable palette or unparseable target -> [].
 *   opts.tolerance: Euclidean RGB distance for the single-pen shortcut (default 16).
 */
export function mixForColor(target, palette, opts = {}) {
  const T = toRgb(target);
  if (!T || !Array.isArray(palette) || !palette.length) return [];
  const tol = typeof opts.tolerance === 'number' ? opts.tolerance : DEFAULT_TOLERANCE;

  // Parse the palette once; keep only pens with a valid id AND color.
  const pens = [];
  for (const p of palette) {
    const id = penIdOf(p), rgb = penRgbOf(p);
    if (id != null && rgb) pens.push({ id, rgb });
  }
  if (!pens.length) return [];

  // 1) SINGLE pen within tolerance -> no mix.
  let bestSingle = -1, bestSingleD = Infinity;
  for (let i = 0; i < pens.length; i++) {
    const d = colorDistanceSq(pens[i].rgb, T);
    if (d < bestSingleD) { bestSingleD = d; bestSingle = i; }
  }
  if (bestSingle >= 0 && bestSingleD <= tol * tol) return [{ penId: pens[bestSingle].id, weight: 1 }];
  if (pens.length === 1) return [{ penId: pens[0].id, weight: 1 }];

  // 2) BEST PAIR: project T onto each RGB segment [Pi, Pj]; keep the minimum-residual pair (deterministic: iterate
  //    in index order, strict `<` so the first pair wins ties). blend(a) = a*Pi + (1-a)*Pj = Pj + a*(Pi - Pj).
  let best = null, bestRes = Infinity;
  for (let i = 0; i < pens.length; i++) {
    for (let j = i + 1; j < pens.length; j++) {
      const Pi = pens[i].rgb, Pj = pens[j].rgb;
      const dx = Pi.r - Pj.r, dy = Pi.g - Pj.g, dz = Pi.b - Pj.b; // D = Pi - Pj
      const dd = dx * dx + dy * dy + dz * dz;
      let a; // weight of Pi
      if (dd === 0) a = 0.5;                                       // identical colors: arbitrary even split
      else {
        a = ((T.r - Pj.r) * dx + (T.g - Pj.g) * dy + (T.b - Pj.b) * dz) / dd;
        a = Math.max(0, Math.min(1, a));                           // clamp onto the segment
      }
      const br = Pj.r + a * dx, bg = Pj.g + a * dy, bb = Pj.b + a * dz;
      const res = (br - T.r) * (br - T.r) + (bg - T.g) * (bg - T.g) + (bb - T.b) * (bb - T.b);
      if (res < bestRes) { bestRes = res; best = { i, j, a }; }
    }
  }
  if (!best) return [{ penId: pens[bestSingle].id, weight: 1 }];

  const wi = best.a, wj = 1 - best.a;
  if (wi <= ZERO_WEIGHT) return [{ penId: pens[best.j].id, weight: 1 }]; // projection at an endpoint -> single pen
  if (wj <= ZERO_WEIGHT) return [{ penId: pens[best.i].id, weight: 1 }];
  return [{ penId: pens[best.i].id, weight: wi }, { penId: pens[best.j].id, weight: wj }];
}

/**
 * mixFillStrokes(region, mix, penWidth) -> [{ penId, strokes, spacing, angle }]
 *   COLOR-MIX-2: render a color MIX (from mixForColor) as per-pen cross-hatch that INTERLEAVES optically. For each pen
 *   in `mix` ([{penId, weight}]): a HATCH fill of `region` whose DENSITY is proportional to the pen's weight — coverage
 *   = weight, so spacing = penWidth / weight (weight 1 -> spacing = penWidth = full coverage; weight 0.5 -> 2*penWidth =
 *   half coverage) — at a DISTINCT ANGLE per pen (0/60/120 deg) so the pens' strokes lie beside each other (the eye
 *   averages them) instead of painting over. REUSES #core/plot/fills hatch (no fork). Pure, no DOM.
 *   `penId` + `strokes` are the contract; `spacing`/`angle` are the params used (recorded for COLOR-MIX-3 + the oracle).
 *   Zero/negative-weight pens contribute nothing; empty mix / missing region -> [].
 */
export function mixFillStrokes(region, mix, penWidth) {
  if (!region || !Array.isArray(mix) || !mix.length) return [];
  const w = (typeof penWidth === 'number' && penWidth > 0) ? penWidth : 1;
  const out = [];
  mix.forEach((m, i) => {
    if (!m || m.penId == null) return;
    const weight = (typeof m.weight === 'number') ? Math.min(1, m.weight) : 0;
    if (weight <= 0) return;
    const spacing = w / weight;              // coverage = weight => density proportional to weight
    const angle = (i * ANGLE_STEP_DEG) % 180; // distinct per pen (supports the 2-3 pen model)
    const strokes = hatchGenerate(region, { angle, spacing });
    out.push({ penId: m.penId, strokes, spacing, angle });
  });
  return out;
}
