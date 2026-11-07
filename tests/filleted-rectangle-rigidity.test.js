import { createEngine } from '#core/constraint-solver.js';
import { createSketchState } from '#ui/sketch-state.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makeRectFromTwoJoints } from '#core/shapes.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { findCornerAtPoint, applyFillet } from '#core/fillet.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { draw } from '#ui/svg-renderer.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

(async () => {
  console.log('Running tests for filleted rectangle rigidity (media_1794069205166_0f67a08b.jpg)...');

  // 1. Build the exact sketch from media_1794069205166_0f67a08b.jpg:
  // - Rectangle anchored at origin (0, 0)
  // - Left line: vertical, height = 100.0
  // - Top line: horizontal, width = 50.0
  // - Top-right corner filleted with R = 20.0
  // - Right line is vertical, bottom line is horizontal
  const engine = createEngine(null);
  engine.init();
  const state = createSketchState(engine, { x: 0, y: 0, w: 200, h: 200 });

  const cOrigin = 'j_origin';
  engine.addJoint(cOrigin, 0, 0, true);
  state.joints.set(cOrigin, { x: 0, y: 0, fixed: true });

  const cBottomRight = engine.genJ();
  engine.addJoint(cBottomRight, 50, 100, false);
  state.joints.set(cBottomRight, { x: 50, y: 100, fixed: false });

  const rect = makeRectFromTwoJoints(state.joints, cOrigin, cBottomRight, engine.genJ);
  for (const s of rect.shapes) {
    engine.addShape(s);
  }
  for (const c of rect.constraints) {
    ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' });
  }

  // Anchor cOrigin to the top-left of the rectangle via coincident
  const P = (id) => state.joints.get(id);
  const lineAt = (f) => state.shapes.find(sh => sh.type === 'line' && f(P(sh.joints[0]), P(sh.joints[1])));
  const top = lineAt((a, b) => Math.abs(a.y - 0) < 1e-6 && Math.abs(b.y - 0) < 1e-6);
  const left = lineAt((a, b) => Math.abs(a.x - 0) < 1e-6 && Math.abs(b.x - 0) < 1e-6);

  assert(top && left, 'Found top and left lines');

  // Add dimensions: width 50, height 100
  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
    joints: [top.joints[0], top.joints[1]],
    value: 50
  }, { source: 'dim' });

  ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
    joints: [left.joints[0], left.joints[1]],
    value: 100
  }, { source: 'dim' });

  let solveRes = engine.solve(500);
  assert(solveRes.converged, 'Initial rectangle solve converged');

  // Apply fillet with R = 20.0 at top-right corner (50, 0)
  const corner = findCornerAtPoint(state, { x: 50, y: 0 }, 5);
  assert(corner, 'Corner at (50, 0) found');

  const filletRes = applyFillet(state, corner, 20);
  assert(filletRes && filletRes.success, 'Fillet with R=20 applied successfully');
  assert(filletRes.virtualSharp, 'Virtual sharp created at (50, 0)');

  solveRes = engine.solve(500);
  assert(solveRes.converged, 'Solve after fillet converged');
  assert(!solveRes.rankDeficient, 'System is full-rank (0 DOF globally)');

  // 2. Analyze constraint status
  const status = analyzeConstraintStatus({
    joints: state.joints,
    shapes: state.shapes,
    constraints: state.constraints
  });

  // Verify all joints are recognized as rigid (DOF === 0)
  for (const [jid, j] of state.joints) {
    const dof = status.jointDOFs.get(jid);
    assert(dof === 0, `Joint ${jid} at (${j.x}, ${j.y}) should have DOF 0, got ${dof}`);
    assert(status.fixedJoints.has(jid), `Joint ${jid} should be in fixedJoints`);
  }

  // Verify all 5 shapes (4 lines + 1 arc) are in fixedShapes
  assert(state.shapes.length === 5, `Expected 5 shapes, got ${state.shapes.length}`);
  assert(status.fixedShapes.size === 5, `Expected all 5 shapes in fixedShapes, got ${status.fixedShapes.size}`);

  for (const s of state.shapes) {
    assert(status.fixedShapes.has(s.id), `Shape ${s.id} (${s.type}) must be in fixedShapes`);
  }

  // 3. Verify SVG rendering colors: all shapes MUST render in solid black (#202020)
  const svg = {
    viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } },
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    innerHTML: ''
  };

  draw(state.joints, state.shapes, svg, null, null, state.constraints);

  // Parse rendered SVG elements to confirm stroke color
  for (const s of state.shapes) {
    const escapedId = s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shapeRegex = new RegExp(`data-shape-id="${escapedId}"[^>]*style="[^"]*stroke:([^;"]*)`);
    const match = svg.innerHTML.match(shapeRegex);
    assert(match, `Rendered SVG markup for shape ${s.id} should exist`);
    const stroke = match[1].trim().toLowerCase();
    assert(stroke.includes('#202020') || stroke.includes('--sk-geo-fixed'),
      `Shape ${s.id} (${s.type}) stroke must be black (#202020 / var(--sk-geo-fixed)), got "${stroke}"`);
  }

  // 4. Contrast Case: verify that removing a dimension leaves geometry under-constrained (blue)
  // If we remove the width dimension, the right line and arc are free to slide along X
  const engineUnder = createEngine(null);
  engineUnder.init();
  const stateUnder = createSketchState(engineUnder, { x: 0, y: 0, w: 200, h: 200 });
  engineUnder.addJoint(cOrigin, 0, 0, true);
  stateUnder.joints.set(cOrigin, { x: 0, y: 0, fixed: true });
  const cBRUnder = engineUnder.genJ();
  engineUnder.addJoint(cBRUnder, 50, 100, false);
  stateUnder.joints.set(cBRUnder, { x: 50, y: 100, fixed: false });
  const rectUnder = makeRectFromTwoJoints(stateUnder.joints, cOrigin, cBRUnder, stateUnder.engine.genJ);
  for (const s of rectUnder.shapes) {
    stateUnder.engine.addShape(s);
  }
  for (const c of rectUnder.constraints) {
    ConstraintManager.createConstraint(stateUnder, c.type, c, { source: 'rect' });
  }
  // Only add height dimension, NO width dimension
  const leftUnder = stateUnder.shapes.find(sh => {
    const p1 = stateUnder.joints.get(sh.joints[0]);
    const p2 = stateUnder.joints.get(sh.joints[1]);
    return sh.type === 'line' && Math.abs(p1.x) < 1e-6 && Math.abs(p2.x) < 1e-6;
  });
  ConstraintManager.createConstraint(stateUnder, CONSTRAINT_TYPES.DISTANCE, {
    joints: [leftUnder.joints[0], leftUnder.joints[1]],
    value: 100
  }, { source: 'dim' });
  stateUnder.engine.solve(500);

  const underStatus = analyzeConstraintStatus({
    joints: stateUnder.joints,
    shapes: stateUnder.shapes,
    constraints: stateUnder.constraints
  });

  // Left line should be fixed (black)
  assert(underStatus.fixedShapes.has(leftUnder.id), 'Grounded dimensioned left line should be fixed');
  // Right line and bottom line should NOT be fixed (blue)
  assert(underStatus.fixedShapes.size < stateUnder.shapes.length, 'Under-constrained rectangle shapes should not all be fixed');

  console.log('✅ filleted-rectangle-rigidity test passed!');
})().catch(e => {
  console.error('❌ filleted-rectangle-rigidity test failed:', e);
  process.exit(1);
});
