// gate: exclusive
// TASK 531 -- EXTREME ARCS audit (measuring; diagnose, do not fix). 24 arc variants (very short / long sweeps, tiny and huge radius, fillet arcs) x every
// constraint and dimension an arc takes x the hold states sep / shared / locked / dimmed, each cell through the real tool handlers (tests/harness/coverage/arcs-*.js).
// Passing cells must pass; every class of failure is a KNOWN entry (EA-n, tests/harness/coverage/arcs-findings.js) that fails loudly when it stops failing.
// Report: docs/COVERAGE-AUDIT.md, section "Extreme arcs".   node tests/extreme-arcs.test.js --cell <variant> <row> <state>   prints one cell;  --table  prints the doc table.
import { VARIANTS, CONTROL, FILLET_CONTROL, variant, buildArc, measureArc } from './harness/coverage/arcs-variants.js';
import { ROWS, STATES, runArcMatrix, runArcCell } from './harness/coverage/arcs-rows.js';
import { KNOWN, INHERITED, classifyArc, REPRO_CELL, repro, ui10 } from './harness/coverage/arcs-findings.js';
import { uiFacts, TOLERANCES } from './harness/coverage/arcs-ui.js';
import * as L from './harness/audit/lib.js';

const args = process.argv.slice(2);
if (args[0] === '--cell') {
  const rec = await runArcCell(ROWS.find(r => r.id === args[2]), variant(args[1]), args[3] || 'sep');
  console.log(JSON.stringify({ ...rec, classified: classifyArc(rec) }, null, 1));
  process.exit(0);
}

let failures = 0;
const fail = (m) => { failures++; console.log('FAIL  ' + m); };
const ok = (name, cond, detail = '') => { if (cond) console.log('ok    ' + name); else fail(name + '  ' + detail); };
const t0 = Date.now();

// ---------------------------------------------------------------------------------------------------------------- the variants are what the data says
for (const v of VARIANTS) {
  const S = L.newSketch();
  const X = buildArc(S, v);
  S.engine.solve(L.ITER);
  const m = measureArc(S, X.shape);
  const wantSweep = v.via === 'tool' ? v.sweep : (v.corner >= 90 ? -(180 - v.corner) : -(180 - v.corner));
  ok(`variant ${v.id}: radius ${v.via === 'tool' ? v.R : v.r}`, Math.abs(m.R - (v.via === 'tool' ? v.R : v.r)) < 1e-6 * Math.max(1, m.R), `got ${m.R}`);
  ok(`variant ${v.id}: sweep ${wantSweep.toFixed(3)} deg, signed (${v.via === 'tool' ? 'real arc tool' : 'real fillet'})`, Math.abs(m.signedDeg - wantSweep) < 1e-3, `got ${m.signedDeg}`);
  ok(`variant ${v.id}: the bare arc is a valid arc (finite, circular, flag coherent, path)`, m.finite && m.pathOk && m.flagCoherent && Math.abs(m.R - m.Re) < 1e-6 * Math.max(1, m.R), JSON.stringify({ R: m.R, Re: m.Re, coh: m.flagCoherent }));
}

// ---------------------------------------------------------------------------------------------------------------- the grid
const cells = await runArcMatrix({ variants: VARIANTS });
const counts = new Map();
for (const c of cells) { const k = classifyArc(c); c.verdict = k.v; c.ids = k.ids; c.why = k.why; counts.set(k.v === 'UNCLASSIFIED' || k.v === 'PASS' || k.v === 'N/A' || k.v === 'NA-BUILD' ? k.v : 'FAIL', (counts.get(k.v === 'UNCLASSIFIED' || k.v === 'PASS' || k.v === 'N/A' || k.v === 'NA-BUILD' ? k.v : 'FAIL') || 0) + 1); }
const perId = new Map();
for (const c of cells) for (const id of c.ids) perId.set(id, (perId.get(id) || 0) + 1);
console.log(`extreme arcs: ${cells.length} cells (${VARIANTS.length} variants x ${ROWS.length} rows x ${STATES.length} states): ` + [...counts].sort().map(([k, n]) => `${k}=${n}`).join(' '));
console.log('cells per finding: ' + [...perId].sort().map(([k, n]) => `${k}=${n}`).join(' '));

if (args[0] === '--table') {
  const cellOf = (r, v) => {
    const cs = cells.filter(c => c.row === r.id && c.variant === v.id);
    const ids = new Set(); let any = false;
    for (const c of cs) { if (c.verdict === 'PASS' || c.verdict === 'N/A') any = true; for (const id of c.ids) ids.add(id.replace(/^EA-/, '')); }
    return ids.size ? [...ids].sort((a, b) => (+a || 99) - (+b || 99)).join(',') : any ? '.' : '-';
  };
  console.log('| row \\ variant | ' + VARIANTS.map(v => v.id).join(' | ') + ' |');
  console.log('|---|' + VARIANTS.map(() => '---').join('|') + '|');
  for (const r of ROWS) console.log(`| ${r.id} | ` + VARIANTS.map(v => cellOf(r, v)).join(' | ') + ' |');
  process.exit(0);
}

ok('the grid is complete: variants x rows x hold states', cells.length === VARIANTS.length * ROWS.length * STATES.length, String(cells.length));
ok('there are PASS cells and N/A cells to check', (counts.get('PASS') || 0) > 1500 && (counts.get('N/A') || 0) > 0, JSON.stringify([...counts]));
const unclassified = cells.filter(c => c.verdict === 'UNCLASSIFIED');
ok('no cell fails for a reason no finding explains', unclassified.length === 0, unclassified.slice(0, 5).map(c => `${c.variant} ${c.row}/${c.state} ${c.why}`).join('; '));
const badNA = cells.filter(c => c.verdict === 'N/A' && !c.refusedCleanly);
ok('every refused cell left the document untouched', badNA.length === 0, badNA.slice(0, 3).map(c => `${c.variant} ${c.row} ${c.state}`).join('; '));
for (const id of Object.keys(KNOWN)) {
  const n = perId.get(id) || 0;
  if (n > 0) console.log(`known ${id} [${KNOWN[id].severity}] ${KNOWN[id].title}  ${n} cell(s)`);
  else fail(`KNOWN entry ${id} now has NO failing cell, delete it (${KNOWN[id].title})`);
}
for (const id of perId.keys()) if (!(id in KNOWN) && !(id in INHERITED)) fail(`cells classified ${id} but it is not a KNOWN entry`);
console.log('inherited (round-1) cells tolerated: ' + Object.keys(INHERITED).map(k => `${k}=${perId.get(k) || 0}`).join(' '));

// the ordinary control arc: only the zero-sweep finding and the inherited round-1 findings may fail (a failure here means the harness, not the arc, is at fault)
for (const ctl of [CONTROL, FILLET_CONTROL]) {
  const bad = cells.filter(c => c.variant === ctl && c.verdict !== 'PASS' && c.verdict !== 'N/A' && c.verdict !== 'NA-BUILD' && c.ids.some(id => !['EA-1', 'F4', 'F5', 'F6'].includes(id)));
  ok(`control ${ctl}: only EA-1 (own-ends coincident) and round-1 findings fail`, bad.length === 0, bad.map(c => `${c.row}/${c.state} ${c.verdict}`).join('; '));
}

// the explicit question: is a zero-sweep collapse accepted anywhere? Task 550: findCollapsedShape measures the arc's ends (chord and sweep), so a
// constraint or dimension whose solve brings an arc's two ends together is REFUSED at creation (Fusion: "failed to solve"). What remains (EA-1)
// is outside creation and edits: a DRAG (no refusal while dragging). A fillet RADIUS edit goes through findCollapsedShape too (its legs excepted).
const zero = cells.filter(c => c.issues.includes('zero-sweep'));
ok('no constraint creation leaves an arc at zero sweep (task 550; was EA-1 in 45 cells): every accepted zero-sweep is after a later drag', zero.length === 0, zero.map(c => `${c.variant} ${c.row}/${c.state}`).join('; '));
const later = cells.filter(c => c.issues.some(i => /^(edit[0-9.]+|drag)-zero-sweep$/.test(i)));
ok('no dimension edit leaves an arc at zero sweep (task 550: fillet radius edits go through findCollapsedShape too)', !cells.some(c => c.issues.some(i => /^edit[0-9.]+-zero-sweep$/.test(i))), later.map(c => `${c.variant} ${c.row}/${c.state}`).join('; '));
console.log(`zero-sweep after a later drag in ${later.length} cell(s): rows ${[...new Set(later.map(c => c.row))].join(', ')}; variants ${[...new Set(later.map(c => c.variant))].join(', ')}`);

// ---------------------------------------------------------------------------------------------------------------- repros (each is expected to show its finding today)
for (const id of Object.keys(REPRO_CELL)) {
  const r = await repro(id);
  if (!r.has) fail(`KNOWN repro ${id} (${r.cell}) no longer shows the finding (verdict ${r.verdict}); delete the entry`);
  else console.log(`known ${id} repro: node tests/extreme-arcs.test.js --cell ${r.cell}   -> ${r.verdict} | g0 ${JSON.stringify(r.g0)} g1 ${JSON.stringify(r.g1)}`);
}
// ---------------------------------------------------------------------------------------------------------------- the UI facts (findSnap is the one pick for hover / click / select)
for (const [k, val] of Object.entries(TOLERANCES)) console.log(`tolerance: ${k} = ${val}`);
const facts = VARIANTS.map(uiFacts);
ok('the renderer gets a valid path (no NaN / Infinity) for every variant', facts.every(f => f.pathOk), facts.filter(f => !f.pathOk).map(f => f.variant).join());
ok('the large-arc flag is right at 179 / 180 / 181 / -181 degrees as BUILT by the tool', ['s179cw', 's180cw', 's181cw', 's181ccw'].every(id => facts.find(f => f.variant === id).flagCoherent));
const sub = facts.filter(f => f.chord < 0.05);
ok('sub-tolerance arcs (chord < GEOMETRY_TOLERANCE 0.05): both ends are pickable (some pixels return the end joint)', sub.every(f => f.endPickable), sub.filter(f => !f.endPickable).map(f => f.variant).join());
for (const f of sub) console.log(`ui: ${f.variant} chord ${f.chord.toPrecision(3)}: of the 225 pixels around the END joint ${f.endPixelsReturnEnd} pick the end, ${f.endPixelsReturnStart} pick the START (a click on a sub-pixel chord is a coin flip)`);
const u = ui10();
ok('the arc is picked only on its drawn sweep (EA-10 fixed in task 550): the mouse on its circle outside the sweep does not pick it', u.ok, u.observed);

const total = (Date.now() - t0) / 1000;
ok('the whole audit runs in under 60 s', total < 60, total.toFixed(1) + ' s');
console.log(`extreme-arcs: ${failures === 0 ? 'passed' : failures + ' failure(s)'} in ${total.toFixed(1)}s`);
process.exit(failures === 0 ? 0 : 1);
