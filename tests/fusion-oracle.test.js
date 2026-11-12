// TASK 518 -- FUSION AS AN ORACLE. Pure node: no Fusion needed, it replays recorded Fusion answers (tests/fixtures/fusion-oracle/*.json, version and date
// inside each file) against OUR pipeline. Report: docs/FUSION-COMPARISON.md. Every disagreement is a named KNOWN entry; the test fails loudly when a
// KNOWN cell starts agreeing (delete the entry) or an agreeing cell starts differing (new divergence).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarios, runOurs, cellOf } from './harness/fusion-oracle/which-moves.js';
import { loadDrawings } from './harness/coverage/prop-lib.js';
import { compareDrawing } from './harness/fusion-oracle/drawings.js';
import { buildCells, materialize, fusionMove, oursMove, cellKey, classOf } from './harness/fusion-oracle/graded.js';

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

// ------------------------------------------------------------------------------------------------ part 0b: graded which-moves, every shape kind, origin as an operand
{
  const gx = load('which-moves-graded.json');
  const GK = load('which-moves-graded-known.json');    // class (constraint|kinds) -> { reason, total, cells: 'all' | ['levelA,levelB', ...] }
  if (!gx.fusion || !gx.date) fail('which-moves-graded.json carries no Fusion version / date');
  const cells = buildCells();
  let same = 0, diff = 0, originBad = 0;
  const seen = {};
  for (const cell of cells) {
    const fr = gx.cells[cell.id];
    if (!fr || fr.setupError) { fail(`graded ${cell.id}: no Fusion answer`); continue; }
    const M = materialize(cell);
    if (M.na) { fail(`graded ${cell.id}: not applicable now`); continue; }
    const f = fusionMove(M, { initial: fr.initial, steps: [fr.step] }), o = oursMove(M);
    // the origin NEVER moves and is never deleted, in Fusion and in ours (N-F1 -- a fillet on an origin corner deletes it -- is not reached: no cell fillets at the origin)
    if (!o.originOk || (f.accepted && !f.originOk)) { originBad++; fail(`graded ${cell.id}: the origin moved or was deleted (ours ${o.originOk}, Fusion ${f.originOk})`); }
    const c = cellKey(f, o), k = classOf(cell), lv = cell.levels.join(',');
    const kn = GK[k], isKnown = !!kn && (kn.cells === 'all' || kn.cells.includes(lv));
    (seen[k] ||= { total: 0 }).total++;
    if (c.same) { same++; if (isKnown) fail(`graded ${cell.id}: KNOWN (${kn.reason}) but ours now agrees with Fusion: update the KNOWN entry`); }
    else { diff++; if (!isKnown) fail(`graded ${cell.id}: NEW divergence. Fusion ${c.fusion} | ours ${c.ours}`); }
  }
  for (const [k, v] of Object.entries(GK)) if (!seen[k] || seen[k].total !== v.total) fail(`graded KNOWN class ${k}: ${seen[k] ? seen[k].total : 0} cells now, ${v.total} recorded`);
  console.log(`which-moves-graded: ${cells.length} cells, ${same} same as Fusion, ${diff} KNOWN differences in ${Object.keys(GK).length} classes, origin never moved (Fusion ${gx.fusion}, recorded ${gx.date})`);
}

// ------------------------------------------------------------------------------------------------ part 1: the round-1 and round-2 drawings, step by step
{
  const DK = load('drawings-known.json');            // "<drawing>/<row key>" -> reason class
  let rows = 0, same = 0, known = 0;
  const seenKnown = new Set();
  for (const d of await loadDrawings()) {
    const fx = load(d.mod.NAME + '.json');
    if (!fx.fusion || !fx.date) fail(`${d.mod.NAME}.json carries no Fusion version / date`);
    const { rows: rs } = compareDrawing(d.mod, fx);
    for (const r of rs) {
      rows++;
      const k = `${d.mod.NAME}/${r.key}`;
      if (r.same) { same++; if (DK[k]) fail(`drawing ${k}: KNOWN (${DK[k]}) but ours now agrees with Fusion: delete the entry`); }
      else { known++; seenKnown.add(k); if (!DK[k]) fail(`drawing ${k}: NEW divergence at "${r.label}". ours ${r.ours} | Fusion ${r.fusion}`); }
    }
  }
  for (const k of Object.keys(DK)) if (!seenKnown.has(k) && !failures.some(f => f.includes(k))) fail(`drawing KNOWN entry ${k} no longer differs or no longer exists`);
  console.log(`drawings: ${rows} comparison rows, ${same} same, ${known} KNOWN differences`);
}

if (failures.length) {
  console.error('fusion-oracle FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('fusion-oracle OK');
