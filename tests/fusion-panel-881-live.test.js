// tests/fusion-panel-881-live.test.js — TASK 881: the BUILT Fusion panel (scripts/build-site.cjs shaper-fusion), served the way the add-in serves it (SA-32:
// its own static server on 127.0.0.1, index.html at the top), in headless Edge with the fake Fusion bridge of the Fusion-mode tests (fusion-mode-663 /
// fusion-import-664: a window.adsk stub before load, the add-in's answers through window.fusionJavaScriptHandler). The SAME flow runs first on the website in
// Fusion mode (/apps/shaper/index.html?host=fusion&project=design), then in the panel:
//   boot (ping) -> pong (connected) -> Add selection (add_selection) -> selection_data (the 664 payload: 2 regions, 2 paths) -> click the rectangle region in
//   Prepare -> Outside -> Export: the 3D board builds (three.js from the folder) -> Generate Shaper SVG downloads.
// The panel's downloaded SVG is the website's, byte for byte. The panel: Prepare + Export only, the drawer holds Log only (no Download, Settings, add-in
// download, About, Rate & feedback), no footer gear, no document tabs, no account; it opens on Prepare without ?host=fusion in its address. Every request
// it makes is to its own server and finds its file (no 404, nothing outside the folder; the module worker included: the server sees every request).
// Screenshots (legible) to .evidence/881/: the panel's Prepare after the cut at 1280 x 800 and at the palette size 480 x 731, its drawer, its Export.
// TASK 885 (owner turn 3604): the panel's Prepare toolbar has no INSERT section (no Insert STL); the website, in Fusion mode and plain, keeps it. The panel's
// toolbar, cropped, to .evidence/885/prepare-toolbar-panel.png.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { pressExportAction } from './helpers/export-actions.js';
import { typeLive } from './helpers/prepare-open-live.js';

const require = createRequire(import.meta.url);
const { buildFusionPanel, PANEL_MIME } = require('../scripts/build-site.cjs');

const EVIDENCE_DIR = path.resolve('.evidence/881');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const EVIDENCE_885 = path.resolve('.evidence/885');
fs.mkdirSync(EVIDENCE_885, { recursive: true });
// Prepare's toolbar: its sections (data-section:label), whether the Insert STL button is in the page, and the STL card (stl-card.js, made at boot, hidden)
const PREPARE_TOOLBAR = `({ groups: [...document.querySelectorAll('#prepare-ribbon .sk-ribbon-group')].map((g) => g.dataset.section + ':' + g.querySelector('.sk-ribbon-group-label').textContent), insertStl: !!document.getElementById('prepare-insert-stl'), stlCard: document.querySelectorAll('#prepare-panel .stl-card').length })`;

// the payload of fusion-import-664-live.test.js (a sketch: a 40 x 30 rectangle with a 5 mm hole, the hole's disk, an open chain, a construction line)
const PAYLOAD = {
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { kind: 'sketch', name: 'Sketch1' }, stock: { thicknessMm: null },
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

// the add-in's server, as SA-32 describes it: the folder's files at their paths, each with its declared media type (the build's PANEL_MIME); every request kept
function servePanel(root) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
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

const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-fusion-panel-881-live-'));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-881-dl-'));
const built = buildFusionPanel(panelDir);
const panel = await servePanel(panelDir);
const cdp = await launchBrowser({ tag: '881-panel', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { panel.server.close(); console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp, close, ws } = cdp;

// every request the page (and its worker) sends: its URL (CDP Network on the page target, auto-attached to the worker)
const requested = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') requested.push(m.params.request.url); });

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
};
const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
};
const press = async (sel) => { const c = await centre(sel); assert.ok(c && c.hit, sel + ' is there to press ' + JSON.stringify(c)); await clickAt(c.x, c.y); };
const downloaded = async (fn) => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await fn();
  let file = null;
  for (let i = 0; i < 150 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  return { name: path.basename(file), svg: fs.readFileSync(file, 'utf8') };
};

// The flow, on the page at `url` whose boot module is `mod` (the page's own seam currentReviewView): -> { boot, svg, name }
async function flow(label, url, mod, { evidence = false } = {}) {
  await navigate(url);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, label + ': the Fusion bar');
  await evalJs(`document.querySelector('.sk-sidebar-btn').click()`);
  await waitFor(`document.querySelectorAll('.sk-sidebar-stage').length > 0`, label + ': the drawer');
  const boot = await evalJs(`(() => ({
    prepareShown: !document.getElementById('view-prepare').hidden,
    headerTabs: [...document.querySelectorAll('.sk-header-tab')].map((b) => b.dataset.tab),
    drawerStages: [...document.querySelectorAll('.sk-sidebar-stage')].map((b) => b.dataset.tab),
    drawerActions: [...document.querySelectorAll('.sk-sidebar [data-section="actions"] [data-action]')].map((b) => b.dataset.action),
    docTabs: document.querySelectorAll('.sk-doctabs').length,
    account: document.querySelectorAll('.sk-account, .sk-account-menu, .sk-sidebar [data-section="account"]').length,
    footerGear: !!document.getElementById('btn-settings'),
    stylePanel: !!document.querySelector('.sk-style-panel'),
    sent: window.adsk._sent.map((m) => m.action),
    toolbar: ${PREPARE_TOOLBAR},
  }))()`);
  if (evidence) { // the open drawer, zoomed (its Log entry legible)
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, label + ': the drawer open');
    await sleep(400);
    const r = await evalJs(`(() => { const b = document.querySelector('.sk-sidebar').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: Math.min(b.height, 420) }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'panel-drawer-zoom.png'), Buffer.from(data, 'base64'));
  }
  await evalJs(`document.querySelector('.sk-sidebar-backdrop').click()`);
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Plate v2' }))`);
  assert.strictEqual(await evalJs(`document.getElementById('shaper-fusion-status').textContent`), 'Connected to Fusion: Plate v2', label + ': pong -> connected');
  await press('#btn-fusion-add-selection');
  await waitFor(`window.adsk._sent.some((m) => m.action === 'add_selection')`, label + ': add_selection sent');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(PAYLOAD))})`);
  await waitFor(`document.querySelectorAll('#prepare-world-group .sk-edge').length === 6`, label + ': 6 edges in Prepare');
  assert.strictEqual(await evalJs(`document.getElementById('prepare-notice').textContent`), 'Added Sketch1: 2 regions, 2 paths', label + ': the selection notice');
  const at = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = 6; pt.y = -6; const p = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
  const dir = new URL(url).pathname.replace(/[^/]*$/, ''); // the page's folder: /apps/shaper/ (the website) or / (the panel)
  await clickAt(at.x, at.y);
  await waitFor(`!!(window.__prepareView && window.__prepareView.selectedTargets().length === 1)`, label + ': the rectangle region picked');
  await typeLive({ clickEl: press, evalJs, waitFor }, 'exterior'); // operation-first (TASK S3): the toolbar's Outside makes the operation on the pick, its card open
  await waitFor(`!!document.querySelector('#prepare-panel .cut-ok')`, label + ': the Outside operation open');
  await press('#prepare-panel .cut-ok');
  await waitFor(`import('${dir}src/op-paths.js').then((m) => m.generatingCount() === 0)`, label + ': its paths generated (in the background)', 120000);
  await waitFor(`import('${dir}src/cut-plan.js').then((m) => m.planEntries().length === 1)`, label + ': one operation in the plan');
  await sleep(400);
  if (evidence) {
    await shot('panel-prepare-1280x800.png');
    const r = await evalJs(`(() => { const b = document.getElementById('prepare-ribbon-frame').getBoundingClientRect(); return { x: b.left, y: b.top, width: Math.min(b.width, 720), height: b.height }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 } }); // TASK 885: the toolbar, zoomed (its sections' names legible)
    fs.writeFileSync(path.join(EVIDENCE_885, 'prepare-toolbar-panel.png'), Buffer.from(data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 731, deviceScaleFactor: 1, mobile: false });
    await waitFor(`window.innerWidth === 480`, 'the palette size');
    await sleep(400);
    await shot('panel-prepare-palette-480x731.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFor(`window.innerWidth === 1280`, 'back to 1280');
  }
  await press('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export stage');
  await waitFor(`import(${JSON.stringify(mod)}).then((m) => { const v = m.currentReviewView(); return !!(v && v.lastBuild && v.lastBuild.triangles > 0) && !document.getElementById('review-info').querySelector('.sk-wait-spin, .sk-wait-action'); })`, label + ': the 3D board built (three.js)', 60000);
  const file = await downloaded(() => pressExportAction(cdp, press, 'btn-generate-svg'));
  await waitFor(`/Exported 1 cut/.test(document.getElementById('simexport-status').textContent)`, label + ': the status line says it');
  if (evidence) { await sleep(300); await shot('panel-export-1280x800.png'); }
  return { boot, ...file };
}

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    try { localStorage.setItem('shaper-mode', 'design'); } catch (e) {}
    window.adsk = { _sent: [], fusionSendData(action, data) { this._sent.push({ action, data }); return '{}'; } };
  })();` });

  // 1. the website in Fusion mode (what the add-in opens today)
  const web = await flow('website', `http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion&project=design`, '/apps/shaper/src/main.js');
  assert.deepStrictEqual(web.boot.drawerActions, ['download', 'settings', 'log', 'feedback'], 'the website in Fusion mode: its drawer as today');
  assert.strictEqual(web.boot.footerGear && web.boot.stylePanel, true, 'the website in Fusion mode: its Settings (footer gear + panel) as today (the panel checks below can fail)');
  const WEB_TOOLBAR = { groups: ['insert:Insert', 'operations:Operations', 'recalculate:Recalculate', 'tools:Tools'], insertStl: true, stlCard: 1 };
  assert.deepStrictEqual(web.boot.toolbar, WEB_TOOLBAR, 'the website in Fusion mode: the Prepare toolbar keeps INSERT (Insert STL) first, as today');
  // the plain website (no ?host=fusion): the same toolbar
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('prepare-insert-stl')`, 'the plain website: its Prepare toolbar');
  assert.deepStrictEqual(await evalJs(PREPARE_TOOLBAR), WEB_TOOLBAR, 'the plain website: the Prepare toolbar keeps INSERT (Insert STL) first, as today');

  // 2. the built panel, from its own server (no ?host=fusion: the panel is Fusion mode by declaration)
  requested.length = 0;
  const p = await flow('panel', `http://127.0.0.1:${panel.port}/index.html`, './src/fusion-main.js', { evidence: true });
  assert.strictEqual(p.boot.prepareShown, true, 'the panel opens on Prepare (a stored Design stage ignored)');
  assert.deepStrictEqual(p.boot.headerTabs, ['prepare', 'review'], 'the panel header: Prepare and Export');
  assert.deepStrictEqual(p.boot.drawerStages, ['prepare', 'review'], 'the panel drawer stages: Prepare and Export');
  assert.deepStrictEqual(p.boot.drawerActions, ['log'], 'the panel drawer: Log only (owner turns 3494 / 3503)');
  assert.strictEqual(p.boot.docTabs, 0, 'no document tabs');
  assert.strictEqual(p.boot.account, 0, 'no account');
  assert.strictEqual(p.boot.footerGear, false, 'no Settings gear in the footer');
  assert.strictEqual(p.boot.stylePanel, false, 'no Settings panel in the page');
  assert.deepStrictEqual(p.boot.sent, ['ping'], 'the panel pinged the add-in once at boot');
  // TASK 885 (owner turn 3604): no Insert STL in the panel: Prepare's toolbar has no INSERT section (no empty one, no label) and no Insert STL button
  assert.deepStrictEqual(p.boot.toolbar, { groups: ['operations:Operations', 'recalculate:Recalculate', 'tools:Tools'], insertStl: false, stlCard: 0 }, 'the panel: the Prepare toolbar has no INSERT section, Prepare no STL card');
  assert.strictEqual(p.name, web.name, `the same file name (${p.name})`);
  assert.strictEqual(p.svg, web.svg, 'the panel exports the website\'s Shaper SVG, byte for byte');
  assert.ok(/<svg/.test(p.svg) && /shaper:cutType/.test(p.svg), 'a Shaper SVG');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'panel-export.svg'), p.svg);

  // 3. every request went to the panel's own server and found its file; the worker's modules included; nothing from the website or the network
  const outside = requested.filter((u) => !u.startsWith(`http://127.0.0.1:${panel.port}/`) && !/^(data|blob):/.test(u));
  assert.deepStrictEqual(outside, [], 'the panel requests nothing outside its own folder');
  assert.deepStrictEqual(panel.log.filter((r) => r.status !== 200), [], 'every file the panel asks for is in its folder');
  for (const f of ['/index.html', '/src/fusion-main.js', '/src/paths-worker.js', '/src/op-derive.js', '/packages/ui/vendor/three/three.module.js', '/assets/constraint-glyphs.svg']) {
    assert.ok(panel.log.some((r) => r.url === f), `the panel loaded ${f} from its folder`);
  }
  for (const f of ['/src/main.js', '/packages/ui/app-chrome.js', '/packages/ui/cloud/google-account.js', '/packages/ui/style-panel.js', '/packages/ui/feedback.js', '/src/stl-import.js']) {
    assert.ok(!panel.log.some((r) => r.url === f), `the panel never asks for ${f}`);
  }
  const served = new Set(panel.log.map((r) => r.url.slice(1)));
  const files = built.files.map((f) => f.path);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'panel-requests.txt'), panel.log.map((r) => `${r.status} ${r.url}`).join('\n') + '\n');
  console.log(`fusion-panel-881-live: ok (the panel folder: ${files.length} files; this flow loaded ${served.size} of them, every one 200)`);
} finally {
  await close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(panelDir, { recursive: true, force: true });
  fs.rmSync(dlDir, { recursive: true, force: true });
}
