// tests/helpers/export-sim-perf-live.js — Shared CDP harness, declared budgets/config, and wave-relief STL setup for TASK 801 / 861.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './cdp-browser.js';
import * as M from './stl-mesh.js';
import { waveRelief } from '../fixtures/wave-relief.js';

export const SIM_PERF_CONFIG = Object.freeze({
  width: 1280,
  height: 800,
  browserArgs: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  speed: '4',
  setViewPauseMs: 800,
  scrubPauseMs: 100,
  openWaitMs: 180000,
  readyWaitMs: 300000,
  buildWaitMs: 120000,
});

export const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN);
  return { n: s.length, median: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s.length ? s[s.length - 1] : NaN) };
};

export async function launchSimPerfSession({ tag }) {
  const cdp = await launchBrowser({
    tag,
    width: SIM_PERF_CONFIG.width,
    height: SIM_PERF_CONFIG.height,
    args: SIM_PERF_CONFIG.browserArgs,
  });
  if (!cdp) return null;
  const { port, send, once, evalJs, waitFor, navigate, close } = cdp;

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
  const openStage = async (id) => {
    await clickEl(`.sk-header-tab[data-tab="${id}"]`);
    await waitFor(`!document.getElementById('${id === 'design' ? 'design-view' : 'view-' + id}').hidden`, `the ${id} stage`);
  };
  const sim = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().inspect())`);
  const view3d = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView() && m.currentReviewView().inspect().sim)`);
  const clearLog = () => evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentExportSim().clearLog())`);
  const setView = async (v) => { await clickEl(`#review-view-${v}`); await sleep(SIM_PERF_CONFIG.setViewPauseMs); };

  async function measureRun(name, seconds) { // at 4x: the whole file plays in SIM.fileSeconds / 4 = 10 s
    await evalJs(`document.getElementById('sim-speed').value = ${JSON.stringify(SIM_PERF_CONFIG.speed)}; document.getElementById('sim-speed').dispatchEvent(new Event('change'))`);
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
    await sleep(SIM_PERF_CONFIG.scrubPauseMs);
  }

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await evalJs(`localStorage.setItem('shaper-review-view', '3d')`);

  return { port, send, once, evalJs, waitFor, press, clickEl, openStage, sim, view3d, clearLog, setView, measureRun, scrubFraction, close };
}

export async function openWaveReliefSession({ tag }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-801-wave-'));
  const tris = waveRelief({ n: 320 });
  const STL = path.join(tmp, 'wave.stl');
  fs.writeFileSync(STL, M.binaryStl(tris));
  console.log(`the generated relief: ${tris.length / 9} triangles`);

  const session = await launchSimPerfSession({ tag });
  if (!session) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  const { send, once, evalJs, waitFor, clickEl, openStage, sim, close } = session;
  const cleanup = async () => {
    await close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  try {
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
    await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.includes(': a relief, ')`, 'the import notice', SIM_PERF_CONFIG.openWaitMs);
    console.log(`PERF open STL: ${Date.now() - t0} ms: ${await evalJs(`document.getElementById('prepare-notice').textContent`)}`);
    await evalJs(`Promise.all([import('/apps/shaper/src/cut-plan.js'), import('/apps/shaper/src/operations-store.js')]).then(([cp, os]) => { const r = os.storeOps().find((o) => o.type === 'roughing'); cp.newOperation('contour', [r.geometry[0].key], window.__designController.state); })`);
    await openStage('review');
    t0 = Date.now();
    await waitFor(`!document.getElementById('sim-preview-all').disabled`, 'the Simulate card ready', SIM_PERF_CONFIG.readyWaitMs);
    await clickEl('#review-sim-toggle'); // the panel over the view (closed at first)
    console.log(`PERF the timeline ready (paths generated + the preview copy) in ${Date.now() - t0} ms: ${JSON.stringify((await sim()).ops)}`);
    await waitFor(`import('/apps/shaper/src/main.js').then((m) => !!(m.currentReviewView() && m.currentReviewView().lastBuild))`, 'the 3D built', SIM_PERF_CONFIG.buildWaitMs);
    const finished = await evalJs(`import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().lastBuild)`);
    console.log(`PERF the finished part (the Review's build): ${finished.triangles} triangles, ${finished.levels} levels, ${Math.round(finished.ms)} ms`);
    await clickEl('#sim-preview-all');
    return { ...session, finished, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
