// tests/export-preview-720-live.test.js — TASK 720: a stepped INSIDE's terraces in the 2D preview are greys by depth (lighter = shallower, 90%..60%), the through step (deepest) keeps the file's
// white, the thin black stroke stays; the download is unchanged. The 06 countersink at Step depth 1 mm and at adaptive Fine (16 rings), zoomed. Screenshots: .evidence/720/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const BEFORE = process.env.TASK720_BEFORE === '1';
const EVIDENCE_DIR = path.resolve(BEFORE ? '.evidence/720/before' : '.evidence/720');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '720-export-2d', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-720-dl-'));

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
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await tap(p.x, p.y);
};
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await tap(p.x, p.y);
};
const openStage = async (id) => {
  await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`);
};
const download = async () => {
  for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
  await clickEl('#btn-generate-svg');
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

const lightness = (f) => parseFloat(/hsl\(0, 0%, ([\d.]+)%\)/.exec(f)[1]);
const looks = () => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).map((i) => ({ type: i.cutType, depth: parseFloat(i.depth), fill: i.el.getAttribute('fill'), stroke: i.el.getAttribute('stroke') })))`);
const dl = async () => { await evalJs(`document.getElementById('btn-generate-svg').scrollIntoView({ block: 'nearest' })`); await sleep(100); return download(); };
const setPlan = async (cutType) => {
  await clickEl('#prepare-panel .cut-type-trigger'); await clickEl(`.cut-type-opt[data-id="${cutType}"]`);
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.cutType === '${cutType}'))`, cutType + ' set');
  if (cutType === 'roughing') { await clickEl('.cut-tab[data-tab="passes"]'); await sleep(150); } // TASK 810: the Roughing card is tabbed: its stepping rows are in Passes
};
const checkDownload = (svg, what) => assert.ok(!/hsl\(/.test(svg) && !/data-/.test(svg), `${what}: the downloaded file has none of the preview's styling`);
const shootRings = async (name, expectRings) => { // expectRings: the exact count of terraces, or 0 = more than 2
  await openStage('review');
  await waitFor(`document.querySelectorAll('#review-2d-canvas [data-step]').length ${expectRings ? '=== ' + expectRings : '> 2'}`, name + ': the stepped 2D view');
  await clickEl('#review-fit');
  const its = (await looks()).filter((i) => i.type === 'inside');
  console.log(name + ': ' + JSON.stringify(its.map((i) => `${i.depth} ${i.fill}/${i.stroke}`)));
  if (!BEFORE) {
    const sorted = [...its].sort((a, b) => a.depth - b.depth);
    const last = sorted.pop();
    assert.strictEqual(last.fill, '#FFFFFF', 'the through step keeps the white fill');
    const L = sorted.map((i) => lightness(i.fill));
    assert.ok(L.every((v, i) => i === 0 || v < L[i - 1]), 'deeper = darker: ' + L);
    assert.ok(L.length === 1 ? Math.abs(L[0] - 75) < 0.1 : Math.abs(L[0] - 90) < 0.1 && Math.abs(L[L.length - 1] - 60) < 0.1, 'the scale 90% .. 60% (one step = 75%): ' + L);
    assert.ok(its.every((i) => i.stroke === '#000000'), 'the file\'s thin black stroke stays');
    const ui = await evalJs(`({ legend: [...document.querySelectorAll('#review-cuts-list .rv2d-legend')].map((l) => l.textContent), chips: document.querySelectorAll('#review-cuts-list .rv2d-chip').length })`);
    console.log('legend / chips: ' + JSON.stringify(ui));
    assert.ok(ui.legend.includes('inside steps: lighter = shallower, white = through') && ui.chips === its.length, 'the legend line and a chip per step row');
  }
  checkDownload(await dl(), name);
  const c = await evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => { const b = m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).find((i) => i.step).el.getBBox(); return { x: b.x + b.width / 2, y: b.y }; })`);
  const p = await screenOf(c.x, c.y);
  await wheelAt(p.x, p.y, 4);
  await shot(name, '#review-stage');
};
try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStage('review');
  await clickEl('#review-view-2d');
  await openStage('prepare');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('sa7-slope/06-countersink'))})`);
  await waitFor(`/Body1: 2 regions|Replaced with Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, '06 imported');
  await clickWorld(60, -40);
  await setPlan('roughing');
  if (await evalJs(`document.querySelector('.cut-adaptive').checked`)) await clickEl('.cut-adaptive');
  await evalJs(`(() => { const i = document.querySelector('.cut-step-depth'); i.value = '1'; i.dispatchEvent(new Event('change')); })()`);
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.cutType === 'roughing' && r.stepDepth === 1 && !r.adaptiveSteps))`, 'Step depth 1 mm, Adaptive off');
  await shootRings('desktop-2d-06-inside-step1mm.png', 2);
  await openStage('prepare');
  await clickWorld(60, -40);
  await clickEl('.cut-adaptive');
  await waitFor(`document.querySelector('.cut-adaptive').checked`, 'Adaptive on');
  await clickEl('.cut-row[data-row="stepDeviation"] .cut-preset[data-value="0.1"]');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.stepDeviation === 0.1))`, 'Fine');
  await shootRings('desktop-2d-06-inside-fine.png', 0);
  console.log('export-preview-720-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
