// tests/penplotter-validation-live.test.js — TASK 453: the Pen Plotter inputs keep ONE valid value (live, real typing).
// Document dialog, machine settings, fill spacing, outline passes and pen width: a bad value is clamped or refused and the
// box SHOWS the value actually kept; the exported G-code never holds F0 / NaN.

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
  const dbgPort = 9610 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-453-' + process.pid);
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
    const key = async (k, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(150);
    };
    // Real typing into a number box: click it, select all, type, then Tab (the "change" commit).
    const typeInto = async (sel, text) => {
      await clickEl(sel);
      await key('a', 'KeyA', 65, 2);
      if (text === '') await key('Backspace', 'Backspace', 8); else await send('Input.insertText', { text });
      await key('Tab', 'Tab', 9);
      await sleep(250);
    };
    const val = (sel) => evalJs(`document.querySelector('${sel}').value`);
    const st = (expr) => evalJs(`import('/apps/penplotter/src/state.js').then(m => { const state = m.state; return JSON.stringify(${expr}); })`).then(JSON.parse);
    const frame = () => send('Page.captureScreenshot', { format: 'png' });
    const spacingSel = async () => { await evalJs(`(() => { const f = [...document.querySelectorAll('#activeLayerContent .field')].find(f => f.textContent.includes('Spacing')); f.querySelector('input').setAttribute('data-t', 'sp'); })()`); return '[data-t="sp"]'; };

    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([once('Page.loadEventFired'), sleep(8000)]);
    await sleep(1800);

    // ---- Document dialog (Design tab): the box shows the KEPT value
    await clickEl('#designDocBtn'); await sleep(300);
    const doc = [];
    for (const [typed, want, why] of [['-5', 10, 'negative clamps to the minimum'], ['99999', 2000, 'huge clamps to the maximum'], ['', 2000, 'empty keeps the previous'], ['0', 10, 'zero clamps to the minimum'], ['150', 150, 'a valid size is kept']]) {
      await typeInto('#docW', typed);
      const shown = +(await val('#docW')); const kept = (await st('state.doc')).w;
      doc.push(`${JSON.stringify(typed)} -> box ${shown}, doc.w ${kept}`);
      assert.strictEqual(kept, want, 'doc width ' + why + ': ' + JSON.stringify(typed) + ' kept ' + kept);
      assert.strictEqual(shown, want, 'the box shows the kept value: ' + shown);
    }
    console.log('document:', doc.join(' | '));
    await clickEl('#docDone');

    // ---- Toolpath tab: machine settings
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(700);
    const set = [];
    for (const [id, typed, key_, want] of [
      ['drawFeed', '', 'draw_feed', 2000], ['drawFeed', '-5', 'draw_feed', 1], ['drawFeed', '1234', 'draw_feed', 1234],
      ['zFeed', '0', 'z_feed', 1], ['tol', '0', 'tolerance_mm', 0.001], ['tol', '-1', 'tolerance_mm', 0.001],
      ['penUpZ', '-1', 'pen_up_z', 5],           // == pen down Z (-1): refused, previous kept
    ]) {
      await typeInto('#' + id, typed);
      const kept = (await st('state.settings'))[key_]; const shown = +(await val('#' + id));
      set.push(`${id} ${JSON.stringify(typed)} -> ${kept}`);
      assert.strictEqual(kept, want, `${id} ${JSON.stringify(typed)} kept ${kept}, wanted ${want}`);
      assert.strictEqual(shown, want, `${id} box shows the kept value ${shown}`);
    }
    console.log('settings:', set.join(' | '));
    assert(/must differ/.test(await evalJs(`document.getElementById('toast').textContent`)), 'the refusal is explained in the toast');

    // ---- a fill toolpath: spacing and angle
    await clickEl('#addFillTp'); await sleep(500);
    const sp = await spacingSel();
    const fills = [];
    for (const [typed, want] of [['0', 0.1], ['-1', 0.1], ['', 0.1], ['500', 100], ['3', 3]]) {
      await typeInto(sp, typed);
      const kept = (await st('state.toolpaths.find(t => t.id === state.activeToolpathId).fill.spacing')); const shown = +(await val(sp));
      fills.push(`${JSON.stringify(typed)} -> ${kept}`);
      assert.strictEqual(shown, kept, 'the Spacing box shows the kept value ' + kept + ', not ' + shown);
      if (typed !== '') assert.strictEqual(kept, want, 'spacing ' + typed + ' kept ' + kept);
    }
    console.log('spacing :', fills.join(' | '));

    // ---- outline passes (the default Outline toolpath)
    await evalJs(`(() => { const r = [...document.querySelectorAll('#toolpathLayers .tp-layer-row')].find(r => /Outline/.test(r.textContent)); r.scrollIntoView({ block: 'center' }); const q = r.querySelector('.tp-layer-name').getBoundingClientRect(); window.__pt = { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }; })()`);
    const pt = await evalJs('window.__pt'); await click(pt.x, pt.y);
    await evalJs(`(() => { const f = [...document.querySelectorAll('#activeLayerContent .field')].find(f => f.textContent.includes('Passes')); f.querySelector('input').setAttribute('data-t', 'passes'); })()`);
    const passes = [];
    for (const [typed, want] of [['0', 1], ['-2', 1], ['2.5', 3], ['99', 10]]) {
      await typeInto('[data-t="passes"]', typed);
      const kept = await st('state.toolpaths.find(t => t.id === state.activeToolpathId).outline.passes');
      passes.push(`${typed} -> ${kept}`);
      assert.strictEqual(kept, want, 'passes ' + typed + ' kept ' + kept);
      assert.strictEqual(+(await val('[data-t="passes"]')), want, 'the Passes box shows the kept value');
    }
    console.log('passes  :', passes.join(' | '));

    // ---- pen width: add a pen, type widths
    await clickEl('#addPlotColor'); await sleep(300);
    const widths = [];
    for (const [typed, want] of [['-3', 0.05], ['99', 5], ['', 5], ['0.3', 0.3]]) {
      await typeInto('.pc-row:last-child .pc-width', typed);
      const kept = await st('state.plotColors[state.plotColors.length - 1].width'); const shown = +(await val('.pc-row:last-child .pc-width'));
      widths.push(`${JSON.stringify(typed)} -> ${kept}`);
      assert.strictEqual(kept, want, 'pen width ' + typed + ' kept ' + kept);
      assert.strictEqual(shown, want, 'the pen width box shows the kept value');
    }
    console.log('pen width:', widths.join(' | '));

    // ---- the exported G-code never contains F0 / NaN even with the settings just typed
    const gcode = await evalJs(`import('/apps/penplotter/src/export.js').then(m => JSON.stringify(m.buildGcodeEntries().map(e => e.content)))`).then(JSON.parse);
    assert(gcode.length >= 0 && gcode.every((g) => !/F0\b|NaN/.test(g)), 'no F0 / NaN in the exported G-code');
    console.log('penplotter-validation-live: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
