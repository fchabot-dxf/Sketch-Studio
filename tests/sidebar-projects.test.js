// tests/sidebar-projects.test.js — TASK 479: the sidebar wired to the project store (live, real clicks/keys, Shaper). New design keeps the
// old one; inline rename updates the title + recent; Open recent switches the canvas; Projects browse / drill / back / move / pin;
// a non-empty project refuses delete (the store reason shows in the drawer); a refused (newer-version) file changes nothing.
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
  const userDir = path.join(os.tmpdir(), 'sk-test-479-' + process.pid);
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
    // force the <input type=file> fallback path of the browser seam so the real file chooser can be intercepted
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.showOpenFilePicker; delete window.showSaveFilePicker;' });
    const url = `http://127.0.0.1:${port}/apps/shaper/index.html`;
    const nav = async () => { const l = once('Page.loadEventFired'); await send('Page.navigate', { url }); await Promise.race([l, sleep(8000)]); await sleep(1500); };
    const typeText = async (str) => { for (const ch of str) await key(ch, /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : 'Digit' + ch, ch.toUpperCase().charCodeAt(0), 0, ch); };
    const shot = async (name) => { if (!process.env.EVIDENCE_DIR) return; const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 700, height: 800, scale: 1.4 } }); fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64')); };
    const S = '(await import("/packages/ui/project-store.js")).getProjectStore()';
    const recent = () => evalJs(`(async () => JSON.stringify((await ${S}.listRecent({})).map((d) => [d.name, d.projectName])))()`).then(JSON.parse);
    const shapes = () => evalJs(`window.__designController.state.shapes.length`);
    const title = () => evalJs(`document.title`);
    const openSb = async () => { await clickEl('.sk-sidebar-btn'); await sleep(350); };
    const seed = (n) => evalJs(`(() => { const st = window.__designController.state; for (const k of [...st.joints.keys()]) st.joints.delete(k); st.shapes.length = 0; for (let i = 0; i < ${n}; i++) { st.joints.set('p' + i, { x: i * 10, y: 0 }); st.joints.set('q' + i, { x: i * 10 + 5, y: 5 }); st.shapes.push({ id: 's' + i, type: 'line', joints: ['p' + i, 'q' + i] }); } })()`);

    await nav();
    await clickEl('[data-mode="design"]'); await sleep(1200);
    await seed(4); await sleep(3200); // autosave -> the design "Untitled"
    await openSb();
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-doc').textContent`), 'Untitled', 'the drawer shows the current design name');
    assert.strictEqual(await title(), 'Untitled — Shaper', 'the tab title follows the design name through the registry');
    await shot('479-main-view');

    // ── rename inline: click the name, type, Enter -> title + recent update ──
    await clickEl('.sk-sidebar-doc'); await sleep(150);
    await key('a', 'KeyA', 65, 2); await typeText('Door'); await key(' ', 'Space', 32, 0, ' '); await typeText('A'); await key('Enter', 'Enter', 13); await sleep(500);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-doc').textContent`), 'Door A');
    assert.strictEqual(await title(), 'Door A — Shaper', 'rename updates the title');
    assert.deepStrictEqual((await recent()).map((r) => r[0]), ['Door A'], 'and the recent list');

    // ── New design KEEPS the old one ──
    await clickEl('[data-action="new-design"]'); await sleep(700);
    assert.strictEqual(await shapes(), 0, 'New design starts empty');
    await openSb(); // the drawer closed after the action: reopen to read the refreshed name
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-doc').textContent`), 'Untitled');
    assert.deepStrictEqual((await recent()).map((r) => r[0]).sort(), ['Door A', 'Untitled'], 'the previous design is kept in recent');
    await clickEl('.sk-sidebar-doc'); await sleep(150);
    await typeText('DoorB'); await key('Enter', 'Enter', 13); await sleep(400);
    await seed(2); await sleep(3200); // some content for B
    await key('Escape', 'Escape', 27); await sleep(200);

    // ── Open recent switches the canvas ──
    await openSb();
    await clickEl('[data-action="open-recent"]'); await sleep(500);
    const rows = await evalJs(`[...document.querySelectorAll('.sk-sidebar-view .sk-recent')].map((r) => r.querySelector('.sk-row-name').textContent + '|' + r.querySelector('.sk-row-sub').textContent)`);
    assert.ok(rows[0].startsWith('DoorB|My Designs · Shaper · '), 'newest first, with the project name + relative time: ' + rows[0]);
    assert.ok(/just now|min ago/.test(rows[0]), 'relative time shown');
    assert.ok(rows[1].startsWith('Door A|'), 'then the older one');
    await shot('479-recent-view');
    await clickEl('.sk-sidebar-view .sk-recent[data-design]:nth-of-type(2)'); await sleep(900);
    assert.strictEqual(await shapes(), 4, 'opening Door A switches the canvas content');
    assert.strictEqual(await title(), 'Door A — Shaper', 'and the title follows');
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), false, 'the drawer closes after an open');

    // ── Projects (the project manager modal, TASK 547): new project, pin, browse, move, delete refusal ──
    await openSb(); await clickEl('[data-action="projects"]'); await sleep(600);
    await clickEl('[data-pm="new-project"]'); await sleep(150);
    await key('a', 'KeyA', 65, 2); await typeText('Kitchen'); await key('Enter', 'Enter', 13); await sleep(600);
    const names = () => evalJs(`[...document.querySelectorAll('.sk-pm-side [data-project]')].map((n) => n.textContent)`);
    assert.ok((await names()).includes('Kitchen') && (await names()).includes('My Designs'), 'the new project is listed');
    const rowOf = (name) => `[...document.querySelectorAll('.sk-pm-side .sk-pm-prow')].find((w) => w.textContent.includes('${name}'))`;
    // pin Kitchen via its row menu: pinned goes first
    await evalJs(`${rowOf('Kitchen')}.querySelector('.sk-pm-more').click()`); await sleep(150);
    await clickEl('.sk-pm-menu [data-menu="pin"]'); await sleep(600);
    assert.strictEqual((await names())[0], 'Kitchen', 'a pinned project is listed first');
    await shot('479-projects-view');
    // My Designs -> its designs; open the menu of DoorB and move it to Kitchen
    await evalJs(`${rowOf('My Designs')}.querySelector('.sk-pm-rowbtn').click()`); await sleep(500);
    const designNames = () => evalJs(`[...document.querySelectorAll('.sk-pm-tile [data-name]')].map((n) => n.textContent)`);
    assert.deepStrictEqual((await designNames()).sort(), ['Door A', 'DoorB'], 'a project shows its designs');
    await shot('479-project-designs');
    await evalJs(`[...document.querySelectorAll('.sk-pm-tile')].find((x) => x.textContent.includes('DoorB')).querySelector('.sk-pm-more').click()`); await sleep(150);
    await clickEl('.sk-pm-menu [data-menu="move"]'); await sleep(200);
    await evalJs(`[...document.querySelectorAll('.sk-pm-ask [data-choice]')].find((x) => x.textContent === 'Kitchen').click()`); await sleep(700);
    assert.deepStrictEqual(await designNames(), ['Door A'], 'DoorB left My Designs');
    await evalJs(`${rowOf('Kitchen')}.querySelector('.sk-pm-rowbtn').click()`); await sleep(500);
    assert.deepStrictEqual(await designNames(), ['DoorB'], 'and is in Kitchen');
    // delete refusal: Kitchen still holds a design -> the store's reason shows in the manager, the project stays
    await evalJs(`${rowOf('Kitchen')}.querySelector('.sk-pm-more').click()`); await sleep(150);
    await clickEl('.sk-pm-menu [data-menu="delete"]'); await sleep(200);
    await clickEl('.sk-pm-ask .ok'); await sleep(600);
    const msg = await evalJs(`(document.querySelector('.sk-pm-msg.error') || {}).textContent || ''`);
    assert.ok(/still holds 1 design/.test(msg), 'delete of a non-empty project shows the store reason: ' + msg);
    assert.ok((await names()).includes('Kitchen'), 'and the project is still there');
    await shot('479-delete-refused');

    // ── a refused file (newer version) shows its message and changes nothing ──
    await key('Escape', 'Escape', 27); await sleep(200);
    const before = JSON.stringify({ r: await recent(), s: await shapes(), t: await title() });
    const bad = path.join(os.tmpdir(), 'sk-479-newer.sketch.json');
    fs.writeFileSync(bad, JSON.stringify({ format: 'sketch-studio-project', version: 1, app: 'shaper', name: 'Future', document: { version: 99, geometry: { joints: [], shapes: [], constraints: [] }, hosts: {} } }));
    await send('DOM.enable');
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser = once('Page.fileChooserOpened');
    await openSb();
    await clickEl('[data-action="open-file"]');
    const fc = await Promise.race([chooser, sleep(4000).then(() => null)]);
    assert.ok(fc, 'the file chooser opened');
    await send('DOM.setFileInputFiles', { files: [bad], backendNodeId: fc.backendNodeId }); await sleep(900);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`), true, 'the drawer stays open on a refusal');
    const refused = await evalJs(`(document.querySelector('.sk-sidebar-msg.error') || {}).textContent || ''`);
    assert.ok(/newer version/i.test(refused), 'the refusal message is shown in the drawer: ' + refused);
    assert.strictEqual(JSON.stringify({ r: await recent(), s: await shapes(), t: await title() }), before, 'nothing changed (no new design, canvas and title untouched)');
    await shot('479-file-refused');
    console.log('sidebar-projects: ok');
    ws.close();
  } finally {
    await closeBrowser(proc, dbgPort);
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
