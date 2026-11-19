// tests/roughing-contour-792-live.test.js — TASK 792: ROUGHING + CONTOUR on an STL part in the real Shaper page (web mode), real clicks / touches.
// The part (built here, tests/helpers/stl-mesh.js): a RELIEF, a dome (R 20 mm, 20 mm high) on a sloped skirt (R 20 -> 30 mm over the last 4 mm): its
// levels change at every step (no flat shoulder, so the STL gives ONE region: the outline). `node tests/roughing-contour-792-live.test.js <file.stl>` runs the same steps on another STL (the owner's rose, local evidence only: its
// numbers are printed, the relief's own counts are not asserted).
//  DESKTOP 1280 x 800: the drawer's Open STL -> the outline -> the cut menu's Roughing -> its card (Depth, Finish allowance 0, Contour Off, Step depth,
//   bit) -> the bit 1/4 in -> Contour On (allowance 0.5, "Edit contour") -> the Operations list (two operations under two bit headings, the Contour
//   after the Roughing) -> Edit contour: the Contour card (step 0.25, 1/8 in, ball nose) -> the 3D Review (levels, zoomed top + angled screenshots)
//   -> Generate Shaper SVG (the roughing pockets at their levels with the 1/4 in bit, the contour passes with the 1/8 in bit).
//  G (both): Prepare draws the part's HEIGHT MAP (#core/height-map.js: one PNG image) under every cut layer, no pointer events; a drawn design has none.
//  PHONE 390 x 844 (touch): the same up to the Operations list and the Review.
// No console error / page exception. Screenshots (.evidence/792/<name>-*.png).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import * as M from './helpers/stl-mesh.js';

const EVIDENCE_DIR = path.resolve('.evidence/792');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-792-'));
// the relief: dome rings (apex down to its base at z 4) then the skirt down to R 30 at z 0, 64 sides each
const relief = () => {
  const outer = [];
  for (let i = 1; i <= 24; i++) { const a = (Math.PI / 2) * (i / 24); outer.push({ z: 4 + 20 * Math.cos(a), pts: M.circle(30, 30, 20 * Math.sin(a), 64) }); }
  outer.push({ z: 0, pts: M.circle(30, 30, 30, 64) });
  return M.lofted({ outer, apex: [30, 30, 24] });
};
const OWN = process.argv[2] ? path.resolve(process.argv[2]) : null;
const STL = OWN || path.join(tmp, 'relief.stl');
if (!OWN) fs.writeFileSync(STL, M.binaryStl(relief()));
const NAME = OWN ? path.basename(OWN, '.stl') : 'relief';

const cdp = await launchBrowser({ tag: '792-rough', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-792-dl-'));
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const shot = async (name, sels = null) => {
  let clip = null;
  if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
    const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 8), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 8);
    return { x, y, width: Math.max(...rs.map((r) => r.right)) + 8 - x, height: Math.max(...rs.map((r) => r.bottom)) + 8 - y, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${NAME}-${name}`), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, `${NAME}-${name}`));
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
const plan = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.entries()].map(([k, r]) => (k.startsWith('contour:') ? 'contour:' : '') + r.cutType))`);
const outlineKey = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.entries()].find(([, r]) => r.levels)[0])`);
const openStage = async (id) => { // desktop: the header's stage tab; a phone has no header: the drawer's stage button
  if (touch) { await clickEl('.sk-sidebar-handle'); await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300); await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`); }
  else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`);
};
const openStl = async (what) => {
  await evalJs('delete window.showOpenFilePicker');
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await clickEl(touch ? '.sk-sidebar-handle' : '.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, what + ': the drawer opens'); await sleep(300);
  const chooser = once('Page.fileChooserOpened');
  await clickEl('[data-action="open-stl"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, what + ': the file chooser opened');
  const t0 = Date.now();
  await send('DOM.setFileInputFiles', { files: [STL], backendNodeId: ch.backendNodeId });
  await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.includes(' regions')`, what + ': the import notice', 120000);
  const ms = Date.now() - t0;
  console.log(`${what}: open STL -> notice ${ms} ms: ${await evalJs(`document.getElementById('prepare-notice').textContent`)}`);
  await sleep(400);
  return ms;
};
// the outline: a press on its edge, at the first of its vertices (top-most first) that is on the canvas, not under a panel
const pressOutline = async () => {
  const p = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => { const k = [...m.CUT_PLAN.entries()].find(([, r]) => r.levels)[0];
    const { loops } = m.loopsWithPolygons(window.__designController.state); const l = loops.find((x) => 'loop:' + x.id === k); const poly = l.polygon;
    const svg = document.getElementById('prepare-canvas'), M = svg.getScreenCTM();
    for (const q of [...poly].sort((a, b) => a.y - b.y)) { const pt = svg.createSVGPoint(); pt.x = q.x; pt.y = q.y; const s = pt.matrixTransform(M); const x = Math.round(s.x), y = Math.round(s.y);
      const hit = document.elementFromPoint(x, y); if (hit && svg.contains(hit) && x > 60 && y > 60 && x < innerWidth - 60 && y < innerHeight - 60) return { x, y }; } // away from the edges (a phone's drawer handle)
    return null; })`);
  assert.ok(p, 'a point of the outline on the canvas');
  console.log('outline press at ' + JSON.stringify(p));
  await press(p.x, p.y);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'the outline\'s card');
};
const rows = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-rows .cut-row')].filter((r) => r.style.display !== 'none').map((r) => r.dataset.row || r.dataset.param)`);
const ops = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-tool, #prepare-ops .ops-row')].map((e) => e.classList.contains('ops-tool') ? '# ' + e.textContent : e.querySelector('.ops-name').textContent + ' | ' + e.querySelector('.ops-sub').textContent)`);
const review = async (what) => {
  const t0 = Date.now();
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, what + ': the Review built', 180000);
  const ms = Date.now() - t0;
  const info = await evalJs(`document.getElementById('review-info').textContent`);
  console.log(`${what}: Review ${ms} ms: ${info.slice(0, 300)}`);
  await sleep(600);
  return { ms, info };
};
const zoomReview = async (top, steps = 3) => {
  const c = await evalJs(`(() => { const r = document.getElementById('review-canvas-host').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await clickEl(top ? '#review-top' : '#review-reset');
  if (!touch) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 });
    for (let i = 0; i < steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -300 }); await sleep(150); }
  }
  await sleep(500);
};

const timings = {};
async function phase(what) {
  timings[what] = {};
  timings[what].open = await openStl(what);
  assert.ok((await plan()).includes('exterior'), what + ': the STL\'s outline is an Outside cut');
  // G: the HEIGHT MAP under the cut lines (always shown for a part with levels): one image, the first layer of the canvas, never taking a press
  const hm = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'), g = svg.querySelector('#prepare-heightmap-group'), im = g && g.querySelector('image');
    const kids = [...svg.children].map((c) => c.id || c.tagName); return { images: g ? g.querySelectorAll('image').length : 0, under: kids.indexOf('prepare-heightmap-group') < kids.indexOf('prepare-world-group') && kids.indexOf('prepare-heightmap-group') < kids.indexOf('prepare-cut-group'),
      png: !!im && im.getAttribute('href').startsWith('data:image/png;base64,'), pe: im && im.getAttribute('pointer-events') }; })()`);
  console.log(`${what}: height map ${JSON.stringify(hm)}`);
  assert.deepStrictEqual(hm, { images: 1, under: true, png: true, pe: 'none' }, what + ': the height map: one PNG under the edges and the cut layers, no pointer events');
  await waitFor(`document.getElementById('prepare-notice').hidden`, what + ': the import notice gone', 10000); // (it covers the canvas on a phone)
  await shot(`${what}-heightmap.png`, '#prepare-canvas');
  await pressOutline();
  await clickEl('#prepare-panel .cut-type-trigger');
  await waitFor(`!document.querySelector('.cut-type-menu').hidden`, what + ': the menu');
  const menu = await evalJs(`[...document.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id)`);
  assert.deepStrictEqual(menu, ['online', 'guide', 'interior', 'pocket', 'roughing', 'exterior', 'stock'], what + ': Roughing in the menu, after Pocket (no Contour there)');
  let t0 = Date.now();
  await clickEl('.cut-type-opt[data-id="roughing"]');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Roughing'`, what + ': Roughing set', 60000);
  timings[what].roughing = Date.now() - t0;
  assert.deepStrictEqual(await rows(), ['cutDepth', 'finishAllowance', 'contour', 'adaptiveSteps', 'stepDepth', 'cutOffset', 'toolDia', 'cutterShape'], what + ': the Roughing card');
  assert.strictEqual(await evalJs(`document.querySelector('.cut-finish-allowance').value`), '0', what + ': allowance 0 (no Contour yet)');
  assert.strictEqual(await evalJs(`document.querySelector('.cut-contour-modes .is-active').textContent`), 'Off', what + ': Contour Off');
  await clickEl('.cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]');
  await waitFor(`document.querySelector('.cut-bit').value === '6.35'`, what + ': the 1/4 in bit');
  t0 = Date.now();
  await clickEl('.cut-contour-modes .cut-preset[data-value="true"]');
  await waitFor(`document.querySelector('.cut-finish-allowance').value === '0.5' && !document.querySelector('.cut-contour-edit').hidden`, what + ': Contour On', 60000);
  timings[what].contour = Date.now() - t0;
  const note = await evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  console.log(`${what}: Roughing note ${JSON.stringify(note)}`);
  assert.ok(note.some((n) => /^Roughing: \d+ levels?, /.test(n)) && note.includes('Roughing: 0.5 mm left on every wall for the Contour'), what + ': the note: levels and allowance');
  await shot(`${what}-roughing-card.png`, '#prepare-panel .cut-card');
  await shot(`${what}-heightmap-selected.png`, '#prepare-canvas'); // the outline selected over the height map: its band, edges and chip on top
  const list = await ops();
  console.log(`${what}: Operations ${JSON.stringify(list)}`);
  const iR = list.findIndex((x) => x.startsWith('Roughing')), iC = list.findIndex((x) => x.startsWith('Contour'));
  assert.ok(iR >= 0 && iC > iR, what + ': the Contour after the Roughing');
  assert.ok(list[iR - 1] === '# Change to ¼″ end mill' && list[iC - 1] === '# Change to ⅛″ ball nose', what + ': each under its own bit heading');
  assert.ok(/levels?, allowance 0\.5 mm$/.test(list[iR]) && /levels?$/.test(list[iC]), what + ': the rows say their levels');
  await shot(`${what}-operations.png`, '#prepare-ops');
  await clickEl('.cut-contour-edit');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Contour'`, what + ': the Contour card');
  assert.deepStrictEqual([await rows(), await evalJs(`[document.querySelector('.cut-step-depth').value, document.querySelector('.cut-bit').value, document.querySelector('.cut-shape-cur').textContent]`)],
    [['stepDepth', 'toolDia', 'cutterShape'], ['0.25', '3.175', 'ball nose']], what + ': the Contour card: step 0.25, 1/8 in, ball nose');
  await shot(`${what}-contour-card.png`, '#prepare-panel .cut-card');
  await shot(`${what}-prepare.png`);
  const r = await review(what);
  timings[what].review = r.ms;
  assert.ok(/\d+ levels?/.test(r.info), what + ': the Review has levels');
  await zoomReview(true);
  await shot(`${what}-review-top.png`, '#review-canvas-host');
  await zoomReview(false);
  await shot(`${what}-review-angled.png`, '#review-canvas-host');
}

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  // a drawn design has no height map
  await openStage('prepare');
  assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-heightmap-group image').length`), 0, 'a drawn (empty) design: no height map');
  await phase('desktop');
  // Generate Shaper SVG: the roughing pockets (1/4 in) and the contour passes (1/8 in)
  const t0 = Date.now();
  await clickEl('#btn-generate-svg');
  let svgFile = null;
  for (let i = 0; i < 600 && !svgFile; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) svgFile = path.join(dlDir, f); else await sleep(100); }
  assert.ok(svgFile, 'the export downloaded');
  timings.desktop.generate = Date.now() - t0;
  const svg = fs.readFileSync(svgFile, 'utf8');
  fs.writeFileSync(path.join(EVIDENCE_DIR, `${NAME}-export.svg`), svg);
  let g = '';
  const els = svg.split('\n').flatMap((line) => { if (/^\s*<g[ >]/.test(line)) { g = line; return []; } if (/^\s*<\/g>/.test(line)) { g = ''; return []; } const m = /<(path|circle) ([^>]*?)\/>/.exec(line); return m ? [m[2] + ' ' + g] : []; })
    .map((a) => `${(/shaper:cutType="([^"]+)"/.exec(a) || [])[1]}@${(/shaper:toolDia="([^"]+)"/.exec(a) || [])[1]}`);
  const count = (k) => els.filter((e) => e === k).length;
  console.log(`desktop: export ${svg.length} bytes, ${els.length} elements: pockets 1/4 ${count('pocket@6.350 mm')}, contour outside ${count('outside@3.175 mm')} inside ${count('inside@3.175 mm')}`);
  timings.desktop.bytes = svg.length; timings.desktop.elements = els.length;
  assert.ok(count('pocket@6.350 mm') >= 2 && count('outside@3.175 mm') >= 2, 'the export: the roughing pockets with the 1/4 in bit, the contour passes with the 1/8 in bit');
  if (!OWN) {
    assert.strictEqual(count('pocket@6.350 mm'), 24, 'the relief at 1 mm: 24 roughing levels, one pocket each (1..20 round the dome, 21..24 round the skirt)');
    assert.strictEqual(count('inside@3.175 mm'), 0, 'the relief has no hole in its material: no Inside contour');
  }

  // PHONE
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await phase('phone');

  console.log('TIMINGS ' + JSON.stringify(timings));
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('roughing-contour-792-live.test.js: ok');
} finally {
  await close();
}
