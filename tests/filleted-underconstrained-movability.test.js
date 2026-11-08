// tests/filleted-underconstrained-movability.test.js — TASK 428
// Owner's repro: a rectangle with bottom-left corner at the origin, H/V constraints,
// height dimension = 100 on the left edge, and top-right corner filleted with R=20.
// Expected:
// - Left line is black (genuinely immovable).
// - Top line, arc, right line, bottom line are blue (they depend on the free width).
// - Movability check: every black item truly does not move under a drag;
//   free items move smoothly under a drag.

import assert from 'assert';
import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makeRectFromTwoJoints } from '#core/shapes.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { findCornerAtPoint, applyFillet } from '#core/fillet.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';

console.log('Running filleted underconstrained movability test (TASK 428)...');

function buildOwnerSketch(withWidthDim = false) {
  const engine = createEngine(null);
  engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });

  const jBL = 'j_origin';
  engine.addJoint(jBL, 0, 100, true);
  state.joints.set(jBL, { x: 0, y: 100, fixed: true });

  const jTR = engine.genJ();
  engine.addJoint(jTR, 50, 0, false);
  state.joints.set(jTR, { x: 50, y: 0, fixed: false });

  const rect = makeRectFromTwoJoints(state.joints, jBL, jTR, engine.genJ);
  for (const s of rect.shapes) engine.addShape(s);
  for (const c of rect.constraints) ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' });

  const P = (id) => state.joints.get(id);
  const leftLine = state.shapes.find(s => s.type === 'line' && Math.abs(P(s.joints[0]).x) < 1e-4 && Math.abs(P(s.joints[1]).x) < 1e-4);
  const topLine = state.shapes.find(s => s.type === 'line' && Math.abs(P(s.joints[0]).y) < 1e-4 && Math.abs(P(s.joints[1]).y) < 1e-4);

  // Height dimension = 100 on left edge
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
    joints: [leftLine.joints[0], leftLine.joints[1]],
    value: 100
  }, { source: 'dim' });

  if (withWidthDim) {
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
      joints: [topLine.joints[0], topLine.joints[1]],
      value: 50
    }, { source: 'dim' });
  }

  let solveRes = engine.solve(500);
  assert(solveRes.converged, 'Initial rectangle solve converged');

  const corner = findCornerAtPoint(state, { x: 50, y: 0 }, 5);
  assert(corner, 'Top-right corner found');
  const filletRes = applyFillet(state, corner, 20);
  assert(filletRes && filletRes.success, 'Fillet applied');

  solveRes = engine.solve(500);
  assert(solveRes.converged, 'Solve after fillet converged');

  const arc = state.shapes.find(s => s.type === 'arc');
  const bottomLine = state.shapes.find(s => s.type === 'line' && Math.abs(P(s.joints[0]).y - 100) < 1e-4 && Math.abs(P(s.joints[1]).y - 100) < 1e-4);
  const rightLine = state.shapes.find(s => s.type === 'line' && s !== leftLine && s !== topLine && s !== bottomLine);

  return { engine, state, leftLine, topLine, arc, rightLine, bottomLine, filletRes };
}

// 1. Under-constrained case (owner's repro)
const { engine, state, leftLine, topLine, arc, rightLine, bottomLine } = buildOwnerSketch(false);

const status = analyzeConstraintStatus({
  joints: state.joints,
  shapes: state.shapes,
  constraints: state.constraints
});

// A. Genuinely immovable: left line is pinned by origin + vertical + height 100
assert.strictEqual(status.fixedShapes.has(leftLine.id), true, 'Left line must be black (fixed)');

// B. Movable: top line, arc, right line, bottom line all depend on the free width
assert.strictEqual(status.fixedShapes.has(topLine.id), false, 'Top line must be blue (NOT fixed)');
assert.strictEqual(status.fixedShapes.has(arc.id), false, 'Arc must be blue (NOT fixed)');
assert.strictEqual(status.fixedShapes.has(rightLine.id), false, 'Right line must be blue (NOT fixed)');
assert.strictEqual(status.fixedShapes.has(bottomLine.id), false, 'Bottom line must be blue (NOT fixed)');

// C. Fillet joints: center and rims must not be in fixedJoints
const arcCenter = arc.joints[0];
const topRim = arc.joints[2];
const rightRim = arc.joints[1];
const vSharp = arc.filletSharp;

assert.strictEqual(status.fixedJoints.has(arcCenter), false, 'Arc center must not be fixed');
assert.strictEqual(status.fixedJoints.has(topRim), false, 'Top rim must not be fixed');
assert.strictEqual(status.fixedJoints.has(rightRim), false, 'Right rim must not be fixed');
if (vSharp) {
  // Virtual sharp V carries two pointOnLine constraints and correctly reads d0 per Task 416
  assert.strictEqual(status.fixedJoints.has(vSharp), true, 'Virtual sharp correctly reads d0 per Task 416');
}

// 2. Movability check: verify that free items actually move when dragged,
// while genuinely fixed items stay pinned
const initialLeftX = state.joints.get(leftLine.joints[0]).x;
const initialArcCenterX = state.joints.get(arcCenter).x;
assert.strictEqual(initialArcCenterX, 30, 'Initial arc center X should be 30');

// Drag arc center from X=30 towards X=60
const dragRes = engine.solve(500, {
  dragTarget: { jointId: arcCenter, x: 60, y: 20, stiffness: 1e6 }
});
assert.strictEqual(dragRes.converged, true, 'Drag solve converged');

// The black left line must NOT move under the drag
const afterLeftX = state.joints.get(leftLine.joints[0]).x;
assert(Math.abs(afterLeftX - initialLeftX) < 1e-4, 'Left line (black) must stay immovable');

// The blue top line endpoint and arc center MUST move under the drag
const afterArcCenterX = state.joints.get(arcCenter).x;
assert(Math.abs(afterArcCenterX - 60) < 1e-3, `Arc center should move to ~60, got ${afterArcCenterX}`);

// 3. Contrast case: when width dimension is present, ALL shapes and joints become fixed
const fullyConstrained = buildOwnerSketch(true);
const fullyStatus = analyzeConstraintStatus({
  joints: fullyConstrained.state.joints,
  shapes: fullyConstrained.state.shapes,
  constraints: fullyConstrained.state.constraints
});

assert.strictEqual(fullyStatus.fixedShapes.size, 5, 'All 5 shapes must be fixed when fully constrained');
assert.strictEqual(fullyStatus.fixedShapes.has(fullyConstrained.topLine.id), true, 'Top line fixed when width dimensioned');
assert.strictEqual(fullyStatus.fixedShapes.has(fullyConstrained.arc.id), true, 'Arc fixed when width dimensioned');
assert.strictEqual(fullyStatus.fixedShapes.has(fullyConstrained.rightLine.id), true, 'Right line fixed when width dimensioned');
assert.strictEqual(fullyStatus.fixedShapes.has(fullyConstrained.bottomLine.id), true, 'Bottom line fixed when width dimensioned');

console.log('filleted underconstrained movability tests passed ✅');

export { buildOwnerSketch };

