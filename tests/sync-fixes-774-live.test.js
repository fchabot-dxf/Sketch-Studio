// tests/sync-fixes-774-live.test.js — TASK 774, Shaper's "Sync to ShaperHub" dialog in a real browser (desktop 1280 x 800), FAKE ShaperHub API only
// (tests/shaperhub-fake-api.js answered node-side through packages/core/shaper-cloud.js handleShaperUpload; every non-local request blocked and counted):
//   1. the "already in My Files" question is about the folder the server answered for: while it is open (and while a send runs) the folder browser does
//      not move (rows, breadcrumbs, Browse / Refresh / New folder disabled; a press on the parent crumb changes nothing); Replace it acts on THAT folder.
//   2. the question's focus is on Cancel: a real Enter presses Cancel (nothing sent, nothing deleted), never "Replace it".
//   3. a Replace from a session token carries the login (shaper-cloud.js THE REPLACE RULE); Send with a token does not.
//   4d. the "New folder" tooltip is drawn INSIDE the modal dialog (the top layer): it is the element under its own centre.
//   4e. Escape in the new-folder box closes the box, not the dialog.
//   4f. an expired session says so WITHOUT the wrong-password hint; a refused password still shows it.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { createFakeShaperApi, FAKE_LOGIN, FAKE_TOKEN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/774');
fs.mkdirSync(EVID, { recursive: true });
const LOGIN_HINT = 'Check the password: your browser may have filled in a saved one.';

const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ files: ['bromont.svg', 'Furniture/bromont.svg'], folders: ['Furniture'], passLocal: realFetch });
globalThis.fetch = api.fetch;

const cdp = await launchBrowser({ tag: '774-sync', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, ws, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;
const blocked = [];
const uploads = []; // the /api/shaper-upload request bodies (parsed), in order
let hold = null; // while set, an upload request waits for it before it is answered (a send held in flight)

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  if (!request.url.startsWith(LOCAL)) { blocked.push(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
  if (new URL(request.url).pathname === '/api/shaper-upload') {
    const body = request.postData !== undefined ? request.postData : (request.postDataEntries || []).map((x) => Buffer.from(x.bytes || '', 'base64').toString('utf8')).join('');
    const parsed = JSON.parse(body);
    uploads.push(parsed);
    const wait = parsed.svg && hold ? hold.promise : Promise.resolve();
    wait.then(() => handleShaperUpload(body)).then(({ status, body: answer }) => send('Fetch.fulfillRequest', {
      requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(answer)).toString('base64'),
    }));
    return;
  }
  send('Fetch.continueRequest', { requestId });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

const center = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return r.width ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null; })()`);
const clickEl = async (sel) => {
  const p = await center(sel);
  assert(p, `${sel} not clickable`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const typeVal = (sel, val) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const status = () => evalJs(`document.getElementById('sync-modal-status').textContent`);
const shot = async (name, sel = '#shaper-sync-modal', pad = 8) => {
  const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 1.5 } });
  fs.writeFileSync(path.join(EVID, name), Buffer.from(s.data, 'base64'));
};
const crumbHere = () => evalJs(`document.querySelector('#sync-breadcrumbs [aria-current="location"]').dataset.path`);

try {
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitForApp('design-canvas');
  await resetBufferLive(cdp);
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitForApp('design-canvas');
  await waitFor(`!!(window.__designController && window.__designController.state)`, 'design controller');
  // a 120 x 70 rectangle with a Pocket on it (the plan set through the page's own cut-plan module)
  await evalJs(`(async () => { const st = window.__designController.state;
    [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('draw');
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.set('loop:' + lf.findLoops(st)[0].id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 }); })()`);
  await clickEl('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, 'Export step');
  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'Sync dialog open');

  // ── 4f (a): a refused password shows the hint ──
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', 'wrong-password-774');
  await clickEl('#sync-btn-browse');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-error')`, 'wrong password refused');
  assert.ok((await status()).includes(LOGIN_HINT), '4f: a refused password shows the hint: ' + await status());

  // sign in, open Furniture
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await clickEl('#sync-btn-browse');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-folder="Furniture"]')`, 'root listed');
  await clickEl('#sync-folder-list [data-folder="Furniture"]');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-file="bromont.svg"]')`, 'Furniture listed');
  assert.strictEqual(await crumbHere(), '/Furniture/');

  // ── 4d: the New folder tooltip is inside the dialog and on top ──
  const nf = await center('#sync-btn-new-folder');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nf.x, y: nf.y, button: 'none' });
  await waitFor(`!!document.querySelector('#sk-cursor-tip:not([hidden])')`, 'New folder tooltip (TASK 805: the cursor tooltip, 400 ms hover)');
  const tip = await evalJs(`(() => { const t = document.querySelector('#sk-cursor-tip:not([hidden])'); const r = t.getBoundingClientRect(); t.style.pointerEvents = 'auto'; /* elementFromPoint skips pointer-events:none */ const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); t.style.pointerEvents = '';
    return { inDialog: t.parentElement === document.getElementById('shaper-sync-modal'), onTop: !!hit && t.contains(hit), text: t.textContent }; })()`);
  console.log('4d tooltip: ' + JSON.stringify(tip));
  assert.deepStrictEqual([tip.inDialog, tip.onTop], [true, true], '4d: the tooltip is in the dialog and painted on top of it');
  await shot('sync-newfolder-tooltip.png', '#shaper-sync-modal', 60);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });

  // ── 4e: Escape in the new-folder box closes the box only ──
  await clickEl('#sync-btn-new-folder');
  await waitFor(`!document.getElementById('sync-mkdir-row').hidden && document.activeElement === document.getElementById('sync-mkdir-name')`, 'new-folder box focused');
  await sendRealKey(send, 'Escape', 'Escape', 27);
  await sleep(250);
  const esc = await evalJs(`({ open: document.getElementById('shaper-sync-modal').open, box: document.getElementById('sync-mkdir-row').hidden })`);
  assert.deepStrictEqual(esc, { open: true, box: true }, '4e: Escape closed the new-folder box, the dialog stays open: ' + JSON.stringify(esc));

  // ── 3 + 1 + 2: Send in Furniture -> the question about Furniture ──
  await typeVal('#sync-filename', 'bromont.svg');
  api.reset();
  const nUploads = uploads.length;
  let release; hold = { promise: new Promise((r) => { release = r; }) };
  await clickEl('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-loading')`, 'the send runs (held)');
  // 1: while the send runs, the browser does not move
  const busyLock = await evalJs(`[...document.querySelectorAll('#sync-breadcrumbs button:not([aria-current]), #sync-folder-list button.sync-entry')].map((b) => b.disabled)`);
  assert.ok(busyLock.length && busyLock.every(Boolean), '1: during a send every row and crumb is disabled: ' + JSON.stringify(busyLock));
  await clickEl('#sync-breadcrumbs button[data-path="/"]');
  await sleep(400);
  assert.strictEqual(await crumbHere(), '/Furniture/', '1: a press on the parent crumb during the send does not move the browser');
  hold = null; release();
  await waitFor(`!document.getElementById('sync-exists').hidden`, 'the exists question');
  assert.strictEqual(await status(), 'bromont.svg is already in My Files/Furniture.', '1: the question names the folder the server answered for');
  const sendBody = uploads[nUploads];
  assert.deepStrictEqual([sendBody.mode, sendBody.email, sendBody.password, sendBody.token], ['new', undefined, undefined, FAKE_TOKEN], '3: Send with a token carries no login');
  // 2: the focus is on Cancel, not the destructive Replace it; a real Enter presses Cancel: nothing sent
  assert.strictEqual(await evalJs(`document.activeElement && document.activeElement.id`), 'sync-btn-exists-cancel', '2: the question focuses Cancel');
  await sendRealKey(send, 'Enter', 'Enter', 13, 0, String.fromCharCode(13));
  await waitFor(`document.getElementById('sync-exists').hidden`, 'Enter answered the question');
  assert.strictEqual(await status(), 'Nothing was sent. Change the file name and Send, or close.', '2: Enter pressed Cancel');
  assert.ok(!api.steps().includes('delete') && !api.steps().includes('blob'), '2: nothing uploaded, nothing deleted: ' + api.steps().join(' > '));
  assert.ok(!(await evalJs(`document.querySelector('#sync-breadcrumbs button[data-path="/"]').disabled`)), '1: the answer unlocks the browser');

  // ask again: 1: the browser is locked while the question is open
  await clickEl('#sync-btn-submit');
  await waitFor(`!document.getElementById('sync-exists').hidden`, 'the exists question again');
  const lock = await evalJs(`(() => { const d = (s) => [...document.querySelectorAll(s)].map((b) => b.disabled);
    return { rows: d('#sync-folder-list button.sync-entry'), crumbs: d('#sync-breadcrumbs button:not([aria-current])'), browse: document.getElementById('sync-btn-browse').disabled,
      refresh: document.getElementById('sync-btn-refresh').disabled, newFolder: document.getElementById('sync-btn-new-folder').disabled }; })()`);
  console.log('1 lock: ' + JSON.stringify(lock));
  assert.ok(lock.rows.length && lock.rows.every(Boolean) && lock.crumbs.length && lock.crumbs.every(Boolean) && lock.refresh && lock.newFolder, '1: every way to another folder is disabled: ' + JSON.stringify(lock));
  await shot('sync-question-locked.png');
  await clickEl('#sync-breadcrumbs button[data-path="/"]'); // the parent crumb: disabled, nothing happens
  await sleep(300);
  assert.strictEqual(await crumbHere(), '/Furniture/', '1: a press on the parent crumb does not move the browser');
  assert.ok(!(await evalJs(`document.getElementById('sync-exists').hidden`)), '1: the question is still open');

  // then Replace it: the old file of FURNITURE is replaced, the login rides with the token
  api.reset();
  const nBefore = uploads.length;
  await clickEl('#sync-btn-replace');
  await waitFor(`/Replaced bromont\\.svg in My Files\\/Furniture/.test(document.getElementById('sync-modal-status').textContent)`, 'replaced in Furniture');
  const deletes = api.calls.filter((c) => c.step === 'delete').map((c) => new URL(c.url).pathname);
  assert.deepStrictEqual(deletes, ['/files/userspace/tree/Furniture/bromont.svg'], '1: Replace it deleted the Furniture entry (the folder the question was about)');
  assert.deepStrictEqual(api.names('/'), ['bromont.svg'], '1: the root file is untouched');
  const rep = uploads[nBefore];
  assert.deepStrictEqual([rep.mode, rep.remotePath, rep.email, rep.token], ['replace', '/Furniture/', FAKE_LOGIN.email, FAKE_TOKEN], '3: a Replace carries the login with the token');
  assert.ok(typeof rep.password === 'string' && rep.password.length > 0, '3: ... and the password');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'dialog closes after the success');

  // ── 4f (b): an expired session: no wrong-password hint ──
  await clickEl('#btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open && !document.getElementById('sync-session').hidden`, 'session kept in page memory');
  await waitFor(`!document.getElementById('sync-btn-refresh').disabled && !document.getElementById('sync-modal-status').classList.contains('is-loading')`, 'reopen listing done');
  api.rotateToken('rotated-jwt-774');
  await clickEl('#sync-btn-refresh');
  await waitFor(`!document.getElementById('sync-creds').hidden && document.getElementById('sync-modal-status').classList.contains('is-error')`, 'expired session cleared');
  const expired = await status();
  console.log('4f expired: ' + expired);
  assert.ok(/Session expired/.test(expired) && !expired.includes(LOGIN_HINT), '4f: an expired session says so, without the wrong-password hint: ' + expired);
  await shot('sync-expired-no-hint.png');

  // no secret in the page
  const page = await evalJs(`document.documentElement.outerHTML + document.cookie + JSON.stringify(Object.entries(localStorage)) + JSON.stringify(Object.entries(sessionStorage))`);
  for (const s of [FAKE_LOGIN.password, FAKE_TOKEN, 'rotated-jwt-774']) assert.ok(!page.includes(s), 'no secret in the page / storage');

  console.log(`sync-fixes-774-live: ok (${blocked.length} non-local requests blocked${blocked.length ? ': ' + blocked.join(', ') : ''})`);
} finally {
  globalThis.fetch = realFetch;
  await cdp.close();
}
