// tests/relief-view-889-live.test.js — TASK 889: an STL relief's Roughing + 3D Contour in the real Shaper page (web mode), real clicks / touches, DESKTOP 1280 x 800
// (Prepare's Insert STL, as the advisor's screenshot run) and PHONE 390 x 844 (touch; the drawer's Open STL). The part: tests/fixtures/relief-terrain-889.js.
//  1. PREPARE DRAWS EVERY CONTOUR PASS: the new Contour open, its Preview: one pass line (.sk-clear-path) per pass of its note ("N passes along the walls");
//     before 889 only its thinned travel marks were drawn (a few loops' worth of scattered dashes).
//  2. NO CARD CHOICE IS CLIPPED: every choice button (.cut-preset) of the Roughing card and the Contour card, on every tab, and of the STL card, shows its whole
//     text inside its button and the card; the Roughing's Layout row (Terraces | Nested) two buttons side by side (before 889: "erraceNested", the row fell on
//     the 4-column bit grid). The rows checked are printed.
// No console error / page exception. Screenshots: .evidence/889/<device>-*.png.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { binaryStl } from './helpers/stl-mesh.js';
import { openOpLive, okLive, previewLive } from './helpers/prepare-open-live.js';
import { reliefTerrain } from './fixtures/relief-terrain-889.js';

const EVIDENCE_DIR = path.resolve('.evidence/889');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const TAG = process.env.EVIDENCE_TAG ? process.env.EVIDENCE_TAG + '-' : ''; // a before / after capture of the same steps
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-889-'));
const STL = path.join(tmp, 'relief.stl');
fs.writeFileSync(STL, binaryStl(reliefTerrain()));

const cdp = await launchBrowser({ tag: '889-relief', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { send, once, ws, evalJs, waitFor, waitForApp, navigate, close, port } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const shot = async (name, sel = null, pad = 8) => {
  let clip = null;
  if (sel) clip = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); const x = Math.max(0, r.left - ${pad}), y = Math.max(0, r.top - ${pad});
    return { x, y, width: Math.min(innerWidth, r.right + ${pad}) - x, height: Math.min(innerHeight, r.bottom + ${pad}) - y, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const f = path.join(EVIDENCE_DIR, `${TAG}${name}`);
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  console.log('screenshot ' + f);
};
let touch = false;
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
const idle = (what) => waitFor(`import('/apps/shaper/src/op-paths.js').then((m) => m.generatingCount() === 0)`, what, 180000);
const opOf = (type) => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => { const o = m.storeOps().find((o) => o.type === ${JSON.stringify(type)}); return o ? o.id : null; })`);
const tabs = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-tab')].filter((b) => !b.hidden).map((b) => b.dataset.tab)`);
const tab = async (id) => { await clickEl(`#prepare-panel .cut-tab[data-tab="${id}"]`); await waitFor(`document.querySelector('#prepare-panel .cut-tab[data-tab="${id}"]').classList.contains('is-active')`, `the ${id} tab`); await sleep(150); };
// every VISIBLE choice button inside `scope`: its row, its text, and whether the text lies inside its button and the card (a Range's box: the text as drawn)
const presets = (scope, cardSel) => evalJs(`[...document.querySelectorAll(${JSON.stringify(scope + ' .cut-preset')})].filter((b) => b.offsetParent && b.getClientRects().length).map((b) => {
  const card = document.querySelector(${JSON.stringify(cardSel)}).getBoundingClientRect(), r = b.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(b); const tx = rg.getBoundingClientRect();
  const row = b.closest('.cut-row'); const inside = tx.left >= r.left - 0.5 && tx.right <= r.right + 0.5 && r.left >= card.left - 0.5 && r.right <= card.right + 0.5;
  return { row: row ? (row.dataset.row || row.dataset.param) : (b.parentElement.className || '?'), text: b.textContent, inside, button: [Math.round(r.left), Math.round(r.width)], text_: [Math.round(tx.left), Math.round(tx.width)] }; })`);
const checkCard = async (what, cardSel = '#prepare-panel .cut-card') => {
  const out = [];
  for (const id of await tabs()) { await tab(id); out.push(...(await presets(cardSel, cardSel)).map((p) => ({ ...p, tab: id }))); }
  const rows = [...new Set(out.map((p) => p.tab + ':' + p.row))];
  console.log(`${what}: choice rows checked ${JSON.stringify(rows)}`);
  const clipped = out.filter((p) => !p.inside);
  console.log(`${what}: clipped ${JSON.stringify(clipped)}`);
  return { out, rows, clipped };
};
const frame = async () => { // the part framed in the canvas (Prepare's own setView), centred
  const b = await evalJs(`Promise.all([import('/apps/shaper/src/selection-list.js'), import('/packages/core/geometry-bounds.js')]).then(([S, G]) => { const st = window.__designController.state; const e = S.getSelections().find((x) => x.kind === 'stl');
    return G.computeGeometryBounds(Object.create(st, { shapes: { value: st.shapes.filter((s) => e.shapeIds.includes(s.id)) } })); })`);
  await evalJs(`window.__prepareView.setView(${JSON.stringify({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, w: (b.maxX - b.minX) * 1.15 })})`);
  await sleep(500);
};
const toolbarPick = async (id) => { // TASK S3: on a phone held upright a type that does not fit is in the Operations section's dropdown
  if (await evalJs(`!document.getElementById('op-type-${id}').hidden`)) { await clickEl(`#op-type-${id}`); return; }
  await clickEl('#prepare-ribbon .sk-ribbon-group[data-section="operations"] button.sk-ribbon-group-label');
  await waitFor(`document.querySelector('.sk-ribbon-sect-menu').classList.contains('show')`, 'the Operations dropdown');
  await clickEl(`.sk-ribbon-sect-item[data-id="op-type-${id}"]`);
};
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
  console.log(`${what}: ${await evalJs(`document.getElementById('prepare-notice').textContent`)}`);
  await idle(what + ': the insert\'s paths');
};

const results = {};
async function phase(what) {
  const R = results[what] = {};
  // the STL card's choices (Up, units)
  await waitFor(`!document.querySelector('#prepare-panel .stl-card').hidden`, what + ': the STL card');
  if (await evalJs(`document.querySelector('#prepare-panel .stl-card .stl-body').hidden`)) await clickEl('#prepare-panel .stl-head');
  await sleep(300);
  const stl = await presets('#prepare-panel .stl-card', '#prepare-panel .stl-card');
  console.log(`${what}: STL card choices ${JSON.stringify(stl.map((p) => p.text + (p.inside ? '' : ' CLIPPED')))}`);
  R.stlClipped = stl.filter((p) => !p.inside);
  if (touch) { await clickEl('#prepare-panel .stl-head'); await sleep(300); } // folded again (it would cover the card on a phone)

  // ── the ROUGHING (the insert's own), opened: every choice row
  const rId = await opOf('roughing');
  await openOpLive(t, rId);
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Roughing'`, what + ': the Roughing card', 60000);
  await tab('passes');
  await shot(`${what}-roughing-layout-row.png`, '#prepare-panel .cut-row[data-row="roughLayout"]', 12);
  R.layout = await evalJs(`(() => { const bs = [...document.querySelectorAll('.cut-layout-modes .cut-preset')].map((b) => b.getBoundingClientRect()); return { n: bs.length, sameRow: bs.length === 2 && Math.abs(bs[0].top - bs[1].top) < 1, apart: bs.length === 2 && bs[0].right <= bs[1].left + 0.5 }; })()`);
  R.rough = await checkCard(what + ' Roughing');
  await shot(`${what}-roughing-card.png`, '#prepare-panel .cut-card', 6);
  await okLive(t);

  // ── the CONTOUR: the part selected (its Roughing's row), the toolbar's Contour = a NEW operation, open; its Preview
  if (await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) { await clickEl('#prepare-ops .ops-head'); await sleep(250); }
  await clickEl(`#prepare-ops .ops-row[data-id="${rId}"] .ops-pick`);
  await sleep(300);
  await toolbarPick('contour');
  await waitFor(`document.querySelector('.cut-type-cur') && document.querySelector('.cut-type-cur').textContent === 'Contour' && !document.querySelector('#prepare-panel .cut-actions').hidden`, what + ': the new Contour, open', 180000);
  if (touch && !(await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`))) { await clickEl('#prepare-ops .ops-head'); await sleep(300); } // the list opened for the pick: folded (it covers the card on a phone)
  await previewLive(t, what + ': the Contour preview');
  await frame();
  await shot(`${what}-contour-open.png`);
  await shot(`${what}-contour-canvas.png`, '#prepare-canvas', 0);
  R.contour = await checkCard(what + ' Contour');
  await tab('passes');
  const note = await evalJs(`[...document.querySelectorAll('#prepare-panel .cut-note div')].map((d) => d.textContent).join(' ')`);
  R.passes = Number((/(\d+) passes along the walls/.exec(note) || [])[1]);
  R.lines = await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-clear-path').length`);
  R.marks = await evalJs(`document.querySelectorAll('#prepare-toolpath-group .sk-travel-steps .sk-travel').length`);
  console.log(`${what}: Contour note ${JSON.stringify(note)} | pass lines ${R.lines} | travel marks ${R.marks}`);
  await okLive(t);
}

try {
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStage('prepare');
  await chooseStl(() => clickEl('#prepare-insert-stl'), 'desktop insert');
  await phase('desktop');

  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 20000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await chooseStl(async () => { await clickEl('.sk-sidebar-chevron'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300); await clickEl('[data-action="open-stl"]'); }, 'phone open');
  await phase('phone');

  for (const [what, R] of Object.entries(results)) {
    console.log(`ROW ${what} | layout ${JSON.stringify(R.layout)} | clipped roughing ${R.rough.clipped.length} contour ${R.contour.clipped.length} stl ${R.stlClipped.length} | contour ${R.passes} passes, ${R.lines} lines, ${R.marks} marks`);
    assert.deepStrictEqual(R.layout, { n: 2, sameRow: true, apart: true }, `2 ${what}: the Layout row: Terraces and Nested side by side`);
    assert.deepStrictEqual([R.rough.clipped, R.contour.clipped, R.stlClipped], [[], [], []], `2 ${what}: no choice of the Roughing, Contour or STL card is clipped`);
    assert.ok(R.rough.rows.includes('passes:roughLayout'), `2 ${what}: the Layout row was checked`);
    assert.ok(R.passes > 100, `1 ${what}: the Contour's note counts its passes (${R.passes})`);
    assert.ok(R.lines >= R.passes, `1 ${what}: Prepare draws a line per pass (${R.lines} for ${R.passes})`);
  }
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('relief-view-889-live.test.js: ok');
} finally {
  await close();
}
