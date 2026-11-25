// tests/shaperhub-keep-884-live.test.js — TASK 884 (owner turns 3591-3597): "Keep ShaperHub up to date" on Shaper's WEBSITE, in a real browser, desktop 1280 x 800
// (mouse) and phone 390 x 844 (touch). FAKE ShaperHub only: /api/shaper-upload is answered node-side by packages/core/shaper-cloud.js handleShaperUpload over
// tests/shaperhub-fake-api.js; every non-local request is blocked and counted. The login is the fake's (never printed).
//   each phase: a Pocket planned; Generate with the switch off sends nothing; the dialog's switch is disabled before a sign-in ("Needs a sign-in for this session.");
//   sign in, open Furniture, Send -> the design's target is that file + folder; the dialog again: the switch enabled, its hint names them; turned ON;
//   Prepare: the Pocket's depth one step up (its card's + stepper, OK); Generate -> the fake receives ONE upload, mode 'replace', the same name and folder and the
//   NEW svg (the new depth), with the login (THE REPLACE RULE); the status line ends "✓ Replaced <name> in My Files/Furniture." (no dialog, no toast);
//   desktop only: three Generates while a replace is held -> two replaces in all (the first, then the LATEST), never two at once; a reload -> the target is still
//   the design's, the switch is on but disabled (no sign-in in this new page), a Generate sends nothing and says ShaperHub was not updated.
// Screenshots (cropped to the dialog) to .evidence/884/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressExportAction } from './helpers/export-actions.js';
import { openOpLive, okLive } from './helpers/prepare-open-live.js';
import { createFakeShaperApi, FAKE_LOGIN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';

const EVID = path.resolve('.evidence/884');
fs.mkdirSync(EVID, { recursive: true });
const NAME = 'shaper-export.svg'; // the Untitled design's file name (export-payload.js exportFileName)
const TARGET = { filename: NAME, remotePath: '/Furniture/' };
const REPLACED = `✓ Replaced ${NAME} in My Files/Furniture.`;

const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ folders: ['Furniture'], passLocal: realFetch });
globalThis.fetch = api.fetch;

const cdp = await launchBrowser({ tag: '884-keep', width: 1280, height: 800 });
if (!cdp) { globalThis.fetch = realFetch; console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, ws, send, evalJs, waitFor, navigate, waitForApp, close } = cdp;
const LOCAL = `http://127.0.0.1:${port}/`;
const blocked = [];
const uploads = []; // every /api/shaper-upload request body that carried an svg ({ mode, filename, remotePath, svg, login: whether email + password were sent })
let hold = null; // while set, a replace waits for it before it is answered
let inFlight = 0, mostInFlight = 0;

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  if (!request.url.startsWith(LOCAL)) { blocked.push(request.url); send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
  if (new URL(request.url).pathname === '/api/shaper-upload') {
    const body = request.postData !== undefined ? request.postData : (request.postDataEntries || []).map((x) => Buffer.from(x.bytes || '', 'base64').toString('utf8')).join('');
    const p = JSON.parse(body);
    const isSvg = typeof p.svg === 'string';
    if (isSvg) { uploads.push({ mode: p.mode, filename: p.filename, remotePath: p.remotePath, svg: p.svg, login: !!(p.email && p.password) }); inFlight++; mostInFlight = Math.max(mostInFlight, inFlight); }
    const wait = isSvg && p.mode === 'replace' && hold ? hold.promise : Promise.resolve();
    wait.then(() => handleShaperUpload(body)).then(({ status, body: answer }) => {
      if (isSvg) inFlight--;
      return send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(answer)).toString('base64') });
    });
    return;
  }
  send('Fetch.continueRequest', { requestId });
});
await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Browser.setDownloadBehavior', { behavior: 'deny' }); // Generate's download: not needed here

let phone = false;
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
const press = async (x, y) => {
  if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
  else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
  await sleep(250);
};
// a real click / tap on the element's centre, after checking nothing covers it there
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
const shot = async (name, sel = '#shaper-sync-modal') => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); const m = 8;
    const x = Math.max(0, r.left - m), y = Math.max(0, r.top - m); return { x, y, width: Math.min(innerWidth, r.right + m) - x, height: Math.min(innerHeight, r.bottom + m) - y, scale: ${phone ? 1 : 1.5} }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVID, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVID, name));
};
const statusText = () => evalJs(`document.getElementById('simexport-status').textContent`);
const hubTarget = () => evalJs(`import('/apps/shaper/src/shaperhub-target.js').then((m) => m.getHubTarget('all'))`); // everything ticked: the 'all' set
const keep = () => evalJs(`(() => { const c = document.getElementById('sync-keep-updated'); return { checked: c.checked, disabled: c.disabled, hint: document.getElementById('sync-keep-hint').textContent, label: document.querySelector('label.sync-keep-row').textContent.trim() }; })()`);
const setting = () => evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.get('SHAPER_HUB_KEEP_UP_TO_DATE'))`);
const openDialog = async () => {
  await pressExportAction(cdp, clickEl, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'the Sync dialog opens');
  await sleep(250);
};
const closeDialog = async () => { await clickEl('#sync-modal-close'); await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'the dialog closes'); };
// Generate (the header's, the drawer's on a phone); `done` = what the status line must show when it is done
const generate = async (done, what) => {
  await evalJs(`document.getElementById('simexport-status').replaceChildren()`);
  await pressExportAction(cdp, clickEl, 'btn-generate-svg');
  await waitFor(`(${done})(document.getElementById('simexport-status').textContent)`, what, 60000);
};
const svgDepths = (svg) => [...svg.matchAll(/shaper:cutDepth="([^"]+)"/g)].map((x) => x[1]);

async function phase(label) {
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitForApp('design-canvas');
  await resetBufferLive(cdp);
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitForApp('design-canvas');
  await waitFor(`!!(window.__designController && window.__designController.state)`, label + ': the design controller');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('SHAPER_HUB_KEEP_UP_TO_DATE', false))`); // each phase starts with the switch at its default (off)
  // two rectangles (120 x 70, 80 x 70), a Pocket 6 mm deep on one, 8 mm on the other: two operations (the plan set through the page's own cut-plan module, before any send)
  await evalJs(`(async () => { const st = window.__designController.state;
    [[0, 0], [120, 0], [120, 70], [0, 70], [150, 0], [230, 0], [230, 70], [150, 70]].forEach(([x, y], i) => st.joints.set('Rj' + i, { x, y }));
    for (let i = 0; i < 8; i++) st.shapes.push({ id: 'Rs' + i, type: 'line', joints: ['Rj' + i, 'Rj' + (i < 4 ? (i + 1) % 4 : 4 + ((i - 3) % 4))] });
    st.saveState('draw');
    const lf = await import('/packages/core/loop-finder.js'); const cp = await import('/tests/helpers/plan-v2.js');
    const loops = lf.findLoops(st);
    cp.V2_PLAN.set('loop:' + loops[0].id, { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 });
    cp.V2_PLAN.set('loop:' + loops[1].id, { cutType: 'pocket', cutDepth: 8, cutOffset: 0, toolDia: 6.35 }); })()`);
  const ops = await evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => ({ id: o.id, depth: o.settings.cutDepth, on: o.on !== false })))`);
  assert.strictEqual(ops.length, 2, label + ': two operations ' + JSON.stringify(ops));
  const sixId = ops.find((o) => Number(o.depth) === 6).id;
  await openStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export step');
  assert.deepStrictEqual(await hubTarget(), null, label + ': a new design has no target');

  // ── switch off (and no target): Generate sends nothing ──
  const n0 = uploads.length;
  await generate(`(s) => s.includes('Drop it into')`, label + ': Generate (switch off)');
  await sleep(800);
  assert.strictEqual(uploads.length, n0, label + ': switch off -> Generate sent nothing');

  // ── the dialog before a sign-in: the switch is disabled, its hint says what it needs ──
  await openDialog();
  const k0 = await keep();
  console.log(label + ' switch before a sign-in: ' + JSON.stringify(k0));
  assert.deepStrictEqual(k0, { checked: false, disabled: true, hint: 'Needs a sign-in for this session.', label: 'Keep ShaperHub up to date' }, label + ': no sign-in -> the switch is off and disabled');
  await shot(`${label}-dialog-signed-out.png`);
  if (phone) {
    const row = await evalJs(`(() => { const r = document.querySelector('label.sync-keep-row').getBoundingClientRect(), d = document.getElementById('shaper-sync-modal').getBoundingClientRect(); return { h: Math.round(r.height), left: Math.round(d.left), right: Math.round(d.right), doc: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
    console.log('phone switch row: ' + JSON.stringify(row));
    assert.ok(row.h >= 44 && row.left >= 0 && row.right <= 390 && row.doc <= row.vw, 'phone: the switch row is a 44 px target, the dialog inside the screen, no sideways scroll: ' + JSON.stringify(row));
  }

  // ── sign in, open Furniture, Send ──
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await clickEl('#sync-btn-browse');
  await waitFor(`!!document.querySelector('#sync-folder-list [data-folder="Furniture"]')`, label + ': My Files listed');
  await clickEl('#sync-folder-list [data-folder="Furniture"]');
  await waitFor(`document.querySelector('#sync-breadcrumbs [aria-current="location"]').dataset.path === '/Furniture/'`, label + ': Furniture open');
  assert.strictEqual(await evalJs(`document.getElementById('sync-filename').value`), NAME, label + ': the file name is the design\'s');
  const n1 = uploads.length;
  await clickEl('#sync-btn-submit');
  if (label === 'phone') { // the desktop phase put the file there (the same fake): the "already in My Files" question, answered Replace it
    await waitFor(`!document.getElementById('sync-exists').hidden`, label + ': the exists question');
    await clickEl('#sync-btn-replace');
  }
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, label + ': sent');
  assert.strictEqual(await evalJs(`document.getElementById('sync-modal-status').textContent`), label === 'phone' ? `Replaced ${NAME} in My Files/Furniture` : `Sent ${NAME} to My Files/Furniture`, label + ': the dialog says where it went');
  assert.deepStrictEqual(uploads.slice(n1).map((u) => u.mode), label === 'phone' ? ['new', 'replace'] : ['new'], label + ': Send (and Replace it) as before');
  const firstSvg = uploads[uploads.length - 1].svg;
  assert.deepStrictEqual(await hubTarget(), TARGET, label + ': the target is the file and the folder of that send');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, label + ': the dialog closes after the send (TASK 758)');

  // ── the dialog again: the switch enabled, the hint names the file and folder; turn it ON ──
  await openDialog();
  await waitFor(`!document.getElementById('sync-keep-updated').disabled`, label + ': signed in -> the switch can be turned on');
  const k1 = await keep();
  assert.deepStrictEqual(k1, { checked: false, disabled: false, hint: `Each Generate replaces ${NAME} in My Files/Furniture on ShaperHub.`, label: 'Keep ShaperHub up to date' }, label + ': the hint says exactly what it does');
  await clickEl('#sync-keep-updated');
  await waitFor(`document.getElementById('sync-keep-updated').checked`, label + ': the switch on');
  assert.strictEqual(await setting(), true, label + ': the device setting is on');
  await shot(`${label}-dialog-switch-on.png`);
  await closeDialog();

  // ── Prepare: the Pocket one step deeper (its card's + stepper, then OK) ──
  await openStage('prepare');
  await waitFor(`!!window.__prepareView`, label + ': Prepare');
  await openOpLive(t, sixId);
  await clickEl('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]');
  await okLive(t);
  await openStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export step again');

  // ── Generate: the target replaced, quietly ──
  const n2 = uploads.length;
  await generate(`(s) => s.includes(${JSON.stringify(REPLACED)})`, label + ': Generate replaced the target');
  const sent2 = uploads.slice(n2);
  assert.strictEqual(sent2.length, 1, label + ': one upload');
  const u = sent2[0];
  console.log(label + ` replace: mode=${u.mode} filename=${u.filename} remotePath=${u.remotePath} login=${u.login} depths ${JSON.stringify(svgDepths(firstSvg))} -> ${JSON.stringify(svgDepths(u.svg))}`);
  assert.deepStrictEqual([u.mode, u.filename, u.remotePath, u.login], ['replace', NAME, '/Furniture/', true], label + ': mode replace, the same name and folder, the login carried');
  assert.notStrictEqual(u.svg, firstSvg, label + ': the NEW svg');
  assert.notDeepStrictEqual(svgDepths(u.svg), svgDepths(firstSvg), label + ': with the new depth');
  const line = await statusText();
  console.log(label + ' status line: ' + line);
  assert.ok(line.startsWith(`Exported 2 cuts → ${NAME}.`) && line.includes(REPLACED), label + ': the status line says it was replaced: ' + line);
  assert.strictEqual(await evalJs(`document.getElementById('shaper-sync-modal').open`), false, label + ': no dialog opened');
  assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-notification, .notification, .sk-toast').length`), 0, label + ': no toast');
  await shot(`${label}-status-replaced.png`, '#simexport-status');
  return { firstSvg, ops, sixId };
}

try {
  // ── desktop 1280 x 800 ──
  const { ops: dOps, sixId } = await phase('desktop');

  // a PARTIAL file (one operation unticked): its own name; its set was never sent, so Generate replaces NOTHING (the full file is never replaced by a partial one)
  const otherId = dOps.find((o) => o.id !== sixId).id;
  const sixNo = dOps.findIndex((o) => o.id === sixId) + 1; // its number in the Operations list
  await openStage('prepare');
  await clickEl(`#prepare-ops .ops-row[data-id="${otherId}"] .ops-tick`);
  await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.opById(${JSON.stringify(otherId)}).on === false)`, 'partial: the other operation unticked');
  await openStage('review');
  const PART = `shaper-export - Pocket ${sixNo}.svg`;
  const n5 = uploads.length;
  await generate(`(s) => s.includes('Drop it into')`, 'partial: Generate');
  await sleep(1000);
  assert.strictEqual(uploads.length, n5, 'partial: no target for these ticks -> nothing sent (the full file stays as it was)');
  const partLine = await statusText();
  console.log('partial status line: ' + partLine);
  assert.ok(partLine.startsWith(`Exported 1 cut → ${PART}.`), 'partial: the file is named after its ticked operation: ' + partLine);
  await openDialog();
  assert.strictEqual(await evalJs(`document.getElementById('sync-filename').value`), PART, 'partial: the dialog offers the name of the partial file');
  assert.deepStrictEqual(await keep(), { checked: true, disabled: false, hint: 'Each Generate replaces the file last sent with the operations ticked now: send it once first.', label: 'Keep ShaperHub up to date' }, 'partial: the hint says these ticks were never sent');
  await shot('desktop-dialog-partial-never-sent.png');
  await closeDialog();
  await openStage('prepare');
  await clickEl(`#prepare-ops .ops-row[data-id="${otherId}"] .ops-tick`);
  await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.opById(${JSON.stringify(otherId)}).on !== false)`, 'partial: ticked again');
  await openStage('review');

  // queue of one: three Generates while the first replace is held -> two replaces (the first, then the latest), never two at once
  let release; hold = { promise: new Promise((r) => { release = r; }) };
  mostInFlight = 0;
  const n3 = uploads.length;
  await generate(`(s) => s.includes('Replacing ${NAME}')`, 'queue: Generate 1 (its replace held)');
  await waitFor(`true`, 'tick');
  for (let i = 0; i < 50 && uploads.length === n3; i++) await sleep(100);
  assert.strictEqual(uploads.length - n3, 1, 'queue: the first replace is in flight');
  await generate(`(s) => s.includes('Replacing ${NAME}')`, 'queue: Generate 2 (waits)');
  await generate(`(s) => s.includes('Replacing ${NAME}')`, 'queue: Generate 3 (takes 2\'s place)');
  await sleep(800);
  assert.strictEqual(uploads.length - n3, 1, 'queue: nothing more is sent while the first runs');
  hold = null; release();
  await waitFor(`document.getElementById('simexport-status').textContent.includes(${JSON.stringify(REPLACED)})`, 'queue: the latest Generate\'s line says replaced', 30000);
  await sleep(800);
  assert.strictEqual(uploads.length - n3, 2, 'queue: two replaces in all (the first, then ONE more)');
  assert.strictEqual(mostInFlight, 1, 'queue: never two replaces at once');
  assert.ok(uploads.slice(n3).every((x) => x.mode === 'replace' && x.filename === NAME && x.remotePath === '/Furniture/'), 'queue: both replace the target');

  // a reload: the target is still the design's; no sign-in in the new page -> the switch on but disabled, a Generate sends nothing and says so
  await waitFor(`import('/packages/ui/project-store.js').then((PS) => PS.getProjectStore().readBuffer({})).then((b) => JSON.stringify(b).includes('"hubTargets"'))`, 'the working buffer holds the target (the Untitled design lives there)');
  await navigate(`${LOCAL}apps/shaper/index.html`, 10000);
  await waitForApp('design-canvas');
  await waitFor(`!!(window.__designController && window.__designController.state && window.__designController.state.shapes.length === 8)`, 'reload: the design is back');
  assert.deepStrictEqual(await hubTarget(), TARGET, 'reload: the design keeps its target');
  await openStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, 'reload: the Export step');
  const n4 = uploads.length;
  await generate(`(s) => s.includes('ShaperHub not updated')`, 'reload: Generate without a sign-in');
  await sleep(800);
  assert.strictEqual(uploads.length, n4, 'reload: no sign-in -> nothing sent');
  console.log('reload status line: ' + await statusText());
  assert.ok((await statusText()).includes('ShaperHub not updated: sign in with Sync to ShaperHub to keep it up to date.'), 'reload: the status line says the file there is not the new one');
  await openDialog();
  const k2 = await keep();
  assert.deepStrictEqual(k2, { checked: true, disabled: true, hint: 'Needs a sign-in for this session.', label: 'Keep ShaperHub up to date' }, 'reload: the switch on, disabled, its hint says what it needs');
  await shot('desktop-dialog-after-reload.png');
  await closeDialog();

  // ── phone 390 x 844, touch ──
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  phone = true;
  await phase('phone');

  assert.deepStrictEqual(blocked, [], 'no request left the machine');
  assert.deepStrictEqual(api.blocked, [], 'every Shaper call was answered by the fake');
  console.log(`shaperhub-keep-884-live: ok (${uploads.length} svg uploads to the fake: ${uploads.map((x) => x.mode).join(', ')})`);
} finally {
  globalThis.fetch = realFetch;
  await close();
}
