// tests/penplotter-stage-undo.test.js — TASK 444b: ONE keystroke -> ONE history, chosen by the active stage.
// Live headless CDP check in Pen Plotter with REAL mouse + key events. Pen Plotter has two histories:
//   Design stage    = the shared sketch history (state.undo/redo; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z via #ui input-manager);
//   Toolpath/Export = history.js (toolpaths / toolpaths / doc).
// Draw a line (Design), add a toolpath (Toolpath), then: Ctrl+Z on Design must undo ONLY the line; Ctrl+Y on Design redo ONLY
// the line; Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z on Toolpath must touch ONLY the toolpaths.

import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  const userDir = path.join(os.tmpdir(), 'sk-test-444b-' + process.pid);
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
    // sketch lines + sketch history depths (Design history) and toolpaths (history.js)
    const observe = () => evalJs(`(() => ({
      lines: window.__sketch.controller.state.shapes.filter(s => s.type === 'line').length,
      tps: window.__draw.state.toolpaths.length,
      sketchHistory: window.__sketch.controller.state.history.length,
      sketchRedo: window.__sketch.controller.state.redoStack.length,
    }))()`);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await sleep(1200);
    await stageTab('design'); await sleep(500);

    // Design: draw ONE line with real mouse events
    const box = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width*0.5), y: Math.round(r.top + r.height*0.6) }; })()`);
    const base = await observe();
    await click(box.x, box.y + 150);
    await key('l', 'KeyL', 76, 0, 'l');
    await click(box.x - 120, box.y); await click(box.x + 120, box.y);
    await key('Escape', 'Escape', 27);
    const afterLine = await observe();
    assert.strictEqual(afterLine.lines, base.lines + 1, 'drew one line');

    // Toolpath: add ONE toolpath (real click on #addOutlineTp) -> history.js snapshot
    await stageTab('toolpath'); await sleep(500);
    const toolpathBase = await observe();
    await clickEl('#addOutlineTp');
    const afterPen = await observe();
    assert.strictEqual(afterPen.tps, toolpathBase.tps + 1, 'added one toolpath');
    assert.strictEqual(afterPen.lines, afterLine.lines, 'adding a toolpath does not touch the sketch');

    // Back on Design: ONE Ctrl+Z must undo the line and leave the toolpath
    await stageTab('design'); await sleep(300);
    const before1 = await observe();
    await key('z', 'KeyZ', 90, 2);
    const a1 = await observe();
    console.log('Design Ctrl+Z    before', JSON.stringify(before1), 'after', JSON.stringify(a1));
    assert.strictEqual(a1.lines, before1.lines - 1, 'Design Ctrl+Z undoes the line');
    assert.strictEqual(a1.tps, before1.tps, 'Design Ctrl+Z must NOT undo the toolpath (toolpath history)');

    // Design: Ctrl+Y redoes the line, toolpath untouched
    await key('y', 'KeyY', 89, 2);
    const a2 = await observe();
    console.log('Design Ctrl+Y    after', JSON.stringify(a2));
    assert.strictEqual(a2.lines, a1.lines + 1, 'Design Ctrl+Y redoes the line');
    assert.strictEqual(a2.tps, a1.tps, 'Design Ctrl+Y must NOT touch the toolpath');

    // Toolpath: Ctrl+Z undoes the toolpath only, sketch untouched
    await stageTab('toolpath'); await sleep(300);
    const before3 = await observe();
    await key('z', 'KeyZ', 90, 2);
    const a3 = await observe();
    console.log('Toolpath Ctrl+Z  before', JSON.stringify(before3), 'after', JSON.stringify(a3));
    assert.strictEqual(a3.tps, before3.tps - 1, 'Toolpath Ctrl+Z undoes the toolpath');
    assert.strictEqual(a3.lines, before3.lines, 'Toolpath Ctrl+Z must NOT touch the sketch');
    assert.strictEqual(a3.sketchHistory, before3.sketchHistory, 'Toolpath Ctrl+Z must NOT move the sketch history');
    assert.strictEqual(a3.sketchRedo, before3.sketchRedo, 'Toolpath Ctrl+Z must NOT move the sketch redo stack');

    // Toolpath: Ctrl+Y redoes the toolpath only
    await key('y', 'KeyY', 89, 2);
    const a4 = await observe();
    console.log('Toolpath Ctrl+Y  after', JSON.stringify(a4));
    assert.strictEqual(a4.tps, a3.tps + 1, 'Toolpath Ctrl+Y redoes the toolpath');
    assert.strictEqual(a4.lines, a3.lines, 'Toolpath Ctrl+Y must NOT touch the sketch');
    assert.strictEqual(a4.sketchHistory, a3.sketchHistory, 'Toolpath Ctrl+Y must NOT move the sketch history');

    // Toolpath: Ctrl+Z then Ctrl+Shift+Z returns to the same state, sketch untouched
    await key('z', 'KeyZ', 90, 2);
    await key('Z', 'KeyZ', 90, 2 | 8);
    const a5 = await observe();
    assert.strictEqual(a5.tps, a4.tps, 'Toolpath Ctrl+Z then Ctrl+Shift+Z returns to the same toolpaths');
    assert.strictEqual(a5.lines, a4.lines, 'Toolpath Ctrl+Shift+Z must NOT touch the sketch');
    console.log('penplotter-stage-undo: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
