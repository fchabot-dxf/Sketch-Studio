// tests/clear-all-live.test.js — TASK 498 (live headless, REAL mouse): SketchStudio's Clear All ALWAYS empties the whole board,
// even with a selection (it used to delete only the selection), and a repeated click on an empty board is harmless.
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
  const dbgPort = 9400 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-498-' + process.pid);
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
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    const drag = async (pts) => {
      await mouse('mouseMoved', pts[0][0], pts[0][1], 0); await sleep(30); await mouse('mousePressed', pts[0][0], pts[0][1], 1);
      for (const p of pts.slice(1)) { await mouse('mouseMoved', p[0], p[1], 1); await sleep(20); }
      const l = pts[pts.length - 1]; await mouse('mouseReleased', l[0], l[1], 0); await sleep(300);
    };
    const counts = () => evalJs(`JSON.stringify({ shapes: document.querySelectorAll('#svgCanvas .shape-elem').length, joints: new Set(Array.from(document.querySelectorAll('#svgCanvas .joint-handle')).map(e => e.dataset.jointId)).size })`).then(JSON.parse);

    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/sketchstudio/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await sleep(2200);

    const cv = await centerOf('#svgCanvas');
    const draw3 = async () => {
      await clickEl('#tool-circle');
      await drag([[cv.x - 200, cv.y - 100], [cv.x - 170, cv.y - 100], [cv.x - 150, cv.y - 100]]);
      await drag([[cv.x, cv.y - 100], [cv.x + 30, cv.y - 100], [cv.x + 50, cv.y - 100]]);
      await drag([[cv.x + 200, cv.y - 100], [cv.x + 230, cv.y - 100], [cv.x + 250, cv.y - 100]]);
    };
    await draw3();
    const drawn = await counts();
    assert.strictEqual(drawn.shapes, 3, 'three shapes drawn: ' + JSON.stringify(drawn));

    // select one (Select tool, click its rim), then Clear All: the WHOLE board goes, not just the selection
    await clickEl('#tool-select');
    await click(cv.x + 50, cv.y - 100);
    const styles = await evalJs(`JSON.stringify(Array.from(document.querySelectorAll('#svgCanvas .shape-elem')).map(e => e.getAttribute('style') + '|' + e.getAttribute('stroke-width')))`).then(JSON.parse);
    assert(new Set(styles).size > 1, 'one shape renders as selected (differs from the other two): ' + JSON.stringify(styles));
    await clickEl('#btn-clear');
    const after = await counts();
    assert.strictEqual(after.shapes, 0, 'Clear All with a selection empties the board: ' + JSON.stringify(after));
    assert(after.joints <= 1, 'only the origin joint remains: ' + JSON.stringify(after));

    // repeated click on an empty board is harmless
    await clickEl('#btn-clear'); await clickEl('#btn-clear');
    const again = await counts();
    assert.deepStrictEqual(again, after, 'repeated Clear All on an empty board changes nothing');

    // and the board is usable afterwards
    await draw3();
    assert.strictEqual((await counts()).shapes, 3, 'drawing works after Clear All');
    await clickEl('#btn-clear');
    assert.strictEqual((await counts()).shapes, 0, 'Clear All with no selection also empties the board');
    console.log('clear-all-live.test.js: ok', JSON.stringify(after));
  } finally {
    await closeBrowser(proc, dbgPort);
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
process.exit(0);
