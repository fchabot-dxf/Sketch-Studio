// tests/constraint-targets-820.test.js -- TASK 820: a joints-only constraint lights only the shape(s) holding ALL its joints.
import assert from 'node:assert';
import { constraintTargets } from '../packages/ui/geometry-labels.js';

// keyhole: arc A (centre c, ends p, q) and two lines from the arc's ends down to the slot (p-r, q-s) + a bottom line r-s
const shapes = [
  { id: 'arc', type: 'arc', joints: ['c', 'p', 'q'] },
  { id: 'left', type: 'line', joints: ['p', 'r'] },
  { id: 'right', type: 'line', joints: ['q', 's'] },
  { id: 'bottom', type: 'line', joints: ['r', 's'] },
  { id: 'circ', type: 'circle', joints: ['cc', 'cr'] },
];
const ids = (c) => [...constraintTargets(c, shapes).shapes].sort();

assert.deepStrictEqual(ids({ type: 'vertical', joints: ['q', 's'] }), ['right'], 'vertical on the right line lights only that line');
assert.deepStrictEqual(ids({ type: 'horizontal', joints: ['r', 's'] }), ['bottom'], 'horizontal on a line sharing a joint with others');
assert.deepStrictEqual(ids({ type: 'horizontal', joints: ['q', 'c'] }), ['arc'], 'centre-to-end of an arc resolves to the arc');
assert.deepStrictEqual(ids({ type: 'vertical', joints: ['cc', 'cr'] }), ['circ'], 'a circle holding both joints');
// no shape holds all the joints: today's any-joint fallback
assert.deepStrictEqual(ids({ type: 'coincident', joints: ['p', 'r'] }), ['left'], 'coincident of one shape own two joints');
assert.deepStrictEqual(ids({ type: 'coincident', joints: ['s', 'cc'] }), ['circ', 'right', 'bottom'].sort(), 'coincident of two separate shapes lights both');
// 4 joints: resolved per pair
assert.deepStrictEqual(ids({ type: 'parallel', joints: ['p', 'r', 'q', 's'] }), ['left', 'right'], 'parallel of two lines lights those 2 lines, never the arc');
assert.deepStrictEqual(ids({ type: 'perpendicular', joints: ['q', 's', 'r', 's'] }), ['bottom', 'right'], 'perpendicular per pair');
assert.deepStrictEqual(ids({ type: 'equal', joints: ['c', 'p', 'q', 's'] }), ['arc', 'right'], 'equal of an arc radius and a line');
// a constraint naming its shape is untouched
assert.deepStrictEqual(ids({ type: 'pointOnLine', joint: 'p', shape: 'right' }), ['right']);
assert.deepStrictEqual(constraintTargets(null, shapes).shapes.size, 0);
console.log('constraint-targets-820 ok');
