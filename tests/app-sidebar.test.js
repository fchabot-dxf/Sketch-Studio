// tests/app-sidebar.test.js — TASK 473: the shared app sidebar in every host. Each host mounts it with ITS OWN actions; GO TO lists the 4
// apps and marks the current one; Esc / outside click close it; focus stays trapped while open; the old app-switcher dropdown is gone.
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
  const userDir = path.join(os.tmpdir(), 'sk-test-473-' + process.pid);
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

    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
    const hosts = [
      { id: 'shaper', path: '/apps/shaper/index.html', actions: ['download', 'new'] },
      { id: 'penplotter', path: '/apps/penplotter/index.html', actions: ['download', 'new'] },
      { id: 'sketchstudio', path: '/apps/sketchstudio/index.html', actions: ['download-svg', 'download-dxf', 'new'] },
      { id: 'trace', path: '/apps/trace/index.html', actions: ['download-svg', 'download-dxf', 'new'] },
    ];
    const key2 = async (k, code, vk, mods = 0) => { await sendRealKey(send, k, code, vk, mods); await sleep(150); };
    for (const host of hosts) {
      const l = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${host.path}` });
      await Promise.race([l, sleep(10000)]);
      await sleep(1800);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-appsw').length`), 0, `${host.id}: the app-switcher dropdown is gone`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-sidebar-btn').length`), 1, `${host.id}: one sidebar button`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host.id}: closed at start`);
      // open with a real click on the header button
      await clickEl('.sk-sidebar-btn'); await sleep(400);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), true, `${host.id}: the button opens the drawer`);
      const acts = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action)`);
      assert.deepStrictEqual(acts, host.actions, `${host.id}: its own actions, no other host's`);
      const goto = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-section="goto"] [data-app]')].map((b) => [b.dataset.app, b.getAttribute('aria-current') === 'true'])`);
      assert.deepStrictEqual(goto.map((g) => g[0]), ['sketchstudio', 'shaper', 'penplotter', 'trace'], `${host.id}: GO TO lists the 4 apps`);
      assert.deepStrictEqual(goto.filter((g) => g[1]).map((g) => g[0]), [host.id], `${host.id}: GO TO marks the current app`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-doc').textContent`), 'Untitled', `${host.id}: the document name is shown`);
      if (host.id === 'trace') assert.strictEqual(await evalJs(`document.querySelector('[data-action="download-svg"]').disabled`), true, 'trace: Download is disabled until there is a trace');
      if (process.env.EVIDENCE_DIR) { const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 700, height: 800, scale: 1.4 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `${host.id}-sidebar-open.png`), Buffer.from(s.data, 'base64')); }
      // focus is trapped: Tab many times, the focus never leaves the drawer
      for (let i = 0; i < 12; i++) await key2('Tab', 'Tab', 9);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').contains(document.activeElement)`), true, `${host.id}: focus stays trapped inside the open drawer`);
      await key2('Tab', 'Tab', 9, 8); // shift+Tab
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').contains(document.activeElement)`), true);
      // New asks first (inline confirm), Cancel returns to the list
      await clickEl('[data-action="new"]'); await sleep(200);
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar .sk-sidebar-confirm')`), true, `${host.id}: New asks before discarding`);
      await clickEl('.sk-sidebar-confirm .cancel'); await sleep(200);
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar [data-action="new"]')`), true);
      // Esc closes
      await key2('Escape', 'Escape', 27);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host.id}: Esc closes`);
      // reopen, click OUTSIDE (the backdrop) closes
      await clickEl('.sk-sidebar-btn'); await sleep(300);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), true);
      await click(1100, 500); await sleep(300);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, `${host.id}: an outside click closes`);
      console.log(`${host.id}: sidebar ok (${acts.join(', ')})`);
    }
    // ── a second VIEW plugs in (the future Projects browser): registered views swap the drawer body, drill down and come back ──
    {
      const l = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/shaper/index.html` });
      await Promise.race([l, sleep(10000)]); await sleep(1500);
      await evalJs(`(async () => {
        const { createAppSidebar } = await import('/packages/ui/app-sidebar.js');
        const sb = createAppSidebar({ current: 'shaper', docName: 'T', actions: [{ id: 'projects', label: 'Projects', onClick: () => {} }],
          views: { projects: { title: 'Projects', render: (box, { go }) => {
            const list = (title, rows, next) => { box.innerHTML = '<div class="lvl" data-lvl="' + title + '"></div>'; for (const r of rows) { const b = document.createElement('button'); b.className = 'sk-sidebar-item row'; b.textContent = r; b.addEventListener('click', () => next(r)); box.appendChild(b); } };
            list('projects', ['Kitchen', 'Shed'], (p) => list('designs of ' + p, [p + ' A', p + ' B'], () => {}));
          } } } });
        document.body.appendChild(sb.el); window.__sb2 = sb; sb.open(); sb.showView('projects');
      })()`);
      await sleep(300);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-view').dataset.view`), 'projects', 'the extra view replaced the main body');
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar [data-section="goto"]')`), false, 'the main list is not shown while the view is');
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-view .lvl').dataset.lvl`), 'projects');
      await clickEl('.sk-sidebar-view .row'); await sleep(200); // drill into a project
      assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-view .lvl').dataset.lvl`), 'designs of Kitchen', 'drills down a level inside the view');
      await clickEl('.sk-sidebar-back'); await sleep(200);
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-sidebar [data-section="goto"]')`), true, 'the back arrow returns to the main view');
    }
    console.log('app-sidebar: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
