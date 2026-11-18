// tests/shaperhub-name-767-live.test.js — TASK 767 in the real Shaper page: every file the Export step produces is named after the design, and a name
// already in the user's ShaperHub "My Files" is asked about. NO real ShaperHub, NO real login (user@example.test / not-a-real-password):
// every request that is not to the test's own local server is BLOCKED (Fetch domain, counted); POST /api/shaper-upload is answered by the ONE
// implementation (packages/core/shaper-cloud.js handleShaperUpload) run in this process against a FAKE Shaper API (tests/shaperhub-fake-api.js).
//  - desktop 1280 x 800, a design named "bromont": Generate Shaper SVG and the drawer's Download save bromont.svg; the Export panel says so; the Sync
//    dialog's file name starts as bromont.svg; Send -> "bromont.svg is already in My Files." with Replace it / Keep both / Cancel (the dialog's own
//    Cancel / Send hidden); Keep both -> "Sent as bromont (2).svg"; Replace it -> "Replaced bromont.svg in My Files" (the blob uploaded BEFORE the
//    old entry is deleted); the question's Cancel sends nothing; an edited name is kept for this design when the dialog opens again; a wrong
//    login shows Shaper's words + "Check the password: your browser may have filled in a saved one.";
//  - phone 390 x 844 (touch): the question's three buttons are 44 px targets inside the screen; Keep both by taps -> "Sent as bromont (3).svg";
//  - Fusion mode (?host=fusion, window.adsk stubbed): after a selection (Body1) the file name is Body1.svg; Send -> "Sent Body1.svg to My Files";
//  - the named design lives in the fake Google Drive of tests/helpers/fake-drive-session.js (it answers inside the page, no request leaves);
//  - the 758 scan after each phase: no storage, cookie, IndexedDB record, markup or console line holds the fake login.
// Screenshots of the dialog in each state to .evidence/767/ (EVIDENCE_DIR overrides).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { createFakeShaperApi, FAKE_LOGIN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/767');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const SECRETS = [FAKE_LOGIN.email, FAKE_LOGIN.password, 'wrong-not-a-real-password'];
const HINT = 'Check the password: your browser may have filled in a saved one.';
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8');
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-767-dl-'));

const t0 = Date.now();
const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ files: ['bromont.svg', 'other.svg'], passLocal: realFetch }); // My Files of the fake account
globalThis.fetch = api.fetch; // this process's requests: local ones go on (the browser's CDP endpoint), Shaper's go to the fake, any other is blocked

const cdp = await launchBrowser({ tag: '767-hub-name', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, ws, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;

// ── the network: only the local server; /api/shaper-upload = handleShaperUpload against the fake Shaper API ──
const uploads = [];   // the bodies the page posted (mode, filename)
const blocked = [];   // every non-local request of the page, failed before it left the browser
const sent = [];      // every other request's url + body (to scan for the login)
const consoleLines = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' '));
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const body = request.postData !== undefined ? request.postData : (request.postDataEntries || []).map((x) => Buffer.from(x.bytes || '', 'base64').toString('utf8')).join('');
  if (!request.url.startsWith(LOCAL)) {
    blocked.push(request.url); sent.push({ url: request.url, body });
    send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    return;
  }
  if (new URL(request.url).pathname === '/api/shaper-upload') {
    const j = JSON.parse(body);
    uploads.push({ mode: j.mode, filename: j.filename });
    handleShaperUpload(body).then(({ status, body: answer }) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(answer)).toString('base64') }));
    return;
  }
  sent.push({ url: request.url, body });
  send('Fetch.continueRequest', { requestId });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await installFakeDriveSession(cdp); // a named design is stored in the (fake) Drive (TASK 506 Drive-first), as for a signed-in user

let phone = false;
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const press = async (x, y) => {
  if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
  else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
  await sleep(200);
};
// a real click / tap on the element's centre, after checking nothing covers it there
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await press(p.x, p.y);
};
const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
const openDrawer = async () => {
  if (await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) return;
  await clickEl(phone ? '.sk-sidebar-handle' : '.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
};
const openStage = async (id) => {
  for (let i = 0; i < 5; i++) {
    if (await activeStage() === id) return;
    if (phone) { await openDrawer(); await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`); }
    else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
    await sleep(350);
  }
  assert.fail('could not open the ' + id + ' stage');
};
const shot = async (name, sel = '#shaper-sync-modal') => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const m = 8;
    const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m); return { x, y, width: Math.min(innerWidth, r.right + m) - x, height: Math.min(innerHeight, r.bottom + m) - y, scale: ${phone ? 1 : 1.5} }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const planSize = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.cutPlanEntries().length)`);
const pickPocket = async () => {
  await clickEl('#prepare-panel .cut-type-trigger');
  await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
  await clickEl('.cut-type-opt[data-id="pocket"]');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => m.cutPlanEntries().length > 0)`, 'a planned cut');
};
// a 120 x 70 rectangle, planned as a Pocket in Prepare
const planRectangle = async (label) => {
  await openStage('design');
  await waitFor('!!(window.__designController && window.__designController.state)', label + ': the design controller');
  await evalJs(`(() => { const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0;
    [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('draw'); })()`);
  await openStage('prepare');
  if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');
  await clickWorld(60, 10);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, label + ': the cut card');
  await pickPocket();
};
const dialogState = () => evalJs(`(() => { const shown = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; };
  return { open: document.getElementById('shaper-sync-modal').open, name: document.getElementById('sync-filename').value,
    status: [...document.getElementById('sync-modal-status').children].map((d) => d.textContent), tone: document.getElementById('sync-modal-status').className,
    question: shown('sync-exists'), actions: shown('sync-actions') }; })()`);
const openSignIn = async (label) => {
  await openStage('review');
  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, label + ': the sign-in dialog opens');
  await sleep(150);
};
const typeInto = async (sel, text) => { await clickEl(sel); await evalJs(`document.querySelector(${JSON.stringify(sel)}).select()`); await send('Input.insertText', { text }); await sleep(80); };
const fillLogin = async (password = FAKE_LOGIN.password) => {
  await evalJs(`(() => { document.getElementById('sync-email').value = ''; document.getElementById('sync-password').value = ''; })()`);
  await typeInto('#sync-email', FAKE_LOGIN.email);
  await typeInto('#sync-password', password);
};
const untilStatus = async (re, label) => {
  await waitFor(`(() => { const s = document.getElementById('sync-modal-status'); return !s.classList.contains('is-loading') && ${re}.test(s.textContent); })()`, label);
  return dialogState();
};
const waitClosed = (label) => waitFor(`!document.getElementById('shaper-sync-modal').open`, label + ': the dialog closes after the success');
const until = async (fn, label, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100); } assert.fail('timed out: ' + label); };
const downloaded = async (label, act) => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await act();
  return until(() => { const f = fs.readdirSync(dlDir).filter((n) => n.endsWith('.svg')); return f.length ? f : null; }, label + ': the download');
};
const scanForLogin = async (label) => {
  const found = await evalJs(`(async () => { const secrets = ${JSON.stringify(SECRETS)}; const hits = [];
    const has = (where, s) => { for (const x of secrets) if (String(s).includes(x)) hits.push(where); };
    for (const [n, st] of [['localStorage', localStorage], ['sessionStorage', sessionStorage]]) for (let i = 0; i < st.length; i++) { const k = st.key(i); has(n + ' key', k); has(n + ' value of ' + k, st.getItem(k)); }
    has('cookie', document.cookie);
    has('markup', document.documentElement.outerHTML);
    for (const d of await indexedDB.databases()) {
      const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      for (const s of db.objectStoreNames) {
        const all = await new Promise((ok, no) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
        has('IndexedDB ' + d.name + '/' + s, JSON.stringify(all));
      }
      db.close();
    }
    return hits; })()`);
  const elsewhere = sent.filter((r) => SECRETS.some((x) => (r.url + r.body).includes(x))).map((r) => r.url);
  const logged = consoleLines.filter((l) => SECRETS.some((x) => l.includes(x)));
  console.log(label + `: login scan: page hits ${found.length}, other requests carrying it ${elsewhere.length}, console lines carrying it ${logged.length}`);
  assert.deepStrictEqual([found, elsewhere, logged], [[], [], []], label + ': the login is in no storage, cookie, IndexedDB record, markup, other request or console line');
};

try {
  const url = `${LOCAL}apps/shaper/index.html`;
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });

  // ── desktop 1280 x 800: a design named "bromont" ──
  await resetBufferLive(cdp);
  await evalJs(`localStorage.removeItem('shaper-mode')`);
  await evalJs(CREATE_NAMED_DESIGN('shaper', 'bromont'));
  await navigate(url, 10000);
  await waitForApp('design-canvas');
  await planRectangle('desktop');
  await openStage('review');
  // Generate Shaper SVG: bromont.svg, and the panel names it
  const gen = await downloaded('Generate', () => clickEl('#btn-generate-svg'));
  const genLine = await evalJs(`({ text: document.getElementById('simexport-status').textContent, strong: document.querySelector('#simexport-status strong').textContent, link: document.querySelector('#simexport-status a').href })`);
  console.log('desktop: Generate saved ' + JSON.stringify(gen) + ', panel ' + JSON.stringify(genLine));
  assert.deepStrictEqual(gen, ['bromont.svg'], 'Generate Shaper SVG saves bromont.svg');
  assert.deepStrictEqual(genLine, { text: 'Exported 1 cut → bromont.svg. Drop it into ShaperHub (My Files) to sync with Origin.', strong: 'bromont.svg', link: 'https://hub.shapertools.com/my-files' }, 'the Export panel line names the design file');
  await shot('desktop-generate-line.png', '#simexport-status');
  // the drawer's Download: bromont.svg
  await openDrawer();
  const dl = await downloaded('Download', () => clickEl('.sk-sidebar [data-action="download"]'));
  console.log('desktop: Download saved ' + JSON.stringify(dl));
  assert.deepStrictEqual(dl, ['bromont.svg'], 'the drawer Download saves bromont.svg');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  if (await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-btn');
  await sleep(300);

  // the Sync dialog: the design's name; Send -> the question
  await openSignIn('desktop');
  let d = await dialogState();
  assert.strictEqual(d.name, 'bromont.svg', 'desktop: the file name starts as the design name');
  await fillLogin();
  await shot('desktop-1-dialog-design-name.png');
  await clickEl('#sync-btn-submit');
  d = await untilStatus('/already in My Files/', 'desktop: the question');
  console.log('desktop: exists ' + JSON.stringify(d));
  assert.deepStrictEqual([d.status, d.question, d.actions], [['bromont.svg is already in My Files.'], true, false], 'desktop: "bromont.svg is already in My Files." with the three choices, the dialog Cancel / Send hidden');
  assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('#sync-exists button')].map((b) => b.textContent)`), ['Replace it', 'Keep both', 'Cancel'], 'desktop: the three choices');
  assert.deepStrictEqual(api.steps(), ['token', 'search'], 'desktop: nothing uploaded before the user chose');
  await shot('desktop-2-already-in-my-files.png');
  // Keep both
  api.reset();
  await clickEl('#sync-btn-keep-both');
  d = await untilStatus('/^Sent as/', 'desktop: Keep both');
  await shot('desktop-3-keep-both-sent-as.png');
  console.log('desktop: keep both ' + JSON.stringify(d) + ', calls ' + api.steps().join(' > '));
  assert.deepStrictEqual([d.status, d.tone], [['Sent as bromont (2).svg'], 'sync-status is-success'], 'desktop: Keep both -> "Sent as bromont (2).svg"');
  assert.strictEqual(await evalJs(`document.getElementById('simexport-status').textContent`), '✓ Sent as bromont (2).svg. It will now appear on your Origin over Wi-Fi.', 'desktop: the Export panel line');
  assert.deepStrictEqual(api.names(), ['bromont (2).svg', 'bromont.svg', 'other.svg'], 'desktop: both in My Files');
  await waitClosed('desktop keep both');
  // Replace it (the login is still in the form: not asked again)
  await openSignIn('desktop replace');
  d = await dialogState();
  assert.strictEqual(d.name, 'bromont.svg', 'desktop: the name again');
  assert.deepStrictEqual(await evalJs(`[document.getElementById('sync-email').value === ${JSON.stringify(FAKE_LOGIN.email)}, document.getElementById('sync-password').value.length > 0]`), [true, true], 'desktop: the form still holds the typed login (page memory, as before)');
  await clickEl('#sync-btn-submit');
  await untilStatus('/already in My Files/', 'desktop: the question again');
  api.reset();
  await clickEl('#sync-btn-replace');
  d = await untilStatus('/^Replaced/', 'desktop: Replace it');
  await shot('desktop-4-replaced.png');
  console.log('desktop: replace ' + JSON.stringify(d) + ', calls ' + api.steps().join(' > '));
  assert.deepStrictEqual(d.status, ['Replaced bromont.svg in My Files'], 'desktop: Replace it -> "Replaced bromont.svg in My Files"');
  assert.deepStrictEqual(api.steps(), ['search', 'blob', 'delete', 'create'], 'desktop: reuses in-memory session token and uploads the new blob BEFORE deleting the old entry');
  await waitClosed('desktop replace');
  // the question's Cancel sends nothing; an edited name is kept for this design
  await openSignIn('desktop cancel');
  await clickEl('#sync-btn-submit');
  await untilStatus('/already in My Files/', 'desktop: the question (cancel)');
  api.reset();
  const n0 = uploads.length;
  await clickEl('#sync-btn-exists-cancel');
  d = await dialogState();
  assert.deepStrictEqual([d.open, d.question, d.actions, d.status, uploads.length - n0, api.steps()], [true, false, true, ['Nothing was sent. Change the file name and Send, or close.'], 0, []], 'desktop: Cancel sends nothing and keeps the dialog');
  await typeInto('#sync-filename', 'bromont-v2.svg');
  await clickEl('#sync-btn-cancel');
  await openSignIn('desktop edited');
  assert.strictEqual((await dialogState()).name, 'bromont-v2.svg', 'desktop: the name typed for this design is kept in this session');
  // Switch account to reveal the credential inputs, then test a wrong login: Shaper's words + the hint
  await clickEl('#sync-btn-switch');
  await fillLogin('wrong-not-a-real-password');
  await clickEl('#sync-btn-submit');
  d = await untilStatus('/Authentication failed/', 'desktop: wrong login');
  await shot('desktop-5-wrong-login-hint.png');
  console.log('desktop: wrong login ' + JSON.stringify(d));
  assert.deepStrictEqual([d.status, d.tone], [['Error: Authentication failed (401): Username and password could not be verified', HINT], 'sync-status is-error'], 'desktop: a wrong login shows Shaper\'s words and the hint');
  await clickEl('#sync-btn-cancel');
  await scanForLogin('desktop');

  // ── phone 390 x 844, touch: Keep both by taps ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  phone = true;
  await navigate(url, 10000);
  await waitForApp('design-canvas');
  if (!await planSize()) await planRectangle('phone');
  await openSignIn('phone');
  assert.strictEqual((await dialogState()).name, 'bromont.svg', 'phone: the design name (a new page: the earlier edit was page memory only)');
  await fillLogin();
  await clickEl('#sync-btn-submit');
  await untilStatus('/already in My Files/', 'phone: the question');
  const sizes = await evalJs(`(() => { const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) }; };
    return { dialog: box('#shaper-sync-modal'), replace: box('#sync-btn-replace'), keep: box('#sync-btn-keep-both'), cancel: box('#sync-btn-exists-cancel'), scroll: document.documentElement.scrollWidth, vw: innerWidth, vh: innerHeight }; })()`);
  console.log('phone: sizes ' + JSON.stringify(sizes));
  for (const k of ['replace', 'keep', 'cancel']) {
    assert.ok(sizes[k].h >= 44 && sizes[k].w >= 44, `phone: ${k} is a 44 px target: ` + JSON.stringify(sizes[k]));
    assert.ok(sizes[k].left >= 0 && sizes[k].right <= 390 && sizes[k].bottom <= sizes.vh, `phone: ${k} is inside the screen`);
  }
  assert.ok(sizes.scroll <= sizes.vw, 'phone: no sideways scroll');
  await shot('phone-1-already-in-my-files.png');
  await clickEl('#sync-btn-keep-both');
  d = await untilStatus('/^Sent as/', 'phone: Keep both');
  await shot('phone-2-keep-both-sent-as.png');
  assert.deepStrictEqual(d.status, ['Sent as bromont (3).svg'], 'phone: Keep both -> "Sent as bromont (3).svg"');
  await waitClosed('phone');
  await scanForLogin('phone');

  // ── Fusion mode (the add-in palette), desktop: the selection's name ──
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  phone = false;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await resetBufferLive(cdp);
  await evalJs(`localStorage.removeItem('shaper-mode')`);
  await navigate(`${url}?host=fusion`, 10000);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !document.getElementById('view-prepare').hidden`, 'fusion: the Fusion Prepare stage');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('sa7-slope/06-countersink'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'fusion: the Fusion selection imported');
  await clickWorld(60, -40);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'fusion: the cut card');
  await pickPocket();
  await openSignIn('fusion');
  assert.strictEqual((await dialogState()).name, 'Body1.svg', 'fusion: the file name is the selection\'s name');
  await fillLogin();
  await shot('fusion-1-dialog-selection-name.png');
  await clickEl('#sync-btn-submit');
  d = await untilStatus('/^Sent /', 'fusion: sent');
  await shot('fusion-2-sent.png');
  assert.deepStrictEqual(d.status, ['Sent Body1.svg to My Files'], 'fusion: "Sent Body1.svg to My Files"');
  await waitClosed('fusion');
  await scanForLogin('fusion');

  assert.deepStrictEqual(api.blocked, [], 'this process sent no request but to the fake Shaper API and the local browser');
  console.log(`uploads by mode: ${uploads.map((u) => u.mode).join(', ')}`);
  console.log(`network: ${uploads.length} uploads answered by handleShaperUpload + the fake Shaper API; ${blocked.length} non-local page requests blocked` + (blocked.length ? ': ' + [...new Set(blocked.map((u) => new URL(u).origin))].join(', ') : '') + `; ${api.blocked.length} blocked in this process`);
  console.log(`shaperhub-name-767-live.test.js: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  await cdp.close();
  globalThis.fetch = realFetch;
  fs.rmSync(dlDir, { recursive: true, force: true });
}
process.exit(0); // the launcher's own close leaves a 10 s fallback timer pending: end now that the browser and its server are closed (as drawing-stage-725-live)
