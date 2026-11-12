// TASK 535 slice 2 -- the BATCH SEAM (docs/PARAMETERS-DESIGN.md section D): commitDimensionEdits applies N dimension value changes as ONE operation,
// and applyParameterChange applies a planChange result (parameters + expressions + values) all-or-nothing in ONE undo step.
// INVISIBLE: no UI, no typed expression anywhere; this test is the only producer. Drawings are generated through the real tool seams
// (rect = makeRectFromTwoJoints + ConstraintManager, dimensions = ConstraintManager.createConstraint), mixed modes from the coverage inventory:
// horizontal / vertical / aligned length / point-line distance / angle / circle radius.
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { perpendicularDistance } from '#core/geometry.js';
import { planChange } from '#core/parameters.js';
import { commitDimensionEdit, commitDimensionEdits, applyParameterChange } from '#ui/dimension-seams.js';
import inventory from './harness/coverage/inventory.js';

let checks = 0;
const ok = (cond, msg) => { checks++; assert(cond, msg); };
const quiet = (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return fn(); } finally { console.error = e; console.warn = w; } };

// the dimension modes this test exercises must all exist in the inventory (a renamed mode fails here, not silently)
for (const m of ['horizontal', 'vertical', 'aligned', 'point-line', 'angle', 'radius']) ok(inventory.dimensionModes.some((x) => x.mode === m || x.mode.startsWith(m) || m.startsWith(x.mode)), 'inventory has no dimension mode like ' + m);

// ---------------------------------------------------------------- generated drawings
// createEngine() shares ONE module-level store, so one drawing lives at a time: every scenario rebuilds its own.
const dimOf = (S, c) => ({ c, name: c.name });
function mkDim(S, type, p) {
  const c = ConstraintManager.createConstraint(S.state, type, p, { source: 'audit' });
  if (!c || L.isDriven(c)) throw new Error('dimension not driving: ' + JSON.stringify(p));
  return c;
}
const cornersOf = (S, r) => {
  const ids = [...new Set(r.lines.flatMap((id) => L.shape(S, id).joints))];
  const at = (x, y) => ids.find((id) => Math.abs(S.state.joints.get(id).x - x) < 1e-9 && Math.abs(S.state.joints.get(id).y - y) < 1e-9);
  return { ids, at };
};

// cell kinds, in rotation. Each returns the dimensions it made (driving, independent of every other cell except the rectangle weld).
//   rect: width (horizontal) + height (vertical); welds its bottom-left corner to the previous rect's bottom-right when `weld`, else it is pinned
//   circle: radius; line: aligned length + angle against a fixed horizontal line; point-line: distance of a free point to a fixed line;
//   triangle: three aligned lengths (the shape that can be made impossible)
function build(nDims, { weld = true } = {}) {
  const S = L.newSketch();
  const dims = [];
  const tri = [];
  let x = 0, prevBR = null, k = 0;
  const y0 = 0;
  while (dims.length < nDims) {
    const kind = k % 4 === 0 || k % 4 === 3 ? 'rect' : k % 4 === 1 ? 'circle+line' : 'pointline';
    if (kind === 'rect') {
      const w = 40 + (k % 5) * 6, h = 20 + (k % 3) * 5;
      const r = L.rect(S, x, y0, x + w, y0 + h);
      const { at } = cornersOf(S, r);
      const bl = at(x, y0), br = at(x + w, y0), tr = at(x + w, y0 + h);
      if (weld && prevBR) ConstraintManager.createConstraint(S.state, 'coincident', { joints: [prevBR, bl] }, { source: 'audit' });
      else S.state.joints.get(bl).fixed = true;
      dims.push(mkDim(S, 'distance', { joints: [bl, br], value: w, dimMode: 'horizontal' }), mkDim(S, 'distance', { joints: [br, tr], value: h, dimMode: 'vertical' }));
      prevBR = br; x += w + 10;
    } else if (kind === 'circle+line') {
      const cx = 400 + k * 90, cy = 300;
      const c = L.circle(S, cx, cy, 12);
      dims.push(mkDim(S, 'distance', { shape: c.id, value: 12, isRadius: true }));
      // a line from a fixed joint, 60 long at 30 degrees from a fixed horizontal line: length + angle
      const a0 = L.point(S, cx - 40, cy + 100), a1 = L.point(S, cx + 40, cy + 100), b0 = L.point(S, cx - 40, cy + 100), b1 = L.point(S, cx - 40 + 60 * Math.cos(Math.PI / 6), cy + 100 + 60 * Math.sin(Math.PI / 6));
      for (const id of [a0, a1, b0]) S.state.joints.get(id).fixed = true;
      const la = L.line(S, a0, a1), lb = L.line(S, b0, b1);
      dims.push(mkDim(S, 'distance', { joints: [b0, b1], value: 60 }));
      dims.push(mkDim(S, 'angle', { shapes: [la, lb], value: L.measure(S, { type: 'angle', shapes: [la, lb] }) }));
    } else {
      const bx = 400 + k * 90, by = 500;
      const a = L.point(S, bx, by), b = L.point(S, bx + 80, by), p = L.point(S, bx + 30, by + 25);
      for (const id of [a, b]) S.state.joints.get(id).fixed = true;
      L.line(S, a, b);
      dims.push(mkDim(S, 'distance', { joints: [p, a, b], value: 25 }));
    }
    k++;
  }
  // the impossible-able triangle, appended after the cells and NOT counted in `dims` (so `nDims` stays exact): sides 60 / 50 / 50
  const bx = 100, by = 700;
  const p0 = L.point(S, bx, by), p1 = L.point(S, bx + 60, by), p2 = L.point(S, bx + 30, by + 40);
  S.state.joints.get(p0).fixed = true;
  L.line(S, p0, p1); L.line(S, p1, p2); L.line(S, p2, p0);
  tri.push(mkDim(S, 'distance', { joints: [p0, p1], value: 60 }), mkDim(S, 'distance', { joints: [p1, p2], value: 50 }), mkDim(S, 'distance', { joints: [p2, p0], value: 50 }));
  S.engine.solve(L.ITER);
  return { S, dims: dims.slice(0, nDims), all: dims, tri };
}

// the measured value of a dimension in the geometry (what the solver must have made equal to c.value)
function measured(S, c) {
  const J = (id) => S.state.joints.get(id);
  if (c.type === 'angle') return L.measure(S, { type: 'angle', shapes: c.shapes });
  if (c.isRadius) return L.shape(S, c.shape).radius;
  if (c.joints.length === 3) return Math.abs(perpendicularDistance(J(c.joints[0]), J(c.joints[1]), J(c.joints[2])));
  const [a, b] = c.joints.map(J);
  if (c.dimMode === 'horizontal') return Math.abs(b.x - a.x);
  if (c.dimMode === 'vertical') return Math.abs(b.y - a.y);
  return Math.hypot(b.x - a.x, b.y - a.y);
}
const worstMiss = (S, cs) => Math.max(...cs.map((c) => Math.abs(measured(S, c) - c.value)));

// a canonical, exact image of EVERYTHING the batch must restore: joints, shapes (radii), constraints (values, names, expressions), parameters,
// the undo / redo stack lengths. Sorted keys; floats compared exactly (JSON round-trips a double exactly).
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Map)) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : (x instanceof Map ? [...x] : x));
const image = (st) => canon({ joints: st.joints, shapes: st.shapes, constraints: st.constraints, parameters: st.parameters });
const stacks = (st) => [st.history.length, st.redoStack.length];
const geometry = (S) => [...S.state.joints].map(([id, j]) => [id, j.x, j.y]).concat(S.state.shapes.filter((s) => typeof s.radius === 'number').map((s) => [s.id, s.radius, 0]));
const maxGeomDiff = (a, b) => Math.max(...a.map((r, i) => Math.max(Math.abs(r[1] - b[i][1]), Math.abs(r[2] - b[i][2]))));

// deterministic pseudo-random
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const targetOf = (c, rand) => c.type === 'angle' ? c.value + 8 + rand() * 12 : c.value * (0.8 + rand() * 0.5);
const editsFor = (dims, rand) => dims.map((c) => ({ c, value: targetOf(c, rand), name: c.name }));

// ---------------------------------------------------------------- 1. 1, 2, 10 and 100 dimensions at once
let ms100 = 0;
for (const n of [1, 2, 10, 100]) {
  const k = build(n);
  ok(k.dims.length === n && k.dims.every((c) => c.name), `n=${n}: ${n} named driving dimensions`);
  ok(worstMiss(k.S, k.dims) < 1e-6, `n=${n}: the generated drawing satisfies its dimensions to start with (${worstMiss(k.S, k.dims)})`);
  const modes = new Set(k.dims.map((c) => c.type + (c.isRadius ? 'R' : '') + (c.joints && c.joints.length === 3 ? 'PL' : '') + (c.dimMode || '')));
  if (n >= 10) ok(modes.size >= 5, `n=${n}: mixed modes ${[...modes]}`);
  const edits = editsFor(k.dims, rng(7 + n));
  const t0 = performance.now();
  const r = quiet(() => commitDimensionEdits(k.S.state, edits));
  const ms = performance.now() - t0;
  if (n === 100) ms100 = ms;
  ok(!r.reverted, `n=${n}: the batch is accepted (${JSON.stringify(r)})`);
  ok(edits.every((e) => e.c.value === e.value), `n=${n}: every dimension holds its new value`);
  ok(worstMiss(k.S, k.dims) < 1e-4, `n=${n}: the geometry realises every new value (worst miss ${worstMiss(k.S, k.dims)})`);
  ok(L.residuals(k.S).max < 1e-6, `n=${n}: residual ${L.residuals(k.S).max}`);
  console.log(`n=${String(n).padStart(3)}: ${ms.toFixed(0)} ms, worst miss ${worstMiss(k.S, k.dims).toExponential(2)}`);
}
ok(ms100 < 2000, `100 dimensions in ${ms100.toFixed(0)} ms: more than 2 s is the design's STOP`);
console.log(`TIMING 100 dimensions at once: ${ms100.toFixed(0)} ms (design target < 500 ms, STOP > 2000 ms)`);

// ---------------------------------------------------------------- 2. commitDimensionEdit IS the one-element batch
// (one drawing at a time: the engine store is shared, so each run rebuilds and keeps only its result)
{
  const a = build(10);
  const v = a.dims[0].value * 1.2;
  const r1 = commitDimensionEdit(a.S.state, a.dims[0], v), g1 = geometry(a.S);
  const b = build(10);
  const r2 = commitDimensionEdits(b.S.state, [{ c: b.dims[0], value: v }]);
  ok(canon(r1) === canon(r2), 'commitDimensionEdit returns what the one-element batch returns');
  ok(canon(g1.map((r) => r.slice(1))) === canon(geometry(b.S).map((r) => r.slice(1))), 'commitDimensionEdit and the one-element batch give the identical geometry');
}

// ---------------------------------------------------------------- 3. a batch with ONE impossible value restores EVERYTHING and names the culprit
for (const n of [2, 10, 100]) {
  const k = build(n);
  const st = k.S.state;
  const edits = editsFor(k.dims, rng(3 + n));
  const bad = { c: k.tri[0], value: 1000, name: k.tri[0].name }; // 1000 > 50 + 50: not a triangle
  const at = Math.floor(edits.length / 2);
  edits.splice(at, 0, bad);
  const before = image(st), stackBefore = stacks(st);
  const r = quiet(() => commitDimensionEdits(st, edits));
  ok(r.reverted === true, `n=${n}: the batch with an impossible value is refused (${JSON.stringify(r).slice(0, 200)})`);
  ok(r.culprit && r.culprit.index === at && r.culprit.name === bad.name, `n=${n}: the culprit is ${bad.name} at index ${at}: ${JSON.stringify(r.culprit)}`);
  ok(image(st) === before, `n=${n}: joints, radii, shapes, constraint values / names / expressions and parameters are restored EXACTLY`);
  ok(canon(stacks(st)) === canon(stackBefore), `n=${n}: the undo / redo stacks are untouched`);
  ok(L.residuals(k.S).max < 1e-6, `n=${n}: the restored drawing still solves (${L.residuals(k.S).max})`);
}

// refused through a COMBINATION: every edit passes alone, together they do not -> culprit null
{
  for (const [i, v] of [[0, 90], [1, 30]]) { const probe = build(2); ok(!quiet(() => commitDimensionEdits(probe.S.state, [{ c: probe.tri[i], value: v }])).reverted, `edit ${i} -> ${v} passes alone`); }
  const k = build(2);
  const st = k.S.state;
  const [s1, s2] = k.tri;
  const edits = [{ c: s1, value: 90, name: s1.name }, { c: s2, value: 30, name: s2.name }]; // 90 alone: 90 < 50 + 50 ok; 30 alone ok; together 90 > 30 + 50
  const before = image(st);
  const r = quiet(() => commitDimensionEdits(st, edits));
  ok(r.reverted === true && r.culprit === null, 'an impossible COMBINATION is refused and no single dimension is named: ' + JSON.stringify(r.culprit));
  ok(image(st) === before, 'the combination refusal restores everything exactly');
}

// reference / determined dimensions are refused by the parameter entry point's option, and named
{
  const k = build(4);
  const st = k.S.state;
  const ref = k.dims[1];
  ref.isDriven = true; ref.driven = true;
  const before = image(st);
  const r = commitDimensionEdits(st, [{ c: k.dims[0], value: k.dims[0].value * 1.1, name: k.dims[0].name }, { c: ref, value: ref.value * 1.1, name: ref.name }], { refuseReference: true });
  ok(r.reverted && r.culprit && r.culprit.name === ref.name && /reference/.test(r.culprit.reason), 'a reference dimension in the batch is refused and named: ' + JSON.stringify(r.culprit));
  ok(image(st) === before, 'nothing changed (the refusal is before any solve)');
}
{ // a dimension the others already determine
  const k = build(4);
  const st = k.S.state;
  const [bl, br] = [k.dims[0].joints[0], k.dims[0].joints[1]];
  // a driving diagonal across the fully constrained rect 0 is determined by its width and height (rect 0 is pinned): tag it as such by building it driven then forcing it driving
  const rectTop = k.dims[1].joints[1];
  const diag = ConstraintManager.createConstraint(st, 'distance', { joints: [bl, rectTop], value: 1 }, { source: 'audit' });
  if (diag) { diag.isDriven = false; diag.driven = false; diag.value = Math.hypot(k.dims[0].value, k.dims[1].value); }
  const before = image(st);
  const r = commitDimensionEdits(st, [{ c: diag, value: 99, name: 'diag' }], { refuseReference: true });
  ok(r.reverted && r.culprit && /determined/.test(r.culprit.reason), 'a dimension already determined by the others is refused and named: ' + JSON.stringify(r.culprit));
  ok(image(st) === before, 'nothing changed');
}

// ---------------------------------------------------------------- 4. order independence
{
  const rand = rng(99);
  const base = build(20);
  const edits = editsFor(base.dims, rand);
  quiet(() => commitDimensionEdits(base.S.state, edits.map((e) => ({ ...e }))));
  const ref = geometry(base.S);
  let worst = 0;
  for (let trial = 0; trial < 4; trial++) {
    const k = build(20);
    const order = k.dims.map((c, i) => i);
    const sh = rng(1000 + trial);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(sh() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const run = order.map((i) => ({ c: k.dims[i], value: edits[i].value, name: k.dims[i].name }));
    const r = quiet(() => commitDimensionEdits(k.S.state, run));
    ok(!r.reverted, 'a shuffled batch is accepted');
    worst = Math.max(worst, maxGeomDiff(ref, geometry(k.S)));
  }
  ok(worst < 1e-5, `the same 20 edits in 4 shuffled orders give the same geometry (worst difference ${worst.toExponential(2)})`);
  console.log(`order independence: worst geometry difference over 4 shuffles ${worst.toExponential(2)}`);
}

// ---------------------------------------------------------------- 5. a batch equals N sequential edits when they are independent
{
  const a = build(10, { weld: false });
  const edits = editsFor(a.dims, rng(21));
  quiet(() => commitDimensionEdits(a.S.state, edits));
  const ga = geometry(a.S);
  const b = build(10, { weld: false });
  quiet(() => b.dims.forEach((c, i) => commitDimensionEdit(b.S.state, c, edits[i].value)));
  const diff = maxGeomDiff(ga, geometry(b.S));
  ok(diff < 1e-5, `batch == 10 sequential single edits on independent dimensions (worst difference ${diff.toExponential(2)})`);
}

// ---------------------------------------------------------------- 6. applyParameterChange: undo, redo, all-or-nothing including the parameters
{
  const k = build(10, { weld: false });
  const st = k.S.state;
  // width = 120 mm drives every dimension that uses it; two dims read it directly, one as a half
  st.parameters.push({ name: 'width', unit: 'mm', expression: '120 mm' });
  const users = k.dims.filter((c) => c.type === 'distance' && c.dimMode === 'horizontal');
  users.forEach((c, i) => { c.expression = i === 0 ? 'width / 2' : 'width'; c.value = i === 0 ? 60 : 120; });
  quiet(() => commitDimensionEdits(st, users.map((c) => ({ c, value: c.value, name: c.name }))));
  const plan = planChange(st, { type: 'setParameter', name: 'width', text: '140 mm' });
  ok(plan.ok && plan.edits.length === users.length, `plan: width 120 -> 140 touches ${users.length} dimensions: ${JSON.stringify(plan).slice(0, 200)}`);
  const before = image(st), stackBefore = stacks(st);
  const res = quiet(() => applyParameterChange(st, plan, 'width 120 -> 140'));
  ok(res.ok === true, 'applyParameterChange accepted: ' + JSON.stringify(res));
  ok(st.parameters[0].expression === '140 mm', 'the parameter is 140 mm: ' + st.parameters[0].expression);
  ok(users.every((c, i) => c.value === (i === 0 ? 70 : 140) && Math.abs(measured(k.S, c) - c.value) < 1e-4), 'every dimension that uses width moved: ' + users.map((c) => c.value));
  ok(st.history.length === stackBefore[0] + 1, 'ONE undo step for the whole change');
  const after = image(st);
  st.undo();
  ok(image(st) === before, 'ONE undo restores geometry, values, expressions and the parameter exactly');
  ok(st.history.length === stackBefore[0] && st.redoStack.length === 1, 'the undo stack went back by exactly one step');
  st.redo();
  ok(image(st) === after, 'redo re-applies the whole change exactly');

  // refused plans: cycle, unknown name, impossible geometry
  st.parameters.push({ name: 'p2', unit: 'mm', expression: 'width + 1 mm' });
  const snapImg = image(st), snapStacks = stacks(st);
  const cycle = planChange(st, { type: 'setParameter', name: 'width', text: 'p2' });
  ok(cycle.ok === false && cycle.code === 'CYCLE', 'a cycle is refused by the plan: ' + cycle.code);
  const cres = applyParameterChange(st, cycle);
  ok(cres.ok === false && image(st) === snapImg && canon(stacks(st)) === canon(snapStacks), 'applying a refused cycle plan changes NOTHING (no undo step either)');
  const unknown = planChange(st, { type: 'setParameter', name: 'nope', text: '1 mm' });
  const ures = applyParameterChange(st, unknown);
  ok(unknown.ok === false && unknown.code === 'UNKNOWN_NAME' && ures.ok === false && image(st) === snapImg, 'an unknown name is refused before anything changes');
}

{ // an impossible parameter change: geometry, radii, expressions, PARAMETERS and the undo stack all restored; the dimension is named
  const k = build(10, { weld: false });
  const st = k.S.state;
  st.parameters.push({ name: 'side', unit: 'mm', expression: '60 mm' }, { name: 'other', unit: 'mm', expression: '5 mm' });
  const h = k.dims.find((c) => c.dimMode === 'horizontal');
  h.expression = 'other * 2'; h.value = 10; quiet(() => commitDimensionEdits(st, [{ c: h, value: 10 }]));
  k.tri[0].expression = 'side';
  const before = image(st), stackBefore = stacks(st);
  const plan = planChange(st, { type: 'setParameter', name: 'side', text: '1000 mm' });
  ok(plan.ok, 'the plan itself is fine (the parameter evaluates): impossibility is the SOLVER\'s to judge');
  const res = quiet(() => applyParameterChange(st, plan, 'side 60 -> 1000'));
  ok(res.ok === false && res.reverted === true && res.culprit && res.culprit.name === k.tri[0].name, 'refused, naming the dimension: ' + JSON.stringify(res.culprit));
  ok(image(st) === before, 'geometry, radii, constraint values, names, expressions and PARAMETERS are exactly as before');
  ok(canon(stacks(st)) === canon(stackBefore), 'the refused change left no undo step (history ' + stacks(st) + ')');
  // a refusal after a ref dimension appears in the plan
}

console.log(`parameters-batch: ${checks} checks passed`);
