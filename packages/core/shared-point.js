// packages/core/shared-point.js — TASK 1041: THE SHARED POINT of two or more curves, and Fusion's way to split it.
//
// Many shapes join their curves at ONE shared joint (a polygon's corners, a slot's cap / side joints, a fillet's rims, offset copies, imports,
// mirror and pattern copies, bezier paths: docs/SHAPE-MODEL-PLAN-1035.md W-6 (b) / (c)). Fusion, MEASURED by the advisor 2026-11-27 with the real
// mouse:
//   - two curves meeting at a point share ONE SketchPoint; the API lists no coincident constraint for it;
//   - a click on that point shows a coincident glyph beside it (none with nothing selected); the glyph is an entity "SharedPointCoincident";
//   - with n curves at one point Fusion shows n - 1 glyphs (3 lines -> 2): each glyph is ONE curve's membership of the point; the curve that
//     joined the point LAST owns it and has no glyph of its own;
//   - Delete on a glyph detaches ONLY that curve: it gets its own new point at the same place (sketch points +1), the other curves keep sharing;
//   - constraints ON THE CURVES stay on the curves (Horizontal stayed on its line); everything ON THE POINT (a dimension to it, measured twice
//     with the roles reversed) stays with the curve that joined it last; the detached curve's new point carries nothing;
//   - Fusion never refuses: detaching an OFFSET copy's corner removes the Offset relationship (the copies become plain lines), detaching a
//     PATTERN SOURCE's corner removes the pattern relationship (its copies become plain geometry and keep their own shared corners); detaching
//     a pattern COPY's corner keeps the pattern (the CircularPattern constraint still there, points +1);
//   - right-clicking a joined corner point offers "Delete Coincident": the same split as deleting the glyph (owner-checked; joinsAt below).
//
// Here the "joined last" curve is the LATEST of the curves in state.shapes (a curve is appended when it is made). A glyph is not stored: it is
// DERIVED from the shapes (sharedPointCoincidents), one per non-owner curve at a shared joint, { type: SHARED_POINT_COINCIDENT, joints: [J],
// shape: the curve }; the renderer draws it with the coincident glyph's look and show-on-select rule, a pick selects it like any glyph, and
// Delete (#core/delete-manager.js deleteSelection: the Delete key, the context menu, the phone's footer Delete) runs detachFromSharedPoint.
// Stacked corners (two joints + a stored COINCIDENT: today's rectangle and Line-tool chain) are not shared points: their coincident is a real
// constraint, deleted as before.

import { EXPORTED_TYPES } from './curve-kinds.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { newJointId } from './shape-id.js';
import { dropConstraints } from './break.js';
import { isPatternConstraint } from './pattern.js';
import { dimensionValuesOf, reconcileKeptDimensions } from './parameters.js';
import { docUnit } from './settings-manager.js';
import { getCoincidentJoints } from './joints.js';

/** The derived glyph entity's type (Fusion's SharedPointCoincident). Not a stored constraint type: never in state.constraints. */
export const SHARED_POINT_COINCIDENT = 'sharedPointCoincident';
export const isSharedPointCoincident = (c) => !!c && c.type === SHARED_POINT_COINCIDENT;

// The curves (#core/curve-kinds.js EXPORTED_TYPES: line, arc, bezier, circle; construction ones included, a text record is no curve).
const isCurve = (s) => !!s && EXPORTED_TYPES.includes(s.type) && Array.isArray(s.joints);

/** The curves that use joint `jointId`, in state.shapes order (the last one joined it last: it owns the point). */
export function curvesAtJoint(shapes, jointId) {
  return (shapes || []).filter((s) => isCurve(s) && s.joints.includes(jointId));
}

// One entity object per (joint object, curve), kept while that joint object lives, so a hover / a selection (which hold the object) still
// match it on the next frame. Keyed by the JOINT OBJECT: the canvas's visible scene and the pick read the same joint objects; an undo restores
// new joint objects (and clears the selection).
const entities = new WeakMap();
function entityFor(jointObj, jointId, shapeId) {
  let byShape = entities.get(jointObj);
  if (!byShape) { byShape = new Map(); entities.set(jointObj, byShape); }
  let e = byShape.get(shapeId);
  if (!e || e.joints[0] !== jointId) { e = { type: SHARED_POINT_COINCIDENT, joints: [jointId], shape: shapeId }; byShape.set(shapeId, e); }
  return e;
}

/**
 * The SharedPointCoincident glyphs of a scene: at every joint two or more curves use, one per curve except the owner (the latest curve).
 * `joints` (a Map) and `shapes` are the scene's (the renderer's visible scene, or the state's for a pick).
 */
export function sharedPointCoincidents(joints, shapes) {
  const at = new Map();
  for (const s of shapes || []) {
    if (!isCurve(s)) continue;
    for (const j of new Set(s.joints)) { if (!at.has(j)) at.set(j, []); at.get(j).push(s); }
  }
  const out = [];
  for (const [j, list] of at) {
    if (list.length < 2) continue;
    const obj = joints && joints.get(j);
    if (!obj) continue;
    for (const s of list.slice(0, -1)) out.push(entityFor(obj, j, s.id));
  }
  return out;
}

// The stored constraint forms in which two joints at positions [i, k] stand for ONE two-point operand (a line, an arc's centre + rim): a
// curve's own pair. Every other joint a constraint names (a coincident's, a pointOnLine / midpoint / symmetric / collinear point, the P of a
// point-to-line distance) is a POINT operand. Forms by type and joint count, as the solver reads them (#core/solver/definitions.js).
const PAIRS = [[0, 1]], TWO_PAIRS = [[0, 1], [2, 3]];
const JOINT_PAIR_FORMS = Object.freeze({
  [CONSTRAINT_TYPES.HORIZONTAL]: { 2: PAIRS },
  [CONSTRAINT_TYPES.VERTICAL]: { 2: PAIRS },
  [CONSTRAINT_TYPES.DISTANCE]: { 2: PAIRS, 3: [[1, 2]] },  // a length / a centre-rim radius [a, b]; a point-to-line [p, a, b]
  [CONSTRAINT_TYPES.MIDPOINT]: { 3: PAIRS },               // [a, b, m]
  [CONSTRAINT_TYPES.POINT_ON_LINE]: { 3: [[1, 2]] },       // [p, a, b]
  [CONSTRAINT_TYPES.EQUAL]: { 4: TWO_PAIRS },              // two lengths / radii [a, b, c, d]
  [CONSTRAINT_TYPES.PARALLEL]: { 4: TWO_PAIRS },
  [CONSTRAINT_TYPES.PERPENDICULAR]: { 4: TWO_PAIRS },
  [CONSTRAINT_TYPES.ANGLE]: { 4: TWO_PAIRS },
});
const pairsOf = (c) => (c && Array.isArray(c.joints) && (JOINT_PAIR_FORMS[c.type] || {})[c.joints.length]) || [];

/**
 * THE split (Fusion: Delete on a SharedPointCoincident): detach curve `shapeId` from the joint `jointId` it shares with other curves. The curve
 * gets a NEW joint at the same place (no other field: not fixed, nothing attached); the joint and everything attached to the POINT stay with the
 * other curves (the owner: the latest of them). A constraint ON the detached curve that names the joint through one of the curve's own joint
 * pairs (JOINT_PAIR_FORMS: its H / V, its length, an arc's centre-rim equal, a point-to-line distance to it, a midpoint of it) moves to the new
 * joint; a constraint naming the curve by its shape id needs nothing. A pair the curve shares with a curve that stays (two curves with the same
 * two joints) stays on the joint. An OFFSET whose copies the split separates, and a PATTERN whose source curve is detached, are dissolved (their
 * records go, as Fusion's): the offset copies / the pattern copies stay as plain geometry. No history and no solve: the caller owns them
 * (#core/delete-manager.js deleteSharedPointCoincidents). The owner curve (or a joint no longer shared) is refused: nothing changes.
 * -> { ok: true, joint: the new joint id, owner: the owner curve id, dissolved: [the removed records] } | { ok: false, reason }
 */
export function detachFromSharedPoint(state, jointId, shapeId) {
  const curves = curvesAtJoint(state.shapes, jointId);
  const J = state.joints.get(jointId);
  if (!J || curves.length < 2) return { ok: false, reason: 'the point is not shared by two curves' };
  const owner = curves[curves.length - 1];
  const curve = curves.find((s) => s.id === shapeId);
  if (!curve) return { ok: false, reason: 'that curve does not use the point' };
  if (curve === owner) return { ok: false, reason: 'the curve that joined the point last owns it' };
  const stay = curves.filter((s) => s !== curve);
  const dimsBefore = dimensionValuesOf(state.constraints);

  const nid = newJointId();
  state.joints.set(nid, J.sketchId !== undefined ? { x: J.x, y: J.y, sketchId: J.sketchId } : { x: J.x, y: J.y });
  const onCurve = (other) => curve.joints.includes(other) && !stay.some((s) => s.joints.includes(other));
  for (const c of state.constraints) {
    for (const [i, k] of pairsOf(c)) {
      if (c.joints[i] === jointId && c.joints[k] !== jointId && onCurve(c.joints[k])) c.joints[i] = nid;
      else if (c.joints[k] === jointId && c.joints[i] !== jointId && onCurve(c.joints[i])) c.joints[k] = nid;
    }
  }
  curve.joints = curve.joints.map((j) => (j === jointId ? nid : j));

  const stayIds = new Set(stay.map((s) => s.id));
  const dissolve = state.constraints.filter((c) => {
    if (c && c.type === CONSTRAINT_TYPES.OFFSET && Array.isArray(c.shapes)) {
      const copies = c.shapes.filter((_, i) => i % 2 === 1); // [src0, off0, src1, off1, ...] (#core/offset.js)
      return copies.includes(curve.id) && copies.some((id) => stayIds.has(id));
    }
    return isPatternConstraint(c) && c.sources && c.sources.shapes.includes(curve.id);
  });
  dropConstraints(state, dissolve);
  if (dissolve.length) reconcileKeptDimensions(state, dimsBefore, { unit: docUnit() }); // a dissolved offset / pattern value a formula reads keeps its name (O10)
  return { ok: true, joint: nid, owner: owner.id, dissolved: dissolve };
}

/**
 * The JOINS at the spot of joint `jointId` (Fusion's point context menu "Delete Coincident", measured by the owner 2026-11-27: on a joined corner
 * it does the same split as deleting the glyph): the spot is the point's coincident cluster (#core/joints.js getCoincidentJoints); its joins are
 * the SharedPointCoincident glyphs of every point of the spot (sharedPointCoincidents) and the stored COINCIDENT constraints that glue two of
 * those points. Deleting them all (#core/delete-manager.js deleteSelection) leaves every curve at the spot on its own point. [] = no join.
 */
export function joinsAt(state, jointId) {
  const spot = getCoincidentJoints(jointId, state.constraints || []);
  const glyphs = sharedPointCoincidents(state.joints, state.shapes).filter((g) => spot.has(g.joints[0]));
  const glue = (state.constraints || []).filter((c) => c && c.type === CONSTRAINT_TYPES.COINCIDENT && Array.isArray(c.joints) && c.joints.length >= 2 && spot.has(c.joints[0]) && spot.has(c.joints[1]));
  return [...glyphs, ...glue];
}
