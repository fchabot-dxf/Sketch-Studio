// tests/penplotter-pen-undo.test.js — TASK 445: Pen Plotter pen edits are undoable (history.js now serializes plotColors).
// Live headless CDP check on the Toolpath stage with REAL mouse + key events: add a pen -> Ctrl+Z gone -> Ctrl+Y back;
// rename -> Ctrl+Z old name; delete a pen used by a toolpath -> Ctrl+Z pen back AND the toolpath still uses it.

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
  const userDir = path.join(os.tmpdir(), 'sk-test-445-' + process.pid);
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
    const observe = () => evalJs(`(() => ({
      pens: window.__draw.state.plotColors.map(p => p.name),
      tpPens: window.__draw.state.toolpaths.map(t => t.plotColorId),
      penIds: window.__draw.state.plotColors.map(p => p.id),
    }))()`);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await sleep(1200);
    await stageTab('toolpath'); await sleep(500);

    const base = await observe();
    // 1. add a pen -> Ctrl+Z -> gone -> Ctrl+Y -> back
    await clickEl('#addPlotColor');
    const added = await observe();
    assert.strictEqual(added.pens.length, base.pens.length + 1, 'added one pen');
    await key('z', 'KeyZ', 90, 2);
    const u1 = await observe();
    console.log('add pen    :', JSON.stringify(base.pens), '->', JSON.stringify(added.pens), 'Ctrl+Z ->', JSON.stringify(u1.pens));
    assert.deepStrictEqual(u1.pens, base.pens, 'Ctrl+Z removes the added pen');
    await key('y', 'KeyY', 89, 2);
    const r1 = await observe();
    console.log('           Ctrl+Y ->', JSON.stringify(r1.pens));
    assert.deepStrictEqual(r1.pens, added.pens, 'Ctrl+Y brings the pen back');

    // 2. a second pen (so a delete is allowed), then rename it with real typing
    await clickEl('#addPlotColor');
    const two = await observe();
    const lastName = two.pens[two.pens.length - 1];
    await clickEl('.pc-row:last-child .pc-name');
    await key('a', 'KeyA', 65, 2);
    for (const ch of 'Zed') await key(ch, 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), 0, ch);
    await key('Enter', 'Enter', 13);
    await click(5, 5); // real click to leave the input (history.js ignores INPUT targets)
    const renamed = await observe();
    assert.strictEqual(renamed.pens[renamed.pens.length - 1], 'Zed', 'renamed to Zed');
    await key('z', 'KeyZ', 90, 2);
    const u2 = await observe();
    console.log('rename     :', JSON.stringify(two.pens), '-> Zed; Ctrl+Z ->', JSON.stringify(u2.pens));
    assert.deepStrictEqual(u2.pens, two.pens, 'Ctrl+Z restores the old pen name');
    assert.strictEqual(u2.pens[u2.pens.length - 1], lastName);

    // 3. delete a pen used by a toolpath -> reassign -> Ctrl+Z -> pen back and the toolpath still uses it
    const penId = two.penIds[two.penIds.length - 1];
    // seed (test setup, not the gesture under test): point toolpath 0 at the pen, re-render so its "used by" badge is current
    await evalJs(`(async () => { window.__draw.state.toolpaths[0].plotColorId = ${JSON.stringify(penId)}; (await import('/apps/penplotter/src/plot-colors-panel.js')).renderPlotColorsPanel(); })()`);
    const seeded = await observe();
    assert.strictEqual(seeded.tpPens[0], penId, 'seeded: toolpath uses the pen to delete');
    await clickEl('.pc-row:last-child .pc-del'); // real click (the x is reachable since TASK 446)
    await sleep(200);
    await clickEl('.ui-dialog-ok');
    await sleep(200);
    const deleted = await observe();
    console.log('delete pen :', JSON.stringify(seeded.penIds), '-> pens', JSON.stringify(deleted.penIds), 'toolpath pen', seeded.tpPens[0], '->', deleted.tpPens[0]);
    assert.strictEqual(deleted.pens.length, two.pens.length - 1, 'pen deleted');
    assert.notStrictEqual(deleted.tpPens[0], penId, 'toolpath reassigned off the deleted pen');
    await key('z', 'KeyZ', 90, 2);
    const u3 = await observe();
    console.log('           Ctrl+Z -> pens', JSON.stringify(u3.penIds), 'toolpath pen', u3.tpPens[0]);
    assert.deepStrictEqual(u3.penIds, two.penIds, 'Ctrl+Z restores the deleted pen');
    assert.strictEqual(u3.tpPens[0], penId, 'the toolpath uses the restored pen again');
    assert(u3.penIds.includes(u3.tpPens[0]), 'toolpath points at a pen that exists');
    console.log('penplotter-pen-undo: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
