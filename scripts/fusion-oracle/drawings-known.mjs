// TASK 518 part 1 -- (re)writes tests/fixtures/fusion-oracle/drawings-known.json: every comparison row where OUR answer differs from Fusion's, with a reason class.
// Run only when a difference is understood and accepted as KNOWN (the test fails when a KNOWN row starts agreeing or an agreeing row starts differing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDrawings } from '../../tests/harness/coverage/prop-lib.js';
import { compareDrawing } from '../../tests/harness/fusion-oracle/drawings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function reasonOf(r) {
  const kind = r.key.split('/').pop();
  if (kind === 'outcome') {
    if (/^refused/.test(r.fusion) && !/^refused/.test(r.ours)) return 'FUSION REFUSES (over-constrained / redundant); ours keeps it (accepted or as a reference)';
    if (/^refused/.test(r.ours) && !/^refused/.test(r.fusion)) return 'OURS REFUSES what Fusion accepts';
    if (/^reference/.test(r.ours) && /^accepted/.test(r.fusion)) return 'ours demotes the dimension to a reference; Fusion keeps it driving';
    return 'outcome differs';
  }
  if (kind === 'full') return 'per-entity fully-constrained flag differs (circle radius is not a DOF in ours: O2; arcs / points)';
  if (kind === 'sketchFull') return 'sketch fully-constrained flag differs (circle radius O2, or a refused / redundant step upstream)';
  if (kind === 'coords') return "Fusion's solution violates our constraints";
  return 'differs';
}
const known = {};
for (const d of await loadDrawings()) {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle', d.mod.NAME + '.json'), 'utf8'));
  const { rows } = compareDrawing(d.mod, fx);
  for (const r of rows) if (!r.same) known[`${d.mod.NAME}/${r.key}`] = reasonOf(r);
}
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/drawings-known.json'), JSON.stringify(known, null, 1));
console.log(Object.keys(known).length + ' KNOWN rows');
