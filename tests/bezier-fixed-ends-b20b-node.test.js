// tests/bezier-fixed-ends-b20b-node.test.js -- B-20b (TASK 1010, BUG-134): a Bezier whose two end points are fixed is NOT "fully
// constrained" (black): its two control points are plain shape data nothing holds. A line with fixed ends still is.
import assert from 'node:assert';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { docOf, openDoc } from './fixtures/display-1010/doc-kit.js';

const app = await openDoc(docOf(
  { a: [0, 0, true], b: [60, 0, true], p: [0, 30, true], q: [60, 30, true] },
  [{ id: 'BZ', type: 'bezier', joints: ['a', 'b'], c1: [20, 20], c2: [40, -20] }, { id: 'LN', type: 'line', joints: ['p', 'q'] }],
));
try {
  app.frames(3);
  const st = analyzeConstraintStatus({ joints: app.state.joints, shapes: app.state.shapes, constraints: app.state.constraints });
  console.log('fixedShapes', JSON.stringify([...st.fixedShapes]));
  assert.ok(st.fixedShapes.has('LN'), 'a line with both ends fixed is fully constrained');
  assert.ok(!st.fixedShapes.has('BZ'), 'a bezier with both ends fixed is not (its control points are free)');
  assert.ok(!st.constrainedShapes.has('BZ'), 'nor "constrained"');
  const ink = (id) => app.svg.querySelector(`[data-shape-id="${id}"]`).getAttribute('style');
  console.log('strokes', ink('BZ'), '|', ink('LN'));
  assert.ok(/8DB84A/.test(ink('LN')) && /sk-constraint-fill/.test(ink('BZ')), 'drawn: the fixed line in its locked colour, the bezier in the free blue');
  console.log('PASS bezier-fixed-ends-b20b-node');
} finally { await app.close(); }
