// tests/fillet-no-cusp-drag-1009.test.js -- TASK 1009 (UX-05): dragging a corner with a fillet past 180 deg or shrinking
// a free-radius fillet keeps the fillet arc tangent on its original smooth side (no cusp fold, sweep > 180 deg when corner opens reflex).
import assert from 'node:assert';
import * as ops from '#core/tool-ops.js';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { createNewtonSolver } from '#core/solver/engine.js';
import { arcSweepInfo } from '#core/geometry.js';
import { deleteConstraints } from '#core/delete-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { measureResidual } from '#core/constraint-verifier.js';

function dragJointSteps(state, jid, tx, ty, steps = 25) {
  const j = state.joints.get(jid);
  const x0 = j.x, y0 = j.y;
  for (let k = 1; k <= steps; k++) {
    const x = x0 + (tx - x0) * k / steps;
    const y = y0 + (ty - y0) * k / steps;
    j.dragTarget = { x, y };
    state.engine.solve(500, { dragTarget: { jointId: jid, x, y, stiffness: 1e4 } });
  }
  delete j.dragTarget;
  return state.engine.solve(500);
}

function filletTravels(state, arc, lineA, lineB) {
  const [c, s, e] = arc.joints.map((id) => state.joints.get(id));
  const dir = arcSweepInfo(c, s, e, { sweep: arc.sweep }).dir;
  const farA = state.joints.get(lineA.joints.find((j) => j !== arc.joints[1]));
  const farB = state.joints.get(lineB.joints.find((j) => j !== arc.joints[2]));
  const rA = { x: s.x - c.x, y: s.y - c.y }, dA = { x: s.x - farA.x, y: s.y - farA.y };
  const rB = { x: e.x - c.x, y: e.y - c.y }, dB = { x: e.x - farB.x, y: e.y - farB.y };
  return [
    dir * (rA.x * dA.y - rA.y * dA.x) / Math.hypot(dA.x, dA.y),
    -dir * (rB.x * dB.y - rB.y * dB.x) / Math.hypot(dB.x, dB.y),
  ];
}

// 1. DR4.2b-style: R10 fillet on a(0,0)[fixed] - b(50,0) - c(50,50) dragged past 180 deg to (95, -15)
{
  const state = {
    joints: new Map([
      ['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['a', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
      ['b', { x: 50, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c', { x: 50, y: 50, fixed: false, sketchId: 'sketch-1' }],
    ]),
    shapes: [
      { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 'sketch-1' },
    ],
    constraints: [
      { type: CONSTRAINT_TYPES.HORIZONTAL, joints: ['a', 'b'] },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 50 },
      { type: CONSTRAINT_TYPES.DISTANCE, joints: ['b', 'c'], value: 50 },
    ],
    sketches: [{ id: 'sketch-1', visible: true }],
    activeSketchId: 'sketch-1',
  };
  const fr = applyFillet(state, findCornerAtJoint(state, 'b'), 10);
  assert.ok(fr && fr.success, 'DR4.2b fillet created');
  assert.strictEqual(typeof fr.arc.sweep, 'boolean', 'fillet arc carries explicit sweep');
  state.engine = createNewtonSolver(state.joints, state.constraints, state.shapes, {});
  dragJointSteps(state, 'c', 99, 5, 25);
  const res = dragJointSteps(state, 'c', 95, -15, 25);
  assert.ok(res.converged, 'DR4.2b past-180 solve converged');
  const [c, s, e] = fr.arc.joints.map((id) => state.joints.get(id));
  const spanDeg = arcSweepInfo(c, s, e, { sweep: fr.arc.sweep }).span * 180 / Math.PI;
  assert.ok(spanDeg > 180, `DR4.2b past-180 keeps original side and grows > 180 deg (got ${spanDeg.toFixed(2)} deg)`);
  const [tA, tB] = filletTravels(state, fr.arc, state.shapes[0], state.shapes[1]);
  assert.ok(tA > 0 && tB > 0, `DR4.2b stays smooth with no cusp (travels: ${tA.toFixed(3)}, ${tB.toFixed(3)})`);
  for (const con of state.constraints) {
    if (!con || con.driven || con.type === 'mouse_spring') continue;
    assert.ok(measureResidual(con, state.joints, state.shapes) < 1e-6);
  }
  console.log(`1 DR4.2b past-180: span=${spanDeg.toFixed(2)} deg, sweep=${fr.arc.sweep}, travels=[${tA.toFixed(3)}, ${tB.toFixed(3)}]`);
}

// 2. 6d-style: free-radius fillet under inward drag must NOT invert into a cusp
{
  let n = 0;
  const state = {
    joints: new Map([['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]]),
    shapes: [],
    constraints: [],
    sketches: [{ id: 'sketch-1', visible: true }],
    activeSketchId: 'sketch-1',
    genJ: () => 'jf_' + (++n),
  };
  state.engine = createNewtonSolver(state.joints, state.constraints, state.shapes, {});
  const rect = ops.rect(state, 0, 0, 60, 40);
  const fil = ops.fillet(state, rect.top, rect.right, 10);
  const rDim = state.constraints.find((c) => c.isRadius && c.shape === fil.arc);
  deleteConstraints(state, [rDim]);
  const arc = state.shapes.find((s) => s.id === fil.arc);
  const lTop = state.shapes.find((s) => s.id === rect.top);
  const lRight = state.shapes.find((s) => s.id === rect.right);
  const rightTop = lRight.joints[0];
  const jRT = state.joints.get(rightTop);
  dragJointSteps(state, rightTop, jRT.x - 45, jRT.y, 15);
  const [tA, tB] = filletTravels(state, arc, lTop, lRight);
  assert.ok(tA > 0 && tB > 0, `6d free-R fillet stays on smooth side (travels: ${tA.toFixed(4)}, ${tB.toFixed(4)})`);
  console.log(`2 6d free-R fillet drag: travels=[${tA.toFixed(4)}, ${tB.toFixed(4)}]`);
}

// 3. Fusion live (a) scenario: L1(-6,0)-(-2,0), L2(-2,0)-(-2,4), free r=0.6, L2 far end dragged past straight to lower-right
{
  const state = {
    joints: new Map([
      ['p1', { x: -6, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['c', { x: -2, y: 0, fixed: false, sketchId: 'sketch-1' }],
      ['p2', { x: -2, y: 4, fixed: false, sketchId: 'sketch-1' }],
    ]),
    shapes: [
      { id: 'L1', type: 'line', joints: ['p1', 'c'], sketchId: 'sketch-1' },
      { id: 'L2', type: 'line', joints: ['c', 'p2'], sketchId: 'sketch-1' },
    ],
    constraints: [],
    sketches: [{ id: 'sketch-1', visible: true }],
    activeSketchId: 'sketch-1',
  };
  const fr = applyFillet(state, findCornerAtJoint(state, 'c'), 0.6);
  state.constraints = state.constraints.filter((con) => !(con.type === 'distance' && con.isRadius));
  state.engine = createNewtonSolver(state.joints, state.constraints, state.shapes, {});
  const res = dragJointSteps(state, 'p2', 2, -4, 40);
  assert.ok(res.converged, 'Fusion (a) solve converged');
  const [c, s, e] = fr.arc.joints.map((id) => state.joints.get(id));
  const spanDeg = arcSweepInfo(c, s, e, { sweep: fr.arc.sweep }).span * 180 / Math.PI;
  const [tA, tB] = filletTravels(state, fr.arc, state.shapes[0], state.shapes[1]);
  assert.ok(spanDeg > 180, `Fusion (a) sweep grows > 180 deg (got ${spanDeg.toFixed(2)} deg)`);
  assert.ok(tA > 0 && tB > 0, `Fusion (a) no cusp (travels: ${tA.toFixed(3)}, ${tB.toFixed(3)})`);
  console.log(`3 Fusion (a) free fillet: span=${spanDeg.toFixed(2)} deg, r=${Math.hypot(s.x - c.x, s.y - c.y).toFixed(3)}, travels=[${tA.toFixed(3)}, ${tB.toFixed(3)}]`);
}

console.log('fillet-no-cusp-drag-1009.test.js PASSED');
