// tests/export-sim-801-perf-raster-live.test.js — TASK 801 / 861: the Export simulation's COST for a dense Raster pocket (Phase B),
// measured in the real Shaper page (desktop 1280 x 800; headless Edge, swiftshader WebGL).
// Dense Raster pocket (600 x 400 mm, 1/8 in bit, 30 % stepover): 3D, Show passes, 2D, and Paths frame times + rebuild counts.
import assert from 'node:assert';
import { sleep } from './helpers/cdp-browser.js';
import { SIM_PERF_CONFIG, launchSimPerfSession } from './helpers/export-sim-perf-live.js';

const session = await launchSimPerfSession({ tag: '801-perf-raster' });
if (!session) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, waitFor, clickEl, openStage, sim, view3d, setView, measureRun, scrubFraction, close } = session;

try {
  // ── B. a dense Raster pocket ──
  await evalJs(`(async () => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.profiles.length = 0;
    [[0, 0], [600, 0], [600, 400], [0, 400]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('801 raster');
    const lf = await import('/packages/core/loop-finder.js');
    const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.clear();
    cp.V2_PLAN.use(st).load([['loop:' + lf.findLoops(st)[0].id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', clearing: 'raster', stepover: 30, finishAllowance: 0.5, rasterAngle: 0 }]]);
  })()`);
  await openStage('review');
  await clickEl('#review-view-3d');
  const t0 = Date.now();
  await waitFor(`!document.getElementById('sim-preview-all').disabled && document.getElementById('sim-op').options.length === 1`, 'the raster pocket\'s timeline', SIM_PERF_CONFIG.readyWaitMs);
  await clickEl('#review-sim-toggle');
  const rs = await sim();
  console.log(`PERF raster pocket timeline ready in ${Date.now() - t0} ms: ${JSON.stringify(rs.ops)}`);
  await clickEl('#sim-preview-all');
  const steps = (await sim()).run[0].steps;
  console.log(`PERF raster pocket: ${steps} steps (passes, ring, wall) in one operation`);
  const B3 = await measureRun('dense raster 3D, 4x', 10);
  assert.ok(B3.s.rebuilds.length > 0, 'raster 3D rebuilds measured');
  await clickEl('#sim-passes'); await sleep(300);
  console.log(`PERF raster Show passes, first build: ${Math.round((await view3d()).last.passesMs)} ms`);
  await measureRun('dense raster 3D + Show passes, 4x', 6);
  await clickEl('#sim-passes');
  await scrubFraction(0.02);
  await setView('2d'); await measureRun('dense raster 2D, 4x', 5);
  await setView('paths'); await measureRun('dense raster Paths, 4x', 5);
  console.log('export-sim-801-perf-raster-live: ok');
} finally {
  await close();
}
