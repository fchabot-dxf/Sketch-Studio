// tests/stock-placement-898-live.test.js — TASK 898 = STOCK step T2 + the sculpted part's placement, in the BUILT Fusion panel (scripts/build-site.cjs shaper-fusion),
// served the way the add-in serves it (its own static server on 127.0.0.1), in headless Edge with the fake Fusion bridge of fusion-panel-881-live (a window.adsk
// stub before load, the add-in's answers through window.fusionJavaScriptHandler). Desktop (1280 x 800) then a phone (390 x 844, touch), each from an empty page:
//   pong -> Add selection -> selection_data (the add-in's own SA-35 body relief, tests/fixtures/fusion-body-relief-887.json: a 12 mm dome) -> the Operations list
//   shows the Stock row (EMPTY, its thickness from the part: 12 mm) -> its card: Thickness 20 mm typed, "Sculpted parts sit on" Floor (the default) -> Export: the
//   3D board built (the Roughing to 20 mm: the part on the stock's floor) -> Prepare, the Stock's card: Top -> Export: another build (the Roughing to 12 mm: the
//   part's top at the stock's top, as before 898).
// Screenshots (legible) to .evidence/898/: the Operations list with the Stock row, the Stock card, the two 3D builds (desktop and phone).
import assert from 'node:assert';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const require = createRequire(import.meta.url);
const { buildFusionPanel, PANEL_MIME } = require('../scripts/build-site.cjs');
const EVID = path.resolve('.evidence/898');
fs.mkdirSync(EVID, { recursive: true });
const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/fusion-body-relief-887.json', import.meta.url), 'utf8'));
const PAYLOAD = FIXTURE.payload; // the add-in's output for a 12 mm faceted dome: ONE relief region, stock.thicknessMm 12
assert.strictEqual(PAYLOAD.stock.thicknessMm, 12, 'the fixture: a 12 mm body');

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

const panelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-fusion-panel-898-live-'));
buildFusionPanel(panelDir);
const panel = await servePanel(panelDir);
const cdp = await launchBrowser({ tag: '898-panel', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { panel.server.close(); console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, evalJs, waitFor, navigate, waitForApp, close } = cdp;
const ORIGIN = `http://127.0.0.1:${panel.port}`;
const md5 = (file) => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');

let touch = false;
const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
const tapAt = async (x, y) => {
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  await sleep(250);
};
const press = async (sel) => { const c = await centre(sel); assert.ok(c && c.hit, sel + ' is there to press ' + JSON.stringify(c)); await tapAt(c.x, c.y); };
const typeInto = async (sel, text) => { await press(sel); await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(200); };
const shotOf = async (name, sel = null) => {
  let clip;
  if (sel) { const r = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, b.left), y: Math.max(0, b.top), width: Math.min(b.width, innerWidth), height: Math.min(b.height, innerHeight) }; })()`); clip = { ...r, scale: 2 }; }
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const file = path.join(EVID, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
};
// the 3D view's middle (the relief: the board is the part's bounds + 6 in, so the part is small in the whole view), zoomed
const zoomShot = async (name) => {
  const r = await evalJs(`(() => { const b = document.getElementById('view-review').getBoundingClientRect(); const w = Math.min(260, b.width * 0.6), h = Math.min(160, b.height * 0.35); return { x: b.left + (b.width - w) / 2, y: b.top + b.height * 0.48 - h / 2, width: w, height: h }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 4 } });
  const file = path.join(EVID, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
};
const M = (m) => `import('./src/${m}.js')`; // the panel's modules (its page is at the top of its folder)
const stockOp = `${M('operations-store')}.then((m) => { const o = m.storeOps().find((x) => x.type === 'stock'); return o ? { id: o.id, geometry: o.geometry.length, cutDepth: o.settings.cutDepth, sculptedOn: o.settings.sculptedOn || null } : null; })`;
const roughDepth = `${M('cut-plan')}.then((m) => { const e = m.planEntries().find((x) => x.rec.cutType === 'roughing'); return e ? e.rec.cutDepth : null; })`;
const pathsDone = `${M('op-paths')}.then((m) => m.generatingCount() === 0)`;

async function opsOpen() {
  if (await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) { await press('#prepare-ops .ops-head'); await sleep(300); }
}
async function openStock(id) {
  await opsOpen();
  await press(`#prepare-ops .ops-row[data-id="${id}"] .ops-pick`);
  await press(`#prepare-ops .ops-row[data-id="${id}"] .ops-edit`);
  await waitFor(`(() => { const a = document.querySelector('#prepare-panel .cut-actions'); return a && !a.hidden && window.__prepareView.activeOp() && window.__prepareView.activeOp().id === ${JSON.stringify(id)}; })()`, `the Stock ${id} open`);
}
const shown = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`);
// a stage: the header's tab, or (a phone: the header hides its tabs) the drawer's stage button
async function toStage(tab) {
  if (await shown(`.sk-header-tab[data-tab="${tab}"]`)) { await press(`.sk-header-tab[data-tab="${tab}"]`); return; }
  await press((await shown('.sk-sidebar-chevron')) ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer open');
  await sleep(300);
  await press(`.sk-sidebar-stage[data-tab="${tab}"]`);
  await sleep(300);
}
async function okCard() { await press('#prepare-panel .cut-ok'); await waitFor(pathsDone, 'the paths generated', 120000); }
async function exportBuild(label) {
  await toStage('review');
  await waitFor(`!document.getElementById('view-review').hidden`, label + ': the Export stage');
  await waitFor(`import('./src/fusion-main.js').then((m) => { const v = m.currentReviewView(); return !!(v && v.lastBuild && v.lastBuild.triangles > 0) && !document.getElementById('review-info').querySelector('.sk-wait-spin, .sk-wait-action'); })`, label + ': the 3D board built', 90000);
  await sleep(600);
  return evalJs(`import('./src/fusion-main.js').then((m) => { const b = m.currentReviewView().lastBuild; return { triangles: b.triangles, levels: b.levels, board: b.board }; })`);
}

async function phase(tag, { width, height, mobile }) {
  touch = mobile;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 1 : 0 });
  await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' }); // each phase from an empty page (the panel's own origin)
  await navigate(`${ORIGIN}/index.html`);
  await waitForApp('design-canvas');
  await waitFor(`!!document.getElementById('btn-fusion-add-selection')`, tag + ': the Fusion bar');
  await evalJs(`window.fusionJavaScriptHandler.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0.20256', documentName: 'Dome v3' }))`);
  await press('#btn-fusion-add-selection');
  await waitFor(`window.adsk._sent.some((m) => m.action === 'add_selection')`, tag + ': add_selection sent');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(JSON.stringify(PAYLOAD))})`);
  await waitFor(`/^Added Body1/.test(document.getElementById('prepare-notice').textContent)`, tag + ': the selection notice');
  await waitFor(pathsDone, tag + ': the Roughing generated', 120000);

  // T2: the first add made ONE EMPTY Stock, from the part, listed in the Operations list
  const s0 = await evalJs(stockOp);
  assert.deepStrictEqual([s0 && s0.geometry, s0 && s0.cutDepth], [0, 'model'], `${tag}: ONE EMPTY Stock operation, its thickness from the part: ${JSON.stringify(s0)}`);
  await opsOpen();
  const rows = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => ({ id: r.dataset.id, text: r.querySelector('.ops-name').textContent }))`);
  assert.ok(rows.some((r) => r.id === s0.id && /Stock/.test(r.text)), `${tag}: the Operations list shows the Stock row: ${JSON.stringify(rows)}`);
  assert.strictEqual(await evalJs(roughDepth), 12, `${tag}: the Roughing to the part's 12 mm (stock = part)`);
  const listShot = await shotOf(`${tag}-ops-stock-row.png`, '#prepare-ops');

  // the Stock's card: Thickness 20 mm, Sculpted parts sit on: Floor (the default)
  await openStock(s0.id);
  await waitFor(`!!document.querySelector('#prepare-panel .cut-row[data-row="sculptedOn"]') && document.querySelector('#prepare-panel .cut-row[data-row="sculptedOn"]').style.display !== 'none'`, `${tag}: the Sculpted parts sit on row`);
  const card = await evalJs(`(() => { const r = document.querySelector('#prepare-panel .cut-row[data-row="sculptedOn"]'); return { label: r.querySelector('.cut-field-label').textContent, choices: [...r.querySelectorAll('.cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '')) }; })()`);
  assert.deepStrictEqual(card, { label: 'Sculpted parts sit on', choices: ['Floor*', 'Top'] }, `${tag}: the row, Floor in effect (the default)`);
  const thicknessShown = await evalJs(`(() => { const i = document.querySelector('#prepare-panel .cut-depth'); return { value: i.value, placeholder: i.placeholder }; })()`); // what the card shows for 'model' (T3 rules the card: reported)
  await typeInto('#prepare-panel .cut-depth', '20 mm'); // the panel's document unit is inches: the unit typed
  assert.strictEqual((await evalJs(stockOp)).cutDepth, 20, `${tag}: the Stock typed 20 mm`);
  const cardShot = await shotOf(`${tag}-stock-card.png`, '#prepare-panel .cut-card');
  await okCard();
  assert.strictEqual(await evalJs(roughDepth), 20, `${tag}: Floor: the Roughing runs to the stock's bottom (20 mm)`);
  const floor = await exportBuild(`${tag} Floor`);
  const floorShot = await shotOf(`${tag}-export-3d-floor.png`, '#view-review');
  const floorZoom = await zoomShot(`${tag}-export-3d-floor-zoom.png`);
  const floorInfo = await evalJs(`document.getElementById('review-info').textContent`);

  // Top: the part's top at the stock's top
  await toStage('prepare');
  await waitFor(`!document.getElementById('view-prepare').hidden`, `${tag}: back in Prepare`);
  await openStock(s0.id);
  await press('#prepare-panel .cut-sculpted-on .cut-preset[data-value="top"]');
  assert.strictEqual((await evalJs(stockOp)).sculptedOn, 'top', `${tag}: Top set on the Stock`);
  assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-sculpted-on .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : ''))`), ['Floor', 'Top*'], `${tag}: Top in effect`);
  await okCard();
  assert.strictEqual(await evalJs(roughDepth), 12, `${tag}: Top: the Roughing to the part's 12 mm (as before 898)`);
  const top = await exportBuild(`${tag} Top`);
  const topShot = await shotOf(`${tag}-export-3d-top.png`, '#view-review');
  const topZoom = await zoomShot(`${tag}-export-3d-top-zoom.png`);
  const topInfo = await evalJs(`document.getElementById('review-info').textContent`);
  assert.notDeepStrictEqual(top, floor, `${tag}: the Export 3D changed with the choice (Floor ${JSON.stringify(floor)}, Top ${JSON.stringify(top)})`);
  assert.notStrictEqual(md5(floorShot), md5(topShot), `${tag}: two different 3D captures`);
  assert.notStrictEqual(md5(floorZoom), md5(topZoom), `${tag}: two different zoomed 3D captures`);
  console.log(`ROW ${tag} | Stock ${JSON.stringify(s0)} | its card's Thickness while from the part: ${JSON.stringify(thicknessShown)} | Floor 3D ${JSON.stringify(floor)} "${floorInfo}" md5 ${md5(floorShot)} zoom ${md5(floorZoom)} | Top 3D ${JSON.stringify(top)} "${topInfo}" md5 ${md5(topShot)} zoom ${md5(topZoom)} | shots ${[listShot, cardShot, floorShot, floorZoom, topShot, topZoom].map((f) => path.basename(f)).join(', ')}`);
}

try {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.adsk = { _sent: [], fusionSendData(action, data) { this._sent.push({ action, data }); return '{}'; } };
  })();` });
  await phase('desktop', { width: 1280, height: 800, mobile: false });
  await phase('phone', { width: 390, height: 844, mobile: true });
  console.log('stock-placement-898-live: ok');
} finally {
  await close();
  await new Promise((r) => panel.server.close(r));
  fs.rmSync(panelDir, { recursive: true, force: true });
}
