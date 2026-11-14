// packages/ui/fusion-glyphs.js — the constraint-glyph markup (the outlined glyph, the only style).
// The shapes are NOT here: they come from the owner's sheet (assets/constraint-glyphs.svg) through getGlyph() in
// #ui/glyph-sheet.js. This module owns only the constraint type -> glyph id table and the sizing/paint.

import { getGlyph, loadGlyphSheet } from '#ui/glyph-sheet.js';

// The constraint type -> sheet glyph id, declared ONCE. `fixed` and `angle` have no glyph (a locked constraint is green
// geometry, an angle is a dimension); `polygon` is for the coming Polygon constraint.
export const CONSTRAINT_GLYPH = {
  horizontal: 'glyph-horizontal', vertical: 'glyph-vertical', parallel: 'glyph-parallel',
  perpendicular: 'glyph-perpendicular', coincident: 'glyph-coincident', pointOnLine: 'glyph-coincident',
  collinear: 'glyph-collinear', tangent: 'glyph-tangent', equal: 'glyph-equal', midpoint: 'glyph-midpoint',
  concentric: 'glyph-concentric', polygon: 'glyph-polygon', symmetric: 'glyph-symmetric',
};

// Fetch the sheet once (idempotent); every host calls this at start. Reports a failed load / missing glyph once.
export const loadFusionGlyphs = () => loadGlyphSheet({ expected: [...new Set(Object.values(CONSTRAINT_GLYPH))] });

// SVG markup (centred on 0,0) for the glyph of constraint `type`, its LARGER bbox side = `iconPx` world units.
// `screenPx` is the glyph size setting in screen px, so `outlinePx` (screen px) converts to glyph units. Returns ''
// until the sheet has loaded or when the type has no glyph. `fill` / `stroke` are CSS colours.
export function fusionGlyphMarkup(type, iconPx, screenPx, outlinePx, fill, stroke) {
  const g = getGlyph(CONSTRAINT_GLYPH[type]);
  if (!g) return '';
  const side = Math.max(g.bbox.w, g.bbox.h);
  const k = iconPx / side;
  const w = +(outlinePx * side / screenPx).toFixed(4);
  const paths = g.paths.map((d) => `<path d="${d}"/>`).join('');
  return `<g class="fusion-glyph" transform="scale(${+k.toFixed(5)}) translate(${+(-g.centre.x).toFixed(3)},${+(-g.centre.y).toFixed(3)})" style="fill:${fill}; stroke:${stroke}" stroke-width="${w}" stroke-linejoin="round">${paths}</g>`;
}

// THE glyph pick (task 603): a glyph is picked only when the pointer is ON its DRAWN icon, never on a disc or a bbox around it. The icon is the
// sheet glyph's closed outlines (white fill, outline stroke), scaled like fusionGlyphMarkup (larger bbox side = `symbolPx`). The pointer picks it
// when it is inside an outline, or within (outline / 2 + margin) of one: a small margin for a mouse, a larger one for a finger. A diagonal
// icon (parallel) is therefore picked only along its strokes, not in the empty corners of its bbox. Icons are never drawn rotated.
// hover-manager glyphAt (hover, left click, right click, the dimension / drawing tools' pre-pick) and glyphHitMarkup (the cursor:pointer hit
// element in svg-renderer, the same shape) are the only callers.
export const GLYPH_PICK_MARGIN_PX = 2;
export const GLYPH_PICK_MARGIN_TOUCH_PX = 6;
const BEZIER_STEPS = 6;
const polyCache = new WeakMap(); // glyph -> [ [x0,y0,x1,y1,...] closed polylines, in sheet units ]
function glyphPolys(g) {
  let polys = polyCache.get(g);
  if (polys) return polys;
  polys = [];
  for (const d of g.paths) {
    const tok = d.match(/[MLCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    let cur = null, i = 0, x = 0, y = 0;
    while (i < tok.length) {
      const cmd = tok[i++];
      if (cmd === 'M') { x = +tok[i++]; y = +tok[i++]; cur = [x, y]; polys.push(cur); }
      else if (cmd === 'L') { x = +tok[i++]; y = +tok[i++]; cur.push(x, y); }
      else if (cmd === 'C') {
        const [x1, y1, x2, y2, x3, y3] = [+tok[i], +tok[i + 1], +tok[i + 2], +tok[i + 3], +tok[i + 4], +tok[i + 5]]; i += 6;
        for (let t = 1; t <= BEZIER_STEPS; t++) {
          const u = t / BEZIER_STEPS, v = 1 - u;
          cur.push(v * v * v * x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3);
        }
        x = x3; y = y3;
      }
    }
  }
  polyCache.set(g, polys);
  return polys;
}
const segDist2 = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
};
// The pad (screen px) around the drawn outlines inside which a pointer picks the glyph.
export const glyphPickPadPx = (outlinePx, touch = false) => outlinePx / 2 + (touch ? GLYPH_PICK_MARGIN_TOUCH_PX : GLYPH_PICK_MARGIN_PX);
// Is the pointer (dxPx, dyPx: screen px from the glyph centre) on the drawn icon of constraint `type`? false while the sheet has no such glyph
// (nothing is drawn, so nothing is picked).
export function glyphPickHit(type, dxPx, dyPx, symbolPx, outlinePx, touch = false) {
  const g = getGlyph(CONSTRAINT_GLYPH[type]);
  if (!g) return false;
  const k = symbolPx / Math.max(g.bbox.w, g.bbox.h); // screen px per sheet unit
  const pad = glyphPickPadPx(outlinePx, touch) / k;  // in sheet units
  const px = dxPx / k + g.centre.x, py = dyPx / k + g.centre.y;
  if (px < g.bbox.x0 - pad || px > g.bbox.x1 + pad || py < g.bbox.y0 - pad || py > g.bbox.y1 + pad) return false; // cheap reject
  const pad2 = pad * pad;
  for (const poly of glyphPolys(g)) {
    let inside = false;
    for (let a = poly.length - 2, b = 0; b < poly.length; a = b, b += 2) { // the closing edge first, then each edge
      const ax = poly[a], ay = poly[a + 1], bx = poly[b], by = poly[b + 1];
      if (segDist2(px, py, ax, ay, bx, by) <= pad2) return true;
      if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}
// The invisible cursor:pointer hit element of a glyph group: the icon's own outlines drawn with a transparent stroke (pointer-events:all counts
// the fill and the stroke geometry) of width 2 x the pick pad, so the DOM hit area is the shape glyphPickHit tests. '' when the type has no glyph.
export function glyphHitMarkup(type, iconPx, symbolPx, outlinePx) {
  const g = getGlyph(CONSTRAINT_GLYPH[type]);
  if (!g) return '';
  const side = Math.max(g.bbox.w, g.bbox.h);
  const k = iconPx / side;
  const w = +(2 * glyphPickPadPx(outlinePx) * side / symbolPx).toFixed(4);
  const d = g.paths.join('');
  return `<path class="glyph-hit" transform="scale(${+k.toFixed(5)}) translate(${+(-g.centre.x).toFixed(3)},${+(-g.centre.y).toFixed(3)})" fill="none" stroke="none" stroke-width="${w}" stroke-linejoin="round" pointer-events="all" d="${d}"/>`;
}
