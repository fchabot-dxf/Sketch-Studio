// tests/audits/solver-ux-audit-1000-perf.mjs -- TASK 1000 (AUDIT, outside the gate)
// Run: node tests/audits/solver-ux-audit-1000-perf.mjs
// PERFORMANCE feel: ~50, ~100, ~200 constrained items — measures per-drag-frame engine.solve (quick + full),
// analyzeConstraintStatus (called every frame by renderer + every drag move by getDragDOF!), and end-to-end real pointermove latency.
import { performance } from 'node:perf_hooks';
import { design, openDesign, closeAll, row, f, quiet } from './solver-ux-audit-1000-kit.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { SolverConfig } from '#core/solver-config.js';

function buildRectGrid(nRects) {
  // nRects constrained rectangles (4 lines + 4 joints + 4 H/V + 1 width dim each, 1 free corner per rect)
  const joints = {};
  const shapes = [];
  const constraints = [];
  const cols = Math.ceil(Math.sqrt(nRects));
  for (let i = 0; i < nRects; i++) {
    const gx = (i % cols) * 40, gy = Math.floor(i / cols) * 30;
    const a = `r${i}_a`, b = `r${i}_b`, c = `r${i}_c`, d = `r${i}_d`;
    joints[a] = [gx, gy, true];
    joints[b] = [gx + 25, gy, false];
    joints[c] = [gx + 25, gy + 15, false];
    joints[d] = [gx, gy + 15, false];
    shapes.push(
      { id: `L${i}_1`, type: 'line', joints: [a, b] },
      { id: `L${i}_2`, type: 'line', joints: [b, c] },
      { id: `L${i}_3`, type: 'line', joints: [c, d] },
      { id: `L${i}_4`, type: 'line', joints: [d, a] },
    );
    constraints.push(
      { type: 'horizontal', joints: [a, b] },
      { type: 'vertical', joints: [b, c] },
      { type: 'horizontal', joints: [c, d] },
      { type: 'vertical', joints: [d, a] },
      { type: 'distance', joints: [a, b], value: 25, name: `d${i + 1}` },
    );
  }
  return design(joints, shapes, constraints);
}

function buildConnectedChain(nSegs) {
  // Single connected chain of nSegs equal-length segments (coupled Jacobian!)
  const joints = { p0: [0, 0, true] };
  const shapes = [];
  const constraints = [];
  for (let i = 1; i <= nSegs; i++) {
    joints[`p${i}`] = [i * 10, (i % 2) * 4, false];
    shapes.push({ id: `S${i}`, type: 'line', joints: [`p${i - 1}`, `p${i}`] });
    constraints.push({ type: 'distance', joints: [`p${i - 1}`, `p${i}`], value: Math.hypot(10, 4), name: `d${i}` });
  }
  return design(joints, shapes, constraints);
}

function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const p50 = s[Math.floor(s.length * 0.5)];
  const p95 = s[Math.floor(s.length * 0.95)];
  const max = s[s.length - 1];
  return `mean=${f(mean, 2)}ms p50=${f(p50, 2)}ms p95=${f(p95, 2)}ms max=${f(max, 2)}ms`;
}

async function bench(id, doc, dragJointId, dx, dy) {
  const app = await openDesign(doc, { centre: { x: 120, y: 90 }, w: 500 });
  const st = app.state;
  const nShapes = st.shapes.length, nJoints = st.joints.size, nConstraints = st.constraints.length;

  // 1. Direct engine.solve (QUICK_SOLVE=8 and ITERATIONS=500) during a simulated drag
  const j = st.joints.get(dragJointId);
  const quickTimes = [], fullTimes = [], statusTimes = [];
  const frames = 15;
  for (let k = 1; k <= frames; k++) {
    const tx = j.x + dx / frames, ty = j.y + dy / frames;
    const t0 = performance.now();
    st.engine.solve(SolverConfig.QUICK_SOLVE || 8, { dragTarget: { jointId: dragJointId, x: tx, y: ty, stiffness: 1e4 } });
    const t1 = performance.now();
    st.engine.solve(SolverConfig.ITERATIONS || 500, { dragTarget: { jointId: dragJointId, x: tx, y: ty, stiffness: 1e4 } });
    const t2 = performance.now();
    analyzeConstraintStatus({ joints: st.joints, shapes: st.shapes, constraints: st.constraints, groups: st.groups });
    const t3 = performance.now();
    quickTimes.push(t1 - t0);
    fullTimes.push(t2 - t1);
    statusTimes.push(t3 - t2);
  }

  // 2. Real pointermove frames through the app's full input + render loop
  const from = app.toScreen(j.x, j.y);
  const to = app.toScreen(j.x + 15, j.y + 15);
  const moveTimes = [];
  await quiet(async () => {
    app.move(from.x, from.y);
    app.down(from.x, from.y);
    for (let k = 1; k <= 10; k++) {
      const t0 = performance.now();
      app.move(from.x + (to.x - from.x) * k / 10, from.y + (to.y - from.y) * k / 10, { buttons: 1 });
      moveTimes.push(performance.now() - t0);
    }
    app.up(to.x, to.y);
  });

  row(id, `shapes=${nShapes} joints=${nJoints} constraints=${nConstraints} | quickSolve(8): ${stats(quickTimes)} | fullSolve(500): ${stats(fullTimes)} | analyzeStatus(1x): ${stats(statusTimes)} | realPointerMove(incl. render): ${stats(moveTimes)}`);
}

await (async () => {
  await bench('P1.rect15', buildRectGrid(15), 'r0_c', 0, 12);     // 60 lines, 75 constraints
  await bench('P1.rect25', buildRectGrid(25), 'r0_c', 0, 12);     // 100 lines, 125 constraints
  await bench('P1.rect50', buildRectGrid(50), 'r0_c', 0, 12);     // 200 lines, 250 constraints
  await bench('P2.chain50', buildConnectedChain(50), 'p50', -15, 25);   // 50 coupled segments
  await bench('P2.chain100', buildConnectedChain(100), 'p100', -15, 25); // 100 coupled segments
  await bench('P2.chain200', buildConnectedChain(200), 'p200', -15, 25); // 200 coupled segments
  await closeAll();
})();
console.log('solver-ux-audit-1000-perf.mjs: printed (exit 0 whatever the rows say)');
