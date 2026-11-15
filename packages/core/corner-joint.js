// packages/core/corner-joint.js -- TASK 670: the corner JOINT of two boards meeting at a right angle. PURE, no DOM.
//
// PORTED (once, unchanged math) from the owner's frame-calc app: fchabot-dxf/triangular-frame-calc, shared/utils/geometry.js
// cornerJointPoints (its doc comment kept below), the function behind frame-calc's CornerJointPicker / CornerJointGlyph. Sketch-Studio's
// corner glyph (the template start modal's glyph picker) and the "Right-angle frame corner" template both call THIS function: one corner
// geometry. Coordinates are frame-calc's: Y DOWN (SVG), which is also Sketch-Studio's WORLD frame (units.js userToWorldY), so the points are
// world points as they are.

/** The joint types, in frame-calc's CornerJointPicker order, with the names the template start modal shows (aria-label each). */
export const CORNER_JOINT_TYPES = Object.freeze([
  Object.freeze({ value: 'V-Through', label: 'Vertical through' }),
  Object.freeze({ value: 'H-Through', label: 'Horizontal through' }),
  Object.freeze({ value: 'Miter', label: 'Mitered' }),
]);

/**
 * Computes the two boards' outer/inner meeting points at a right-angle
 * corner — the shared math behind every 90° joint picker in this repo
 * (the triangle app's bottom-left/bottom-right corners, and every corner
 * of the box frame tool). Only the corner's outer point is ever a true
 * geometric vertex; the seam between the two boards moves with the type:
 *   'H-Through': the horizontal board runs through to the outer corner;
 *                the vertical board is squared off, starting only after
 *                the horizontal board's thickness.
 *   'V-Through': the mirror image — vertical runs through, horizontal is squared.
 *   'Miter':     both boards are cut at 45°, meeting the outer corner
 *                along a shared diagonal seam instead.
 * All three share the same inner corner point (ox+hx*T, oy+vy*T) — Miter
 * only moves the OUTER point of whichever board doesn't reach the tip.
 * @param {number} ox - this corner's outer x
 * @param {number} oy - this corner's outer y
 * @param {number} hx - +1 if the horizontal board extends rightward from here, else -1
 * @param {number} vy - +1 if the vertical board extends downward from here, else -1
 * @param {number} T - board thickness
 * @param {'H-Through'|'V-Through'|'Miter'} jointType
 * @returns {{hOuter: {x,y}, hInner: {x,y}, vOuter: {x,y}, vInner: {x,y}}}
 */
export function cornerJointPoints(ox, oy, hx, vy, T, jointType) {
  const inner = { x: ox + hx * T, y: oy + vy * T };
  const tip = { x: ox, y: oy };
  const squaredH = { x: ox, y: oy + vy * T }; // horizontal board's inner pt when it's the squared one
  const squaredV = { x: ox + hx * T, y: oy }; // vertical board's inner pt when it's the squared one

  if (jointType === 'H-Through') {
    return { hOuter: tip, hInner: squaredH, vOuter: squaredH, vInner: inner };
  }
  if (jointType === 'V-Through') {
    return { hOuter: squaredV, vOuter: tip, hInner: inner, vInner: squaredV };
  }
  return { hOuter: tip, hInner: inner, vOuter: tip, vInner: inner }; // Miter
}

/**
 * The two board OUTLINES of a right-angle corner (frame-calc's CornerJointGlyph polygons): the horizontal board `lh` long and the vertical
 * board `lv` long, both measured from the outer corner (ox, oy), both T thick. -> { h: [4 points], v: [4 points] } (frame-calc's point order:
 * hBoard = [hOuter, far outer, far inner, hInner], vBoard = [vOuter, far outer, far inner, vInner]).
 */
export function cornerBoards(ox, oy, hx, vy, T, lh, lv, jointType) {
  const { hOuter, hInner, vOuter, vInner } = cornerJointPoints(ox, oy, hx, vy, T, jointType);
  return {
    h: [hOuter, { x: ox + hx * lh, y: oy }, { x: ox + hx * lh, y: oy + vy * T }, hInner],
    v: [vOuter, { x: ox, y: oy + vy * lv }, { x: ox + hx * T, y: oy + vy * lv }, vInner],
  };
}
