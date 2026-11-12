// TASK 518 part 1 -- writes tests/fixtures/fusion-oracle/matrix.json: for each class of the 512 coverage matrix (constraint / dimension ROW x shape-pair class x
// variant sep | shared | locked | dimmed) the representative cell that was run in Fusion, and Fusion's and our answers for it. HOW THE REPRESENTATIVE IS PICKED: the
// pair class is the kind class of the operands (line L, circle O, arc A, point P: rect / polygon / construction / fillet variants of a class behave like the plain
// kind in Fusion); the variant picks the level: sep = both free (0,0), locked = the first operand held (line end fixed `4`, circle / arc centre fixed `c`, point fixed `4`),
// dimmed = the first operand dimensioned (line length `2`, circle / arc radius `r`); shared = the part-0 shared-joint scenario (line-line rows only). A class with no cell is
// listed with covered: null and the reason.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROWS } from '../../tests/harness/coverage/matrix-run.js';
import { cells } from './graded-analyze.mjs';
import { cellKey } from '../../tests/harness/fusion-oracle/graded.js';
import { buildScenarios } from '../../tests/harness/fusion-oracle/which-moves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUP = { coincident: 'coincident-pp', 'horizontal-2pt': 'horizontal-2pt', 'vertical-2pt': 'vertical-2pt', 'horizontal-line': 'horizontal-line', 'vertical-line': 'vertical-line', parallel: 'parallel', perpendicular: 'perpendicular', collinear: 'collinear', 'midpoint-line': 'midpoint', 'dim-aligned': 'dim-aligned', 'dim-horizontal': 'dim-horizontal', 'dim-vertical': 'dim-vertical', 'dim-length': 'dim-length', 'dim-radius': 'dim-radius', 'dim-angle-xy': 'dim-angle', 'dim-angle-yx': 'dim-angle' };
const NOT = { 'midpoint-3pt': 'no Fusion equivalent (a midpoint of three free points)', 'dim-point-line': 'ours projects a helper joint and the tool throws (finding NEW-1)', 'dim-line-line': 'not run in Fusion (distance between two parallel lines)', 'dim-line-line-yx': 'not run in Fusion' };
const rep = { L: 'L', C: 'L', S: 'L', R: 'L', O: 'O', A: 'A', F: 'A', P: 'P' };
const all = cells();
const find = (group, ka, kb, la, lb) => all.find(c => c.cell.group === (group === 'tangent' ? (ka === 'L' && kb !== 'L' || kb === 'L' && ka !== 'L' ? 'tangent-line-circle' : 'tangent-circle-circle') : group === 'equal' ? (ka === 'L' ? 'equal-line-line' : 'equal-circle') : group) && c.cell.kinds.join('') === (kb ? ka + kb : ka) && c.cell.levels.join(',') === (kb ? la + ',' + lb : la));
const lvLock = (k) => (k === 'L' ? '4' : k === 'P' ? '4' : 'c'), lvDim = (k) => (k === 'L' ? '2' : k === 'O' || k === 'A' ? 'r' : null);
const out = [];
for (const row of ROWS) {
  const g = row.id === 'tangent' ? 'tangent' : row.id === 'equal' ? 'equal' : GROUP[row.id];
  const kinds = ['L', 'O', 'A', 'P'];
  const pairs = row.arity === 1 ? kinds.filter(k => row.ui(k, k)).map(k => [k]) : kinds.flatMap(a => kinds.map(b => [a, b])).filter(([a, b]) => row.ui(a, b));
  for (const pr of pairs) for (const variant of ['sep', 'shared', 'locked', 'dimmed']) {
    const rec = { row: row.id, pair: pr.join(''), variant, covered: null, why: null };
    if (NOT[row.id]) rec.why = NOT[row.id];
    else {
      let la = '0', lb = '0', sc = null;
      if (variant === 'locked') la = lvLock(pr[0]); else if (variant === 'dimmed') la = lvDim(pr[0]);
      if (variant === 'shared') {
        const sg = { parallel: 'parallel', perpendicular: 'perpendicular', collinear: 'collinear', equal: 'equal-line-line' }[row.id];
        if (sg && pr.join('') === 'LL') sc = buildScenarios().find(s => s.group === sg && s.variant === 'shared' && s.order === 'AB');
        if (sc) rec.covered = `which-moves:${sc.id}`; else rec.why = 'shared joint is run for the line-line rows only (part 0 "shared")';
      } else if (la == null) rec.why = 'no such level for this kind';
      else {
        const c = find(g, pr[0], pr[1], la, lb);
        if (c) { const k = cellKey(c.f, c.o); rec.covered = `graded:${c.cell.id}`; rec.fusion = k.fusion; rec.ours = k.ours; rec.same = k.same; } else rec.why = 'pair class not in the graded set';
      }
    }
    out.push(rec);
  }
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/matrix.json'), JSON.stringify({ how: 'see the header of scripts/fusion-oracle/matrix-index.mjs', classes: out }, null, 1));
const cov = out.filter(x => x.covered);
console.log(`${out.length} matrix classes, ${cov.length} with a representative cell run in Fusion (${cov.filter(x => x.same).length} same as ours), ${out.length - cov.length} not covered`);
