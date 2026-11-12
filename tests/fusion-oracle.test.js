// TASK 518 -- FUSION AS AN ORACLE. Pure node: no Fusion needed, it replays recorded Fusion answers (tests/fixtures/fusion-oracle/*.json, version and date
// inside each file) against OUR pipeline. Report: docs/FUSION-COMPARISON.md. Every disagreement is a named KNOWN entry; the test fails loudly when a
// KNOWN cell starts agreeing (delete the entry) or an agreeing cell starts differing (new divergence).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarios, runOurs, cellOf } from './harness/fusion-oracle/which-moves.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/fusion-oracle', f), 'utf8'));
const failures = [];
const fail = (m) => failures.push(m);

// ------------------------------------------------------------------------------------------------ part 0: which geometry moves
{
  const fx = load('which-moves.json');
  const KNOWN = load('which-moves-known.json');     // scenario id -> reason class (written by scripts/fusion-oracle/which-moves-known.mjs)
  if (!fx.fusion || !fx.date) fail('which-moves.json carries no Fusion version / date');
  const scs = buildScenarios();
  if (scs.length !== fx.scenarios.length) fail(`scenario list changed: ${scs.length} now, ${fx.scenarios.length} recorded (re-record in Fusion)`);
  let same = 0, known = 0;
  for (const sc of scs) {
    const f = fx.results[sc.id];
    if (!f || f.setupError) { fail(`which-moves ${sc.id}: no Fusion answer${f ? ' (' + f.setupError + ')' : ''}`); continue; }
    if (JSON.stringify(sc) !== JSON.stringify(fx.scenarios.find(s => s.id === sc.id))) { fail(`which-moves ${sc.id}: the scenario differs from the one Fusion answered`); continue; }
    const c = cellOf(f, runOurs(sc));
    if (c.same) {
      same++;
      if (KNOWN[sc.id]) fail(`which-moves ${sc.id}: KNOWN (${KNOWN[sc.id]}) but ours now agrees with Fusion: delete the entry`);
    } else {
      known++;
      if (!KNOWN[sc.id]) fail(`which-moves ${sc.id}: NEW divergence. Fusion ${c.fusion} | ours ${c.ours}`);
    }
  }
  for (const id of Object.keys(KNOWN)) if (!fx.results[id]) fail(`which-moves KNOWN entry ${id} has no scenario`);
  console.log(`which-moves: ${scs.length} cells, ${same} same as Fusion, ${known} KNOWN differences (Fusion ${fx.fusion}, recorded ${fx.date})`);
}

if (failures.length) {
  console.error('fusion-oracle FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('fusion-oracle OK');
