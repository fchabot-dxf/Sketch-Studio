// tests/penplotter-persist.test.js — TASK 451: the Pen Plotter's own document survives a REAL page reload.
// Live headless CDP: import an SVG, build pens/toolpaths/settings/styles + a non-default doc size, wait for the autosave,
// reload the page, and compare the persisted plotter document, the exported G-code (byte-identical) and the panels.
// Then strip the host sidecar from the saved design (an OLD document) and reload: defaults, geometry kept.

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
  const dbgPort = 9910 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-451-' + process.pid);
  fs.mkdirSync(userDir + '-files', { recursive: true });
  const svgPath = path.join(userDir + '-files', 'persist.svg');
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
    const load = async () => {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
      await Promise.race([loaded, sleep(8000)]);
      await sleep(1800);
    };
    const reload = async () => {
      const loaded = once('Page.loadEventFired');
      await send('Page.reload');
      await Promise.race([loaded, sleep(8000)]);
      await sleep(2500); // mount + the async IndexedDB restore + the post-restore repaint
    };
    const waitSaved = async () => {
      for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) return; await sleep(250); }
      throw new Error('autosave never reported Saved');
    };
    const observe = () => evalJs(`(async () => {
      const { capturePlotterDoc } = await import('/apps/penplotter/src/plotter-doc.js');
      const { buildGcodeEntries } = await import('/apps/penplotter/src/export.js');
      return JSON.stringify({
        plotter: capturePlotterDoc(),
        shapes: window.__sketch.controller.state.shapes.length,
        gcode: buildGcodeEntries(),
        penRows: document.querySelectorAll('#plotColors .pc-row').length,
        docInfo: (document.getElementById('docInfo') || {}).textContent || '',
        stage: document.querySelector('.stage-btn.active').dataset.stage,
        drawFeedInput: (document.getElementById('drawFeed') || {}).value,
      });
    })()`).then(JSON.parse);

    await load();
    // Import the SVG through the real file input (a real file chooser result).
    const root = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: root.nodeId !== undefined ? root.nodeId : root.root.nodeId, selector: '#importSvgFile' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [svgPath] });
    await sleep(2500);
    // Build the plotter state: a real click on + Pen, then toolpaths/settings/styles (test setup, not the gesture under test).
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(600);
    await clickEl('#addPlotColor');
    await evalJs(`(async () => {
      const { state, makeToolpath } = await import('/apps/penplotter/src/state.js');
      const shapes = window.__sketch.controller.state.shapes;
      const circle = shapes.find(s => s.type === 'circle').id;
      const lines = shapes.map(s => s.id).filter(i => i !== circle);
      state.doc = { w: 100, h: 80 };
      const a = makeToolpath('Tri', 'outline'); a.targetShapeIds = lines; a.plotColorId = state.plotColors[0].id; a.outline.passes = 2; a.outline.style = 'dashed';
      const b = makeToolpath('Disc', 'fill'); b.targetShapeIds = [circle]; b.plotColorId = state.plotColors[state.plotColors.length - 1].id;
      b.fill = { pattern: 'crosshatch', angle: 30, spacing: 1.5, offset: 0.5 };
      state.toolpaths = [a, b]; state.activeToolpathId = b.id;
      state.settings = { pen_up_z: 7, pen_down_z: -2, draw_feed: 1234, z_feed: 567, tolerance_mm: 0.2 };
      state.plotColors[0].name = 'Fine red'; state.plotColors[0].width = 0.3;
    })()`);
    await sleep(1800); // a poll tick passes, so the sidecar written AFTER the setup is the one saved
    await waitSaved();
    await sleep(1800);
    await waitSaved();
    const before = await observe();
    assert(before.plotter.toolpaths.length === 2 && before.plotter.plotColors.length >= 2, 'setup built the plotter state');
    assert(before.gcode.length === 2, 'two exportable toolpaths before reload: ' + before.gcode.length);
    assert(before.shapes > 0, 'geometry imported');

    await reload();
    const after = await observe();
    console.log('before:', before.docInfo, '| pens', before.plotter.plotColors.length, '| toolpaths', before.plotter.toolpaths.length, '| feed', before.plotter.settings.draw_feed);
    console.log('after :', after.docInfo, '| pens', after.plotter.plotColors.length, '| toolpaths', after.plotter.toolpaths.length, '| feed', after.plotter.settings.draw_feed);
    assert.strictEqual(after.stage, before.stage, 'active stage restored');
    assert.deepStrictEqual(after.plotter, before.plotter, 'the whole plotter document (doc, pens, toolpaths, settings, styles, static ids) is equal after reload');
    assert.strictEqual(after.shapes, before.shapes, 'geometry restored');
    assert.deepStrictEqual(after.gcode, before.gcode, 'the exported G-code is byte-identical after reload');
    assert.strictEqual(after.penRows, before.plotter.plotColors.length, 'the Pens panel shows the restored pens');
    assert(/100 × 80 mm/.test(after.docInfo), 'canvas readout shows the restored doc size: ' + after.docInfo);
    assert.strictEqual(after.drawFeedInput, '1234', 'the Toolpath settings inputs show the restored feed');
    // ids minted after the restore must not collide with restored ones
    const clash = await evalJs(`(async () => { const { uid, state } = await import('/apps/penplotter/src/state.js'); const f = [uid('toolpath'), uid('pen')]; const all = [...state.toolpaths.map(t => t.id), ...state.plotColors.map(p => p.id)]; return JSON.stringify(f.filter(x => all.includes(x))); })()`);
    assert.strictEqual(clash, '[]', 'new ids do not collide with restored ids');

    // OLD document: strip the host sidecar from the saved buffer, reload -> plotter defaults, geometry kept.
    await evalJs(`new Promise((res, rej) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction(['meta', 'designs'], 'readwrite');
        const m = tx.objectStore('meta').get('currentDesign');
        m.onsuccess = () => { const g = tx.objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result; delete d.document.hosts.penplotter; tx.objectStore('designs').put(d); }; };
        tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
      };
      open.onerror = () => rej(open.error);
    })`);
    await reload();
    const old = await observe();
    console.log('old doc :', old.docInfo, '| pens', old.plotter.plotColors.length, '| toolpaths', old.plotter.toolpaths.length, '| shapes', old.shapes);
    assert.strictEqual(old.shapes, before.shapes, 'an old document still restores its geometry');
    assert.deepStrictEqual(old.plotter.doc, { w: 200, h: 200 }, 'old document: default doc size');
    assert.strictEqual(old.plotter.plotColors.length, 0, 'old document: no pens');
    assert.strictEqual(old.plotter.toolpaths.length, 1, 'old document: the single default toolpath');
    assert.strictEqual(old.plotter.settings.draw_feed, 2000, 'old document: default feed');
    console.log('penplotter-persist: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(userDir + '-files', { recursive: true, force: true }); } catch (_) {}
  }
})();
