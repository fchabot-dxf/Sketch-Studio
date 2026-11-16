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
// TASK 672: a glyph is GLYPHS[glyph](value, { active, values }): `values` = the start modal's current values of every param (a glyph may draw
// with them: the polygon joint's angle is the one of the chosen number of sides; the box corner follows the layout).
// 'brace-top' / 'brace-bl' / 'brace-br': PORTED from frame-calc triangle-frame-calculator/src/components/JointDiagram.js (React there): THE
// frame engine (#core/frame-geometry.js calculateFramingGeometry) on frame-calc's normalized 40 x 40 frame, all three thicknesses 8, the OTHER
// two corners at frame-calc's glyph values (top V-Through, bottom-left V-Through, bottom-right H-Through); the two boards meeting at that
// corner (top: vertical + diagonal; bottom-left: vertical + horizontal; bottom-right: horizontal + diagonal, the first one lighter), the same
// square centred viewBox (pad 3), stroke and colouring as 'corner-joint'.
// 'polygon-joint': PORTED from frame-calc shared/components/QuadJointGlyph.js (React there): 5 points on a constant-turn arc (turn = 180 - the
// corner's interior angle, side 40), THE per-vertex frame engine (calculatePolygonFrameGeometry) with every joint = the option and thickness 8,
// boards 1 and 2 (the two meeting at the middle vertex) cropped to 55 % of their length, a 46 x 46 viewBox centred on the crops. TASK 674: the
// interior angle is the corner's (templateCorners: for the polygon frame's row, its first corner's = the regular N-gon's, unrotated as before).
// 'box-corner-joint': the box frame's corner joint: the 'corner-joint' glyph, as the drawing will be: the Horizontal layout is the vertical one
// mirrored in its diagonal (#core/templates.js), which turns "the vertical board runs through" into "the horizontal board runs through", so
// the glyph of the other through option is shown there (the mirror of the top-left corner glyph is the other one).
// TASK 674: a glyph is GLYPHS[glyph](value, { active, values, corner }): `corner` = the corner it stands for (#core/templates.js
// templateCorners: { interior, out }) when it is drawn for one corner (on the start modal's preview: `out` = the direction off the drawing),
// or { interior } for a whole row (the first corner's angle, unturned). 'polygon-joint' draws the corner's interior angle turned the way frame-calc
// turns QuadJointGlyph (TrapezoidCanvasView.js: rotation = the corner's outward direction + 90 degrees, so the glyph's vertex points out of the
// drawing); 'corner-joint' / 'box-corner-joint' draw the corner's own orientation (cornerBoards' hx / vy = the inward directions, from `out`);
// the brace glyphs are frame-calc's JointDiagram as they are (frame-calc's oblique triangle shows them unturned too).
// 'trapezoid-variant': the trapezoid frame's shape (#core/frame-geometry.js TRAPEZOID_VARIANTS): a small frame of four mitered boards from THE
// per-vertex engine on that variant's trapezoid (mapTrapezoidVertices, computeEffectiveOffset), the same viewBox rule, stroke and colouring.

import { cornerBoards, boxJointInLayout } from '#core/corner-joint.js';
import { calculateFramingGeometry, calculatePolygonFrameGeometry, mapTrapezoidVertices, computeEffectiveOffset, TRAPEZOID_VARIANTS } from '#core/frame-geometry.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const STROKE_W = 1.4, PAD = 3;

// frame-calc's centeredViewBox(getBBox(...), pad): a square box around every polygon's points, centred on their bounding box
function centeredViewBox(polys, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of polys) for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const side = Math.max(maxX - minX, maxY - minY) + pad * 2, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return `${cx - side / 2} ${cy - side / 2} ${side} ${side}`;
}

// boards: [{ points, tone: 'light' | 'dark' }] -> the glyph <svg> (aria-hidden: the button carries the name); viewBox: the square centred one
function boardsSvg(boards, active, viewBox = centeredViewBox(boards.map((b) => b.points), PAD)) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', viewBox);
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

// frame-calc JointDiagram: one corner's two boards of the normalized brace
const braceGlyph = (corner) => (type, { active = false } = {}) => {
  const { points } = calculateFramingGeometry({ width: 40, height: 40, thickV: 8, thickH: 8, thickD: 8,
    topJoint: corner === 'top' ? type : 'V-Through', blJoint: corner === 'bl' ? type : 'V-Through', brJoint: corner === 'br' ? type : 'H-Through' });
  const pair = { top: [points.V, points.D], bl: [points.V, points.H], br: [points.H, points.D] }[corner];
  return boardsSvg([{ points: Object.values(pair[0]), tone: 'light' }, { points: Object.values(pair[1]), tone: 'dark' }], active);
};

// frame-calc QuadJointGlyph: the two boards at a vertex of the given interior angle, cropped, turned by `rotation` degrees about the crop's centre
// (frame-calc turns the whole <svg> with a CSS rotate about its centre, the viewBox centre: the same picture)
const SIDE_LEN = 40, THICK = 8;
function polygonJointGlyph(type, interiorAngleDeg, active, rotation = 0) {
  const turnRad = (180 - interiorAngleDeg) * Math.PI / 180;
  const Rc = SIDE_LEN / (2 * Math.sin(turnRad / 2));
  const pointAt = (k) => { const a = k * turnRad - Math.PI / 2; return { x: Rc * Math.cos(a), y: Rc * Math.sin(a) }; };
  const geo = calculatePolygonFrameGeometry({ P: [pointAt(-2), pointAt(-1), pointAt(0), pointAt(1), pointAt(2)], thick: THICK, shellOffset: 0, joints: Array(5).fill(type) });
  const leftBoard = geo.boards[1], rightBoard = geo.boards[2]; // neighbor(-1) -> target vertex, target vertex -> neighbor(+1)
  const lerp = (pA, pB, t) => ({ x: pA.x + (pB.x - pA.x) * t, y: pA.y + (pB.y - pA.y) * t });
  const t = 0.55;
  const leftCrop = [lerp(leftBoard.p2, leftBoard.p1, t), leftBoard.p2, leftBoard.p3, lerp(leftBoard.p3, leftBoard.p4, t)];
  const rightCrop = [rightBoard.p1, lerp(rightBoard.p1, rightBoard.p2, t), lerp(rightBoard.p4, rightBoard.p3, t), rightBoard.p4];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of [...leftCrop, ...rightCrop]) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const side = 46, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2; // frame-calc: exactly 46, so the board thickness (8) matches the other glyphs
  const r = rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const turn = (p) => (rotation ? { x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos } : p);
  return boardsSvg([{ points: leftCrop.map(turn), tone: 'light' }, { points: rightCrop.map(turn), tone: 'dark' }], active, `${cx - side / 2} ${cy - side / 2} ${side} ${side}`);
}
// TASK 674: frame-calc's glyph rotation for a corner: its outward direction + 90 degrees (unturned for a row: no `out`)
const rotationOf = (corner) => (corner && corner.out ? Math.atan2(corner.out.y, corner.out.x) * 180 / Math.PI + 90 : 0);
// TASK 674: cornerBoards' inward directions of a corner (the top-left corner, hx = vy = 1, without one)
const inward = (corner) => (corner && corner.out ? [corner.out.x > 0 ? -1 : 1, corner.out.y > 0 ? -1 : 1] : [1, 1]);
function trapezoidVariantGlyph(variant, active) {
  const v = TRAPEZOID_VARIANTS.find((o) => o.value === variant), bottomWidth = 40, topWidth = 22, height = 26;
  const offset = computeEffectiveOffset({ trapVariant: v.trapVariant, rightSide: v.rightSide, bottomWidth, topWidth, freeOffset: -4 });
  const { boards } = calculatePolygonFrameGeometry({ P: mapTrapezoidVertices({ bottomWidth, topWidth, height, offset }), thick: 4, joints: Array(4).fill('Miter') });
  return boardsSvg(boards.map((b, k) => ({ points: [b.p1, b.p2, b.p3, b.p4], tone: k % 2 ? 'light' : 'dark' })), active);
}

export const GLYPHS = Object.freeze({
  'corner-joint': (type, { active = false, corner } = {}) => {
    const T = 8, A = 32; // frame-calc's normalized proportions (its JointDiagram's 40 x 40 / 8 mini triangle)
    const [hx, vy] = inward(corner);
    const b = cornerBoards(0, 0, hx, vy, T, A, A, type);
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
  'box-corner-joint': (type, { active = false, values = {}, corner } = {}) => GLYPHS['corner-joint'](boxJointInLayout(type, values.layout), { active, corner }),
  'brace-top': braceGlyph('top'),
  'brace-bl': braceGlyph('bl'),
  'brace-br': braceGlyph('br'),
  'polygon-joint': (type, { active = false, corner }) => polygonJointGlyph(type, corner.interior, active, rotationOf(corner)),
  'trapezoid-variant': (variant, { active = false } = {}) => trapezoidVariantGlyph(variant, active),
});
