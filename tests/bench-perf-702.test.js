// tests/bench-perf-702.test.js -- TASK 702: the Curved bench seat template at 40 slats built in about 2.5 s (main face604); the cost was the
// solver core redoing whole-sketch work on every tool operation of the recipe (packages/core/solver/engine.js): the rank probe's Gram-Schmidt
// basis rebuilt from scratch per probe (cubic in the sketch), a row's shapes found by a scan of every shape (rows x shapes per assembly), a
// solve assembling the same point two or three times, the nullspace sweep over zero columns. Each is now done once, on the same numbers, so
// every document is IDENTICAL to main's (the deep-equal of every template is the task's evidence, .evidence/702).
//   1. the WORK of one 40-slat build, COUNTED (deterministic, not wall time: the advisor's send-back, a time ceiling flakes under load): the
//      rows the rank probes' Gram-Schmidt reduces and the assemblies, through this test's own wrappers of the solver's methods. main face604:
//      78207 rows, 2875 assemblies (2032 full + 843 residuals-only); this change: 1943 rows, 1199 assemblies (.evidence/702/count-*.txt).
//      The wall time is printed only.
//   2. the KEPT rank basis answers exactly as a fresh solver: every dimension of a built bench seat lifted out (its row taken from the middle
//      of the kept rows: the basis cut back), a determined quantity (a slat's chord, true), after a joint moved (rows changed from the middle),
//      after unknowns were added (a new free line: more columns), after a constraint was made a reference (a row gone)
import assert from 'node:assert';
import { templateById, buildTemplate } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';
import { isDimensionDetermined } from '#core/dimension-seams.js';
import { createNewtonSolver, NewtonSolver } from '#core/solver/engine.js';
import { sceneJoints, sceneShapes } from '#core/reference-lines.js';
import * as ops from '#core/tool-ops.js';

const muted = (f) => { const l = console.log, w = console.warn, e = console.error, d = console.debug; console.log = console.warn = console.error = console.debug = () => {}; try { return f(); } finally { console.log = l; console.warn = w; console.error = e; console.debug = d; } };
const bench = templateById('curved-bench-seat');
let checks = 0;

// ---- 1. the work of a 40-slat build, counted (each rank-probe row reduced: _rankReduce; each assembly: _assemble)
const MAX_GS_ROWS = 4000, MAX_ASSEMBLIES = 1600; // main: 78207 and 2875
const P = NewtonSolver.prototype, count = { gsRows: 0, assemblies: 0 };
assert.strictEqual(typeof P._rankReduce, 'function', 'the rank probe reduces one row at a time (_rankReduce)'); checks++;
const { _rankReduce, _assemble } = P;
P._rankReduce = function (...a) { count.gsRows++; return _rankReduce.apply(this, a); };
P._assemble = function (...a) { count.assemblies++; return _assemble.apply(this, a); };
let ms;
try { const t0 = performance.now(); muted(() => buildTemplate(bench, { slats: 40 })); ms = performance.now() - t0; } finally { P._rankReduce = _rankReduce; P._assemble = _assemble; }
console.log(`curved bench seat, 40 slats: ${count.gsRows} Gram-Schmidt rows, ${count.assemblies} assemblies (main: 78207, 2875); wall time ${ms.toFixed(0)} ms (printed only)`);
assert.ok(count.gsRows <= MAX_GS_ROWS, `the rank probes reduce ${count.gsRows} rows, at most ${MAX_GS_ROWS} (main 78207)`); checks++;
assert.ok(count.assemblies <= MAX_ASSEMBLIES, `${count.assemblies} assemblies, at most ${MAX_ASSEMBLIES} (main 2875)`); checks++;

// ---- 2. the kept rank basis = a fresh solver's answer
const S = ops.newSketchState();
assert.ok(muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(bench, { slats: 20 }))), S)).ok, 'the 20-slat bench seat loads'); checks++;
// a fresh solver over the same sketch (no kept basis), the candidate tested against the other driving constraints (isDimensionDetermined's rule)
const fresh = (c) => {
  const others = S.constraints.filter((k) => k !== c);
  return createNewtonSolver(sceneJoints(S.joints), others, sceneShapes(S.shapes)).rankRowRedundant({ ...c, isDriven: false, driven: false });
};
const dims = S.constraints.filter((c) => (c.type === 'distance' || c.type === 'angle') && !c.isDriven && !c.driven);
assert.strictEqual(dims.length, 4, 'the 20-slat circular-pattern seat: two radii and two slat half-chords'); checks++;
const probeAll = (why) => {
  for (const c of dims) {
    const kept = isDimensionDetermined(S, c), alone = fresh(c);
    assert.strictEqual(kept, alone, `${why}: ${c.name} determined ${kept} with the kept basis, ${alone} fresh`); checks++;
    assert.strictEqual(kept, false, `${why}: ${c.name} is a driving dimension the rest does not determine`); checks++;
  }
};
probeAll('built');
probeAll('again (the whole kept basis reused)');
// a determined quantity: the first slat's outer chord (its arcs, the equal chords and the gaps hold it)
const arcs = S.shapes.filter((s) => s.type === 'arc');
const [, oa, ob] = arcs[0].joints;
const chord = { type: 'distance', joints: [oa, ob], value: Math.hypot(S.joints.get(oa).x - S.joints.get(ob).x, S.joints.get(oa).y - S.joints.get(ob).y) };
assert.strictEqual(S.engine.isDistanceRedundant(chord), true, 'a slat chord is determined (kept basis)'); checks++;
assert.strictEqual(createNewtonSolver(sceneJoints(S.joints), S.constraints, sceneShapes(S.shapes)).rankRowRedundant(chord), true, 'and fresh'); checks++;
// a joint moved: every row on it changes, so the kept rows match only up to the first of them
const mid = arcs[Math.floor(arcs.length / 2)].joints[1];
S.joints.get(mid).x += 0.5;
probeAll('a joint moved');
// more unknowns: a free line (two new joints, four new columns) and a dimension on it, which nothing else determines
const line = ops.polyline(S, [[5000, 5000], [5100, 5050]], false)[0];
const len = { type: 'distance', joints: [line.a, line.b], value: 111.8 };
assert.strictEqual(S.engine.isDistanceRedundant(len), false, 'a free line\'s length is not determined (kept basis, more columns)'); checks++;
assert.strictEqual(createNewtonSolver(sceneJoints(S.joints), S.constraints, sceneShapes(S.shapes)).rankRowRedundant(len), false, 'nor fresh'); checks++;
probeAll('a free line added');
// a row gone from the middle: a dimension made a reference (also verify on the 14-dimension box-frame)
dims[1].isDriven = true; dims[1].driven = true;
dims.splice(1, 1);
probeAll('a radius made a reference');

const box = templateById('box-frame');
const B = ops.newSketchState();
assert.ok(muted(() => deserializeDocument(JSON.parse(JSON.stringify(buildTemplate(box))), B)).ok, 'box-frame loads'); checks++;
const bDims = B.constraints.filter((c) => (c.type === 'distance' || c.type === 'angle') && !c.isDriven && !c.driven);
assert.strictEqual(bDims.length, 14, 'box-frame has 14 driving dimensions'); checks++;
bDims[5].isDriven = true; bDims[5].driven = true;
bDims.splice(5, 1);
for (const c of bDims) {
  const kept = isDimensionDetermined(B, c);
  const alone = createNewtonSolver(sceneJoints(B.joints), B.constraints.filter((k) => k !== c), sceneShapes(B.shapes)).rankRowRedundant({ ...c, isDriven: false, driven: false });
  assert.strictEqual(kept, alone, `box-frame cut middle row: ${c.name} kept=${kept} vs fresh=${alone}`); checks++;
}

console.log(`bench-perf-702: ${checks} checks passed`);
