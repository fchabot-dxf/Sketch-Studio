// tests/export-preview-719-live.test.js — TASK 719: the Export step's 2D preview shades pockets by depth and outlines each (display only), in the real page
// (Shaper ?host=fusion, payloads sent as the add-in sends them, real mouse input), desktop 1280 x 800:
//  * the real Fusion solid (711): its 4 pockets are shaded deeper = darker, each outlined; outside / inside keep the file's fill; the list has the legend and
//    the chips; the DOWNLOADED file has no hsl() fill, no pocket outline (preview only); the picked element stays pink;
//  * the SA-7 R3 floor fillet as a Stepped pocket, Coarse then Fine: deeper steps darker; a tap still says "step 2 of 4";
//  * SA-7 x2 outline as Stepped outside (step 1 mm) and the 06 countersink as Stepped inside, zoomed in: outside / inside keep the file's colours.
// Screenshots: .evidence/719/ (TASK719_BEFORE=1 = capture the "before" set into .evidence/719/before on code without the 719 styling: skips the styling asserts).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const BEFORE = process.env.TASK719_BEFORE === '1';
const EVIDENCE_DIR = path.resolve(BEFORE ? '.evidence/719/before' : '.evidence/719');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const fixture = (n) => fs.readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '719-export-2d', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-719-dl-'));

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

const pocketLooks = () => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).map((i) => ({ type: i.cutType, depth: parseFloat(i.depth), fill: i.el.getAttribute('fill'), stroke: i.el.getAttribute('stroke') })))`);
const lightness = (f) => parseFloat(/hsl\(0, 0%, ([\d.]+)%\)/.exec(f)[1]);
const zoomOnto = async (wx, wy, n) => { const p = await screenOf(wx, wy); await wheelAt(p.x, p.y, n); };
const setPlan = async (cutType) => {
  await clickEl('#prepare-panel .cut-type-trigger'); await clickEl(`.cut-type-opt[data-id="${cutType}"]`);
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.cutType === '${cutType}'))`, cutType + ' set');
};
const checkDownload = (svg, what) => assert.ok(!/hsl\(/.test(svg) && !/stroke="#222"/.test(svg) && !/data-/.test(svg), `${what}: the downloaded file has none of the preview's styling`);
const dl = async () => { await evalJs(`document.getElementById('btn-generate-svg').scrollIntoView({ block: 'nearest' })`); await sleep(100); return download(); }; // a long list can push the button below the fold
const pinkStroke = () => evalJs(`getComputedStyle(document.querySelector('#review-2d-canvas .rv2d-picked')).stroke`);

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStage('review');
  await clickEl('#review-view-2d');
  await waitFor(`!document.getElementById('review-2d').hidden`, 'the 2D view');

  // 1. the real solid: 4 pockets at 4 / 6 / 8 / 10 mm
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('real-solid-plate-711'))})`);
  await waitFor(`/8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the real solid imported');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc *').length > 0`, 'the 2D view rebuilt');
  const solid = await pocketLooks();
  console.log('real solid, looks: ' + JSON.stringify(solid));
  const solidFile = await dl();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'real-solid-download.svg'), solidFile);
  checkDownload(solidFile, 'real solid');
  if (!BEFORE) {
    const pk = solid.filter((i) => i.type === 'pocket').sort((a, b) => a.depth - b.depth);
    assert.strictEqual(pk.length, 4);
    const L = pk.map((i) => lightness(i.fill));
    assert.ok(L.every((v, i) => i === 0 || v < L[i - 1]), 'deeper = darker: ' + L);
    assert.ok(Math.abs(L[0] - 70) < 0.1 && Math.abs(L[3] - 30) < 0.1, 'the scale runs 70% to 30%: ' + L);
    assert.ok(pk.every((i) => i.stroke === '#222'), 'every pocket has the outline');
    assert.ok(solid.filter((i) => i.type !== 'pocket').every((i) => !/hsl/.test(i.fill || '')), 'outside / inside keep the file\'s fill');
    const ui = await evalJs(`({ legend: document.querySelector('#review-cuts-list .rv2d-legend')?.textContent, chips: [...document.querySelectorAll('#review-cuts-list .rv2d-chip')].map((c) => c.style.background) })`);
    console.log('legend / chips: ' + JSON.stringify(ui));
    assert.ok(/lighter = shallower/.test(ui.legend) && ui.chips.length === 4, 'the legend and 4 chips');
  }
  const row10 = await evalJs(`[...document.querySelectorAll('#review-cuts-list .rv2d-row')].findIndex((b) => b.textContent.includes('10.000 mm'))`);
  await clickEl(`#review-cuts-list .rv2d-row:nth-of-type(${row10 + 1})`);
  assert.strictEqual(await label(), 'pocket · 10.000 mm');
  if (!BEFORE) assert.strictEqual(await pinkStroke(), 'rgb(255, 45, 149)', 'the picked element keeps its pink outline over the shading');
  await shot('desktop-2d-real-solid.png', '#view-review');

  // 2. the R3 floor fillet as a Stepped pocket: Coarse, then Fine
  await openStage('prepare');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('sa7-slope/03-pocket-floor-fillet'))})`);
  await waitFor(`/Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, 'R3 imported');
  await clickWorld(60, -40);
  await setPlan('stepped-pocket');
  await clickEl('.cut-adaptive');
  await waitFor(`document.querySelector('.cut-adaptive').checked`, 'Adaptive on');
  for (const [dev, n, name] of [['0.5', 4, 'coarse'], ['0.1', null, 'fine']]) {
    if (name === 'fine') await clickWorld(60, -40); // back on Prepare: select the pocket again
    await clickEl(`.cut-row[data-row="stepDeviation"] .cut-preset[data-value="${dev}"]`);
    await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].some((r) => r.stepDeviation === ${dev}))`, name);
    await openStage('review');
    await waitFor(`document.querySelectorAll('#review-2d-canvas [data-step]').length > 1`, 'the stepped 2D view');
    await clickEl('#review-fit');
    const looks = (await pocketLooks()).filter((i) => i.type === 'pocket');
    console.log(`R3 ${name}: ${looks.length} steps`);
    if (n) assert.strictEqual(looks.length, n);
    if (!BEFORE) {
      const L = looks.map((i) => lightness(i.fill));
      assert.ok(L.every((v, i) => i === 0 || v < L[i - 1]), `R3 ${name}: deeper steps darker: ${L}`);
      assert.ok(looks.every((i) => i.stroke === '#222'), `R3 ${name}: each step outlined`);
    }
    checkDownload(await dl(), 'R3 ' + name);
    const sp = await step2Point();
    await zoomOnto(sp.x, sp.y, name === 'coarse' ? 6 : 4);
    const q = await screenOf(sp.x, sp.y);
    if (name === 'coarse') {
      await tap(q.x, q.y);
      assert.strictEqual(await label(), 'pocket · 7.333 mm · step 2 of 4', 'the tap still says step 2 of 4');
      if (!BEFORE) assert.strictEqual(await pinkStroke(), 'rgb(255, 45, 149)', 'the picked step stays pink');
    }
    await shot(`desktop-2d-r3-fillet-${name}.png`, '#review-stage');
    await openStage('prepare');
  }

  // 3. STEPPED OUTSIDE (x2, 1 mm step) and 4. STEPPED INSIDE (06 countersink): zoomed on the terraces
  const zoomShot = async (name, wheel, at) => {
    await openStage('review');
    await waitFor(`document.querySelectorAll('#review-2d-canvas [data-step]').length > 1`, name + ': the stepped 2D view');
    await clickEl('#review-fit');
    const c = await evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => { const its = m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc')).filter((i) => i.step);
      const b = its[0].el.getBBox(); return { n: its.length, x: b.x, y: b.y, w: b.width, h: b.height, look: its.map((i) => i.cutType + ' ' + i.el.getAttribute('fill') + '/' + (i.el.getAttribute('stroke') || '-')) }; })`);
    console.log(`${name}: ${JSON.stringify(c)}`);
    await zoomOnto(at ? at.x : c.x + c.w / 2, at ? at.y : c.y, wheel);
    await shot(name, '#review-stage');
    return c;
  };
  await openStage('prepare');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('sa7-slope/x2-outline-chamfer-top-bottom'))})`);
  await waitFor(`/Replaced with Body1: 1 regions/.test(document.getElementById('prepare-notice').textContent)`, 'x2 imported');
  await clickWorld(60, -40);
  await setPlan('stepped-outside');
  const out = await zoomShot('desktop-2d-x2-stepped-outside-corner.png', 5, { x: 0, y: -80 });
  checkDownload(await dl(), 'x2 stepped outside');
  assert.ok(out.look.every((f) => f === 'outside #000000/-'), 'stepped outside keeps the file\'s colours: ' + out.look);

  await openStage('prepare');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(fixture('sa7-slope/06-countersink'))})`);
  await waitFor(`/Replaced with Body1: 2 regions/.test(document.getElementById('prepare-notice').textContent)`, '06 imported');
  await clickWorld(60, -40);
  await setPlan('stepped-inside');
  const inn = await zoomShot('desktop-2d-06-stepped-inside-zoomed.png', 4, null);
  checkDownload(await dl(), '06 stepped inside');
  assert.ok(inn.look.every((f) => f === 'inside #FFFFFF/#000000'), 'stepped inside keeps the file\'s colours: ' + inn.look);
  console.log('export-preview-719-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
