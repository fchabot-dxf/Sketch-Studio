// Translates the Trapezoid calculator's computed board geometry (packages/core/frame-geometry.js's
// calculateQuadFrameGeometry output) into a real Sketch-Studio document: per board, 4 FIXED joints + 4
// line shapes forming a closed loop (mirrors tests/harness/sketch.js's engine.addJoint/addShape calls).
// The calculator's own math is authoritative for board POSITIONS this cycle (joints stay fixed:true —
// unlocking them for free-drag re-solve is explicitly out of scope); dimension CONSTRAINTS on top of
// that fixed geometry (attachFrameDimensions, below) are what's actually editable/deletable, through
// the SAME dimension UI every other constraint in the app already uses (ConstraintManager.createConstraint
// -- no special-cased/locked variant).

import { ConstraintManager } from '#core/constraint-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

const MM_PER_INCH = 25.4; // the calculator works in inches; #core's world unit is mm (matches Shaper/
// SketchStudio's own base-mm convention, so shaper-export.js's mm-canonical SVG output stays correct).

/**
 * Clears any existing joints/shapes/constraints from `state` (keeps it idempotent across re-entries —
 * defensive even though main.js only calls this once, on first toggle to the Sketch view) and builds
 * one closed 4-line loop per board in `geom.boards`.
 *
 * @returns {Array<{boardIndex:number, cutList:object, jointIds:{p1,p2,p3,p4}, shapeIds:{p1p2,p2p3,p3p4,p4p1}}>}
 *   per-board id maps, for attachFrameDimensions to wire real dimension constraints onto.
 */
export function buildFrameSketch({ state, engine }, geom) {
  for (const id of [...state.joints.keys()]) if (id !== 'j_origin') state.joints.delete(id);
  state.shapes.length = 0;
  state.constraints.length = 0;

  const boardsOut = [];
  geom.boards.forEach((board, boardIndex) => {
    const jointIds = {};
    for (const key of ['p1', 'p2', 'p3', 'p4']) {
      const pt = board[key];
      const id = engine.genJ();
      engine.addJoint(id, pt.x * MM_PER_INCH, pt.y * MM_PER_INCH, true); // fixed:true — see file header
      jointIds[key] = id;
    }
    const edges = [['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p1']];
    const shapeIds = {};
    for (const [a, b] of edges) {
      const shapeId = 's_' + jointIds[a] + '_' + jointIds[b];
      engine.addShape({ id: shapeId, type: 'line', joints: [jointIds[a], jointIds[b]] });
      shapeIds[a + b] = shapeId;
    }
    boardsOut.push({ boardIndex, cutList: geom.cutList[boardIndex], jointIds, shapeIds });
  });
  return boardsOut;
}

// Signed angle (degrees, atan2 convention) from vector a->b to vector c->d — matches
// packages/core/solver/definitions.js's `angle` residual exactly (r = cross·cosθ − dot·sinθ, zero at
// θ = atan2(cross,dot)), so a constraint created with THIS as its value is satisfied (residual 0) at
// creation — the same "value = the current measured value" convention every other dimension in the
// app uses when a user adds one by hand (e.g. dimension-tool.js's line case: value: getDist(j1,j2)).
function signedAngleDeg(state, aId, bId, cId, dId) {
  const a = state.joints.get(aId), b = state.joints.get(bId);
  const c = state.joints.get(cId), d = state.joints.get(dId);
  const ux = b.x - a.x, uy = b.y - a.y;
  const vx = d.x - c.x, vy = d.y - c.y;
  const cross = ux * vy - uy * vx, dot = ux * vx + uy * vy;
  return Math.atan2(cross, dot) * 180 / Math.PI;
}

/**
 * Wires REAL dimension constraints onto the boards buildFrameSketch() just built — the same
 * ConstraintManager.createConstraint call the app's own dimension tool makes, so every dimension is
 * fully editable/deletable/toggleable-to-driving through the ordinary dimension UI (no locked
 * annotation layer). Per board: one DISTANCE on the outer/long edge (cutList.maxLen, the board's cut
 * length) and two ANGLE constraints, one per end, representing that end's saw-gauge cut (the angle
 * between the long edge and that end's cut edge). Since the joints are fixed and the value passed is
 * the CURRENT measured value (not independently re-derived from cutList's gauge formula), every
 * constraint is created already-satisfied — editing any of them afterward is what actually drives a
 * re-solve.
 */
export function attachFrameDimensions({ state }, boardsOut) {
  for (const { jointIds, shapeIds, cutList } of boardsOut) {
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
      joints: [jointIds.p1, jointIds.p2],
      value: MM_PER_INCH * cutList.maxLen,
      dimMode: 'auto',
    }, { source: 'frame-calc' });

    // Start-end saw gauge: angle between the long edge (p1->p2) and the start-end cut edge (p4->p1).
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.ANGLE, {
      shapes: [shapeIds.p1p2, shapeIds.p4p1],
      value: signedAngleDeg(state, jointIds.p1, jointIds.p2, jointIds.p4, jointIds.p1),
    }, { source: 'frame-calc' });

    // End-end saw gauge: angle between the long edge (p1->p2) and the end-end cut edge (p2->p3).
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.ANGLE, {
      shapes: [shapeIds.p1p2, shapeIds.p2p3],
      value: signedAngleDeg(state, jointIds.p1, jointIds.p2, jointIds.p2, jointIds.p3),
    }, { source: 'frame-calc' });
  }
}
