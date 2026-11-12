#!/usr/bin/env node
// scripts/coverage-audit.cjs -- TASK 512 part 1. Runs the constraint x geometry matrix (tests/harness/coverage/matrix-*.js) and prints the grid, the
// per-row summary and the NEW finding repros. The assertions live in tests/coverage-matrix.test.js; the report is docs/COVERAGE-AUDIT.md.
//   node scripts/coverage-audit.cjs            the whole matrix
//   node scripts/coverage-audit.cjs perpend    only the rows whose id contains the text
//   node scripts/coverage-audit.cjs --cells    also list every failing cell with its issues
// PlaneGCS prints "Sketcher::Redundant..." lines to stdout when it finds a redundant constraint: that is the oracle talking, not an error.
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const url = (rel) => pathToFileURL(path.join(root, rel)).href;

(async () => {
  const M = await import(url('tests/harness/coverage/matrix-run.js'));
  const B = await import(url('tests/harness/coverage/matrix-build.js'));
  const { NEW_FINDINGS } = await import(url('tests/harness/coverage/matrix-findings.js'));
  const args = process.argv.slice(2);
  const listCells = args.includes('--cells');
  const want = args.find(a => !a.startsWith('--'));
  const rows = M.ROWS.filter(r => !want || r.id.includes(want));
  const cells = await M.runMatrix({ rows });
  for (const c of cells) { const v = M.classify(c); c.verdict = v.v; c.also = v.also || []; }

  // one character per cell and variant. P pass, n refused by the UI (checked), - no meaningful sketch, 1-6 = round-1 finding F1-F6, A-H = NEW-1..NEW-8, ? unexplained
  const ch = (v) => (v === 'PASS' ? 'P' : v === 'N/A' ? 'n' : v === 'NA-BUILD' ? '-' : /^F\d$/.test(v) ? v[1] : /^NEW-\d$/.test(v) ? String.fromCharCode(64 + Number(v[4])) : '?');
  console.log('LEGEND  variants per cell in this order: sep shared locked dimmed');
  console.log('        P pass   n refused by the UI (the real tool refused, document untouched)   - no meaningful sketch for the cell');
  console.log('        1..6 = F1..F6 of docs/CONSTRAINT-AUDIT.md   A..H = NEW-1..NEW-8 of docs/COVERAGE-AUDIT.md   ? unexplained\n');
  const letters = B.KINDS.map(k => k.k);
  for (const row of rows) {
    const cols = M.columnsFor(row);
    console.log(`=== ${row.label}  [${row.id}]  expected DOF removed (sep): ${[...new Set(cols.map(c => row.nominal(c[0], c[1] || c[0])))].join('/')}`);
    for (let i = 0; i < cols.length; i += 15) {
      const part = cols.slice(i, i + 15);
      console.log('  ' + part.map(c => c.join('').padEnd(5)).join(' '));
      console.log('  ' + part.map(c => B.VARIANTS.map(v => { const x = cells.find(k => k.row === row.id && k.cols === c.join('') && k.variant === v); return x ? ch(x.verdict) : ' '; }).join('').padEnd(5)).join(' '));
    }
    const mine = cells.filter(c => c.row === row.id);
    const tally = {}; for (const c of mine) tally[c.verdict] = (tally[c.verdict] || 0) + 1;
    console.log('  ' + Object.entries(tally).sort().map(([k, n]) => `${k}=${n}`).join('  ') + '\n');
  }
  const all = {}; for (const c of cells) all[c.verdict] = (all[c.verdict] || 0) + 1;
  console.log('TOTAL ' + cells.length + ' cells: ' + Object.entries(all).sort().map(([k, n]) => `${k}=${n}`).join('  '));
  if (listCells) for (const c of cells.filter(x => !['PASS', 'N/A', 'NA-BUILD'].includes(x.verdict))) console.log(`${c.verdict.padEnd(8)} ${c.row} ${c.cols}/${c.variant}  ${c.issues.join('+')}  ${(c.notes || []).filter(Boolean).join(' | ').slice(0, 160)}`);
  if (!want) {
    console.log('\nNEW FINDING REPROS (ok=true means the app is right; every one is expected to be false today)');
    for (const f of NEW_FINDINGS) { const r = await f.run(); console.log(`${f.id} [${f.severity}] ok=${r.ok}  ${f.title}\n    observed: ${r.observed}`); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
