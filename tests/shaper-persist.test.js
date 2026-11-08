// tests/shaper-persist.test.js — TASK 460: Shaper keeps its CUT PLAN (all fields incl. cutterShape) and STOCK across a REAL page reload
// via the host sidecar doc.hosts.shaper; an old document (no sidecar) loads with defaults; a SketchStudio save in between does not
// drop the Shaper sidecar (TASK 458); the export is byte-identical before vs after the reload. Headless Edge, real reload.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { findLoops } from '#core/loop-finder.js';
import { deriveCutFootprint } from '#core/profile-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};
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

async function sendRealKey(send, key, code, vk, modifiers = 0, text = '') {
  const down = { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  if (text) down.text = text;
  await send('Input.dispatchKeyEvent', down);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9510 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-460-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    assert(await waitForJson(dbgPort), 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    assert(page, 'no CDP page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const evs = {};
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    const once = (m) => new Promise((res) => { (evs[m] = evs[m] || []).push(res); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });
    await new Promise((r) => ws.addEventListener('open', r));
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);

    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    const nav = async (u) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url: u }); await Promise.race([l, sleep(8000)]); await sleep(1500); };
    const reload = async () => { const l = once('Page.loadEventFired'); await send('Page.reload'); await Promise.race([l, sleep(8000)]); await sleep(2000); };
    const planJson = () => evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)); })()`);
    const stockJson = () => evalJs(`(async () => { const m = await import('/apps/shaper/src/stock.js'); return JSON.stringify(m.getStock()); })()`);
    const exportStr = () => evalJs(`(async () => {
      const { exportShaperSVG } = await import('/packages/core/shaper-export.js'); const { CUT_TYPES } = await import('/apps/shaper/src/shaper.js');
      const { cutPlanEntries } = await import('/apps/shaper/src/cut-plan.js'); const { findLoops } = await import('/packages/core/loop-finder.js');
      const { loopPolygon } = await import('/packages/core/loop-geometry.js');
      const st = window.__designController.state; const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
      for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
      return exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: CUT_TYPES, docUnit: 'in', options: { groupByCut: true }, loopPolys: lp });
    })()`);
    const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 44, width: 1500, height: 700, scale: 1 } }); if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64')); };

    // ── 1. build a design + cut plan (several types, with cutter shapes) + a non-default stock, then let the autosave run ──
    await nav(url);
    await clickEl('[data-mode="design"]'); await sleep(1200);
    await evalJs(`(async () => {
      const { findLoops, findOpenChains } = await import('/packages/core/loop-finder.js');
      const { CUT_PLAN, keyOf } = await import('/apps/shaper/src/cut-plan.js');
      const { setStockField } = await import('/apps/shaper/src/stock.js');
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0; CUT_PLAN.clear();
      let n = 0; const J = (x, y) => { const id = 'j' + (++n); st.joints.set(id, { x, y }); return id; };
      const line = (a, b) => st.shapes.push({ id: 's' + (++n), type: 'line', joints: [a, b] });
      const rect = (x, y, w, h) => { const p = [J(x, y), J(x + w, y), J(x + w, y + h), J(x, y + h)]; for (let i = 0; i < 4; i++) line(p[i], p[(i + 1) % 4]); };
      rect(0, 0, 60, 40); rect(80, 0, 40, 40); rect(140, 0, 40, 40); line(J(0, 60), J(40, 60)); line(J(60, 60), J(100, 60));
      const loops = findLoops(st); const chains = findOpenChains(st, loops);
      const L = loops.sort((a, b) => st.joints.get(a.joints[0]).x - st.joints.get(b.joints[0]).x);
      const C = chains.sort((a, b) => st.joints.get(a.shapes[0].joints[0]).x - st.joints.get(b.shapes[0].joints[0]).x);
      CUT_PLAN.set(keyOf('loop', L[0].id), { cutType: 'pocket', cutDepth: 7.62, cutOffset: 1.5, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90 });
      CUT_PLAN.set(keyOf('loop', L[1].id), { cutType: 'exterior', cutDepth: 5, cutOffset: 0, toolDia: 3.175, cutterShape: 'ballnose', cutterAngle: 90 });
      CUT_PLAN.set(keyOf('loop', L[2].id), { cutType: 'interior', cutDepth: 'unset', cutOffset: -2, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 60 });
      CUT_PLAN.set(keyOf('chain', C[0].id), { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
      CUT_PLAN.set(keyOf('chain', C[1].id), { cutType: 'guide', cutDepth: 'unset', cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 });
      setStockField('thickness', 25.4); setStockField('margin', 6);
    })()`);
    await clickEl('[data-mode="prepare"]'); await sleep(900);
    const planBefore = await planJson(), stockBefore = await stockJson(), exportBefore = await exportStr();
    assert.strictEqual(JSON.parse(planBefore).length, 5, 'five cut records assigned');
    assert.deepStrictEqual(JSON.parse(stockBefore), { thickness: 25.4, width: null, height: null, margin: 6 });
    await shot('before-reload');
    await sleep(3200); // the buffer polls every 1.5 s

    // ── 2. a REAL reload: every record equal, stock round-trips, export byte-identical ──
    await reload();
    await clickEl('[data-mode="prepare"]'); await sleep(900);
    await shot('after-reload');
    const planAfter = await planJson();
    assert.strictEqual(planAfter, planBefore, 'every cut record is equal after a real page reload (all fields, incl. cutterShape/cutterAngle)');
    assert.strictEqual(await stockJson(), stockBefore, 'the stock round-trips');
    assert.strictEqual(await exportStr(), exportBefore, 'the export is byte-identical before vs after the reload');
    assert.ok(await evalJs(`document.querySelectorAll('#prepare-canvas .sk-edge').length`) >= 14, 'Prepare shows the restored geometry');

    // ── 2b. the Review card's stock-thickness field round-trips through the sidecar (real typing, real reload) ──
    await clickEl('[data-mode="review"]'); await sleep(1200);
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').value`), '1.000', 'the card shows the restored 25.4 mm = 1.000 in');
    await clickEl('#review-stock-thickness');
    await key('a', 'KeyA', 65, 2);
    for (const ch of '1.25') await key(ch, ch === '.' ? 'Period' : 'Digit' + ch, ch === '.' ? 190 : ch.charCodeAt(0), 0, ch);
    await key('Enter', 'Enter', 13);
    await evalJs(`document.getElementById('review-stock-thickness').dispatchEvent(new Event('change', { bubbles: true }))`);
    await sleep(300);
    const typedStock = JSON.parse(await stockJson());
    assert.ok(Math.abs(typedStock.thickness - 31.75) < 1e-9, 'typing 1.25 in sets the stock thickness to 31.75 mm');
    await sleep(3200);
    await reload();
    await clickEl('[data-mode="review"]'); await sleep(1200);
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').value`), '1.250', 'after a real reload the card shows 1.250 in');
    assert.ok(Math.abs(JSON.parse(await stockJson()).thickness - 31.75) < 1e-9, 'and the stock is 31.75 mm');
    // restore the original stock for the remaining steps (planBefore/stockBefore comparisons)
    await evalJs(`(async () => { const m = await import('/apps/shaper/src/stock.js'); m.setStockField('thickness', 25.4); })()`);
    await sleep(3200);

    // ── 3. a SketchStudio save in between does NOT drop the Shaper sidecar (TASK 458): draw a line there, let it save, come back ──
    await nav(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`);
    const box = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76, text: 'l' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
    await click(box.x - 150, box.y + 100); await click(box.x + 150, box.y + 100);
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(3200);
    await nav(url);
    await clickEl('[data-mode="prepare"]'); await sleep(900);
    assert.strictEqual(await planJson(), planBefore, 'the cut plan survives a SketchStudio save in between');
    assert.strictEqual(await stockJson(), stockBefore, 'and so does the stock');

    // ── 4. an OLD document (no shaper sidecar) loads with the defaults ──
    await evalJs(`new Promise((res) => { const r = indexedDB.open('sketch-studio-documents', 1); r.onsuccess = () => { const db = r.result; const tx = db.transaction('kv', 'readwrite'); const st = tx.objectStore('kv'); const g = st.get('current'); g.onsuccess = () => { const d = g.result; if (d && d.hosts) delete d.hosts.shaper; st.put(d, 'current'); }; tx.oncomplete = () => { db.close(); res(true); }; }; })`);
    await evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); CUT_PLAN.clear(); })()`); // so the autosave cannot re-add it before the reload
    await sleep(100);
    await reload();
    await clickEl('[data-mode="prepare"]'); await sleep(900);
    assert.strictEqual(await planJson(), '[]', 'an old document (no sidecar) has an empty cut plan');
    assert.deepStrictEqual(JSON.parse(await stockJson()), { thickness: 19.05, width: null, height: null, margin: 12.7 }, 'and the owner-confirmed stock defaults: 3/4 in thick, 1/2 in margin');
    assert.ok(await evalJs(`document.querySelectorAll('#prepare-canvas .sk-edge').length`) >= 14, 'the geometry still loads');
    console.log('shaper-persist: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
