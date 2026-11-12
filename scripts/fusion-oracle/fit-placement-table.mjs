// TASK 525 -- fits the WHO-MOVES table (packages/core/creation-placement-table.js) to the recorded Fusion cells, so it can be re-derived
// whenever Fusion is re-recorded.  node scripts/fusion-oracle/fit-placement-table.mjs [--check]
//   (no flag) rewrites packages/core/creation-placement-table.js;  --check only prints the fit.
// Sources: tests/fixtures/fusion-oracle/which-moves-graded.json (2438 cells) and which-moves.json (315 scenarios). Every cell is built in OUR
// sketch (graded.js materialize / which-moves.js buildOurs), its two operands are read and classified by the SAME functions the app uses
// (creationOperands, holdClass), and Fusion's answer says which one gave way. Only accepted cells where exactly ONE operand moved count.
// The fit: one rank per hold class and table key; a class ranked LOWER gives way; equal ranks (a tie) move the SECOND pick. Each
// observation is a difference constraint (first gave way: r(first) + 1 <= r(second); second gave way: r(second) <= r(first)); the ranks are
// the longest-path solution (smallest ranks), and an observation set that cannot be satisfied loses its least-supported constraint in each
// contradicting cycle; the cells the tiers then do not predict are listed per key (`differ`), and the CLI flags a pair of classes on which
// the two fixtures disagree.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCells, materialize, fusionMove } from '../../tests/harness/fusion-oracle/graded.js';
import { buildScenarios, buildOurs, actOf, dimActOf, movedSet, MOVE_TOL } from '../../tests/harness/fusion-oracle/which-moves.js';
import { ConstraintManager } from '../../packages/core/constraint-manager.js';
import { creationOperands, holdClass, freedomOf } from '../../packages/core/creation-placement.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GRADED = 'tests/fixtures/fusion-oracle/which-moves-graded.json';
const TABLE = 'packages/core/creation-placement-table.js';
const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const muted = (f) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return f(); } finally { console.error = e; console.warn = w; } };

// classify the creation as the app will see it: key, operand classes, operands. A dimension is first placed at its measured value (the
// Dimension tool), then its edit is what places the mover: it is classified as that placed constraint.
function classify(S, type, params, isDim) {
  let norm = ConstraintManager.normalizeParams(type, params);
  if (isDim) {
    const c = muted(() => ConstraintManager.createConstraint(S.state, type, params, { source: 'audit' }));
    if (!c || typeof c !== 'object' || c.isDriven || c.driven) return null;
    norm = c;
  }
  const co = creationOperands(S.state, type, norm);
  if (!co) return null;
  const fr = freedomOf(S.state);
  return { key: co.key, ops: co.ops, cls: co.ops.map(op => holdClass(S.state, fr, op)) };
}

// observations from the graded fixture: { key, f, s, m: 'first' | 'second', id }
export function gradedObservations() {
  const gx = load(GRADED);
  const out = [];
  for (const cell of buildCells()) {
    const fr = gx.cells[cell.id];
    if (!fr || fr.setupError || cell.kinds.length !== 2) continue;
    const M = muted(() => materialize(cell));
    if (M.na) continue;
    const k = classify(M.S, M.act.type, M.act.dim ? { ...M.act.params, value: M.measured } : M.act.params, !!M.act.dim);
    if (!k) continue;
    const f = fusionMove(M, { initial: fr.initial, steps: [fr.step] });
    if (!f.accepted) continue;
    const x = f.mv.X.m > 0, y = f.mv.Y.m > 0;
    if (x === y) continue;
    const inComp = (op, O) => (op.kind === 'shape' ? O.comp.shapes.includes(op.id) : O.comp.joints.includes(op.id));
    const sideOf = (op) => (inComp(op, M.X) ? 'X' : inComp(op, M.Y) ? 'Y' : M.X.k === 'Z' ? 'X' : 'Y');
    if (sideOf(k.ops[0]) === sideOf(k.ops[1])) continue;
    out.push({ key: k.key, f: k.cls[0], s: k.cls[1], m: sideOf(k.ops[0]) === (x ? 'X' : 'Y') ? 'first' : 'second', id: cell.id });
  }
  return out;
}

// observations from the 315-scenario fixture (the check: a table fitted on the 2438 cells must not conflict with these)
export function scenarioObservations() {
  const fx = load('tests/fixtures/fusion-oracle/which-moves.json');
  const out = [];
  for (const sc of buildScenarios()) {
    const f = fx.results[sc.id];
    if (!f || f.setupError || !f.accepted) continue;
    const b = muted(() => buildOurs(sc));
    const geo = actOf(sc, b.built), act = geo || dimActOf(sc, b.built, b.S);
    if (!act) continue;
    const k = classify(b.S, act.type, act.params, !geo);
    if (!k) continue;
    const mv = movedSet(f.before, f.after, MOVE_TOL);
    const moved = Object.keys(mv).filter(n => mv[n]);
    if (moved.length !== 1) continue;
    const owner = (op) => Object.keys(b.built).find(n => (op.kind === 'shape' ? b.built[n].shape === op.id : b.built[n].joints.includes(op.id)));
    if (owner(k.ops[0]) === owner(k.ops[1])) continue;      // one entity (H / V of a line, its length, a radius): no pair to rank
    out.push({ key: k.key, f: k.cls[0], s: k.cls[1], m: owner(k.ops[0]) === moved[0] ? 'first' : 'second', id: sc.id });
  }
  return out;
}

// ---- the fit (deterministic)
function fitKey(obs, tie) {
  const classes = [...new Set(obs.flatMap(o => [o.f, o.s]))].sort();
  // aggregated constraints u -> v with weight w: r(v) >= r(u) + w
  const edges = new Map();
  const add = (u, v, w, id) => { const k = `${u}\u0000${v}\u0000${w}`; const e = edges.get(k) || { u, v, w, ids: [] }; e.ids.push(id); edges.set(k, e); };
  const contradicts = [];
  for (const o of obs) {
    if (o.f === o.s) { if (o.m !== tie) contradicts.push(o.id); continue; }   // same class: a tie, decided by the tie rule
    // the operand that gave way ranks lower (or equal, when the tie rule names it)
    if (o.m === 'first') add(o.f, o.s, tie === 'first' ? 0 : 1, o.id); else add(o.s, o.f, tie === 'second' ? 0 : 1, o.id);
  }
  for (;;) {
    const r = Object.fromEntries(classes.map(c => [c, 0])), pred = {};
    let last = null;
    const E = [...edges.values()];
    for (let i = 0; i <= classes.length; i++) {
      last = null;
      for (const e of E) if (r[e.u] + e.w > r[e.v]) { r[e.v] = r[e.u] + e.w; pred[e.v] = e; last = e.v; }
      if (!last) break;
    }
    if (!last) {
      const levels = [...new Set(Object.values(r))].sort((a, b) => a - b);
      const tiers = levels.map(l => classes.filter(c => r[c] === l));
      return { tiers, contradicts: contradicts.sort() };
    }
    // a contradicting cycle: walk back into it, drop its least-supported constraint (ties: the later key in sort order)
    let v = last;
    for (let i = 0; i < classes.length; i++) v = pred[v].u;
    const cyc = []; let x = v;
    do { cyc.push(pred[x]); x = pred[x].u; } while (x !== v && cyc.length <= classes.length);
    const drop = cyc.slice().sort((a, b) => a.ids.length - b.ids.length || (`${b.u}${b.v}` < `${a.u}${a.v}` ? -1 : 1))[0];
    contradicts.push(...drop.ids);
    edges.delete(`${drop.u}\u0000${drop.v}\u0000${drop.w}`);
  }
}
// the same reading as creation-placement.js firstGivesWay: a lower tier gives way; the same tier, or a class the tiers do not rank, follows the tie rule
const predictFirst = (e, f, s) => { const rf = e.tiers.findIndex(t => t.includes(f)), rs = e.tiers.findIndex(t => t.includes(s)); return rf >= 0 && rs >= 0 && rf !== rs ? rf < rs : e.tie === 'first'; };
export const agrees = (e, o) => predictFirst(e, o.f, o.s) === (o.m === 'first');

export function fitTable(obs = [...gradedObservations(), ...scenarioObservations()]) {
  const byKey = {};
  for (const o of obs) (byKey[o.key] ||= []).push(o);
  const table = {};
  for (const key of Object.keys(byKey).sort()) {
    // the tie rule is fitted too: the one that leaves fewer cells unpredicted (Fusion's default, the second gives way, on equality)
    const fits = ['second', 'first'].map(tie => { const e = { tie, tiers: fitKey(byKey[key], tie).tiers }; return { e, miss: byKey[key].filter(o => !agrees(e, o)).map(o => o.id).sort() }; });
    const best = fits[1].miss.length < fits[0].miss.length ? fits[1] : fits[0];
    table[key] = { tie: best.e.tie, tiers: best.e.tiers, cells: byKey[key].length, agree: byKey[key].length - best.miss.length, differ: best.miss };
  }
  return table;
}

// the class pairs (in pick order) on which the two fixtures disagree about who gives way
export function fixtureConflicts(graded, scen) {
  const sig = (o) => `${o.key}|${o.f}|${o.s}`;
  const g = new Map();
  for (const o of graded) (g.get(sig(o)) || g.set(sig(o), new Set()).get(sig(o))).add(o.m);
  return scen.filter(o => g.has(sig(o)) && !g.get(sig(o)).has(o.m)).map(o => ({ ...o, graded: [...g.get(sig(o))].join('/'), gradedIds: graded.filter(x => sig(x) === sig(o)).map(x => x.id) }));
}

export function tableSource(table, gx, sx) {
  return `// GENERATED by scripts/fusion-oracle/fit-placement-table.mjs from ${GRADED} (Fusion ${gx.fusion}, recorded ${gx.date})\n`
    + `// and tests/fixtures/fusion-oracle/which-moves.json (Fusion ${sx.fusion}, recorded ${sx.date}). Do not edit by hand: re-run the script (a test\n// checks this file equals its output).\n`
    + '// Per table key: tiers of hold classes (creation-placement.js holdClass), LOWEST tier gives way first; the same tier is a tie and the\n'
    + '// SECOND pick gives way. cells = one-mover Fusion cells of the key, agree = cells the tiers predict, differ = the cells they do not.\n'
    + `export const WHO_MOVES = ${JSON.stringify(table, null, 1)};\n`;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const graded = gradedObservations(), scen = scenarioObservations();
  const table = fitTable([...graded, ...scen]);
  for (const [k, v] of Object.entries(table)) console.log(`${k.padEnd(22)} tie: ${v.tie.padEnd(6)} gives way, fits ${v.agree}/${v.cells}   ${v.tiers.map(t => '{' + t.join(', ') + '}').join(' < ')}${v.differ.length ? '\n      differ: ' + v.differ.join('  ') : ''}`);
  const cf = fixtureConflicts(graded, scen);
  console.log(`fixture conflicts (same key and class pair in pick order, the 315 and the 2438 fixture disagree on who gives way): ${cf.length}`);
  for (const o of cf) console.log(`   ${o.id}: ${o.f} (first) vs ${o.s} (second): 315 moved the ${o.m}, graded moved the ${o.graded} in ${o.gradedIds.join(' ')}`);
  if (!process.argv.includes('--check')) { fs.writeFileSync(path.join(ROOT, TABLE), tableSource(table, load(GRADED), load('tests/fixtures/fusion-oracle/which-moves.json'))); console.log('written ' + TABLE); }
}