// scripts/solver-bench.mjs -- TASK 541: the solver's speed on large sketches, measured reproducibly (pure node, the real seams).
//   node scripts/solver-bench.mjs                 every size (50 / 100 / 200 / 400 constraints), every measurement
//   node scripts/solver-bench.mjs 200 400         only these sizes (add --batch100 for the 100-dimension batch row too)
//   node --cpu-prof --cpu-prof-dir=<dir> scripts/solver-bench.mjs 400      profile one size, then:
//   node scripts/solver-bench.mjs --top <file.cpuprofile> [n]              the n functions with the most self time in that profile
// A generated sketch is a realistic mix built through the same tool seams the app uses (tests/harness/audit/lib.js: rect tool, fillet tool,
// circle, arc tool, ConstraintManager.createConstraint): a chain of rectangles welded corner to corner from the origin, widths (horizontal)
// and most heights (vertical) dimensioned (the width of every fourth one comes from its EQUAL below), a fillet on every fourth rectangle (arc, tangents, radius dimension), a circle tangent to every
// fourth top edge (radius dimension), an arc tool arc on every fourth top corner (radius dimension) and an EQUAL between that top edge and the
// first one (a long-range coupling), cells added until the sketch has at least the size's count of driving (non-reference) constraints.
// Measurements per size (ms; medians over the repeats):
//   solve     a full solve (SolverConfig.ITERATIONS) from a perturbed pose (every free joint jittered by 2 % of the drawing size, 3 seeds)
//   move      one pointer move of a joint drag through the real select tool (handleSelectionPointerMove: DOF mask, inference, quick solve)
//   frame     the app's frame solve that follows each move (engine.solve(SolverConfig.ITERATIONS), apps/sketchstudio/main.js loop())
//   batch     a batch of up to 100 dimension values (each x1.1) through applyParameterChange (the parameter entry point, one undo step)
//   freedom   engine.jointFreedom() (the nullspace of the constraint Jacobian) and analyzeConstraintStatus (first call at a new pose)
//   batch100  (last row) exactly 100 dimension values x1.1 through applyParameterChange, in a sketch grown until it has 100 driving dimensions
import * as L from '../tests/harness/audit/lib.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { applyParameterChange } from '#ui/dimension-seams.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';
import fs from 'node:fs';

const ITER = SolverConfig.ITERATIONS || 500;
const quiet = (f) => { const l = console.log, e = console.error, w = console.warn; console.log = console.error = console.warn = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; } };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const time = (f) => { const t0 = performance.now(); f(); return performance.now() - t0; };
const driving = (S) => S.state.constraints.filter((c) => c && !L.isDriven(c) && c.type !== 'mouse_spring');

const isDim = (c) => c.type === 'distance' && typeof c.value === 'number' && c.value > 0;
// target: the count of driving constraints; opts.dims: keep adding cells until there are at least this many driving dimensions too
export function buildSketch(target, opts = {}) {
  const S = L.newSketch();
  const mk = (type, p) => ConstraintManager.createConstraint(S.state, type, p, { source: 'bench' });
  const J = (id) => S.state.joints.get(id);
  let x = 0, prevBR = null, firstTop = null, k = 0;
  const free = [];
  quiet(() => {
    while (driving(S).length < target || driving(S).filter(isDim).length < (opts.dims || 0)) {
      const w = 40 + (k % 5) * 6, h = 20 + (k % 3) * 5;
      const r = L.rect(S, x, 0, x + w, h);
      const ids = [...new Set(r.lines.flatMap((id) => L.shape(S, id).joints))];
      const at = (px, py) => ids.find((id) => Math.abs(J(id).x - px) < 1e-9 && Math.abs(J(id).y - py) < 1e-9);
      const bl = at(x, 0), br = at(x + w, 0), tr = at(x + w, h);
      mk('coincident', { joints: [prevBR || L.origin, bl] });
      if (k % 4 !== 3) mk('distance', { joints: [bl, br], value: w, dimMode: 'horizontal' });   // a k % 4 === 3 width is the EQUAL's below
      if (k % 3 !== 2) mk('distance', { joints: [br, tr], value: h, dimMode: 'vertical' });
      else free.push(tr);   // its height is free: a corner the drag can move
      if (!firstTop) firstTop = r.top;
      if (k % 4 === 1) L.fillet(S, r.bottom, r.left, 4);   // the corner at (x, h): lines 3 and 4 of the rect tool
      if (k % 4 === 2) {
        const c = L.circle(S, x + w / 2, h + 8, 8);
        mk('tangent', { shapes: [r.top, c.id] });
        mk('distance', { shape: c.id, value: 8, isRadius: true });
      }
      if (k % 4 === 3) {
        const c = L.point(S, x + w, h + 12), a = L.point(S, x + w + 6, h + 12), b = L.point(S, x + w, h + 18);
        const arc = L.arc(S, c, a, b);
        mk('distance', { shape: arc, value: 6, isRadius: true });
        mk('equal', { shapes: [r.top, firstTop] });
      }
      prevBR = br; x += w + 10; k++;
    }
    S.engine.solve(ITER);
  });
  return { S, free, size: x };
}

const svgAt = (ppu) => { const w = 1000 / ppu; return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: -w / 2, y: -w / 2, width: w, height: w } }, setPointerCapture: () => {}, releasePointerCapture: () => {} }; };

// A joint drag of a free corner in the middle of the chain: 30 pointer events of 6 px at 1 px per world unit, each followed by the frame solve.
export function dragTimes(S, jointId, events = 30) {
  const st = S.state, ppu = 1, svg = svgAt(ppu);
  const scr = (p) => [500 + p[0] * ppu, 500 + p[1] * ppu];
  const j = st.joints.get(jointId);
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const A = scr([j.x, j.y]);
  const ev = (p) => ({ clientX: p[0], clientY: p[1], pointerId: 1, target: { closest: () => null, dataset: {} } });
  quiet(() => handleSelectionPointerDown(ev(A), svg, st, { id: jointId, j }, null, null));
  const move = [], frame = [];
  let cur = A;
  for (let i = 1; i <= events; i++) {
    cur = [A[0] + 1.8 * i, A[1] + 6 * i];
    move.push(time(() => quiet(() => handleSelectionPointerMove(ev(cur), svg, st))));
    frame.push(time(() => quiet(() => S.engine.solve(ITER))));
  }
  quiet(() => handleSelectionPointerUp(ev(cur), svg, st));
  return { move, frame };
}

export function measure(target, opts = {}) {
  const { S, free, size } = buildSketch(target);
  const n = driving(S).length;
  const ref = L.snapshot(S);
  const out = { target, constraints: n, joints: S.state.joints.size, shapes: S.state.shapes.length };
  // full solve from a perturbed pose
  const solves = [];
  for (const seed of [11, 23, 37]) {
    L.restore(S, ref); L.jitter(S, seed, 0.02, size);
    solves.push(time(() => quiet(() => S.engine.solve(ITER))));
  }
  L.restore(S, ref); quiet(() => S.engine.solve(ITER));
  out.solve = median(solves);
  // freedom analysis at the solved pose (analyzeConstraintStatus: its first call at this pose, then the cached repeat)
  out.jointFreedom = median([0, 1, 2].map(() => time(() => S.engine.jointFreedom())));
  const st = { joints: S.state.joints, shapes: S.state.shapes, constraints: S.state.constraints };
  out.status = time(() => quiet(() => analyzeConstraintStatus(st)));
  out.statusCached = time(() => quiet(() => analyzeConstraintStatus(st)));
  // a joint drag
  const d = dragTimes(S, free[Math.floor(free.length / 2)], opts.events || 30);
  out.move = median(d.move); out.frame = median(d.frame); out.moveMax = Math.max(...d.move); out.frameMax = Math.max(...d.frame);
  // a 100-dimension batch through applyParameterChange
  L.restore(S, ref); quiet(() => S.engine.solve(ITER));
  out.batchDims = 0;
  if (opts.batch === false) return out;
  const b = batchTime(S, 100);
  out.batch = b.ms; out.batchDims = b.dims; out.batchOk = b.ok;
  return out;
}

// up to `count` driving dimensions, each x1.1, as ONE parameter change (the plan planChange returns: { ok, paramsAfter, edits })
export function batchTime(S, count) {
  const dims = driving(S).filter(isDim).slice(0, count);
  const plan = { ok: true, paramsAfter: [], edits: dims.map((c) => ({ c, name: c.name, value: c.value * 1.1 })) };
  let res;
  const ms = time(() => { res = quiet(() => applyParameterChange(S.state, plan, 'bench')); });
  return { ms, dims: dims.length, ok: !!(res && res.ok) };
}

function top(file, count = 15) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dt = new Map();
  const byId = new Map(p.nodes.map((nd) => [nd.id, nd]));
  for (let i = 0; i < p.samples.length; i++) { const id = p.samples[i]; dt.set(id, (dt.get(id) || 0) + (p.timeDeltas[i] || 0)); }
  const self = new Map();
  let total = 0;
  for (const [id, us] of dt) {
    const nd = byId.get(id), cf = nd.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + us); total += us;
  }
  const rows = [...self].sort((a, b) => b[1] - a[1]).slice(0, count);
  console.log(`profile ${file}: ${(total / 1e6).toFixed(2)} s sampled; top ${count} by self time`);
  for (const [k, us] of rows) console.log(`${(us / 1e3).toFixed(0).padStart(8)} ms ${(100 * us / total).toFixed(1).padStart(5)} %  ${k}`);
}

if (process.argv[1] && process.argv[1].endsWith('solver-bench.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === '--top') top(args[1], +(args[2] || 15));
  else {
    const batch100 = !args.length || args.includes('--batch100');
    const sizes = args.filter((a) => /^\d+$/.test(a)).map(Number);
    if (!args.length) sizes.push(50, 100, 200, 400);
    console.log('size  constraints joints shapes | solve ms | move ms (max) | frame ms (max) | batch ms (dims, ok) | jointFreedom ms | status ms (cached)');
    for (const s of sizes) {
      const o = measure(s);
      const f = (v) => v.toFixed(1);
      console.log(`${String(s).padStart(4)}  ${String(o.constraints).padStart(11)} ${String(o.joints).padStart(6)} ${String(o.shapes).padStart(6)} | ${f(o.solve).padStart(8)} | ${f(o.move).padStart(7)} (${f(o.moveMax)}) | ${f(o.frame).padStart(8)} (${f(o.frameMax)}) | ${f(o.batch).padStart(8)} (${o.batchDims}, ${o.batchOk}) | ${f(o.jointFreedom).padStart(15)} | ${f(o.status)} (${f(o.statusCached)})`);
    }
    // the 100-dimension parameter batch (task 541 target: under 2 s): a sketch grown until it has 100 driving dimensions
    if (batch100) {
      const { S } = buildSketch(0, { dims: 100 });
      const b = batchTime(S, 100);
      console.log(`batch100: ${b.dims} dimensions x1.1 through applyParameterChange in a sketch of ${driving(S).length} driving constraints: ${b.ms.toFixed(0)} ms (ok ${b.ok})`);
    }
  }
}
