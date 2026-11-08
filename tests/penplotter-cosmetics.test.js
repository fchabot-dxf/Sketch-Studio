// tests/penplotter-cosmetics.test.js — TASK 465 (Pen Plotter audit leftovers), live headless, real clicks:
// the empty label band is gone, the pens hint and the pen-less group row are worded/named, Export's nothing-to-plot toast
// speaks for the Design tab, Pen-mix says why it is off with no pens, an import seeds a pen for every stroke AND fill colour
// (one rule), and + Outline from a selection replaces the empty starter toolpath.

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
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80">'
  + '<path d="M10 10 L40 10 L40 30 Z" stroke="#ff0000" fill="none"/>'
  + '<circle cx="70" cy="25" r="12" stroke="#0000ff" fill="#00ff00"/></svg>';

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9510 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-465-' + process.pid);
  fs.mkdirSync(userDir + '-files', { recursive: true });
  const svgPath = path.join(userDir + '-files', 'cosmetics.svg');
  fs.writeFileSync(svgPath, SVG);
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
    await send('DOM.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const world = (x, y) => evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = new DOMPoint(${x}, ${y}).matrixTransform(s.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
    const frame = () => send('Page.captureScreenshot', { format: 'png' }); // headless draws frames on demand
    const st = (expr) => evalJs(`import('/apps/penplotter/src/state.js').then(m => { const state = m.state; return JSON.stringify(${expr}); })`).then(JSON.parse);
    const toast = () => evalJs(`document.getElementById('toast').textContent`);

    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([once('Page.loadEventFired'), sleep(8000)]);
    await sleep(1800);

    // ---- item 6c/6b: a fresh page has the starter toolpath in a pen-less group: it is NAMED, and the pens hint is current
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(600);
    const fresh = await evalJs(`(() => ({ group: document.querySelector('#toolpathLayers .group-row').textContent, hint: document.getElementById('plotColors').textContent, strip: !!document.querySelector('.tp-strip'),
      panelTop: Math.round(document.getElementById('toolpathPanel').getBoundingClientRect().top), headerBottom: Math.round(document.querySelector('header.toolbar').getBoundingClientRect().bottom) }))()`);
    console.log('fresh Toolpath tab:', JSON.stringify(fresh));
    assert(/\(no pen\)/.test(fresh.group), 'the pen-less group row is labelled "(no pen)": ' + fresh.group);
    assert(/\+ Pen/.test(fresh.hint) && !/click \+ to/.test(fresh.hint), 'the Pens hint names the + Pen button: ' + fresh.hint);
    // ---- item 6a: no empty label band above the panel (the panel starts right under the header)
    assert.strictEqual(fresh.strip, false, 'no .tp-strip band on the Toolpath tab');
    assert(fresh.panelTop - fresh.headerBottom <= 2, 'the Toolpath panel starts under the header (gap ' + (fresh.panelTop - fresh.headerBottom) + 'px)');
    await clickEl('.stage-btn[data-stage="export"]'); await sleep(600);
    const ex = await evalJs(`(() => ({ strip: !!document.querySelector('.tp-strip'), top: Math.round(document.getElementById('exportPanel').getBoundingClientRect().top), headerBottom: Math.round(document.querySelector('header.toolbar').getBoundingClientRect().bottom) }))()`);
    assert.strictEqual(ex.strip, false, 'no .tp-strip band on the Export tab');
    assert(ex.top - ex.headerBottom <= 2, 'the Export panel starts under the header (gap ' + (ex.top - ex.headerBottom) + 'px)');

    // ---- item 4: Export with nothing to plot says what to do TODAY
    await clickEl('#exportBtn'); await sleep(400);
    const msg = await toast();
    console.log('export toast:', msg);
    assert(/Design tab/.test(msg) && !/art layers/.test(msg), 'the nothing-to-plot toast is worded for the Design tab: ' + msg);

    // ---- item 1: a coloured shape + an EMPTY palette -> the Pen-mix box says why it is off
    await clickEl('.stage-btn[data-stage="design"]'); await sleep(600);
    await clickEl('#tool-line');
    const a = await world(20, 30), b = await world(60, 30);
    await click(a.x, a.y); await click(b.x, b.y);
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await clickEl('#tool-select');
    const m = await world(40, 30); await click(m.x, m.y);
    await frame(); await sleep(300); await frame();
    await evalJs(`(() => { const e = document.getElementById('strokeColor'); e.value = '#ff0000'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await frame(); await sleep(300); await frame();
    const mix = await evalJs(`({ disabled: document.getElementById('shapeMix').disabled, status: document.getElementById('mixStatus').textContent })`);
    console.log('pen-mix, no pens:', JSON.stringify(mix));
    assert.strictEqual(await st('state.plotColors.length'), 0, 'precondition: no pens');
    assert.strictEqual(mix.disabled, true, 'Pen-mix is off without pens');
    assert(/needs pens/.test(mix.status) && /\+ Pen/.test(mix.status), 'and it says why: ' + mix.status);

    // ---- item 2: ONE colour -> pen rule. Import seeds a pen for every STROKE and FILL colour; + Outline then adds none.
    const root = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#importSvgFile' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [svgPath] });
    await sleep(2500);
    const pens = (await st('state.plotColors.map(p => p.color)')).sort();
    console.log('pens after import:', JSON.stringify(pens));
    assert.deepStrictEqual(pens, ['#00ff00', '#0000ff', '#ff0000'].sort(), 'a pen for every stroke and fill colour of the import');

    // ---- item 6d: + Outline from a selection replaces the empty starter toolpath, and adds no pen
    const before = await st('state.toolpaths.map(t => t.name)');
    assert(before.includes('Outline'), 'the starter toolpath is still there before: ' + before);
    await clickEl('#tool-select');
    const c = await world(82, 25); await click(c.x, c.y);       // the circle's edge (stroke #0000ff, fill #00ff00)
    await frame(); await sleep(300); await frame();
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(700);
    await clickEl('#addOutlineTp'); await sleep(500);
    const after = await st('({ names: state.toolpaths.map(t => t.name), pens: state.plotColors.map(p => p.color).length })');
    console.log('toolpaths after + Outline:', JSON.stringify(after));
    assert(!after.names.includes('Outline'), 'the empty starter "Outline" toolpath is gone: ' + after.names);
    assert(after.names.length >= 1 && after.names.every((n) => /^outline \d+$/.test(n)), 'only real toolpaths remain: ' + after.names);
    assert.strictEqual(after.pens, 3, '+ Outline created no extra pen (the blue stroke pen existed from the import)');

    // a starter toolpath the user EDITED is not dropped (unit check on the predicate, in the page)
    const kept = await evalJs(`import('/apps/penplotter/src/state.js').then(m => { m.initLayers(); const tp = m.state.toolpaths[0]; const a = m.isPristinePlaceholder(tp); tp.outline.passes = 3; const b = m.isPristinePlaceholder(tp); tp.outline.passes = 1; tp.targetShapeIds = ['x']; const c = m.isPristinePlaceholder(tp); return JSON.stringify([a, b, c]); })`).then(JSON.parse);
    assert.deepStrictEqual(kept, [true, false, false], 'pristine starter only: edited or targeted ones are kept: ' + kept);
    console.log('penplotter-cosmetics: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(userDir + '-files', { recursive: true, force: true }); } catch (_) {}
  }
})();
