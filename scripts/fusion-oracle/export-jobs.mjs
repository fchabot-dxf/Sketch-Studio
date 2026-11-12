// TASK 518 -- node scripts/fusion-oracle/export-jobs.mjs <outdir>: writes one jobs file per drawing (round 1 + round 2) for scripts/fusion-oracle/run-jobs.py.
import fs from 'node:fs';
import path from 'node:path';
import { loadDrawings } from '../../tests/harness/coverage/prop-lib.js';
import { exportDrawing } from '../../tests/harness/fusion-oracle/export.js';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
for (const d of await loadDrawings()) {
  const j = exportDrawing(d.mod);
  fs.writeFileSync(path.join(out, j.name + '.jobs.json'), JSON.stringify(j));
  console.log(j.name.padEnd(22), 'jobs', j.jobs.length, 'joints', Object.keys(j.doc.joints).length, 'shapes', j.doc.shapes.length, 'initial constraints', j.doc.constraints.length);
}
