// gate: exclusive
// tests/solver-pattern-order.test.js -- TASK 844: the solver on PATTERNS. A pattern's rows tie every copy point to its SOURCE point, so in
// joint insertion order (sources first) the JᵀJ envelope filled completely and every solve paid a dense Cholesky, O(n^3): task 840's spur
// gear took 2.7 s to build at 24 teeth and ~67 s at 60. The factorisation now runs in a fill-reducing order (#core/solver/algebra.js gram:
// Reverse Cuthill-McKee on the sparsity of JᵀJ). This guard builds the same structures through the tool operations and times them:
//   gear z     ONE tooth drawn with the Line tool (an open polyline, 8 points from the middle of the right gap to the middle of the left one,
//              every point held by a construction ray from the centre: its length and its angle from the Y axis), a Circular
//              Pattern of z round the origin, then each tooth's left gap point made Coincident with the next tooth's right one (ONE closed
//              outline; the first join sets the right gap point's angle, the others agree with it), the structure of task 840's gear
//   circles    a Circular Pattern of 100 copies of a dimensioned circle
//   rects      a Rectangular Pattern 20 x 20 of a small dimensioned rectangle
// Times: the build (every tool step, with the solves and checks each one runs), the slowest single engine.solve during the build, and a full
// solve of the built sketch from a perturbed pose (best of 3 seeds). The limits: the task's targets (24 teeth built < 250 ms, 60 teeth < 2 s,
// every solve during a 200-tooth build < 500 ms); else about 3x the time measured after the change (Node 24, the owner's PC), far under the
// time before it (WORK-LOG TURN 844: rects 20 x 20 full solve 61.8 s before, 2.1 s after; gear 200 full solve 28.5 s before, 1.1 s after).
// A full solve of the 200-tooth gear stays over 500 ms: it is now the ASSEMBLY (34 assemblies of ~31 ms, the factorisations 12 ms in all),
// the pattern being one constraint whose rows each scan all its operands (engine.js _assemble emitRow), not the ordering.
// `gear 200` takes ~40 s to build (the same assembly cost, at each of its 200 joins' checks), so it runs only when named:
//   node tests/solver-pattern-order.test.js "gear 200"        (or any list of case names)
import assert from 'node:assert';
import { buildTemplate } from '#core/templates.js';
import { deserializeDocument } from '#core/document.js';
import { NewtonSolver } from '#core/solver/engine.js';
import { Algebra } from '#core/solver/algebra.js';
import { sceneJoints, sceneShapes } from '#core/reference-lines.js';
import { patternDefaults } from '#core/pattern.js';
import { ORIGIN_JOINT_ID, CONSTRAINT_TYPES as T, AXIS_SNAP_TARGETS } from '#core/constants.js';
import * as ops from '#core/tool-ops.js';
import * as L from './harness/audit/lib.js';

const quiet = (f) => { const l = console.log, e = console.error, w = console.warn, d = console.debug; console.log = console.error = console.warn = console.debug = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; console.debug = d; } };
const AXIS_Y = AXIS_SNAP_TARGETS['axis-y'].shapeId;
const deg = (x) => String(Number(x.toPrecision(10)));

// the gear-like outline: one 8-point tooth (7 segments, 14 joints: 28 unknowns per copy, task 840's tooth has ~30) (radius, angle right of +Y in degrees), its half pitch hp = 180 / z
function buildGear(d, z) {
  const m = 3, rf = (z - 2.5) * m / 2, ra = (z + 2) * m / 2, hp = 180 / z, h = ra - rf;
  const right = [[rf, 1], [rf, 0.7], [rf + 0.5 * h, 0.45], [ra, 0.25]];
  const tooth = [...right, ...right.slice().reverse().map(([r, f]) => [r, -f])].map(([r, f]) => [r, f * hp]);
  const at = ([r, a]) => [r * Math.sin(a * Math.PI / 180), r * Math.cos(a * Math.PI / 180)];
  const c = d.pt(0, 0);
  d.anchor(c);
  const segs = d.poly(tooth.map(at), false);
  const pts = [segs[0].a, ...segs.map((s) => s.b)];
  const rays = pts.map((p) => d.line(c, p, true).id);
  tooth.forEach(([r], i) => { if (i !== tooth.length - 1) d.dim(c, pts[i], 'aligned', 1, deg(r), true); }); // the last point's length: the join
  for (let i = 1; i < tooth.length; i++) d.angle(AXIS_Y, rays[i], at([rf * 0.9, tooth[i][1] / 2]), `${deg(Math.abs(tooth[i][1]))} deg`);
  const pat = ops.pattern(d.state, T.CIRCULAR_PATTERN, { shapes: segs.map((s) => s.id), joints: [] }, { ...patternDefaults(T.CIRCULAR_PATTERN), centre: ORIGIN_JOINT_ID, quantity: z, angle: 360, symmetric: false });
  const lead = (j) => pat.sources.points.indexOf(j);
  const copies = [{ at: 0, joints: pat.sources.points }, ...pat.instances.map((x) => ({ at: x.at[0], joints: x.joints }))].sort((p, q) => p.at - q.at);
  const first = lead(pts[0]), last = lead(pts[pts.length - 1]), J = (id) => d.state.joints.get(id);
  // each tooth's left gap point joined to the right gap point nearest it (the next tooth, whichever way the pattern turns)
  for (const t of copies) {
    const g = J(t.joints[last]);
    const next = copies.filter((u) => u !== t).reduce((b, u) => (Math.hypot(J(u.joints[first]).x - g.x, J(u.joints[first]).y - g.y) < Math.hypot(J(b.joints[first]).x - g.x, J(b.joints[first]).y - g.y) ? u : b));
    d.coincident(t.joints[last], next.joints[first]);
  }
}
function buildCircles(d, n) {
  const c = d.pt(0, 0); d.anchor(c);
  const k = d.circle(40, 0, 5);
  d.dim(c, k.c, 'aligned', 1, '40', true); d.h(c, k.c);
  d.radius(k.id, '5');
  ops.pattern(d.state, T.CIRCULAR_PATTERN, { shapes: [k.id], joints: [] }, { ...patternDefaults(T.CIRCULAR_PATTERN), centre: ORIGIN_JOINT_ID, quantity: n, angle: 360, symmetric: false });
}
function buildRects(d, nx, ny) {
  const ring = d.poly([[0, 0], [4, 0], [4, 3], [0, 3]], true);
  d.anchor(ring[0].a);
  d.hl(ring[0]); d.hl(ring[2]); d.vl(ring[1]); d.vl(ring[3]);
  d.dim(ring[0].a, ring[0].b, 'horizontal', -1, '4'); d.dim(ring[1].a, ring[1].b, 'vertical', 1, '3');
  ops.pattern(d.state, T.RECTANGULAR_PATTERN, { shapes: ring.map((s) => s.id), joints: [] }, { ...patternDefaults(T.RECTANGULAR_PATTERN), quantity: [nx, ny], distance: [6, 5] });
}

// build a recipe through buildTemplate (the drawing a template works on), timing the build and each engine.solve in it
function measure(name, build) {
  const solves = [];
  const solve = NewtonSolver.prototype.solve;
  NewtonSolver.prototype.solve = function (...a) { const t0 = performance.now(); try { return solve.apply(this, a); } finally { solves.push(performance.now() - t0); } };
  let doc, buildMs;
  try {
    const t0 = performance.now();
    doc = quiet(() => buildTemplate({ name, params: {}, build }));
    buildMs = performance.now() - t0;
  } finally { NewtonSolver.prototype.solve = solve; }
  const S = L.newSketch();
  const loaded = quiet(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state));
  assert.ok(loaded.ok, `${name}: the built document loads`);
  const ref = L.snapshot(S);
  const res0 = quiet(() => S.engine.solve(L.ITER));
  assert.ok(res0.converged, `${name}: the built sketch solves (error ${res0.error})`);
  assert.ok(L.maxDeviation(S, ref) < L.GEOM_TOL, `${name}: the built sketch is already solved (moved ${L.maxDeviation(S, ref)})`);
  const span = 100, full = [];
  for (const seed of [11, 23, 37]) {
    L.restore(S, ref); L.jitter(S, seed, 0.002, span);
    const t0 = performance.now(); const r = quiet(() => S.engine.solve(L.ITER)); full.push(performance.now() - t0);
    assert.ok(r.converged, `${name}: solves back from a perturbed pose (seed ${seed}, error ${r.error})`);
  }
  return { buildMs, maxSolve: Math.max(...solves), solves: solves.length, fullSolve: Math.min(...full) };
}

// limits in ms (measured after task 844: gear 24 build 155, gear 36 build 297 / full solve 34, gear 60 build 1182 / slowest solve 12 / full
// solve 90, gear 200 slowest solve in the build 148 / full solve 1050, circles full solve 13, rects full solve 2145)
const CASES = [
  { name: 'gear 24', build: (d) => buildGear(d, 24), limit: { buildMs: 250 } },
  { name: 'gear 36', build: (d) => buildGear(d, 36), limit: { buildMs: 900, fullSolve: 100 } },
  { name: 'gear 60', build: (d) => buildGear(d, 60), limit: { buildMs: 2000, maxSolve: 40, fullSolve: 270 } },
  { name: 'gear 200', build: (d) => buildGear(d, 200), limit: { maxSolve: 500, fullSolve: 3200 }, named: true },
  { name: 'circles 100', build: (d) => buildCircles(d, 100), limit: { fullSolve: 40 } },
  { name: 'rects 20x20', build: (d) => buildRects(d, 20, 20), limit: { fullSolve: 6500 } },
];
// THE RANK PROBE gives the same answer in the new order (task 844): on a pattern sketch the envelope is factorised in the RCM order (perm set);
// its pass / fail (the solve's undamped polish = rankDeficient, and each LM-damped step) must be the one of the unknowns' own order, which
// the dense Cholesky reproduces (Algebra.choleskySolve: the same sums, the same EPS), and the two solutions agree up to rounding. Checked on
// a well-constrained gear, the same gear with one dimension deleted (rank-deficient: both refuse) and the plain patterns, undamped and damped.
function probeAgreement(name, build, drop) {
  const doc = quiet(() => buildTemplate({ name, params: {}, build }));
  const S = L.newSketch();
  assert.ok(quiet(() => deserializeDocument(JSON.parse(JSON.stringify(doc)), S.state)).ok, `${name}: loads`);
  if (drop) S.state.constraints.splice(S.state.constraints.findIndex(drop), 1);
  const eng = new NewtonSolver(sceneJoints(S.state.joints), S.state.constraints, sceneShapes(S.state.shapes)); // with the axes, as the engine
  const x = eng._pack(), { S: J, r, m, n } = eng._assemble(x);
  const g = new Float64Array(n);
  Algebra.atx(J, m, n, r, g);
  const answers = [];
  for (const damp of [0, 1e-3]) {
    const E = Algebra.gram(J, m, n);
    assert.ok(E.perm, `${name}: the pattern's envelope is factorised in the RCM order (n ${n})`);
    if (damp) Algebra.addToDiag(E, damp + 1e-12);
    const A = new Float64Array(n * n); // JᵀJ (+ damping) dense, rows of J ascending as gram sums them
    for (let k = 0; k < m; ++k) for (let p = J.rowPtr[k]; p < J.rowPtr[k + 1]; ++p) for (let q = J.rowPtr[k]; q <= p; ++q) A[J.cols[p] * n + J.cols[q]] += J.vals[p] * J.vals[q];
    if (damp) for (let i = 0; i < n; ++i) A[i * n + i] += damp + 1e-12;
    const u = Float64Array.from(g, (v) => -v), v = Float64Array.from(u);
    const okNew = Algebra.choleskySolveEnvelope(E, u), okOwn = Algebra.choleskySolve(A, n, v);
    assert.strictEqual(okNew, okOwn, `${name}: the Cholesky ${damp ? 'damped' : 'undamped'} passes / fails alike in both orders (RCM ${okNew}, own ${okOwn})`);
    if (okNew) {
      let d = 0, s0 = 0; for (let i = 0; i < n; ++i) { d = Math.max(d, Math.abs(u[i] - v[i])); s0 = Math.max(s0, Math.abs(v[i])); }
      assert.ok(d <= 1e-9 * Math.max(s0, 1e-12), `${name}: the two solutions agree up to rounding (max difference ${d}, max ${s0})`);
    }
    answers.push(okNew);
  }
  console.log(`${name}: n ${n}, rank probe (undamped) ${answers[0] ? 'passes' : 'refuses'}, damped ${answers[1] ? 'passes' : 'refuses'}, the same in both orders`);
  return answers;
}
{
  const gear = (d) => buildGear(d, 12);
  assert.deepStrictEqual(probeAgreement('probe gear 12', gear), [true, true], 'the well-constrained gear: the polish passes (full rank)');
  const [undamped] = probeAgreement('probe gear 12 minus a dimension', gear, (c) => c.type === 'distance' && !c.isRadius && !c.isDriven);
  assert.strictEqual(undamped, false, 'one dimension deleted: rank-deficient, the undamped probe refuses in both orders');
  probeAgreement('probe circles 30', (d) => buildCircles(d, 30));
  probeAgreement('probe rects 8x8', (d) => buildRects(d, 8, 8));
}

const only = process.argv.slice(2);
const failures = [];
for (const c of CASES) {
  if (only.length ? !only.includes(c.name) : c.named) continue;
  const m = measure(c.name, c.build);
  console.log(`${c.name}: build ${m.buildMs.toFixed(0)} ms, ${m.solves} solves in the build, the slowest ${m.maxSolve.toFixed(1)} ms; a full solve from a perturbed pose ${m.fullSolve.toFixed(1)} ms`);
  for (const [k, lim] of Object.entries(c.limit)) if (m[k] > lim) failures.push(`${c.name}: ${k} ${m[k].toFixed(0)} ms, more than ${lim} ms`);
}
if (failures.length) { console.error('solver-pattern-order FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('solver-pattern-order.test.js: ok');
