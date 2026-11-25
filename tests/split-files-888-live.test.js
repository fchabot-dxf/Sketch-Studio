// tests/split-files-888-live.test.js — TASK 888 (owner turns 3627-3628): "Split into files" on a relief's CONTOUR, in the real Shaper page, real clicks / touches:
//   DESKTOP 1280 x 800 (web; Prepare's Insert STL), PHONE 390 x 844 (touch; the drawer's Open STL: the design takes the file's name), and the BUILT FUSION PANEL (the
//   add-in's harness of fusion-body-relief-887-live.test.js: a body relief from the add-in's selection_data).
// Each phase: the relief's Roughing + a Contour (the operations toolbar) -> the Contour opened, its Passes tab: the Split into files row (Off by default), By depth,
// Depth per file typed 5 then 10 (Enter) -> OK -> the Export stage's Generate Shaper SVG: ONE zip downloads holding N files, N = the page's own chunk files
// (export-payload.js exportFileOf), each named "<design> - Contour 2 (a-b mm).svg" (bands of 10 mm, top down) with the page's bytes; the Export status line says
// "Exported N files → <zip>: <names>." (no toast). Screenshots (legible): .evidence/888/<phase>-split-row.png (the card's row) and <phase>-export-status.png.
// No console error / page exception.
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { binaryStl } from './helpers/stl-mesh.js';
import { openOpLive, typeLive } from './helpers/prepare-open-live.js';
import { pressExportAction } from './helpers/export-actions.js';
import { reliefTerrain } from './fixtures/relief-terrain-889.js';

const require = createRequire(import.meta.url);
const { buildFusionPanel, PANEL_MIME } = require('../scripts/build-site.cjs');
const EVIDENCE_DIR = path.resolve('.evidence/888');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-888-'));
const STL = path.join(tmp, 'relief.stl');
fs.writeFileSync(STL, binaryStl(reliefTerrain()));
const dlDir = path.join(tmp, 'downloads');
fs.mkdirSync(dlDir);
const BODY = JSON.parse(fs.readFileSync(new URL('./fixtures/fusion-body-relief-887.json', import.meta.url), 'utf8')).payload;

// the entries of a STORE zip (#core/plot/zip: no compression): [{ name, text }]
function unzip(buf) {
  const out = [];
  for (let o = 0; buf.readUInt32LE(o) === 0x04034b50;) {
    const size = buf.readUInt32LE(o + 18), n = buf.readUInt16LE(o + 26), x = buf.readUInt16LE(o + 28);
    const name = buf.toString('utf8', o + 30, o + 30 + n), start = o + 30 + n + x;
    out.push({ name, text: buf.toString('utf8', start, start + size) });
    o = start + size;
  }
  return out;
}

function servePanel(root) {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.join(root, url === '/' ? 'index.html' : url.slice(1));
    try {
      if (!path.resolve(file).startsWith(path.resolve(root))) throw new Error('outside');
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'content-type': PANEL_MIME[path.extname(file).toLowerCase()] });
      res.end(data);
    } catch (e) { res.writeHead(404); res.end('not found: ' + e.message); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}
const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-888-panel-'));
buildFusionPanel(panelDir);
const panel = await servePanel(panelDir);

const cdp = await launchBrowser({ tag: '888-split', width: 1280, height: 800 });
if (!cdp) { panel.server.close(); console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, once, ws, evalJs, waitFor, waitForApp, navigate, close, port } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
let touch = false, SRC = '/apps/shaper/src'; // the page's modules (the Fusion panel serves them at ./src)
const shot = async (name, sel, pad = 8, scale = 2) => {
  const clip = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const x = Math.max(0, r.left - ${pad}), y = Math.max(0, r.top - ${pad});
    return { x, y, width: Math.min(innerWidth, r.right + ${pad}) - x, height: Math.min(innerHeight, r.bottom + ${pad}) - y, scale: ${scale} }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  const f = path.join(EVIDENCE_DIR, name);
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  console.log('screenshot ' + f);
};
const press = async (x, y) => {
  if (touch) {
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 0, radiusX: 1, radiusY: 1, force: 1 })) });
    await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350);
    return;
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const clickEl = async (sel) => {
  await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); })()`);
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const t = { evalJs, waitFor, clickEl };
const enter = () => send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })).then(() => sleep(400)); // Enter with its text: the field's change
const typeIn = async (sel, text) => { await clickEl(sel); await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select(); })()`); await send('Input.insertText', { text }); await enter(); };
const idle = (what) => waitFor(`import('${SRC}/op-paths.js').then((m) => m.generatingCount() === 0)`, what, 180000);
const opOf = (type) => evalJs(`import('${SRC}/operations-store.js').then((m) => { const o = m.storeOps().find((o) => o.type === ${JSON.stringify(type)}); return o ? o.id : null; })`);
const okCard = async () => { await clickEl('#prepare-panel .cut-ok'); await sleep(200); await idle('the paths of OK generated'); }; // the card's OK (prepare-open-live.js okLive, with the page's own module paths: the Fusion panel serves them at ./src)
const tab = async (id) => { await clickEl(`#prepare-panel .cut-tab[data-tab="${id}"]`); await waitFor(`document.querySelector('#prepare-panel .cut-tab[data-tab="${id}"]').classList.contains('is-active')`, `the ${id} tab`); await sleep(150); };
const openStage = async (id) => {
  if (touch) { await clickEl('.sk-sidebar-chevron'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300); await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`); }
  else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`); await sleep(300);
};
const chooseStl = async (opener, what) => {
  await evalJs('delete window.showOpenFilePicker');
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = once('Page.fileChooserOpened');
  await opener();
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, what + ': the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [STL], backendNodeId: ch.backendNodeId });
  await waitFor(`document.getElementById('prepare-notice').textContent.includes(': a relief, ')`, what + ': the notice', 180000);
  await idle(what + ': the insert\'s paths');
};
const row = (r) => evalJs(`(() => { const e = document.querySelector('#prepare-panel .cut-row[data-row="${r}"]'); return e ? { shown: e.style.display !== 'none' && !('offTab' in e.dataset), off: 'off' in e.dataset, label: e.querySelector('.cut-field-label').textContent,
  presets: [...e.querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')), value: (e.querySelector('input') || {}).value, unit: (e.querySelector('.cut-split-unit') || {}).textContent } : null; })()`);

const results = {};
// U = the document unit's values: the depths typed (a first value, then the band), the band in base mm, the top band's name
const MM = { unit: 'mm', first: '5', band: '10', bandMm: 10, top: '0-10 mm' }, IN = { unit: 'in', first: '0.1', band: '0.25', bandMm: 6.35, top: '0-0.25 in' };
async function phase(what, U) {
  const R = results[what] = { U };
  // the Contour on the relief's part: its Roughing's row picked, the toolbar's Contour (a NEW operation, open), OK
  const rId = await opOf('roughing');
  assert.ok(rId, what + ': the relief\'s Roughing');
  if (await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) { await clickEl('#prepare-ops .ops-head'); await sleep(250); }
  await clickEl(`#prepare-ops .ops-row[data-id="${rId}"] .ops-pick`);
  await sleep(300);
  await typeLive(t, 'contour');
  await waitFor(`document.querySelector('.cut-type-cur') && document.querySelector('.cut-type-cur').textContent === 'Contour' && !document.querySelector('#prepare-panel .cut-actions').hidden`, what + ': the new Contour, open', 180000);
  if (touch && !(await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`))) { await clickEl('#prepare-ops .ops-head'); await sleep(300); } // the list opened for the pick: folded (it covers the card on a phone)
  await okCard();
  const cId = await opOf('contour');
  // the Contour opened: its Passes tab, the row
  await openOpLive(t, cId);
  await tab('passes');
  R.before = [await row('splitFiles'), await row('splitEvery')];
  await clickEl('#prepare-panel .cut-row[data-row="splitFiles"] .cut-preset[data-value="depth"]');
  await typeIn('#prepare-panel .cut-split-every', U.first);
  R.five = await row('splitEvery');
  await typeIn('#prepare-panel .cut-split-every', U.band);
  R.after = [await row('splitFiles'), await row('splitEvery')];
  R.clipped = await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-row[data-row="splitFiles"] .cut-preset')].filter((b) => { const card = document.querySelector('#prepare-panel .cut-card').getBoundingClientRect(), r = b.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(b); const tx = rg.getBoundingClientRect();
    return !(tx.left >= r.left - 0.5 && tx.right <= r.right + 0.5 && tx.top >= r.top - 0.5 && tx.bottom <= r.bottom + 0.5 && r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && rg.getClientRects().length === 1); }).map((b) => b.textContent)`);
  await shot(`${what}-split-row.png`, '#prepare-panel .cut-row[data-row="splitFiles"]', 10, 3);
  await shot(`${what}-split-every-row.png`, '#prepare-panel .cut-row[data-row="splitEvery"]', 10, 3);
  await shot(`${what}-split-card.png`, '#prepare-panel .cut-card', 6, 2);
  await okCard();
  R.stored = await evalJs(`import('${SRC}/operations-store.js').then((m) => { const s = m.storeOps().find((o) => o.type === 'contour').settings; return [s.splitFiles, s.splitDepth]; })`);

  // the Export stage's Generate Shaper SVG
  await openStage('review');
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await pressExportAction(cdp, clickEl, 'btn-generate-svg');
  await waitFor(`/^Exported \\d+ files/.test(document.getElementById('simexport-status').textContent)`, what + ': the Export status line', 180000);
  let zip = null;
  for (let i = 0; i < 200 && !zip; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.zip')); if (f) zip = f; else await sleep(100); }
  assert.ok(zip, what + ': the zip downloaded');
  await sleep(300);
  R.zip = zip;
  R.entries = unzip(fs.readFileSync(path.join(dlDir, zip)));
  fs.copyFileSync(path.join(dlDir, zip), path.join(EVIDENCE_DIR, `${what}-${zip}`));
  R.status = await evalJs(`document.getElementById('simexport-status').textContent`);
  R.page = await evalJs(`Promise.all([import('${SRC}/export-payload.js'), import('${SRC}/operations-store.js')]).then(([E]) => { const f = E.exportFileOf(window.__designController.state); return { files: E.namedFiles(f.files, ${JSON.stringify(zip.replace(/\.zip$/, '.svg'))} /* the export's name: its zip's (the page's designFileName) */), wholeHeader: f.svg.split('\\n')[0] }; })`);
  R.toast = await evalJs(`[...document.querySelectorAll('.sk-notification, .sk-toast, .group-status')].filter((e) => e.offsetParent && /Exported/.test(e.textContent)).length`);
  await shot(`${what}-export-status.png`, '#simexport-status', 10, 2);
  console.log(`ROW ${what} | zip ${zip} | ${R.entries.length} files: ${R.entries.map((e) => e.name).join(' | ')} | status ${JSON.stringify(R.status)}`);
}

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  // ── desktop (web)
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStage('prepare');
  await chooseStl(() => clickEl('#prepare-insert-stl'), 'desktop insert');
  await phase('desktop', MM);

  // ── phone 390 (web, touch): the drawer's Open STL
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await chooseStl(async () => { await clickEl('.sk-sidebar-chevron'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300); await clickEl('[data-action="open-stl"]'); }, 'phone open');
  if (await evalJs(`!!document.querySelector('#prepare-panel .stl-card') && !document.querySelector('#prepare-panel .stl-card .stl-body').hidden`)) { await clickEl('#prepare-panel .stl-head'); await sleep(300); } // folded (it covers the card on a phone)
  await phase('phone', MM);

  // ── the built Fusion panel (desktop size, mouse): a body relief from the add-in
  touch = false;
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { if (location.port !== '${panel.port}') return; try { localStorage.setItem('shaper-mode', 'design'); } catch (e) {}
    window.adsk = { _sent: [], fusionSendData(action, data) { this._sent.push({ action, data }); return '{}'; } }; })();` });
  SRC = './src';
  await navigate(`http://127.0.0.1:${panel.port}/index.html`, 20000);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, 'the Fusion bar');
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'bromont' }))`);
  await clickEl('#btn-fusion-add-selection');
  await waitFor(`window.adsk._sent.some((m) => m.action === 'add_selection')`, 'add_selection sent');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(BODY))})`);
  await waitFor(`import('./src/cut-plan.js').then((m) => m.planEntries().length === 1)`, 'the body relief imported: one operation', 30000);
  await idle('fusion: the relief\'s paths');
  await phase('fusion', IN); // the panel's document unit: inches

  for (const [what, R] of Object.entries(results)) {
    const design = what === 'desktop' ? 'shaper-export' : what === 'phone' ? 'relief' : null, U = R.U;
    assert.deepStrictEqual(R.before, [{ shown: true, off: false, label: 'Split into files', presets: ['Off*', 'By depth', 'By levels'] }, { shown: true, off: true, label: 'Depth per file', presets: [], value: '', unit: U.unit }], `${what}: the row on the Passes tab, Off by default, its number row greyed`);
    assert.deepStrictEqual(R.five.value, U.first, `${what}: the typed ${U.first}`);
    assert.deepStrictEqual(R.after, [{ shown: true, off: false, label: 'Split into files', presets: ['Off', 'By depth*', 'By levels'] }, { shown: true, off: false, label: 'Depth per file', presets: [], value: U.band, unit: U.unit }], `${what}: By depth, Depth per file ${U.band} ${U.unit}`);
    assert.deepStrictEqual(R.clipped, [], `${what}: no choice of the row is clipped`);
    assert.deepStrictEqual([R.stored[0], Math.abs(R.stored[1] - U.bandMm) < 1e-9], ['depth', true], `${what}: stored on the Contour, base mm (${R.stored})`);
    const names = R.entries.map((e) => e.name);
    assert.ok(names.length >= 2, `${what}: several files (${names.length})`);
    assert.deepStrictEqual(names, R.page.files.map((f) => f.name), `${what}: the zip holds the page's chunk files, in order`);
    assert.deepStrictEqual(R.entries.map((e) => e.text), R.page.files.map((f) => f.svg), `${what}: each file's bytes are the page's`);
    const bands = [0, 1, 2, 3, 4].map((k) => `${+(k * Number(U.band)).toFixed(6)}-${+((k + 1) * Number(U.band)).toFixed(6)} ${U.unit}`);
    names.forEach((n, i) => assert.ok(bands.some((b) => n === `${design || names[0].slice(0, names[0].indexOf(' - Contour 2 ('))} - Contour 2 (${b}).svg`), `${what}: file ${i + 1}'s name, a band of ${U.band} ${U.unit}: ${n}`));
    assert.ok(names[0].endsWith(` - Contour 2 (${U.top}).svg`), `${what}: the first file is the top band (${U.top}): ${names[0]}`);
    assert.ok(R.entries.every((e) => e.text.split('\n')[0] === R.page.wholeHeader), `${what}: every file on the whole file's page`);
    assert.strictEqual(R.zip, names[0].replace(` - Contour 2 (${U.top}).svg`, '.zip'), `${what}: the zip is named after the export`);
    assert.strictEqual(R.status.startsWith(`Exported ${names.length} files → ${R.zip}: ${names.join(', ')}.`), true, `${what}: the status line says how many files and their names: ${R.status}`);
    assert.strictEqual(R.toast, 0, `${what}: no toast`);
  }
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('split-files-888-live.test.js: ok');
} finally {
  await close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(panelDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
