// tests/cut-offset-types.test.js — TASK 450 + 450b + 456 (cut params per type; On Line shows/writes an offset but the preview ignores it): On line and Guide take NO offset (Shaper: offsets are not an option for On Line;
// Guide is uncuttable). Declared on CUT_TYPES (offset:false); read by the cut card, the export and the preview. Not migrated.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES, cutTypeHasParam, effectiveCutRecord } from '../apps/shaper/src/shaper.js';

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
  const userDir = path.join(os.tmpdir(), 'sk-test-450-' + process.pid);
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
    // ── declaration + export + preview (pure) ──
    const ALL3 = ['cutDepth', 'cutOffset', 'toolDia'];
    const decl = Object.fromEntries(CUT_TYPES.map((t) => [t.id, t.params]));
    assert.deepStrictEqual(decl, { exterior: ALL3, interior: ALL3, pocket: ALL3, online: ALL3, guide: ALL3 }, 'ONE params declaration per cut type');
    assert.ok(cutTypeHasParam('exterior', 'cutOffset') && cutTypeHasParam('online', 'cutOffset') && cutTypeHasParam('online', 'toolDia') && cutTypeHasParam('guide', 'cutDepth') && cutTypeHasParam('guide', 'cutOffset') && cutTypeHasParam('guide', 'toolDia'), 'guide keeps all three (Studio allows it)');
    assert.ok(cutTypeHasParam(null, 'cutOffset'), 'no type chosen yet: nothing hidden');
    assert.deepStrictEqual(effectiveCutRecord({ cutType: 'guide', cutDepth: 5, cutOffset: 2, toolDia: 6 }), { cutType: 'guide', cutDepth: 5, cutOffset: 2, toolDia: 6, autoOffset: 0 }, 'a guide keeps its params (and has no automatic offset)');
    assert.strictEqual(effectiveCutRecord({ cutType: 'online', cutOffset: 2, cutDepth: 5, toolDia: 6 }).cutOffset, 0, 'on line: the PREVIEW ignores the offset (offsetMovesCut:false, Studio keeps the band centred)');
    assert.strictEqual(CUT_TYPES.find((t) => t.id === 'online').offsetMovesCut, false);
    assert.deepStrictEqual(CUT_TYPES.filter((t) => t.offsetMovesCut === false).map((t) => t.id), ['online']);
    assert.strictEqual(effectiveCutRecord({ cutType: 'online', cutOffset: 2, cutDepth: 5, toolDia: 6 }).toolDia, 6, 'on line keeps the bit');
    assert.strictEqual(effectiveCutRecord({ cutType: 'exterior', cutOffset: 2, cutDepth: 5, toolDia: 6 }).cutOffset, 2, 'outside keeps its offset');
    {
      const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 40, y: 0 }], ['c', { x: 40, y: 20 }], ['d', { x: 0, y: 20 }]]),
        shapes: [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })), constraints: [] };
      const { findLoops } = await import('#core/loop-finder.js');
      const loop = findLoops(state)[0];
      const exp = (cutType, extra = {}) => exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec: { cutType, cutDepth: 5, cutOffset: 1.5, toolDia: 3.175, ...extra } }], encoding: CUT_TYPES, docUnit: 'mm' });
      const attrs = (svg) => ['cutDepth', 'cutOffset', 'toolDia'].filter((k) => svg.includes('shaper:' + k));
      assert.deepStrictEqual(attrs(exp('guide')), ['cutDepth', 'cutOffset', 'toolDia'], 'Guide keeps and exports all three (the type may be changed on the tool later)');
      assert.deepStrictEqual(attrs(exp('online')), ['cutDepth', 'cutOffset', 'toolDia'], 'On line: all three (Studio shows and writes an offset on On Line)');
      assert.ok(exp('online').includes('shaper:cutOffset="1.500 mm"'), 'On line writes its offset');
      for (const t of ['exterior', 'interior', 'pocket']) assert.deepStrictEqual(attrs(exp(t)), ['cutDepth', 'cutOffset', 'toolDia'], t + ' writes all three');
    }

    // ── the cut card in the real app (real clicks): Offset row hidden for On line / Guide, shown for Outside / Inside / Pocket ──
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await sleep(1500);
    await clickEl('[data-mode="design"]'); await sleep(1200);
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', 0, 0); J('b', 60, 0); J('c', 60, 40); J('d', 0, 40);
      [['s1','a','b'],['s2','b','c'],['s3','c','d'],['s4','d','a']].forEach(([id, p, q]) => st.shapes.push({ id, type: 'line', joints: [p, q] }));
    })()`);
    await clickEl('[data-mode="prepare"]'); await sleep(900);
    const inside = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = 30; p.y = 20; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await click(inside.x, inside.y); // select the loop
    const rowsShown = () => evalJs(`[...document.querySelectorAll('.cut-row[data-param]')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => r.dataset.param)`);
    const shown = {};
    for (const [typeId, label] of [['online', 'On line'], ['guide', 'Guide'], ['interior', 'Inside'], ['pocket', 'Pocket'], ['exterior', 'Outside']]) {
      await clickEl('.cut-type-trigger'); await sleep(150);
      await clickEl(`.cut-type-opt[data-id="${typeId}"]`); await sleep(250);
      shown[typeId] = await rowsShown();
      console.log(`${label}: rows ${JSON.stringify(shown[typeId])}`);
      if (process.env.EVIDENCE_DIR) { const sh = await send('Page.captureScreenshot', { format: 'png', clip: { x: 1200, y: 50, width: 300, height: 380, scale: 1.5 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `card-${typeId}.png`), Buffer.from(sh.data, 'base64')); }
    }
    assert.deepStrictEqual(shown, { online: ALL3, guide: ALL3, interior: ALL3, pocket: ALL3, exterior: ALL3 }, 'card rows follow the params declaration (Guide shows all three)');
    console.log('cut-offset-types: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
