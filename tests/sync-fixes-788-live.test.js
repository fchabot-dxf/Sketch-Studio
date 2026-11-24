// tests/sync-fixes-788-live.test.js — TASK 788, Shaper's Sync dialog in a real browser (1280 x 800), FAKE ShaperHub API only:
//   8. Switch account while the "already in My Files" question is open: the question closes and the dialog is usable again (Send, Browse, sign-in form).
//   12. the auto-close after a send belongs to the opening it was started for: close + re-open inside the 1.2 s keeps the re-opened dialog open.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { createFakeShaperApi, FAKE_LOGIN, FAKE_TOKEN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';
import { pressExportAction } from './helpers/export-actions.js'; // TASK 880: the Export actions are the header's (the drawer's on a phone)

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.resolve('.evidence/788');
fs.mkdirSync(EVID, { recursive: true });
const LOGIN_HINT = 'Check the password: your browser may have filled in a saved one.';

const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ files: ['bromont.svg', 'Furniture/bromont.svg'], folders: ['Furniture'], passLocal: realFetch });
globalThis.fetch = api.fetch;

const cdp = await launchBrowser({ tag: '788-sync', width: 1280, height: 800 });
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
  await evalJs(`(async () => { const st = window.__designController.state;
    [[0, 0], [120, 0], [120, 70], [0, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + ((i + 1) % 4)] });
    st.saveState('draw');
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/tests/helpers/plan-v2.js');
    cp.V2_PLAN.set('loop:' + lf.findLoops(st)[0].id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 }); })()`);
  await clickEl('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, 'Export step');
  await pressExportAction({ evalJs, waitFor }, clickEl, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'Sync dialog open');

  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await clickEl('#sync-btn-browse');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-folder="Furniture"]')`, 'root listed');
  await clickEl('#sync-folder-list [data-folder="Furniture"]');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-file="bromont.svg"]')`, 'Furniture listed');

  // -- 8: the question is open, then Switch account
  await typeVal('#sync-filename', 'bromont.svg');
  await clickEl('#sync-btn-submit');
  await waitFor(`!document.getElementById('sync-exists').hidden`, 'exists question shown');
  await clickEl('#sync-btn-switch');
  await sleep(200);
  const after = await evalJs(`({ existsHidden: document.getElementById('sync-exists').hidden, actionsHidden: document.getElementById('sync-actions').hidden, submitDisabled: document.getElementById('sync-btn-submit').disabled, browseDisabled: document.getElementById('sync-btn-browse').disabled, credsHidden: document.getElementById('sync-creds').hidden })`);
  console.log('8 after Switch account: ' + JSON.stringify(after));
  await shot('sync-switch-account.png');
  assert.deepStrictEqual(after, { existsHidden: true, actionsHidden: false, submitDisabled: false, browseDisabled: false, credsHidden: false }, '8: the question is closed, Send and Browse are usable, the sign-in form is back');

  // -- 12: send, close, re-open inside the 1.2 s
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await typeVal('#sync-filename', 'fresh-788.svg');
  await clickEl('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, 'upload succeeded');
  await clickEl('#sync-modal-close');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'closed');
  await pressExportAction({ evalJs, waitFor }, clickEl, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 're-opened');
  await sleep(1600);
  assert.ok(await evalJs(`document.getElementById('shaper-sync-modal').open`), '12: the re-opened dialog is still open after the first send\'s 1.2 s');

  // the auto-close still works for a dialog that was not closed meanwhile
  await typeVal('#sync-filename', 'second-788.svg');
  await clickEl('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, 'second upload succeeded');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'auto-closes after a send');

  console.log(`sync-fixes-788-live: ok (${blocked.length} non-local requests blocked)`);
} finally {
  globalThis.fetch = realFetch;
  await cdp.close();
}
