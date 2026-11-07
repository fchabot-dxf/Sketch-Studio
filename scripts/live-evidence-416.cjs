#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_PATH = '/apps/sketchstudio/index.html';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) {}
  }
}

function startServer() {
  return new Promise((res) => {
    const s = http.createServer((req, resp) => {
      const p = path.join(REPO_ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(REPO_ROOT)) { resp.writeHead(403); resp.end(); return; }
      fs.readFile(p, (err, data) => {
        if (err) { resp.writeHead(404); resp.end(); return; }
        const ext = path.extname(p);
        resp.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        resp.end(data);
      });
    });
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}

async function waitForJson(dbgPort) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`); if (r.ok) return true; } catch (_) {}
    await sleep(250);
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

(async () => {
  const browser = findBrowser();
  if (!browser) { console.error('no Edge/Chrome found'); process.exit(1); }

  const { server, port } = await startServer();
  const dbgPort = 9400 + Math.floor((Date.now() % 500));
  const userDir = path.join(os.tmpdir(), 'sk-live-416-' + process.pid);

  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`,
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    if (!(await waitForJson(dbgPort))) throw new Error('headless browser did not expose CDP');
    const url = `http://127.0.0.1:${port}${APP_PATH}`;

    let page;
    for (let i = 0; i < 40; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
        page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) break;
      } catch (_) {}
      await sleep(250);
    }
    if (!page) throw new Error('no CDP page target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const evs = {};
    const send = (m, p = {}) => new Promise(res => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method: m, params: p }));
    });
    const once = (m) => new Promise(res => { (evs[m] = evs[m] || []).push(res); });

    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
      else if (m.method && evs[m.method]) { const f = evs[m.method].shift(); if (f) f(m.params); }
    });

    await new Promise(r => ws.addEventListener('open', r));
    await send('Runtime.enable');
    await send('Page.enable');

    // 1. Navigate to app
    const loaded1 = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    await Promise.race([loaded1, sleep(8000)]);
    await sleep(1000);

    // 2. Setup document and settings, then reload
    const SETUP_EXPR = `(async () => {
      const SettingsManager = (await import('#core/settings-manager.js')).default;
      const { CONSTRAINT_TYPES } = await import('#core/constants.js');

      SettingsManager.set('SHOW_DEBUG_OVERLAY', true);
      SettingsManager.set('SHOW_FREEDOM', true);

      // Slanted line from (-5, -5) to (5, 5) with a point at (0, 0) constrained onto it
      const doc = {
        version: 1,
        geometry: {
          joints: [
            ['a', { x: -5, y: -5 }],
            ['b', { x: 5, y: 5 }],
            ['p1', { x: 0, y: 0 }]
          ],
          shapes: [
            { id: 'L1', type: 'line', joints: ['a', 'b'] }
          ],
          constraints: [
            { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: 'p1', shape: 'L1' }
          ]
        }
      };

      await new Promise((resolve, reject) => {
        const req = indexedDB.open('sketch-studio-documents', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(doc, 'current');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      return true;
    })()`;

    const r1 = await send('Runtime.evaluate', { expression: SETUP_EXPR, returnByValue: true, awaitPromise: true });
    if (r1 && r1.exceptionDetails) throw new Error('setup expr failed: ' + JSON.stringify(r1.exceptionDetails));

    // 3. Reload page to load restored document + active debug overlay
    const loaded2 = once('Page.loadEventFired');
    await send('Page.reload');
    await Promise.race([loaded2, sleep(8000)]);
    await sleep(1500);

    // 4. Inspect whiskers in DOM
    const INSPECT_EXPR = `(() => {
      const whiskers = Array.from(document.querySelectorAll('.debug-whisker')).map(l => ({
        x1: parseFloat(l.getAttribute('x1')),
        y1: parseFloat(l.getAttribute('y1')),
        x2: parseFloat(l.getAttribute('x2')),
        y2: parseFloat(l.getAttribute('y2')),
      }));
      return {
        whiskerCount: whiskers.length,
        whiskers
      };
    })()`;

    const r2 = await send('Runtime.evaluate', { expression: INSPECT_EXPR, returnByValue: true, awaitPromise: true });
    const info = r2 && r2.result && r2.result.value;
    console.log('Observed in-page whiskers:', JSON.stringify(info, null, 2));

    // 5. Capture screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(REPO_ROOT, '.evidence', '416', 'slanted-line-whiskers.png');
    fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
    console.log(`Saved screenshot to: ${outPath} (${fs.statSync(outPath).size} bytes)`);

    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
