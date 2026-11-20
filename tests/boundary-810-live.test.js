// tests/boundary-810-live.test.js — TASK 810 in the real page (Shaper, real mouse / touch input), desktop 1280 x 800 then a phone 390 x 844 (touch):
//  a Fusion-style payload (a part with levels: an 80 x 50 outline round a 20 x 20 boss; a 40 x 40 "window" round the boss) -> the part as a Nested Roughing
//  (1/4 in, Smoothing 0) -> its card is TABBED (Tool, Geometry, Heights, Passes):
//   * the LAYOUT PROBE (task 805's rule): every tab shown in turn, the card, its type field, its tab bar, its rows panel, its note, the panel, the Operations list,
//     the direction legend and the canvas keep their boxes (0 px: switching tabs moves nothing outside the card, the card keeps its height);
//   * the Geometry tab: Boundary (Silhouette | Bounding box | Stock greyed | Shape), Tool, Boundary offset, Offset;
//   * the 3D Review and the Paths view with the Silhouette (the pocket reaches x = -12.7: the outline grown by 2 bits), then Shape: Pick + a click on the window
//     (the selection stays the part), the Paths view and the 3D Review follow (the pocket reaches x = 7.3: the window grown by 2 bits), the Prepare look too.
// No console error / page exception. Screenshots: .evidence/810/<device>-*.png.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = path.resolve('.evidence/810');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });
const sq = (x0, y0, x1, y1) => ({ closed: true, segments: [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)] });
const PAYLOAD = {
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { name: 'Body1', documentName: 'boundary' }, stock: { thicknessMm: 4 },
  regions: [
    { id: 'reg_0', label: 'Part', cutType: 'outside', depthMm: 4, through: false, outer: sq(0, 0, 80, 50), holes: [], levels: [{ zFromTopMm: 2, loops: [sq(30, 15, 50, 35)] }, { zFromTopMm: 4, loops: [sq(30, 15, 50, 35)] }] },
    { id: 'reg_2', label: 'Window', cutType: 'guide', depthMm: 4, through: false, outer: sq(20, 5, 60, 45), holes: [] },
  ],
  chains: [], warnings: [],
};

const cdp = await launchBrowser({ tag: '810-boundary', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
let device = 'desktop', touch = false;
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
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${device}: ${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
// a world point of the Prepare canvas that is on screen and not covered (the first of `pts`, world mm, y down)
const pressWorld = async (pts, what) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'), M = svg.getScreenCTM();
    for (const [x, y] of ${JSON.stringify(pts)}) { const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const s = pt.matrixTransform(M); const sx = Math.round(s.x), sy = Math.round(s.y);
      const hit = document.elementFromPoint(sx, sy); if (hit && svg.contains(hit) && sx > 50 && sy > 50 && sx < innerWidth - 20 && sy < innerHeight - 20) return { x: sx, y: sy }; }
    return null; })()`);
  assert.ok(p, `${device}: ${what}: a point on the canvas`);
  await press(p.x, p.y);
};
const PART_PTS = [[5, -5], [75, -5], [5, -45], [75, -45], [10, -25], [70, -25], [3, -30], [77, -30], [12, -3], [12, -47]];
const WINDOW_PTS = [[22, -25], [25, -10], [25, -40], [55, -10], [55, -40], [58, -25], [40, -8], [40, -42], [22, -8], [22, -42]];
const openStage = async (id) => {
  if (touch) { await clickEl('.sk-sidebar-chevron'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300); await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`); }
  else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('${id === 'design' ? 'design-view' : 'view-' + id}').hidden`, `the ${id} stage`);
  await sleep(300);
};
const tab = async (id) => { await clickEl(`.cut-tab[data-tab="${id}"]`); await waitFor(`document.querySelector('.cut-tab[data-tab="${id}"]').classList.contains('is-active')`, `the ${id} tab`); await sleep(120); };
const rows = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-rows .cut-row')].filter((r) => getComputedStyle(r).display !== 'none').map((r) => (r.dataset.row || r.dataset.param) + ('off' in r.dataset ? ':off' : ''))`); // TASK 813: a row that does not apply stays in place, greyed (:off)
const OUTSIDE = ['#prepare-panel', '#prepare-panel .cut-card', '#prepare-panel .cut-field', '#prepare-panel .cut-tabs', '#prepare-panel .cut-rows', '#prepare-panel .cut-note', '#prepare-ops', '#prepare-dir-legend', '#prepare-canvas'];
const snap = () => evalJs(`(() => { const out = {}; const r2 = (n) => Math.round(n * 100) / 100;
  for (const sel of ${JSON.stringify(OUTSIDE)}) [...document.querySelectorAll(sel)].forEach((e, i) => { const b = e.getBoundingClientRect(); out[sel + '#' + i] = [r2(b.left), r2(b.top), r2(b.width), r2(b.height)].join(','); });
  return out; })()`);
const moved = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k]} -> ${b[k]}`);
const partKey = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.entries()].find(([, r]) => r.levels)[0])`);
const rec = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => { const r = [...m.V2_PLAN.values()].find((x) => x.levels); const { levels, ...rest } = r; return rest; })`);
// the leftmost x (world mm) the Roughing's pockets reach in the export (the same derivation the 3D Review and the Paths view draw)
const exportMinX = () => evalJs(`Promise.all([import('/tests/helpers/plan-v2.js'), import('/apps/shaper/src/export-payload.js')]).then(([c, e]) => {
  const svg = e.shaperSvgOf(window.__designController.state, c.planEntries()); const xs = [];
  for (const m of svg.matchAll(/<path [^>]*shaper:cutType="pocket"[^>]*\\/>/g)) for (const q of m[0].matchAll(/[ML] (-?[\\d.]+) /g)) xs.push(Number(q[1]));
  return xs.length ? Math.min(...xs) : null; })`);
// the Paths view: the leftmost x (world) of its pocket strokes
const pathsMinX = () => evalJs(`(() => { const els = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc .rv2d-t-pocket')]; if (!els.length) return null; return Math.min(...els.map((e) => e.getBBox().x)); })()`);

async function phase() {
  await openStage('prepare');
  await evalJs(`import('/apps/shaper/src/fusion-import.js').then((m) => m.importFusionSelection(${JSON.stringify(PAYLOAD)}, { controller: window.__designController }))`);
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => { const r = [...m.V2_PLAN.values()].find((x) => x.levels); Object.assign(r, { cutType: 'roughing', toolDia: 6.35, stepDepth: 1, roughLayout: 'nested', smoothing: 0 }); })`);
  await openStage('design'); await openStage('prepare'); // Prepare mounts the imported design
  await waitFor(`document.getElementById('prepare-notice').hidden`, 'the notice gone', 10000);
  await pressWorld(PART_PTS, 'the part');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Roughing'`, `${device}: the Roughing card`);
  const tabsShown = await evalJs(`[...document.querySelectorAll('.cut-tab')].filter((b) => !b.hidden).map((b) => b.textContent)`);
  assert.deepStrictEqual(tabsShown, ['Tool', 'Geometry', 'Heights', 'Passes'], `${device}: the four tabs`);
  // THE LAYOUT PROBE: each tab in turn; nothing outside the card moves, the card keeps its height
  await tab('tool');
  const base = await snap();
  for (const id of ['geometry', 'heights', 'passes', 'tool', 'passes', 'geometry']) {
    await tab(id);
    await evalJs(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
    const now = await snap();
    assert.deepStrictEqual(moved(base, now), [], `${device}: the ${id} tab: nothing outside the card moved (0 px)`);
    await shot(`tab-${id}.png`, '#prepare-panel .cut-card');
  }
  console.log(`${device}: layout probe: ${Object.keys(base).length} boxes unchanged over 6 tab switches; card ${base['#prepare-panel .cut-card#0']}`);
  await tab('geometry');
  assert.deepStrictEqual(await rows(), ['boundary', 'boundaryShape:off', 'boundaryTool', 'boundaryOffset', 'minTerraceWidth:off', 'cutOffset'], `${device}: the Geometry tab (the Boundary shape and the Min terrace width greyed in place)`);
  assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.cut-boundary-kinds .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : '') + (b.getAttribute('aria-disabled') ? ':greyed' : ''))`),
    ['Silhouette*', 'Bounding box', 'Stock:greyed', 'Shape'], `${device}: Boundary: Silhouette, the Stock greyed (no Stock)`);
  // the 3D Review and the Paths view with the Silhouette
  const silX = await exportMinX();
  assert.strictEqual(silX, -12.7, `${device}: the Silhouette: the pocket reaches -12.7 (0 - 2 bits)`);
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, `${device}: the Review built`, 60000);
  const info1 = await evalJs(`document.getElementById('review-info').textContent`);
  await clickEl('#review-top'); await sleep(500);
  await shot('review-silhouette.png', '#review-canvas-host');
  await clickEl('#review-view-paths');
  await waitFor(`!document.getElementById('review-2d').hidden && document.querySelectorAll('#review-2d-canvas .rv2d-doc .rv2d-t-pocket').length > 0`, `${device}: the Paths view`);
  const pathsSil = await pathsMinX();
  await shot('paths-silhouette.png', '#review-2d');
  await clickEl('#review-view-3d');
  // Shape: Pick, then a click on the window
  await openStage('prepare');
  await pressWorld(PART_PTS, 'the part');
  await tab('geometry');
  await clickEl('.cut-boundary-kinds .cut-preset[data-value="shape"]');
  await waitFor(`!!document.querySelector('.cut-row[data-row="boundaryShape"]') && !('off' in document.querySelector('.cut-row[data-row="boundaryShape"]').dataset)`, `${device}: the Boundary shape row`);
  assert.strictEqual(await evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent).join(' | ')`), 'Roughing: nothing to cut: no boundary shape yet: press Pick, then click a closed shape', `${device}: the note says why nothing is cut`);
  await shot('shape-none.png', '#prepare-panel .cut-card');
  await clickEl('.cut-boundary-pick');
  await waitFor(`document.getElementById('prepare-canvas').classList.contains('is-picking')`, `${device}: picking`);
  assert.strictEqual(await evalJs(`document.querySelector('.cut-boundary-pick').textContent`), 'Cancel pick', `${device}: the button reads Cancel pick`);
  await shot('picking.png', '#prepare-panel .cut-card');
  await pressWorld(WINDOW_PTS, 'the window');
  await waitFor(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].some((r) => r.levels && r.boundaryShape))`, `${device}: the window picked`);
  const r = await rec();
  assert.ok(r.boundary === 'shape' && /^loop:/.test(r.boundaryShape) && r.boundaryShape !== await partKey(), `${device}: the window is the boundary shape: ${r.boundaryShape}`);
  assert.deepStrictEqual(await evalJs(`[document.querySelector('.cut-type-cur').textContent, document.getElementById('prepare-canvas').classList.contains('is-picking'), document.querySelector('.cut-boundary-state').textContent]`), ['Roughing', false, 'picked'], `${device}: still the part's card, picking over, picked`);
  await shot('shape-picked.png', '#prepare-panel .cut-card');
  await shot('prepare-shape.png', '#prepare-canvas');
  const winX = await exportMinX();
  assert.strictEqual(winX, 7.3, `${device}: the window: the pocket reaches 7.3 (20 - 2 bits)`);
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent) && document.getElementById('review-info').textContent !== ${JSON.stringify(info1)}`, `${device}: the Review rebuilt for the window`, 60000);
  await clickEl('#review-top'); await sleep(500);
  await shot('review-shape.png', '#review-canvas-host');
  await clickEl('#review-view-paths');
  await waitFor(`!document.getElementById('review-2d').hidden && document.querySelectorAll('#review-2d-canvas .rv2d-doc .rv2d-t-pocket').length > 0`, `${device}: the Paths view`);
  await sleep(300);
  const pathsWin = await pathsMinX();
  await shot('paths-shape.png', '#review-2d');
  console.log(`${device}: pocket min x: export ${silX} -> ${winX}; Paths view ${pathsSil} -> ${pathsWin}; Review info ${JSON.stringify(info1.slice(0, 120))} -> ${JSON.stringify((await evalJs(`document.getElementById('review-info').textContent`)).slice(0, 120))}`);
  assert.ok(Math.abs(pathsSil - -12.7) < 0.01 && Math.abs(pathsWin - 7.3) < 0.01, `${device}: the Paths view follows the boundary (${pathsSil} -> ${pathsWin})`);
  await clickEl('#review-view-3d');
}

try {
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await phase();
  // PHONE
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true; device = 'phone';
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await phase();
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('boundary-810-live.test.js: ok');
} finally {
  await close();
}
