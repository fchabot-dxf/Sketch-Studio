// tests/document-buffer-hosts.test.js — TASK 458: the shared autosave buffer keeps OTHER apps' host sidecars.
// Live headless CDP, same origin (the buffer key is shared by every app):
//  A. the real repro: Pen Plotter saves pens/toolpaths -> SketchStudio (no host) edits and autosaves -> back in Pen Plotter
//     after a reload the plotter state is unchanged (before the fix SketchStudio's save wrote hosts:{} and wiped it).
//  B. in-page buffers: two hosts saving alternately both keep their sidecar; a host-less buffer never deletes any.

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
  const dbgPort = 9810 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-458-' + process.pid);
  fs.mkdirSync(userDir + '-files', { recursive: true });
  const svgPath = path.join(userDir + '-files', 'hosts.svg');
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
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const goto = async (url, settle = 1800) => {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(settle);
    };
    const waitSaved = async () => {
      for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) return; await sleep(250); }
      throw new Error('autosave never reported Saved');
    };
    // The stored buffer, read straight from IndexedDB: { shapes, hosts: [names] }.
    const stored = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-documents', 1);
      open.onsuccess = () => { const g = open.result.transaction('kv').objectStore('kv').get('current'); g.onsuccess = () => { const d = g.result; res(d ? { shapes: d.geometry.shapes.length, hosts: Object.keys(d.hosts || {}).sort(), doc: d } : null); }; };
    }).then(r => r && JSON.stringify({ shapes: r.shapes, hosts: r.hosts, penplotter: r.doc.hosts && r.doc.hosts.penplotter }))`).then((s) => s && JSON.parse(s));
    const plotterDoc = () => evalJs(`import('/apps/penplotter/src/plotter-doc.js').then(m => JSON.stringify(m.capturePlotterDoc()))`).then(JSON.parse);

    // ---- A. Pen Plotter -> SketchStudio edit -> Pen Plotter
    await goto('/apps/penplotter/index.html');
    const root = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#importSvgFile' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [svgPath] });
    await sleep(2500);
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(600);
    await clickEl('#addPlotColor');
    await evalJs(`(async () => {
      const { state, makeToolpath } = await import('/apps/penplotter/src/state.js');
      const shapes = window.__sketch.controller.state.shapes;
      const a = makeToolpath('Tri', 'outline'); a.targetShapeIds = shapes.map(s => s.id); a.plotColorId = state.plotColors[0].id; a.outline.passes = 2;
      state.toolpaths = [a]; state.activeToolpathId = a.id;
      state.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2 };
    })()`);
    await sleep(1800); await waitSaved(); await sleep(1800); await waitSaved();
    const plotterBefore = await plotterDoc();
    const s1 = await stored();
    assert(s1 && s1.hosts.includes('penplotter'), 'Pen Plotter saved its sidecar: ' + JSON.stringify(s1 && s1.hosts));
    assert(plotterBefore.toolpaths.length === 1 && plotterBefore.plotColors.length >= 1, 'plotter state built');

    await goto('/apps/sketchstudio/index.html', 3000);
    const rc = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    await clickEl('#tool-line');
    await click(Math.round(rc.x + rc.w * 0.30), Math.round(rc.y + rc.h * 0.70));
    await click(Math.round(rc.x + rc.w * 0.55), Math.round(rc.y + rc.h * 0.70));
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    let s2 = null;
    for (let i = 0; i < 40; i++) { s2 = await stored(); if (s2 && s2.shapes > s1.shapes) break; await sleep(250); }
    assert(s2 && s2.shapes > s1.shapes, 'SketchStudio autosaved its edit: shapes ' + (s1 && s1.shapes) + ' -> ' + (s2 && s2.shapes));
    console.log('after SketchStudio save: shapes', s1.shapes, '->', s2.shapes, '| hosts', JSON.stringify(s2.hosts));
    assert(s2.hosts.includes('penplotter'), 'SketchStudio\'s save dropped the Pen Plotter sidecar (hosts: ' + JSON.stringify(s2.hosts) + ')');

    await goto('/apps/penplotter/index.html', 2800);
    const plotterAfter = await plotterDoc();
    assert.deepStrictEqual(plotterAfter, plotterBefore, 'Pen Plotter state is unchanged after another app saved');

    // ---- B. in-page buffers: two hosts alternate, a host-less buffer never deletes
    const result = await evalJs(`(async () => {
      const { createDocumentBuffer } = await import('/packages/ui/document-buffer.js');
      const mk = () => ({ joints: new Map(), shapes: [], constraints: [] });
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const read = () => new Promise((res) => { const o = indexedDB.open('sketch-studio-documents', 1); o.onsuccess = () => { const g = o.result.transaction('kv').objectStore('kv').get('current'); g.onsuccess = () => res(g.result.hosts); }; });
      const a = { v: 1 }, b = { v: 1 };
      const sa = mk(), sb = mk(), sc = mk();
      const A = createDocumentBuffer({ state: sa, hostName: 'hostA', getHostData: () => a, pollMs: 40 });
      const B = createDocumentBuffer({ state: sb, hostName: 'hostB', getHostData: () => b, pollMs: 40 });
      const C = createDocumentBuffer({ state: sc, pollMs: 40 });
      const out = [];
      A.start(); await wait(250); out.push(['A saves', Object.keys(await read()).sort()]);
      A.stop(); B.start(); await wait(250); out.push(['B saves', Object.keys(await read()).sort()]);
      B.stop(); a.v = 2; A.start(); await wait(250); out.push(['A changes', JSON.stringify((await read()).hostA), Object.keys(await read()).sort()]);
      A.stop(); b.v = 2; B.start(); await wait(250); out.push(['B changes', JSON.stringify((await read()).hostB), Object.keys(await read()).sort()]);
      B.stop(); sc.shapes.push({ id: 'x', type: 'line', joints: [] }); C.start(); await wait(250); out.push(['host-less saves', Object.keys(await read()).sort()]);
      C.stop();
      return JSON.stringify(out);
    })()`).then(JSON.parse);
    for (const r of result) console.log('  ', JSON.stringify(r));
    const has = (r, ...names) => names.every((n) => r.includes(n));
    assert(has(result[0][1], 'hostA'), 'A saved');
    assert(has(result[1][1], 'hostA', 'hostB'), 'B saved and A survived: ' + JSON.stringify(result[1][1]));
    assert(result[2][1] === '{"v":2}' && has(result[2][2], 'hostA', 'hostB'), 'A updated its own sidecar, B kept: ' + JSON.stringify(result[2]));
    assert(result[3][1] === '{"v":2}' && has(result[3][2], 'hostA', 'hostB'), 'B updated its own sidecar, A kept: ' + JSON.stringify(result[3]));
    assert(has(result[4][1], 'hostA', 'hostB', 'penplotter'), 'a host-less save deleted no sidecar: ' + JSON.stringify(result[4]));
    console.log('document-buffer-hosts: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(userDir + '-files', { recursive: true, force: true }); } catch (_) {}
  }
})();
