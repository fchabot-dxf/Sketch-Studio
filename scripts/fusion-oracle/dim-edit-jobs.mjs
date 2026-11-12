// TASK 528 -- node scripts/fusion-oracle/dim-edit-jobs.mjs <outdir> [per-file]: writes the dimension-edit runs (one per cell x edit) as jobs for scripts/fusion-oracle/run-dim-edit.py.
import fs from 'node:fs';
import path from 'node:path';
import { dimEditCells, materializeCell, EDITS, targetOf, jobId } from '../../tests/harness/fusion-oracle/dim-edit.js';

const out = process.argv[2], per = +(process.argv[3] || 40);
fs.mkdirSync(out, { recursive: true });
const jobs = [];
let na = 0;
for (const cell of dimEditCells()) {
  const M = materializeCell(cell);
  if (M.na) { na++; continue; }
  const isAngle = M.act.type === 'angle';
  for (const edit of EDITS) jobs.push({ id: jobId(cell, edit), doc: M.doc, params: { type: M.act.type, ...M.act.params }, measured: M.measured, target: targetOf(isAngle, M.measured, edit) });
}
let n = 0;
for (let i = 0; i < jobs.length; i += per) { fs.writeFileSync(path.join(out, `dimedit-${n}.jobs.json`), JSON.stringify({ name: 'dimedit', jobs: jobs.slice(i, i + per) })); n++; }
console.log(`${jobs.length} runs in ${n} files, ${na} cells not applicable`);
