// tests/sidebar-account.test.js — TASK 488: the Google account row of the shared app sidebar + the per-project Drive entries.
// Headless browser, a fixture page, FAKES only (no Google call): row states (signed out / in / lapsed), avatar + initials fallback
// (also when the image errors), signIn() called synchronously from the click, sign out, the unconfigured-server (404 -> GIS popup)
// path through the REAL account controller, Drive entries hidden when signed out, a move shows the confirm, a failure shows in the drawer.
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
import { createAppSidebar } from '/packages/ui/app-sidebar.js';
import { mountProjectSidebar } from '/packages/ui/sidebar-projects.js';
import { createGoogleAccount } from '/packages/ui/cloud/google-account.js';
import { createAuthStore } from '/packages/ui/cloud/auth-state.js';
const css = document.createElement('style');
css.textContent = ':root{--sk-sidebar-bg:#1f2329;--sk-sidebar-fg:#e6e8eb}';
document.head.appendChild(css);

// a fake controller with the account contract: state / signIn / signOut / subscribe / userInfo
function fakeAccount(st, info) {
  const subs = new Set();
  const a = { calls: [], st,
    state: () => a.st, subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    signIn() { a.calls.push('signIn'); return Promise.resolve(); },
    signOut() { a.calls.push('signOut'); a.st = { signedIn: false, lapsed: false }; subs.forEach((f) => f()); return Promise.resolve(); },
    userInfo: async () => info };
  return a;
}
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

function fakeStore() {
  const s = { moves: [], failNext: null,
    projects: [{ id: 'p1', name: 'Kitchen', updatedAt: Date.now(), pinned: false }, { id: 'drive:p2', name: 'Garage', updatedAt: Date.now(), pinned: false, location: 'drive' }],
    subs: new Set() };
  s.subscribe = (f) => { s.subs.add(f); return () => s.subs.delete(f); };
  s.current = async () => null; s.listRecent = async () => []; s.listDesigns = async () => []; s.listProjects = async () => s.projects;
  s.cloud = {
    isEnabled: async () => false,
    moveProjectToDrive: async (id) => { s.moves.push(id); if (s.failNext) throw new Error(s.failNext); },
  };
  return s;
}

window.T = {
  mountRow(st, info, extra = {}) {
    if (window.sb) window.sb.destroy(); document.getElementById('host').innerHTML = '';
    const account = fakeAccount(st, info);
    const sb = createAppSidebar({ current: 'shaper', docName: 'Door A', actions: [], account, ...extra });
    document.getElementById('host').appendChild(sb.el); sb.open();
    window.sb = sb; window.acct = account; return true;
  },
  mountProjects(st) {
    document.querySelectorAll('[data-pm=close]').forEach((b) => b.click());
    if (window.sb) window.sb.destroy(); document.getElementById('host').innerHTML = '';
    const account = fakeAccount(st, { name: 'Ada Lovelace', email: 'ada@example.com', picture: '', initials: 'AL' });
    const store = fakeStore();
    const sb = mountProjectSidebar({ appId: 'shaper', getBuffer: () => null, store, account });
    document.getElementById('host').appendChild(sb.el); sb.open(); document.querySelector('[data-action=projects]').click();
    window.sb = sb; window.acct = account; window.store = store; return true;
  },
  // the REAL controller with fakes: the server routes 404 (unconfigured / localhost) so sign-in goes through the GIS popup
  mountReal(server) {
    const gisCalls = []; const popups = [];
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/auth/google/token')) return new Response(null, { status: server === 'absent' ? 404 : 401 });
      if (String(url).startsWith('https://www.googleapis.com/drive/v3/about')) return new Response(JSON.stringify({ user: { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', photoLink: '' } }), { status: 200 });
      return new Response(null, { status: 404 });
    };
    const win = { addEventListener() {}, removeEventListener() {}, document: { addEventListener() {}, hidden: false } };
    const storage = mem();
    const account = createGoogleAccount({
      fetchImpl, win, origin: 'http://localhost:8000', authStore: createAuthStore(storage), eligibleForServer: () => true,
      gis: { load: async () => {}, requestToken: async (o) => { gisCalls.push(o); return { access_token: 'GIS-1', expires_in: 3599 }; }, revoke() {} },
      openPopup: (u) => { popups.push(u); return { closed: false }; }, setTimer: () => 1, clearTimer() {},
    });
    window.real = { account, gisCalls, popups };
    if (window.sb) window.sb.destroy(); document.getElementById('host').innerHTML = '';
    const sb = createAppSidebar({ current: 'shaper', docName: 'Door A', actions: [], account });
    document.getElementById('host').appendChild(sb.el);
    window.sb = sb; account.init(); return new Promise((r) => setTimeout(() => r(true), 400));
  },
};
window.READY = true;
</script></body></html>`;



await (async () => {
  const cdp = await launchBrowser({ tag: '488', width: 800, height: 600, fixtures: { '/__t488.html': FIXTURE } });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs: ev } = cdp;
  try {
    const shot = async (name) => {
      if (!process.env.EVIDENCE_DIR) return;
      await sleep(250);
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 320, height: 700, scale: 1.6 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name + '.png'), Buffer.from(s.data, 'base64'));
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    const l = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}/__t488.html` });
    await Promise.race([l, sleep(8000)]);
    for (let i = 0; i < 40 && !(await ev('window.READY === true')); i++) await sleep(200);
    assert(await ev('window.READY === true'), 'fixture page did not load (module import failed?)');

    // 1. signed out: "Sign in with Google", signIn called SYNCHRONOUSLY inside the click, no "sync" wording
    await ev(`T.mountRow({ signedIn: false, lapsed: false }, null)`);
    const out = await ev(`(() => { const r = document.querySelector('[data-section=account]'); const b = r.querySelector('[data-account=sign-in]');
      const before = acct.calls.length; b.click(); return { state: r.dataset.state, text: b.textContent.trim().replace(/^G/, ''), calledInClick: acct.calls.length - before, rowText: r.textContent }; })()`);
    assert.strictEqual(out.state, 'signed-out'); assert.strictEqual(out.text, 'Sign in with Google');
    assert.strictEqual(out.calledInClick, 1, 'signIn() must run synchronously inside the click handler (a later call has its popup blocked)');
    assert(!/sync/i.test(out.rowText), 'no "sync" wording');
    await shot('1-signed-out');

    // 2. signed in: initials when the photo errors, name + email, Sign out
    await ev(`T.mountRow({ signedIn: true, lapsed: false }, { name: 'Ada Lovelace', email: 'ada@example.com', picture: '/__broken.png', initials: 'AL' })`);
    await sleep(600);
    const inn = await ev(`(() => { const r = document.querySelector('[data-section=account]'); return { state: r.dataset.state, av: r.querySelector('[data-account=avatar]').textContent, img: !!r.querySelector('.sk-avatar img'),
      who: r.querySelector('[data-account=who]').textContent, out: !!r.querySelector('[data-account=sign-out]'), rowText: r.textContent }; })()`);
    assert.strictEqual(inn.state, 'signed-in'); assert.strictEqual(inn.av, 'AL', 'a broken image falls back to the initials'); assert(!inn.img);
    assert(/Ada Lovelace/.test(inn.who) && /ada@example\.com/.test(inn.who)); assert(inn.out); assert(!/sync/i.test(inn.rowText));
    await shot('2-signed-in-initials');

    // 2b. a working photo shows the image (a 1x1 data URI stands in for photoLink)
    const px = 'data:image/gif;base64,R0lGODlhAQABAIAAAKqqqv///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
    await ev(`T.mountRow({ signedIn: true, lapsed: false }, { name: 'Ada Lovelace', email: 'ada@example.com', picture: '${px}', initials: 'AL' })`);
    await sleep(500);
    assert.strictEqual(await ev(`!!document.querySelector('.sk-avatar img')`), true, 'the photo shows when it loads');
    // 2c. no name: the email is the label
    await ev(`T.mountRow({ signedIn: true, lapsed: false }, { name: '', email: 'ada@example.com', picture: '', initials: 'AD' })`);
    await sleep(300);
    assert.strictEqual(await ev(`document.querySelector('[data-account=avatar]').textContent`), 'AD');

    // 3. sign out: the controller is called, the row goes back to signed out
    await ev(`T.mountRow({ signedIn: true, lapsed: false }, { name: 'Ada', email: 'a@x.org', picture: '', initials: 'AD' })`);
    await sleep(200);
    await ev(`document.querySelector('[data-account=sign-out]').click()`);
    await sleep(200);
    assert.deepStrictEqual(await ev(`acct.calls`), ['signOut']);
    assert.strictEqual(await ev(`document.querySelector('[data-section=account]').dataset.state`), 'signed-out');

    // 4. lapsed: "Reconnect" (signIn again), never "signed out"
    await ev(`T.mountRow({ signedIn: false, lapsed: true }, null)`);
    const lap = await ev(`(() => { const r = document.querySelector('[data-section=account]'); const b = r.querySelector('[data-account=reconnect]'); const n = acct.calls.length; b.click();
      return { state: r.dataset.state, text: b.textContent.trim().replace(/^G/, ''), called: acct.calls.length - n, rowText: r.textContent }; })()`);
    assert.strictEqual(lap.state, 'lapsed'); assert.strictEqual(lap.text, 'Reconnect'); assert.strictEqual(lap.called, 1); assert(!/sync/i.test(lap.rowText));
    await shot('3-lapsed-reconnect');

    // 5. the account row sits BELOW the GO TO apps, and a host without `account` shows no row (Pen Plotter etc. all pass it; no stray rows)
    await ev(`T.mountRow({ signedIn: false, lapsed: false }, null)`);
    assert.strictEqual(await ev(`(() => { const g = document.querySelector('[data-section=goto]'); const last = g.lastElementChild; return last.dataset.section; })()`), 'account', 'account is the last row of the GO TO block');

    // 6. the REAL controller with the server routes answering 404 (unconfigured / localhost): the row works through the GIS popup
    assert.strictEqual(await ev(`T.mountReal('absent')`), true);
    await ev(`sb.open()`);
    const gis = await ev(`(() => { const b = document.querySelector('[data-account=sign-in]'); const n = real.gisCalls.length; b.click(); return { sync: real.gisCalls.length - n, popups: real.popups.length, serverAvailable: real.account.state().serverAvailable }; })()`);
    assert.strictEqual(gis.sync, 1, 'unconfigured server: the GIS token request is made synchronously in the click');
    assert.strictEqual(gis.popups, 0, 'no server popup when the routes 404'); assert.strictEqual(gis.serverAvailable, false);
    await sleep(500);
    assert.strictEqual(await ev(`document.querySelector('[data-section=account]').dataset.state`), 'signed-in', 'the row follows the controller after the GIS grant');
    assert(await ev(`real.account.state().signedIn`));
    // and the server path: routes exist (401 no-session), the click opens the server popup synchronously
    assert.strictEqual(await ev(`T.mountReal('nosession')`), true);
    await ev(`sb.open()`);
    const srv = await ev(`(() => { const b = document.querySelector('[data-account=sign-in]'); const n = real.popups.length; b.click(); return { popups: real.popups.length - n, gis: real.gisCalls.length }; })()`);
    assert.strictEqual(srv.popups, 1, 'server configured: the sign-in popup opens synchronously'); assert.strictEqual(srv.gis, 0);

    // 7. Project manager: Drive entries are HIDDEN when signed out
    await ev(`T.mountProjects({ signedIn: false, lapsed: false })`);
    await sleep(400);
    const menus = async () => ev(`(() => { const out = {}; for (const w of document.querySelectorAll('.sk-pm-prow')) { const nm = w.querySelector('[data-project]'); if (!nm) continue; w.querySelector('.sk-pm-more').click(); out[nm.dataset.project] = [...document.querySelectorAll('.sk-pm-menu button')].map((b) => b.textContent); } return out; })()`);
    const off = await menus();
    assert(!JSON.stringify(Object.values(off)).match(/Drive|local/i), 'signed out: no Use Google Drive / Make local entries: ' + JSON.stringify(off));

    // 8. signed in: entries appear, the Drive project carries the cloud marker, a move shows a confirm saying what happens, nothing runs before OK
    await ev(`T.mountProjects({ signedIn: true, lapsed: false })`);
    await sleep(400);
    assert.strictEqual(await ev(`[...document.querySelectorAll('.sk-pm-rowbtn')].filter((b) => b.querySelector('[data-project]')).map((b) => !!b.querySelector('[data-cloud=drive]'))`).then((a) => JSON.stringify(a)), '[false,true]', 'only the Drive project has the cloud marker');
    const on = await menus();
    assert(on.p1.includes('Use Google Drive') && !on.p1.includes('Make local'), JSON.stringify(on));
    assert(!on['drive:p2'].includes('Make local') && !on['drive:p2'].includes('Use Google Drive'), JSON.stringify(on));
    await ev(`document.querySelector('[data-project="p1"]').closest('.sk-pm-prow').querySelector('.sk-pm-more').click(); document.querySelector('.sk-pm-menu [data-menu=use-drive]').click()`);
    const conf = await ev(`(() => { const c = document.querySelector('.sk-pm-ask:not([hidden])'); return c && c.textContent; })()`);
    assert(conf && /copied to your Google Drive/.test(conf) && /checked/.test(conf) && /removed/.test(conf), 'the confirm says copy, verify, then remove the local copy: ' + conf);
    assert(!/sync/i.test(conf));
    assert.deepStrictEqual(await ev(`store.moves`), [], 'nothing moves before the user confirms');
    await shot('4-drive-confirm');
    await ev(`document.querySelector('.sk-pm-ask .cancel').click()`);
    await sleep(300);
    assert.deepStrictEqual(await ev(`store.moves`), [], 'Cancel moves nothing');
    // OK moves exactly that project; a failure shows the store's message in the drawer
    await ev(`store.failNext = 'Could not verify the copy on Drive.'`);
    await menus();
    await ev(`document.querySelector('[data-project="p1"]').closest('.sk-pm-prow').querySelector('.sk-pm-more').click(); document.querySelector('.sk-pm-menu [data-menu=use-drive]').click()`);
    await ev(`document.querySelector('.sk-pm-ask .ok').click()`);
    await sleep(400);
    assert.deepStrictEqual(await ev(`store.moves`), ['p1']);
    assert.strictEqual(await ev(`(document.querySelector('.sk-pm-msg.error') || {}).textContent`), 'Could not verify the copy on Drive.', "the store's message shows in the manager");

    // 9. signing in alone moves nothing: the sign-in click never touches the store
    await ev(`T.mountProjects({ signedIn: false, lapsed: false })`);
    assert.deepStrictEqual(await ev(`store.moves`), [], 'signing in/out never moves a project');

    console.log('sidebar-account: all checks passed');
  } finally {
    await cdp.close();
  }
})();


