// TASK 518 -- helper CLI for the which-moves oracle.
//   node scripts/fusion-oracle/which-moves-cli.mjs scenarios <out.json>            write the scenario list for the Fusion runner
//   node scripts/fusion-oracle/which-moves-cli.mjs merge <fusion-out.json>         merge Fusion's answers into tests/fixtures/fusion-oracle/which-moves.json
//   node scripts/fusion-oracle/which-moves-cli.mjs table [filter]                  ours vs Fusion, one row per scenario
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScenarios, runOurs, movedSet, pointMoves, MOVE_TOL, OURS_TOL } from '../../tests/harness/fusion-oracle/which-moves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves.json');
const [cmd, arg] = process.argv.slice(2);
const scs = buildScenarios();

if (cmd === 'scenarios') { fs.writeFileSync(arg, JSON.stringify(scs)); console.log(scs.length + ' scenarios -> ' + arg); }
else if (cmd === 'merge') {
  const fus = JSON.parse(fs.readFileSync(arg, 'utf8'));
  let fx = { results: {} };
  try { fx = JSON.parse(fs.readFileSync(FIX, 'utf8')); } catch (e) { /* first merge */ }
  fx.fusion = fus.fusion; fx.date = new Date().toLocaleDateString('sv');
  fx.units = 'mm (Fusion API is cm: x10 on the way out)';
  fx.scenarios = scs;
  Object.assign(fx.results, fus.results);
  fs.writeFileSync(FIX, JSON.stringify(fx));
  console.log('fixture holds ' + Object.keys(fx.results).length + ' of ' + scs.length + ' answers');
} else if (cmd === 'table') {
  const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  for (const sc of scs) {
    if (arg && !sc.id.includes(arg)) continue;
    const f = fx.results[sc.id];
    let o; try { o = runOurs(sc); } catch (e) { o = { err: e.message }; }
    const fm = f && f.after ? pointMoves(f.before, f.after, MOVE_TOL) : (f ? 'setup:' + f.setupError : '-');
    const om = o.after ? pointMoves(o.before, o.after, OURS_TOL) : 'ERR ' + o.err;
    console.log(sc.id.padEnd(46), 'F', f ? (f.accepted ? 'ok ' : 'REF') : '?  ', fm.padEnd(26), '| O', o.accepted ? 'ok ' : 'REF', om, f && !f.accepted ? ' [' + f.error + ']' : '');
  }
}
