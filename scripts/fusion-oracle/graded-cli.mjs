// TASK 518 part 0b -- node scripts/fusion-oracle/graded-cli.mjs merge <fusion-out.json> | table [filter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCells, materialize, fusionMove, oursMove, cellKey } from '../../tests/harness/fusion-oracle/graded.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-graded.json');
const [cmd, arg] = process.argv.slice(2);
if (cmd === 'merge') {
  // merge <fusion-out.json> <jobs dir>: ids in the answers are the ids of the scratch job files; the fixture stores positions BY INDEX (joint / shape
  // order of the document, which is deterministic), because ids carry timestamps and differ on every build.
  const fus = JSON.parse(fs.readFileSync(arg, 'utf8'));
  const dir = process.argv[4];
  const docs = {};
  for (const f of fs.readdirSync(dir).filter(n => /^graded-\d+\.jobs\.json$/.test(n))) for (const j of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).jobs) docs[j.id] = j.doc;
  const cells = {};
  for (const [k, r] of Object.entries(fus.results)) {
    const id = k.replace(/^graded\//, '');
    if (r.setupError) { cells[id] = { setupError: r.setupError }; continue; }
    const doc = docs[id];
    if (!doc) continue;      // an answer for a cell the current list no longer has
    const jids = Object.keys(doc.joints).filter(j => j !== 'j_origin');
    const sids = doc.shapes.map(s => s.id);
    const P = (m) => jids.map(j => m[j]), R = (m) => sids.map(s => (m[s] == null ? null : m[s]));
    const st = r.steps[r.steps.length - 1];
    const full = st.snap ? sids.map(s => (st.snap.full[s] == null ? null : st.snap.full[s])) : null;
    cells[id] = { buildErrors: r.buildErrors, initial: { pts: P(r.initial.pts), radii: R(r.initial.radii) },
      step: { accepted: st.accepted, error: st.error, valueError: st.valueError, driving: st.driving, snap: st.snap ? { pts: P(st.snap.pts), radii: R(st.snap.radii), origin: st.snap.origin, full } : null } };
  }
  fs.writeFileSync(FIX, JSON.stringify({ fusion: fus.fusion, date: new Date().toLocaleDateString('sv'), units: 'mm; positions by joint index, radii / full by shape index of the document', cells }));
  console.log(Object.keys(cells).length + ' cells -> ' + FIX);
} else if (cmd === 'table') {
  const fx = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  const tally = {};
  for (const cell of buildCells()) {
    if (arg && !cell.id.includes(arg)) continue;
    const fr = fx.cells[cell.id]; if (!fr || fr.setupError) { console.log(cell.id, 'NO FUSION ANSWER', fr && fr.setupError); continue; }
    const M = materialize(cell); if (M.na) continue;
    const f = fusionMove(M, { initial: fr.initial, steps: [fr.step] }), o = oursMove(M);
    const c = cellKey(f, o);
    console.log(cell.id.padEnd(44), 'F', c.fusion.padEnd(34), '| O', c.ours, c.same ? '' : '  <> DIFF');
  }
}
