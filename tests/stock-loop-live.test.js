// tests/stock-loop-live.test.js — TASK 472: Stock as a cut type in the REAL app (headless Edge, software WebGL): pick Stock on a closed
// loop in Prepare with real clicks, the role MOVES (with a notice) when a second loop is marked, Ctrl+Z undoes the move, and the Review
// shows the board as that irregular profile.
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
  const dbgPort = 9610 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-472-' + process.pid);
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
    await openMode('design'); await sleep(1200);
    // seed: A = an L-shaped outline (the board), B = a 20x20 loop drawn INSIDE it (a part, NOT a hole), C = a separate rectangle
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const poly = (p, pts) => { pts.forEach(([x, y], i) => st.joints.set(p + i, { x, y })); pts.forEach((_, i) => st.shapes.push({ id: p + 's' + i, type: 'line', joints: [p + i, p + ((i + 1) % pts.length)] })); };
      poly('A', [[0, 0], [120, 0], [120, 60], [60, 60], [60, 120], [0, 120]]);
      poly('B', [[10, 10], [30, 10], [30, 30], [10, 30]]);
      poly('C', [[160, 0], [200, 0], [200, 40], [160, 40]]);
    })()`);
    await openMode('prepare'); await sleep(900);
    const screen = (x, y) => evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const clickAt = async (pt) => { await mouse('mouseMoved', pt.x, pt.y); await mouse('mousePressed', pt.x, pt.y, 1); await mouse('mouseReleased', pt.x, pt.y); await sleep(250); };
    const pickType = async (tid) => { await clickEl('.cut-type-trigger'); await sleep(150); await clickEl(`.cut-type-opt[data-id="${tid}"]`); await sleep(300); };
    const stockKey = () => evalJs(`(async () => { const plan = await import('/apps/shaper/src/cut-plan.js'); return plan.stockKeyOf(plan.CUT_PLAN); })()`);
    const notice = () => evalJs(`(() => { const e = document.getElementById('prepare-notice'); return e && !e.hidden ? e.textContent : ''; })()`);

    // the menu: Stock beside the others, with its icon
    await clickAt(await screen(100, 30));                      // inside A, outside B: selects the L loop
    await clickEl('.cut-type-trigger'); await sleep(150);
    const opts = await evalJs(`[...document.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id + (o.disabled ? ':off' : '') + (o.querySelector('svg') ? ':icon' : ''))`);
    console.log('menu:', JSON.stringify(opts));
    assert.deepStrictEqual(opts, ['online:icon', 'guide:icon', 'interior:icon', 'pocket:icon', 'exterior:icon', 'stock:icon'], 'Stock sits beside the other types with its icon');
    await clickEl('.cut-type-opt[data-id="stock"]'); await sleep(300);
    const keyA = await stockKey();
    assert.ok(keyA && keyA.startsWith('loop:'), 'the L loop is now the Stock: ' + keyA);
    assert.match(await notice(), /now the Stock/);
    // the card for a Stock: ONE field (Thickness), no offset / bit / shape rows
    const rows = await evalJs(`[...document.querySelectorAll('.cut-rows > .cut-row')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => (r.dataset.param || r.dataset.row) + ':' + r.querySelector('.cut-field-label').textContent)`);
    console.log('stock card rows:', JSON.stringify(rows));
    assert.deepStrictEqual(rows, ['cutDepth:Thickness'], 'the card shows only the Thickness row');
    await evalJs(`(() => { const i = document.querySelector('.cut-depth'); i.value = '0.5in'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300);
    assert.strictEqual(await evalJs(`(async () => { const plan = await import('/apps/shaper/src/cut-plan.js'); return plan.CUT_PLAN.get(plan.stockKeyOf(plan.CUT_PLAN)).cutDepth; })()`), 12.7, 'thickness typed as 0.5in is stored in mm');
    await mouse('mouseMoved', 5, 700); await sleep(200);
    if (process.env.EVIDENCE_DIR) { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 44, width: 1400, height: 750, scale: 1 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, 'prepare-stock-loop.png'), Buffer.from(r.data, 'base64')); }

    // idle: deselect (click empty canvas): the Stock loop keeps its distinct look (warm tan dashed edge + label)
    await clickAt(await screen(230, 90)); await mouse('mouseMoved', 5, 700); await sleep(300);
    const idleEdge = await evalJs(`(() => { const e = document.querySelector('#prepare-canvas .sk-edge-stock'); if (!e) return null; const cs = getComputedStyle(e); return { stroke: cs.stroke, dash: cs.strokeDasharray }; })()`);
    console.log('idle stock edge:', JSON.stringify(idleEdge));
    assert.ok(idleEdge && /227, 184, 115/.test(idleEdge.stroke) && idleEdge.dash !== 'none', 'the unselected Stock loop is drawn warm tan and dashed');
    assert.ok(await evalJs(`!!document.querySelector('#prepare-canvas .sk-stock-label')`), 'and carries its STOCK label');
    if (process.env.EVIDENCE_DIR) { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 44, width: 1400, height: 750, scale: 1 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, 'prepare-stock-idle.png'), Buffer.from(r.data, 'base64')); }

    // a SECOND Stock moves the role (one per document) and says so; Ctrl+Z undoes the move
    await clickAt(await screen(180, 20));                      // the rectangle C
    await pickType('stock');
    const keyC = await stockKey();
    assert.notStrictEqual(keyC, keyA, 'the role moved to the second loop');
    assert.match(await notice(), /Stock moved to this loop/);
    assert.strictEqual(await evalJs(`(async () => { const plan = await import('/apps/shaper/src/cut-plan.js'); return [...plan.CUT_PLAN.values()].filter((r) => r.cutType === 'stock').length; })()`), 1, 'exactly one Stock');
    if (process.env.EVIDENCE_DIR) { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 44, width: 1400, height: 750, scale: 1 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, 'prepare-stock-moved.png'), Buffer.from(r.data, 'base64')); }
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: 2 }); await sleep(400);
    assert.strictEqual(await stockKey(), keyA, 'Ctrl+Z gives the Stock role back to the L loop');

    // a pocket part inside the board (B), then the Review: the board IS the L profile
    await evalJs(`(async () => { const plan = await import('/apps/shaper/src/cut-plan.js'); const { findLoops } = await import('#core/loop-finder.js'); const { loopPolygon } = await import('#core/loop-geometry.js');
      const st = window.__designController.state; const sb = new Map(st.shapes.map((x) => [x.id, x]));
      const b = findLoops(st).map((l) => ({ ...l, polygon: loopPolygon(l, st, sb) })).find((l) => Math.min(...l.polygon.map((p) => p.x)) === 10);
      plan.CUT_PLAN.set(plan.keyOf('loop', b.id), { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 }); })()`);
    await openMode('review');
    let infoText = '';
    for (let i = 0; i < 40 && !/triangles/.test(infoText); i++) { await sleep(250); infoText = await evalJs(`document.getElementById('review-info').textContent`); }
    console.log('review info:', infoText);
    assert.match(infoText, /Board: your Stock loop/, 'the Review builds the board from the Stock loop');
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').disabled`), true, 'the thickness is set on the loop, not here');
    assert.strictEqual(await evalJs(`document.getElementById('review-stock-thickness').value`), '0.500');
    assert.match(await evalJs(`document.getElementById('review-stock-note').textContent`), /Stock loop/);
    await clickEl('#review-top'); await sleep(400);
    const topShot = await shot('review-stock-top.png');
    await clickEl('#review-reset'); await sleep(400);
    const c = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
    await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, 1);
    for (let k = 1; k <= 10; k++) { await mouse('mouseMoved', c.x - k * 8, c.y + k * 5, 1); await sleep(30); }
    await mouse('mouseReleased', c.x - 80, c.y + 50); await sleep(500);
    const orbitShot = await shot('review-stock-orbit.png');
    assert.notStrictEqual(topShot.md5, orbitShot.md5, 'the orbit differs from the top view');
    console.log(`stock-loop-live: ok (top ${topShot.md5}, orbit ${orbitShot.md5})`);
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
