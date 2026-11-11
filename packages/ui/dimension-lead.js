// packages/ui/dimension-lead.js — the ONE place that decides where a dimension's lead lines and arrowheads go when its value
// is dragged away (constraint.labelPos) or the measured span is too small for two arrowheads (Fusion 360 behaviour).
// Pure geometry in world units; the renderer supplies sizes. A text "rect" is {cx, cy, ux, uy, vx, vy, hw, hh}: centre, the
// text direction u, its normal v, and the half extents along each.

export const DIM_ARROW_PX = 6;        // arrowhead length, screen px
export const DIM_ARROW_GAP_PX = 4;    // clear space between two inside arrowheads, screen px
export const DIM_NARROW_STUB_PX = 8;  // line stub beyond an outside arrowhead, screen px
export const DIM_LEAD_MIN_PX = 4;     // a leader shorter than this is not drawn (the text already sits on its line)

// A span narrower than this (screen px) cannot hold two arrowheads and their gap: the arrows go outside.
export const dimNarrowThresholdPx = () => 2 * DIM_ARROW_PX + DIM_ARROW_GAP_PX;
export const isNarrowDim = (spanWorld, zoom) => spanWorld / zoom < dimNarrowThresholdPx();

// A dimension value placed by its centre with an axis-aligned box (the Default look).
export const axisRect = (cx, cy, w, h) => ({ cx, cy, ux: 1, uy: 0, vx: 0, vy: 1, hw: w / 2, hh: h / 2 });

// Where the straight line from `from` to the rect's centre meets the rect's edge; null when `from` is inside the rect.
export function rectEdgePoint(rect, from) {
  const dx = from.x - rect.cx, dy = from.y - rect.cy;
  const lx = dx * rect.ux + dy * rect.uy, ly = dx * rect.vx + dy * rect.vy;
  const k = Math.max(Math.abs(lx) / (rect.hw || 1e-9), Math.abs(ly) / (rect.hh || 1e-9));
  if (k <= 1) return null;
  const ex = lx / k, ey = ly / k;
  return { x: rect.cx + rect.ux * ex + rect.vx * ey, y: rect.cy + rect.uy * ex + rect.vy * ey };
}

const seg = (a, b) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

// A straight leader from `anchor` to the text rect's edge (radius / diameter: the rim point; angle: the arc point).
export function radialLead(anchor, rect, minLen) {
  const edge = rectEdgePoint(rect, anchor);
  if (!edge || Math.hypot(edge.x - anchor.x, edge.y - anchor.y) < minLen) return null;
  return seg(anchor, edge);
}

// A linear dimension: the dimension line runs start -> end. A text beyond one end EXTENDS the dimension line to the text; a
// text off the line gets a thin leader from the nearest point of the (extended) line to the text edge.
// Returns { extension, leader }, each a segment {x1,y1,x2,y2} or null. The extension starts at the line's end it extends.
export function linearLead(start, end, rect, minLen) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { extension: null, leader: null };
  const ax = dx / len, ay = dy / len;
  const t = (rect.cx - start.x) * ax + (rect.cy - start.y) * ay;
  const half = Math.abs(rect.ux * ax + rect.uy * ay) * rect.hw + Math.abs(rect.vx * ax + rect.vy * ay) * rect.hh;
  const at = (s) => ({ x: start.x + ax * s, y: start.y + ay * s });
  let extension = null, lo = 0, hi = len;
  if (t - half - len > minLen) { hi = t - half; extension = seg(end, at(hi)); }
  else if (t + half < -minLen) { lo = t + half; extension = seg(start, at(lo)); }
  const anchor = at(Math.min(hi, Math.max(lo, t)));
  return { extension, leader: radialLead(anchor, rect, minLen) };
}
