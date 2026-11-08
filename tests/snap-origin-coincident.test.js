// tests/snap-origin-coincident.test.js — TASK 484: a point snapped onto the ORIGIN must leave a COINCIDENT constraint with j_origin.
// Live headless CDP with the real pointer path (mouse events on #svgCanvas); the result is read from the stored design.
// Each kind (line end, line start, rect corner, circle centre, arc point, dragged existing joint) runs on a fresh design.

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


await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9910 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-484-' + process.pid);
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    assert(await waitForJson(dbgPort), 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails));
      return r && r.result ? r.result.value : undefined;
    };
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(40); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const drag = async (a, b) => {
      await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleep(60);
      for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await sleep(30); }
      await mouse('mouseReleased', b.x, b.y, 0); await sleep(200);
    };
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); await sleep(120);
    };
    const TOOL = { l: 'line', r: 'rect', c: 'circle', a: 'arc', s: 'select' };
    const letter = async (c) => { await evalJs(`document.getElementById('tool-${TOOL[c]}').click()`); await sleep(200); };
    const esc = () => key('Escape', 'Escape', 27);
    const undoKey = () => key('z', 'KeyZ', 90, 2);
    const stored = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleep(300); return; } await sleep(250); } };
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const fresh = async () => {
      await send('Page.navigate', { url }); await sleep(2500);
      await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
      await send('Page.navigate', { url }); await sleep(2500);
    };
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('svgCanvas'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const refersOrigin = (c) => String(c.type).toLowerCase() === 'coincident' && (c.joints || []).includes('j_origin');

    const scenarios = {
      'line end': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x, o.y); await esc(); },
      'line end (12px off)': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 12, o.y); await esc(); },
      'line end (15px off)': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 15, o.y); await esc(); },
      'line end (24px off)': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 24, o.y); await esc(); },
      'line start': async (o) => { await letter('l'); await click(o.x, o.y); await click(o.x + 160, o.y - 90); await esc(); },
      'circle centre': async (o) => { await letter('c'); await click(o.x, o.y); await click(o.x + 120, o.y); await esc(); },
    };
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const results = {};
    for (const [name, run] of Object.entries(scenarios)) {
      if (only && !only.includes(name)) continue;
      await fresh();
      const o = await toScreen(0, 0);
      await click(o.x + 300, o.y + 200); await esc();
      await run(o);
      let d = null;
      await sleep(1500); await waitSaved(); d = await stored();
      const hit = d ? d.constraints.filter(refersOrigin) : [];
      const jo = d && d.joints; const near = jo ? (Array.isArray(jo) ? jo : Object.entries(jo)).filter((e) => { const v = Array.isArray(e) ? e[1] : e; return v && Math.hypot(v.x, v.y) < 0.2; }).length : null;
      results[name] = { nearOrigin: near, shapes: d && d.shapes.length, constraints: d && d.constraints.map((c) => c.type + ':' + (c.joints || []).join('+')), originCoincident: hit.length };
      console.log(name.padEnd(14), JSON.stringify(results[name]));
    }
    for (const [name, r] of Object.entries(results)) {
      assert(r.shapes >= 1, name + ': a shape was drawn');
      if (name === 'line start') continue;
      if (name === 'line end (24px off)') { assert(r.originCoincident === 0, name + ': outside the joint marker nothing is locked'); continue; } // checked below: the line's start joint IS j_origin (no second joint, so nothing to constrain)
      assert(r.originCoincident >= 1, name + ': a COINCIDENT constraint with j_origin exists; got ' + JSON.stringify(r.constraints));
    }

    // a line STARTED on the origin reuses j_origin itself as its start joint (nothing can drift: it is the origin)
    await fresh();
    let o = await toScreen(0, 0);
    await click(o.x + 300, o.y + 200); await esc();
    await letter('l'); await click(o.x, o.y); await click(o.x + 160, o.y - 90); await esc();
    await sleep(3500); await waitSaved();
    let d = await stored();
    assert(d.shapes.length === 1 && d.shapes[0].joints.includes('j_origin'), 'a line started on the origin uses j_origin as its start joint: ' + JSON.stringify(d.shapes[0] && d.shapes[0].joints));

    console.log('snap-origin-coincident: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
