// TASK 514 -- SOLVER COVERAGE AUDIT, part 2: new drawings, randomised properties, drag, save / undo / journal round trip. Report:
// docs/COVERAGE-AUDIT.md "Properties"; tables: `node scripts/coverage-properties.cjs`. AUDIT ONLY: no app code changes.
//
// Everything that SHOULD hold today is asserted. Every behaviour that is a BUG today is a named entry in KNOWN: its check runs, is EXPECTED TO FAIL,
// and the test fails loudly if it unexpectedly passes -- so the entry must be deleted when the bug is fixed.
import * as P from './harness/coverage/prop-lib.js';
import { runProperties, INVARIANTS, KINDS, CASES, SEED0 } from './harness/coverage/prop-random.js';
import { dragProperties } from './harness/coverage/prop-drag.js';
import { roundTrip } from './harness/coverage/prop-roundtrip.js';
import { FINDINGS } from './harness/coverage/prop-findings.js';
import inventory from './harness/coverage/inventory.js';

const KNOWN = {
  'scurve/C fully constrained (nullity 0)': 'N-F7',
  'scurve/C the Design panel DOF equals the finite-difference nullity': 'N-F7',
  'scurve/C no arc/arc tangent row differs from finite differences': 'N-F7',
  'scurve/D 3 starts jittered by 2% return to the drawn geometry': 'N-F7',
  'scurve/B no dimension is demoted': 'N-F7 (the 2nd arc radius is judged redundant)',
  'N-F1': 'fillet at the origin deletes j_origin', 'N-F2': 'polygon-tool corners cannot be filleted', 'N-F3': 'dimSign dropped on save / undo',
  'N-F4': 'reference angle becomes driving after save / undo',
  'N-F6': 'orientation flips on a dimension edit', 'N-F7': 'arc/arc tangent at a shared rim is degenerate', 'N-U1': 'unexplained (I3)',
  'roundtrip: documents are identical after save -> load': 'N-F3 (dimSign / dimSignMode dropped) on every drawing with an H/V dimension',
};
// expected final nullity per drawing (what the recipe is designed to reach; every-kind is deliberately loose, it is the drag test's subject)
const NULLITY = { plate: 0, trapezoid: 0, bracket: 0, triangle: 0, polygon: 0, scurve: 0, slot: 0, 'collinear-concentric': 0, 'axis-symmetry': 0, 'welded-T': 0, 'filleted-polygon': 0, 'every-kind': 9, 'two-sketches': 0 };
// drawings whose analytic Jacobian differs from finite differences today (N-F7 arc/arc tangent; F6/N-F5 fixed in task 511)
const JAC = { scurve: 'N-F7' };
// demoted steps that are round 1's F1 (H and V dimension on one joint pair)
const DEMOTED = {};   // round 1's F1 is fixed on main (task 510): the bracket's three H+V steps are no longer demoted

// random-property failures that no ablation explains, pinned by seed to their standalone repro (N-U1 / N-U2 in prop-findings.js)
const PINNED_SEEDS = { I3: { 7090: 'N-U1' } };

const seen = new Set();
let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL  ' + msg); };
function check(name, ok, detail = '') {
  seen.add(name);
  if (name in KNOWN) {
    if (ok) fail(`KNOWN entry now PASSES, delete it from KNOWN (${name}: ${KNOWN[name]})`);
    else console.log(`known ${name}  [${KNOWN[name]}]  ${detail}`);
  } else if (!ok) fail(`${name}  ${detail}`);
  else console.log(`ok    ${name}`);
}
const t0 = Date.now();

// ------------------------------------------------------------------ 0. the generator covers the inventory (drift)
{
  const types = inventory.constraintTypes.map(c => c.type).filter(t => t !== 'distance');
  check('generator: every constraint type of the inventory has an op kind', types.every(t => KINDS.includes(t)), types.filter(t => !KINDS.includes(t)).join(','));
  const modes = ['dist-aligned', 'dist-horizontal', 'dist-vertical', 'dist-line', 'dist-point-line', 'dist-line-line', 'angle', 'radius'];
  check('generator: every dimension mode of the inventory has an op kind', inventory.dimensionModes.length === modes.length && modes.every(m => KINDS.includes(m)), `${inventory.dimensionModes.length} modes in the inventory`);
}

// ------------------------------------------------------------------ 1. the drawings (round 1 + 8 new): light pipeline
const drawings = await P.loadDrawings();
let P_scurveDemoted = 0;
for (const d of drawings) {
  const n = d.mod.NAME;
  const { summary: s } = await P.summarize(d.mod);
  check(`${n}/B no step is refused`, s.refused.length === 0, s.refused.join('; '));
  if (n === 'scurve') P_scurveDemoted = s.demoted.length;
  else check(`${n}/B the demoted steps are the pinned ones (F1 workarounds)`, s.demoted.length === (DEMOTED[n] || 0), s.demoted.join('; '));
  check(`${n}/B every step solved`, s.unconverged.length === 0 && !s.nan, s.unconverged.join('; '));
  check(n === 'every-kind' ? `${n}/C deliberately loose (nullity 9)` : `${n}/C fully constrained (nullity 0)`, s.nullity === NULLITY[n], `nullity ${s.nullity}`);
  check(`${n}/C the Design panel DOF equals the finite-difference nullity`, s.panel === s.fd, `panel ${s.panel} vs fd ${s.fd}`);
  check(`${n}/C the Design panel DOF equals the analytic nullity`, s.panel === s.nullity, `panel ${s.panel} vs ${s.nullity}`);
  if (n === 'scurve') check('scurve/C no arc/arc tangent row differs from finite differences', !s.jacobianErrors.includes('tangent'), JSON.stringify(s.jacobianErrors));
  else check(`${n}/C analytic Jacobian rows differ from finite differences only where pinned`, (s.jacobianErrors.length > 0) === (n in JAC), JSON.stringify(s.jacobianErrors));
  check(`${n}/D verifier OK (every driving residual < 1e-6)`, s.verifier < 1e-6, `max ${s.verifier}`);
  if (s.nullity === 0) check(`${n}/D 3 starts jittered by 2% return to the drawn geometry`, s.returns === '3/3', s.returns);
  else if (n === 'scurve') check('scurve/D 3 starts jittered by 2% return to the drawn geometry', false, 'not fully constrained: no single geometry to return to');
  if (s.planegcs) {
    // our collinear + arc/arc tangent mappings are this audit's own; an arc/arc tangent at a SHARED rim is degenerate in PlaneGCS too (dof differs), so scurve is excluded
    if (n !== 'scurve') check(`${n}/G planegcs DOF equals our nullity and finds no conflict`, s.planegcs.dof === s.nullity && s.planegcs.conflicting === 0 && s.planegcs.unmapped === 0, JSON.stringify(s.planegcs));
  }
}
check('scurve/B no dimension is demoted', P_scurveDemoted === 0, `${P_scurveDemoted} demoted`);

// ------------------------------------------------------------------ 2. randomised properties
const R = runProperties({ cases: CASES, seed0: SEED0 });
console.log(`properties: ${R.totals.cases} cases (seeds ${SEED0}..${SEED0 + CASES - 1}), ${R.totals.ops} ops (${R.totals.applied} applied, ${R.totals.refused} refused, ${R.totals.demoted} demoted to reference, ${R.totals.skipped} not applicable), geometry ${JSON.stringify(R.geoKinds)}`);
for (const [inv, t] of Object.entries(R.tally)) {
  const attr = Object.entries(t.attributed).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
  console.log(`  ${inv} ${INVARIANTS[inv]}: ${t.pass}/${t.cases} pass; failures explained by ${attr}; unexplained ${t.new.length} (${t.new.filter(f => (PINNED_SEEDS[inv] || {})[f.seed]).length} pinned by seed)`);
  const loose = t.new.filter(f => !(PINNED_SEEDS[inv] || {})[f.seed]);
  check(`property ${inv}: every failure is explained by a pinned finding`, loose.length === 0, loose.slice(0, 3).map(f => `seed ${f.seed}: ${f.msg}${f.minimal ? ' minimal ' + JSON.stringify(f.minimal.ops) : ''}`).join(' || '));
  check(`property ${inv}: at least 80% of the cases pass outright`, t.pass / t.cases >= 0.8, `${t.pass}/${t.cases}`);
}
const unused = KINDS.filter(k => !R.kinds[k].applied);
check('properties: every op kind was applied at least once', unused.length === 0, unused.join(','));
check('properties: no case contains NaN', R.tally.I6.pass === R.tally.I6.cases);

// ------------------------------------------------------------------ 3. drag
let dragRows = 0;
for (const d of drawings) {
  const r = dragProperties(d.mod);
  dragRows++;
  const n = d.mod.NAME;
  check(`${n}/drag under-constrained: ${r.under.dragged} joints dragged, driving constraints stay satisfied (< 5e-3 during the drag, < 1e-6 after a full solve), no NaN`, r.under.worstResidual < 5e-3 && r.under.settled === r.under.dragged && r.under.nan === 0, JSON.stringify(r.under));
  if (r.full.fullyConstrained) check(`${n}/drag fully constrained: ${r.full.dragged} joints dragged, nothing moves (< 1e-3)`, r.full.worstMove < 1e-3, JSON.stringify(r.full));
  check(`${n}/drag a locked joint never moves`, r.locked.worstLockedMove === 0, JSON.stringify(r.locked));
}

// ------------------------------------------------------------------ 4. round trip
let identicalByte = 0;
for (const d of drawings) {
  const r = await roundTrip(d.mod);
  const n = d.mod.NAME;
  check(`${n}/roundtrip: save -> load keeps nullity, panel DOF, geometry, constraint count and driven flags`, r.loadOk && r.nullityBefore === r.nullityAfter && r.panelBefore === r.panelAfter && r.geometryDev < 1e-9 && r.geometryDevSolved < 1e-6 && r.constraints[0] === r.constraints[1] && r.drivenFlagsSame, JSON.stringify(r));
  if (r.docIdentical) identicalByte++;
  check(`${n}/roundtrip: the document is identical except dimSign / dimSignMode (N-F3)`, r.docIdenticalExceptDimSign, JSON.stringify(r.differingKeys));
  check(`${n}/roundtrip: replayJournal rebuilds the identical document (${r.journal.steps} steps)`, r.journal.hashOk && r.journal.identical && !r.journal.truncated, JSON.stringify(r.journal));
}
check('roundtrip: documents are identical after save -> load', identicalByte === drawings.length, `${identicalByte}/${drawings.length} identical`);

// ------------------------------------------------------------------ 5. standalone repros of the new findings
for (const f of FINDINGS) {
  const r = await f.run();
  check(f.id, r.ok === true, `[${f.severity}] ${f.title} -- ${r.observed}`);
}

for (const k of Object.keys(KNOWN)) if (!seen.has(k)) fail(`KNOWN entry '${k}' matches no check, delete or rename it`);
const secs = (Date.now() - t0) / 1000;
console.log(`coverage-properties: ${failures === 0 ? 'passed' : failures + ' failure(s)'} in ${secs.toFixed(1)}s, ${Object.keys(KNOWN).length} KNOWN findings pinned`);
if (secs > 30) { console.log('FAIL  runtime over the 30 s budget'); failures++; }
process.exit(failures === 0 ? 0 : 1);
