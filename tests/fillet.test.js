import assert from 'node:assert';
import { makeRectFromTwoJoints } from '../packages/core/shapes.js';
import { findCornerAtJoint, findCornerAtPoint, calculateFilletGeometry, applyFillet } from '../packages/core/fillet.js';
import { findLoops } from '../packages/core/loop-finder.js';
import { loopToPathD } from '../packages/core/shaper-export.js';

console.log('Running tests for packages/core/fillet.js...');

// 1. Test geometry calculation
{
  const pA = { x: 50, y: 0 };
  const cornerPt = { x: 0, y: 0 };
  const pB = { x: 0, y: 50 };

  const geom = calculateFilletGeometry(pA, cornerPt, pB, 10);
  assert(geom.valid, 'Geometry should be valid for 90-deg corner');
  assert(Math.abs(geom.radius - 10) < 1e-4, 'Radius should be 10');
  assert(Math.abs(geom.d - 10) < 1e-4, 'd should be 10 for 90-deg corner');
  assert(Math.abs(geom.tA.x - 10) < 1e-4 && Math.abs(geom.tA.y - 0) < 1e-4, 'tA should be at (10, 0)');
  assert(Math.abs(geom.tB.x - 0) < 1e-4 && Math.abs(geom.tB.y - 10) < 1e-4, 'tB should be at (0, 10)');
  assert(Math.abs(geom.centerPt.x - 10) < 1e-4 && Math.abs(geom.centerPt.y - 10) < 1e-4, 'centerPt should be at (10, 10)');

  // Collinear lines check
  const collinear = calculateFilletGeometry({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, 5);
  assert(!collinear.valid, 'Collinear lines must not be valid');
}

// 2. Test applyFillet on a real sketch rectangle
{
  const joints = new Map();
  let jCounter = 0;
  const genJ = () => 'j_test_' + (++jCounter);

  const j1 = genJ();
  const j3 = genJ();
  joints.set(j1, { x: 0, y: 0, fixed: true });
  joints.set(j3, { x: 80, y: 60, fixed: false });

  const { shapes, constraints } = makeRectFromTwoJoints(joints, j1, j3, genJ);
  const state = { joints, shapes, constraints };

  // Detect corner near (80, 0)
  const corner = findCornerAtPoint(state, { x: 80, y: 0 }, 10);
  assert(corner, 'Should find corner near (80, 0)');

  const result = applyFillet(state, corner, 12);
  assert(result && result.success, 'applyFillet should succeed');
  assert.strictEqual(result.radius, 12, 'Radius should match');

  // Verify loop and export
  const loops = findLoops(state);
  assert.strictEqual(loops.length, 1, 'Should have 1 closed loop');

  const pathD = loopToPathD(loops[0], state);
  assert(pathD.includes(' A '), 'Exported path must include an arc segment');
  assert(pathD.includes('A 12 12'), 'Arc segment must have radius 12');
}

// 3. Fillet carries a live driving RADIUS dimension; editing it re-solves the arc
{
  const { createNewtonSolver } = await import('../packages/core/solver/engine.js');
  const joints = new Map();
  let n = 0; const genJ = () => 'j_t3_' + (++n);
  const a = genJ(), b = genJ();
  joints.set(a, { x: 0, y: 0, fixed: false }); // unfixed: the case that used to refuse every edit
  joints.set(b, { x: 80, y: 60, fixed: false });
  const { shapes, constraints } = makeRectFromTwoJoints(joints, a, b, genJ);
  const state = { joints, shapes, constraints };
  const res = applyFillet(state, findCornerAtPoint(state, { x: 80, y: 0 }, 10), 7);
  const rc = constraints.find(c => c.type === 'distance' && c.isRadius && c.shape === res.arc.id);
  assert(rc, 'fillet must add a radius dimension on the new arc');
  assert.strictEqual(rc.value, 7, 'radius dimension carries the fillet radius');
  assert.strictEqual(rc.isDriven, false, 'radius dimension is driving');
  assert.strictEqual(res.radiusConstraint, rc, 'result exposes the constraint for the inline input');
  assert.strictEqual(res.arc.radius, undefined, 'arc must not carry a stale scalar radius');

  // Editing the dimension re-solves the arc to the new radius
  state.engine = createNewtonSolver(joints, constraints, shapes, {});
  const { commitDimensionEdit } = await import('../packages/ui/dimension-seams.js');
  const r = commitDimensionEdit(state, rc, 12);
  assert.strictEqual(r.reverted, false, 'edit must converge: ' + r.clash);
  const [cj, sj] = res.arc.joints;
  const dist = Math.hypot(joints.get(cj).x - joints.get(sj).x, joints.get(cj).y - joints.get(sj).y);
  assert(Math.abs(dist - 12) < 1e-3, 'arc radius re-solved to 12, got ' + dist);
}

console.log('✅ All fillet core tests passed!');
