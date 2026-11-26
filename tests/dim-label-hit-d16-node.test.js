// tests/dim-label-hit-d16-node.test.js -- D-16 (TASK 1010, BUG-132): every dimension label has ONE minimum hit area
// (DIM_LABEL_MIN_HIT_PX, hover-manager dimLabelAt), so a narrow value like "5" (6 x 15 px) is easy to hover / click.
import assert from 'node:assert';
import { dimLabelAt } from '#ui/hover-manager.js';

const c = { type: 'distance' };
const state = { constraints: [c], sketches: [], joints: new Map(), shapes: [] };
const label = (b) => ({ dataset: { constraintIdx: '0' }, getBoundingClientRect: () => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h, width: b.w, height: b.h }) });
const svgOf = (...els) => ({ querySelectorAll: () => els });
const hit = (b, x, y) => dimLabelAt(svgOf(label(b)), state, x, y) === c;


const narrow = { x: 100, y: 100, w: 6, h: 15 }; // the "5" of the audit
assert.ok(hit(narrow, 103, 107), 'the drawn text itself hits');
assert.ok(hit(narrow, 103 - 8, 107), 'a point 8 px left of a 6 px wide "5" hits (inside the 24 px minimum)');
assert.ok(hit(narrow, 103 + 8, 107 + 8), 'a point 8 px right and 8 px below hits');
assert.ok(!hit(narrow, 103 + 13, 107), 'a point 13 px from the centre is outside the 24 px minimum');
assert.ok(!hit(narrow, 103, 107 + 13), 'vertically too');
const wide = { x: 100, y: 100, w: 60, h: 30 }; // a long label keeps its own, larger, size
assert.ok(hit(wide, 100 + 59, 115) && !hit(wide, 100 + 61, 115), 'a label already larger than 24 px is not grown');
console.log('PASS dim-label-hit-d16-node');
