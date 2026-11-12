// TASK 528 -- (re)writes tests/fixtures/fusion-oracle/fusion-dim-edit-known.json: per CLASS of difference (RULES of tests/harness/fusion-oracle/dim-edit.js) the runs where
// OUR answer differs from Fusion's. Run only when a difference is understood and accepted as KNOWN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dimEditCells, EDITS, jobId, compareRun, classifyDiff, RULES } from '../../tests/harness/fusion-oracle/dim-edit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/fusion-dim-edit.json'), 'utf8'));
const known = {};
for (const cell of dimEditCells()) for (const edit of EDITS) {
  const id = jobId(cell, edit), r = compareRun(cell, edit, fx.runs[id]);
  if (r.same) continue;
  const k = classifyDiff(cell.dimClass, edit, r.fusion, r.ours);
  (known[k] ||= { reason: (RULES.find(x => x.id === k) || { reason: 'UNCLASSIFIED' }).reason, runs: [] }).runs.push(id);
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/fusion-dim-edit-known.json'), JSON.stringify(known, null, 1));
console.log(Object.entries(known).map(([k, v]) => `${k}: ${v.runs.length}`).join('\n'));
