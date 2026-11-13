// tests/axis-snap-live-runner.js - TASK 537 live scenarios (headless CDP, real pointer events). NOT a test file itself: the gate runs each
// *.test.js under a 90 s limit, so axis-snap-live-{lines,shapes,session}.test.js each set ONLY and import this runner.

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
  const dbgPort = 9990 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-537-' + process.pid);
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
    const EVID = process.env.EVIDENCE_DIR || '';
    const jointsOf = (d) => { const jo = d && d.joints; if (!jo) return {}; const out = {}; for (const e of (Array.isArray(jo) ? jo : Object.entries(jo))) { if (Array.isArray(e)) out[e[0]] = e[1]; else out[e.id] = e; } return out; };
    const shot = async (name, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
      if (EVID) { fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); }
    };
    // task 539: the snap leaves a POINT-ON-LINE with the built-in axis line (ref_axis_x / ref_axis_y)
    const isAxisH = (c) => String(c.type) === 'pointOnLine' && c.shape === 'ref_axis_x';
    const isAxisV = (c) => String(c.type) === 'pointOnLine' && c.shape === 'ref_axis_y';
    const readDesign = async () => { await sleep(1500); await waitSaved(); return stored(); };
    const drawBase = async (o) => { await click(o.x + 300, o.y + 200); await esc(); };

    const scenarios = {
      'line end on X axis': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 200, o.y + 9); await esc(); },
      'line end on Y axis': async (o) => { await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 7, o.y + 120); await esc(); },
      'line start on X axis': async (o) => { await letter('l'); await click(o.x + 160, o.y + 8); await click(o.x + 260, o.y - 90); await esc(); },
      'rect corner on X axis': async (o) => { await letter('r'); await click(o.x + 150, o.y - 100); await click(o.x + 250, o.y + 8); await esc(); },
      'circle centre on Y axis': async (o) => { await letter('c'); await click(o.x + 6, o.y + 120); await click(o.x + 60, o.y + 120); await esc(); },
      'polygon centre on X axis': async (o) => { await evalJs("document.getElementById('tool-polygon').click()"); await sleep(200); await click(o.x + 200, o.y + 7); await click(o.x + 260, o.y + 7); await esc(); },
      'arc centre on X axis': async (o) => { await letter('a'); await click(o.x + 200, o.y + 7); await click(o.x + 260, o.y - 60); await click(o.x + 140, o.y - 40); await esc(); },
      'select drag to X axis': async (o) => {
        await letter('l'); await click(o.x + 160, o.y - 90); await click(o.x + 250, o.y - 90); await esc();
        await letter('s'); await drag({ x: o.x + 250, y: o.y - 90 }, { x: o.x + 300, y: o.y + 10 }); await esc();
      },
    };
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const results = {};
    for (const [name, run] of Object.entries(scenarios)) {
      if (only && !only.includes(name)) continue;
      await fresh();
      const o = await toScreen(0, 0);
      await drawBase(o);
      await run(o);
      const d = await readDesign();
      const J = jointsOf(d);
      const h = d.constraints.filter(isAxisH), v = d.constraints.filter(isAxisV);
      const onX = Object.entries(J).filter(([id, p]) => id !== 'j_origin' && Math.abs(p.y) < 1e-6 && Math.abs(p.x) > 1).map(([id]) => id);
      const onY = Object.entries(J).filter(([id, p]) => id !== 'j_origin' && Math.abs(p.x) < 1e-6 && Math.abs(p.y) > 1).map(([id]) => id);
      results[name] = { shapes: d.shapes.length, h: h.length, v: v.length, onX, onY, constraints: d.constraints.map((c) => c.type + ':' + (c.joints || [c.joint]).join('+')) };
      console.log(name.padEnd(26), JSON.stringify(results[name]));
    }
    const R = results;
    const need = (name, cond, msg) => { if (only && !only.includes(name)) return; assert(R[name] && R[name].shapes >= 1, name + ': a shape was drawn'); assert(cond(R[name]), name + ': ' + msg + ' got ' + JSON.stringify(R[name])); };
    need('line end on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'end joint at y === 0 exactly with a horizontal constraint to j_origin');
    need('line end on Y axis', (r) => r.v >= 1 && r.onY.length >= 1, 'end joint at x === 0 exactly with a vertical constraint to j_origin');
    need('line start on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'start joint on the X axis with a horizontal constraint');
    need('rect corner on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'a rect corner on the X axis with a horizontal constraint');
    need('circle centre on Y axis', (r) => r.v >= 1 && r.onY.length >= 1, 'circle centre on the Y axis with a vertical constraint');
    need('polygon centre on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'polygon centre on the X axis with a horizontal constraint');
    need('arc centre on X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'arc centre on the X axis with a horizontal constraint');
    need('select drag to X axis', (r) => r.h >= 1 && r.onX.length >= 1, 'the dragged joint on the X axis with a horizontal constraint');

    if (!only || only.includes('session')) {
      // the line's second point stays on the axis when the FIRST point is dragged; save/load keeps it; undo removes it
      await fresh();
      let o = await toScreen(0, 0);
      await drawBase(o);
      await letter('l');
      await click(o.x + 160, o.y - 90);
      // BEFORE: pointer 60 px off the axis (no snap) / AFTER: pointer 9 px off (snap): the indicator, cropped
      await move(o.x + 200, o.y + 60); await sleep(150);
      await shot('before-no-snap.png', { x: o.x + 60, y: o.y - 60, w: 280, h: 160 });
      assert(await evalJs('document.querySelectorAll(\'[data-snap-axis]\').length') === 0, 'no axis highlight 60 px off the axis');
      await move(o.x + 200, o.y + 9); await sleep(150);
      await shot('after-axis-snap.png', { x: o.x + 60, y: o.y - 60, w: 280, h: 160 });
      const axisHighlight = await evalJs('document.querySelectorAll(\'[data-snap-axis="axis-x"]\').length');
      assert(axisHighlight >= 1, 'the X axis is highlighted while the snap is active; got ' + axisHighlight);
      await click(o.x + 200, o.y + 9); await esc();
      let d = await readDesign();
      let J = jointsOf(d);
      const line = d.shapes.find((s) => s.type === 'line');
      const [aId, bId] = line.joints;
      assert(J[bId].y === 0, 'end joint y is exactly 0: ' + J[bId].y);
      assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'pointOnLine(end, ref_axis_x) stored');
      // a point-on-line glyph is hidden by design until its joint is selected: nothing to assert here
      await shot('after-glyph.png', { x: o.x + 60, y: o.y - 60, w: 280, h: 160 });
      // undo removes the axis constraint (the line is one undo group), redo brings it back with the end joint on the axis
      let gone = false;
      for (let i = 0; i < 4 && !gone; i++) { await key('z', 'KeyZ', 90, 2); d = await readDesign(); gone = !d || !d.constraints.some((c) => isAxisH(c) && c.joint === bId); }
      assert(gone, 'undo removes the axis constraint');
      await key('y', 'KeyY', 89, 2); d = await readDesign(); J = jointsOf(d);
      assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'redo brings the axis constraint back');
      assert(Math.abs(J[bId].y) < 1e-6, 'redo: the end joint is back on the axis: ' + J[bId].y);
      // drag the first point
      await letter('s');
      const a = await toScreen(J[aId].x, J[aId].y);
      await drag(a, { x: a.x + 30, y: a.y - 60 });
      await esc();
      d = await readDesign(); J = jointsOf(d);
      assert(Math.abs(J[bId].y) < 1e-6, 'the end joint stays on the axis after the first point is dragged: ' + J[bId].y);
      // save / load
      await send('Page.navigate', { url }); await sleep(3000);
      d = await stored(); J = jointsOf(d);
      assert(d.constraints.some((c) => isAxisH(c) && c.joint === bId), 'the constraint survives save/load');
      assert(Math.abs(J[bId].y) < 1e-6, 'the end joint is still on the axis after load: ' + J[bId].y);
      console.log('line end: undo-redo / drag-first-point / save-load ok');
    }

    // setting off: no axis snap
    if (!only || only.includes('setting off')) {
      await fresh();
      await evalJs("localStorage.setItem('sketch-studio-settings', JSON.stringify({ AXIS_SNAP: false }))");
      await send('Page.navigate', { url }); await sleep(3000);
      const o = await toScreen(0, 0);
      await drawBase(o);
      await letter('l'); await click(o.x + 160, o.y - 90); await move(o.x + 200, o.y + 9); await sleep(150);
      assert(await evalJs('document.querySelectorAll(\'[data-snap-axis]\').length') === 0, 'setting off: no axis highlight');
      await click(o.x + 200, o.y + 9); await esc();
      const d = await readDesign();
      assert(!d.constraints.some((c) => isAxisH(c) || isAxisV(c)), 'setting off: no axis constraint; got ' + JSON.stringify(d.constraints.map((c) => c.type + ':' + (c.joints || [c.joint]).join('+'))));
      await evalJs("localStorage.removeItem('sketch-studio-settings')");
      console.log('setting off: ok');
    }

    console.log('axis-snap-live: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
