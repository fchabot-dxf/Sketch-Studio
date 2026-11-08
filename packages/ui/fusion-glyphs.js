// packages/ui/fusion-glyphs.js — the ONE 'fusion' constraint-glyph set (GLYPH_STYLE = 'fusion').
// Geometry is the path data of assets/parametricmodelling_constraints.svg (sprite viewBox 0 0 53 95), inlined here so
// nothing is fetched at runtime. Each glyph is drawn WHITE with a thick dark outline (a halo painted behind the fill),
// no coloured badge disc. `midpoint` is not in the sprite: it is drawn here in the same style (thin line, end ticks, tick
// triangle). The sprite's black/red split is dropped: every element is one white shape.
//
// A glyph = { cx, cy, size, els } in SPRITE units: (cx, cy) is its centre, `size` its extent. els: { d } = a filled
// path, { c: [cx, cy, r] } = a 1-unit stroked circle.

const rect = (x, y, w, h) => `M${x},${y}h${w}v${h}h${-w}Z`;

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
  // Not in the sprite (drawn to match): a line with end ticks and a triangle marking its middle.
  'icon-midpoint': {
    cx: 0, cy: 0, size: 14,
    els: [
      { d: rect(-6, -0.4, 12, 0.8) },
      { d: rect(-6, -2.4, 0.8, 4.8) },
      { d: rect(5.2, -2.4, 0.8, 4.8) },
      { d: 'M0,-5.2L3.2,-0.6L-3.2,-0.6Z' },
    ],
  },
};

// SVG markup (centred on 0,0) for one glyph `iconPx` world units wide. `unitsPerPx` converts the outline weights, given
// in screen px, to glyph units. `outline` is a CSS colour (the halo behind the white fill).
export function fusionGlyphMarkup(iconId, iconPx, screenPx, outline) {
  const g = FUSION_GLYPHS[iconId];
  if (!g) return '';
  const k = iconPx / g.size;
  const unitsPerPx = g.size / screenPx;
  const halo = +(2.6 * unitsPerPx).toFixed(3);
  const core = +(0.9 * unitsPerPx).toFixed(3);
  const shape = (e, paint) => e.c
    ? `<circle cx="${e.c[0]}" cy="${e.c[1]}" r="${e.c[2]}" fill="none" style="stroke:${paint.stroke}" stroke-width="${paint.w(1)}"/>`
    : `<path d="${e.d}" style="fill:${paint.fill}; stroke:${paint.stroke}" stroke-width="${paint.w(0)}" stroke-linejoin="round"/>`;
  const behind = g.els.map((e) => shape(e, { fill: outline, stroke: outline, w: (base) => +(base + halo).toFixed(3) })).join('');
  const front = g.els.map((e) => shape(e, { fill: 'white', stroke: 'white', w: (base) => +Math.max(base, core).toFixed(3) })).join('');
  return `<g class="fusion-glyph" transform="scale(${+k.toFixed(4)}) translate(${-g.cx},${-g.cy})">${behind}${front}</g>`;
}
