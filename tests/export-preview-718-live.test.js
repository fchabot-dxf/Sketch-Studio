// tests/export-preview-718-live.test.js — TASK 718: the Export step's 3D | 2D switch in the real page, Fusion mode (Shaper ?host=fusion, window.adsk
// stubbed, the payloads sent through window.fusionJavaScriptHandler.handle('selection_data') as the add-in sends them), real mouse / touch input:
// DESKTOP 1280 x 800
//  1. an empty plan: the Export step opens on 3D (the default); a click on 2D shows the 2D view with the "No cuts assigned" message and an empty list;
//  2. the real Fusion solid (tests/fixtures/real-solid-plate-711.json) sent WHILE the 2D view shows: it updates (the same trigger as the 3D rebuild);
//     its element count == the downloaded file's (Generate Shaper SVG), element by element (type + depth); the file has no data-* attribute;
//     the list: one group per cut type with its count; a click on a list row highlights its element(s) and shows its label -> screenshot;
//  3. zoom (wheel), pan (drag) change the view; Fit frames the drawing again (the first build's view);
//  4. the SA-7 R3 floor fillet pocket as a Stepped pocket, adaptive Coarse (real clicks in Prepare, as task 717): the 2D view (remembered: the
//     Export step opens on 2D) holds the outline + 4 pockets == the downloaded file; zoomed onto the fillet, a click between the step 2 and step 3
//     outlines picks step 2: "pocket · 7.333 mm · step 2 of 4" -> screenshot;
// PHONE 390 x 844 (mobile, touch), the page reloaded: the Export step opens on 2D (the choice is remembered per app); the switch and the list are on
//  screen, no sideways scroll; a tap on the step 2 band shows its label; a tap on a list row picks its elements -> screenshot.
// Screenshots + the downloaded files: .evidence/718/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { clickOpenLive, stepLive } from './helpers/prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed
import { pressExportAction } from './helpers/export-actions.js'; // TASK 880: the Export actions are the header's (the drawer's on a phone)

const EVIDENCE_DIR = path.resolve('.evidence/718');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const realSolid = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');
const r3Fillet = fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8');
const NO_CUTS = 'No cuts assigned — assign cut types in Prepare first.';

const cdp = await launchBrowser({ tag: '718-export-2d', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-718-dl-'));

// The downloaded file's elements, read line by line (a <g> hoists shared attributes; its children inherit them): the 711 test's reader.
function fileElements(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push(`${m[1]} ${a['shaper:cutType']} ${a['shaper:cutDepth']}`);
  }
  return out;
}
// TASK 743: the 2D view paints the OUTSIDE elements at the back, deepest first (export-preview.js; the file writes the operations in cutting order, the
// outside cut last): the view's element order = the file's with those moved first
const paintOrder = (els) => { const depth = (e) => parseFloat(e.split(' ')[2]); const outs = els.filter((e) => e.split(' ')[1] === 'outside').sort((a, b) => depth(b) - depth(a)); return [...outs, ...els.filter((e) => !outs.includes(e))]; };
// the 2D view's elements as the page's own module reads them (export-preview.js previewItems on the shown layer)
const shownElements = () => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc') || document.createElement('div')).map((e) => e.tag + ' ' + e.cutType + ' ' + e.depth))`);
const label = () => evalJs(`document.getElementById('review-2d-info').textContent`);
const viewBox = () => evalJs(`document.getElementById('review-2d-canvas').getAttribute('viewBox').split(' ').map(Number)`);

const shot = async (name, sel = null) => {
  let clip = null;
  if (sel) clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
let touchMode = false;
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (x, y) => {
  if (touchMode) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(300); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(100);
};
// a real click / tap on the element's centre, after checking nothing covers it there
const clickElRaw = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); // TASK 743: the side card scrolls (the operations list is taller)
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await tap(p.x, p.y);
};
const clickWorldRaw = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await tap(p.x, p.y);
};
// TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the steps of before S2 in today's terms (tests/helpers/prepare-open-live.js): a click on the canvas = OK on the open
// operation, the click, and the clicked shape's operation opened (it is in one); a press / a typed field that changes the open operation = its own step
const s2Steps = { get phone() { return false; }, evalJs, waitFor, clickEl: clickElRaw };
const clickEl = (sel) => stepLive(s2Steps, () => clickElRaw(sel));
const clickWorld = (x, y) => clickOpenLive(s2Steps, () => clickWorldRaw(x, y));
const openStage = async (id) => {
  await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`);
};
const download = async () => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await pressExportAction({ evalJs, waitFor }, clickEl, 'btn-generate-svg');
  let file = null;
  for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
  assert.ok(file, 'the export downloaded');
  return fs.readFileSync(file, 'utf8');
};
// the screen point of a world point of the 2D view, and the element the browser hits there
const screenOf = (wx, wy) => evalJs(`(() => { const svg = document.getElementById('review-2d-canvas'); const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy};
  const s = pt.matrixTransform(document.querySelector('#review-2d-canvas .rv2d-doc').getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
// a world point inside the step 2 outline and outside step 3 (the middle of the band between their left edges, at the outline's mid height)
const step2Point = () => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => { const its = m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc'));
  const s2 = its.find((i) => i.step && i.step.k === 2).el.getBBox(), s3 = its.find((i) => i.step && i.step.k === 3).el.getBBox();
  return { x: (s2.x + s3.x) / 2, y: s2.y + s2.height / 2, band: s3.x - s2.x }; })`);
const hitLabelAt = (x, y) => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => { const h = document.elementFromPoint(${x}, ${y});
  const it = m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).find((i) => i.el === h); return it ? m.itemLabel(it) : (h && h.id); })`);
const wheelAt = async (x, y, n, dy = -300) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  for (let i = 0; i < n; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy }); await sleep(60); }
  await sleep(150);
};
const noSideScroll = () => evalJs(`({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: innerWidth })`);

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // 1. empty plan: 3D by default; 2D says "No cuts assigned"
  await openStage('review');
  const first = await evalJs(`({ pressed: [...document.querySelectorAll('#review-view-switch button')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')),
    twoD: !document.getElementById('review-2d').hidden, threeD: !document.getElementById('review-canvas-host').hidden, stored: localStorage.getItem('shaper-review-view') })`);
  console.log('Export step, first open: ' + JSON.stringify(first));
  assert.deepStrictEqual(first, { pressed: ['3D:true', '2D:false', 'Paths:false'], twoD: false, threeD: true, stored: null }, 'the Export step opens on 3D (the default)');
  await clickEl('#review-view-2d');
  await waitFor(`!document.getElementById('review-2d').hidden`, 'the 2D view');
  const empty = await evalJs(`({ label: document.getElementById('review-2d-info').textContent, rows: document.querySelectorAll('#review-cuts-list .rv2d-row').length, list: !document.getElementById('review-cuts').hidden,
    threeD: !document.getElementById('review-canvas-host').hidden, reset: !document.getElementById('review-reset').hidden, fit: !document.getElementById('review-fit').hidden, stored: localStorage.getItem('shaper-review-view') })`);
  console.log('2D, empty plan: ' + JSON.stringify(empty));
  assert.deepStrictEqual(empty, { label: NO_CUTS, rows: 0, list: true, threeD: false, reset: false, fit: true, stored: '2d' }, '2D with no cut: the "No cuts assigned" message, an empty list; the 3D parts hidden; the choice stored');

  // 2. the real solid sent while 2D shows: the view updates (the Review's rebuild trigger)
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(realSolid)})`);
  await waitFor(`/8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the real solid imported (8 regions)');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc *').length > 0`, 'the 2D view rebuilt');
  const solidShown = await shownElements();
  const solidFile = await download();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'real-solid-download.svg'), solidFile);
  const solidFileEls = fileElements(solidFile);
  console.log('real solid, 2D view: ' + JSON.stringify(solidShown));
  console.log('real solid, downloaded file: ' + JSON.stringify(solidFileEls));
  assert.strictEqual(solidShown.length, solidFileEls.length, 'the 2D view shows as many elements as the downloaded file holds');
  assert.deepStrictEqual(solidShown, paintOrder(solidFileEls), 'element by element: the same tag, type and depth, in file order (the outside painted first, TASK 743)');
  assert.deepStrictEqual(solidFileEls.map((e) => e.split(' ')[1]).sort(), ['inside', 'inside', 'inside', 'outside', 'pocket', 'pocket', 'pocket', 'pocket'], 'the file: the 711 result (1 outside, 3 inside, 4 pockets)');
  assert.ok(!/data-/.test(solidFile), 'the downloaded file has no data-* attribute');
  const solidList = await evalJs(`[...document.querySelectorAll('#review-cuts-list > *')].map((e) => e.textContent)`);
  console.log('real solid, list: ' + JSON.stringify(solidList));
  assert.strictEqual(await label(), '8 elements · tap one to see its cut', 'the label before a pick');
  const fitted = await viewBox();
  // a list row picks its element(s): the 10 mm pocket
  const row10 = await evalJs(`[...document.querySelectorAll('#review-cuts-list > button')].findIndex((b) => b.classList.contains('rv2d-row') && b.textContent.startsWith('10 mm'))`);
  assert.ok(row10 >= 0, 'the list has the 10 mm pocket row');
  await clickEl(`#review-cuts-list > button:nth-of-type(${row10 + 1})`); // TASK 743: the list's buttons are the operation headers and their rows
  const rowPick = await evalJs(`({ label: document.getElementById('review-2d-info').textContent, picked: [...document.querySelectorAll('#review-2d-canvas .rv2d-picked')].length,
    pressed: [...document.querySelectorAll('#review-cuts-list .rv2d-row')].map((b) => b.getAttribute('aria-pressed')).filter((p) => p === 'true').length })`);
  console.log('list row pick: ' + JSON.stringify(rowPick));
  assert.deepStrictEqual(rowPick, { label: 'pocket · 10 mm', picked: 1, pressed: 1 }, 'a list row picks its element: highlighted, labelled, the row pressed');
  await shot('desktop-2d-real-solid.png', '#view-review');

  // 3. zoom / pan / Fit
  const c = await evalJs(`(() => { const r = document.getElementById('review-2d-canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await wheelAt(c.x, c.y, 3);
  const zoomed = await viewBox();
  assert.ok(zoomed[2] < fitted[2] * 0.5, `the wheel zooms in: the view ${fitted[2].toFixed(1)} -> ${zoomed[2].toFixed(1)} mm wide`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 5; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x + 20 * i, y: c.y + 10 * i, button: 'left', buttons: 1 }); await sleep(30); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x + 100, y: c.y + 50, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
  const panned = await viewBox();
  assert.ok(panned[0] < zoomed[0] && panned[1] < zoomed[1] && Math.abs(panned[2] - zoomed[2]) < 1e-6, `a drag pans (the view moves with the drag, same zoom): ${zoomed.map((v) => v.toFixed(2))} -> ${panned.map((v) => v.toFixed(2))}`);
  assert.strictEqual(await label(), 'pocket · 10 mm', 'a drag is no tap: the pick stays');
  await clickEl('#review-fit');
  const refit = await viewBox();
  console.log('view: fitted ' + JSON.stringify(fitted) + ', zoomed ' + JSON.stringify(zoomed) + ', panned ' + JSON.stringify(panned) + ', Fit ' + JSON.stringify(refit));
  assert.ok(refit.every((v, i) => Math.abs(v - fitted[i]) < 1e-6), 'Fit frames the drawing again (the first build\'s view)');

  // 4. the R3 floor fillet as a Stepped pocket, adaptive Coarse (real clicks in Prepare, as task 717)
  await openStage('prepare');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(r3Fillet)})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the R3 floor fillet pocket imported');
  await clickWorld(60, -40);
  await clickEl('#prepare-panel .cut-type-trigger');
  await clickEl('.cut-type-opt[data-id="roughing"]');
  await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.cutType === 'roughing'))`, 'Stepped pocket set');
  await clickEl('.cut-tab[data-tab="passes"]'); await sleep(150); // TASK 810: the Roughing card is tabbed: its stepping rows are in Passes
  await clickEl('.cut-adaptive');
  await waitFor(`document.querySelector('.cut-adaptive').checked`, 'Adaptive stepping on');
  await clickEl('.cut-row[data-row="stepDeviation"] .cut-preset[data-value="0.5"]');
  await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.stepDeviation === 0.5))`, 'Coarse');
  await openStage('review');
  assert.strictEqual(await evalJs(`!document.getElementById('review-2d').hidden && document.getElementById('review-view-2d').getAttribute('aria-pressed')`), 'true', 'the Export step shows 2D again (the choice stays)');
  await waitFor(`document.querySelectorAll('#review-2d-canvas [data-step]').length === 4`, 'the 2D view of the stepped plan');
  const r3Shown = await shownElements();
  const r3File = await download();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'r3-fillet-download.svg'), r3File);
  console.log('R3 fillet, 2D view: ' + JSON.stringify(r3Shown));
  console.log('R3 fillet, downloaded file: ' + JSON.stringify(fileElements(r3File)));
  assert.deepStrictEqual(r3Shown, paintOrder(fileElements(r3File)), 'R3 fillet: the 2D view == the downloaded file, element by element (the outside painted first, TASK 743)');
  assert.deepStrictEqual(r3Shown, ['path outside 19.000 mm', 'path pocket 6.651 mm', 'path pocket 7.333 mm', 'path pocket 7.843 mm', 'path pocket 8.000 mm'], 'the outline + the 4 Coarse steps');
  assert.ok(!/data-/.test(r3File), 'the downloaded file has no data-* attribute (the step numbers are in the preview copy only)');
  await clickEl('#review-fit');
  const sp = await step2Point();
  let p = await screenOf(sp.x, sp.y);
  const bandPx = async () => { const a = await screenOf(sp.x - sp.band / 2, sp.y), b = await screenOf(sp.x + sp.band / 2, sp.y); return b.x - a.x; };
  console.log(`step 2 band at Fit: ${await bandPx()} px`);
  for (let i = 0; i < 8 && (await bandPx()) < 16; i++) { await wheelAt(p.x, p.y, 1); p = await screenOf(sp.x, sp.y); } // wheel-zoom onto the fillet until the band is 16 px
  console.log(`step 2 band zoomed: ${await bandPx()} px`);
  const hit = await hitLabelAt(p.x, p.y);
  console.log(`step 2 band ${sp.band.toFixed(3)} mm, at screen ${JSON.stringify(p)} the browser hits: ${hit}`);
  await tap(p.x, p.y);
  const stepLabel = await label();
  console.log('tap on the step 2 band: ' + stepLabel);
  assert.strictEqual(stepLabel, 'pocket · 7.333 mm · step 2 of 4', 'a click on the stepped pocket\'s step 2 says its type, depth and step');
  assert.strictEqual(await evalJs(`document.querySelector('#review-2d-canvas .rv2d-picked').getAttribute('data-step')`), '2/4', 'the step 2 element is the one highlighted');
  await shot('desktop-2d-r3-fillet-step2-zoomed.png', '#review-stage');
  // a tap on empty space clears the pick
  const corner = await evalJs(`(() => { const r = document.getElementById('review-2d-canvas').getBoundingClientRect(); return { x: Math.round(r.right - 30), y: Math.round(r.top + 60) }; })()`);
  await clickEl('#review-fit');
  await tap(corner.x, corner.y);
  assert.strictEqual(await label(), '5 elements · tap one to see its cut', 'a tap on empty space clears the pick');

  // PHONE 390 x 844: reloaded, the Export step opens on 2D (remembered); switch + list on screen, no sideways scroll; taps pick
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touchMode = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler`, 'the Fusion handler (phone)');
  await waitFor(`!document.getElementById('view-review').hidden && document.querySelectorAll('#review-2d-canvas [data-step]').length === 4`, 'the reloaded page on the Export step, 2D, the stepped plan');
  // TASK 880: no side panel: the Cuts card floats under the view's toolbar, folded on a phone (its title unfolds it)
  assert.strictEqual(await evalJs(`document.getElementById('review-cuts').dataset.open`), 'false', 'phone: the Cuts card starts folded');
  { const h = await evalJs(`(() => { const r = document.getElementById('review-cuts-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); await tap(h.x, h.y); }
  await waitFor(`document.getElementById('review-cuts').dataset.open === 'true'`, 'phone: a tap on its title unfolds the Cuts card');
  const ph = await evalJs(`(() => { const box = (q) => { const e = document.querySelector(q); const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y);
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), reachable: !!h && (h === e || e.contains(h)) }; };
    return { pressed: document.getElementById('review-view-2d').getAttribute('aria-pressed'), view3d: box('#review-view-3d'), view2d: box('#review-view-2d'), fit: box('#review-fit'), canvas: box('#review-2d-canvas'),
      list: box('#review-cuts'), firstRow: box('#review-cuts-list .rv2d-row'), toolbar: box('#review-toolbar') }; })()`);
  console.log('phone: ' + JSON.stringify(ph));
  assert.strictEqual(ph.pressed, 'true', 'phone: the reloaded page shows 2D (remembered per app)');
  for (const k of ['view3d', 'view2d', 'fit', 'firstRow']) assert.ok(ph[k].reachable && ph[k].left >= 0 && ph[k].right <= 390 && ph[k].top >= 0 && ph[k].bottom <= 844, `phone: ${k} on screen and not covered: ${JSON.stringify(ph[k])}`);
  assert.ok(ph.list.left >= 0 && ph.list.right <= 390 && ph.list.top >= ph.toolbar.bottom, 'phone: the list is under the view toolbar, inside the screen width: ' + JSON.stringify(ph.list));
  { const h = await evalJs(`(() => { const r = document.getElementById('review-cuts-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); await tap(h.x, h.y); }
  await waitFor(`document.getElementById('review-cuts').dataset.open === 'false'`, 'phone: folded again (the drawing under it free for the pinch)');
  const sc = await noSideScroll();
  assert.ok(sc.doc <= 390 && sc.body <= 390, 'phone: no sideways scroll: ' + JSON.stringify(sc));
  // pinch (two real touches moving apart) zooms in on the fillet, then a tap on the step 2 band
  const fitPhone = await viewBox();
  const sq = await step2Point();
  let q = await screenOf(sq.x, sq.y);
  for (let k = 0; k < 1; k++) {
    await T('touchStart', [{ x: q.x - 20, y: q.y }, { x: q.x + 20, y: q.y }]);
    for (let i = 1; i <= 6; i++) { await T('touchMove', [{ x: q.x - 20 - 10 * i, y: q.y }, { x: q.x + 20 + 10 * i, y: q.y }]); await sleep(30); }
    await T('touchEnd', []); await sleep(150);
    q = await screenOf(sq.x, sq.y);
  }
  const pinched = await viewBox();
  console.log('phone: pinch ' + JSON.stringify({ fit: fitPhone, pinched }));
  assert.ok(pinched[2] < fitPhone[2] / 2, `phone: a pinch zooms in (${fitPhone[2].toFixed(1)} -> ${pinched[2].toFixed(1)} mm wide)`);
  console.log(`phone: at ${JSON.stringify(q)} the browser hits: ${await hitLabelAt(q.x, q.y)}`);
  await tap(q.x, q.y);
  assert.strictEqual(await label(), 'pocket · 7.333 mm · step 2 of 4', 'phone: a tap on the step 2 band says its type, depth and step');
  await shot('phone-2d-r3-fillet-step2.png');
  // a tap on a list row (the step 3 row) picks it (TASK 880: the Cuts card unfolded again by a tap on its title)
  { const h = await evalJs(`(() => { const r = document.getElementById('review-cuts-head').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`); await tap(h.x, h.y); }
  await waitFor(`document.getElementById('review-cuts').dataset.open === 'true'`, 'phone: the Cuts card unfolded');
  await evalJs(`[...document.querySelectorAll('#review-cuts-list .rv2d-row')].find((b) => /step 3 of 4/.test(b.textContent)).scrollIntoView({ block: 'nearest' })`);
  await sleep(200);
  const row3 = await evalJs(`[...document.querySelectorAll('#review-cuts-list > button')].findIndex((b) => b.classList.contains('rv2d-row') && /step 3 of 4/.test(b.textContent))`);
  await clickEl(`#review-cuts-list > button:nth-of-type(${row3 + 1})`); // TASK 743: the list's buttons are the operation headers and their rows
  assert.strictEqual(await label(), 'pocket · 7.843 mm · step 3 of 4', 'phone: a tap on a list row picks its element');
  assert.strictEqual(await evalJs(`document.querySelector('#review-2d-canvas .rv2d-picked').getAttribute('data-step')`), '3/4', 'phone: the step 3 element is highlighted');
  await shot('phone-2d-list-row.png');
  console.log('export-preview-718-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
