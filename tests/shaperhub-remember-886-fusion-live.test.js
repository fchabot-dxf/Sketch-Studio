// tests/shaperhub-remember-886-fusion-live.test.js — TASK 886: "Remember login on this computer" in Shaper's FUSION PANEL (the build of task 881), served the way
// the add-in serves it plus the FAKE upload route (packages/core/shaper-cloud.js handleShaperUpload over tests/shaperhub-fake-api.js; nothing leaves the machine),
// the same harness as shaperhub-keep-884-fusion-live. The same code path as the website (shaper-app.js):
//   design A: an Outside, Export, Sync: the fake login, the box ticked, Send -> kept under the one key (the scan finds it there only);
//   the panel RELOADED (Fusion restarted), design A's saved project given back, the dialog NOT opened: the Outside one step deeper, Generate -> the fake gets
//   mode 'replace' WITH the login (Autosend on by default), ONE success toast;
//   Switch account deletes it, a Send ticked keeps it again; reloaded: the dialog filled and ticked; unticked -> deleted; reloaded again -> Generate sends
//   nothing and says ShaperHub was not updated; the login is nowhere.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { pressExportAction } from './helpers/export-actions.js';
import { typeLive, openOpLive } from './helpers/prepare-open-live.js';
import { createFakeShaperApi, FAKE_LOGIN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';
import { pageLoginPlaces, REMEMBERED_PLACE } from './shaperhub-login-scan.js';

const require = createRequire(import.meta.url);
const { buildFusionPanel, PANEL_MIME } = require('../scripts/build-site.cjs');
const EVID = path.resolve('.evidence/886');
fs.mkdirSync(EVID, { recursive: true });

// the payload of fusion-panel-881-live (a 40 x 30 rectangle with a 5 mm hole, the hole's disk, an open chain, a construction line), of design A
const PAYLOAD = {
  action: 'selection_data', version: 1, docToken: 'tok-A', units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { kind: 'sketch', name: 'Sketch1' }, stock: { thicknessMm: null },
  regions: [
    { id: 'reg_0', label: 'Profile 1', cutType: null, depthMm: null,
      outer: { closed: true, segments: [{ type: 'line', x1: 0, y1: 0, x2: 40, y2: 0 }, { type: 'line', x1: 40, y1: 0, x2: 40, y2: 30 }, { type: 'line', x1: 40, y1: 30, x2: 0, y2: 30 }, { type: 'line', x1: 0, y1: 30, x2: 0, y2: 0 }] },
      holes: [{ closed: true, segments: [{ type: 'circle', cx: 20, cy: 15, r: 5 }] }] },
    { id: 'reg_1', label: 'Profile 2', cutType: null, depthMm: null, outer: { closed: true, segments: [{ type: 'circle', cx: 20, cy: 15, r: 5 }] }, holes: [] },
  ],
  chains: [
    { id: 'chain_0', label: 'Chain 1', cutType: null, depthMm: null, closed: false, segments: [{ type: 'line', x1: 50, y1: 0, x2: 70, y2: 10 }] },
    { id: 'chain_1', label: 'Chain 2', cutType: null, depthMm: null, closed: false, segments: [{ type: 'line', x1: 0, y1: 15, x2: 40, y2: 15, construction: true }] },
  ],
  warnings: [],
};
const NAME = 'Sketch1.svg'; // the design takes the selection's name (fusion-import.js selectionDesignName: the payload names no document, so its source "Sketch1")
const TARGET = { filename: NAME, remotePath: '/' };

const realFetch = globalThis.fetch;
const api = createFakeShaperApi({ passLocal: realFetch }); // local requests (the browser's CDP endpoint) pass
globalThis.fetch = api.fetch; // handleShaperUpload's Shaper calls go to the fake (every other request is blocked by it)
const uploads = []; // the svg uploads the route received ({ mode, filename, remotePath, svg, login })
// the add-in's server (SA-32: the folder's files, each with its media type) + the upload route the add-in relays
function servePanel(root) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (req.method === 'POST' && url === '/api/shaper-upload') {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      const p = JSON.parse(body);
      if (typeof p.svg === 'string') uploads.push({ mode: p.mode, filename: p.filename, remotePath: p.remotePath, svg: p.svg, login: p.email === FAKE_LOGIN.email && p.password === FAKE_LOGIN.password });
      const { status, body: answer } = await handleShaperUpload(body);
      res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer));
      log.push({ url, status });
      return;
    }
    const file = path.join(root, url === '/' ? 'index.html' : url.slice(1));
    try {
      if (!path.resolve(file).startsWith(path.resolve(root))) throw new Error('outside');
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': PANEL_MIME[path.extname(file).toLowerCase()] });
      res.end(data);
      log.push({ url, status: 200 });
    } catch (e) { res.writeHead(404); res.end('not found'); log.push({ url, status: 404 }); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, log })));
}

const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-fusion-panel-886-'));
buildFusionPanel(panelDir);
const panel = await servePanel(panelDir);
const cdp = await launchBrowser({ tag: '886-panel', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { panel.server.close(); globalThis.fetch = realFetch; console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, evalJs, waitFor, navigate, waitForApp, close, ws } = cdp;
const requested = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') requested.push(m.params.request.url); });

const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
};
const press = async (sel) => { const c = await centre(sel); assert.ok(c && c.hit, sel + ' is there to press ' + JSON.stringify(c)); await clickAt(c.x, c.y); };
const t = { clickEl: press, evalJs, waitFor };
const handle = (action, payload) => evalJs(`window.fusionJavaScriptHandler.handle(${JSON.stringify(action)}, ${JSON.stringify(JSON.stringify(payload))})`);
const typeVal = (sel, val) => evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(val)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const sentOf = (action) => evalJs(`window.adsk._sent.filter((m) => m.action === ${JSON.stringify(action)}).map((m) => JSON.parse(m.data))`);
const hubTarget = () => evalJs(`import('/src/shaperhub-target.js').then((m) => m.getHubTarget('all'))`);
const generated = () => waitFor(`import('/src/op-paths.js').then((m) => m.generatingCount() === 0)`, 'the paths generated (in the background)', 120000);
const okCard = async () => { await press('#prepare-panel .cut-ok'); await sleep(200); await generated(); };
const shot = async (name, sel) => {
  const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, b.left - 8), y: Math.max(0, b.top - 8), width: b.width + 16, height: b.height + 16 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1.5 } });
  fs.writeFileSync(path.join(EVID, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVID, name));
};
const svgDepths = (svg) => [...svg.matchAll(/shaper:cutDepth="([^"]+)"/g)].map((x) => x[1]);
const showExport = async () => {
  await press('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, 'the Export stage');
};
const designA = (project, hasSelection) => handle('design_context', { action: 'design_context', docToken: 'tok-A', designKey: project ? 'key-A' : null, docName: 'Plate v2', lengthUnits: 'mm', hasSelection, project });
const pickRectangle = async () => {
  const at = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = 6; pt.y = -6; const p = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  await clickAt(at.x, at.y);
  await waitFor(`!!(window.__prepareView && window.__prepareView.selectedTargets().length === 1)`, 'the rectangle region picked');
};

const KEY = 'shaper-hub-remembered-login'; // shaperhub-login.js REMEMBER_LOGIN_KEY
const stored = () => evalJs(`localStorage.getItem(${JSON.stringify(KEY)})`);
const SECRETS = [FAKE_LOGIN.email, FAKE_LOGIN.password];
const consoleLines = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || '')).join(' ')); });
const scan = async (label, allowed) => {
  const hits = await pageLoginPlaces(evalJs, SECRETS);
  const logged = consoleLines.filter((l) => SECRETS.some((x) => l.includes(x)));
  console.log(label + `: login scan: page ${JSON.stringify(hits)}, console lines carrying it ${logged.length}`);
  assert.deepStrictEqual(hits, allowed, label + ': the login is exactly in ' + JSON.stringify(allowed));
  assert.deepStrictEqual(logged, [], label + ': no console line carries it');
};
const watchToasts = () => evalJs(`(() => { if (window.__test886Toasts) return; window.__test886Toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes)
  if (n.nodeType === 1 && n.parentElement && n.parentElement.id === 'notification-container') window.__test886Toasts.push({ level: n.getAttribute('data-level'), text: n.textContent }); }).observe(document.body, { childList: true, subtree: true }); })()`);
const toasts = () => evalJs(`window.__test886Toasts.slice()`);
const PANEL = `http://127.0.0.1:${panel.port}/index.html`;
const formLogin = () => evalJs(`({ email: document.getElementById('sync-email').value, password: document.getElementById('sync-password').value })`);
const loadPanel = async () => {
  await navigate(PANEL);
  await waitForApp('design-canvas');
  await watchToasts();
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'the Fusion bar');
  await handle('pong', { action: 'pong', fusionVersion: '2.0.20256', documentName: 'Plate v2', lengthUnits: 'mm', projectBridge: true });
};
const lastProjectA = async () => (await sentOf('save_project')).filter((m) => m.docToken === 'tok-A' && m.project && m.project.hubTargets).pop().project;
const deeper = async () => {
  const opId = await evalJs(`import('/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'exterior').id)`);
  await press('.sk-header-tab[data-tab="prepare"]');
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'Prepare');
  await openOpLive(t, opId);
  await press('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]');
  await okCard();
  await showExport();
};
// the panel after Fusion restarted: a new page, design A named with its saved project; it asks for the selection (request_selection) and the add-in sends it
// again (TASK 855's reopen: the operations keep their settings through the regions' signatures)
let selectionId = null; // the id the first import gave the selection (the add-in sends it back on a reopen)
const reloadA = async (project, label) => {
  await loadPanel();
  await designA(project, true);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'request_selection')`, label + ': the panel asks for the selection');
  await handle('selection_data', { ...PAYLOAD, selectionId });
  assert.deepStrictEqual(await hubTarget(), TARGET, label + ': design A\'s target is back (its project)');
  await waitFor(`import('/src/operations-store.js').then((m) => m.storeOps().some((o) => o.type === 'exterior'))`, label + ': its Outside is back (its project)');
  await generated();
  await showExport();
};
const openSync = async () => {
  await pressExportAction(cdp, press, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'the Sync dialog');
  await sleep(250);
};
const sendFromDialog = async (label) => {
  await press('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success') || !document.getElementById('sync-exists').hidden`, label + ': sent or asked');
  if (await evalJs(`!document.getElementById('sync-exists').hidden`)) await press('#sync-btn-replace');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, label + ': sent');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, label + ': the dialog closes after the send');
};

try {
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.adsk = { _sent: [], fusionSendData(action, data) { this._sent.push({ action, data }); return '{}'; } };
  })();` });
  await loadPanel();
  assert.strictEqual(await stored(), null, 'a new profile: nothing kept');
  await designA(null, false);
  await press('#btn-fusion-add-selection');
  await handle('selection_data', PAYLOAD);
  await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 6`, '6 edges in Prepare');
  await pickRectangle();
  await typeLive(t, 'exterior');
  await waitFor(`!!document.querySelector('#prepare-panel .cut-ok')`, 'the Outside operation open');
  await okCard();
  await showExport();
  selectionId = await evalJs(`import('/src/selection-list.js').then((m) => m.getSelections()[0].id)`);

  // Sync: the box unticked; the fake login, ticked, Send
  await openSync();
  assert.strictEqual(await evalJs(`document.getElementById('sync-remember-login').checked`), false, 'unticked by default');
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  await press('label[for="sync-remember-login"]');
  await waitFor(`document.getElementById('sync-remember-login').checked`, 'ticked');
  await shot('fusion-panel-remember-ticked.png', '#sync-creds');
  await sendFromDialog('first send');
  const firstSvg = uploads[uploads.length - 1].svg;
  assert.deepStrictEqual(JSON.parse(await stored()), FAKE_LOGIN, 'ticked + Send: the login kept under the one key');
  await scan('panel ticked', [REMEMBERED_PLACE]);
  await waitFor(`window.adsk._sent.some((m) => m.action === 'save_project' && JSON.parse(m.data).docToken === 'tok-A' && JSON.parse(m.data).project.hubTargets)`, 'design A\'s project saved with the target', 15000);
  await sleep(1500); // the debounced save of the last state
  const projectA = await lastProjectA();

  // Fusion restarted: the panel reloaded, design A's project given back; the dialog NOT opened
  await reloadA(projectA, 'reload');
  assert.deepStrictEqual(await formLogin(), FAKE_LOGIN, 'reload: the kept login filled the sign-in');
  await deeper();
  const n = uploads.length;
  await pressExportAction(cdp, press, 'btn-generate-svg');
  await waitFor(`/Exported/.test(document.getElementById('simexport-status').textContent)`, 'Generate done', 60000);
  await waitFor(`!/Replacing/.test(document.getElementById('simexport-status').textContent)`, 'the replace answered', 30000);
  const line1 = await evalJs(`document.getElementById('simexport-status').textContent`);
  assert.ok(line1.includes(`✓ Replaced ${NAME} in My Files.`), 'Generate replaced the target: ' + line1 + ' ' + JSON.stringify(await evalJs(`import('/src/shaperhub-target.js').then((m) => m.getHubTargets())`)));
  const after = uploads.slice(n);
  assert.strictEqual(after.length, 1, 'one upload');
  const u = after[0];
  console.log(`panel replace after reload: mode=${u.mode} filename=${u.filename} remotePath=${u.remotePath} login=${u.login} depths ${JSON.stringify(svgDepths(firstSvg))} -> ${JSON.stringify(svgDepths(u.svg))}`);
  assert.deepStrictEqual([u.mode, u.filename, u.remotePath, u.login], ['replace', NAME, '/', true], 'mode replace, the target, WITH the kept login');
  assert.notDeepStrictEqual(svgDepths(u.svg), svgDepths(firstSvg), 'the NEW svg');
  assert.strictEqual(await evalJs(`document.getElementById('shaper-sync-modal').open`), false, 'no dialog opened');
  await waitFor(`window.__test886Toasts.length > 0`, 'the Autosend toast');
  await sleep(500);
  const tw = await toasts();
  console.log('panel toasts: ' + JSON.stringify(tw));
  assert.ok(tw.length === 1 && tw[0].level === 'success' && tw[0].text.includes(`Sent ${NAME} to ShaperHub (My Files)`), 'ONE success toast: ' + JSON.stringify(tw));
  console.log('panel status line: ' + await evalJs(`document.getElementById('simexport-status').textContent`));
  await shot('fusion-panel-autosend-after-reload.png', '#simexport-status');
  await scan('panel after the autosend', [REMEMBERED_PLACE]);

  // Switch account deletes it; a Send with the box still ticked keeps it again
  await openSync();
  await waitFor(`!document.getElementById('sync-session').hidden`, 'signed in for this session (the replace got a token)');
  await press('#sync-btn-switch');
  assert.strictEqual(await stored(), null, 'Switch account deleted the kept login');
  await waitFor(`!document.getElementById('sync-creds').hidden`, 'the sign-in shows');
  assert.strictEqual(await evalJs(`document.getElementById('sync-remember-login').checked`), true, 'the box still ticked');
  await sendFromDialog('send again');
  assert.deepStrictEqual(JSON.parse(await stored()), FAKE_LOGIN, 'kept again');
  await sleep(1500);
  const projectA2 = await lastProjectA();

  // reloaded: filled and ticked; unticked -> deleted at once; reloaded again -> no sign-in, nothing anywhere
  await reloadA(projectA2, 'reload 2');
  await openSync();
  assert.deepStrictEqual(await formLogin(), FAKE_LOGIN, 'reload 2: the dialog shows the kept login');
  assert.strictEqual(await evalJs(`document.getElementById('sync-remember-login').checked`), true, 'reload 2: ticked');
  await press('label[for="sync-remember-login"]');
  await waitFor(`!document.getElementById('sync-remember-login').checked`, 'unticked');
  assert.strictEqual(await stored(), null, 'unticked: deleted at once');
  await press('#sync-modal-close');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'the dialog closes');
  await reloadA(projectA2, 'reload 3');
  assert.deepStrictEqual(await formLogin(), { email: '', password: '' }, 'reload 3: the fields are empty');
  const n3 = uploads.length;
  await pressExportAction(cdp, press, 'btn-generate-svg');
  await waitFor(`document.getElementById('simexport-status').textContent.includes('ShaperHub not updated')`, 'Generate without a sign-in', 60000);
  await sleep(800);
  assert.strictEqual(uploads.length, n3, 'reload 3: nothing sent');
  await openSync();
  assert.strictEqual(await evalJs(`document.getElementById('sync-keep-hint').textContent`), 'Needs a sign-in for this session.', 'reload 3: the switch needs a sign-in');
  await press('#sync-modal-close');
  await scan('panel unticked', []);

  const outside = requested.filter((x) => !x.startsWith(`http://127.0.0.1:${panel.port}/`) && !/^(data|blob):/.test(x));
  assert.deepStrictEqual(outside, [], 'the panel requests nothing outside its own server');
  assert.deepStrictEqual(api.blocked, [], 'every Shaper call was answered by the fake');
  console.log(`shaperhub-remember-886-fusion-live: ok (${uploads.length} svg uploads: ${uploads.map((x) => x.mode).join(', ')})`);
} finally {
  globalThis.fetch = realFetch;
  await close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(panelDir, { recursive: true, force: true });
}
