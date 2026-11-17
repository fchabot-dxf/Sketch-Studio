// tests/transform-753-refusals-live.test.js — TASK 753: the transform box's REFUSALS and its confirm in the real SketchStudio (desktop, mouse), on a
// HAND-MADE group (a rectangle from the Rect tool: 2 horizontal + 2 vertical inside):
//  - a typed 30 asks ONE confirm ("Rotating Group 1 removes 4 horizontal / vertical constraints inside it ..."), the preview shown behind it;
//    Rotate turns it (edges at 30 degrees), Ctrl+Z brings the rectangle and its constraints back in one step;
//  - a typed 90 asks nothing (H <-> V swapped: the edges stay square to the screen, width and height swapped);
//  - a point of the group fixed (entered, the corner picked, F): a press on the rotate handle shows "a point of Group 1 is fixed" AT the handle,
//    and nothing turns;
//  - the browser row shows the red padlock's badge (the same lock state); the box with both padlocks on, on a DARK canvas (the --sk-* canvas
//    tokens of a dark look) and the light one.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/753');
fs.mkdirSync(EVID, { recursive: true });
const C = '#svgCanvas';
const out = {};
const cdp = await launchBrowser({ tag: '753-refusals', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
const mouse = (type, x, y, buttons, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const click = async (p, n = 1) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1, n); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, n); await sleep(350); };
const dblclick = async (p) => { await click(p, 1); await sleep(60); await click(p, 2); };
const drag = async (a, b, steps = 10) => { await mouse('mouseMoved', a.x, a.y, 0); await sleep(40); await mouse('mousePressed', a.x, a.y, 1); await sleep(40); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1); await sleep(25); } await sleep(60); await mouse('mouseReleased', b.x, b.y, 0); await sleep(450); };
const key = (k, code, vk, mod = 0) => sendRealKey(send, k, code, vk, mod);
const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); return name; };
const lines = () => evalJs(`[...document.querySelectorAll('${C} line.shape-elem[data-shape-id]')].map((e) => ['x1', 'y1', 'x2', 'y2'].map((k) => +e.getAttribute(k)))`);
const angles = (ls) => ls.map((l) => Math.round(((Math.atan2(l[3] - l[1], l[2] - l[0]) * 180 / Math.PI) % 180 + 180) % 180 * 1000) / 1000).sort((a, b) => a - b);
// a world point of the drawing on screen (through the drawn line's own transform)
const screenOf = (x, y) => evalJs(`(() => { const e = document.querySelector('${C} line.shape-elem'); const m = e.getScreenCTM(); return { x: m.a * ${x} + m.c * ${y} + m.e, y: m.b * ${x} + m.d * ${y} + m.f }; })()`);
const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const boxClip = (extra = 80) => evalJs(`(() => { const rs = [...document.querySelectorAll('${C} .tbox, ${C} .tbox-tip')].map((e) => e.getBoundingClientRect()); const l = Math.min(...rs.map((r) => r.left)) - ${extra}, t = Math.min(...rs.map((r) => r.top)) - ${extra}; return { x: Math.max(0, l), y: Math.max(0, t), width: Math.max(...rs.map((r) => r.right)) - l + ${extra}, height: Math.max(...rs.map((r) => r.bottom)) - t + ${extra} }; })()`);
const edge = async () => { const ls = await lines(); const l = ls.find((q) => Math.abs(q[1] - q[3]) < 1e-6) || ls[0]; return screenOf((l[0] + l[2]) / 2, (l[1] + l[3]) / 2); };

try {
  await installFakeDriveSession(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
  await waitForApp('svgCanvas'); await sleep(500);
  await evalJs(`(() => { window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); })()`);
  // a rectangle by the Rect tool (two clicks), then the Select tool; the whole of it boxed and grouped (Ctrl+G)
  const cv = await evalJs(`(() => { const r = document.querySelector('${C}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await key('r', 'KeyR', 82); await sleep(200);
  await click({ x: cv.x - 120, y: cv.y - 60 }); await click({ x: cv.x + 120, y: cv.y + 60 });
  await key('Escape', 'Escape', 27); await sleep(200);
  await key('s', 'KeyS', 83); await sleep(200);
  await waitFor(`document.querySelectorAll('${C} line.shape-elem[data-shape-id]').length === 4`, 'the rectangle drawn');
  out.drawn = angles(await lines());
  assert.deepStrictEqual(out.drawn, [0, 0, 90, 90], 'a rectangle square to the screen');
  await drag({ x: cv.x - 200, y: cv.y - 130 }, { x: cv.x + 200, y: cv.y + 130 });
  await key('g', 'KeyG', 71, 2); await sleep(400);
  await key('Escape', 'Escape', 27); await sleep(200);
  await click(await edge());
  out.box = await evalJs(`[...document.querySelectorAll('${C} .tbox')].map((e) => e.dataset.mode + ':' + e.querySelectorAll('[data-handle]').length)`);
  assert.deepStrictEqual(out.box, ['select:5'], 'Ctrl+G made a group: a click on an edge shows its box with the 5 handles');

  // a typed 30: ONE confirm, the preview behind it; Rotate; Ctrl+Z
  const r0 = await lines();
  await click(await centre(`${C} [data-handle="rotate"]`));
  await evalJs(`document.getElementById('tbox-input').value = ''`); await send('Input.insertText', { text: '30' }); await key('Enter', 'Enter', 13); await sleep(600);
  out.confirm = await evalJs(`(() => { const d = document.querySelector('.sk-tp-backdrop [role=dialog]'); return d ? { label: d.getAttribute('aria-label'), buttons: [...d.querySelectorAll('button')].map((b) => b.textContent) } : null; })()`);
  assert.deepStrictEqual(out.confirm, { label: 'Rotating Group 1 removes 4 horizontal / vertical constraints inside it (Undo brings them back).', buttons: ['Rotate', 'Cancel'] }, 'a typed 30 asks ONE confirm naming the 4 constraints');
  out.previewAngles = angles(await lines());
  out.confirmShot = await shot('sketchstudio-refusal-1-confirm-hv-at-30.png');
  await click(await centre('.sk-tp-backdrop [data-choice="rotate"]')); await sleep(600);
  out.rotated = angles(await lines());
  assert.deepStrictEqual(out.rotated, [60, 60, 150, 150], 'Rotate: the edges turned 30 degrees counter-clockwise on screen (y-down: at -30 = 150 and 60 degrees)');
  out.rotatedShot = await shot('sketchstudio-refusal-2-rotated-30-after-confirm.png', await boxClip());
  await key('z', 'KeyZ', 90, 2); await sleep(600);
  assert.deepStrictEqual(await lines(), r0, 'Ctrl+Z: the rectangle back exactly, in one step');
  // a typed 90: no confirm, H <-> V swapped, square to the screen
  if (!(await evalJs(`!!document.querySelector('${C} .tbox[data-mode=select]')`))) await click(await edge());
  await click(await centre(`${C} [data-handle="rotate"]`));
  await evalJs(`document.getElementById('tbox-input').value = ''`); await send('Input.insertText', { text: '90' }); await key('Enter', 'Enter', 13); await sleep(600);
  out.ninety = { dialog: await evalJs(`!!document.querySelector('.sk-tp-backdrop [role=dialog]')`), angles: angles(await lines()) };
  assert.deepStrictEqual(out.ninety, { dialog: false, angles: [0, 0, 90, 90] }, 'a typed 90: no confirm, the edges stay square to the screen (H and V swapped)');
  const w = (ls) => { const xs = ls.flatMap((l) => [l[0], l[2]]), ys = ls.flatMap((l) => [l[1], l[3]]); return [Math.round((Math.max(...xs) - Math.min(...xs)) * 1e6) / 1e6, Math.round((Math.max(...ys) - Math.min(...ys)) * 1e6) / 1e6]; };
  out.size = [w(r0), w(await lines())];
  assert.deepStrictEqual(out.size[1], [out.size[0][1], out.size[0][0]], 'width and height swapped');
  await key('z', 'KeyZ', 90, 2); await sleep(500);

  // a point of the group fixed: enter (double click), pick its corner, F; step out; select; the rotate handle refuses AT the handle
  const ls = await lines(), corner = await screenOf(ls[0][0], ls[0][1]);
  await dblclick(await edge()); await sleep(300);
  await click(corner); await key('f', 'KeyF', 70); await sleep(300);
  await key('Escape', 'Escape', 27); await key('Escape', 'Escape', 27); await sleep(300);
  await click(await edge());
  const f0 = await lines(), rot = await centre(`${C} [data-handle="rotate"]`);
  await mouse('mouseMoved', rot.x, rot.y, 0); await sleep(40); await mouse('mousePressed', rot.x, rot.y, 1); await sleep(40);
  for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', rot.x + 12 * i, rot.y + 4 * i, 1); await sleep(30); }
  await sleep(150);
  out.fixedTip = await evalJs(`(() => { const ts = [...document.querySelectorAll('${C} .tbox-tip text')]; return ts.length ? ts.map((t) => t.textContent).join(' ') : null; })()`);
  out.fixedShot = await shot('sketchstudio-refusal-3-fixed-point-at-handle.png', await boxClip());
  await mouse('mouseReleased', rot.x + 72, rot.y + 24, 0); await sleep(400);
  assert.strictEqual(out.fixedTip, 'a point of Group 1 is fixed: unlock it to rotate', 'the reason shows at the rotate handle');
  assert.deepStrictEqual(await lines(), f0, 'nothing turned');

  // the browser row shows the red padlock's state; both padlocks on, light and dark
  await click(await centre(`${C} .tbox-lock[data-lock="full"]`));
  await evalJs(`(() => { const n = document.querySelector('.sk-sketch-node:last-child .sk-sketch-tw'); if (n && n.classList.contains('is-collapsed')) n.click(); })()`); await sleep(400); // expand the sketch's rows
  out.row = await evalJs(`[...document.querySelectorAll('.sk-group-row')].map((r) => [r.textContent.trim(), [...r.querySelectorAll('.sk-group-lock')].map((b) => b.dataset.lock + ':' + b.getAttribute('aria-label'))])`);
  assert.ok(out.row.some(([, b]) => b.join() === 'full:Full lock: on'), 'the group row shows the Full lock badge: ' + JSON.stringify(out.row));
  const row = await evalJs(`(() => { const r = document.querySelector('.sk-group-row').getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; })()`);
  out.rowShot = await shot('sketchstudio-refusal-4-browser-row-full-lock-badge.png', row);
  out.lightShot = await shot('sketchstudio-refusal-5-padlocks-on-light.png', await boxClip(60));
  await evalJs(`(() => { const c = document.querySelector('${C}'); c.style.setProperty('--sk-canvas-bg', '#14161a'); c.style.setProperty('--sk-grid-minor', '#2a2d33'); c.style.setProperty('--sk-grid-major', '#3a4250'); c.style.setProperty('--sk-geo-fixed', '#e6e6e6'); c.style.background = '#14161a'; })()`);
  await sleep(500);
  out.darkShot = await shot('sketchstudio-refusal-6-padlocks-on-dark-canvas.png', await boxClip(60));
  out.errors = await evalJs('window.__errs');
  assert.deepStrictEqual(out.errors, [], 'no page error');
  console.log('TASK 753 refusals: ' + JSON.stringify(out));
} finally {
  await cdp.close();
}
