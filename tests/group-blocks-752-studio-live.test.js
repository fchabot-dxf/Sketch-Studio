// tests/group-blocks-752-studio-live.test.js — TASK 752 in the REAL SketchStudio (headless, REAL mouse via CDP, desktop 1280 x 800): a user group
// that is not entered is ONE rigid block the solver only translates. A saved design holds a letter (an outline and a hole: 8 lines, no inside
// constraint) in a group, and an outside line W whose end is coincident with the letter's corner.
//  1. W dragged by its middle: the letter keeps its shape (every corner by the same vector, every inside distance unchanged to 1e-9): it moves
//     whole, or W gives (before TASK 752 the corner was pulled alone);
//  2. a double click on the letter's left edge ENTERS the group (that edge selected); a drag of that edge reshapes the letter (inside the
//     entered group its curves are free); Esc leaves;
//  3. W dragged again: the letter keeps its NEW shape (nothing stored: the shape at each solve is the block's).
// Geometry is read from the drawn canvas (#svgCanvas line.shape-elem, world units). Screenshots (.evidence/752, local): before / after each step.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve('.evidence/752');
fs.mkdirSync(EVID, { recursive: true });
const J = (x, y) => ({ x, y, fixed: false, sketchId: 'sketch-1' });
const LETTER = ['e1', 'e2', 'e3', 'e4', 'h1', 'h2', 'h3', 'h4'];
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ['o1', J(10, 10)], ['o2', J(30, 10)], ['o3', J(30, 50)], ['o4', J(10, 50)],
    ['i1', J(15, 15)], ['i2', J(25, 15)], ['i3', J(25, 45)], ['i4', J(15, 45)], ['w1', J(-25, 25)], ['w2', J(10, 10)]],
  shapes: [['e1', 'o1', 'o2'], ['e2', 'o2', 'o3'], ['e3', 'o3', 'o4'], ['e4', 'o4', 'o1'], ['h1', 'i1', 'i2'], ['h2', 'i2', 'i3'], ['h3', 'i3', 'i4'], ['h4', 'i4', 'i1'], ['W', 'w1', 'w2']]
    .map(([id, a, b]) => ({ id, type: 'line', joints: [a, b], sketchId: 'sketch-1', isConstruction: false, ...(id === 'W' ? {} : { userGroupId: 'group-1' }) })),
  constraints: [{ id: 'cW', type: 'coincident', joints: ['w2', 'o1'] }],
  sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [{ id: 'group-1', name: 'Letter', sketchId: 'sketch-1' }], profiles: [], parameters: [] } };

const t0 = Date.now();
const cdp = await launchBrowser({ tag: '752-studio', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, navigate, waitForApp } = cdp;
const results = {}, md5s = [];
const mouse = (type, x, y, buttons, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
const dblclick = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90); await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(50); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(650); };
const mouseDrag = async (a, b, steps = 16) => { await mouse('mouseMoved', a.x, a.y, 0); await sleep(60); await mouse('mousePressed', a.x, a.y, 1); await sleep(60); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1); await sleep(25); } await sleep(100); await mouse('mouseReleased', b.x, b.y, 0); await sleep(500); };
// every drawn line's ends (world units) and the canvas transform
const geo = () => evalJs(`(() => { const ls = {}; const m = document.querySelector('#svgCanvas .shape-elem').getScreenCTM();
  for (const e of document.querySelectorAll('#svgCanvas line.shape-elem')) ls[e.dataset.shapeId] = [+e.getAttribute('x1'), +e.getAttribute('y1'), +e.getAttribute('x2'), +e.getAttribute('y2')];
  return JSON.stringify({ ls, m: [m.a, m.b, m.c, m.d, m.e, m.f] }); })()`).then(JSON.parse);
const toS = (g, x, y) => ({ x: g.m[0] * x + g.m[2] * y + g.m[4], y: g.m[1] * x + g.m[3] * y + g.m[5] });
const mid = (g, id) => { const v = g.ls[id]; return toS(g, (v[0] + v[2]) / 2, (v[1] + v[3]) / 2); };
// the letter's 8 corners (each line's start), keyed by line
const corners = (g) => Object.fromEntries(LETTER.map((id) => [id, [g.ls[id][0], g.ls[id][1]]]));
const rigidity = (a, b) => {
  const ks = Object.keys(a), v = [b[ks[0]][0] - a[ks[0]][0], b[ks[0]][1] - a[ks[0]][1]];
  const spread = Math.max(...ks.map((k) => Math.hypot(b[k][0] - a[k][0] - v[0], b[k][1] - a[k][1] - v[1])));
  let dist = 0;
  for (let i = 0; i < ks.length; i++) for (let k = i + 1; k < ks.length; k++) { const p = ks[i], q = ks[k]; dist = Math.max(dist, Math.abs(Math.hypot(b[p][0] - b[q][0], b[p][1] - b[q][1]) - Math.hypot(a[p][0] - a[q][0], a[p][1] - a[q][1]))); }
  return { v, moved: Math.hypot(...v), spread, dist };
};
const shot = async (name, g) => {
  const a = toS(g, -35, 65), b = toS(g, 60, -5);
  const clip = { x: Math.max(0, Math.min(a.x, b.x)), y: Math.max(0, Math.min(a.y, b.y)), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), scale: 2 };
  const r = await send('Page.captureScreenshot', { format: 'png', clip });
  const buf = Buffer.from(r.data, 'base64');
  fs.writeFileSync(path.join(EVID, name), buf);
  md5s.push(name + '=' + createHash('md5').update(buf).digest('hex'));
};

try {
  await installFakeDriveSession(cdp);
  await resetBufferLive(cdp);
  const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
  await navigate(url, 8000); await waitForApp('svgCanvas');
  await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const s = m.getProjectStore(); const d = await s.newDesign('Task 752', { app: 'sketchstudio' }); await s.save(${JSON.stringify(DOC)}, { app: 'sketchstudio', id: d.id }); return d.id; })`);
  await navigate(url, 8000); await waitForApp('svgCanvas'); await sleep(700);
  await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
  let g = await geo();
  assert.ok(LETTER.every((id) => g.ls[id]) && g.ls.W, 'the design loaded: the letter and W are drawn');
  const away = async () => { const p = toS(g, 55, 60); await mouse('mouseMoved', p.x, p.y, 0); await sleep(250); };

  // 1. W dragged: the letter moves whole or W gives
  await away(); await shot('S1-studio-W-on-letter-corner-before-drag.png', g);
  const c0 = corners(g), w0 = g.ls.W;
  let p = mid(g, 'W');
  await mouseDrag(p, { x: p.x + 50, y: p.y - 40 });
  g = await geo();
  const r1 = rigidity(c0, corners(g));
  const wMoved = Math.max(Math.hypot(g.ls.W[0] - w0[0], g.ls.W[1] - w0[1]), Math.hypot(g.ls.W[2] - w0[2], g.ls.W[3] - w0[3]));
  const onCorner = Math.hypot(g.ls.W[2] - g.ls.e1[0], g.ls.W[3] - g.ls.e1[1]);
  results.drag1 = { ...r1, wMoved, onCorner };
  console.log('1. W dragged: ' + JSON.stringify(results.drag1));
  assert.ok(r1.spread < 1e-9 && r1.dist < 1e-9, '1. the letter keeps its shape (moves whole or stays)');
  assert.ok((r1.moved > 1 || wMoved > 1) && onCorner < 1e-6, '1. the drag moved the letter or W, W still on the corner');
  await away(); await shot('S2-studio-after-W-drag-letter-whole.png', g);

  // 2. enter the group, reshape: drag its left edge
  await sleep(600);
  p = mid(g, 'e4');
  await dblclick(p);
  await sleep(600);
  const e0 = corners(g = await geo());
  p = mid(g, 'e4');
  await mouseDrag(p, { x: p.x - 60, y: p.y });
  g = await geo();
  const r2 = rigidity(e0, corners(g));
  results.reshape = r2;
  console.log('2. inside the entered group, the left edge dragged: ' + JSON.stringify(r2));
  assert.ok(r2.dist > 1, '2. inside the entered group the letter is reshaped');
  await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
  await away(); await shot('S3-studio-letter-reshaped-inside-then-left.png', g);

  // 3. W dragged again: the NEW shape moves whole
  await sleep(600);
  const n0 = corners(g);
  p = mid(g, 'W');
  await mouseDrag(p, { x: p.x - 40, y: p.y + 50 });
  g = await geo();
  const r3 = rigidity(n0, corners(g));
  results.drag2 = r3;
  console.log('3. W dragged again: ' + JSON.stringify(results.drag2));
  assert.ok(r3.spread < 1e-9 && r3.dist < 1e-9, '3. the reshaped letter keeps its NEW shape');
  await away(); await shot('S4-studio-after-second-drag-new-shape-whole.png', g);

  console.log('group-blocks-752-studio-live: ALL CHECKS PASSED ' + JSON.stringify(results));
  console.log('screenshots: ' + md5s.join(' '));
  console.log('elapsed ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
} finally {
  await cdp.close();
}
