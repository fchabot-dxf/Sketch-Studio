// tests/dxf-import-live.test.js — TASK 478: the ONE 'Import SVG / DXF' entry in the REAL Shaper (headless Edge, real file input): a Fusion sketch
// DXF lands as true lines + arcs with construction lines and counted skips, its closed profiles are selectable loops in Prepare, a malformed
// DXF is a readable status (no throw), and the Fusion add-in SVG imports with its cut types and the compound pocket as a profile.
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
  const dbgPort = 9210 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-478-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--no-sandbox', '--no-first-run', '--disable-extensions',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
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
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text)); });
    await send('Runtime.enable'); await send('Page.enable');
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
    await openMode('design'); await sleep(2500);
    const fileNode = async () => { let q = { nodeId: 0 }; for (let i = 0; i < 10 && !q.nodeId; i++) { const doc = await send('DOM.getDocument', { depth: -1 }); q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]:not(#file)' }); if (!q.nodeId) await sleep(400); } assert(q.nodeId, 'the import file input exists'); return q.nodeId; };
    const importFile = async (file) => { await send('DOM.setFileInputFiles', { nodeId: await fileNode(), files: [file] }); await sleep(2500); return evalJs(`(document.getElementById('group-status') || {}).textContent`); };
    // the ONE entry is labelled SVG / DXF and accepts both
    assert.strictEqual(await evalJs(`document.getElementById('svg-import-btn').textContent`), '\u2b07 Import SVG / DXF');
    assert.match(await evalJs(`document.querySelector('input[type=file]:not(#file)').accept`), /\.dxf/);

    // a malformed DXF: a readable status, no exception
    const bad = path.join(os.tmpdir(), 'sk-478-bad.dxf'); fs.writeFileSync(bad, 'hello world\nthis is not a dxf\n');
    const badStatus = await importFile(bad);
    console.log('malformed:', badStatus);
    assert.match(badStatus, /^Import failed: /, 'a malformed DXF is reported, not thrown');
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), 0, 'and imports nothing');

    // the owner's real Fusion sketch DXF
    const st1 = await importFile(path.join(REPO_ROOT, 'tests', 'fixtures', 'dxf', 'fusion-sketch4.dxf'));
    console.log('dxf status:', st1);
    assert.match(st1, /Imported 26 shapes .* @ inches/); assert.match(st1, /4 construction/); assert.match(st1, /POINT .* x5|POINT .*\u00d75/);
    const kinds = await evalJs(`(() => { const t = {}; for (const s of window.__designController.state.shapes) { const k = s.type + (s.isConstruction ? '*' : ''); t[k] = (t[k] || 0) + 1; } return JSON.stringify(t); })()`);
    assert.deepStrictEqual(JSON.parse(kinds), { line: 20, 'line*': 4, arc: 2 });
    await mouse('mouseMoved', 5, 760); await sleep(300);
    await shot('dxf-design.png');
    await openMode('prepare'); await sleep(900);
    const loops = await evalJs(`(async () => { const { findLoops } = await import('#core/loop-finder.js'); return findLoops(window.__designController.state).map((l) => l.edges.length).join(','); })()`);
    assert.strictEqual(loops, '4,6,6,4', 'four closed loops through shared joints (construction lines do not split them): ' + loops);
    // a closed profile is SELECTABLE in Prepare: click inside the filleted rectangle (DXF -0.99..1.04 in x, 1.21..2.33 in y) -> the cut card appears
    const pt = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = 0.02 * 25.4; p.y = -1.85 * 25.4; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await mouse('mouseMoved', pt.x, pt.y); await mouse('mousePressed', pt.x, pt.y, 1); await mouse('mouseReleased', pt.x, pt.y); await sleep(500);
    assert.strictEqual(await evalJs(`document.querySelector('.cut-type-trigger') && !document.querySelector('.cut-type-trigger').closest('[hidden]')`), true, 'selecting the imported loop shows the cut card');
    await shot('dxf-prepare-selected.png');

    // the Shaper Fusion add-in SVG (arcs): cut types from the grey fills, depths in cm, the compound path = a profile with a hole, real arcs
    await openMode('design'); await sleep(1200);
    const st2 = await importFile(path.join(REPO_ROOT, 'tests', 'fixtures', 'svg', 'fusion-shaper-addin-arcs.svg'));
    console.log('svg status:', st2);
    assert.match(st2, /Imported 39 shapes .* 6 cuts kept/);
    const plan = await evalJs(`(async () => { const p = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...p.CUT_PLAN.entries()].map(([k, r]) => [k.split(':')[0], r.cutType, Math.round(r.cutDepth * 100) / 100]).sort()); })()`);
    assert.deepStrictEqual(JSON.parse(plan), [['loop', 'exterior', 81.28], ['loop', 'pocket', 17.78], ['loop', 'pocket', 17.78], ['loop', 'pocket', 27.94], ['loop', 'pocket', 17.78], ['profile', 'pocket', 5.08]].sort());
    console.log('dxf-import-live: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
