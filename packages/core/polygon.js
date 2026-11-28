// packages/core/polygon.js - TASK 1050: the POLYGON constraint, like Fusion 360's Polygon constraint. PURE (no DOM). THE one reader of a stored
// polygon constraint: the record (constraints.js createConstraint: load, undo, paste), the solver rows (solver/definitions.js) and the verifier
// (constraint-verifier.js) all go through the functions here; the maker is shapes.js makePolygon.
//
// FUSION (recorded by the advisor with Fusion's own commands, ShapePolygonInscribed / Circumscribed / Edge, 6 sides; docs/RECIPE-PARITY-1037.md
// D-5): 6 lines (not construction) sharing their 6 corners, the centre a LONE point, the constraint list ["Polygon()"] and nothing else (no
// dimension, no construction line, no H / V); DOF 4: the centre (2), the size, the rotation.
//
// Stored form (constants.js CONSTRAINT_TYPES.POLYGON):
//   { type: 'polygon', joints: [centre, v0, v1, ..., v(N-1)], shapes: [side0, ..., side(N-1)] }
//   The corners in order of increasing WORLD angle about the centre (makePolygon: world y runs down, so clockwise on screen); side i runs from
//   v(i) to v(i+1), the last one back to v0. The rows read the joints only; the sides name the curves the constraint belongs to (a deleted side
//   takes the constraint with it: #core/delete-manager.js removeGeometry, the generic rule for a constraint naming a deleted shape).
//
// THE rule: a REGULAR N-gon about the centre: every corner is the first one turned about the centre by i 2 pi / N:
//   v(i) - c - R(2 pi i / N) (v0 - c) = 0,   i = 1 .. N-1   (two rows each, x and y; R(t) the world rotation [[cos, -sin], [sin, cos]])
// so the corners lie on one circle about the centre and are evenly spaced. EQUATION COUNT: 2 (N - 1) rows over the 2 (N + 1) unknowns of the
// centre and the corners. The rows are LINEAR in the joints and each v(i), i >= 1, appears in its own two rows only, with the identity: they are
// independent wherever the polygon is (rank 2 (N - 1): the solver is never fed a redundant row) and leave exactly 4 degrees of freedom, the
// centre (2), the size and the rotation (v0 about the centre), Fusion's 4.

import { CONSTRAINT_TYPES } from './constants.js';

const isId = (j) => typeof j === 'string' && j.length > 0;

/** The stored record of a polygon constraint from its params (a new one, or a saved / undone / pasted one), or null when it is not one: a
 *  centre and at least 3 distinct corners, and one side per corner. Fields in this one order (byte-stable saves). */
export function polygonConstraintRecord(params) {
  const joints = params && params.joints, shapes = params && params.shapes;
  if (!Array.isArray(joints) || joints.length < 4 || !joints.every(isId) || new Set(joints).size !== joints.length) return null;
  if (!Array.isArray(shapes) || shapes.length !== joints.length - 1 || !shapes.every(isId)) return null;
  return { type: CONSTRAINT_TYPES.POLYGON, joints: joints.slice(), shapes: shapes.slice() };
}

/** The solver rows of a stored polygon constraint: 2 (N - 1) for N corners (0 when it is not a polygon record). */
export function polygonRowCount(c) {
  return Array.isArray(c && c.joints) && c.joints.length >= 4 ? 2 * (c.joints.length - 2) : 0;
}

/** The turn of corner i of an N-gon (radians, world): i 2 pi / N. */
export const polygonCornerTurn = (i, n) => (2 * Math.PI * i) / n;

/**
 * THE rows' values (world units), the ONE formula the solver (dense joint indices) and the verifier (joint ids) read: `refs` = [centre, v0, ...,
 * v(N-1)], `at(ref)` -> { x, y }. [row x of v1, row y of v1, ..., row x of v(N-1), row y of v(N-1)].
 */
export function polygonRowValues(refs, at) {
  const n = refs.length - 1, c = at(refs[0]), v0 = at(refs[1]);
  const dx = v0.x - c.x, dy = v0.y - c.y;
  const out = [];
  for (let i = 1; i < n; i++) {
    const t = polygonCornerTurn(i, n), cos = Math.cos(t), sin = Math.sin(t), v = at(refs[i + 1]);
    out.push(v.x - c.x - (cos * dx - sin * dy), v.y - c.y - (sin * dx + cos * dy));
  }
  return out;
}

/** The residual the verifier reports (world units): the largest distance of a corner from where the rule puts it (the rows' zero set). 0 when a
 *  joint is missing (nothing to measure: the delete rule removes such a constraint). */
export function polygonResidual(c, joints) {
  if (polygonRowCount(c) === 0 || !c.joints.every((id) => joints.has(id))) return 0;
  const r = polygonRowValues(c.joints, (id) => joints.get(id));
  let worst = 0;
  for (let k = 0; k + 1 < r.length; k += 2) worst = Math.max(worst, Math.hypot(r[k], r[k + 1]));
  return worst;
}
