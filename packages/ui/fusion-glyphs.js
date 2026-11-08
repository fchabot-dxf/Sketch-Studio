// packages/ui/fusion-glyphs.js — the ONE 'fusion' constraint-glyph set (GLYPH_STYLE = 'fusion').
// Geometry is the path data of assets/parametricmodelling_constraints.svg (sprite viewBox 0 0 53 95), inlined here so
// nothing is fetched at runtime. Each glyph is drawn WHITE with a thick dark outline (a halo painted behind the fill),
// no coloured badge disc. `midpoint` is not in the sprite: it is drawn here in the same style (thin line, end ticks, tick
// triangle). The sprite's black/red split is dropped: every element is one white shape.
//
// A glyph = { cx, cy, size, els } in SPRITE units: (cx, cy) is its centre, `size` its extent. els: { d } = a filled
// path, { c: [cx, cy, r] } = a 1-unit stroked circle.

const rect = (x, y, w, h) => `M${x},${y}h${w}v${h}h${-w}Z`;
const n3 = (v) => +v.toFixed(3);
// A straight bar of width w between two points, and a ring segment (centre, radius, angles in degrees, width w).
const bar = (x1, y1, x2, y2, w) => {
  const len = Math.hypot(x2 - x1, y2 - y1), nx = (-(y2 - y1) / len) * w / 2, ny = ((x2 - x1) / len) * w / 2;
  return `M${n3(x1 + nx)},${n3(y1 + ny)}L${n3(x2 + nx)},${n3(y2 + ny)}L${n3(x2 - nx)},${n3(y2 - ny)}L${n3(x1 - nx)},${n3(y1 - ny)}Z`;
};
const arc = (cx, cy, r, a0, a1, w) => {
  const P = (rr, a) => `${n3(cx + rr * Math.cos(a * Math.PI / 180))},${n3(cy + rr * Math.sin(a * Math.PI / 180))}`;
  const ro = r + w / 2, ri = r - w / 2, sweep = a1 > a0 ? 1 : 0;
  return `M${P(ro, a0)}A${ro},${ro} 0 0 ${sweep} ${P(ro, a1)}L${P(ri, a1)}A${ri},${ri} 0 0 ${1 - sweep} ${P(ri, a0)}Z`;
};

export const FUSION_GLYPHS = {
  'icon-parallel': {
    cx: 37.6, cy: 12.4, size: 14,
    els: [
      { d: 'M41.112,6.359l-9.427,9.427l-0.568,-0.568l9.427,-9.427l0.568,0.568Z' },
      { d: 'M43.524,8.901l-9.493,9.493l-0.568,-0.568l9.493,-9.493l0.568,0.568Z' },
    ],
  },
  'icon-perpendicular': {
    cx: 36.9, cy: 34.9, size: 14,
    els: [
      { d: 'M43.299,28.944l-8.564,8.564l-0.568,-0.568l8.564,-8.564l0.568,0.568Z' },
      { d: 'M36.933,40.842l-6.101,-6.101l0.568,-0.568l6.101,6.101l-0.568,0.568Z' },
    ],
  },
  'icon-concentric': {
    cx: 13.9, cy: 57.4, size: 14,
    els: [{ c: [13.854, 57.385, 6.277] }, { c: [13.962, 57.458, 3.611] }],
  },
  'icon-collinear': {
    cx: 14.1, cy: 36.3, size: 16,
    els: [
      { d: 'M12.243,31.036l-4.912,4.912l-0.568,-0.568l4.912,-4.912l0.568,0.568Z' },
      { d: 'M12.507,37.642l-3.866,-3.866l0.568,-0.568l3.866,3.866l-0.568,0.568Z' },
      { d: rect(12.1, 34.918, 0.804, 2.724) },
      { d: 'M10.351,36.596l2.724,0l0,0.804l-2.724,0l0,-0.804Z' },
      { d: 'M15.657,36.377l-5.743,5.743l-0.568,-0.568l5.743,-5.743l0.568,0.568Z' },
      { d: 'M21.04,30.909l-4.243,4.243l-0.568,-0.568l4.243,-4.243l0.568,0.568Z' },
    ],
  },
  'icon-coincident': {
    cx: 14.2, cy: 12.7, size: 14,
    els: [
      { d: rect(9.533, 8.402, 0.87, 7.808) },
      { d: rect(8.663, 14.361, 2.581, 0.884) },
      { d: rect(10.403, 17.921, 9.372, 0.85) },
      { d: rect(8.663, 17.921, 1.74, 1.653) },
      { d: rect(8.663, 5.791, 1.74, 1.74) },
    ],
  },
  'icon-tangent': {
    cx: 37.3, cy: 78.7, size: 14,
    els: [
      { c: [35.448, 80.744, 3.988] },
      { d: 'M42.97,81.874l-8.564,-8.564l0.657,-0.657l8.564,8.564l-0.657,0.657Z' },
    ],
  },
  'icon-hv': {
    cx: 36.9, cy: 57.3, size: 15,
    els: [
      { d: rect(37.277, 50.822, 0.804, 7.513) },
      { d: 'M40.669,60.083l-7.651,0l0,-0.804l7.651,0l0,0.804Z' },
      { d: 'M35.784,53.177l-2.071,-2.071l0.568,-0.568l2.071,2.071l-0.568,0.568Z' },
      { d: 'M35.483,61.535l-2.071,2.071l-0.568,-0.568l2.071,-2.071l0.568,0.568Z' },
      { d: 'M35.447,55.532l-2.071,-2.071l0.568,-0.568l2.071,2.071l-0.568,0.568Z' },
      { d: 'M37.838,61.871l-2.071,2.071l-0.568,-0.568l2.071,-2.071l0.568,0.568Z' },
      { d: 'M35.503,58.223l-2.071,-2.071l0.568,-0.568l2.071,2.071l-0.568,0.568Z' },
      { d: 'M40.529,61.815l-2.071,2.071l-0.568,-0.568l2.071,-2.071l0.568,0.568Z' },
      { d: rect(35.548, 50.822, 0.804, 7.513) },
      { d: 'M40.641,61.77l-7.513,0l0,-0.804l7.513,0l0,0.804Z' },
    ],
  },
  'icon-equal': {
    cx: 14.6, cy: 80.8, size: 12,
    els: [
      { d: 'M19.719,79.497l-10.338,0l0,-0.804l10.338,0l0,0.804Z' },
      { d: 'M19.775,83.029l-10.338,0l0,-0.804l10.338,0l0,0.804Z' },
    ],
  },
  // The toolbar/cursor midpoint triangle: path "M6.5,2 L11.5,11 L1.5,11 Z" (viewBox 0 0 13 13) copied from
  // 'icon-midpoint' in packages/ui/cursor-manager.js (the symbol the ribbon 'Mid' button uses).
  'icon-midpoint': {
    cx: 6.5, cy: 6.5, size: 13,
    els: [
      { d: 'M6.5,2L11.5,11L1.5,11Z' },
    ],
  },
  // Not in the sprite (drawn to match, same stroke weight 0.8): a point sitting on a line.
  'icon-point-on-line': {
    cx: 0, cy: 0, size: 14,
    els: [
      { d: bar(-6.5, 2.6, 6.5, 2.6, 0.8) },
      { d: 'M-2.2,-0.2a2.2,2.2 0 1,0 4.4,0a2.2,2.2 0 1,0 -4.4,0Z' },
    ],
  },
  // A lock: shackle over a body.
  'icon-fixed': {
    cx: 0, cy: 0, size: 14,
    els: [
      { d: 'M-2.8,-0.6V-3.4A2.8,2.8 0 0 1 2.8,-3.4V-0.6H1.8V-3.4A1.8,1.8 0 0 0 -1.8,-3.4V-0.6Z' },
      { d: rect(-4.4, -0.8, 8.8, 6.6) },
    ],
  },
  // Two rays from a corner and the arc between them.
  'icon-angle': {
    cx: 0, cy: 0, size: 14,
    els: [
      { d: bar(-6, 5, 6, 5, 0.8) },
      { d: bar(-6, 5, 1.07, -3.43, 0.8) },
      { d: arc(-6, 5, 5.2, 0, -50, 0.8) },
    ],
  },
  // A mirror axis with a triangle on each side.
  'icon-symmetric': {
    cx: 0, cy: 0, size: 14,
    els: [
      { d: bar(0, -6.5, 0, 6.5, 0.8) },
      { d: 'M-1.3,-4.2L-6,0L-1.3,4.2Z' },
      { d: 'M1.3,-4.2L6,0L1.3,4.2Z' },
    ],
  },
};

// The constraint type -> glyph id for every constraint the renderer can mark with a glyph (distance is a dimension, not a
// glyph; `angle` is its glyph for an angle constraint; `fixed` marks a locked joint/shape).
export const CONSTRAINT_GLYPH = {
  coincident: 'icon-coincident', horizontal: 'icon-hv', vertical: 'icon-hv', parallel: 'icon-parallel',
  perpendicular: 'icon-perpendicular', collinear: 'icon-collinear', tangent: 'icon-tangent', equal: 'icon-equal',
  midpoint: 'icon-midpoint', pointOnLine: 'icon-point-on-line', angle: 'icon-angle', fixed: 'icon-fixed',
  symmetric: 'icon-symmetric',
};

// Outline weights, in screen px. HALO_PX = the dark outline painted behind the white shapes (its stroke width, centred on
// the shape edge); CORE_PX = a white stroke on the front shapes (0 = white fill only, so the gaps between small pieces such
// as the horizontal/vertical hatch ticks stay dark instead of filling in).
export const HALO_PX = 1.6;
export const CORE_PX = 0;

// SVG markup (centred on 0,0) for one glyph `iconPx` world units wide. `unitsPerPx` converts the outline weights, given
// in screen px, to glyph units. `outline` is a CSS colour (the halo behind the white fill).
export function fusionGlyphMarkup(iconId, iconPx, screenPx, outline) {
  const g = FUSION_GLYPHS[iconId];
  if (!g) return '';
  const k = iconPx / g.size;
  const unitsPerPx = g.size / screenPx;
  const halo = +(HALO_PX * unitsPerPx).toFixed(3);
  const core = +(CORE_PX * unitsPerPx).toFixed(3);
  const ring = (e, stroke, w) => `<circle cx="${e.c[0]}" cy="${e.c[1]}" r="${e.c[2]}" fill="none" style="stroke:${stroke}" stroke-width="${w}"/>`;
  const behind = g.els.map((e) => (e.c
    ? ring(e, outline, +(1 + halo).toFixed(3))
    : `<path d="${e.d}" style="fill:${outline}; stroke:${outline}" stroke-width="${halo}" stroke-linejoin="round"/>`)).join('');
  const front = g.els.map((e) => (e.c
    ? ring(e, 'white', 1)
    : (core > 0
      ? `<path d="${e.d}" style="fill:white; stroke:white" stroke-width="${core}" stroke-linejoin="round"/>`
      : `<path d="${e.d}" style="fill:white; stroke:none"/>`))).join('');
  return `<g class="fusion-glyph" transform="scale(${+k.toFixed(4)}) translate(${-g.cx},${-g.cy})">${behind}${front}</g>`;
}
