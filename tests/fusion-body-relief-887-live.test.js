// tests/fusion-body-relief-887-live.test.js — TASK 887 (add-in SA-35): the BUILT Fusion panel (scripts/build-site.cjs shaper-fusion, served as the add-in serves
// it: the harness of fusion-panel-881-live.test.js) receives the add-in's RELIEF of a body (tests/fixtures/fusion-body-relief-887.json: source.kind 'body', ONE
// region with its levels, written by shaper-addin's own fusion_selection.extract_selection) and treats it as an STL relief:
//   pong -> Add selection -> selection_data -> ONE Roughing operation (its levels) -> a Contour added with the operations toolbar on the part -> both generate
//   their paths -> Export: the 3D board is the CARVED relief (its levels) -> Generate Shaper SVG: the Roughing's pockets and the Contour's cuts.
// Screenshots (legible) to .evidence/887/: Prepare with the two operations, the Export's 3D view of the carved relief (zoomed on the board).
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

const EVIDENCE_DIR = path.resolve('.evidence/887');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const PAYLOAD = JSON.parse(fs.readFileSync(new URL('./fixtures/fusion-body-relief-887.json', import.meta.url), 'utf8')).payload;
assert.strictEqual(PAYLOAD.source.kind, 'body', 'the fixture is a body relief');

function servePanel(root) {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(root, url === '/' ? 'index.html' : url.slice(1));
    try {
      if (!path.resolve(file).startsWith(path.resolve(root))) throw new Error('outside');
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': PANEL_MIME[path.extname(file).toLowerCase()] });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-887-panel-'));
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-887-dl-'));
buildFusionPanel(panelDir);
const panel = await servePanel(panelDir);
const cdp = await launchBrowser({ tag: '887-relief', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { panel.server.close(); console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, evalJs, waitFor, navigate, waitForApp, close, ws } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
});

const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
};
const press = async (sel) => { const c = await centre(sel); assert.ok(c && c.hit, sel + ' is there to press ' + JSON.stringify(c)); await clickAt(c.x, c.y); };
const shotClip = async (name, sel, scale = 1) => {
  const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.max(1, b.width), height: Math.max(1, b.height) }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale } });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const plan = () => evalJs(`import('./src/cut-plan.js').then((m) => m.planEntries().map((e) => ({ type: e.rec.cutType, levels: Array.isArray(e.rec.levels) ? e.rec.levels.length : 0, planKey: e.planKey })))`);

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    try { localStorage.setItem('shaper-mode', 'design'); } catch (e) {}
    window.adsk = { _sent: [], fusionSendData(action, data) { this._sent.push({ action, data }); return '{}'; } };
  })();` });
  await navigate(`http://127.0.0.1:${panel.port}/index.html`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'the Fusion bar');
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'test freeform mesh v3' }))`);
  await press('#btn-fusion-add-selection');
  await waitFor(`window.adsk._sent.some((m) => m.action === 'add_selection')`, 'add_selection sent');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(PAYLOAD))})`);
  await waitFor(`import('./src/cut-plan.js').then((m) => m.planEntries().length === 1)`, 'the relief imported: one operation', 30000);
  const p1 = await plan();
  assert.deepStrictEqual(p1.map((e) => [e.type, e.levels]), [['roughing', PAYLOAD.regions[0].levels.length]], 'ONE Roughing operation carrying the body\'s levels');
  const notice = await evalJs(`document.getElementById('prepare-notice').textContent`);
  console.log('notice: ' + notice);
  assert.ok(/Body1/.test(notice), 'the notice names the body: ' + notice);
  assert.strictEqual(await evalJs(`!!document.querySelector('.stl-card') && !document.querySelector('.stl-card').hidden`), false, 'no STL card for a body');

  // a Contour on the part: its shape picked, the operations toolbar's Contour (a NEW operation, its card open), OK
  await evalJs(`(() => { const k = ${JSON.stringify(p1[0].planKey)}, i = k.indexOf(':'); window.__prepareView.setSelection([{ kind: k.slice(0, i), id: k.slice(i + 1) }]); return true; })()`);
  await typeLive({ clickEl: press, evalJs, waitFor }, 'contour');
  await waitFor(`!!document.querySelector('#prepare-panel .cut-ok')`, 'the Contour operation open');
  await press('#prepare-panel .cut-ok');
  await waitFor(`import('./src/op-paths.js').then((m) => m.generatingCount() === 0)`, 'both operations\' paths generated', 120000);
  const p2 = await plan();
  assert.deepStrictEqual(p2.map((e) => e.type), ['roughing', 'contour'], 'Roughing then its Contour');
  await sleep(500);
  await shotClip('prepare-body-relief.png', '#view-prepare');

  // Export: the 3D board = the carved relief
  await press('.sk-header-tab[data-tab="review"]');
  await waitFor(`!document.getElementById('view-review').hidden`, 'the Export stage');
  await waitFor(`import('./src/fusion-main.js').then((m) => { const v = m.currentReviewView(); return !!(v && v.lastBuild && v.lastBuild.triangles > 0) && !document.getElementById('review-info').querySelector('.sk-wait-spin, .sk-wait-action'); })`, 'the 3D board built', 90000);
  const build = await evalJs(`import('./src/fusion-main.js').then((m) => { const b = m.currentReviewView().lastBuild; return { triangles: b.triangles, levels: b.levels, board: b.board }; })`);
  console.log('3D build: ' + JSON.stringify(build));
  assert.ok(build.triangles > 1000 && build.levels > 1, `the 3D view carves the relief's levels (${build.triangles} triangles, ${build.levels} levels)`);
  await sleep(1500);
  await shotClip('export-3d-body-relief.png', '#view-review');
  { // the carved relief at a legible size: the board is centred on the part, so the middle of the view, 5x
    const r = await evalJs(`(() => { const b = document.querySelector('#view-review').getBoundingClientRect(); return { x: b.left + b.width / 2 - 80, y: b.top + b.height / 2 - 56, width: 160, height: 112 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 5 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'export-3d-body-relief-zoom.png'), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, 'export-3d-body-relief-zoom.png'));
  }

  // Generate Shaper SVG: the Roughing's pockets and the Contour's cuts
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await pressExportAction(cdp, press, 'btn-generate-svg');
  let file = null;
  for (let i = 0; i < 150 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  const svg = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'body-relief-panel.svg'), svg);
  const pockets = (svg.match(/shaper:cutType="pocket"/g) || []).length, contours = (svg.match(/shaper:cutType="(outside|inside)"/g) || []).length;
  console.log(`svg ${path.basename(file)}: ${pockets} pocket paths, ${contours} contour cuts`);
  assert.ok(pockets >= 2 && contours >= 2, 'the SVG has the Roughing\'s pockets and the Contour\'s cuts');
  assert.deepStrictEqual(problems, [], 'no page exception');
  console.log('fusion-body-relief-887-live: ok');
} finally {
  await close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(panelDir, { recursive: true, force: true });
  fs.rmSync(dlDir, { recursive: true, force: true });
}
