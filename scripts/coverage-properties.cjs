#!/usr/bin/env node
// scripts/coverage-properties.cjs -- TASK 514. Prints the tables of docs/COVERAGE-AUDIT.md "Properties": per-drawing summary, the randomised
// property tallies, the drag and round-trip results, the new findings. Assertions live in tests/coverage-properties.test.js.
//   node scripts/coverage-properties.cjs            (about 25 s)
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const url = (rel) => pathToFileURL(path.join(root, rel)).href;
const pad = (v, n) => String(v).padEnd(n);

(async () => {
  const P = await import(url('tests/harness/coverage/prop-lib.js'));
  const { runProperties, INVARIANTS } = await import(url('tests/harness/coverage/prop-random.js'));
  const { dragProperties } = await import(url('tests/harness/coverage/prop-drag.js'));
  const { roundTrip } = await import(url('tests/harness/coverage/prop-roundtrip.js'));
  const { FINDINGS } = await import(url('tests/harness/coverage/prop-findings.js'));
  const drawings = await P.loadDrawings();
  console.log('\n== drawings (light pipeline)');
  console.log(pad('drawing', 22) + ['joints', 'constr', 'nullity', 'panel', 'fd', 'planegcs', 'verifier', 'refused', 'demoted', 'jacobian rows != fd'].map(h => pad(h, 11)).join(''));
  for (const d of drawings) {
    const { summary: s } = await P.summarize(d.mod);
    console.log(pad(s.name, 22) + [s.joints, s.constraints, s.nullity, s.panel, s.fd, s.planegcs ? s.planegcs.dof : '-', s.verifier.toExponential(1), s.refused.length, s.demoted.length, s.jacobianErrors.join(',') || '-'].map(v => pad(v, 11)).join(''));
  }
  console.log('\n== randomised properties');
  const R = runProperties({});
  console.log(JSON.stringify(R.totals), JSON.stringify(R.geoKinds));
  for (const [inv, t] of Object.entries(R.tally)) console.log(`${inv} ${pad(INVARIANTS[inv], 78)} ${t.pass}/${t.cases}  explained: ${JSON.stringify(t.attributed)}  unexplained seeds: ${t.new.map(f => f.seed).join(',') || '-'}`);
  console.log('op kinds (applied / refused / demoted to reference / not applicable):');
  for (const [k, v] of Object.entries(R.kinds)) console.log(`  ${pad(k, 16)} ${v.applied} / ${v.refused} / ${v.demoted} / ${v.skipped}`);
  console.log('\n== drag (6,4 in 5 frames)');
  for (const d of drawings) { const r = dragProperties(d.mod); console.log(`${pad(r.name, 22)} under: ${r.under.dragged} joints, worst residual ${r.under.worstResidual.toExponential(1)} (after a full solve ok ${r.under.settled}/${r.under.dragged}) | full: ${r.full.fullyConstrained ? r.full.dragged + ' joints, worst move ' + r.full.worstMove.toExponential(1) : 'not fully constrained'} | locked: ${r.locked.tried} drags, locked joint moved ${r.locked.worstLockedMove}`); }
  console.log('\n== save -> load (project store, memory) and journal replay');
  for (const d of drawings) { const r = await roundTrip(d.mod); console.log(`${pad(r.name, 22)} nullity ${r.nullityBefore}->${r.nullityAfter} geometry dev ${r.geometryDev} driven flags same ${r.drivenFlagsSame} identical ${r.docIdentical} (except dimSign ${r.docIdenticalExceptDimSign}) | journal ${r.journal.steps} steps identical ${r.journal.identical}`); }
  console.log('\n== new findings (ok=false means the bug is present)');
  for (const f of FINDINGS) { const r = await f.run(); console.log(`${f.id} [${f.severity}] ok=${r.ok}  ${f.title}\n    ${r.observed}`); }
  process.exit(0);
})();
