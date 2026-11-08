// tests/shaper-cut-undo.test.js — TASK 463: every Shaper cut-plan edit is ONE step of the SHARED sketch history (Ctrl+Z / Ctrl+Y on
// Prepare, the ribbon Undo/Redo), and undoing an SVG import restores the cut plan that existed before it. Headless Edge, real clicks/keys.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportShaperSVG } from '#core/shaper-export.js';
import { CUT_TYPES, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { findLoops } from '#core/loop-finder.js';
import { deriveCutFootprint } from '#core/profile-model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
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

async function sendRealKey(send, key, code, vk, modifiers = 0, text = '') {
  const down = { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  if (text) down.text = text;
  await send('Input.dispatchKeyEvent', down);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9510 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-463-' + process.pid);
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
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
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
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);

    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    const nav = async (u) => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url: u }); await Promise.race([l, sleep(8000)]); await sleep(1500); };
    const plan = () => evalJs(`(async () => { const { CUT_PLAN } = await import('/apps/shaper/src/cut-plan.js'); return JSON.stringify([...CUT_PLAN.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1)); })()`).then(JSON.parse);
    const hist = () => evalJs(`window.__designController.state.history.length`);
    const ctrl = (k, code, vk, extra = 0) => key(k, code, vk, 2 | extra);
    const recs = async () => (await plan()).map(([, r]) => r);

    await nav(url);
    await clickEl('[data-mode="design"]'); await sleep(1200);
    await evalJs(`(() => {
      const st = window.__designController.state;
      for (const k of [...st.joints.keys()]) st.joints.delete(k);
      st.shapes.length = 0; st.constraints.length = 0;
      const J = (id, x, y) => st.joints.set(id, { x, y });
      J('a', 0, 0); J('b', 60, 0); J('c', 60, 40); J('d', 0, 40);
      [['s1','a','b'],['s2','b','c'],['s3','c','d'],['s4','d','a']].forEach(([id, p, q]) => st.shapes.push({ id, type: 'line', joints: [p, q] }));
      st.history.length = 0; st.redoStack.length = 0; st._notifyHistory();
    })()`);
    await clickEl('[data-mode="prepare"]'); await sleep(900);
    const inside = await evalJs(`(() => { const s = document.getElementById('prepare-canvas'); const p = s.createSVGPoint(); p.x = 30; p.y = 20; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    await click(inside.x, inside.y); // select the loop

    // ── cut TYPE: one step, Ctrl+Z (on Prepare) removes it, Ctrl+Y brings it back ──
    let h0 = await hist();
    await clickEl('.cut-type-trigger'); await sleep(150);
    await clickEl('.cut-type-opt[data-id="pocket"]'); await sleep(200);
    assert.strictEqual(await hist(), h0 + 1, 'picking a cut type is ONE history step');
    assert.deepStrictEqual((await recs()).map((r) => r.cutType), ['pocket']);
    await ctrl('z', 'KeyZ', 90); await sleep(200);
    assert.deepStrictEqual(await plan(), [], 'Ctrl+Z on Prepare removes the cut type (the Design-only gate does not block it)');
    assert.strictEqual(await hist(), h0, 'and it consumed exactly ONE step (no double-firing)');
    await ctrl('y', 'KeyY', 89); await sleep(200);
    assert.deepStrictEqual((await recs()).map((r) => r.cutType), ['pocket'], 'Ctrl+Y brings it back');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-card').hidden`), false, 'the selection and the card survive an undo that only changed the plan');

    // ── DEPTH: change -> undo -> old depth ──
    h0 = await hist();
    await clickEl('.cut-step[data-d="1"]'); await sleep(200);
    assert.strictEqual(await hist(), h0 + 1, 'a depth step is ONE history step');
    const depthSet = (await recs())[0].cutDepth;
    assert.ok(typeof depthSet === 'number' && depthSet > 0, 'depth set: ' + depthSet);
    await ctrl('z', 'KeyZ', 90); await sleep(200);
    assert.strictEqual((await recs())[0].cutDepth, 'unset', 'undo restores the old depth');
    await ctrl('y', 'KeyY', 89); await sleep(200);
    assert.strictEqual((await recs())[0].cutDepth, depthSet);

    // ── offset preset, bit preset, cutter shape + angle: each ONE step; a no-op pick adds none ──
    h0 = await hist();
    await clickEl('.cut-offset'); await sleep(200);
    const p16 = await evalJs(`(() => { const r = document.querySelector('.cut-offset-pop .cut-preset:nth-child(5)').getBoundingClientRect(); return { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) }; })()`);
    await click(p16.x, p16.y); await sleep(200);
    assert.strictEqual(await hist(), h0 + 1, 'an offset preset is ONE step');
    h0 = await hist();
    await clickEl('.cut-presets .cut-preset:nth-child(3)'); await sleep(200); // 1/4 in
    assert.strictEqual(await hist(), h0 + 1, 'a bit-diameter preset is ONE step');
    h0 = await hist();
    await clickEl('.cut-presets .cut-preset:nth-child(3)'); await sleep(200); // the same value again
    assert.strictEqual(await hist(), h0, 'picking the value it already has adds NO step');
    await clickEl('.cut-shape-trigger'); await sleep(150);
    await clickEl('.cut-shape-pop .cut-type-opt[data-shape="vbit"]'); await sleep(200);
    h0 = await hist();
    await clickEl('.cut-shape-pop .cut-shape-angles .cut-preset[data-angle="60"]'); await sleep(200);
    assert.strictEqual(await hist(), h0 + 1, 'choosing a V-bit angle (shape + angle) is ONE step');
    let r0 = (await recs())[0];
    assert.deepStrictEqual([r0.cutterShape, r0.cutterAngle], ['vbit', 60]);
    await ctrl('z', 'KeyZ', 90); await sleep(200);
    r0 = (await recs())[0];
    assert.deepStrictEqual([r0.cutterShape, r0.cutterAngle], ['vbit', 90], 'one undo reverts the angle step');
    await ctrl('y', 'KeyY', 89); await sleep(200);

    // ── the ribbon Undo/Redo buttons (Design) reflect it and drive the same history ──
    await clickEl('.cut-presets .cut-preset:nth-child(2)'); await sleep(200);
    await clickEl('.cut-presets .cut-preset:nth-child(4)'); await sleep(200);
    await ctrl('z', 'KeyZ', 90); await sleep(200); // one step undone, one still undoable
    await clickEl('[data-mode="design"]'); await sleep(900);
    assert.strictEqual(await evalJs(`document.getElementById('btn-redo').disabled`), false, 'Redo is enabled after an undo of a cut edit');
    assert.strictEqual(await evalJs(`document.getElementById('btn-undo').disabled`), false, 'Undo is enabled while cut edits are on the stack');
    const before = JSON.stringify(await plan());
    await clickEl('#btn-undo'); await sleep(250);
    assert.notStrictEqual(JSON.stringify(await plan()), before, 'the ribbon Undo undoes a cut edit too');
    await clickEl('#btn-redo'); await sleep(250);
    assert.strictEqual(JSON.stringify(await plan()), before, 'and Redo brings it back');

    // ── an SVG import: assign cuts, import (adds records), undo the import -> the plan is back to what it was before it ──
    await clickEl('[data-mode="prepare"]'); await sleep(700);
    const planBeforeImport = JSON.stringify(await plan());
    const shapesBefore = await evalJs(`window.__designController.state.shapes.length`);
    await clickEl('[data-mode="design"]'); await sleep(700);
    const svgPath = path.join(os.tmpdir(), 'sk-463-import.svg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M 200 0 L 240 0 L 240 30 L 200 30 Z" fill="#7F7F7F" shaper:cutType="pocket" shaper:cutDepth="6.350 mm" shaper:cutOffset="0mm" shaper:toolDia="3.175 mm"/></svg>');
    await send('DOM.enable');
    const root = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#design-panel-info input[type=file]' });
    await send('DOM.setFileInputFiles', { files: [svgPath], nodeId: node.nodeId }); await sleep(1500);
    const planAfterImport = JSON.stringify(await plan());
    assert.ok(JSON.parse(planAfterImport).length > JSON.parse(planBeforeImport).length, 'the import added a cut record');
    assert.ok((await evalJs(`window.__designController.state.shapes.length`)) > shapesBefore, 'and its shapes');
    await ctrl('z', 'KeyZ', 90); await sleep(300); // Design: the shared handler
    assert.strictEqual(JSON.stringify(await plan()), planBeforeImport, 'undoing the import restores the cut plan that existed before it (no stale records)');
    assert.strictEqual(await evalJs(`window.__designController.state.shapes.length`), shapesBefore, 'and the shapes');
    await ctrl('y', 'KeyY', 89); await sleep(300);
    assert.strictEqual(JSON.stringify(await plan()), planAfterImport, 'redo brings the import and its cuts back');
    console.log('shaper-cut-undo: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
