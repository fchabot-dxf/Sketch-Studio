// tests/export-sim-801-perf-wave-passes-live.test.js — TASK 801 / 861: Export simulation COST for wave relief Show passes, 2D, and Paths,
// measured in the real Shaper page (desktop 1280 x 800; headless Edge, swiftshader WebGL).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './helpers/cdp-browser.js';
import { openWaveReliefSession } from './helpers/export-sim-perf-live.js';

const EVIDENCE_DIR = path.resolve('.evidence/801');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const session = await openWaveReliefSession({ tag: '801-perf-wave-passes' });
if (!session) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, evalJs, clickEl, view3d, setView, measureRun, scrubFraction, finished, cleanup } = session;

try {
  await clickEl('#sim-passes');
  await sleep(300);
  const pv = await view3d();
  console.log(`PERF Show passes, first build: ${Math.round(pv.last.passesMs)} ms; ${JSON.stringify(pv.passes)}`);
  const AP = await measureRun('wave relief 3D + Show passes, 4x', 8);
  await evalJs(`document.getElementById('review-top').click()`); await sleep(500);
  {
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      clip: await evalJs(`(() => { const r = document.getElementById('review-stage').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`),
    });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'perf-wave-passes-top.png'), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, 'perf-wave-passes-top.png'));
  }
  await clickEl('#sim-passes');
  await scrubFraction(1); await sleep(300);
  const end = await view3d();
  assert.strictEqual(end.triangles, finished.triangles, `at the end the wood is the finished part (${end.triangles} = ${finished.triangles} triangles)`);
  await scrubFraction(0.05);
  await setView('2d'); const A2 = await measureRun('wave relief 2D, 4x', 5);
  await setView('paths'); const AP2 = await measureRun('wave relief Paths, 4x', 5);
  void AP; void A2; void AP2;
  console.log('export-sim-801-perf-wave-passes-live: ok');
} finally {
  await cleanup();
}
