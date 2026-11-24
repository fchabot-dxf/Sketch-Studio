// TASK 877: the count text of a Fusion selection notice (selectionCountText, the ONE builder): singular / plural, a zero count left out.
import assert from 'node:assert';
import { selectionCountText as t } from '../apps/shaper/src/selection-edit.js';

const cases = [
  [[1, 0], '1 region'],
  [[2, 0], '2 regions'],
  [[0, 1], '1 path'],
  [[0, 3], '3 paths'],
  [[1, 1], '1 region, 1 path'],
  [[2, 1], '2 regions, 1 path'],
  [[0, 0], 'nothing to cut'],
];
for (const [[r, c], want] of cases) assert.strictEqual(t(r, c), want, `${r} regions, ${c} chains`);
console.log(`selection-notice-877-node: ${cases.length} checks passed`);
