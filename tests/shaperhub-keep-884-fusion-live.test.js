// tests/shaperhub-keep-884-fusion-live.test.js — TASK 884: "Keep ShaperHub up to date" in Shaper's FUSION PANEL (the build of task 881, scripts/build-site.cjs
// shaper-fusion), served the way the add-in serves it (its own server on 127.0.0.1) plus a FAKE upload route: POST /api/shaper-upload answered by
// packages/core/shaper-cloud.js handleShaperUpload over tests/shaperhub-fake-api.js (the add-in relays the panel's upload to that same function). The fake
// Fusion bridge is the Fusion-mode tests' (a window.adsk stub; the add-in's answers through window.fusionJavaScriptHandler). Nothing leaves the machine.
//   pong + design_context (design A) -> selection_data -> an Outside on the rectangle -> Export -> Sync: sign in, Send ("Sketch1.svg" to My Files)
//   -> the panel's save_project for design A carries hubTargets.all = that file; the switch turned on;
//   the Outside one step deeper (its card's + stepper, OK) -> Generate -> the fake receives ONE upload: mode 'replace', "Sketch1.svg" in "/", the NEW svg, with the
//   login; the status line ends "✓ Replaced Sketch1.svg in My Files.";
//   design B opened (no project) -> no target; design A again (its saved project) -> the target is back.
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

const require = createRequire(import.meta.url);
const { buildFusionPanel, PANEL_MIME } = require('../scripts/build-site.cjs');
const EVID = path.resolve('.evidence/884');
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
      if (typeof p.svg === 'string') uploads.push({ mode: p.mode, filename: p.filename, remotePath: p.remotePath, svg: p.svg, login: !!(p.email && p.password) });
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

const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-fusion-panel-884-'));
buildFusionPanel(panelDir);
const panel = await servePanel(panelDir);
const cdp = await launchBrowser({ tag: '884-panel', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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

try {
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.adsk = { _sent: [], fusionSendData(action, data) { this._sent.push({ action, data }); return '{}'; } };
  })();` });
  await navigate(`http://127.0.0.1:${panel.port}/index.html`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'the Fusion bar');
  await handle('pong', { action: 'pong', fusionVersion: '2.0.20256', documentName: 'Plate v2', lengthUnits: 'mm', projectBridge: true });
  await designA(null, false);
  assert.deepStrictEqual(await hubTarget(), null, 'a new design has no target');
  await press('#btn-fusion-add-selection');
  await handle('selection_data', PAYLOAD);
  await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 6`, '6 edges in Prepare');
  await pickRectangle();
  await typeLive(t, 'exterior');
  await waitFor(`!!document.querySelector('#prepare-panel .cut-ok')`, 'the Outside operation open');
  await okCard();
  const opId = await evalJs(`import('/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'exterior').id)`);
  await showExport();

  // Sync: sign in, Send to My Files
  await pressExportAction(cdp, press, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open`, 'the Sync dialog');
  assert.strictEqual(await evalJs(`document.getElementById('sync-keep-updated').disabled`), true, 'no sign-in: the switch is disabled');
  await typeVal('#sync-email', FAKE_LOGIN.email);
  await typeVal('#sync-password', FAKE_LOGIN.password);
  assert.strictEqual(await evalJs(`document.getElementById('sync-filename').value`), NAME, 'the file name is the design\'s');
  await press('#sync-btn-submit');
  await waitFor(`document.getElementById('sync-modal-status').classList.contains('is-success')`, 'sent');
  assert.strictEqual(await evalJs(`document.getElementById('sync-modal-status').textContent`), `Sent ${NAME} to My Files`, 'the dialog says where it went');
  const firstSvg = uploads[uploads.length - 1].svg;
  assert.deepStrictEqual(await hubTarget(), TARGET, 'the target: that file in My Files');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'the dialog closes after the send');
  await waitFor(`window.adsk._sent.some((m) => m.action === 'save_project' && JSON.parse(m.data).project.hubTargets)`, 'the design\'s project saved with the target (debounced)', 15000);
  const saved = (await sentOf('save_project')).filter((m) => m.project.hubTargets).pop();
  assert.strictEqual(saved.docToken, 'tok-A', 'saved into design A');
  assert.deepStrictEqual(saved.project.hubTargets, { all: TARGET }, 'the project carries hubTargets.all');

  // the switch on
  await pressExportAction(cdp, press, 'btn-sync-shaper');
  await waitFor(`document.getElementById('shaper-sync-modal').open && !document.getElementById('sync-keep-updated').disabled`, 'signed in: the switch can be turned on');
  assert.strictEqual(await evalJs(`document.getElementById('sync-keep-hint').textContent`), `Each Generate replaces ${NAME} in My Files on ShaperHub.`, 'its hint names the file and the folder');
  await press('#sync-keep-updated');
  await waitFor(`document.getElementById('sync-keep-updated').checked`, 'the switch on');
  await shot('fusion-panel-dialog-switch-on.png', '#shaper-sync-modal');
  await press('#sync-modal-close');
  await waitFor(`!document.getElementById('shaper-sync-modal').open`, 'the dialog closes');

  // the Outside one step deeper, then Generate
  await press('.sk-header-tab[data-tab="prepare"]');
  await waitFor(`!document.getElementById('view-prepare').hidden`, 'Prepare');
  await openOpLive(t, opId);
  await press('.cut-row[data-param="cutDepth"] .cut-step[data-d="1"]');
  await okCard();
  await showExport();
  const n = uploads.length;
  await pressExportAction(cdp, press, 'btn-generate-svg');
  await waitFor(`document.getElementById('simexport-status').textContent.includes(${JSON.stringify(`✓ Replaced ${NAME} in My Files.`)})`, 'Generate replaced the target', 60000);
  const after = uploads.slice(n);
  assert.strictEqual(after.length, 1, 'one upload');
  const u = after[0];
  console.log(`panel replace: mode=${u.mode} filename=${u.filename} remotePath=${u.remotePath} login=${u.login} depths ${JSON.stringify(svgDepths(firstSvg))} -> ${JSON.stringify(svgDepths(u.svg))}`);
  assert.deepStrictEqual([u.mode, u.filename, u.remotePath, u.login], ['replace', NAME, '/', true], 'mode replace, the same name and folder, the login carried');
  assert.notDeepStrictEqual(svgDepths(u.svg), svgDepths(firstSvg), 'the NEW svg (the new depth)');
  console.log('panel status line: ' + await evalJs(`document.getElementById('simexport-status').textContent`));
  await shot('fusion-panel-status-replaced.png', '#simexport-status');

  // design B, then design A again from its saved project: the target follows the design (the project the panel saved for A)
  await waitFor(`window.adsk._sent.filter((m) => m.action === 'save_project').length > 0`, 'a save of design A');
  await handle('design_context', { action: 'design_context', docToken: 'tok-B', designKey: null, docName: 'Bracket v1', lengthUnits: 'mm', hasSelection: false, project: null });
  assert.deepStrictEqual(await hubTarget(), null, 'design B: no target');
  const projectA = (await sentOf('save_project')).filter((m) => m.docToken === 'tok-A').pop().project;
  assert.deepStrictEqual(projectA.hubTargets, { all: TARGET }, 'the last saved project of design A still carries its target');
  await designA(projectA, false);
  assert.deepStrictEqual(await hubTarget(), TARGET, 'design A again: its target is back');

  const outside = requested.filter((x) => !x.startsWith(`http://127.0.0.1:${panel.port}/`) && !/^(data|blob):/.test(x));
  assert.deepStrictEqual(outside, [], 'the panel requests nothing outside its own server');
  assert.deepStrictEqual(api.blocked, [], 'every Shaper call was answered by the fake');
  console.log(`shaperhub-keep-884-fusion-live: ok (${uploads.length} svg uploads: ${uploads.map((x) => x.mode).join(', ')})`);
} finally {
  globalThis.fetch = realFetch;
  await close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(panelDir, { recursive: true, force: true });
}
