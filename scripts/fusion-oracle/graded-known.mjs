// TASK 518 part 0b -- (re)writes tests/fixtures/fusion-oracle/which-moves-graded-known.json: per class (constraint x kind pair) the cells where OUR answer differs from
// Fusion's: "all" when the class is uniform, else the list of "levelA,levelB". Run only when a difference is understood and accepted as KNOWN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cells } from './graded-analyze.mjs';
import { cellKey, classOf } from '../../tests/harness/fusion-oracle/graded.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REASON = {
  'collinear': 'pending task 511', 'pointOnLine': 'pending task 511', 'pointOnCircle': 'pending task 511',
  'equal-circle': 'OUR BUG F2 (circle radius is not a solver unknown): equal on circles refused / no effect; tangent circle radii never change either',
  'tangent-circle-circle': 'DIFFERENT: ours never resizes a circle (shape data, O2); Fusion resizes the moving circle',
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
