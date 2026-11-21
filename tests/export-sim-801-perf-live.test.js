// tests/export-sim-801-perf-live.test.js — TASK 801: the Export simulation's COST, measured in the real Shaper page (desktop 1280 x 800; headless Edge, swiftshader
// WebGL: a software renderer, so the frame times are an upper bound of a real GPU's). Nothing here is an owner's file: the relief is GENERATED (tests/fixtures/wave-relief.js,
// a smooth wave height field of ~208 000 triangles) and opened through the drawer's Open STL; the raster pocket is drawn here.
//   A. the wave relief: its Roughing (as opened) + a Contour; Export 3D, Preview all at 4x: the frame times (requestAnimationFrame intervals while it plays) and the
//      3D rebuild cost per step (review-view.js setSim: buildRelief of the carved items), then with Show passes (the swept volumes: their first build and the frames);
//      a scrub back to a point already built (kept: no rebuild); at the end the wood is the finished part. 2D and Paths frame times on the same run.
//   B. a dense Raster pocket (600 x 400 mm, 1/8 in bit, 30 % stepover: hundreds of passes): the same measures.
// Prints PERF lines (the numbers the report quotes); asserts only that each measure was taken and the end state is the finished part.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import * as M from './helpers/stl-mesh.js';
import { waveRelief } from './fixtures/wave-relief.js';

const EVIDENCE_DIR = path.resolve('.evidence/801');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-801-'));
const tris = waveRelief({ n: 320 });
const STL = path.join(tmp, 'wave.stl');
fs.writeFileSync(STL, M.binaryStl(tris));
console.log(`the generated relief: ${tris.length / 9} triangles`);

const cdp = await launchBrowser({ tag: '801-perf', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, evalJs, waitFor, navigate } = cdp;
const press = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const clickEl = async (sel) => {
  await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); })()`);
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  assert.ok(p, `${sel} is on screen`);
  await press(p.x, p.y);
};
const openStage = async (id) => { await clickEl(`.sk-header-tab[data-tab="${id}"]`); await waitFor(`!document.getElementById('${id === 'design' ? 'design-view' : 'view-' + id}').hidden`, `the ${id} stage`); };
const sim = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().inspect())`);
const view3d = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView() && m.currentReviewView().inspect().sim)`);
const clearLog = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().clearLog())`);
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN); return { n: s.length, median: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s.length ? s[s.length - 1] : NaN) }; };
const setView = async (v) => { await clickEl(`#review-view-${v}`); await sleep(800); };
async function measureRun(name, seconds) { // at 4x: the whole file plays in SIM.fileSeconds / 4 = 10 s
  await evalJs(`document.getElementById('sim-speed').value = '4'; document.getElementById('sim-speed').dispatchEvent(new Event('change'))`);
  await clearLog();
  if (!(await sim()).playing) await clickEl('#sim-play');
  await sleep(seconds * 1000);
  const s = await sim();
  if (s.playing) await clickEl('#sim-play');
  const f = stats(s.frames.slice(1)), r = stats(s.rebuilds.map((x) => x.ms));
  console.log(`PERF ${name}: frames ${JSON.stringify(f)} ms; 3D rebuilds ${JSON.stringify(r)} ms (${s.rebuilds.length} in ${seconds} s); run at ${Math.round((s.t / s.total) * 100)} %`);
  return { f, r, s };
}
async function scrubFraction(f) {
  await evalJs(`(() => { const e = document.getElementById('sim-scrub'); e.value = String(Math.round(${f} * 1000)); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(100);
}
try {
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await evalJs(`localStorage.setItem('shaper-review-view', '3d')`);

  // ── A. the wave relief: Roughing + Contour ──
  await evalJs('delete window.showOpenFilePicker');
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await clickEl('.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
  const chooser = once('Page.fileChooserOpened');
  await clickEl('[data-action="open-stl"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, 'the file chooser opened');
  let t0 = Date.now();
  await send('DOM.setFileInputFiles', { files: [STL], backendNodeId: ch.backendNodeId });
  await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.includes(': a relief, ')`, 'the import notice', 180000);
  console.log(`PERF open STL: ${Date.now() - t0} ms: ${await evalJs(`document.getElementById('prepare-notice').textContent`)}`);
  await evalJs(`Promise.all([import('/apps/shaper/src/cut-plan.js'), import('/apps/shaper/src/operations-store.js')]).then(([cp, os]) => { const r = os.storeOps().find((o) => o.type === 'roughing'); cp.newOperation('contour', [r.geometry[0].key], window.__designController.state); })`);
  await openStage('review');
  t0 = Date.now();
  await waitFor(`!document.getElementById('sim-preview-all').disabled`, 'the Simulate card ready', 300000);
  await clickEl('#review-sim-toggle'); // the panel over the view (closed at first)
  console.log(`PERF the timeline ready (paths generated + the preview copy) in ${Date.now() - t0} ms: ${JSON.stringify((await sim()).ops)}`);
  await waitFor(`import('/apps/shaper/src/main.js').then((m) => !!(m.currentReviewView() && m.currentReviewView().lastBuild))`, 'the 3D built', 120000);
  const finished = await evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().lastBuild)`);
  console.log(`PERF the finished part (the Review's build): ${finished.triangles} triangles, ${finished.levels} levels, ${Math.round(finished.ms)} ms`);
  await clickEl('#sim-preview-all');
  const A3 = await measureRun('wave relief 3D (Roughing + Contour), 4x', 10);
  assert.ok(A3.s.frames.length > 3 && A3.s.rebuilds.length > 0, 'frames and 3D rebuilds measured');
  await scrubFraction(0.3); const a = await view3d();
  await scrubFraction(0.6); const b = await view3d();
  await scrubFraction(0.3); const c = await view3d();
  console.log(`PERF scrub 0.3 -> 0.6 -> 0.3: built ${a.last.built} ${Math.round(a.last.woodMs)} ms, ${b.last.built} ${Math.round(b.last.woodMs)} ms, back: built ${c.last.built} ${Math.round(c.last.ms)} ms`);
  assert.strictEqual(c.last.built, false, 'a point already built is shown again without a rebuild (kept)');
  await clickEl('#sim-passes');
  await sleep(300);
  const pv = await view3d();
  console.log(`PERF Show passes, first build: ${Math.round(pv.last.passesMs)} ms; ${JSON.stringify(pv.passes)}`);
  const AP = await measureRun('wave relief 3D + Show passes, 4x', 8);
  await evalJs(`document.getElementById('review-top').click()`); await sleep(500);
  { const { data } = await send('Page.captureScreenshot', { format: 'png', clip: await evalJs(`(() => { const r = document.getElementById('review-stage').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`) }); fs.writeFileSync(path.join(EVIDENCE_DIR, 'perf-wave-passes-top.png'), Buffer.from(data, 'base64')); console.log('screenshot ' + path.join(EVIDENCE_DIR, 'perf-wave-passes-top.png')); }
  await clickEl('#sim-passes');
  await scrubFraction(1); await sleep(300);
  const end = await view3d();
  assert.strictEqual(end.triangles, finished.triangles, `at the end the wood is the finished part (${end.triangles} = ${finished.triangles} triangles)`);
  await scrubFraction(0.05);
  await setView('2d'); const A2 = await measureRun('wave relief 2D, 4x', 5);
  await setView('paths'); const AP2 = await measureRun('wave relief Paths, 4x', 5);
  void AP; void A2; void AP2;

  // ── B. a dense Raster pocket ──
  await openStage('design');
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
  t0 = Date.now();
  await waitFor(`!document.getElementById('sim-preview-all').disabled && document.getElementById('sim-op').options.length === 1`, 'the raster pocket\'s timeline', 300000);
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
  console.log('export-sim-801-perf-live: ok');
} finally {
  await cdp.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
