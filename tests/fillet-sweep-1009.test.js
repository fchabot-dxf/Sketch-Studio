// tests/fillet-sweep-1009.test.js -- TASK 1009 (NEW-11): applyFillet must set explicit boolean `sweep` matching arcSweepInfo(center, tA, tB).dir > 0.
import assert from 'node:assert';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { arcSweepInfo } from '#core/geometry.js';
import { mirrorObjects } from '#core/mirror.js';

function makeCornerState(pA, pB, pC) {
  let n = 0;
  const state = {
    joints: new Map(),
    shapes: [],
    constraints: [],
    sketches: [{ id: 'sketch-1', visible: true }],
    activeSketchId: 'sketch-1',
    genJ: () => 'j_m_' + (++n),
  };
  state.joints.set('j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' });
  state.joints.set('a', { x: pA[0], y: pA[1], fixed: false, sketchId: 'sketch-1' });
  state.joints.set('b', { x: pB[0], y: pB[1], fixed: false, sketchId: 'sketch-1' });
  state.joints.set('c', { x: pC[0], y: pC[1], fixed: false, sketchId: 'sketch-1' });
  state.shapes.push(
    { id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' },
    { id: 'L2', type: 'line', joints: ['b', 'c'], sketchId: 'sketch-1' },
  );
  return state;
}

// 1. CCW and CW corners produce opposite explicit boolean sweep values matching arcSweepInfo
for (const [label, pts] of [
  ['CCW corner', [[0, 0], [50, 0], [50, 50]]],
  ['CW corner', [[0, 0], [50, 0], [50, -50]]],
]) {
  const state = makeCornerState(...pts);
  const corner = findCornerAtJoint(state, 'b');
  const res = applyFillet(state, corner, 10);
  assert.ok(res && res.success, `${label}: applyFillet succeeded`);
  const arc = state.shapes.find((s) => s.type === 'arc');
  assert.ok(arc, `${label}: fillet arc created`);
  assert.strictEqual(typeof arc.sweep, 'boolean', `${label}: fillet arc must carry boolean sweep (got ${typeof arc.sweep}: ${arc.sweep})`);
  const [c, s, e] = arc.joints.map((id) => state.joints.get(id));
  const expected = arcSweepInfo(c, s, e).dir > 0;
  assert.strictEqual(arc.sweep, expected, `${label}: fillet arc.sweep matches arcSweepInfo dir (${expected})`);
}

// 2. Mirroring a fillet arc carries opposite boolean sweep (mirror.js)
{
  const state = makeCornerState([20, 0], [50, 0], [50, 50]);
  state.joints.set('m1', { x: 0, y: -50, fixed: true, sketchId: 'sketch-1' });
  state.joints.set('m2', { x: 0, y: 50, fixed: true, sketchId: 'sketch-1' });
  state.shapes.push({ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true, sketchId: 'sketch-1' });
  const fr = applyFillet(state, findCornerAtJoint(state, 'b'), 10);
  assert.ok(fr && fr.success);
  const srcArc = state.shapes.find((s) => s.type === 'arc');
  const mr = mirrorObjects(state, { shapes: [srcArc.id], joints: [] }, 'ML');
  assert.ok(mr && mr.ok);
  const mirArc = state.shapes.find((s) => s.type === 'arc' && s.id !== srcArc.id);
  assert.ok(mirArc, 'mirrored fillet arc exists');
  assert.strictEqual(typeof mirArc.sweep, 'boolean', `mirrored fillet arc carries boolean sweep (got ${mirArc.sweep})`);
  assert.strictEqual(mirArc.sweep, !srcArc.sweep, 'mirrored fillet arc flips sweep direction');
}

console.log('fillet-sweep-1009.test.js PASSED');
