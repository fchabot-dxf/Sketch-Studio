// packages/ui/dim-placement.js — where dimension text goes in the plain (Fusion) look, and where a constraint glyph may go
// so it never covers a dimension label. Pure geometry (world units); the renderer supplies the sizes.

export const DIM_TEXT_GAP_PX = 3;     // clear space between the text baseline and the dimension line
export const DIM_TEXT_CHAR_W = 0.55;  // average glyph advance, in em, for the text-width estimate
export const DIM_TEXT_ASCENT = 0.8;   // text height above the baseline, in em
export const GLYPH_FREE_SPOT_RINGS = 8;

export const dimTextWidth = (text, fontPx) => String(text).length * fontPx * DIM_TEXT_CHAR_W;

const aabb = (pts) => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});

// Plain dimension text for a dimension line through (cx, cy) running along (dirX, dirY): the text is centred on the point,
// reads along the line (rotated into (-90, 90] so it is never upside down), and sits ABOVE the line (the side its
// rotated "up" points to) with `gap` clear. Horizontal line -> text above it; vertical line -> text beside it, rotated 90.
// `outward` (optional unit vector, for a curved dimension line): when "above" points against it, the text sits on the outward
// side instead (still upright), so the line never meets its ends.
// Returns the baseline anchor {x, y}, the rotation in degrees and the text's world bounding box.
export function placeDimText({ cx, cy, dirX, dirY, text, fontPx, gap, outward }) {
  let deg = Math.atan2(dirY, dirX) * 180 / Math.PI;
  while (deg > 90) deg -= 180;
  while (deg <= -90) deg += 180;
  const rad = deg * Math.PI / 180;
  const ux = Math.cos(rad), uy = Math.sin(rad);
  const nx = Math.sin(rad), ny = -Math.cos(rad);
  const hw = dimTextWidth(text, fontPx) / 2, h = fontPx * DIM_TEXT_ASCENT;
  const off = outward && nx * outward.x + ny * outward.y < 0 ? -(gap + h) : gap;
  const x = cx + nx * off, y = cy + ny * off;
  const bounds = aabb([
    [x - ux * hw, y - uy * hw], [x + ux * hw, y + uy * hw],
    [x - ux * hw + nx * h, y - uy * hw + ny * h], [x + ux * hw + nx * h, y + uy * hw + ny * h],
  ]);
  const rect = { cx: x + nx * h / 2, cy: y + ny * h / 2, ux, uy, vx: nx, vy: ny, hw, hh: h / 2 };
  return { x, y, deg: +deg.toFixed(3), bounds, rect };
}

// The same text, but with the text's box CENTRED on (cx, cy) (a value dragged to a free spot sits where it is dropped).
export function placeDimTextCentred({ cx, cy, dirX, dirY, text, fontPx, gap }) {
  const first = placeDimText({ cx, cy, dirX, dirY, text, fontPx, gap });
  return placeDimText({ cx: cx - (first.rect.cx - cx), cy: cy - (first.rect.cy - cy), dirX, dirY, text, fontPx, gap });
}

export const rectsIntersect = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export const centredRect = (x, y, w, h) => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });

// The ONE glyph placement rule: a glyph whose square (centre x,y, side `size`) would cover a dimension label moves to the
// nearest free spot, searched on rings of growing radius (step apart) around its wanted position, 8 directions each.
export function freeGlyphSpot(x, y, size, labels, step) {
  const hits = (px, py) => { const r = centredRect(px, py, size, size); return labels.some((l) => rectsIntersect(r, l)); };
  if (!hits(x, y)) return { x, y };
  for (let ring = 1; ring <= GLYPH_FREE_SPOT_RINGS; ring++) {
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const px = x + Math.cos(a) * ring * step, py = y + Math.sin(a) * ring * step;
      if (!hits(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}
