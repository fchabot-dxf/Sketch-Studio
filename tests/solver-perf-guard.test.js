// tests/solver-perf-guard.test.js -- TASK 541: a LOOSE guard on the solver's speed on large sketches (scripts/solver-bench.mjs builds the
// sketches and runs the real seams). Each limit is 3x the time measured when task 541 made the solver sparse (Node 24, the owner's PC), so
// machine load does not flake it and only a real slowdown (a dense matrix back in the loop, an O(n^2) pass per row) fails it. Each time
// is the best of a few repeats. Before task 541 the same measurements were 10x to 50x slower (WORK-LOG TURN 541).
import assert from 'node:assert';
import { buildSketch, dragTimes, batchTime } from '../scripts/solver-bench.mjs';
import * as L from './harness/audit/lib.js';
import { SolverConfig } from '#core/solver-config.js';

const quiet = (f) => { const l = console.log, e = console.error, w = console.warn; console.log = console.error = console.warn = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; } };
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const ITER = SolverConfig.ITERATIONS || 500;

// size -> limits in ms (3x the task 541 measurement): a full solve from a perturbed pose, one drag event (the select tool's pointer move + the
// frame solve, median of 20 events)
const LIMITS = { 50: { solve: 4, drag: 6 }, 200: { solve: 18, drag: 16 }, 400: { solve: 115, drag: 36 } };
const BATCH100_LIMIT = 5000; // 100 dimension values through applyParameterChange, a sketch of ~600 constraints (task 541: 1.4-1.6 s; before: 87 s)

const failures = [];
for (const [size, lim] of Object.entries(LIMITS)) {
  const { S, free, size: span } = buildSketch(+size);
  const ref = L.snapshot(S);
  const solves = [];
  for (const seed of [11, 23, 37]) {
    L.restore(S, ref); L.jitter(S, seed, 0.02, span);
    const t0 = performance.now(); quiet(() => S.engine.solve(ITER)); solves.push(performance.now() - t0);
  }
  L.restore(S, ref); quiet(() => S.engine.solve(ITER));
  const drags = [];
  for (let k = 0; k < 2; k++) {
    const d = dragTimes(S, free[Math.floor(free.length / 2)], 20);
    drags.push(median(d.move.map((m, i) => m + d.frame[i])));
  }
  const solve = Math.min(...solves), drag = Math.min(...drags);
  console.log(`size ${size}: full solve ${solve.toFixed(1)} ms (limit ${lim.solve}), drag event ${drag.toFixed(1)} ms (limit ${lim.drag})`);
  if (solve > lim.solve) failures.push(`size ${size}: a full solve takes ${solve.toFixed(1)} ms, more than ${lim.solve} ms (3x the task 541 time)`);
  if (drag > lim.drag) failures.push(`size ${size}: a drag event takes ${drag.toFixed(1)} ms, more than ${lim.drag} ms (3x the task 541 time)`);
}
{
  const { S } = buildSketch(0, { dims: 100 });
  const b = batchTime(S, 100);
  assert.ok(b.ok && b.dims === 100, `the 100-dimension batch is accepted (${b.dims} dims, ok ${b.ok})`);
  console.log(`batch of 100 dimensions: ${b.ms.toFixed(0)} ms (limit ${BATCH100_LIMIT})`);
  if (b.ms > BATCH100_LIMIT) failures.push(`the 100-dimension batch takes ${b.ms.toFixed(0)} ms, more than ${BATCH100_LIMIT} ms (3x the task 541 time)`);
}
if (failures.length) { console.error('solver-perf-guard FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('solver-perf-guard.test.js: ok');
