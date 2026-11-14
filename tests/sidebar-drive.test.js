// tests/sidebar-drive.test.js — TASK 506: the Drive-first parts of the shared sidebar, in a headless browser with FAKES only (no Google call):
//   the status line under the document name (saved to Drive / saving / failed / on this device), the "Save to Google Drive" action (hidden
//   signed out; success shows "Saved to Google Drive" + an "Open in Drive" link; failure shows the exact reason), the "Save to Google Drive by
//   default" toggle (persisted in SettingsManager) and the "Check Google Drive connection" steps (real Drive adapter over a fake Drive,
//   including a failing step), and the note that Drive projects are hidden while signed out.
// EVIDENCE_DIR=<dir> also writes a screenshot of each state.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './helpers/cdp-browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


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
  checkConnection: (onStep) => adapter.checkConnection(onStep),
  moveProjectToDrive: async () => {},
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
};
window.READY = true;
</script></body></html>`;



await (async () => {
  const cdp = await launchBrowser({ tag: '506', width: 800, height: 600, fixtures: { '/__t506.html': FIXTURE } });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs: ev } = cdp;
  try {
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

    // 1. signed out on legacy local design: status shows "Saved on this device · Move to Google Drive", NO connection check, ONE sign-in door
    await ev(`T.mount(false)`);
    assert.strictEqual(await text('[data-section=status]'), 'Saved on this device · Move to Google Drive');
    assert.strictEqual(await has('[data-action=save-drive]'), false, 'save-drive entry removed');
    assert.strictEqual(await has('[data-account=drive-default]'), false, 'default toggle removed');
    assert.strictEqual(await has('[data-account=check-drive]'), false, 'signed out: no connection check');
    assert.strictEqual(await ev(`document.querySelectorAll('[data-account=sign-in]').length`), 1, 'exactly ONE sign-in door');
    await shot('1-signed-out');

    // 2. signed in: still no save-drive or default toggle; check-drive is present
    await ev(`T.mount(true)`); await sleep(300);
    assert.strictEqual(await has('[data-action=save-drive]'), false, 'no copy-snapshot save-drive action');
    assert.strictEqual(await has('[data-account=drive-default]'), false, 'no default toggle');
    assert.strictEqual(await has('[data-account=check-drive]'), true, 'signed in: connection check is shown');

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
    assert.strictEqual(await text('[data-section=status]'), 'Not saved to Google Drive: Google could not be reached. Kept on this device.');
    await ev(`T.setStatus({ where: 'drive', state: 'saved', at: null, reason: null, notice: 'Another device changed this design. Your unsaved changes were kept as "Door (conflicted copy 2026-11-11 12-00)".' })`);
    assert.strictEqual(await text('[data-section=status]'), 'Another device changed this design. Your unsaved changes were kept as "Door (conflicted copy 2026-11-11 12-00)".', 'a conflicted copy is announced');
    assert.strictEqual(await has('[data-section=status].error'), true);
    await ev(`T.setStatus({ where: 'device', state: 'saved', at: null, reason: null })`);
    assert.strictEqual(await text('[data-section=status]'), 'Saved on this device · Move to Google Drive');
    assert.strictEqual(await has('[data-action=move-to-drive]'), true, 'inline Move to Google Drive action offered for local design');

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

    // 6. the project manager says why Drive projects are missing while signed out, and nothing else changes
    await ev(`document.querySelectorAll('[data-pm=close]').forEach((b) => b.click()); T.store.enabled = true; T.mount(false); document.querySelector('[data-action=projects]').click()`); await sleep(500);
    assert(/hidden while you are signed out/.test(await text('.sk-pm-side .sk-pm-note')), 'the note says why');
    await ev(`document.querySelectorAll('[data-pm=close]').forEach((b) => b.click()); T.mount(true); document.querySelector('[data-action=projects]').click()`); await sleep(500);
    assert.strictEqual(await has('.sk-pm-side .sk-pm-note'), false, 'signed in: no such note');
    await shot('8-projects-view-signed-in');
    console.log('sidebar-drive: all checks passed');
  } finally {
    await cdp.close();
  }
})();
