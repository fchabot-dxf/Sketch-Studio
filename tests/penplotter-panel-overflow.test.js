// tests/penplotter-panel-overflow.test.js — TASK 446: the Toolpath stage's side panel keeps every row inside the panel,
// so the pen row's delete "x" is reachable by a REAL mouse click at every window width. Headless CDP, real mouse events.
// At 1280 / 1600 / 1920 px: (a) no element in #toolpathPanel extends past the panel's right edge, (b) elementFromPoint at the
// x centre IS the x, (c) a real click on it deletes the pen. EVIDENCE_DIR=<dir> also saves a panel screenshot per width.

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

async function waitForPort(userDir) {
  for (let i = 0; i < 150; i++) {
    try { const n = parseInt(fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10); if (n) return n; } catch (_) {}
    await sleep(200);
  }
  return 0;
}

async function waitForJson(dbgPort) {
  for (let i = 0; i < 150; i++) {
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
  const userDir = path.join(os.tmpdir(), 'sk-test-446-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let dbgPort = 0;
  try {
    dbgPort = await waitForPort(userDir);
    assert(dbgPort && await waitForJson(dbgPort), 'headless browser did not expose CDP port');
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
    const waitFor = async (expression, what, timeoutMs = 20000) => {
      const end = Date.now() + timeoutMs;
      for (;;) {
        let v; try { v = await evalJs(expression); } catch (_) { v = false; }
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting for ' + what);
        await sleep(50);
      }
    };
    const penCount = () => evalJs('window.__draw.state.plotColors.length');
    const addPen = async () => { const n = await penCount(); await clickEl('#addPlotColor'); await waitFor('window.__draw.state.plotColors.length === ' + (n + 1), 'pen added'); };
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      await waitFor(`(() => { const e = document.querySelector('${sel}'); return !!e && e.getClientRects().length > 0; })()`, sel + ' visible');
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);
    const clickAt = click;
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(20000)]);
    await waitFor('!!(window.__draw && window.__draw.state && window.__draw.state.plotColors)', 'penplotter app ready');
    await stageTab('toolpath');
    await waitFor("!!document.getElementById('toolpathPanel') && document.getElementById('toolpathPanel').getClientRects().length > 0", 'toolpath panel visible');
    await addPen();
    await addPen();
    await clickEl('#addFillTp'); // more operation rows (fill + outline) so their rows are measured too
    await key('Escape', 'Escape', 27);
    // a long pen name must not widen the row either (test setup through the state, then the shared panel render)
    await evalJs(`(async () => { window.__draw.state.plotColors[1].name = 'A very long pen name that should be truncated not overflow'; (await import('/apps/penplotter/src/plot-colors-panel.js')).renderPlotColorsPanel(); })()`);

    for (const width of [1280, 1600, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await waitFor(`window.innerWidth === ${width}`, 'viewport resized');
      await waitFor(`new Promise((res) => { const p = document.getElementById('toolpathPanel'); const s = () => { const r = p.getBoundingClientRect(); return r.left + ',' + r.right + ',' + r.height; }; let last = s(), n = 0; const tick = () => { const c = s(); n = c === last ? n + 1 : 0; last = c; if (n >= 5) res(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`, 'stable panel layout');
      const m = await evalJs(`(() => {
        const panel = document.getElementById('toolpathPanel');
        const pr = panel.getBoundingClientRect();
        // every visible side panel of the stage (pens, operations rows, settings fields, the fill/outline editor)
        const over = [];
        for (const root of [panel, document.getElementById('activeLayerPanel')].filter(r => r && r.getClientRects().length)) {
          const rr = root.getBoundingClientRect();
          for (const e of root.querySelectorAll('*')) {
            const r = e.getBoundingClientRect();
            if (r.width > 0 && r.right > rr.right + 1 && getComputedStyle(e).position !== 'fixed') over.push(root.id + ' > ' + e.tagName + '.' + e.className + ' right=' + Math.round(r.right));
          }
        }
        const del = document.querySelector('.pc-row:last-child .pc-del');
        const r = del.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { panelRight: Math.round(pr.right), over, delRight: Math.round(r.right), topIsDel: top === del, top: top.tagName + '.' + top.className,
                 cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), pens: window.__draw.state.plotColors.length };
      })()`);
      console.log(`${width}px: panelRight=${m.panelRight} x.right=${m.delRight} topIsDel=${m.topIsDel} (${m.top}) overflow=${JSON.stringify(m.over)}`);
      if (process.env.EVIDENCE_DIR) {
        const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 420, height: 420, scale: 2 } });
        fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `pens-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      assert.deepStrictEqual(m.over, [], `${width}px: nothing in the panel may extend past its right edge`);
      assert.strictEqual(m.topIsDel, true, `${width}px: elementFromPoint at the x centre must be the x itself, got ${m.top}`);
      await clickAt(m.cx, m.cy);
      await waitFor(`window.__draw.state.plotColors.length === ${m.pens - 1}`, 'pen deleted');
      const after = await penCount();
      assert.strictEqual(after, m.pens - 1, `${width}px: a real click on the x deletes the pen`);
      await addPen(); // restore the pen count for the next width
    }
    console.log('penplotter-panel-overflow: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
