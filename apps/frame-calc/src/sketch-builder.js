// Translates the Trapezoid calculator's computed board geometry (packages/core/frame-geometry.js's
// calculateQuadFrameGeometry output) into a real Sketch-Studio document: per board, 4 FIXED joints + 4
// line shapes forming a closed loop (mirrors tests/harness/sketch.js's engine.addJoint/addShape calls).
// The calculator's own math is authoritative for board POSITIONS this cycle (joints stay fixed:true —
// unlocking them for free-drag re-solve is explicitly out of scope); dimension CONSTRAINTS on top of
// that fixed geometry are what's actually editable (added by attachFrameDimensions, a later step).

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
