// tests/trim-break.test.js — Unit tests for Trim and Break geometry tools
import assert from 'node:assert/strict';
import { trimShape } from '../packages/core/trim.js';
import { breakShape, lineParamAtPoint } from '../packages/core/break.js';

console.log('Testing Break Tool...');
{
  // Segment: (0, 0) to (100, 0)
  const joints = new Map([
    ['j1', { x: 0, y: 0 }],
    ['j2', { x: 100, y: 0 }]
  ]);
  const shapes = [
    { id: 'line1', type: 'line', joints: ['j1', 'j2'] }
  ];
  const state = {
    joints,
    shapes,
    genJ: () => 'j_mid'
  };

  // Break at t = 0.4
  const res = breakShape(state, 'line1', 0.4);
  assert(res !== null, 'breakShape should return result');
  assert.equal(res.midJointId, 'j_mid');
  assert.equal(res.newShapeId, 'Lbrk_j_mid_j2');

  // Verify joints
  assert.equal(state.joints.size, 3);
  const midJ = state.joints.get('j_mid');
  assert.equal(midJ.x, 40);
  assert.equal(midJ.y, 0);

  // Verify shapes
  assert.equal(state.shapes.length, 2);
  const orig = state.shapes.find(s => s.id === 'line1');
  const created = state.shapes.find(s => s.id === 'Lbrk_j_mid_j2');
  assert.deepEqual(orig.joints, ['j1', 'j_mid']);
  assert.deepEqual(created.joints, ['j_mid', 'j2']);
  console.log('  ✓ Break at t=0.4 splits line into two connected segments');
}

console.log('Testing Trim Tool - X Crossing...');
{
  // Horizontal line: (-50, 0) to (50, 0)
  // Vertical line:   (0, -50) to (0, 50)
  // Intersection at (0, 0), which is t = 0.5 on both lines.
  const joints = new Map([
    ['jH1', { x: -50, y: 0 }],
    ['jH2', { x: 50, y: 0 }],
    ['jV1', { x: 0, y: -50 }],
    ['jV2', { x: 0, y: 50 }]
  ]);
  const shapes = [
    { id: 'lineH', type: 'line', joints: ['jH1', 'jH2'] },
    { id: 'lineV', type: 'line', joints: ['jV1', 'jV2'] }
  ];
  let genCount = 1;
  const state = {
    joints,
    shapes,
    genJ: () => 'j_trim_' + (genCount++)
  };

  // Click on the right half of horizontal line: (25, 0) -> t = 0.75 in interval [0.5, 1.0]
  const clickPt = { x: 25, y: 0 };
  const res = trimShape(state, 'lineH', clickPt);
  assert(res !== null, 'trimShape should succeed');
  assert.deepEqual(res.added, ['lineH']);

  // The line should now run from jH1 to the new trim joint at (0, 0)
  const trimmedLine = state.shapes.find(s => s.id === 'lineH');
  assert(trimmedLine, 'lineH still exists');
  const [startId, endId] = trimmedLine.joints;
  assert.equal(startId, 'jH1');
  const endJ = state.joints.get(endId);
  assert(Math.abs(endJ.x - 0) < 1e-4, 'Trimmed end x should be 0');
  assert(Math.abs(endJ.y - 0) < 1e-4, 'Trimmed end y should be 0');
  console.log('  ✓ Trim trailing interval truncates line at intersection');
}

console.log('Testing Trim Tool - 2 Intersecting Lines (Interior Trim)...');
{
  // Horizontal line from (0, 0) to (100, 0)
  // Vertical line 1 at x = 30: (30, -10) to (30, 10)
  // Vertical line 2 at x = 70: (70, -10) to (70, 10)
  // Clicking at (50, 0) should trim the interior interval [30, 70]
  const joints = new Map([
    ['jH1', { x: 0, y: 0 }],
    ['jH2', { x: 100, y: 0 }],
    ['jV1_a', { x: 30, y: -10 }],
    ['jV1_b', { x: 30, y: 10 }],
    ['jV2_a', { x: 70, y: -10 }],
    ['jV2_b', { x: 70, y: 10 }]
  ]);
  const shapes = [
    { id: 'lineH', type: 'line', joints: ['jH1', 'jH2'] },
    { id: 'lineV1', type: 'line', joints: ['jV1_a', 'jV1_b'] },
    { id: 'lineV2', type: 'line', joints: ['jV2_a', 'jV2_b'] }
  ];
  let genCount = 1;
  const state = {
    joints,
    shapes,
    genJ: () => 'j_itrim_' + (genCount++)
  };

  const clickPt = { x: 50, y: 0 };
  const res = trimShape(state, 'lineH', clickPt);
  assert(res !== null, 'Interior trim should succeed');

  // Should have split into left segment (0..30) and right segment (70..100)
  const left = state.shapes.find(s => s.id === 'lineH');
  const right = state.shapes.find(s => s.id.startsWith('Ltrm_'));
  assert(left && right, 'Both left and right segments must exist');

  const jLeftEnd = state.joints.get(left.joints[1]);
  const jRightStart = state.joints.get(right.joints[0]);
  assert(Math.abs(jLeftEnd.x - 30) < 1e-4, 'Left segment ends at x=30');
  assert(Math.abs(jRightStart.x - 70) < 1e-4, 'Right segment starts at x=70');
  console.log('  ✓ Interior trim deletes segment between two intersections');
}

console.log('\nAll Trim and Break tests passed! ✅');
