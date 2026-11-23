// tests/export-sim-801-perf-wave-3d-live.test.js — TASK 801 / 861: Export simulation COST for wave relief 3D + scrub cache,
// measured in the real Shaper page (desktop 1280 x 800; headless Edge, swiftshader WebGL).
import assert from 'node:assert';
import { openWaveReliefSession } from './helpers/export-sim-perf-live.js';

const session = await openWaveReliefSession({ tag: '801-perf-wave-3d' });
if (!session) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { view3d, measureRun, scrubFraction, cleanup } = session;

try {
  const A3 = await measureRun('wave relief 3D (Roughing + Contour), 4x', 10);
  assert.ok(A3.s.frames.length > 3 && A3.s.rebuilds.length > 0, 'frames and 3D rebuilds measured');
  await scrubFraction(0.3); const a = await view3d();
  await scrubFraction(0.6); const b = await view3d();
  await scrubFraction(0.3); const c = await view3d();
  console.log(`PERF scrub 0.3 -> 0.6 -> 0.3: built ${a.last.built} ${Math.round(a.last.woodMs)} ms, ${b.last.built} ${Math.round(b.last.woodMs)} ms, back: built ${c.last.built} ${Math.round(c.last.ms)} ms`);
  assert.strictEqual(c.last.built, false, 'a point already built is shown again without a rebuild (kept)');
  console.log('export-sim-801-perf-wave-3d-live: ok');
} finally {
  await cleanup();
}
