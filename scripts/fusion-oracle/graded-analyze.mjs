// TASK 518 part 0b -- prints, per group, the who-moves grid of the line-line cells (Fusion and ours) and scores candidate rules. Developer aid; the
// report tables are written by graded-doc.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCells, materialize, fusionMove, oursMove } from '../../tests/harness/fusion-oracle/graded.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-graded.json'), 'utf8'));
export function whoMoves(r) { if (!r.accepted) return 'R'; const x = r.mv.X.m > 0, y = r.mv.Y ? r.mv.Y.m > 0 : false; return x && y ? 'B' : x ? 'A' : y ? 'B2' : '-'; }
const sym = (r) => { if (!r.accepted) return 'R'; const x = r.mv.X.m > 0, y = r.mv.Y && r.mv.Y.m > 0; return x && y ? 'X' : x ? 'a' : y ? 'b' : '-'; };   // a = only the first pick moves, b = only the second, X = both
let _cells = null;
export function cells() {
  if (_cells) return _cells;
  const out = [];
  for (const cell of buildCells()) {
    const fr = fx.cells[cell.id]; if (!fr) continue;
    const M = materialize(cell); if (M.na) continue;
    const f = fusionMove(M, { initial: fr.initial, steps: [fr.step] }), o = oursMove(M);
    out.push({ cell, f, o, M: { X: { comp: M.X.comp }, Y: M.Y ? { comp: M.Y.comp } : null } });
  }
  return (_cells = out);
}
if (process.argv[1].endsWith('graded-analyze.mjs') && process.argv[2] !== 'fit') {
  const all = cells();
  for (const g of process.argv.slice(2)) {
    const ll = all.filter(c => c.cell.group === g && c.cell.kinds.join('') === 'LL');
    const lv = [...new Set(ll.map(c => c.cell.levels[0]))];
    for (const [who, pick] of [['Fusion', c => c.f], ['ours', c => c.o]]) {
      console.log(`== ${g} L-L ${who}   rows = level of first pick A, cols = level of second pick B   (a first moves only, b second only, X both, - none, R refused)`);
      console.log('     ' + lv.join('  '));
      for (const a of lv) console.log(('A' + a).padEnd(5) + lv.map(b => { const c = ll.find(x => x.cell.levels[0] === a && x.cell.levels[1] === b); return c ? sym(pick(c)).padEnd(3) : '?  '; }).join(''));
    }
  }
}

// ---- rule fitting: a rank per level; the operand with the LOWER rank moves, a tie -> the SECOND pick moves. Finds the ranking with the fewest contradicting cells.
export function fitRule(group, who = (c) => c.f) {
  const all = cells().filter(c => c.cell.group === group && c.cell.kinds.join('') === 'LL' && who(c).accepted);
  const lv = [...new Set(all.flatMap(c => c.cell.levels))];
  const obs = all.map(c => ({ a: lv.indexOf(c.cell.levels[0]), b: lv.indexOf(c.cell.levels[1]), m: sym(who(c)), id: c.cell.id })).filter(o => o.m === 'a' || o.m === 'b');
  const K = 4, n = lv.length;
  let best = { bad: Infinity, rank: null };
  const rank = new Array(n).fill(0);
  const total = Math.pow(K, n);
  for (let t = 0; t < total; t++) {
    let x = t; for (let i = 0; i < n; i++) { rank[i] = x % K; x = (x - rank[i]) / K; }
    let bad = 0;
    for (const o of obs) { const ra = rank[o.a], rb = rank[o.b]; const pred = ra < rb ? 'a' : (ra > rb ? 'b' : 'b'); if (pred !== o.m) { bad++; if (bad >= best.bad) break; } }
    if (bad < best.bad) best = { bad, rank: rank.slice() };
  }
  const contradict = obs.filter(o => { const ra = best.rank[o.a], rb = best.rank[o.b]; return (ra < rb ? 'a' : 'b') !== o.m; }).map(o => o.id);
  return { levels: lv, rank: best.rank, total: obs.length, bad: best.bad, both: all.length - obs.length, contradict };
}
if (process.argv[1].endsWith('graded-analyze.mjs') && process.argv[2] === 'fit') {
  for (const g of process.argv.slice(3)) { const r = fitRule(g); console.log(g, 'F:', r.levels.map((l, i) => `${l}=${r.rank[i]}`).join(' '), `fits ${r.total - r.bad}/${r.total} (both-move cells ${r.both})`, r.contradict.slice(0, 6).join('  ')); const o = fitRule(g, c => c.o); console.log(g, 'O:', o.levels.map((l, i) => `${l}=${o.rank[i]}`).join(' '), `fits ${o.total - o.bad}/${o.total} (both-move cells ${o.both})`); }
}
