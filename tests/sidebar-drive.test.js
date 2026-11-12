// tests/sidebar-drive.test.js — TASK 506: the Drive-first parts of the shared sidebar, in a headless browser with FAKES only (no Google call):
//   the status line under the document name (saved to Drive / saving / failed / on this device), the "Save to Google Drive" action (hidden
//   signed out; success shows "Saved to Google Drive" + an "Open in Drive" link; failure shows the exact reason), the "Save to Google Drive by
//   default" toggle (persisted in SettingsManager) and the "Check Google Drive connection" steps (real Drive adapter over a fake Drive,
//   including a failing step), and the note that Drive projects are hidden while signed out.
// EVIDENCE_DIR=<dir> also writes a screenshot of each state.
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
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const cmd of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { const p = execSync(`command -v ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch (_) {}
  }
  return null;
}

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">{"imports":{"#core/":"/packages/core/","#ui/":"/packages/ui/"}}</script></head>
<body style="background:#2b2f36;font:14px system-ui"><div id="host" style="padding:8px"></div>
<script type="module">
import { mountProjectSidebar } from '/packages/ui/sidebar-projects.js';
import { createDriveAdapter } from '/packages/ui/cloud/drive-adapter.js';
import { createMemoryAdapter } from '/packages/ui/project-store.js';
import { createFakeDrive } from '/tests/harness/fake-drive.js';
import SettingsManager from '/packages/core/settings-manager.js';
const css = document.createElement('style');
css.textContent = ':root{--sk-sidebar-bg:#1f2329;--sk-sidebar-fg:#e6e8eb}';
document.head.appendChild(css);

function fakeAccount(st) {
  const subs = new Set();
  const a = { st, state: () => a.st, subscribe: (f) => { subs.add(f); return () => subs.delete(f); }, signIn: async () => {}, signOut: async () => {},
    userInfo: async () => ({ name: 'Ada Lovelace', email: 'ada@example.com', picture: '', initials: 'AL' }),
    set(next) { a.st = next; subs.forEach((f) => f()); } };
  return a;
}
const drive = createFakeDrive();
const adapter = createDriveAdapter({ account: { authedFetch: (u, o = {}) => drive.fetch(u, { ...o, headers: { Authorization: 'Bearer ' + drive.token, ...(o.headers || {}) } }) }, meta: createMemoryAdapter() });
const s = { st: { where: 'device', state: 'saved', at: null, reason: null }, enabled: false, saves: [], saveError: null, subs: new Set() };
s.subscribe = (f) => { s.subs.add(f); return () => s.subs.delete(f); };
s.fire = () => s.subs.forEach((f) => f());
s.current = async () => ({ id: 'd1', name: 'Door A' }); s.listRecent = async () => []; s.listDesigns = async () => []; s.listProjects = async () => [];
s.status = () => s.st;
s.cloud = {
  isEnabled: async () => s.enabled,
  saveToDrive: async (id) => { s.saves.push(id); if (s.saveError) throw new Error(s.saveError); return { fileId: 'FILE123' }; },
  checkConnection: (onStep) => adapter.checkConnection(onStep),
  moveProjectToDrive: async () => {}, makeProjectLocal: async () => {},
};
window.T = {
  drive, store: s,
  mount(signedIn) {
    if (window.sb) window.sb.destroy(); document.getElementById('host').innerHTML = '';
    const account = fakeAccount({ signedIn, lapsed: false });
    const flushes = []; window.flushes = flushes;
    const sb = mountProjectSidebar({ appId: 'shaper', getBuffer: () => ({ flush: async () => { flushes.push(1); }, designId: () => 'd1' }), store: s, account });
    document.getElementById('host').appendChild(sb.el); sb.open();
    window.sb = sb; window.acct = account; return true;
  },
  setStatus(st) { s.st = st; s.fire(); },
  setting: () => SettingsManager.get('DRIVE_DEFAULT'),
  stored: () => localStorage.getItem('sketch-studio-settings'),
};
window.READY = true;
</script></body></html>`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = (req.url || '/').split('?')[0];
        if (url === '/__t506.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE); return; }
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
  for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/version`); if (r.ok) return true; } catch (_) {} await sleep(200); }
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
  try { if (process.platform === 'win32' && proc.pid) execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); else proc.kill(); } catch (_) {}
}

await (async () => {
  const browser = findBrowser();
  if (!browser) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { server, port } = await startServer();
  const dbgPort = 9910 + Math.floor((Date.now() % 400));
  const userDir = path.join(os.tmpdir(), 'sk-test-506-' + process.pid);
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
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
    await new Promise((res) => ws.addEventListener('open', res));
    await send('Page.enable');
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('page: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails));
      return r.result.value;
    };
    const shot = async (name) => {
      if (!process.env.EVIDENCE_DIR) return;
      await sleep(250);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 300, height: 900, scale: 1.6 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
    const l = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}/__t506.html` });
    await Promise.race([l, sleep(8000)]);
    for (let i = 0; i < 40 && !(await ev('window.READY === true')); i++) await sleep(200);
    assert(await ev('window.READY === true'), 'fixture page did not load (module import failed?)');
    const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.trim() : null; })()`);
    const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);

    // 1. signed out: the status says where it lives, NO Drive action, NO Drive rows, the account row is the one door
    await ev(`T.mount(false)`);
    assert.strictEqual(await text('[data-section=status]'), 'Saved on this device');
    assert.strictEqual(await has('[data-action=save-drive]'), false, 'signed out: "Save to Google Drive" is hidden');
    assert.strictEqual(await has('[data-account=drive-default]'), false, 'signed out: no default toggle');
    assert.strictEqual(await has('[data-account=check-drive]'), false, 'signed out: no connection check');
    assert.strictEqual(await ev(`document.querySelectorAll('[data-account=sign-in]').length`), 1, 'exactly ONE sign-in door');
    await shot('1-signed-out');

    // 2. signed in: the action sits before Open from file, the toggle is ON by default and persists when changed
    await ev(`T.mount(true)`); await sleep(300);
    assert.strictEqual(await has('[data-action=save-drive]'), true);
    const order = await ev(`[...document.querySelectorAll('[data-section=actions] [data-action]')].map((b) => b.dataset.action).filter((a) => a === 'save-drive' || a === 'open-file')`);
    assert.deepStrictEqual(order, ['save-drive', 'open-file'], 'Save to file is no longer in the menu');
    assert.strictEqual(await text('[data-action=save-drive]'), 'Save to Google Drive');
    assert.strictEqual(await ev(`document.querySelector('[data-account=drive-default]').checked`), true, 'default ON');
    assert.strictEqual(await text('[data-account=drive-default-row]'), 'Save to Google Drive by default');
    assert.strictEqual(await ev(`T.setting()`), true);
    await ev(`document.querySelector('[data-account=drive-default]').click()`);
    assert.strictEqual(await ev(`T.setting()`), false, 'the toggle changes the declared setting');
    assert(/"DRIVE_DEFAULT":false/.test(await ev(`T.stored()`)), 'and it is persisted');
    await ev(`T.mount(true)`); await sleep(200);
    assert.strictEqual(await ev(`document.querySelector('[data-account=drive-default]').checked`), false, 'a fresh sidebar shows the persisted choice');
    await ev(`document.querySelector('[data-account=drive-default]').click()`);
    assert.strictEqual(await ev(`T.setting()`), true);

    // 3. the status line: every state, repainted in place when the store changes
    await ev(`T.setStatus({ where: 'drive', state: 'saved', at: Date.now() - 125000, reason: null })`);
    assert.strictEqual(await text('[data-section=status]'), 'Saved to Google Drive, 2 min ago');
    await shot('2-status-saved-to-drive');
    await ev(`T.setStatus({ where: 'drive', state: 'saving', at: null, reason: null })`);
    assert.strictEqual(await text('[data-section=status]'), 'Saving to Google Drive...');
    await shot('3-status-saving');
    await ev(`T.setStatus({ where: 'drive', state: 'failed', at: null, reason: 'Google Drive answered HTTP 500' })`);
    assert.strictEqual(await text('[data-section=status]'), 'Not saved to Google Drive: Google Drive answered HTTP 500. Kept on this device.');
    assert.strictEqual(await has('[data-section=status].error'), true, 'the failure line is styled as an error');
    await shot('4-status-failed');
    await ev(`T.setStatus({ where: 'device', state: 'saved', at: null, reason: 'Google could not be reached' })`);
    assert.strictEqual(await text('[data-section=status]'), 'Not saved to Google Drive: Google could not be reached. Kept on this device.', 'a NEW design that fell back to this device says why');
    await ev(`T.setStatus({ where: 'drive', state: 'saved', at: null, reason: null, notice: 'Another device changed this design. Your unsaved changes were kept as "Door (conflicted copy 2026-11-11 12-00)".' })`);
    assert.strictEqual(await text('[data-section=status]'), 'Another device changed this design. Your unsaved changes were kept as "Door (conflicted copy 2026-11-11 12-00)".', 'a conflicted copy is announced');
    assert.strictEqual(await has('[data-section=status].error'), true);
    await ev(`T.setStatus({ where: 'device', state: 'saved', at: null, reason: null })`);
    assert.strictEqual(await text('[data-section=status]'), 'Saved on this device');

    // 4. Save to Google Drive: flushes the buffer, success = message + "Open in Drive" link (new tab); failure = the exact reason
    await ev(`document.querySelector('[data-action=save-drive]').click()`); await sleep(300);
    assert.deepStrictEqual(await ev(`T.store.saves`), ['d1']);
    assert.strictEqual(await ev(`window.flushes.length`), 1, 'the pending autosave is flushed first');
    const ok = await ev(`(() => { const m = document.querySelector('.sk-sidebar-msg'); const a = m.querySelector('a'); return { cls: m.className, text: m.firstChild.textContent, href: a.href, target: a.target, rel: a.rel, label: a.textContent }; })()`);
    assert.strictEqual(ok.text, 'Saved to Google Drive'); assert(!/error/.test(ok.cls));
    assert.strictEqual(ok.href, 'https://drive.google.com/file/d/FILE123/view'); assert.strictEqual(ok.target, '_blank'); assert(/noopener/.test(ok.rel)); assert.strictEqual(ok.label, 'Open in Drive');
    await shot('5-saved-with-link');
    await ev(`T.store.saveError = 'Drive 403'`);
    await ev(`document.querySelector('[data-action=save-drive]').click()`); await sleep(300);
    const bad = await ev(`(() => { const m = document.querySelector('.sk-sidebar-msg'); return { cls: m.className, text: m.textContent, link: !!m.querySelector('a') }; })()`);
    assert(/error/.test(bad.cls)); assert.strictEqual(bad.text, 'Google Drive answered HTTP 403'); assert.strictEqual(bad.link, false, 'no link on a failure');
    await ev(`T.store.saveError = null`);

    // 5. Check Google Drive connection: the REAL adapter over a fake Drive, every step listed with its result
    await ev(`T.mount(true)`); await sleep(300);
    await ev(`document.querySelector('[data-account=check-drive]').click()`); await sleep(800);
    const steps = await ev(`[...document.querySelectorAll('[data-account=check-result] li')].map((li) => [li.dataset.step, li.dataset.state, li.textContent])`);
    assert.deepStrictEqual(steps.map((s) => s[1]), ['ok', 'ok', 'ok', 'ok', 'ok'], JSON.stringify(steps));
    assert(/Sign-in token is valid.*OK/.test(steps[0][2]) && /Test file deleted/.test(steps[4][2]), JSON.stringify(steps));
    await shot('6-check-ok');
    // a failing step (the test-file write answers 500): its HTTP status is shown and the later steps are marked not run
    await ev(`T.drive.failWrites = 1`);
    await ev(`document.querySelector('[data-account=check-drive]').click()`); await sleep(800);
    const failed = await ev(`[...document.querySelectorAll('[data-account=check-result] li')].map((li) => [li.dataset.state, li.textContent])`);
    assert.deepStrictEqual(failed.map((s) => s[0]), ['ok', 'ok', 'failed', 'skipped', 'skipped'], JSON.stringify(failed));
    assert(/failed, HTTP 500/.test(failed[2][1]), failed[2][1]); assert(/not run/.test(failed[3][1]));
    await shot('7-check-failed');
    // a re-render (the account changed) keeps the shown result
    await ev(`acct.set({ signedIn: true, lapsed: false })`); await sleep(300);
    assert.strictEqual(await ev(`document.querySelectorAll('[data-account=check-result] li').length`), 5, 'the result survives a re-render');

    // 6. the Projects view says why Drive projects are missing while signed out, and nothing else changes
    await ev(`T.store.enabled = true; T.mount(false); sb.showView('projects')`); await sleep(400);
    assert(/hidden while you are signed out/.test(await text('.sk-note')), 'the note says why');
    await ev(`T.mount(true); sb.showView('projects')`); await sleep(400);
    assert.strictEqual(await has('.sk-note'), false, 'signed in: no such note');
    await shot('8-projects-view-signed-in');
    console.log('sidebar-drive: all checks passed');
  } finally {
    await closeBrowser(proc, dbgPort);
    server.close();
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
})();
