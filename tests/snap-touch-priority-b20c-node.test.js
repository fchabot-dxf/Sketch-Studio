// tests/snap-touch-priority-b20c-node.test.js -- B-20c (TASK 1010, BUG-136): the joint-over-line priority radius is scaled by the touch
// boost like every other snap radius (task 562), so on a phone a point about 25 px away still beats a line right under the finger.
import assert from 'node:assert';
import { findSnap, snapBoostFor } from '#ui/snap-detection.js';
import { worldToScreen } from '#ui/coords.js';

const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }), viewBox: { baseVal: { x: 0, y: 0, width: 400, height: 400 } } };
const joints = new Map([['a', { x: 0, y: 100 }], ['b', { x: 400, y: 100 }], ['p', { x: 150, y: 125 }]]); // a line y = 100, a free point 25 px below it
const shapes = [{ id: 'L', type: 'line', joints: ['a', 'b'] }];
const at = worldToScreen(svg, { x: 151, y: 104 }); // the pointer: 4 px under the line, 21 px above the point
const mouse = snapBoostFor(false), touch = snapBoostFor(true);

const m = findSnap(joints, shapes, svg, at, [], false, false, mouse);
const t = findSnap(joints, shapes, svg, at, [], false, false, touch);
console.log('mouse ->', m && m.type, m && m.dist.toFixed(1), '| touch ->', t && t.type, t && t.dist.toFixed(1));
assert.strictEqual(m.type, 'shape', 'a mouse: the line 4 px away beats the point 21 px away (priority radius 15 px)');
assert.strictEqual(t.type, 'joint', 'a finger: the priority radius is 15 x 2 = 30 px, so the point 21 px away wins over the line');
console.log('PASS snap-touch-priority-b20c-node');
