// TASK 508 -- CONSTRAINT AUDIT. Five medium drawings (plate, trapezoid, bracket, triangle+circle, polygon+spokes) are built from scratch
// through the same core APIs the tools use, constrained step by step with a data recipe, then verified, edited, abused and checked against
// an independent oracle (FreeCAD's PlaneGCS + a finite-difference Jacobian). Report: docs/CONSTRAINT-AUDIT.md. Re-run the tables with
// `node scripts/constraint-audit.cjs`.
//
// This test asserts everything that SHOULD hold today. Every behaviour that is a BUG today is a named entry in KNOWN below: its check runs,
// is EXPECTED TO FAIL, and the test fails loudly if it unexpectedly passes -- so the entry must be deleted when the bug is fixed.
import * as L from './harness/audit/lib.js';
import { FINDINGS } from './harness/audit/findings.js';
import { compareWithFixture } from './harness/audit/fixture-compare.js';

// name -> one line (finding id in docs/CONSTRAINT-AUDIT.md). Each name is a `check(name, ...)` below or a finding id.
const KNOWN = {
  'plate/E every dimension edits cleanly': 'F2: the hole radius edit is refused because equal(circle,circle) is checked but never solved',
  'plate/X equal-radius on two circles drags the radius': 'F2',
  F2: 'equal on circles',
  F5: 'order-dependent tangent refusal', F8: 'shared-corner outline',
};
// Edits that are MATHEMATICALLY impossible and must be refused cleanly (EXPECTED): the isosceles triangle's angle dimension reads 180 - base angle,
// so 0.8 x 110 = 88 would need a base angle over 90 degrees (the apex at infinity); the refusal must leave the geometry untouched.
const EXPECTED_REFUSED = { triangle: ['angle=110.000 x0.8'] };
// Accepted, driving, and the DOF count did not move (redundant with what is there, or inert: a circle's radius dimension is shape data).
// Pinned so a change in how the app treats them is visible. (UNCLEAR in the report: the app flags redundant DIMENSIONS but not redundant constraints.)
const NO_EFFECT = {
  plate: ['hole radius h1 = 8', 'equal radius h2 = h1', 'equal radius h3 = h1', 'equal radius h4 = h1'],
  trapezoid: [],
  bracket: ['slot bottom line tangent to right arc', 'slot arcs equal radius', 'hole radius 8'],
  triangle: ['circle tangent to CA (3rd: consistent by symmetry)', 'circle radius 20 (sets the size)'],
  polygon: ['axis symmetric about O: midpoint(M0,M3)=O', 'concentric circle radius 25', 'second circle radius 8'],
};
// Steps of the recipe the app turns into a reference (the F1 bug), by drawing.
const DEMOTED = { plate: [], trapezoid: [], bracket: [], triangle: [], polygon: [] };
// Finite-difference vs analysis Jacobian (_assemble opts.analysis): rows whose derivative is incomplete (none since task 511).
const JACOBIAN_ERRORS = { plate: [], trapezoid: [], bracket: [], triangle: [], polygon: [] };

const seen = new Set();
let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL  ' + msg); };
// check(name, ok, detail): an unexpected failure fails the test; a KNOWN failure is expected; a KNOWN entry that now passes fails loudly.
function check(name, ok, detail = '') {
  seen.add(name);
  if (name in KNOWN) {
    if (ok) fail(`KNOWN entry now PASSES, delete it from KNOWN (${name}: ${KNOWN[name]})`);
    else console.log(`known ${name}  [${KNOWN[name]}]  ${detail}`);
  } else if (!ok) fail(`${name}  ${detail}`);
  else console.log(`ok    ${name}`);
}

const DRAWINGS = ['d1-plate', 'd2-trapezoid', 'd3-bracket', 'd4-triangle', 'd5-polygon'];
const t0 = Date.now();
for (const file of DRAWINGS) {
  const mod = await import(`./harness/audit/${file}.js`);
  const R = await L.runDrawing(mod);
  const n = mod.NAME;
  if (n === 'trapezoid') {   // compare with the owner's real sketch (must run before another sketch re-initialises the shared engine)
    const c = compareWithFixture(R);
    const t = (o) => JSON.stringify(Object.entries(o).sort());
    const minePlus = { ...c.mine.types, pointOnLine: (c.mine.types.pointOnLine || 0) + 1 };
    check(`${n}/fixture: same joint count as the owner's sketch`, c.mine.joints === c.fixtureDriving.joints, `${c.mine.joints} vs ${c.fixtureDriving.joints}`);
    check(`${n}/fixture: same constraint multiset except the owner's one extra pointOnLine (the top-edge point, redundant with the midpoint)`, t(minePlus) === t(c.fixtureDriving.types), `mine ${t(c.mine.types)} vs fixture ${t(c.fixtureDriving.types)}`);
    check(`${n}/fixture: the owner's sketch is fully constrained once its top width drives (nullity 0), 1 as saved (the width is a reference)`, c.fixtureDriving.nullity === 0 && c.fixtureAsSaved.nullity === 1 && c.fixtureDriving.fdNullity === 0 && c.fixtureAsSaved.fdNullity === 1, JSON.stringify([c.fixtureDriving.nullity, c.fixtureAsSaved.nullity]));
  }
  // A. geometry only: 2 x movable joints
  check(`${n}/A bare nullity = 2 x movable joints`, R.A.bareNullity === 2 * R.A.movable, `bare ${R.A.bareNullity} vs ${2 * R.A.movable}`);
  // B. the recipe
  check(`${n}/B no step is refused`, R.B.every(r => r.accepted), R.B.filter(r => !r.accepted).map(r => r.label + ' ' + r.errors.join(',')).join('; '));
  check(`${n}/B no dimension is demoted`, R.B.every(r => !r.driven) , R.B.filter(r => r.driven).map(r => r.label).join('; '));
  if (n in DEMOTED) check(`${n}/B the demoted steps are exactly the pinned ones`, JSON.stringify(R.B.filter(r => r.driven).map(r => r.label)) === JSON.stringify(DEMOTED[n]), JSON.stringify(R.B.filter(r => r.driven).map(r => r.label)));
  check(`${n}/B every step solved (converged, no NaN)`, R.B.every(r => r.converged && !r.hasNaN && r.residual < 1e-5), R.B.filter(r => !r.converged || r.residual >= 1e-5).map(r => `${r.label}: ${r.residual}`).join('; '));
  check(`${n}/B steps with no effect are the pinned ones`, JSON.stringify(R.B.filter(r => r.noEffect).map(r => r.label)) === JSON.stringify(NO_EFFECT[n]), JSON.stringify(R.B.filter(r => r.noEffect).map(r => r.label)));
  // C. final state
  check(`${n}/C fully constrained (nullity 0)`, R.C.nullity === 0, `nullity ${R.C.nullity}, free ${JSON.stringify(R.C.free)}`);
  check(`${n}/C the Design panel DOF equals the nullity`, R.C.panelDof === R.C.nullity, `panel ${R.C.panelDof} vs ${R.C.nullity}`);
  check(`${n}/C finite-difference nullity agrees`, R.C.fdNullity === R.C.nullity, `fd ${R.C.fdNullity} vs ${R.C.nullity}`);
  check(`${n}/C analytic Jacobian = finite differences, except the pinned rows`, JSON.stringify(R.C.jacobianErrors.map(e => e.type).sort()) === JSON.stringify(JACOBIAN_ERRORS[n]), JSON.stringify(R.C.jacobianErrors));
  // D. verify
  check(`${n}/D verifier OK (every residual < 1e-6)`, R.D.verifierMax < L.RES_TOL && !R.D.nan, `max ${R.D.verifierMax} on ${R.D.worst}`);
  check(`${n}/D 5 jittered starts return to the same geometry`, R.D.perturbed.every(p => p.converged && p.residual < L.RES_TOL && p.dev < L.GEOM_TOL), R.D.perturbed.map(p => `${p.seed}:${p.converged}/${p.residual.toExponential(1)}/${p.dev.toExponential(1)}`).join(' '));
  // E. edit every dimension
  const expectedRefusal = (e) => (EXPECTED_REFUSED[n] || []).includes(`${e.dim} x${e.factor}`);
  for (const e of R.E.filter(expectedRefusal)) check(`${n}/E impossible edit '${e.dim} x${e.factor}' is refused and leaves the geometry untouched`, e.reverted && e.converged && e.nullity === 0 && e.backDev < L.GEOM_TOL && e.residual < L.RES_TOL, JSON.stringify(e));
  const badEdits = R.E.filter(e => !expectedRefusal(e)).filter(e => e.reverted || !e.converged || e.residual >= L.RES_TOL || e.nan || e.nullity !== 0 || e.flips.length || !(e.backDev < L.GEOM_TOL));
  check(`${n}/E every dimension edits cleanly`, badEdits.length === 0, badEdits.map(e => `${e.dim} x${e.factor}: ${e.reverted ? 'refused (' + e.reason + ')' : ''}${e.flips.length ? ' flips ' + e.flips : ''}`).join('; '));
  check(`${n}/E edits: ${R.E.length} dimension edits were exercised (0.8x and 1.25x of each)`, R.E.length >= 2);
  // F. abuse
  const F = R.F;
  check(`${n}/F a redundant dimension is flagged (driven) and the solve stays healthy`, F.redundant.accepted && F.redundant.driven && F.redundant.converged && F.redundant.nullity === 0 && F.redundant.dev < 1e-6, JSON.stringify(F.redundant));
  check(`${n}/F a conflicting dimension is flagged (driven) and the geometry is untouched`, F.conflict.accepted ? (F.conflict.driven && F.conflict.dev < 1e-6 && F.conflict.converged) : F.conflict.dev < 1e-6, JSON.stringify(F.conflict));
  check(`${n}/F delete a dimension: nullity rises by exactly 1`, F.delete.nullityAfter === F.delete.nullityBefore + 1 && F.delete.removed === 1, JSON.stringify(F.delete));
  check(`${n}/F undo the delete: nullity 0, same constraints, same geometry`, F.undo.nullity === 0 && F.undo.constraints === F.undo.constraintsBefore && F.undo.dev < 1e-6 && F.undo.converged, JSON.stringify(F.undo));
  // X. does a declared constraint really bite
  for (const x of R.X) check(`${n}/X ${x.name}`, x.pass, x.detail);
  // G. oracle: planegcs
  const G = R.G;
  check(`${n}/G planegcs DOF equals our nullity`, G.dof === R.C.nullity, `planegcs ${G.dof} vs ours ${R.C.nullity}`);
  check(`${n}/G planegcs finds no conflict and keeps our geometry`, G.conflicting === 0 && G.selfDev < 1e-3 && G.unmapped === 0, JSON.stringify({ conflicting: G.conflicting, selfDev: G.selfDev, unmapped: G.unmapped }));
  check(`${n}/G our solver converges from every oracle start`, G.seeds.every(s => s.ours && s.oursResidual < L.RES_TOL), JSON.stringify(G.seeds.map(s => [s.seed, s.ours, s.oursResidual])));
  const branch = G.seeds.filter(s => s.dev > 1e-3);
  if (branch.length) console.log(`note  ${n}/G planegcs landed on ANOTHER branch from jittered start(s) ${branch.map(s => `${s.seed} (dev ${s.dev.toFixed(1)})`).join(', ')}; ours returned to the reference every time`);
}

// standalone repros (one per finding): ok === true means correct behaviour
for (const f of FINDINGS) {
  const r = await f.run();
  check(f.id, r.ok === true, `[${f.severity}] ${f.title} -- ${r.observed}`);
}

// every KNOWN entry must correspond to a check that ran
for (const k of Object.keys(KNOWN)) if (!seen.has(k)) fail(`KNOWN entry '${k}' matches no check, delete or rename it`);

const secs = (Date.now() - t0) / 1000;
console.log(`constraint-audit: ${failures === 0 ? 'passed' : failures + ' failure(s)'} in ${secs.toFixed(1)}s, ${Object.keys(KNOWN).length} KNOWN findings pinned`);
if (secs > 40) { console.log('FAIL  runtime over the 40 s budget'); failures++; }
process.exit(failures === 0 ? 0 : 1);
