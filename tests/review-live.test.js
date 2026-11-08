// tests/review-live.test.js — TASK 459: the Review tab in the REAL app (headless Edge, software WebGL): a real tab click builds the
// 3D workpiece from the cut plan, a real mouse drag orbits it, Reset/Top change the view.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) {}
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let url = (req.url || '/').split('?')[0];
        if (url.endsWith('/')) url += 'index.html';
        const file = path.normalize(path.join(REPO_ROOT, decodeURIComponent(url)));
        if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch (e) { res.writeHead(404); res.end('nf ' + e.message); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function waitForJson(dbgPort) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`); if (r.ok) return true; } catch (_) {}
    await sleep(200);
  }
  return false;
}

async function closeBrowser(proc, dbgPort) {
  const exited = new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', () => res()); });
  try {
    const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
    if (v && v.webSocketDebuggerUrl) {
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); setTimeout(rej, 2000); });
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await Promise.race([exited, sleep(3000)]);
      try { ws.close(); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (process.platform === 'win32' && proc.pid) execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    else proc.kill();
  } catch (_) {}
}

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9910 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-459-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', // software WebGL for the headless run
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    assert(await waitForJson(dbgPort), 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    assert(page, 'no CDP page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map(); const evs = {};
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    const once = (m) => new Promise((res) => { (evs[m] = evs[m] || []).push(res); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });
    await new Promise((r) => ws.addEventListener('open', r));
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') console.log('PAGE LOG ERROR:', m.params.entry.text, m.params.entry.url || ''); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const mouse = async (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: (buttons || type === 'mouseReleased') ? 1 : 0 });
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); await mouse('mouseReleased', c.x, c.y); await sleep(200);
    };
    const openMode = async (mode) => { // real click; retry because the nav shifts while the page's late widgets mount
      for (let i = 0; i < 5; i++) {
        await clickEl(`[data-mode="${mode}"]`); await sleep(300);
        if (await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`) === mode) return;
      }
      assert.fail('could not open the ' + mode + ' tab');
    };
    const shot = async (name) => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(r.data, 'base64');
      if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
      return { md5: createHash('md5').update(buf).digest('hex'), bytes: buf.length };
    };

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]); await sleep(1500);
    await openMode('design'); await sleep(1200);
    // seed: A = 40x40 square (Inside, depth unset -> through), B = 50x60 pocket 8 deep with a 20x20 ISLAND
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const rect = (p, x, y, w, h) => { const n = [p+'a', p+'b', p+'c', p+'d']; [[0,0],[w,0],[w,h],[0,h]].forEach(([dx,dy], i) => st.joints.set(n[i], { x: x+dx, y: y+dy })); [0,1,2,3].forEach((i) => st.shapes.push({ id: p+'s'+i, type: 'line', joints: [n[i], n[(i+1)%4]] })); };
      rect('A', 0, 0, 40, 40); rect('B', 70, 0, 50, 60); rect('I', 85, 20, 20, 20);
    })()`);
    await openMode('prepare'); await sleep(800);
    await evalJs(`(async () => {
      const plan = await import('/apps/shaper/src/cut-plan.js');
      const { findLoops } = await import('#core/loop-finder.js');
      const { loopPolygon } = await import('#core/loop-geometry.js');
      const stt = window.__designController.state;
      const loops = findLoops(stt).map((l) => ({ ...l, polygon: loopPolygon(l, stt, new Map(stt.shapes.map((sh) => [sh.id, sh]))) }));
      const minX = (l) => Math.min(...l.polygon.map((p) => p.x));
      const A = loops.find((l) => Math.abs(minX(l) - 0) < 1e-6), B = loops.find((l) => Math.abs(minX(l) - 70) < 1e-6);
      plan.CUT_PLAN.set(plan.keyOf('loop', A.id), { cutType: 'interior', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175 });
      plan.CUT_PLAN.set(plan.keyOf('loop', B.id), { cutType: 'pocket', cutDepth: 8, cutOffset: 0, toolDia: 6.35 });
    })()`);
    await openMode('review');
    let infoText = '';
    for (let i = 0; i < 40 && !/triangles/.test(infoText); i++) { await sleep(250); infoText = await evalJs(`document.getElementById('review-info').textContent`); }
    console.log('review info:', infoText);
    assert.match(infoText, /\d+ triangles/, 'the Review built a model: ' + infoText);
    const tri = Number(/(\d+) triangles/.exec(infoText)[1]), ms = Number(/built in (\d+) ms/.exec(infoText)[1]);
    assert.ok(tri > 100 && tri < 100000, 'triangle count within budget: ' + tri);
    assert.ok(/depth unset shown cut through/.test(infoText), 'the unset Inside is flagged: ' + infoText);

    await clickEl('#review-reset'); await sleep(400);
    const resetShot = await shot('review-reset.png');
    const c = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1); // a real left-button drag = orbit
    for (let k = 1; k <= 12; k++) { await mouse('mouseMoved', c.x - k * 14, c.y - k * 5, 1); await sleep(30); }
    await mouse('mouseReleased', c.x - 168, c.y - 60); await sleep(500);
    const orbitShot = await shot('review-orbit.png');
    await clickEl('#review-top'); await sleep(400);
    const topShot = await shot('review-top.png');
    console.log(`review top ${topShot.md5} (${topShot.bytes} B) orbit ${orbitShot.md5} (${orbitShot.bytes} B) reset ${resetShot.md5}`);
    assert.notStrictEqual(resetShot.md5, orbitShot.md5, 'orbiting changed the picture');
    assert.notStrictEqual(orbitShot.md5, topShot.md5, 'Top changed the picture');

    await evalJs(`localStorage.setItem('shaper-mode', 'simexport')`); // the stored tab name migrates
    const loaded2 = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded2, sleep(8000)]); await sleep(1200);
    assert.strictEqual(await evalJs(`document.querySelector('.mode-btn.active').dataset.mode`), 'review', "a stored 'simexport' opens Review");
    console.log(`review-live: ok (${tri} triangles, ${ms} ms)`);
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
