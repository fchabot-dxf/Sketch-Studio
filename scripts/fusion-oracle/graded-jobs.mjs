// TASK 518 part 0b -- node scripts/fusion-oracle/graded-jobs.mjs <outdir> [per-file]: writes the graded cells as jobs for scripts/fusion-oracle/run-jobs.py (graded-N.jobs.json).
import fs from 'node:fs';
import path from 'node:path';
import { buildCells, materialize } from '../../tests/harness/fusion-oracle/graded.js';

const out = process.argv[2], per = +(process.argv[3] || 300);
fs.mkdirSync(out, { recursive: true });
const jobs = [];
let na = 0;
for (const cell of buildCells()) {
  const M = materialize(cell);
  if (M.na) { na++; continue; }
  const { act } = M;
  const params = { type: act.type, ...act.params };
  jobs.push({ id: cell.id, record: 'coords', watch: [M.X.shape, M.Y && M.Y.shape].filter(Boolean), doc: M.doc, ops: [{ op: 'add', label: cell.id, params, isDim: !!act.dim, extra: act.dim || null }] });
}
let n = 0;
for (let i = 0; i < jobs.length; i += per) { fs.writeFileSync(path.join(out, `graded-${n}.jobs.json`), JSON.stringify({ name: 'graded', jobs: jobs.slice(i, i + per) })); n++; }
console.log(`${jobs.length} jobs in ${n} files, ${na} cells not applicable`);
