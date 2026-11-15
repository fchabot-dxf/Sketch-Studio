// packages/ui/template-glyphs.js -- TASK 670: the tiny GLYPHS a CHOICE param of a template shows in the start modal's glyph picker
// (template-picker.js). A choice param names its glyph ({ kind: 'choice', options, glyph: 'corner-joint' }); GLYPHS[glyph](value, { active })
// returns an <svg> for one option. Plain DOM / SVG, no framework.
//
// 'corner-joint': PORTED from the owner's frame-calc app (fchabot-dxf/triangular-frame-calc, shared/components/CornerJointGlyph.js, a React
// component there): the two board polygons from cornerJointPoints (#core/corner-joint.js cornerBoards, the ONE port of frame-calc's math) at
// frame-calc's normalized proportions T = 8, A = 32, for the top-left corner (frame-calc's 'TL': hx = 1, vy = 1, the corner the
// "Right-angle frame corner" template draws); a SQUARE viewBox centred on the polygons' bounding box with pad 3; two-tone fills (the horizontal
// board lighter than the vertical one), stroke 1.4, round joins, and an ACTIVE colouring. frame-calc's Tailwind hex colours are mapped to the
// app's theme tokens (light and dark hosts) through the CSS in template-picker.js:
//   stroke          currentColor = the modal's text colour (--sk-sidebar-fg, else --sk-header-fg)       (frame-calc #334155)
//   active stroke   --sk-sidebar-accent, else --sk-selection                                            (frame-calc #0284c7)
//   fills           the stroke colour at 14 % (horizontal board) and 32 % (vertical board) opacity      (frame-calc #f1f5f9 / #e2e8f0,
//                   so the two tones follow the theme and the active colour                               active #e0f2fe / #bae6fd)
// 'box-layout': the box frame's Vertical / Horizontal layout drawn the same way: a tiny tall frame and a tiny wide frame (two full-length boards
// in the lighter tone, the two ends and one divider between them in the darker tone), same viewBox rule, stroke and colouring.

import { cornerBoards } from '#core/corner-joint.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const STROKE_W = 1.4, PAD = 3;

// frame-calc's centeredViewBox(getBBox(...), pad): a square box around every polygon's points, centred on their bounding box
function centeredViewBox(polys, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of polys) for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const side = Math.max(maxX - minX, maxY - minY) + pad * 2, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return `${cx - side / 2} ${cy - side / 2} ${side} ${side}`;
}

// boards: [{ points, tone: 'light' | 'dark' }] -> the glyph <svg> (aria-hidden: the button carries the name)
function boardsSvg(boards, active) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', centeredViewBox(boards.map((b) => b.points), PAD));
  svg.setAttribute('class', 'sk-tp-glyph' + (active ? ' sk-tp-glyph-active' : ''));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const b of boards) {
    const poly = document.createElementNS(SVGNS, 'polygon');
    poly.setAttribute('points', b.points.map((p) => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('class', 'sk-tp-board sk-tp-board-' + b.tone);
    poly.setAttribute('stroke-width', String(STROKE_W));
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
  }
  return svg;
}

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

export const GLYPHS = Object.freeze({
  'corner-joint': (type, { active = false } = {}) => {
    const T = 8, A = 32; // frame-calc's normalized proportions (its JointDiagram's 40 x 40 / 8 mini triangle)
    const b = cornerBoards(0, 0, 1, 1, T, A, A, type);
    return boardsSvg([{ points: b.h, tone: 'light' }, { points: b.v, tone: 'dark' }], active);
  },
  'box-layout': (layout, { active = false } = {}) => {
    const T = 4, W = 20, L = 32; // a tiny frame: W wide, L long, T thick boards, one divider in the middle
    const boards = [
      { points: rect(0, 0, T, L), tone: 'light' }, { points: rect(W - T, 0, T, L), tone: 'light' }, // the full-length boards
      { points: rect(T, 0, W - 2 * T, T), tone: 'dark' }, { points: rect(T, L - T, W - 2 * T, T), tone: 'dark' }, // the ends
      { points: rect(T, (L - T) / 2, W - 2 * T, T), tone: 'dark' }, // a divider
    ];
    if (layout === 'Horizontal') for (const b of boards) b.points = b.points.map((p) => ({ x: p.y, y: p.x })); // the same frame, x and y swapped
    return boardsSvg(boards, active);
  },
});
