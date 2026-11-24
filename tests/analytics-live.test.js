// tests/analytics-live.test.js — TASK 738 (live): the analytics in the real page, one app per host type (Shaper on the web, Shaper in the Fusion 360
// palette), against a LOCAL STUB endpoint that is the Worker's own fetch handler (analytics/src/index.js, run here in Node with an in-memory dataset):
// so what the page sends is checked AND accepted by the Worker, field by field.
// The Shaper site is built (scripts/build-site.cjs, as deployed: TASK 763, the app at the site root, opened at /) into a temp dir, and ONLY its copy of packages/ui/analytics.js gets the stub's URL as
// ENDPOINT (the repo's points at the deployed Worker). The page is opened under made-up public host names (*.analytics-738.test, mapped to 127.0.0.1 by the browser's
// --host-resolver-rules), so it is a PUBLIC page for analytics.js; each phase has its own host name, so its own localStorage (no carry between phases).
//   L. the gate's case: the same built site opened from http://127.0.0.1: a stage switch, and NOTHING reaches the stub, no analytics key is stored;
//   W. web: the visit, a stage tab clicked (stage:prepare), an SVG imported from the drawer's Import SVG / DXF… (import:svg), the Export tab
//      (stage:review), Generate Shaper SVG (export:shaper): exactly these events, app shaper, host web, dev 0, the site's build stamp, one anonymous id;
//   D. ?dev=1 tags the visit dev, a reload keeps it, ?dev=0 removes it;
//   F. Fusion: ?host=fusion (window.adsk stubbed, the add-in's selection_data sent as the add-in sends it): the visit, import:fusion, stage:review,
//      export:shaper, all host fusion.
// Every stored data point: the Worker's blob layout, the site class 'other' (a .test host: not one of the four sites), no IP, no file name.
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, startServer, sleep } from './helpers/cdp-browser.js';
import worker from '../analytics/src/index.js';
import { pressExportAction } from './helpers/export-actions.js'; // TASK 880: the Export actions are the header's (the drawer's on a phone)

const require = createRequire(import.meta.url);
const { buildSite } = require('../scripts/build-site.cjs');
const realSolid = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');
const DOMAIN = 'analytics-738.test';
const ENDPOINT_LINE = /^export const ENDPOINT = '[^']*';$/m; // the repo's one ENDPOINT line (the deployed Worker's URL since the deploy), pointed at the stub here

// ── the stub endpoint: the Worker's fetch handler, its dataset in memory ───────────────────────────────
const points = [];   // every data point the Worker wrote
const requests = []; // every request that reached the stub
const stub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');
  const headers = {};
  for (const h of ['origin', 'user-agent', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
  requests.push({ method: req.method, url: req.url, origin: req.headers.origin, body });
  const r = await worker.fetch(new Request('http://stub' + req.url, { method: req.method, headers, body: req.method === 'POST' ? body : undefined }), { EVENTS: { writeDataPoint: (dp) => points.push(dp) } });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(await r.text());
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const STUB_URL = `http://127.0.0.1:${stub.address().port}/e`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-738-'));
const dist = path.join(tmp, 'shaper');
const built = buildSite('shaper', dist);
const analyticsFile = path.join(dist, 'packages', 'ui', 'analytics.js');
const src = fs.readFileSync(analyticsFile, 'utf8');
assert.ok(ENDPOINT_LINE.test(src), 'the built analytics.js has its ENDPOINT line to point at the stub');
fs.writeFileSync(analyticsFile, src.replace(ENDPOINT_LINE, `export const ENDPOINT = '${STUB_URL}';`));
const site = await startServer(dist);
const SVG = path.join(tmp, 'cut-square.svg');
fs.writeFileSync(SVG, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="40mm" viewBox="0 0 60 40">'
  + '<rect x="10" y="10" width="40" height="20" fill="none" stroke="black" shaper:cutType="outside" shaper:cutDepth="3mm"/></svg>');
const dlDir = path.join(tmp, 'downloads');
fs.mkdirSync(dlDir);

const cdp = await launchBrowser({ tag: '738-analytics', width: 1280, height: 800, server: false, args: [`--host-resolver-rules=MAP *.${DOMAIN} 127.0.0.1`] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); stub.close(); site.server.close(); process.exit(0); }
const { send, once, evalJs, waitFor, waitForApp, navigate, ws, close } = cdp;
const pageRequests = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') pageRequests.push(m.params.request.url); });

const until = async (fn, what, ms = 10000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out waiting for ' + what); await sleep(50); } };
const tap = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
// a real click on the element's centre, after checking nothing covers it there
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await tap(p.x, p.y);
};
const openStage = async (id) => { await clickEl(`.sk-header-tab[data-tab="${id}"]`); await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`); };
const generate = async () => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await pressExportAction({ evalJs, waitFor }, clickEl, 'btn-generate-svg');
  await until(() => fs.readdirSync(dlDir).some((n) => n.endsWith('.svg')), 'the Shaper SVG download');
};
const events = (from) => points.slice(from).map((p) => `${p.blobs[0]} ${p.blobs[1] || '-'} ${p.blobs[3]} ${p.blobs[5]} dev=${p.blobs[8]}`);
const analyticsKeys = () => evalJs(`Object.keys(localStorage).filter((k) => k.startsWith('sketch-analytics')).sort()`);

try {
  await send('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  console.log(`site build ${built.build}; stub ${STUB_URL}`);

  // L. the gate's case: 127.0.0.1 never sends, even with an ENDPOINT
  await navigate(`http://127.0.0.1:${site.port}/?dev=1`);
  await waitForApp('design-canvas');
  await openStage('prepare');
  await sleep(1500);
  const lKeys = await analyticsKeys();
  console.log(`L (http://127.0.0.1): ${requests.length} requests at the stub, analytics keys ${JSON.stringify(lKeys)}`);
  assert.strictEqual(requests.length, 0, 'L: a page on 127.0.0.1 sends nothing (the gate\'s and the tests\' case)');
  assert.deepStrictEqual(lKeys, [], 'L: and keeps no analytics key (not even ?dev=1)');

  // W. the web: visit, stage, import, stage, export
  const w0 = points.length;
  await navigate(`http://web.${DOMAIN}:${site.port}/`);
  await waitForApp('design-canvas');
  await until(() => points.length >= w0 + 1, 'W: the visit');
  await openStage('prepare');
  await until(() => points.length >= w0 + 2, 'W: stage:prepare');
  await evalJs(`delete window.showOpenFilePicker; typeof window.showOpenFilePicker`); // the <input type=file> path, which the chooser interception sees
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await clickEl('.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'W: the drawer opens');
  await sleep(300);
  const chooser = once('Page.fileChooserOpened');
  await clickEl('.sk-sidebar-item[data-action="import-file"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, 'W: the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [SVG], backendNodeId: ch.backendNodeId });
  await until(() => points.length >= w0 + 3, 'W: import:svg');
  await waitFor(`import('/src/cut-plan.js').then((m) => m.planEntries().length > 0)`, 'W: the imported cut in the plan');
  await openStage('review');
  await generate();
  await until(() => points.length >= w0 + 5, 'W: stage:review and export:shaper');
  await sleep(500);
  const w = events(w0);
  console.log('W (web) events: ' + JSON.stringify(w));
  assert.deepStrictEqual(w, ['visit - shaper web dev=0', 'feature stage:prepare shaper web dev=0', 'feature import:svg shaper web dev=0', 'feature stage:review shaper web dev=0', 'feature export:shaper shaper web dev=0'],
    'W: exactly the visit, the two stage tabs, the import and the export');
  const wPts = points.slice(w0);
  assert.ok(wPts.every((p) => p.blobs[4] === built.build), `W: version = the site's build stamp ${built.build}`);
  assert.strictEqual(new Set(wPts.map((p) => p.indexes[0])).size, 1, 'W: one anonymous id for the page');
  assert.ok(/^[0-9a-f]{32}$/.test(wPts[0].indexes[0]), 'W: the id is 32 hex characters');
  assert.ok(wPts.every((p) => p.blobs[10] === 'other'), 'W: site class other (the Origin host itself is not stored)');
  console.log('W data point 0: ' + JSON.stringify(wPts[0]));
  const wBodies = requests.slice(-5).map((r) => JSON.parse(r.body));
  assert.ok(wBodies.every((b) => Object.keys(b).sort().join() === 'app,dev,event,host,id,name,version'), 'W: each request carries exactly the declared fields');
  assert.ok(!requests.some((r) => /cut-square|\.svg"|@/.test(r.body)), 'W: no file name, no email in any request');
  assert.deepStrictEqual(await analyticsKeys(), ['sketch-analytics-id'], 'W: only the anonymous id is stored');

  // D. the dev tag
  const d0 = points.length;
  for (const q of ['?dev=1', '', '?dev=0']) {
    const before = points.length;
    await navigate(`http://web.${DOMAIN}:${site.port}/${q}`);
    await waitForApp('design-canvas');
    await until(() => points.length >= before + 1, `D: the visit of ${q || 'a reload'}`);
  }
  const d = events(d0);
  console.log('D (dev tag) events: ' + JSON.stringify(d));
  assert.deepStrictEqual(d, ['visit - shaper web dev=1', 'visit - shaper web dev=1', 'visit - shaper web dev=0'], 'D: ?dev=1 tags the visit, a reload keeps it, ?dev=0 removes it');

  // F. the Fusion palette
  const f0 = points.length;
  await navigate(`http://fusion.${DOMAIN}:${site.port}/?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'F: the Fusion Prepare bar');
  await until(() => points.length >= f0 + 1, 'F: the visit');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(realSolid)})`);
  await waitFor(`/8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'F: the real solid imported (8 regions)');
  await until(() => points.length >= f0 + 2, 'F: import:fusion');
  await openStage('review');
  await generate();
  await until(() => points.length >= f0 + 4, 'F: stage:review and export:shaper');
  await sleep(500);
  const f = events(f0);
  console.log('F (Fusion) events: ' + JSON.stringify(f));
  assert.deepStrictEqual(f, ['visit - shaper fusion dev=0', 'feature import:fusion shaper fusion dev=0', 'feature stage:review shaper fusion dev=0', 'feature export:shaper shaper fusion dev=0'],
    'F: the palette\'s visit, the Fusion import, the Export tab and the export, all host fusion');

  // every request the pages made to an analytics endpoint went to the stub, and every one was accepted
  const toAnalytics = pageRequests.filter((u) => /workers\.dev|\/e$/.test(u));
  assert.ok(toAnalytics.every((u) => u === STUB_URL), 'no request to any other analytics endpoint: ' + JSON.stringify([...new Set(toAnalytics)]));
  assert.strictEqual(points.length, requests.filter((r) => r.method === 'POST').length, 'every event the pages sent was accepted by the Worker (none refused)');
  console.log(`analytics-live: ${points.length} events accepted by the Worker, bot class of this headless browser: ${[...new Set(points.map((p) => p.blobs[9]))]}; all checks pass`);
} finally {
  await close();
  site.server.close();
  stub.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
