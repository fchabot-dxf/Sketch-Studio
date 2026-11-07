import assert from 'node:assert';
import { makeRectFromTwoJoints } from '../packages/core/shapes.js';
import { findCornerAtJoint, findCornerAtPoint, calculateFilletGeometry, applyFillet, diagnoseNoFillet, defaultFilletRadius, parseFilletRadius } from '../packages/core/fillet.js';
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

// 4. TURN 401 items 2-4 (all DOM-free)
{
  // item 2: defaults live in world mm; the R-key parse is unit-aware
  assert.strictEqual(defaultFilletRadius('mm'), 5);
  assert.strictEqual(defaultFilletRadius('in'), 6.35, 'inch default is 1/4in = 6.35 mm, not 0.25 mm');
  assert(Math.abs(parseFilletRadius('0.5', 'in') - 12.7) < 1e-9, 'bare number is in the doc unit');
  assert.strictEqual(parseFilletRadius('12mm', 'in'), 12, 'a typed suffix overrides the doc unit');
  assert.strictEqual(parseFilletRadius('abc', 'mm'), null);
  assert.strictEqual(parseFilletRadius('-3', 'mm'), null, 'non-positive rejected');

  const mkRect = (W, H) => {
    const joints = new Map(); let n = 0; const g = () => 'j_t4_' + (++n);
    const a = g(), b = g();
    joints.set(a, { x: 0, y: 0, fixed: false }); joints.set(b, { x: W, y: H, fixed: false });
    const { shapes, constraints } = makeRectFromTwoJoints(joints, a, b, g);
    return { joints, shapes, constraints };
  };

  // item 3: core must not own history -- exactly one step per fillet comes from the tool layer
  const st = mkRect(80, 60);
  let saves = 0; st.saveState = () => { saves++; };
  applyFillet(st, findCornerAtPoint(st, { x: 80, y: 0 }, 5), 10);
  assert.strictEqual(saves, 0, 'applyFillet must not call saveState (tool layer owns the single undo step)');

  // owner ruling (403): NO clamp -- an oversized radius is applied as asked, even past a line's far end
  const sm = mkRect(10, 6);
  const rc = applyFillet(sm, findCornerAtPoint(sm, { x: 10, y: 0 }, 5), 50);
  assert(rc.success && rc.radius === 50 && rc.clamped === undefined, 'oversized radius is applied unclamped');
  // the single refusal: the radius whose tangent distance equals a line length would collapse that line to 0
  const sk = mkRect(60, 40);
  const col = applyFillet(sk, findCornerAtPoint(sk, { x: 60, y: 0 }, 5), 40);
  assert(col.success === false && /collapse a line to zero length/.test(col.reason), 'R = line length is refused with a message');

  // already filleted: click the tangent point of the first fillet
  const sf = mkRect(80, 60);
  const f1 = applyFillet(sf, findCornerAtPoint(sf, { x: 80, y: 0 }, 5), 10);
  assert.strictEqual(findCornerAtPoint(sf, f1.tA, 1), null, 'filleted corner is not a corner any more');
  assert.strictEqual(diagnoseNoFillet(sf, f1.tA, 1), 'This corner is already filleted');
  assert.strictEqual(diagnoseNoFillet(sf, { x: 500, y: 500 }, 5), null, 'empty space: no toast');

  // T-junction: a third line ending on a rect corner cluster
  const stj = mkRect(80, 60);
  const cj = [...stj.joints.keys()][0];
  stj.joints.set('jx', { x: stj.joints.get(cj).x - 30, y: stj.joints.get(cj).y - 30, fixed: false });
  const other = [...stj.joints.keys()].find(k => k !== cj && k !== 'jx');
  stj.shapes.push({ id: 'extra', type: 'line', joints: [cj, 'jx'] });
  assert.strictEqual(findCornerAtPoint(stj, stj.joints.get(cj), 1), null, 'three lines at a joint is not a fillet corner');
  assert(/T-junction/.test(diagnoseNoFillet(stj, stj.joints.get(cj), 1)));

  // line + arc: a corner where one member is an arc
  const sla = { joints: new Map([['p', { x: 0, y: 0 }], ['q', { x: 10, y: 0 }], ['c', { x: 0, y: 10 }], ['r', { x: 10, y: 10 }]]), shapes: [
    { id: 'L', type: 'line', joints: ['p', 'q'] }, { id: 'A', type: 'arc', joints: ['c', 'p', 'r'] }], constraints: [] };
  assert.strictEqual(diagnoseNoFillet(sla, { x: 0, y: 0 }, 1), 'Fillet needs a corner between two lines');

  // collinear -> structured failure, not a silent null
  const sc = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 10, y: 0 }], ['c', { x: 20, y: 0 }]]), shapes: [], constraints: [] };
  const bad = applyFillet(sc, { pA: { x: 0, y: 0 }, cornerPt: { x: 10, y: 0 }, pB: { x: 20, y: 0 } }, 5);
  assert(bad && bad.success === false && /collinear/i.test(bad.reason), 'invalid geometry reports its reason');
}

console.log('✅ All fillet core tests passed!');
