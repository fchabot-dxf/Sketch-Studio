// tests/smoothing-809-live.test.js — TASK 809: SMOOTHING, a toolpath setting of Roughing and Contour, in the real Shaper page (web mode), real clicks /
// touches / typing. The part is built here (tests/helpers/stl-mesh.js: a dome, R 30 mm). `node tests/smoothing-809-live.test.js <file.stl>` runs the same
// steps on another STL (its numbers are printed; the screenshots are named after it).
//  DESKTOP 1280 x 800: the drawer's Open STL -> the relief's card: the Smoothing row, 0.1 (Roughing's default) -> the Export step's Paths view: every
//   written path of the Roughing is cubics (C), zoomed screenshot -> back in Prepare, typed 0 in Smoothing (one undo step): the Paths view's paths are
//   straight segments only (no C), the same zoom, screenshot -> the footer's Undo: 0.1 again -> Contour On, Edit contour: its card's Smoothing 0.05 (TASK 810, owner turn 2688; was 0.02).
//  PHONE 390 x 844 (touch): Open STL -> a tap on the relief: the card's Smoothing row on the screen, 0.1.
// No console error / page exception. Screenshots (.evidence/809/<name>-*.png).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import * as M from './helpers/stl-mesh.js';

const EVIDENCE_DIR = path.resolve('.evidence/809');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-809-'));
const OWN = process.argv[2] ? path.resolve(process.argv[2]) : null;
const STL = OWN || path.join(tmp, 'dome.stl');
if (!OWN) fs.writeFileSync(STL, M.binaryStl(M.dome(30, 48, 64)));
const NAME = OWN ? path.basename(OWN, '.stl') : 'dome';

const cdp = await launchBrowser({ tag: '809-smooth', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
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
  const file = path.join(EVIDENCE_DIR, `${NAME}-${name}`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('screenshot ' + file);
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
const openStage = async (id) => { // desktop: the header's stage tab; a phone: the drawer's stage button
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
  await send('DOM.setFileInputFiles', { files: [STL], backendNodeId: ch.backendNodeId });
  await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.includes(': a relief, ')`, what + ': the import notice', 120000);
  await waitFor(`document.getElementById('prepare-notice').hidden`, what + ': the import notice gone', 15000);
};
// the relief: a press on its outline (top-most vertex on the canvas, away from the edges)
const pressOutline = async () => {
  const p = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => { const k = [...m.CUT_PLAN.entries()].find(([, r]) => r.levels)[0];
    const { loops } = m.loopsWithPolygons(window.__designController.state); const l = loops.find((x) => 'loop:' + x.id === k);
    const svg = document.getElementById('prepare-canvas'), M = svg.getScreenCTM();
    for (const q of [...l.polygon].sort((a, b) => a.y - b.y)) { const pt = svg.createSVGPoint(); pt.x = q.x; pt.y = q.y; const s = pt.matrixTransform(M); const x = Math.round(s.x), y = Math.round(s.y);
      const hit = document.elementFromPoint(x, y); if (hit && svg.contains(hit) && x > 60 && y > 60 && x < innerWidth - 60 && y < innerHeight - 60) return { x, y }; }
    return null; })`);
  assert.ok(p, 'a point of the outline on the canvas');
  await press(p.x, p.y);
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden`, 'the relief\'s card');
};
const passesTab = async () => { await clickEl('.cut-tab[data-tab="passes"]'); await waitFor(`document.querySelector('.cut-tab[data-tab="passes"]').classList.contains('is-active')`, 'the Passes tab'); }; // TASK 810: Smoothing is in the Passes tab
const rowShown = (name) => evalJs(`(() => { const r = document.querySelector('#prepare-panel .cut-row[data-row="${name}"]'); return !!r && r.style.display !== 'none'; })()`);
const smoothingValue = () => evalJs(`document.querySelector('#prepare-panel .cut-smoothing').value`);
const record = () => evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => { const r = [...m.CUT_PLAN.values()].find((x) => x.levels); return { smoothing: r.smoothing === undefined ? 'unset' : r.smoothing }; })`);
// the Paths view's written paths (the file's own d strings): their count, the cubics and the straight pieces in them
const pathsFacts = () => evalJs(`(() => { const ds = [...document.querySelectorAll('#review-2d-canvas .rv2d-doc .rv2d-path')].map((e) => e.getAttribute('d') || '');
  return { paths: ds.length, C: ds.reduce((n, d) => n + (d.match(/C /g) || []).length, 0), L: ds.reduce((n, d) => n + (d.match(/L /g) || []).length, 0), bytes: ds.reduce((n, d) => n + d.length, 0) }; })()`);
const openPaths = async () => {
  await openStage('review');
  await clickEl('#review-view-paths');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-path').length > 0`, 'the Paths view', 120000);
  await sleep(500);
};
// the Paths view zoomed on a world point (the same view each time: Fit, then the wheel there)
const zoomPaths = async (wx, wy, steps = 14) => {
  await clickEl('#review-fit'); await sleep(300);
  const s = await evalJs(`(() => { const c = document.getElementById('review-2d-canvas'), p = c.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(c.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'none', clickCount: 0 });
  for (let i = 0; i < steps; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: s.x, y: s.y, deltaX: 0, deltaY: -120 }); await sleep(60); }
  await sleep(500);
};
// a world point on the first written path (where the zoom goes): its first vertex
const zoomTarget = () => evalJs(`(() => { const d = document.querySelector('#review-2d-canvas .rv2d-doc .rv2d-path').getAttribute('d').split(/\\s+/); return { x: Number(d[1]), y: Number(d[2]) }; })()`);

try {
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // DESKTOP
  await openStl('desktop');
  await pressOutline();
  assert.strictEqual(await evalJs(`document.querySelector('.cut-type-cur').textContent`), 'Roughing', 'desktop: the relief is a Roughing');
  assert.ok(await rowShown('smoothing'), 'desktop: the Smoothing row');
  assert.deepStrictEqual([await evalJs(`document.querySelector('#prepare-panel .cut-row[data-row="smoothing"] .cut-field-label').textContent`), await smoothingValue(), await record()],
    ['Smoothing', '0.1', { smoothing: 'unset' }], 'desktop: Smoothing 0.1, the Roughing default (not stored)');
  await passesTab();
  await evalJs(`document.querySelector('#prepare-panel .cut-row[data-row="smoothing"]').scrollIntoView({ block: 'nearest' })`); await sleep(200);
  await shot('desktop-card.png', ['#prepare-panel .cut-row[data-row="smoothing"]']);
  await openPaths();
  const on = await pathsFacts();
  console.log(`desktop: smoothed (0.1): ${JSON.stringify(on)}`);
  assert.ok(on.paths > 0 && on.C > 0, 'desktop: the Paths view draws the smoothed paths (cubics)');
  const target = await zoomTarget();
  await zoomPaths(target.x, target.y);
  await shot('paths-after.png', '#review-2d-canvas');
  const vbAfter = await evalJs(`document.getElementById('review-2d-canvas').getAttribute('viewBox')`);
  // Smoothing 0: typed in the card (one undo step)
  await openStage('prepare');
  await pressOutline();
  const hist = await evalJs(`window.__designController.state.history.length`);
  await passesTab();
  await clickEl('#prepare-panel .cut-smoothing');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await send('Input.insertText', { text: '0' });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await evalJs(`document.querySelector('#prepare-panel .cut-smoothing').blur()`);
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].find((x) => x.levels).smoothing === 0)`, 'desktop: Smoothing 0 stored', 30000);
  assert.strictEqual(await evalJs(`window.__designController.state.history.length`), hist + 1, 'desktop: one undo step');
  assert.strictEqual(await smoothingValue(), '0', 'desktop: the row shows 0');
  await openPaths();
  const off = await pathsFacts();
  console.log(`desktop: off (0): ${JSON.stringify(off)}`);
  assert.ok(off.paths > 0 && off.C === 0 && off.L > on.L, 'desktop: off: straight segments only, more of them');
  await zoomPaths(target.x, target.y);
  const vbBefore = await evalJs(`document.getElementById('review-2d-canvas').getAttribute('viewBox')`), nums = (v) => v.split(/\s+/).map(Number);
  assert.ok(nums(vbBefore).every((v, i) => Math.abs(v - nums(vbAfter)[i]) <= 0.02 * nums(vbAfter)[2]), `desktop: the same zoom for both screenshots (Fit frames the paths, a hair apart): ${vbBefore} vs ${vbAfter}`);
  await shot('paths-before.png', '#review-2d-canvas');
  // Undo: the default again
  await openStage('prepare');
  await clickEl('#btn-undo');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.values()].find((x) => x.levels).smoothing === undefined)`, 'desktop: undo', 30000);
  // the part's Contour: its own Smoothing (0.05: TASK 810, owner turn 2688)
  await pressOutline();
  await passesTab();
  await clickEl('.cut-contour-modes .cut-preset[data-value="true"]');
  await waitFor(`!document.querySelector('.cut-contour-edit').hidden`, 'desktop: Contour On', 60000);
  await clickEl('.cut-contour-edit');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Contour'`, 'desktop: the Contour card');
  assert.deepStrictEqual([await rowShown('smoothing'), await smoothingValue()], [true, '0.05'], 'desktop: the Contour card: Smoothing 0.05 (its default)');
  await shot('desktop-contour-card.png', ['#prepare-panel .cut-row[data-row="smoothing"]', '#prepare-panel .cut-row[data-row="stepDepth"]']);

  // PHONE
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStl('phone');
  await pressOutline();
  assert.ok(await rowShown('smoothing'), 'phone: the Smoothing row');
  await passesTab();
  await evalJs(`document.querySelector('#prepare-panel .cut-row[data-row="smoothing"]').scrollIntoView({ block: 'nearest' })`); await sleep(300);
  const onScreen = await evalJs(`(() => { const r = document.querySelector('#prepare-panel .cut-smoothing').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && !!hit && (hit.closest('.cut-row') || {}).dataset.row === 'smoothing'; })()`);
  assert.ok(onScreen, 'phone: the Smoothing field is on the screen, not covered');
  assert.strictEqual(await smoothingValue(), '0.1', 'phone: 0.1');
  await shot('phone-card.png', '#prepare-panel .cut-row[data-row="smoothing"]');

  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('smoothing-809-live.test.js: ok');
} finally {
  await close();
}
