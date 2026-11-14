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

// THE glyph pick box (task 603): a glyph is picked only when the pointer is on its DRAWN icon, never on a disc around its centre. The icon is
// the sheet glyph's bbox scaled so its larger side = `symbolPx` (the same k as fusionGlyphMarkup), plus half the outline stroke, plus a margin:
// a small one for a mouse, a larger one for a finger. Icons are never drawn rotated, so the box is axis-aligned and centred on the glyph.
// Returns { hw, hh } (half width / half height, screen px) or null while the sheet has no such glyph (nothing is drawn, so nothing is picked).
// hover-manager glyphAt (hover, left click, right click) and svg-renderer (the cursor:pointer hit rect) are its only callers.
export const GLYPH_PICK_MARGIN_PX = 2;
export const GLYPH_PICK_MARGIN_TOUCH_PX = 6;
export function glyphPickHalfSize(type, symbolPx, outlinePx, touch = false) {
  const g = getGlyph(CONSTRAINT_GLYPH[type]);
  if (!g) return null;
  const k = symbolPx / Math.max(g.bbox.w, g.bbox.h);
  const pad = outlinePx / 2 + (touch ? GLYPH_PICK_MARGIN_TOUCH_PX : GLYPH_PICK_MARGIN_PX);
  return { hw: g.bbox.w * k / 2 + pad, hh: g.bbox.h * k / 2 + pad };
}
