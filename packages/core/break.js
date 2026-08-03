// packages/core/break.js — TRACE-1
// Pure geometry operation: split a line shape at a parameter t (0..1) into two.
// No DOM. Operates directly on state.joints / state.shapes.
//
// breakShape(state, shapeId, t) → { newShapeId, midJointId } | null
//
// The original shape [A---B] at parameter t becomes:
//   [A---M]  +  [M---B]
// where M is a new joint at point lerp(A, B, t).
// All constraints referencing the original shape's endpoint joints are preserved
// (they remain attached to A and B respectively).

/**
 * Split the line shape `shapeId` at fractional parameter `t` (0..1).
 * Mutates state.joints and state.shapes in place.
 *
 * @param {object} state    - #core sketch state (joints Map, shapes Array, genJ fn)
 * @param {string} shapeId  - ID of the target line shape
 * @param {number} t        - Split parameter, 0 = start, 1 = end (clamped)
 * @returns {{ midJointId:string, newShapeId:string } | null}
 */
export function breakShape(state, shapeId, t) {
  const shape = (state.shapes || []).find(s => s.id === shapeId);
  if (!shape || shape.type !== 'line') return null;

  t = Math.max(0.001, Math.min(0.999, t));

  const [aId, bId] = shape.joints;
  const jA = state.joints.get(aId);
  const jB = state.joints.get(bId);
  if (!jA || !jB) return null;

  // Midpoint coordinates
  const mx = jA.x + t * (jB.x - jA.x);
  const my = jA.y + t * (jB.y - jA.y);

  // Mint a new joint for the midpoint
  const midJointId = state.genJ?.() ?? ('jbrk_' + Date.now());
  state.joints.set(midJointId, { x: mx, y: my });

  // Build the second segment (M→B), reusing the original shape's metadata
  const newShapeId = 'Lbrk_' + midJointId + '_' + bId;
  const newShape = {
    ...shape,
    id:     newShapeId,
    joints: [midJointId, bId],
  };
  state.shapes.push(newShape);

  // Mutate the original shape: A→M
  shape.joints = [aId, midJointId];

  return { midJointId, newShapeId };
}

/**
 * Find the closest parameter t on a line segment (A→B) to world point p.
 * Returns t in [0, 1].
 *
 * @param {{x,y}} jA - Start joint
 * @param {{x,y}} jB - End joint
 * @param {{x,y}} p  - World click point
 * @returns {number} t
 */
export function lineParamAtPoint(jA, jB, p) {
  const dx = jB.x - jA.x;
  const dy = jB.y - jA.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return 0;
  const t = ((p.x - jA.x) * dx + (p.y - jA.y) * dy) / L2;
  return Math.max(0, Math.min(1, t));
}
