// apps/frame-calc's quad-joint-glyph: mechanical port of
// geometric-frame-calc/shared/components/QuadJointGlyph.js to plain SVG DOM (no React), for the
// in-canvas per-corner joint-type picker (Slice 0 parity). Renders the two boards meeting at a corner,
// cropped to a small square, so the glyph itself SHOWS how the joint is cut — the reason the original
// puts this picker in-canvas rather than a dropdown (the choice is spatial).
//
// Verbatim algorithm from the reference: build 5 points along a constant-turn-angle arc so the middle 3
// carry EXACTLY the requested interior angle (matching what a real corner gives its neighbors), run them
// through calculateQuadFrameGeometry with the target joint type on all 5, then crop the two boards meeting
// at the center vertex to 55% length so they fit a fixed viewBox.

import { calculateQuadFrameGeometry, toPoly } from '#core/frame-geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SIDE_LEN = 40;
const THICK = 8;

function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

function bbox(...pointArrays) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of pointArrays) for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * @param {'Miter'|'CW-Through'|'CCW-Through'} type
 * @param {boolean} active
 * @param {number} interiorAngleDeg
 * @param {number} [rotation=0] degrees
 * @returns {SVGSVGElement}
 */
export function quadJointGlyph(type, active, interiorAngleDeg, rotation = 0) {
  const c1 = active ? '#e0f2fe' : '#f1f5f9';
  const c2 = active ? '#bae6fd' : '#e2e8f0';
  const strokeColor = active ? '#0284c7' : '#334155';
  const strokeW = 1.4;

  const turnRad = (180 - interiorAngleDeg) * Math.PI / 180;
  const R = SIDE_LEN / (2 * Math.sin(turnRad / 2));
  const pointAt = (k) => { const a = k * turnRad - Math.PI / 2; return { x: R * Math.cos(a), y: R * Math.sin(a) }; };
  const P = [pointAt(-2), pointAt(-1), pointAt(0), pointAt(1), pointAt(2)];

  const geo = calculateQuadFrameGeometry({ P, thick: THICK, shellOffset: 0, joints: Array(5).fill(type) });
  const leftBoard = geo.boards[1];
  const rightBoard = geo.boards[2];

  const t = 0.55;
  const leftMid = lerp(leftBoard.p2, leftBoard.p1, t);
  const leftInnerMid = lerp(leftBoard.p3, leftBoard.p4, t);
  const rightMid = lerp(rightBoard.p1, rightBoard.p2, t);
  const rightInnerMid = lerp(rightBoard.p4, rightBoard.p3, t);

  const leftCrop = [leftMid, leftBoard.p2, leftBoard.p3, leftInnerMid];
  const rightCrop = [rightBoard.p1, rightMid, rightInnerMid, rightBoard.p4];

  const bb = bbox(leftCrop, rightCrop);
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const side = 46;
  const svg = svgEl('svg', {
    viewBox: `${cx - side / 2} ${cy - side / 2} ${side} ${side}`,
    width: '100%', height: '100%',
  });
  svg.style.overflow = 'visible';
  svg.style.transform = `rotate(${rotation}deg)`;
  svg.appendChild(svgEl('polygon', { points: toPoly(leftCrop), fill: c1, stroke: strokeColor, 'stroke-width': strokeW, 'stroke-linejoin': 'round' }));
  svg.appendChild(svgEl('polygon', { points: toPoly(rightCrop), fill: c2, stroke: strokeColor, 'stroke-width': strokeW, 'stroke-linejoin': 'round' }));
  return svg;
}
