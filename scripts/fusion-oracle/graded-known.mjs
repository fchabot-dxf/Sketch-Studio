// TASK 518 part 0b -- (re)writes tests/fixtures/fusion-oracle/which-moves-graded-known.json: per class (constraint x kind pair) the cells where OUR answer differs from
// Fusion's: "all" when the class is uniform, else the list of "levelA,levelB". Run only when a difference is understood and accepted as KNOWN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cells } from './graded-analyze.mjs';
import { cellKey, classOf } from '../../tests/harness/fusion-oracle/graded.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REASON = {
  'collinear': 'remaining after task 511: which line gives way (or a refusal) differs from Fusion', 'pointOnLine': 'remaining after task 511: held-operand cases differ from Fusion',
  // after task 515 a circle's radius is a solver unknown: the least-change solve may now also change a free radius, where Fusion keeps the moving circle's radius
  'pointOnCircle': 'remaining after tasks 511 + 515: held-operand cases differ from Fusion; since 515 ours may also change a free circle radius (least change), Fusion translates the circle',
  'equal-circle': "after task 515: which circle resizes / moves differs from Fusion (ours: least change over both); equal(circle, arc) is refused by Fusion's API, ours accepts it",
  'tangent-circle-circle': 'after task 515: ours resizes AND moves both circles by least change; Fusion resizes / moves only the moving circle',
  'tangent-line-circle': 'after task 515: ours may also change the free circle radius (least change); Fusion moves the line or translates the circle keeping its radius',
};
const byClass = {};
for (const c of cells()) {
  const k = classOf(c.cell);
  (byClass[k] ||= { total: 0, diff: [] }).total++;
  if (!cellKey(c.f, c.o).same) byClass[k].diff.push(c.cell.levels.join(','));
}
const known = {};
for (const [k, v] of Object.entries(byClass)) {
  if (!v.diff.length) continue;
  const g = k.split('|')[0];
  known[k] = { reason: REASON[g] || 'PLACEMENT / HOW: which geometry moves differs (docs/FUSION-COMPARISON.md, Which geometry moves: graded)', total: v.total, cells: v.diff.length === v.total ? 'all' : v.diff };
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-graded-known.json'), JSON.stringify(known, null, 1));
const nd = Object.values(known).reduce((a, v) => a + (v.cells === 'all' ? v.total : v.cells.length), 0);
console.log(`${Object.keys(known).length} KNOWN classes of ${Object.keys(byClass).length}; ${nd} differing cells of ${Object.values(byClass).reduce((a, v) => a + v.total, 0)}`);
