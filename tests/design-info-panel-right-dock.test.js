// tests/design-info-panel-right-dock.test.js — TASK 475 #6: the Design info panel (#design-panel) docks on the RIGHT of
// the canvas in every host that mounts it (Shaper, Pen Plotter), leaving the left edge to the app sidebar.
// Headless CDP. Per host: the panel's box is right of the canvas centre, does not overlap the canvas, the canvas keeps a
// real size, and the collapse arrow points right (open) / left (collapsed). EVIDENCE_DIR=<dir> saves a screenshot per host.

import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

async function waitForPort(userDir) {
  for (let i = 0; i < 150; i++) {
    try { const n = parseInt(fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0], 10); if (n) return n; } catch (_) {}
    await sleep(200);
  }
  return 0;
}

async function closeBrowser(proc, dbgPort) {
  const exited = new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', () => res()); });
  try {
    const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); setTimeout(rej, 2000); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await Promise.race([exited, sleep(3000)]);
    try { ws.close(); } catch (_) {}
  } catch (_) { /* browser already gone: the tree kill below finishes the job */ }
  try {
    if (process.platform === 'win32' && proc.pid) execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    else proc.kill();
  } catch (_) { /* already exited */ }
}

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const userDir = path.join(os.tmpdir(), 'sk-test-475r-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let dbgPort = 0;
  try {
    dbgPort = await waitForPort(userDir);
    assert(dbgPort, 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    assert(page, 'no CDP page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
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
    const stable = (sel) => waitFor(`new Promise((res) => { const p = document.querySelector('${sel}'); const s = () => { const r = p.getBoundingClientRect(); return r.left + ',' + r.right + ',' + r.height; }; let last = s(), n = 0; const tick = () => { const c = s(); n = c === last ? n + 1 : 0; last = c; if (n >= 5) res(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`, 'stable layout ' + sel);

    const hosts = [
      { name: 'shaper', url: '/apps/shaper/index.html', enter: `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Design').click()` },
      { name: 'penplotter', url: '/apps/penplotter/index.html', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()` },
    ];
    for (const h of hosts) {
      const loaded = new Promise((res) => { const t = setInterval(() => {}, 1000); setTimeout(() => { clearInterval(t); res(); }, 4000); });
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${h.url}` });
      await loaded;
      await waitFor(`!!document.querySelector('#design-panel')`, h.name + ' app ready');
      await evalJs(h.enter);
      await waitFor(`document.querySelector('#design-panel').getClientRects().length > 0 && document.querySelector('#design-canvas').getClientRects().length > 0`, h.name + ' design visible');
      await stable('#design-panel');
      const m = await evalJs(`(() => {
        const p = document.querySelector('#design-panel').getBoundingClientRect();
        const c = document.querySelector('#design-canvas').getBoundingClientRect();
        const t = document.getElementById('design-panel-toggle');
        return { pl: p.left, pr: p.right, pw: p.width, cl: c.left, cr: c.right, cw: c.width, ch: c.height, arrow: t.textContent.trim(), vw: window.innerWidth };
      })()`);
      console.log(`${h.name}: panel ${Math.round(m.pl)}..${Math.round(m.pr)} canvas ${Math.round(m.cl)}..${Math.round(m.cr)} arrow=${m.arrow}`);
      assert(m.pl + m.pw / 2 > m.cl + m.cw / 2, `${h.name}: panel centre must be right of the canvas centre`);
      assert(m.pl >= m.cr - 1, `${h.name}: panel must not overlap the canvas (panel.left ${m.pl} < canvas.right ${m.cr})`);
      assert(m.cw > 300 && m.ch > 200, `${h.name}: canvas keeps a usable pan/zoom area (${m.cw}x${m.ch})`);
      assert.strictEqual(m.arrow, '\u25B6', `${h.name}: open panel arrow points right (toward its edge)`);
      await evalJs(`document.getElementById('design-panel-toggle').click()`);
      await waitFor(`document.querySelector('#design-panel').classList.contains('collapsed')`, h.name + ' collapsed');
      assert.strictEqual(await evalJs(`document.getElementById('design-panel-toggle').textContent.trim()`), '\u25C0', `${h.name}: collapsed arrow points left`);
      await evalJs(`document.getElementById('design-panel-toggle').click()`);
      await stable('#design-panel');
      if (process.env.EVIDENCE_DIR) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(process.env.EVIDENCE_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `right-dock-${h.name}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    try { ws.close(); } catch (_) { /* closing anyway */ }
    console.log('design-info-panel-right-dock: all passed');
  } finally {
    await closeBrowser(proc, dbgPort);
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) { /* tmp cleanup */ }
  }
})();
