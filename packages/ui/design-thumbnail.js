// packages/ui/design-thumbnail.js — TASK 547: a small SVG picture of a stored design, for the project manager's grid.
// Built from the design's DOCUMENT through the ONE existing shape flattener (#core/core-shape-to-polyline: lines, circles, arcs, beziers),
// so there is no second renderer: this only fits those polylines into a square and writes them as strokes. Pure (no DOM of its own;
// arcs are sampled by #core's sampler, which uses the browser's SVG path API and degrades to the endpoints elsewhere).
// Returns an SVG markup string (stroke = currentColor, so it follows the theme), or null when the design has no drawable geometry.
// TASK 1036 (BUG-372, N-4): it draws what the export draws (#core/curve-kinds exportedShapes: no construction geometry) plus the texts' letters. A
// stored document has no letters (#core/document.js serializeDocument drops them): they are rebuilt here by THE rebuild a document read runs
// (#ui/text-fonts.js syncTextOutlines, from the page's one font library, so a font is downloaded once), on a working copy of the document's
// geometry. -> a Promise: a design with no text settles at once (it never waits on a font); one with text when its fonts are read.

import { coreShapeToPolyline } from '#core/core-shape-to-polyline.js';
import { exportedShapes } from '#core/curve-kinds.js';
import { syncTextOutlines, fontLibrary } from '#ui/text-fonts.js';

const SIZE = 100;     // viewBox is SIZE x SIZE
const MARGIN = 8;
const r = (n) => Math.round(n * 100) / 100;

export async function designThumbnailSvg(document, { library = fontLibrary } = {}) {
  const g = document && document.geometry;
  if (!g || !Array.isArray(g.joints) || !Array.isArray(g.shapes)) return null;
  const drawing = { joints: new Map(g.joints.map(([id, j]) => [id, j])), shapes: g.shapes.slice() };   // the letters are added to this copy, never to the document
  await syncTextOutlines(drawing, { library });
  const lines = [];
  for (const s of exportedShapes(drawing)) {
    const pts = coreShapeToPolyline(s, drawing.joints).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length >= 2) lines.push(pts);
  }
  if (!lines.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of lines) for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = (SIZE - 2 * MARGIN) / span;
  const ox = (SIZE - (maxX - minX) * k) / 2 - minX * k;
  const oy = (SIZE - (maxY - minY) * k) / 2 - minY * k;
  const d = lines.map((pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r(x * k + ox)} ${r(y * k + oy)}`).join('')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" preserveAspectRatio="xMidYMid meet"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
