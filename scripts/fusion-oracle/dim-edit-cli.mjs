// TASK 528 -- node scripts/fusion-oracle/dim-edit-cli.mjs merge <answers dir (out-N.json)> <jobs dir> | table [filter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dimEditCells, EDITS, jobId, fusionRecord, compareRun } from '../../tests/harness/fusion-oracle/dim-edit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tests/fixtures/fusion-oracle/fusion-dim-edit.json');
const [cmd, arg, dir] = process.argv.slice(2);
if (cmd === 'merge') {
  const answers = {}; let fusion = null;
  for (const f of fs.readdirSync(arg).filter(n => /^out-\d+\.json$/.test(n))) { const d = JSON.parse(fs.readFileSync(path.join(arg, f), 'utf8')); fusion = d.fusion; Object.assign(answers, d.results); }
  const docs = {};
  for (const f of fs.readdirSync(dir).filter(n => /^dimedit-\d+\.jobs\.json$/.test(n))) for (const j of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).jobs) docs[j.id] = j.doc;
  const runs = {};
  for (const [id, rec] of Object.entries(answers)) if (docs[id]) runs[id] = fusionRecord(rec, docs[id]);
  fs.writeFileSync(FIX, JSON.stringify({ fusion, date: new Date().toLocaleDateString('sv'), units: 'mm and degrees; positions by joint index (document order without the origin), radii by shape index', runs }));
  console.log(Object.keys(runs).length + ' runs -> ' + FIX);
} else if (cmd === 'table') {
  const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  for (const cell of dimEditCells()) for (const edit of EDITS) {
    const id = jobId(cell, edit);
    if (arg && !id.includes(arg)) continue;
    const r = compareRun(cell, edit, fx.runs[id]);
    console.log(id.padEnd(48), 'F', r.fusion.padEnd(40), '| O', r.ours, r.same ? '' : '  <> DIFF', r.reason ? '[' + r.reason + ']' : '');
  }
}
