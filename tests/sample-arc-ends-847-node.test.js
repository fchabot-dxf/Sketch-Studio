// tests/sample-arc-ends-847-node.test.js -- TASK 847 (part C): #core/curve-kinds.js sampleArc without an SVG DOM (Node) returns the arc's two ENDS,
// start -> end, as its comment says. A CENTER arc's joints are [centre, start, end]; the fallback returned [centre, end] (task 846 found it), so a
// Node caller's arc polygon started at the arc's centre. (The page samples the arc with the SVG DOM; a worker reads the page's samples:
// withArcSamples.)
import assert from 'node:assert';
import { sampleArc, withArcSamples, arcSamplesOf } from '#core/curve-kinds.js';

assert.strictEqual(typeof document, 'undefined', 'Node: no SVG DOM');
const joints = new Map([['c', { x: 10, y: 20 }], ['a', { x: 15, y: 20 }], ['b', { x: 10, y: 25 }]]);
const arc = { id: 'arc1', type: 'arc', subType: 'CENTER', joints: ['c', 'a', 'b'] };
const pts = sampleArc(arc, { joints }, 24);
assert.deepStrictEqual(pts, [{ x: 15, y: 20 }, { x: 10, y: 25 }], `the arc's start and end (${JSON.stringify(pts)})`);
// the same with a stored sweep (the long way round): still its two ends, start first
const pts2 = sampleArc({ ...arc, sweep: false }, { joints }, 24);
assert.deepStrictEqual(pts2, [{ x: 15, y: 20 }, { x: 10, y: 25 }], `a stored sweep: the start and the end (${JSON.stringify(pts2)})`);
// copies, not the joints themselves
pts[0].x = 99;
assert.strictEqual(joints.get('a').x, 15, 'the samples are copies of the joints');
// arcSamplesOf (what the page hands a worker) reads the same in Node; withArcSamples hands them back unchanged
const table = arcSamplesOf({ shapes: [arc], joints }, 24);
assert.deepStrictEqual(table.byId.arc1, [{ x: 15, y: 20 }, { x: 10, y: 25 }], 'arcSamplesOf: the same two ends');
assert.deepStrictEqual(withArcSamples(table, () => sampleArc(arc, { joints }, 24)), [{ x: 15, y: 20 }, { x: 10, y: 25 }], 'withArcSamples: the table');
console.log('sample-arc-ends-847-node.test.js: ok');
