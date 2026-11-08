// tests/penplotter-active-panel.test.js — TASK 454: the Active Toolpath panel follows state.activeToolpathId, by any path.
// Live headless CDP with REAL clicks/keys: + Fill from a selection (the panel shows the NEW fill; editing Spacing changes
// THAT toolpath only), a row click, deleting the active toolpath, undo and redo.

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
  const dbgPort = 9710 + Math.floor((Date.now() % 80));
  const userDir = path.join(os.tmpdir(), 'sk-test-454-' + process.pid);
  fs.mkdirSync(userDir + '-files', { recursive: true });
  const svgPath = path.join(userDir + '-files', 'active.svg');
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
    // Scroll the element into view, then click its centre with a REAL mouse event.
    const clickEl = async (sel, { within } = {}) => {
      const c = await evalJs(`(() => { const root = ${within ? `document.querySelector('${within}')` : 'document'}; const e = root.querySelector('${sel}'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const key = async (k, code, vk, modifiers = 0, text = '') => {
      const down = { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
      if (text) down.text = text;
      await send('Input.dispatchKeyEvent', down);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
      await sleep(200);
    };
    const rowByText = (re) => `(() => { const r = [...document.querySelectorAll('#toolpathLayers .tp-layer-row')].find(r => ${re}.test(r.textContent)); if (!r) return null; r.setAttribute('data-test-row', '1'); return true; })()`;
    const clickRow = async (re, sub = '.tp-layer-name') => {
      await evalJs(`document.querySelectorAll('[data-test-row]').forEach(e => e.removeAttribute('data-test-row'))`);
      assert(await evalJs(rowByText(re)), 'row ' + re + ' not found');
      await clickEl(sub, { within: '[data-test-row]' });
    };
    // What the Active Toolpath panel SHOWS vs the one source of truth.
    const view = () => evalJs(`(async () => {
      const { state } = await import('/apps/penplotter/src/state.js');
      const sel = document.querySelector('#activeLayerContent select');
      const labels = [...document.querySelectorAll('#activeLayerContent .field label')].map(l => l.textContent.trim().split(' ')[0]);
      const active = state.toolpaths.find(t => t.id === state.activeToolpathId);
      return JSON.stringify({ activeId: state.activeToolpathId, activeName: active && active.name, activeType: active && active.type,
        shownId: sel && sel.value, options: sel ? sel.options.length : 0, count: state.toolpaths.length, labels,
        spacings: state.toolpaths.map(t => t.fill.spacing), names: state.toolpaths.map(t => t.name) });
    })()`).then(JSON.parse);
    const frame = () => send('Page.captureScreenshot', { format: 'png' }); // headless draws frames on demand; the Design selection mirror runs in the RAF

    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([once('Page.loadEventFired'), sleep(8000)]);
    await sleep(1800);
    const root = await send('DOM.getDocument');
    const q = await send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#importSvgFile' });
    await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [svgPath] });
    await sleep(2500);
    // Design: a real click on the circle's edge selects it.
    await clickEl('#tool-select');
    const pt = await evalJs(`(() => { const s = document.getElementById('design-canvas'); const p = new DOMPoint(82, 25).matrixTransform(s.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
    await click(pt.x, pt.y);
    await frame(); await sleep(300); await frame();
    await clickEl('.stage-btn[data-stage="toolpath"]'); await sleep(700);

    // 1. + Fill from the selection -> the panel shows the NEW fill, and editing Spacing changes THAT toolpath only
    const v0 = await view();
    await clickEl('#addFillTp'); await sleep(500);
    const v1 = await view();
    console.log('+ Fill   : active', v1.activeName, '| panel shows', v1.shownId === v1.activeId ? 'the active one' : 'ANOTHER toolpath', '| labels', v1.labels.join(','));
    assert.strictEqual(v1.count, v0.count + 1, 'a fill toolpath was created from the selection');
    assert.strictEqual(v1.activeType, 'fill', 'the new fill is active');
    assert.strictEqual(v1.shownId, v1.activeId, 'the Active Toolpath panel follows the new active toolpath');
    assert(v1.labels.includes('Pattern'), 'the panel shows the fill pattern controls: ' + v1.labels);
    await evalJs(`(() => { const f = [...document.querySelectorAll('#activeLayerContent .field')].find(f => f.textContent.includes('Spacing')); f.querySelector('input').setAttribute('data-test-spacing', '1'); })()`);
    await clickEl('[data-test-spacing]');
    await key('a', 'KeyA', 65, 2);
    await send('Input.insertText', { text: '3.5' }); await sleep(200);
    await key('Tab', 'Tab', 9);
    const v2 = await view();
    const activeIdx = v2.names.indexOf(v2.activeName);
    console.log('spacing  :', JSON.stringify(v0.spacings), '->', JSON.stringify(v2.spacings), '(active is #' + activeIdx + ')');
    assert.strictEqual(v2.spacings[activeIdx], 3.5, 'the new fill got spacing 3.5');
    v2.spacings.forEach((s, i) => { if (i !== activeIdx) assert.strictEqual(s, v1.spacings[i], 'toolpath #' + i + ' is untouched'); });
    assert.strictEqual(v2.shownId, v2.activeId, 'typing into the panel does not swap the shown toolpath');

    // 2. select another row -> the panel follows
    await clickRow(/Outline/i);
    const v3 = await view();
    console.log('row click: active', v3.activeName, '| panel shows', v3.shownId === v3.activeId ? 'the active one' : 'ANOTHER', '| labels', v3.labels.join(','));
    assert.strictEqual(v3.activeType, 'outline', 'the outline row is active');
    assert.strictEqual(v3.shownId, v3.activeId, 'the panel follows a row selection');
    assert(v3.labels.includes('Passes'), 'outline controls shown');

    // 3. delete the ACTIVE toolpath -> the panel shows the new active one
    const before3 = await view();
    await clickEl('.del', { within: '#toolpathLayers .tp-layer-row.active' });
    await sleep(400);
    const v4 = await view();
    console.log('delete   : toolpaths', before3.count, '->', v4.count, '| active', v4.activeName, '| panel shows', v4.shownId === v4.activeId ? 'the active one' : 'ANOTHER', '| options', v4.options);
    assert.strictEqual(v4.count, before3.count - 1, 'the active toolpath was deleted');
    assert.strictEqual(v4.shownId, v4.activeId, 'the panel follows the new active toolpath after a delete');
    assert.strictEqual(v4.options, v4.count, 'the panel lists exactly the remaining toolpaths');

    // 4. undo / redo -> the panel matches the state
    await clickEl('#addOutlineTp'); await sleep(500);
    await key('Escape', 'Escape', 27);                    // leave target-editing (a bare + Outline with a selection-less click enters it)
    const v5 = await view();
    assert.strictEqual(v5.activeId, null, 'Esc with nothing in flight deselects and clears the active toolpath');
    assert.strictEqual(v5.shownId, '', 'no active toolpath: the panel shows "none" (it does not edit the first toolpath)');
    assert(v5.options === v5.count + 1, 'the dropdown has the blank entry plus every toolpath');
    await clickRow(/outline/i);                          // pick a toolpath again so undo has an active one to follow
    const v5b = await view();
    assert.strictEqual(v5b.shownId, v5b.activeId, 'a row click after "none" shows that toolpath');
    await click(5, 5);                                   // real click off any input, so the history keys apply
    await key('z', 'KeyZ', 90, 2);
    const v6 = await view();
    console.log('undo     : toolpaths', v5.count, '->', v6.count, '| active', v6.activeName, '| panel shows', v6.shownId === v6.activeId ? 'the active one' : 'ANOTHER', '| options', v6.options);
    assert(v6.count < v5.count, 'undo removed the toolpath');
    assert.strictEqual(v6.shownId, v6.activeId, 'the panel matches the state after undo');
    assert.strictEqual(v6.options, v6.count, 'the panel lists exactly the toolpaths after undo');
    await key('y', 'KeyY', 89, 2);
    const v7 = await view();
    assert.strictEqual(v7.count, v5.count, 'redo brought it back');
    assert.strictEqual(v7.shownId, v7.activeId, 'the panel matches the state after redo');
    assert.strictEqual(v7.options, v7.count, 'the panel lists exactly the toolpaths after redo');
    console.log('penplotter-active-panel: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); fs.rmSync(userDir + '-files', { recursive: true, force: true }); } catch (_) {}
  }
})();
