// TASK 530 phase 2 -- helper CLI for the real-mouse drag oracle (qualitative).
//   node scripts/fusion-oracle/drag-cli.mjs cells [<run dir>]   write tests/fixtures/fusion-oracle/drag-cells.json (+ a copy in <run dir> for the Fusion runners)
//   node scripts/fusion-oracle/drag-cli.mjs merge <results.json> merge the recorded Fusion answers (RUN/results.json) into tests/fixtures/fusion-oracle/drag-fusion.json
//   node scripts/fusion-oracle/drag-cli.mjs table [filter]       Fusion vs ours, one row per cell
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCells, PATH, runOurs, record, sig } from '../../tests/harness/fusion-oracle/drag-cells.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FX = path.join(ROOT, 'tests/fixtures/fusion-oracle');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'cells') {
  const out = JSON.stringify({ path: PATH, cells: buildCells() });
  fs.writeFileSync(path.join(FX, 'drag-cells.json'), out);
  if (arg) { fs.mkdirSync(arg, { recursive: true }); fs.writeFileSync(path.join(arg, 'drag-cells.json'), out); }
  console.log(buildCells().length + ' cells');
} else if (cmd === 'merge') {
  const fus = JSON.parse(fs.readFileSync(arg, 'utf8'));
  fs.writeFileSync(path.join(FX, 'drag-fusion.json'), JSON.stringify({ fusion: fus.fusion, date: new Date().toLocaleDateString('sv'), units: 'cm', path: PATH, results: fus.results }));
  console.log(Object.keys(fus.results).length + ' recorded runs');
} else if (cmd === 'table') {
  const fx = JSON.parse(fs.readFileSync(path.join(FX, 'drag-fusion.json'), 'utf8'));
  for (const cell of buildCells()) {
    if (arg && !cell.id.includes(arg)) continue;
    const rs = ['a', 'b'].map(c => fx.results[cell.id + '#' + c]).map(r => r && r.after && Object.keys(r.after).length ? sig(record(cell, r.before, r.after)) : '(none)');
    const o = sig(runOurs(cell));
    console.log(cell.id.padEnd(34), 'F', rs[0], rs[0] === rs[1] ? '' : ' | b: ' + rs[1], ' || O', o);
  }
}
