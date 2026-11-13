// tests/reference-lines-live.test.js - TASK 539 live (headless CDP, real pointer events), SketchStudio and Shaper:
// the X axis is lit (data-ref-axis) ONLY while a constraint tool asks for a target and the pointer is on it; never in Select, never
// while a line tool draws; a click on it in Select selects / drags nothing; a parallel pick (line, then axis) stores
// parallel [line, ref_axis_x] and the line turns horizontal; a real line lying on the axis wins the pick.
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
  for (const c of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) if (fs.existsSync(c)) return c;
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) { try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) {} }
  return null;
}
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        let url = (req.url || '/').split('?')[0]; if (url.endsWith('/')) url += 'index.html';
        const file = path.normalize(path.join(REPO_ROOT, decodeURIComponent(url)));
        if (!file.startsWith(REPO_ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
        const data = await fsp.readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
      } catch (e) { res.writeHead(404); res.end('nf ' + e.message); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
async function waitForJson(dbgPort) { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`); if (r.ok) return true; } catch (_) {} await sleep(200); } return false; }
async function closeBrowser(proc, dbgPort) {
  const exited = new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', () => res()); });
  try {
    const v = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
    if (v && v.webSocketDebuggerUrl) {
      const ws = new WebSocket(v.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); setTimeout(rej, 2000); });
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); await Promise.race([exited, sleep(3000)]); try { ws.close(); } catch (_) {}
    }
  } catch (_) {}
  try { if (process.platform === 'win32' && proc.pid) execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); else proc.kill(); } catch (_) {}
}

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9990 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-539-' + process.pid);
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
  try {
    assert(await waitForJson(dbgPort), 'headless browser did not expose CDP port');
    const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
    await new Promise((r) => ws.addEventListener('open', r));
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) throw new Error('CDP eval threw: ' + JSON.stringify(r.exceptionDetails)); return r && r.result ? r.result.value : undefined; };
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleep(80); };
    const click = async (x, y) => { await move(x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(150); };
    const drag = async (a, b) => { await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8, 1); await sleep(30); } await mouse('mouseReleased', b.x, b.y, 0); await sleep(200); };
    const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(120); };
    const esc = () => key('Escape', 'Escape', 27);
    const tool = async (t) => { await evalJs(`document.getElementById('tool-${t}').click()`); await sleep(200); };
    const EVID = process.env.EVIDENCE_DIR || '';
    const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } }); if (EVID) { fs.mkdirSync(EVID, { recursive: true }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); } };
    const litCount = (axis) => evalJs(`document.querySelectorAll('[data-ref-axis${axis ? `="${axis}"` : ''}]').length`);
    const stored = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1); open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleep(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleep(300); return; } await sleep(250); } };
    const toScreen = (canvas, wx, wy) => evalJs(`(() => { const s = document.querySelector('${canvas}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);

    // ---- SketchStudio ----
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    await send('Page.navigate', { url }); await sleep(2500);
    await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
    await send('Page.navigate', { url }); await sleep(2500);
    let o = await toScreen('#svgCanvas', 0, 0);
    // a sketch line well off the axes
    await tool('line'); await click(o.x + 200, o.y - 150); await click(o.x + 380, o.y - 60); await esc();
    // Select: the axis is not lit, not selectable, not draggable
    await tool('select');
    await move(o.x + 250, o.y); assert((await litCount()) === 0, 'select: the X axis is not lit under the pointer');
    await click(o.x + 250, o.y); assert((await litCount()) === 0, 'select: clicking the axis selects nothing');
    await drag({ x: o.x + 250, y: o.y }, { x: o.x + 250, y: o.y + 80 }); await esc();
    let d = await stored(); assert(d && d.constraints.every((c) => !JSON.stringify(c).includes('ref_axis')), 'select: no axis constraint');
    // drawing: the axis is not lit while the line tool is armed and hovers it
    await tool('line'); await move(o.x + 250, o.y + 40); assert((await litCount()) === 0, 'line tool: no ref-axis lit'); await esc();
    // Parallel tool: lit while hovering the axis, not elsewhere
    await tool('parallel');
    await move(o.x + 250, o.y + 120); assert((await litCount()) === 0, 'parallel: pointer 120 px off the axis = not lit');
    await shot('before-hover-off.png', { x: o.x + 120, y: o.y - 200, w: 400, h: 260 });
    await move(o.x + 250, o.y + 6); assert((await litCount('ref_axis_x')) === 1, 'parallel: the X axis lights up under the pointer');
    await shot('after-hover-lit.png', { x: o.x + 120, y: o.y - 200, w: 400, h: 260 });
    await move(o.x, o.y + 200); assert((await litCount('ref_axis_y')) === 1 && (await litCount('ref_axis_x')) === 0, 'parallel: the Y axis lights up on its own');
    // pick: the sketch line, then the X axis
    await click(o.x + 290, o.y - 105);
    await click(o.x + 250, o.y + 3);
    await sleep(1500); await waitSaved();
    d = await stored();
    const par = d.constraints.find((c) => c.type === 'parallel');
    assert(par && par.shapes.includes('ref_axis_x'), 'parallel stored against the axis: ' + JSON.stringify(d.constraints));
    const line = d.shapes.find((s) => s.type === 'line'); const jo = (e) => Object.fromEntries(Array.isArray(e) ? e : Object.entries(e));
    const J = Array.isArray(d.joints) ? Object.fromEntries(d.joints.map((e) => Array.isArray(e) ? e : [e.id, e])) : d.joints;
    assert(Math.abs(J[line.joints[0]].y - J[line.joints[1]].y) < 1e-3, 'the line is now horizontal: ' + JSON.stringify([J[line.joints[0]], J[line.joints[1]]]));
    assert(d.shapes.length === 1 && !d.shapes.some((s) => s.reference) && !JSON.stringify(d.joints).includes('j_ref'), 'no axis in the saved shapes / joints');
    assert(d.shapes.length === 1, 'shape count unchanged by the axis');
    // back in Select: the axis is again not pickable
    await tool('select'); await move(o.x + 250, o.y + 3); assert((await litCount()) === 0, 'select again: not lit');
    // real line on the axis wins the tie: draw a line ON the X axis (axis snap), then Parallel tool hover over it
    await tool('line'); await click(o.x + 120, o.y + 4); await click(o.x + 320, o.y + 4); await esc();
    await tool('parallel'); await move(o.x + 220, o.y + 1);
    assert((await litCount()) === 0, 'a sketch line lying on the axis wins: the axis is not lit over it');
    await esc();
    console.log('SketchStudio: reference-line picking ok');

    // ---- Shaper ----
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` }); await sleep(4000);
    await evalJs(`localStorage.clear(); document.querySelector('.mode-btn[data-mode="design"]').click()`); await sleep(1000);
    o = await toScreen('#design-canvas', 0, 0);
    await tool('line'); await click(o.x + 200, o.y - 150); await click(o.x + 380, o.y - 60); await esc();
    await tool('select'); await move(o.x + 900, o.y); assert((await litCount()) === 0, 'Shaper select: not lit');
    await tool('parallel'); await move(o.x + 900, o.y + 120); assert((await litCount()) === 0, 'Shaper parallel: off the axis not lit');
    await move(o.x + 250, o.y + 6); await move(o.x + 900, o.y + 6); assert((await litCount('ref_axis_x')) === 1, 'Shaper parallel: the X axis lights up');
    await shot('shaper-after-hover-lit.png', { x: o.x + 120, y: o.y - 200, w: 400, h: 260 });
    await tool('select'); await move(o.x + 900, o.y + 6); assert((await litCount()) === 0, 'Shaper select again: not lit');
    console.log('Shaper: reference-line picking ok');
    console.log('reference-lines-live: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
