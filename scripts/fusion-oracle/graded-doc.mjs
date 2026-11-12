// TASK 518 part 0b -- writes the "Which geometry moves: graded" section of docs/FUSION-COMPARISON.md between <!-- graded:begin --> and <!-- graded:end -->.
//   node scripts/fusion-oracle/graded-doc.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cells, fitRule } from './graded-analyze.mjs';
import { cellKey, GROUPS } from '../../tests/harness/fusion-oracle/graded.js';
import { WHO_MOVES } from '../../packages/core/creation-placement-table.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/fusion-oracle/which-moves-graded.json'), 'utf8'));
const all = cells();
const sym = (r) => { if (!r.accepted) return 'R'; const x = r.mv.X.m > 0, y = r.mv.Y && r.mv.Y.m > 0; return x && y ? 'X' : x ? 'a' : y ? 'b' : '-'; };
const LV = { '0': 'free', '1': 'corner', '2': 'length', '3': 'H/V', '4': 'end fixed', '5': 'end+length', '6': 'H/V+end', '7': 'full', o: 'end at origin', m: 'mid at origin', '8': 'rect full', c: 'centre fixed', r: 'radius', cr: 'centre+radius' };
const out = [];
const P = (...a) => out.push(...a);

P('<!-- graded:begin -->', '');
P(`Fusion ${fx.fusion}, recorded ${fx.date}. ${all.length} cells; data \`tests/fixtures/fusion-oracle/which-moves-graded.json\` (positions before / after in mm, per cell), known differences \`which-moves-graded-known.json\` (per class: constraint x kind pair; "all" when the whole class differs). The cells are built by \`tests/harness/fusion-oracle/graded.js\` with the matrix builders (rect tool, polygon tool, fillet tool, arc, circle), the level applied with real constraints, then replayed in Fusion by \`scripts/fusion-oracle/run-jobs.py\`.`, '');
P('**How to read it.** A = the FIRST pick, B = the SECOND pick (so pick order is the row / column order). Levels of a free-standing line: `0` free, `1` one end coincident with another free line (a chain), `2` length dimension, `3` H or V, `4` one end fixed, `5` end fixed + length, `6` H/V + end fixed, `7` fully constrained by constraints and dimensions only (H/V + length + the two position dimensions from the origin), `o` one end coincident with the origin, `m` midpoint at the origin. Rect side: `0`, `8` the whole rectangle fully constrained by dimensions. Polygon side: `0`. Construction line: `0`, `4`. Circle / arc: `0`, `c` centre fixed, `r` radius dimension, `cr` both; fillet arc: `0`, `c`. Point: `0`, `4` fixed. Origin (`Z`): the origin point. Cell symbol: `a` only the first pick moves, `b` only the second, `X` both, `-` neither, `R` refused. `Fusion/ours`; a trailing `*` = they differ.', '');
P('**Reductions (the full cross product is about 40 000 cells).** Line-line groups: free-standing line x free-standing line at the 8 levels (10 with `o`, `m` in the point groups), every other line-like kind (construction line `C`, polygon side `S`, rect side `R`) only against a plain line and against itself, at 2 levels (S: 1). A plain line against a non-line operand: levels 0, 3, 4, 7. Point groups: points of a line (end), rect corner, circle / arc centre, free point and the origin; the compound kinds only free. Not covered: bezier (not constrainable in ours: its endpoints are plain joints, covered as points; Fusion cannot express our cubic), polygon side and fillet arc beyond level 0 / `c`, B-kinds crossed with each other beyond the listed pairs, the point-to-line distance dimension (ours projects a helper joint: finding NEW-1), diameter dimension (no creation path), concentric (not in `CONSTRAINT_TYPES`; a coincident of two centres is the same cell). Fusion exposes no DOF count, only `isFullyConstrained` per entity and per sketch: the DOF before / after is therefore **not** recorded for Fusion (ours: nullity, see the 512 matrix).', '');

// ---- summary
const groups = GROUPS.map(g => g.id);
const sumRows = [];
for (const g of groups) {
  const cs = all.filter(c => c.cell.group === g);
  let same = 0, fRefOurs = 0, oursRefF = 0;
  for (const c of cs) { if (cellKey(c.f, c.o).same) same++; if (!c.f.accepted && c.o.accepted) fRefOurs++; if (c.f.accepted && !c.o.accepted) oursRefF++; }
  sumRows.push(`| ${g} | ${cs.length} | ${same} | ${fRefOurs} | ${oursRefF} |`);
}
P('| constraint / dimension | cells | same as Fusion | Fusion refuses, ours accepts | ours refuses, Fusion accepts |', '|---|---|---|---|---|', ...sumRows, '');

// ---- one rule per constraint (line-line grid)
{
  const rows = [];
  for (const g of groups) {
    if (!all.some(c => c.cell.group === g && c.cell.kinds.join('') === 'LL')) continue;
    const r = fitRule(g);
    const byRank = {}; r.levels.forEach((l, i) => (byRank[r.rank[i]] ||= []).push(l));
    const order = Object.keys(byRank).map(Number).sort((a, b) => a - b).map(k => '{' + byRank[k].join(',') + '}').join(' < ');
    rows.push(`| ${g} | ${order} | ${r.total - r.bad}/${r.total} | ${r.contradict.join(', ') || '-'} |`);
  }
  P('**One rule per constraint** (line x line, Fusion). Rank the 8 (10) levels of the operands; the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. Ranks are not DOF counts: a line with one end fixed (4) is the first to give way (it pivots about the fixed end), then the free-ish ones, direction-held lines (H/V, full) always stay.', '', '| constraint | rank order (lowest moves first) | cells predicted | contradicting cells |', '|---|---|---|---|', ...rows, '');
}

// ---- the declared table the app reads (task 525)
{
  const rows = Object.entries(WHO_MOVES).map(([k, e]) => `| ${k} | ${e.tiers.map(t => '{' + t.join(', ') + '}').join(' < ')} | ${e.tie} | ${e.agree}/${e.cells} |`);
  P('**The who-moves table the app reads** (task 525: `packages/core/creation-placement-table.js`, generated by `scripts/fusion-oracle/fit-placement-table.mjs` from these cells and the 315 scenarios; a test asserts it equals the fit). The classes come from ONE classifier (`creation-placement.js` holdClass: the shape family and what holds it, from the solver\'s joint freedom and the constraints on it). The lowest tier gives way; inside one tier (or for a class the table does not rank) the tie rule says which pick gives way. Then the giving operand is PLACED (one rigid / similarity move of it, or the least-change solve of it alone) before the solve.', '', '| table key | tiers (lowest gives way first) | tie: gives way | one-mover cells predicted |', '|---|---|---|---|', ...rows, '');
}

// ---- origin
{
  const z = all.filter(c => c.cell.kinds.includes('Z'));
  const zOk = z.every(c => c.o.originOk && (!c.f.accepted || c.f.originOk));
  const allOk = all.every(c => c.o.originOk && (!c.f.accepted || c.f.originOk));
  P('#### The origin as an operand', '');
  P(`Ours identifies the origin as the joint \`j_origin\` (created by \`createEngine\`: \`{ x: 0, y: 0, fixed: true }\`); a constraint names it like any joint (\`joints: ['j_origin', ...]\`) and the solver skips fixed joints, so it can only be a point of a constraint, never an entity. Fusion's is \`sketch.originPoint\` (a SketchPoint, \`isFixed\` true, read-only geometry; \`gc.addCoincident(sk.originPoint, p)\` is how a constraint reaches it). **${z.length} cells have the origin as A or B (both pick orders)** with every constraint that takes a point (coincident, point-on-line / on circle, midpoint with the origin as the midpoint, H / V between two points, every point-point dimension mode) and the point kinds line end, rect corner, circle / arc centre, free point; plus the levels \`o\` (a line end coincident with the origin) and \`m\` (a line centred on the origin by midpoint). **The origin never moved and was never deleted in any of the ${all.length} cells, in Fusion (\`originPoint\` read back after every act) and in ours (\`j_origin\` still in \`joints\` at 0,0): ${allOk ? 'confirmed' : 'VIOLATED, see the test output'}** (origin cells alone: ${zOk ? 'ok' : 'violated'}). The N-F1 bug (a fillet on an origin corner deletes the origin) is not reached by these cells: no cell applies a fillet at the origin, so no cell is marked "caused by N-F1" (it stays a finding of the 512 audit).`, '');
  P('Axes: ours has NO axis entities (no X / Y axis line in the sketch model: only the origin joint), so "constrain to an axis" cannot be run in ours. Fusion probe (one call, not stored): `sketch.project(root.xConstructionAxis)` gives a SketchLine; a coincident of a free line end with it moves only that point onto the axis (end (20,20) became (20,0), the other end stayed); parallel to it rotates the free line about its midpoint. A user can still get an axis in ours as an ordinary line through the origin (levels `o` / `7`).', '');
}

// ---- per constraint
for (const g of groups) {
  const cs = all.filter(c => c.cell.group === g);
  P(`#### ${g}`, '');
  const ll = cs.filter(c => c.cell.kinds.join('') === 'LL' || (c.cell.kinds.length === 1 && c.cell.kinds[0] === 'L'));
  // rule from the L-L grid
  if (cs.some(c => c.cell.kinds.join('') === 'LL')) {
    const r = fitRule(g);
    const groupsByRank = {};
    r.levels.forEach((l, i) => (groupsByRank[r.rank[i]] ||= []).push(l));
    const order = Object.keys(groupsByRank).map(Number).sort((a, b) => a - b).map(k => '{' + groupsByRank[k].join(',') + '}').join(' < ');
    P(`Fusion's rule (fitted on the ${r.total} accepted one-mover cells of the free-standing line pair): rank the levels ${order} (lowest moves first); the operand with the LOWER rank is the one that moves, a tie means the SECOND pick moves. It predicts ${r.total - r.bad} of ${r.total}${r.bad ? `; contradicting cells: ${r.contradict.join(', ')}` : ' (no contradiction)'}${r.both ? `; ${r.both} cells move both operands and are outside the rule` : ''}. In words: ${wordsFor(g, r)}`, '');
    const lv = [...new Set(cs.filter(c => c.cell.kinds.join('') === 'LL').map(c => c.cell.levels[0]))];
    P(`Grid, line (A) x line (B), \`Fusion/ours\`:`, '', `| A \\ B | ${lv.map(l => l + ' ' + (LV[l] || '')).join(' | ')} |`, `|---|${lv.map(() => '---').join('|')}|`);
    for (const a of lv) P(`| ${a} ${LV[a] || ''} | ${lv.map(b => { const c = cs.find(x => x.cell.kinds.join('') === 'LL' && x.cell.levels[0] === a && x.cell.levels[1] === b); if (!c) return ''; const f = sym(c.f), o = sym(c.o); return `${f}/${o}${f === o ? '' : '*'}`; }).join(' | ')} |`);
    P('');
  } else if (g === 'horizontal-line' || g === 'vertical-line' || g === 'dim-length' || g === 'dim-radius') {
    P(`Single operand: ${cs.map(c => `${c.cell.kinds[0]}@${c.cell.levels[0]}: F ${cellKey(c.f, c.o).fusion} | ours ${cellKey(c.f, c.o).ours}`).join('; ')}`, '');
  }
  // per kind pair
  const pairs = [...new Set(cs.map(c => c.cell.kinds.join('')))];
  const tally = (list, pick) => { const t = { a: 0, b: 0, X: 0, '-': 0, R: 0 }; for (const c of list) t[sym(pick(c))]++; return Object.entries(t).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(' '); };
  const how = (list, pick) => { const t = {}; for (const c of list) { const r = pick(c); if (!r.accepted) continue; for (const w of [r.mv.X, r.mv.Y]) if (w && w.m) t[w.how] = (t[w.how] || 0) + 1; } return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}:${n}`).join(' '); };
  P('| kinds (A,B) | cells | same | Fusion who-moves | ours who-moves | how Fusion moves it | how ours moves it |', '|---|---|---|---|---|---|---|');
  for (const pk of pairs) {
    const list = cs.filter(c => c.cell.kinds.join('') === pk);
    P(`| ${pk} | ${list.length} | ${list.filter(c => cellKey(c.f, c.o).same).length} | ${tally(list, c => c.f)} | ${tally(list, c => c.o)} | ${how(list, c => c.f)} | ${how(list, c => c.o)} |`);
  }
  P('');
}
P('Kind letters: L line, C construction line, S polygon side, R rect side, O circle, A arc, F fillet arc, P point, Z origin. Who-moves letters as above (`a` first pick only, `b` second only, `X` both, `-` none, `R` refused). `how`: translate, rotate (rigid), stretch (a line changes length), `one end` (one endpoint of a line moves: rotate / stretch about the other), scale, deform, radius, `+radius` (the radius changed as well).', '');
P('<!-- graded:end -->');

function wordsFor(g, r) {
  const rk = (l) => r.rank[r.levels.indexOf(l)];
  const lowest = Math.min(...r.rank);
  const low = r.levels.filter(l => rk(l) === lowest).join(', ');
  const high = r.levels.filter(l => rk(l) === Math.max(...r.rank)).join(', ');
  return `the operand held least (level${low.includes(',') ? 's' : ''} ${low}) is the one that gives way, the most held (${high}) always stays; two operands at the same rank: the first pick stays and the second is moved.`;
}

const docPath = path.join(ROOT, 'docs/FUSION-COMPARISON.md');
let doc = fs.readFileSync(docPath, 'utf8');
if (!doc.includes('<!-- graded:begin -->')) doc = doc.replace('<!-- which-moves:end -->', '<!-- which-moves:end -->\n\n## Which geometry moves: graded\n\n<!-- graded:begin -->\n<!-- graded:end -->');
doc = doc.replace(/<!-- graded:begin -->[\s\S]*<!-- graded:end -->/, () => out.join('\n'));
fs.writeFileSync(docPath, doc);
console.log('graded section written, ' + out.length + ' lines');
