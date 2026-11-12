#!/usr/bin/env node
// scripts/constraint-audit.cjs -- TASK 508. Re-runs the constraint audit and prints one table per drawing (step, accepted?, converged, residual,
// nullity, notes), the D/E/F/G results, the summary table and the standalone finding repros.
//   node scripts/constraint-audit.cjs              all five drawings
//   node scripts/constraint-audit.cjs bracket      one drawing (plate | trapezoid | bracket | triangle | polygon)
// The assertions live in tests/constraint-audit.test.js; the report is docs/CONSTRAINT-AUDIT.md. PlaneGCS prints "Sketcher::Redundant..." lines
// to stdout whenever it finds a redundant constraint: that is the oracle talking, not an error.
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const url = (rel) => pathToFileURL(path.join(root, rel)).href;

(async () => {
  const L = await import(url('tests/harness/audit/lib.js'));
  const { FINDINGS } = await import(url('tests/harness/audit/findings.js'));
  const want = process.argv[2];
  const files = ['d1-plate', 'd2-trapezoid', 'd3-bracket', 'd4-triangle', 'd5-polygon'].filter(f => !want || f.includes(want));
  const rows = [];
  for (const f of files) {
    const mod = await import(url(`tests/harness/audit/${f}.js`));
    const R = await L.runDrawing(mod);
    console.log(`\n=== ${R.name.toUpperCase()}: ${R.title}`);
    console.log(`A geometry only: ${R.A.joints} joints (${R.A.movable} movable); nullity with every constraint stripped = ${R.A.bareNullity} (2 x ${R.A.movable} = ${2 * R.A.movable}); with the builders' own constraints (${R.A.builderConstraints}) = ${R.A.builderNullity}`);
    console.log('B recipe, one constraint at a time:');
    console.log(L.tableB(R));
    console.log(`C final: nullity ${R.C.nullity} (Design panel DOF ${R.C.panelDof}, finite-difference nullity ${R.C.fdNullity}, planegcs dof ${R.G ? R.G.dof : 'n/a'}), ${R.C.constraints} constraints, ${R.C.joints} joints; free joints: ${R.C.free.length ? R.C.free.map(j => j.id + ' ' + j.dirs).join(', ') : 'none'}`);
    if (R.C.jacobianErrors.length) console.log(`  analytic Jacobian differs from finite differences on: ${R.C.jacobianErrors.map(e => e.type + ' (' + e.err.toFixed(3) + ')').join(', ')}`);
    console.log(`D verifier max residual ${R.D.verifierMax.toExponential(1)}; 5 jittered starts (5% of ${R.size.toFixed(0)}): ` + R.D.perturbed.map(p => `seed ${p.seed} ${p.converged ? 'converged' : 'NOT converged'} res ${p.residual.toExponential(1)} dev ${p.dev.toExponential(1)}`).join('; '));
    console.log('E every dimension x0.8 and x1.25 through commitDimensionEdit:');
    for (const e of R.E) console.log(`  ${e.dim.padEnd(24)} x${String(e.factor).padEnd(5)} -> ${(+e.target).toFixed(3).padEnd(9)} ${e.reverted ? 'REFUSED (' + e.reason + ')' : 'ok'}  converged=${e.converged} residual=${e.residual.toExponential(1)} nullity=${e.nullity} flips=${e.flips.length} back=${e.backDev.toExponential(1)}`);
    const F = R.F;
    console.log(`F redundant: accepted=${F.redundant.accepted} driven=${F.redundant.driven} nullity=${F.redundant.nullity} geometry moved ${F.redundant.dev.toExponential(1)}`);
    console.log(`  conflicting (1.5x): accepted=${F.conflict.accepted} driven=${F.conflict.driven} stored value ${F.conflict.value.toFixed(2)} -> ${F.conflict.storedValue != null ? (+F.conflict.storedValue).toFixed(2) : '-'} geometry moved ${F.conflict.dev.toExponential(1)}`);
    console.log(`  delete ${F.delete.dim}: nullity ${F.delete.nullityBefore} -> ${F.delete.nullityAfter} (expected +1); undo: nullity ${F.undo.nullity}, constraints ${F.undo.constraints}/${F.undo.constraintsBefore}, geometry moved ${F.undo.dev.toExponential(1)}`);
    for (const x of R.X) console.log(`X ${x.pass ? 'ok  ' : 'FAIL'} ${x.name}: ${x.detail}`);
    if (R.G) console.log(`G planegcs: dof ${R.G.dof}, conflicting ${R.G.conflicting}, redundant ${R.G.redundant}, keeps our geometry within ${R.G.selfDev.toExponential(1)}; jittered starts: ` + R.G.seeds.map(s => `seed ${s.seed} dev ${s.dev.toFixed(4)}`).join('; '));
    if (R.name === 'trapezoid') {
      const { compareWithFixture } = await import(url('tests/harness/audit/fixture-compare.js'));
      const c = compareWithFixture(R);
      console.log(`FIXTURE (owner-trapezoid.document.json): ${c.fixtureAsSaved.constraints} constraints / ${c.fixtureAsSaved.joints} joints, nullity ${c.fixtureAsSaved.nullity} as saved (top width saved as a reference), ${c.fixtureDriving.nullity} with the top width driving; mine: ${c.mine.constraints} / ${c.mine.joints}, nullity 0`);
      console.log('  fixture constraints: ' + JSON.stringify(c.fixtureDriving.types));
      console.log('  mine:                ' + JSON.stringify(c.mine.types));
    }
    rows.push(L.summaryRow(R));
  }
  console.log('\n=== SUMMARY');
  console.log('drawing'.padEnd(11) + 'joints'.padEnd(8) + 'constr'.padEnd(8) + 'nullity'.padEnd(9) + 'panelDOF'.padEnd(10) + 'planegcs'.padEnd(10) + 'verifier'.padEnd(10) + 'jittered'.padEnd(10) + 'edits ok'.padEnd(10) + 'refused'.padEnd(9) + 'demoted');
  for (const r of rows) console.log(r.drawing.padEnd(11) + String(r.joints).padEnd(8) + String(r.constraints).padEnd(8) + String(r.nullity).padEnd(9) + String(r.panelDof).padEnd(10) + String(r.planegcsDof).padEnd(10) + (r.verifier < 1e-6 ? 'OK' : r.verifier.toExponential(1)).padEnd(10) + r.perturbed.padEnd(10) + r.edits.padEnd(10) + String(r.refused).padEnd(9) + r.demoted);
  if (!want) {
    console.log('\n=== FINDING REPROS (ok = the app behaves correctly; BUG = present today)');
    for (const f of FINDINGS) { const r = await f.run(); console.log(`${f.id} [${f.severity}] ${r.ok ? 'ok ' : 'BUG'} ${f.title}\n     ${r.observed}`); }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
