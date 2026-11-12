// TASK 528 -- FUSION AS AN ORACLE FOR EDITING A DIMENSION VALUE. Pure node: replays the recorded Fusion answers (tests/fixtures/fusion-oracle/fusion-dim-edit.json,
// version and date inside) against OUR commitDimensionEdit. Every difference is a named KNOWN entry (fusion-dim-edit-known.json: class -> reason + the runs);
// the test fails loudly when a KNOWN run starts agreeing (delete it) or an agreeing run starts differing (new divergence). Report: docs/FUSION-COMPARISON.md,
// "Editing a dimension".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dimEditCells, EDITS, jobId, compareRun, classifyDiff, RULES } from './harness/fusion-oracle/dim-edit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/fusion-oracle', f), 'utf8'));
const failures = [];
const fail = (m) => failures.push(m);

const fx = load('fusion-dim-edit.json');
const KNOWN = load('fusion-dim-edit-known.json');      // class -> { reason, runs: [run ids] } (written by scripts/fusion-oracle/dim-edit-known.mjs)
if (!fx.fusion || !fx.date) fail('fusion-dim-edit.json carries no Fusion version / date');
const where = {};      // run id -> the class it is KNOWN under
for (const [k, v] of Object.entries(KNOWN)) {
  if (!v.reason || /^UNCLASSIFIED/.test(v.reason)) fail(`KNOWN class ${k} has no reason`);
  if (k !== 'unclassified' && !RULES.some(r => r.id === k)) fail(`KNOWN class ${k} is not a rule of tests/harness/fusion-oracle/dim-edit.js`);
  for (const id of v.runs) where[id] = k;
}
if (KNOWN.unclassified) fail(`${KNOWN.unclassified.runs.length} runs are KNOWN as unclassified: classify them`);

let runs = 0, same = 0, diff = 0;
const ids = new Set();
for (const cell of dimEditCells()) {
  for (const edit of EDITS) {
    const id = jobId(cell, edit);
    ids.add(id);
    const f = fx.runs[id];
    if (!f || f.setupError) { fail(`${id}: no Fusion answer${f ? ' (' + f.setupError + ')' : ''}`); continue; }
    const r = compareRun(cell, edit, f);
    if (r.na) { fail(`${id}: not applicable now (${r.na})`); continue; }
    runs++;
    if (r.same) {
      same++;
      if (where[id]) fail(`${id}: KNOWN (${where[id]}) but ours now agrees with Fusion (${r.ours}): delete it from the KNOWN file`);
    } else {
      diff++;
      const k = classifyDiff(cell.dimClass, edit, r.fusion, r.ours);
      if (!where[id]) fail(`${id}: NEW divergence. Fusion ${r.fusion} | ours ${r.ours} (class ${k})`);
      else if (where[id] !== k) fail(`${id}: KNOWN as ${where[id]} but now class ${k}: Fusion ${r.fusion} | ours ${r.ours}`);
    }
  }
}
for (const id of Object.keys(where)) if (!ids.has(id)) fail(`KNOWN run ${id} is not a run any more`);
for (const id of Object.keys(fx.runs)) if (!ids.has(id)) fail(`recorded run ${id} is not in the current run list (re-record in Fusion)`);

console.log(`fusion-dim-edit: ${runs} runs (${new Set([...ids].map(i => i.split('#')[0])).size} cells x ${EDITS.length} edits), ${same} same as Fusion, ${diff} KNOWN differences in ${Object.keys(KNOWN).length} classes (Fusion ${fx.fusion}, recorded ${fx.date})`);
if (failures.length) {
  console.error('fusion-dim-edit FAILED:\n  ' + failures.slice(0, 40).join('\n  ') + (failures.length > 40 ? `\n  ... and ${failures.length - 40} more` : ''));
  process.exit(1);
}
console.log('fusion-dim-edit OK');
