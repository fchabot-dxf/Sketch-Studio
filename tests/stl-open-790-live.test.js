// tests/stl-open-790-live.test.js — TASK 790: OPEN STL in the real Shaper page (web mode), STLs built in the test (tests/helpers/stl-mesh.js), opened
// through the drawer's "Open STL…" and the real file chooser (<input type=file>: Page.setInterceptFileChooserDialog + DOM.setFileInputFiles), real
// mouse clicks / touches:
//  DESKTOP 1280 x 800
//   TASK 807: an STL opens as a RELIEF: ONE Roughing (Terraces) with its levels, ready to cut.
//   1. the block (60 x 40 x 8 pocket, d12 through hole): the notice "Added block.stl: a relief, N levels", ONE Roughing to 19 mm, Prepare shows the
//      STL card (file, Up +Z, Units mm, size 120 x 80 x 19 mm) above the cut card; Up -Z re-slices (notice "Replaced with ...", the card -Z); the
//      footer's Undo puts +Z back.
//   2. the 10-degree drafted pocket, as it opens: the 3D Review has 9 levels (8 terraces in the pocket + the band round the part at 19 mm);
//      Generate Shaper SVG writes 9 pockets: 19, then 1..8 mm.
//   3. the hemisphere dome, as it opens: the 3D Review has a level every 1 mm (the 0.03 mm band at 29 mm on the dome's foot only where wider than
//      the drawing tolerance): zoomed screenshots, top and angled.
//   4. save + reopen: a NAMED design (only a named design autosaves; it lives in the fake in-memory Drive, tests/helpers/fake-drive-session.js) opened
//      from an STL, the page loaded again: the card is back.
//  PHONE 390 x 844 (touch): the drawer's Open STL, the notice, the card (folded on a phone: a tap on its header opens it), Up +Y re-slices.
//  THE OTHER APPS: SketchStudio, Pen Plotter and Trace offer no STL entry in their drawer.
// No console error / page exception. Screenshots (.evidence/790/): 1-desktop-card.png, 2-review-drafted-stepped.png, 3-review-dome-top.png,
// 3-review-dome-angled.png, 4-reopened-card.png, 5-phone-card.png; the export: 2-export-drafted-stepped.svg.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js'; // a named design lives in the (fake, in-memory) Drive, as for a signed-in user
import * as M from './helpers/stl-mesh.js';

const EVIDENCE_DIR = path.resolve('.evidence/790');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-790-'));
const file = (name, data) => { const p = path.join(tmp, name); fs.writeFileSync(p, data); return p; };
const BLOCK = file('block.stl', M.binaryStl(M.blockPocketHole()));
const DRAFTED = file('drafted.stl', M.asciiStl(M.draftedPocket(10), 'drafted'));
const DOME = file('dome.stl', M.binaryStl(M.dome(30, 48, 64)));

const cdp = await launchBrowser({ tag: '790-stl', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-790-dl-'));
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
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
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
// a real press on the element's centre, after checking nothing covers it there
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await press(p.x, p.y);
};
const notice = () => evalJs(`document.getElementById('prepare-notice').textContent`);
const card = () => evalJs(`(() => { const c = document.querySelector('#prepare-panel .stl-card'); if (!c || c.hidden) return null; const q = (s) => c.querySelector(s);
  const b = (s) => (q(s) && !q('.stl-body').hidden ? q(s).textContent : null); // a folded card shows no rows
  return { name: q('.stl-name').textContent, up: b('.stl-body .stl-ups .is-active'), unit: b('.stl-body .stl-units .is-active'), size: b('.stl-body .stl-size'), open: c.dataset.open }; })()`);
const plan = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [...m.V2_PLAN.values()].map((r) => r.cutType + '@' + r.cutDepth))`);
const openStage = async (id) => { await clickEl(`.sk-header-tab[data-tab="${id}"]`); await waitFor(`!document.getElementById('view-${id}').hidden`, `the ${id} stage`); };
// the drawer's Open STL…, the chooser answered with `stl`
const openStl = async (stl, what) => {
  await evalJs('delete window.showOpenFilePicker'); // the <input type=file> path (as on a phone): the chooser can be intercepted
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await clickEl(touch ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, what + ': the drawer opens'); await sleep(300);
  assert.strictEqual(await evalJs(`document.querySelector('[data-action="open-stl"]').textContent.trim()`), 'Open STL…', what + ': the entry');
  const chooser = once('Page.fileChooserOpened');
  await clickEl('[data-action="open-stl"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, what + ': the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [stl], backendNodeId: ch.backendNodeId });
  const said = `${path.basename(stl)}: `;
  await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.includes(${JSON.stringify(said)}) && document.getElementById('prepare-notice').textContent.includes(': a relief, ')`, what + ': the import notice');
  await sleep(400);
};
const review = async (levels) => {
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent) && /${levels} level/.test(document.getElementById('review-info').textContent)`, `the Review with ${levels} levels`);
  await sleep(600);
};
const zoomReview = async (top) => {
  const c = await evalJs(`(() => { const r = document.getElementById('review-canvas-host').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await clickEl(top ? '#review-top' : '#review-reset');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 });
  for (let i = 0; i < 4; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -300 }); await sleep(150); }
  await sleep(400);
};

try {
  await installFakeDriveSession(cdp);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // 1. the block
  await openStl(BLOCK, '1');
  assert.ok(/^Added block\.stl: a relief, \d+ levels$/.test(await notice()), '1: the notice: ' + await notice());
  assert.deepStrictEqual(await plan(), ['roughing@19'], '1: ONE Roughing to the full height');
  assert.deepStrictEqual(await card(), { name: 'block.stl', up: '+Z', unit: 'mm', size: '120 × 80 × 19 mm', open: 'true' }, '1: the STL card');
  assert.strictEqual(await evalJs(`(() => { const s = document.querySelector('#review-stock-thickness'); return s.value; })()`), '19', '1: the stock thickness = the height');
  await clickWorld(60, -40); // the relief: the cut card shows under the STL card
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, '1: the cut card');
  const stack = await evalJs(`(() => { const a = document.querySelector('#prepare-panel .stl-card').getBoundingClientRect(), b = document.querySelector('#prepare-panel .cut-card').getBoundingClientRect(); return { stlBottom: Math.round(a.bottom), cutTop: Math.round(b.top), sameColumn: Math.abs(a.left - b.left) < 1 }; })()`);
  assert.ok(stack.sameColumn && stack.cutTop >= stack.stlBottom, '1: the cut card sits under the STL card: ' + JSON.stringify(stack));
  await shot('1-desktop-card.png', ['#prepare-panel .stl-card', '#prepare-panel .cut-card']);
  await clickEl('.stl-ups .cut-preset[data-value="-Z"]');
  await waitFor(`/^Replaced with block\\.stl: a relief/.test(document.getElementById('prepare-notice').textContent)`, '1: -Z re-sliced');
  assert.deepStrictEqual([await plan(), (await card()).up], [['roughing@19'], '−Z'], '1: upside down: the relief, -Z');
  await clickEl('#btn-undo');
  await waitFor(`document.querySelector('.stl-ups .is-active').textContent === '+Z'`, '1: undo');
  assert.strictEqual((await card()).up, '+Z', '1: undo puts +Z back');

  // 2. the drafted pocket as it opens (Roughing), the Review, the export
  await openStl(DRAFTED, '2');
  assert.ok(/^Replaced with drafted\.stl: a relief, \d+ levels$/.test(await notice()), '2: the notice: ' + await notice());
  assert.deepStrictEqual(await plan(), ['roughing@19'], '2: Roughing');
  await review(9);
  await zoomReview(false);
  await shot('2-review-drafted-stepped.png', '#review-canvas-host');
  await clickEl('#btn-generate-svg');
  let svgFile = null;
  for (let i = 0; i < 100 && !svgFile; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) svgFile = path.join(dlDir, f); else await sleep(100); }
  assert.ok(svgFile, '2: the export downloaded');
  const svg = fs.readFileSync(svgFile, 'utf8');
  fs.writeFileSync(path.join(EVIDENCE_DIR, '2-export-drafted-stepped.svg'), svg);
  const els = [...svg.matchAll(/<(path|circle) [^>]*shaper:cutType="([^"]+)"[^>]*shaper:cutDepth="([^"]+)"/g)].map((m) => `${m[2]} ${m[3]}`);
  console.log('EXPORT ' + JSON.stringify(els) + ' file ' + path.basename(svgFile));
  assert.deepStrictEqual(els, ['pocket 19.000 mm', ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => `pocket ${k}.000 mm`)], '2: the export: the band round the part + the 8 pocket terraces');
  assert.strictEqual(path.basename(svgFile), 'drafted.svg', '2: the file takes the STL\'s name');

  // 3. the dome as it opens (Roughing): the terraces
  await openStage('prepare');
  await openStl(DOME, '3');
  await review('\\d+');
  console.log('3: ' + await evalJs(`document.getElementById('review-info').textContent`));
  const levels = await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [...new Set(m.planReliefItems(window.__designController.state).map((i) => i.cutDepth))].sort((a, b) => a - b))`);
  assert.deepStrictEqual(levels.filter((d) => d !== 29), [...Array.from({ length: 28 }, (_, i) => i + 1), 30], '3: terraces at every 1 mm, 1..30 (29: the 0.03 mm band at the dome\'s foot, kept only where wider than the drawing tolerance): ' + levels);
  await zoomReview(true);
  await shot('3-review-dome-top.png', '#review-canvas-host');
  await zoomReview(false);
  await shot('3-review-dome-angled.png', '#review-canvas-host');

  // 4. save + reopen: a named design keeps its STL card
  await openStage('prepare');
  await evalJs(CREATE_NAMED_DESIGN('shaper', 'STL 790'));
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(600);
  await openStl(BLOCK, '4');
  await waitFor(`import('/packages/ui/project-store.js').then(async (m) => { const d = await m.getProjectStore().loadCurrent(); const h = d && d.document && d.document.hosts; return !!(h && h.shaper && Array.isArray(h.shaper.stl) && h.shaper.stl.length === 1 && h.shaper.stl[0].name === 'block.stl'); })`, '4: autosaved with its STL (TASK 841: the list of its STL sources)', 15000);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  if (await evalJs(`document.getElementById('view-prepare').hidden`)) await openStage('prepare');
  await waitFor(`!document.querySelector('#prepare-panel .stl-card').hidden`, '4: the card after the reload');
  assert.deepStrictEqual(await card(), { name: 'block.stl', up: '+Z', unit: 'mm', size: '120 × 80 × 19 mm', open: 'true' }, '4: reopened: the STL card');
  await shot('4-reopened-card.png', '#prepare-panel .stl-card');

  // PHONE
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStl(BLOCK, 'phone');
  assert.ok(/^Added block\.stl: a relief, \d+ levels$/.test(await notice()), 'phone: the notice: ' + await notice());
  assert.deepStrictEqual(await card(), { name: 'block.stl', up: null, unit: null, size: null, open: 'false' }, 'phone: the card, folded');
  await clickEl('#prepare-panel .stl-head');
  assert.deepStrictEqual(await card(), { name: 'block.stl', up: '+Z', unit: 'mm', size: '120 × 80 × 19 mm', open: 'true' }, 'phone: a tap opens it');
  const fits = await evalJs(`(() => { const r = document.querySelector('#prepare-panel .stl-card').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`);
  assert.ok(fits, 'phone: the card is on the screen');
  await shot('5-phone-card.png', '#prepare-panel .stl-card');
  await clickEl('.stl-ups .cut-preset[data-value="+Y"]');
  await waitFor(`/^Replaced with block\\.stl/.test(document.getElementById('prepare-notice').textContent)`, 'phone: +Y re-sliced');
  assert.strictEqual((await card()).size, '120 × 19 × 80 mm', 'phone: +Y up: the part stands on its side');

  // THE OTHER APPS offer no STL
  touch = false;
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  for (const app of ['sketchstudio', 'penplotter', 'trace']) {
    await navigate(`http://127.0.0.1:${port}/apps/${app}/index.html`, 15000);
    await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, app + ': the menu button');
    await sleep(500);
    await clickEl('.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, app + ': the drawer opens'); await sleep(300);
    const items = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-action]')].map((e) => e.dataset.action + ':' + e.textContent.trim())`);
    console.log(app + ' drawer: ' + JSON.stringify(items));
    assert.ok(items.length > 3 && !items.some((t) => /stl/i.test(t)), app + ': no STL entry');
  }
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('stl-open-790-live.test.js: ok');
} finally {
  await close();
}
