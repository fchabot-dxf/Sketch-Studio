// tests/noshift-813-live.test.js — TASK 813 in the real page (Shaper, real mouse / touch input), desktop 1280 x 800 then a phone 390 x 844 (touch): NO LAYOUT SHIFTS in the cut card.
// Task 805's layout probe (tests/helpers/tooltip-live.js snap / movedBoxes): every card row, field, box, the note, the panel, the Operations rows keep their boxes (0 px) while:
//   * Outside: Hold part Tabs -> Onion skin -> Off (its rows stay in place, greyed);
//   * On line: Lead-in On -> Off, then Hold part Tabs (Lead-in greys with its reason) -> Off;
//   * Pocket: Clearing Spiral (a note with the turns, the leftover ... appears) -> Loop on -> off -> Raster -> Freehand (its rows stay in place);
//   * a long note (more lines than the area shows) and no note: the note area keeps its box; the Prepare notice (an overlay) and the Export status line (a slot of its own).
// A greyed row's label shows its reason in its tooltip (the probe's real hover / long press). No console error / page exception. Screenshots: .evidence/813/<device>-*.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { probe } from './helpers/tooltip-live.js';

const EVIDENCE_DIR = path.resolve('.evidence/813');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });
const sq = (x0, y0, x1, y1) => ({ closed: true, segments: [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)] });
const PAYLOAD = {
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { name: 'Body1', documentName: 'noshift' }, stock: { thicknessMm: 4 },
  regions: [
    { id: 'reg_0', label: 'A', cutType: 'outside', depthMm: 4, through: false, outer: sq(0, 0, 60, 40), holes: [] },
    { id: 'reg_1', label: 'B', cutType: 'outside', depthMm: 4, through: false, outer: sq(80, 0, 140, 40), holes: [] },
  ],
  chains: [], warnings: [],
};

const cdp = await launchBrowser({ tag: '813-noshift', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
let device = 'desktop', touch = false, tt = null;
const shot = async (name, sel = null) => {
  let clip = null;
  if (sel) clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  const file = path.join(EVIDENCE_DIR, `${device}-${name}`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('screenshot ' + file);
};
const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
const press = async (x, y) => {
  if (touch) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(350); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const clickEl = async (sel) => {
  await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'nearest' }); })()`);
  await sleep(60);
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + Math.min(r.width / 2, 30)), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${device}: ${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const pressWorld = async (pts, what) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'), M = svg.getScreenCTM();
    for (const [x, y] of ${JSON.stringify(pts)}) { const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const s = pt.matrixTransform(M); const sx = Math.round(s.x), sy = Math.round(s.y);
      const hit = document.elementFromPoint(sx, sy); if (hit && svg.contains(hit) && sx > 50 && sy > 50 && sx < innerWidth - 20 && sy < innerHeight - 20) return { x: sx, y: sy }; }
    return null; })()`);
  assert.ok(p, `${device}: ${what}: a point on the canvas`);
  await press(p.x, p.y);
};
const A_PTS = [[5, -5], [55, -5], [5, -35], [55, -35], [30, -3], [3, -20]];
const openStage = async (id) => {
  if (touch) { await clickEl('.sk-sidebar-chevron'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300); await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`); }
  else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('${id === 'design' ? 'design-view' : 'view-' + id}').hidden`, `the ${id} stage`);
  await sleep(300);
};
const pickType = async (id) => {
  await clickEl('.cut-type-trigger'); await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
  await clickEl(`.cut-type-opt[data-id="${id}"]`);
  await waitFor(`document.querySelector('.cut-type-menu').hidden`, 'the menu closes'); await sleep(250);
};
const rowsOf = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-rows .cut-row')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => (r.dataset.row || r.dataset.param) + ('off' in r.dataset ? ':off' : ''))`);
const blur = () => evalJs(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
let probes = 0, boxes = 0;
// `act` changes a setting through the real UI; the layout before and after must be identical (popups excluded: they open on the rows, over the card)
async function noShift(label, act) {
  await blur(); await sleep(80);
  const a = await tt.snap();
  await act();
  await blur(); await sleep(350);
  const b = await tt.snap();
  const mv = tt.movedBoxes(a, b).filter((s) => !s.includes('.cut-pop') && !s.startsWith('#prepare-ops') && !s.startsWith('#prepare-dir-legend')); // the direction legend is an absolute overlay (it shows with an open path) // the Operations LIST is its own panel: a setting can make one more operation (Tabs: the tabbed outline is another one): its rows are the plan, not the card
  assert.deepStrictEqual(mv, [], `${device}: ${label}: nothing moved (0 px)`);
  probes++; boxes = Object.keys(a).length;
  console.log(`${device}: ${label}: ${Object.keys(a).length} boxes, 0 px`);
}
const preset = (cls, value) => clickEl(`.${cls} .cut-preset[data-value="${value}"]`);
const tooltipOf = async (sel) => { await tt.show(sel); const tip = await tt.tip(); await tt.leave(); return tip && tip.text; };

async function phase() {
  await openStage('prepare');
  await evalJs(`import('/apps/shaper/src/fusion-import.js').then((m) => m.importFusionSelection(${JSON.stringify(PAYLOAD)}, { controller: window.__designController }))`);
  await openStage('design'); await openStage('prepare');
  await waitFor(`document.getElementById('prepare-notice').hidden`, 'the notice gone', 10000);
  tt = probe({ phone: touch, evalJs, send });

  // OUTSIDE: Hold part
  await pressWorld(A_PTS, 'shape A');
  await pickType('exterior');
  const outsideRows = await rowsOf();
  assert.deepStrictEqual(outsideRows.filter((r) => /^(holdPart|tabCount|tabWidth|holdThickness)/.test(r)), ['holdPart', 'tabCount:off', 'tabWidth:off', 'holdThickness:off'], `${device}: Outside, Hold part Off: its rows stay, greyed`);
  await shot('outside-hold-off.png', '#prepare-panel .cut-card');
  await noShift('Outside: Hold part Tabs', () => preset('cut-hold-modes', 'tabs'));
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^(tabCount|tabWidth|holdThickness)/.test(r)), ['tabCount', 'tabWidth', 'holdThickness'], `${device}: Tabs: its rows are live`);
  await shot('outside-hold-tabs.png', '#prepare-panel .cut-card');
  await noShift('Outside: Hold part Onion skin', () => preset('cut-hold-modes', 'skin'));
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^(tabCount|tabWidth|holdThickness)/.test(r)), ['tabCount:off', 'tabWidth:off', 'holdThickness'], `${device}: Onion skin: only the thickness is live`);
  await noShift('Outside: Hold part Off', () => preset('cut-hold-modes', 'off'));
  const holdTip = await tooltipOf('.cut-row[data-row="tabCount"] .cut-field-label');
  assert.ok(holdTip && holdTip.startsWith('Choose Tabs in Hold part to set this.'), `${device}: the greyed Tab count row says why in its tooltip: ${JSON.stringify(holdTip)}`);

  // ON LINE: Lead-in, Hold part Tabs
  await pickType('online');
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^leadIn/.test(r)), ['leadIn', 'leadInRadius:off', 'leadInSweep:off', 'leadInLength:off', 'leadInSide:off', 'leadInAt:off'], `${device}: On line, Lead-in Off: its rows stay, greyed`);
  await shot('online-leadin-off.png', '#prepare-panel .cut-card');
  await noShift('On line: Lead-in On', () => preset('cut-lead-modes', 'true'));
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^leadIn/.test(r)), ['leadIn', 'leadInRadius', 'leadInSweep', 'leadInLength', 'leadInSide', 'leadInAt'], `${device}: Lead-in On: its rows are live`);
  await shot('online-leadin-on.png', '#prepare-panel .cut-card');
  await noShift('On line: Lead-in Off', () => preset('cut-lead-modes', 'false'));
  await noShift('On line: Hold part Tabs', () => preset('cut-hold-modes', 'tabs'));
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^leadIn(:|$)/.test(r) || r === 'leadIn:off'), ['leadIn:off'], `${device}: Tabs: the Lead-in row stays, greyed`);
  assert.ok((await tooltipOf('.cut-row[data-row="leadIn"] .cut-field-label')).startsWith('Not with Tabs'), `${device}: Lead-in's tooltip says why`);
  await noShift('On line: Hold part Off', () => preset('cut-hold-modes', 'off'));

  // POCKET: Clearing, Loop, the note
  await pickType('pocket');
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^(clearing|stepover|loop|finishAllowance|rasterAngle)/.test(r)), ['clearing', 'stepover:off', 'finishAllowance:off', 'loop:off', 'rasterAngle:off'], `${device}: Pocket, Freehand: the pattern rows stay, greyed`);
  const stepTip = await tooltipOf('.cut-row[data-row="stepover"] .cut-field-label');
  assert.ok(stepTip && stepTip.startsWith('Freehand has no passes'), `${device}: the greyed Stepover row says why: ${JSON.stringify(stepTip)}`);
  await shot('pocket-freehand.png', '#prepare-panel .cut-card');
  const pickClearing = async (id) => { await clickEl('.cut-clear-trigger'); await waitFor(`!document.querySelector('.cut-clear-pop').hidden`, 'the Clearing menu'); await clickEl(`.cut-clear-opt[data-clearing="${id}"]`); await waitFor(`document.querySelector('.cut-clear-pop').hidden`, 'the menu closes'); };
  assert.strictEqual(await evalJs(`document.querySelectorAll('.cut-note div').length`), 0, `${device}: Freehand: no note`);
  const noteBox0 = await evalJs(`(() => { const r = document.querySelector('.cut-note').getBoundingClientRect(); return [r.width, r.height]; })()`);
  assert.ok(noteBox0[1] > 30, `${device}: the note area is there with no note: ${noteBox0}`);
  await noShift('Pocket: Clearing Spiral (the note appears)', () => pickClearing('linked'));
  assert.ok(await evalJs(`document.querySelectorAll('.cut-note div').length`) >= 2, `${device}: Spiral: the note lines show`);
  assert.deepStrictEqual((await rowsOf()).filter((r) => /^(stepover|loop|finishAllowance|rasterAngle)/.test(r)), ['stepover', 'finishAllowance', 'loop', 'rasterAngle:off'], `${device}: Spiral: the pattern rows are live, the Raster angle greyed`);
  await shot('pocket-spiral.png', '#prepare-panel .cut-card');
  const loopNoteBefore = await evalJs(`document.querySelector('.cut-note').textContent`);
  await noShift('Pocket: Loop on (the note changes)', () => clickEl('.cut-loop'));
  assert.notStrictEqual(await evalJs(`document.querySelector('.cut-note').textContent`), loopNoteBefore, `${device}: Loop changed the note`);
  await noShift('Pocket: Loop off', () => clickEl('.cut-loop'));
  await noShift('Pocket: Clearing Raster', () => pickClearing('raster'));
  assert.ok((await rowsOf()).includes('rasterAngle'), `${device}: Raster: the angle row is live`);
  await shot('pocket-raster.png', '#prepare-panel .cut-card');
  await noShift('Pocket: Clearing Freehand (the note goes)', () => pickClearing('freehand'));
  assert.strictEqual(await evalJs(`document.querySelectorAll('.cut-note div').length`), 0, `${device}: Freehand: the note is gone`);
  // the Clearing menu: no line under a choice (its reason is its tooltip), and opening it moves no row
  assert.strictEqual(await evalJs(`document.querySelectorAll('.cut-clear-why').length`), 0, `${device}: no .cut-clear-why line`);

  // A LONG NOTE and no note: the area keeps its box, scrolls inside
  await noShift('a long note (10 lines)', () => evalJs(`(() => { const n = document.querySelector('.cut-note'); n.innerHTML = ''; for (let i = 1; i <= 10; i++) { const d = document.createElement('div'); d.textContent = 'note line ' + i; n.appendChild(d); } })()`));
  const scrolls = await evalJs(`(() => { const n = document.querySelector('.cut-note'); return [n.scrollHeight > n.clientHeight, getComputedStyle(n).overflowY]; })()`);
  assert.deepStrictEqual(scrolls, [true, 'auto'], `${device}: a long note scrolls inside its area`);
  await shot('long-note.png', '#prepare-panel .cut-card');

  // the Prepare notice is an overlay (absolute): showing it moves nothing
  await noShift('the Prepare notice shows', () => evalJs(`(() => { const n = document.getElementById('prepare-notice'); n.textContent = 'A long notice that says something about the design and wraps over several lines on a narrow screen'; n.hidden = false; })()`));
  assert.strictEqual(await evalJs(`getComputedStyle(document.getElementById('prepare-notice')).position`), 'absolute', `${device}: the Prepare notice is an overlay`);
  await evalJs(`document.getElementById('prepare-notice').hidden = true`);

  // the Export status line: a slot of its own
  await openStage('review');
  await sleep(500);
  const snapExport = () => evalJs(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 100) / 100).join(','); }; return [r('#simexport-panel'), r('#simexport-status'), r('#btn-generate-svg')]; })()`);
  const e0 = await snapExport();
  await evalJs(`document.getElementById('simexport-status').textContent = 'Generated a file with a long name that goes on and on, then a second sentence about where it was saved and a third about what to do next, and more.'`);
  await sleep(150);
  const e1 = await snapExport();
  assert.deepStrictEqual(e1, e0, `${device}: the Export status line: the card and its slot keep their boxes (${e0.join(' | ')})`);
  await evalJs(`document.getElementById('simexport-status').textContent = ''`);
  await openStage('prepare');
}

try {
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await phase();
  console.log(`desktop: ${probes} layout probes (${boxes} boxes each)`);
  // PHONE
  probes = 0;
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true; device = 'phone';
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await phase();
  console.log(`phone: ${probes} layout probes (${boxes} boxes each)`);
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('noshift-813-live.test.js: ok');
} finally {
  await close();
}
