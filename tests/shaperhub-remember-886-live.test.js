// tests/shaperhub-remember-886-live.test.js — TASK 886 (owner turns 3612-3614): "Remember login on this computer" in Shaper's Sync to ShaperHub dialog, on the
// WEBSITE, in a real browser, desktop 1280 x 800 (mouse) and phone 390 x 844 (touch). FAKE ShaperHub only: /api/shaper-upload is answered node-side by
// packages/core/shaper-cloud.js handleShaperUpload over tests/shaperhub-fake-api.js (fake email / password); every non-local request is blocked and counted.
//   each phase: a Pocket planned; the dialog's box is unticked, its hint says where the login goes (screenshot); the fake login typed, the box ticked (nothing kept
//   yet), Send -> the login kept under ONE key, and the 758 scans (storage / cookie / IndexedDB / markup / console / other requests) find it in EXACTLY that key;
//   a reload (no dialog opened) -> the Pocket one step deeper -> Generate: the fake gets mode 'replace' WITH the login ("Autosend", TASK 884, on by default), the
//   status line says replaced, ONE success toast (owner turn 3649);
//   desktop only: Switch account deletes the kept copy; a Send with the box ticked keeps it again; a WRONG kept password: Generate shows the login error line
//   and the copy stays;
//   the dialog after a reload: the fields filled, the box ticked; unticked -> the key gone at once; a reload -> the fields empty, Generate sends nothing and
//   says ShaperHub was not updated, the switch says "Needs a sign-in for this session.", and the scans find the login NOWHERE.
// Screenshots (cropped to the sign-in) to .evidence/886/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressExportAction } from './helpers/export-actions.js';
import { openOpLive, okLive } from './helpers/prepare-open-live.js';
import { createFakeShaperApi, FAKE_LOGIN } from './shaperhub-fake-api.js';
import { pageLoginPlaces, REMEMBERED_PLACE } from './shaperhub-login-scan.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';

const EVID = path.resolve('.evidence/886');
fs.mkdirSync(EVID, { recursive: true });
const NAME = 'shaper-export.svg'; // the Untitled design's file name
const KEY = 'shaper-hub-remembered-login'; // shaperhub-login.js REMEMBER_LOGIN_KEY
const REPLACED = `✓ Replaced ${NAME} in My Files.`;
const TOAST = `Sent ${NAME} to ShaperHub (My Files)`;
const WRONG = 'a-wrong-fake-password';
const SECRETS = [FAKE_LOGIN.email, FAKE_LOGIN.password, WRONG];

const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ passLocal: realFetch });
globalThis.fetch = api.fetch;

const cdp = await launchBrowser({ tag: '886-remember', width: 1280, height: 800 });
if (!cdp) { globalThis.fetch = realFetch; console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, ws, send, evalJs, waitFor, navigate, waitForApp, close } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;
const URL_ = `${LOCAL}apps/shaper/index.html`;
const blocked = [];
const uploads = []; // every /api/shaper-upload body ({ mode, action, filename, remotePath, svg, email, password })
const elsewhere = []; // every OTHER request that carried a secret (url)
const consoleLines = [];

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' '));
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const body = request.postData !== undefined ? request.postData : (request.postDataEntries || []).map((x) => Buffer.from(x.bytes || '', 'base64').toString('utf8')).join('');
  const isUpload = request.url.startsWith(LOCAL) && new URL(request.url).pathname === '/api/shaper-upload';
  if (!isUpload && SECRETS.some((x) => (request.url + body).includes(x))) elsewhere.push(request.url);
  if (!request.url.startsWith(LOCAL)) { blocked.push(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
  if (isUpload) {
    uploads.push(JSON.parse(body));
    handleShaperUpload(body).then(({ status, body: answer }) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(answer)).toString('base64') }));
    return;
  }
  send('Fetch.continueRequest', { requestId });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Browser.setDownloadBehavior', { behavior: 'deny' });

let phone = false;
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const press = async (x, y) => {
  if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
  else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
  await sleep(250);
};
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const t = { clickEl, evalJs, waitFor };
const typeVal = (sel, val) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
const openStage = async (id) => {
  for (let i = 0; i < 5; i++) {
    if (await activeStage() === id) return;
    if (phone) {
      if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron');
      await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
      await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`);
    } else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
    await sleep(400);
  }
  assert.fail('could not open the ' + id + ' stage');
};
const shot = async (name, sel) => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const m = 8;
    const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m); return { x, y, width: Math.min(innerWidth, r.right + m) - x, height: Math.min(innerHeight, r.bottom + m) - y, scale: 2 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVID, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVID, name));
};
const stored = () => evalJs(`localStorage.getItem(${JSON.stringify(KEY)})`);
const fields = () => evalJs(`({ email: document.getElementById('sync-email').value, password: document.getElementById('sync-password').value })`);
const box = () => evalJs(`(() => { const b = document.getElementById('sync-remember-login'); return { checked: b.checked, label: b.labels[0].textContent.trim(), hint: document.getElementById('sync-remember-hint').textContent }; })()`);
const HINT = 'Saved as plain text in this app’s storage on this computer. Untick to delete it.';
const keepHint = () => evalJs(`document.getElementById('sync-keep-hint').textContent`);
const statusText = () => evalJs(`document.getElementById('simexport-status').textContent`);
const watchToasts = () => evalJs(`(() => { if (window.__test886Toasts) return; window.__test886Toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes)
  if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'notification-container') window.__test886Toasts.push({ level: n.getAttribute('data-level'), text: n.textContent }); }).observe(document.body, { childList: true, subtree: true }); })()`);
const toasts = () => evalJs(`window.__test886Toasts.slice()`);
const openDialog = async () => {
  await pressExportAction(cdp, clickEl, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'the Sync dialog opens');
  await sleep(250);
};
const closeDialog = async () => { await clickEl('#sync-modal-close'); await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'the dialog closes'); };
const generate = async (done, what) => {
  await evalJs(`document.getElementById('simexport-status').replaceChildren()`);
  await pressExportAction(cdp, clickEl, 'btn-generate-svg');
  await waitFor(`(${done})(document.getElementById('simexport-status').textContent)`, what, 60000);
};
const svgDepths = (svg) => [...svg.matchAll(/shaper:cutDepth="([^"]+)"/g)].map((x) => x[1]);
// the 758 scans: the page's storage / cookie / IndexedDB / markup (`allowed` = the places expected to hold it), the console, every other request
const scan = async (label, allowed) => {
  const hits = await pageLoginPlaces(evalJs, SECRETS);
  const logged = consoleLines.filter((l) => SECRETS.some((x) => l.includes(x)));
  console.log(label + `: login scan: page ${JSON.stringify(hits)}, other requests carrying it ${elsewhere.length}, console lines carrying it ${logged.length}`);
  assert.deepStrictEqual(hits, allowed, label + ': the login is exactly in ' + JSON.stringify(allowed));
  assert.deepStrictEqual(elsewhere, [], label + ': no request but the upload carries the login');
  assert.deepStrictEqual(logged, [], label + ': no console line carries the login');
};
const load = async (label) => {
  await navigate(URL_, 10000);
  await waitForApp('design-canvas');
  await watchToasts();
  await waitFor(`!!(window.__designController && window.__designController.state)`, label + ': the design controller');
};
const opId = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps()[0].id)`);
const deeper = async (label) => { // the Pocket one step deeper (its card's + stepper, OK), back to Export
  await openStage('prepare');
  await waitFor(`!!window.__prepareView`, label + ': Prepare');
  await openOpLive(t, await opId());
  await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]');
  await okLive(t);
  await openStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export step');
};
const reloadToExport = async (label) => {
  await load(label);
  await waitFor(`window.__designController.state.shapes.length === 4`, label + ': the design is back');
  await openStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export step');
};
// Send from the dialog (open), to My Files; a name already there (an earlier phase / Send): the question, answered Replace it
const sendFromDialog = async (label) => {
  await clickEl('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success') || !document.getElementById('sync-exists').hidden`, label + ': sent or asked');
  if (await evalJs(`!document.getElementById('sync-exists').hidden`)) await clickEl('#sync-btn-replace');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, label + ': sent');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, label + ': the dialog closes after the send');
};
// a Generate after a reload, the dialog never opened: the replace WITH the kept login, the status line, ONE toast
const autosend = async (label, firstSvg) => {
  const n = uploads.length;
  const t0 = (await toasts()).length;
  await generate(`(s) => s.includes(${JSON.stringify(REPLACED)})`, label + ': Generate replaced the target');
  const sent = uploads.slice(n).filter((u) => typeof u.svg === 'string');
  assert.strictEqual(sent.length, 1, label + ': one upload');
  const u = sent[0];
  console.log(label + ` replace: mode=${u.mode} filename=${u.filename} remotePath=${u.remotePath} login=${u.email === FAKE_LOGIN.email && u.password === FAKE_LOGIN.password} token=${!!u.token} depths ${JSON.stringify(svgDepths(firstSvg))} -> ${JSON.stringify(svgDepths(u.svg))}`);
  assert.deepStrictEqual([u.mode, u.filename, u.remotePath || '/', u.email, u.password], ['replace', NAME, '/', FAKE_LOGIN.email, FAKE_LOGIN.password], label + ': mode replace, the target, WITH the kept login');
  assert.notDeepStrictEqual(svgDepths(u.svg), svgDepths(firstSvg), label + ': the NEW svg (the new depth)');
  assert.strictEqual(await evalJs(`document.getElementById('shaper-sync-modal').open`), false, label + ': no dialog opened');
  await waitFor(`window.__test886Toasts.length > ${t0}`, label + ': the Autosend toast');
  await sleep(500);
  const tw = (await toasts()).slice(t0);
  assert.ok(tw.length === 1 && tw[0].level === 'success' && tw[0].text.includes(TOAST), label + ': ONE success toast: ' + JSON.stringify(tw));
  console.log(label + ' status line: ' + await statusText());
  return u.svg;
};

async function phase(label) {
  await load(label);
  await resetBufferLive(cdp);
  await evalJs(`(() => { localStorage.removeItem(${JSON.stringify(KEY)}); localStorage.removeItem('shaper-keep-hub-up-to-date'); })()`); // the box unticked, Autosend at its default (on)
  await load(label);
  assert.strictEqual(await stored(), null, label + ': nothing kept at the start');
  await evalJs(`(async () => { const st = window.__designController.state;
    [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('draw');
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.set('loop:' + lf.findLoops(st)[0].id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 }); })()`);
  await openStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export step');

  // ── the dialog: the box unticked, its hint; the fake login, ticked (nothing kept yet), Send ──
  await openDialog();
  const b0 = await box();
  console.log(label + ' box: ' + JSON.stringify(b0));
  assert.deepStrictEqual(b0, { checked: false, label: 'Remember login on this computer', hint: HINT }, label + ': unticked by default, the honest hint');
  await shot(`${label}-remember-unticked.png`, '#sync-creds');
  if (phone) {
    const row = await evalJs(`(() => { const r = document.querySelector('label[for="sync-remember-login"]').getBoundingClientRect(), d = document.getElementById('shaper-sync-modal').getBoundingClientRect(); return { h: Math.round(r.height), left: Math.round(d.left), right: Math.round(d.right), doc: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
    console.log('phone box row: ' + JSON.stringify(row));
    assert.ok(row.h >= 44 && row.left >= 0 && row.right <= 390 && row.doc <= row.vw, 'phone: the box row is a 44 px target, the dialog inside the screen, no sideways scroll: ' + JSON.stringify(row));
  }
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await clickEl('label[for="sync-remember-login"]');
  await waitFor(`document.getElementById('sync-remember-login').checked`, label + ': ticked');
  assert.strictEqual(await stored(), null, label + ': ticked, not signed in yet: nothing kept');
  await shot(`${label}-remember-ticked.png`, '#sync-creds');
  await sendFromDialog(label);
  const firstSvg = uploads.filter((u) => typeof u.svg === 'string').pop().svg;
  assert.deepStrictEqual(JSON.parse(await stored()), FAKE_LOGIN, label + ': ticked + a sign-in that succeeded: the login kept under the one key');
  await scan(label + ' ticked', [REMEMBERED_PLACE]);

  // ── a reload; the dialog NOT opened: the Pocket deeper, Generate -> the replace with the kept login ──
  await reloadToExport(label + ' reload');
  assert.deepStrictEqual(await fields(), FAKE_LOGIN, label + ': the kept login filled the sign-in at start');
  await deeper(label + ' reload');
  let lastSvg = await autosend(label + ' reload', firstSvg);
  await scan(label + ' after the autosend', [REMEMBERED_PLACE]);

  if (!phone) {
    // Switch account (the sign-out) deletes the kept copy; a Send with the box still ticked keeps it again
    await openDialog();
    await waitFor(`!document.getElementById('sync-session').hidden`, 'desktop: signed in for this session (the replace got a token)');
    await clickEl('#sync-btn-switch');
    assert.strictEqual(await stored(), null, 'desktop: Switch account deleted the kept login');
    await scan('desktop after Switch account', []);
    assert.deepStrictEqual((await box()).checked, true, 'desktop: the box stays ticked (the next sign-in is kept)');
    await sendFromDialog('desktop send again');
    assert.deepStrictEqual(JSON.parse(await stored()), FAKE_LOGIN, 'desktop: a Send with the box ticked keeps it again');

    // a WRONG kept password: Generate's replace is refused: the login error line; the copy stays
    await evalJs(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ email: ${JSON.stringify(FAKE_LOGIN.email)}, password: ${JSON.stringify(WRONG)} }))`);
    await reloadToExport('desktop wrong password');
    const nW = uploads.length;
    const tW = (await toasts()).length;
    await generate(`(s) => s.includes('Error:')`, 'desktop wrong password: Generate refused');
    const line = await statusText();
    console.log('desktop wrong password status line: ' + line);
    assert.ok(line.includes('Check the password: your browser may have filled in a saved one.'), 'desktop: the existing login error line (LOGIN_HINT): ' + line);
    assert.strictEqual(uploads.slice(nW).filter((u) => u.mode === 'replace' && u.password === WRONG).length, 1, 'desktop: the replace carried the kept (wrong) password');
    assert.strictEqual((await toasts()).length, tW, 'desktop: no success toast for a refused replace');
    assert.deepStrictEqual(JSON.parse(await stored()), { email: FAKE_LOGIN.email, password: WRONG }, 'desktop: the kept copy stays until the user changes it or unticks');
    await shot('desktop-wrong-password-line.png', '#simexport-status');
    // the user types the right password and sends (ticked): that login is kept instead
    await openDialog();
    await typeVal('#sync-password', FAKE_LOGIN.password);
    await sendFromDialog('desktop changed password');
    assert.deepStrictEqual(JSON.parse(await stored()), FAKE_LOGIN, 'desktop: the changed login is kept');
    lastSvg = uploads.filter((u) => typeof u.svg === 'string').pop().svg;
  }

  // ── the dialog after a reload: filled and ticked; unticked -> deleted; a reload -> no sign-in, nothing anywhere ──
  await reloadToExport(label + ' reload 2');
  await openDialog();
  assert.deepStrictEqual(await fields(), FAKE_LOGIN, label + ': the dialog shows the kept login');
  assert.deepStrictEqual(await box(), { checked: true, label: 'Remember login on this computer', hint: HINT }, label + ': the box ticked (a login is kept)');
  assert.strictEqual(await keepHint(), `Each Generate replaces ${NAME} in My Files on ShaperHub.`, label + ': the kept login counts as signed in for the switch');
  await shot(`${label}-remember-ticked-after-reload.png`, '#sync-creds');
  await clickEl('label[for="sync-remember-login"]');
  await waitFor(`!document.getElementById('sync-remember-login').checked`, label + ': unticked');
  assert.strictEqual(await stored(), null, label + ': unticked: the kept login deleted at once');
  await closeDialog();
  await reloadToExport(label + ' reload 3');
  assert.deepStrictEqual(await fields(), { email: '', password: '' }, label + ': nothing kept: the fields are empty after a reload');
  await deeper(label + ' reload 3');
  const n3 = uploads.length;
  await generate(`(s) => s.includes('ShaperHub not updated')`, label + ': Generate without a sign-in');
  await sleep(800);
  assert.strictEqual(uploads.length, n3, label + ': nothing sent');
  await openDialog();
  assert.strictEqual(await keepHint(), 'Needs a sign-in for this session.', label + ': the switch says it needs a sign-in');
  assert.deepStrictEqual((await box()).checked, false, label + ': the box unticked');
  await closeDialog();
  await scan(label + ' unticked', []);
  return lastSvg;
}

try {
  await phase('desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  phone = true;
  await phase('phone');
  assert.deepStrictEqual(blocked, [], 'no request left the machine');
  assert.deepStrictEqual(api.blocked, [], 'every Shaper call was answered by the fake');
  console.log(`shaperhub-remember-886-live: ok (${uploads.length} upload-function calls: ${uploads.map((x) => x.mode || x.action).join(', ')})`);
} finally {
  globalThis.fetch = realFetch;
  await close();
}
