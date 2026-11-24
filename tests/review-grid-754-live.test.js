// tests/review-grid-754-live.test.js — TASK 754: the Export step's 3D view on the Design canvas's LIGHT paper with the Design canvas's grid,
// in the real Shaper page (software WebGL), checked on the PIXELS the shader draws:
// FUSION MODE, DESKTOP 1280 x 800 (window.adsk stubbed, the real Fusion solid tests/fixtures/real-solid-plate-711.json):
//  1. the clear colour = the Design canvas's paper token (--shaper-cream resolved on #design-canvas), read on screen with the grid off;
//  2. the Grid Style (the Style panel's real GRID_MODE select): lines -> the grid point, the line between two points dark, the cell centre
//     paper; points -> only the grid point dark; off -> no grid, all paper;
//  3. Top view: the light lines found on a pixel row sit where the projected multiples of the Design spacing are, their spacing = the
//     projection of two neighbouring grid points, and the board measures (board width / grid cell) cells on screen as in Design;
//     the same in an INCH document (the inch spacing);
//  4. a real left-drag orbit and wheel zoom keep the grid (pixels re-checked at the new camera);
//  5. a style template with grid tokens (inline on #design-canvas, as bindTemplateTokens sets them) retints the 3D grid at once; back to default;
//  6. Export 2D unchanged (its background and info card colours);
//  frame time with the grid (lines / points / off), logged;
// FUSION MODE, PHONE 390 x 844 (touch, reloaded): paper, lines and points on screen, one finger orbits and the grid stays;
// APP MODE, DESKTOP: a seeded design (as review-live.test.js): paper + lines on screen, the spacing on screen, the 3D grid colours == the
// Design canvas grid's own drawn colours (#grid / #grid-heavy strokes), the active document tab reads on the light paper.
// Screenshots: .evidence/754/live/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { REVIEW_BUILT, reviewBuilt } from './helpers/review-built.js'; // TASK 880: the 3D build is waited for through lastBuild (no build line on screen)

const EVIDENCE_DIR = path.resolve('.evidence/754/live');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const realSolid = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '754-grid', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;

let touchMode = false;
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', clickCount: 0, ...extra });
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })) });
const tap = async (x, y) => {
  if (touchMode) { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); await sleep(300); return; }
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
const clickEl = async (sel) => {
  await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`);
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await tap(p.x, p.y);
};
const openStage = async (id) => {
  for (let i = 0; i < 5; i++) {
    await clickEl(`.sk-header-tab[data-tab="${id}"]`); await sleep(300);
    if (await evalJs(`!document.getElementById(${JSON.stringify(id === 'design' ? 'design-view' : 'view-' + id)}).hidden`)) return;
  }
  assert.fail('could not open the ' + id + ' stage');
};
const shot = async (name, sel = '#review-stage') => {
  const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`) : undefined;
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const view = `import('/apps/shaper/src/main.js').then((m) => m.currentReviewView())`;
const state = () => evalJs(`${view}.then((v) => v.inspect())`);
const S = (expr) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { const S = m.default; return ${expr}; })`);
// the Grid Style, set through the Style panel's real GRID_MODE select (its change event writes the setting)
const setGridMode = async (mode) => {
  await evalJs(`(() => { const s = document.querySelector('.sk-style-panel [data-key="GRID_MODE"]'); s.value = ${JSON.stringify(mode)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  assert.strictEqual(await S(`S.get('GRID_MODE')`), mode, 'the Style panel select wrote GRID_MODE ' + mode);
  await sleep(250);
};
// the screen pixels of the 3D canvas (a real screenshot, decoded in the page): rgb at canvas CSS points, or one whole row
const canvasClip = () => evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
async function pixels(points, row = null) {
  const clip = await canvasClip();
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  return evalJs(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const k = img.width / ${clip.width};
    const at = (p) => [...g.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data].slice(0, 3);
    const row = ${JSON.stringify(row)};
    if (row !== null) { const d = g.getImageData(0, Math.round(row * k), img.width, 1).data; const out = []; for (let i = 0; i < img.width; i++) out.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]); return { k, row: out }; }
    return ${JSON.stringify(points)}.map(at); })()`);
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const near = (a, b, tol = 2) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

// a grid point P near the board (outside it on screen, inside the full-strength radius, not under the toolbar / info), the middle M of the
// line from P to the next grid point, and the centre C of a light cell: screen points at the CURRENT camera
const probe = () => evalJs(`${view}.then((v) => {
  const i = v.inspect(), g = i.grid, b = i.box, y = b.y, h = document.getElementById('review-canvas-host'), W = h.clientWidth, H = h.clientHeight;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, R = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
  const corners = []; for (const X of [b.minX, b.maxX]) for (const Z of [b.minZ, b.maxZ]) for (const Y of [0, y]) corners.push(v.screenOf([X, Y, Z]));
  // the board's outline on screen = the convex hull of its 8 projected corners; a probe point keeps 10 px away from it
  const pts = corners.slice().sort((a, b2) => a.x - b2.x || a.y - b2.y), cross = (o, a, b2) => (a.x - o.x) * (b2.y - o.y) - (a.y - o.y) * (b2.x - o.x);
  const half = (list) => { const h = []; for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
  const hull = [...half(pts), ...half(pts.slice().reverse())];
  const segDist = (p, a, b2) => { const dx = b2.x - a.x, dy = b2.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
  const sides = (p) => hull.map((a, i) => cross(a, hull[(i + 1) % hull.length], p));
  const insideHull = (p) => sides(p).every((c) => c >= 0) || sides(p).every((c) => c <= 0);
  // on the canvas and not under the toolbar / the info card / the drawer handle (a point the page shows the 3D canvas at)
  const cr = h.getBoundingClientRect(), canvas = h.querySelector('canvas');
  const inView = (p) => p.x > 12 && p.x < W - 12 && p.y > 12 && p.y < H - 12 && [[0, 0], [-8, -8], [8, 8], [-8, 8], [8, -8]].every(([dx, dy]) => document.elementFromPoint(cr.left + p.x + dx, cr.top + p.y + dy) === canvas);
  const offBoard = (p) => !insideHull(p) && hull.every((a, i) => segDist(p, a, hull[(i + 1) % hull.length]) > 10);
  const M = g.major, n = g.minor, best = [];
  // every grid point within the full-strength radius: a heavy one (on two heavy lines) is preferred, else the nearest light one
  for (let kx = Math.floor((cx - 1.3 * R) / n); kx <= Math.ceil((cx + 1.3 * R) / n); kx++) for (let kz = Math.floor((cz - 1.3 * R) / n); kz <= Math.ceil((cz + 1.3 * R) / n); kz++) {
    const x = kx * n, z = kz * n, heavy = Math.abs(x / M - Math.round(x / M)) < 1e-6 && Math.abs(z / M - Math.round(z / M)) < 1e-6;
    if (Math.hypot(x - cx, z - cz) > 1.3 * R) continue;
    for (const s of [1, -1]) {
      const P = v.screenOf([x, y, z]), Mid = v.screenOf([x, y, z + s * n / 2]), C = v.screenOf([x + s * n / 2, y, z + s * n / 2]);
      const cellPx = Math.hypot(v.screenOf([x + n, y, z]).x - P.x, v.screenOf([x + n, y, z]).y - P.y);
      if ([P, Mid, C].every((p) => inView(p) && offBoard(p)) && cellPx >= 10) best.push({ P, M: Mid, C, world: [x, z], heavy, cellPx, d: Math.hypot(x - cx, z - cz) });
    }
  }
  best.sort((a, b2) => (b2.heavy - a.heavy) || a.d - b2.d);
  return best[0] || null;
})`);
// the pixels at the probe for the current Grid Style: what must be dark (a grid mark) and what must be paper
async function checkMarks(mode, why) {
  const s = await state();
  const pr = await probe();
  assert.ok(pr, why + ': a grid point near the board is on screen');
  const [p, m, c] = await pixels([pr.P, pr.M, pr.C]);
  const bg = hexRgb(s.background), dark = (px) => lum(px) < lum(bg) - 8, paper = (px) => near(px, bg, 3);
  console.log(`${why} (${mode}): ${pr.heavy ? 'heavy' : 'light'} grid point ${JSON.stringify(pr.world)} cell ${pr.cellPx.toFixed(1)} px: point ${p} line-middle ${m} cell-centre ${c}, paper ${bg}`);
  assert.strictEqual(s.grid.mode, mode, why + ': the 3D grid style');
  if (mode === 'lines') assert.ok(dark(p) && dark(m) && paper(c), why + ': lines: the grid point and the line between points are drawn, the cell centre is paper');
  if (mode === 'points') assert.ok(dark(p) && paper(m) && paper(c), why + ': points: only the grid point is drawn');
  if (mode === 'off') assert.ok(paper(p) && paper(m) && paper(c) && !s.grid.shown, why + ': off: no grid');
}
// Top view: the light lines on a pixel row between two horizontal lines are where the multiples of the spacing project; spacing == two
// neighbouring grid points' projection; board width on screen / cell on screen == board width / cell (mm)
async function checkSpacing(why) {
  await clickEl('#review-top'); await sleep(300);
  const s = await state();
  const g = s.grid, b = s.box, y = b.y;
  const zRow = Math.ceil((b.maxZ + g.minor) / g.minor) * g.minor + g.minor / 2; // just past the board's front edge, half a cell off a line
  const r = await evalJs(`${view}.then((v) => ({ row: v.screenOf([${(b.minX + b.maxX) / 2}, ${y}, ${zRow}]).y, a: v.screenOf([${b.minX}, ${y}, ${zRow}]).x, b: v.screenOf([${b.maxX}, ${y}, ${zRow}]).x,
    p0: v.screenOf([0, ${y}, ${zRow}]).x, p1: v.screenOf([${g.minor}, ${y}, ${zRow}]).x, W: document.getElementById('review-canvas-host').clientWidth }))`);
  const { k, row } = await pixels(null, r.row);
  const bg = hexRgb(s.background);
  const cellPx = Math.abs(r.p1 - r.p0);
  // dark runs on the row (device px) -> centres in CSS px, kept where the grid is at full strength (within the board's width each side)
  const centres = [];
  for (let i = 0; i < row.length;) {
    if (lum(row[i]) < lum(bg) - 6) { let j = i; let wsum = 0, xs = 0; while (j < row.length && lum(row[j]) < lum(bg) - 6) { const w = lum(bg) - lum(row[j]); wsum += w; xs += w * j; j++; } centres.push(xs / wsum / k + 0.5 / k); i = j; } else i++;
  }
  const lineAt = (xPx) => r.p0 + ((xPx - r.p0) / cellPx); // in cells from world x = 0
  const inside = centres.filter((x) => x > 20 && x < r.W - 20 && Math.abs(x - (r.a + r.b) / 2) < (r.b - r.a));
  const offGrid = inside.map((x) => Math.abs(lineAt(x) - r.p0 - Math.round(lineAt(x) - r.p0)) * cellPx);
  const gaps = inside.slice(1).map((x, i) => x - inside[i]).sort((a2, b2) => a2 - b2);
  const median = gaps[Math.floor(gaps.length / 2)];
  const cells = Math.abs(r.b - r.a) / cellPx;
  console.log(`${why}: unit ${await S(`S.get('DOC_UNIT')`)}, spacing ${g.minor.toFixed(4)} mm / heavy ${g.major.toFixed(4)} mm (base ${g.base.minor.toFixed(4)} / ${g.base.major.toFixed(4)}); ${inside.length} lines on the row, median gap ${median.toFixed(2)} px, `
    + `two neighbouring grid points ${cellPx.toFixed(2)} px apart, worst line off its grid position ${Math.max(...offGrid).toFixed(2)} px; board ${(b.maxX - b.minX).toFixed(1)} mm = ${Math.abs(r.b - r.a).toFixed(1)} px = ${cells.toFixed(3)} cells (mm: ${((b.maxX - b.minX) / g.minor).toFixed(3)})`);
  assert.ok(inside.length >= 10, why + ': light lines found on the row');
  assert.ok(Math.abs(median - cellPx) < 1, why + `: the drawn spacing ${median} px == two neighbouring grid points projected ${cellPx} px`);
  assert.ok(Math.max(...offGrid) < 1.5, why + ': every line sits on a projected multiple of the spacing (the Design coordinates)');
  assert.ok(Math.abs(cells - (b.maxX - b.minX) / g.minor) < 0.05, why + ': the board measures the same number of cells as its width / the Design cell');
  return { g, cellPx };
}
const frameMs = () => evalJs(`${view}.then((v) => { const gl = document.querySelector('#review-canvas-host canvas').getContext('webgl2'), px = new Uint8Array(4);
  v.fit(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now();
  for (let i = 0; i < 30; i++) { v.fit(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return +((performance.now() - t0) / 30).toFixed(2); })`);
const designPaper = () => evalJs(`getComputedStyle(document.getElementById('design-canvas')).getPropertyValue('--shaper-cream').trim().toLowerCase()`);

try {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await S(`(S.set('DOC_UNIT', 'mm'), S.set('GRID_MODE', 'lines'), true)`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(realSolid)})`);
  await waitFor(`/8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the real solid imported (8 regions)');
  await openStage('review');
  await waitFor(REVIEW_BUILT, 'the 3D build', 15000);
  await waitFor(`${view}.then((v) => { const i = v.inspect(); return i.mapLoaded && i.edgeLoaded; })`, 'the plywood photos', 15000);
  await clickEl('#review-reset'); await sleep(300);

  // 1. the clear colour: the Design canvas's paper token, and on screen (grid off: a corner of the view is pure paper)
  const s0 = await state();
  const paper = await designPaper();
  console.log(`paper: design canvas --shaper-cream ${paper}, 3D clear colour ${s0.background}, grid ${JSON.stringify({ mode: s0.grid.mode, minor: s0.grid.minor, major: s0.grid.major, minorColor: s0.grid.minorColor, majorColor: s0.grid.majorColor, y: s0.grid.y })}`);
  assert.strictEqual(paper, '#f4efe1', 'the Design canvas paper token');
  assert.strictEqual(s0.background, paper, 'the 3D clear colour IS the Design canvas paper');
  assert.strictEqual(s0.grid.y, s0.box.y, 'the grid lies on the plane the board sits on (its underside)');
  const tokens = await evalJs(`(() => { const s = getComputedStyle(document.getElementById('design-canvas')); return [s.getPropertyValue('--sk-grid-minor').trim().toLowerCase(), s.getPropertyValue('--sk-grid-major').trim().toLowerCase()]; })()`);
  assert.deepStrictEqual([s0.grid.minorColor, s0.grid.majorColor], tokens, 'the grid colours are the Design canvas grid tokens');
  await shot('desktop-lines.png');
  await setGridMode('off');
  const clip = await canvasClip();
  const corners = await pixels([{ x: clip.width - 6, y: 6 }, { x: clip.width - 6, y: clip.height - 6 }]);
  console.log('grid off, the view corners: ' + JSON.stringify(corners));
  assert.ok(corners.every((px) => near(px, hexRgb(paper), 1)), 'the cleared view is the paper colour on screen');
  await checkMarks('off', 'desktop');
  await shot('desktop-off.png');
  const msOff = await frameMs();

  // 2. lines / points
  await setGridMode('points'); await clickEl('#review-reset'); await sleep(300);
  await checkMarks('points', 'desktop');
  await shot('desktop-points.png');
  const msPoints = await frameMs();
  await setGridMode('lines'); await clickEl('#review-reset'); await sleep(300);
  await checkMarks('lines', 'desktop');
  const msLines = await frameMs();
  console.log(`frame time (desktop 1280 x 800, software WebGL, render + readPixels sync, 30 frames): grid off ${msOff} ms, lines ${msLines} ms, points ${msPoints} ms`);

  // 3. the spacing on screen, mm and inch
  await checkSpacing('desktop Top, mm');
  await shot('desktop-top-mm.png');
  await S(`(S.set('DOC_UNIT', 'in'), true)`); await sleep(300);
  const inch = await checkSpacing('desktop Top, inch');
  assert.ok(Math.abs(inch.g.base.minor - 2.54) < 1e-9 && Math.abs(inch.g.base.major - 25.4) < 1e-9, 'inch document: the inch grid (1 in heavy, tenths)');
  await shot('desktop-top-inch.png');
  await S(`(S.set('DOC_UNIT', 'mm'), true)`); await sleep(300);

  // 4. orbit + zoom keep the grid
  await clickEl('#review-reset'); await sleep(300);
  const c = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const cam0 = (await state()).camera;
  await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) { await mouse('mouseMoved', c.x - 15 * i, c.y - 3 * i, { button: 'left', buttons: 1 }); await sleep(25); }
  await mouse('mouseReleased', c.x - 120, c.y - 24, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
  for (let i = 0; i < 3; i++) { await mouse('mouseWheel', c.x, c.y, { deltaX: 0, deltaY: -120 }); await sleep(80); }
  await sleep(250);
  const s4 = await state();
  assert.ok(Math.hypot(...s4.camera.map((v, i) => v - cam0[i])) > 1, 'the camera moved (orbit + zoom)');
  await checkMarks('lines', 'desktop after orbit + zoom');
  await shot('desktop-orbit-zoom.png');

  // 5. a style template's grid tokens (set inline on #design-canvas by bindTemplateTokens) retint the 3D grid at once
  await clickEl('#review-reset'); await sleep(300);
  await S(`(() => { const keys = ${JSON.stringify(['LINE_STROKE', 'JOINT_RADIUS', 'JOINT_STROKE_MULT', 'SELECTION_FEEDBACK_MULT', 'HOVER_FEEDBACK_MULT', 'GLYPH_SYMBOL_SIZE_PX', 'GLYPH_INFERENCE_SIZE_PX', 'GLYPH_OFFSET_PX', 'GLYPH_OUTLINE_PX', 'DASH_LENGTH_PX', 'DASH_GAP_PX', 'DIM_LABEL_BOX', 'LABEL_FONT_FAMILY', 'PROFILE_FILL', 'LOCKED_LINE_COLOR'])};
    const settings = Object.fromEntries(keys.map((k) => [k, S.get(k)]));
    S.set('STYLE_PRESETS', { v: 1, presets: [{ id: 'user-754', name: 'Grid 754', settings, tokens: { '--sk-grid-minor': '#ff0000', '--sk-grid-major': '#0000ff' } }] }, { persist: false });
    S.set('STYLE_TEMPLATE', 'user-754', { persist: false }); return true; })()`);
  await sleep(250);
  const s5 = await state();
  const [p5] = await pixels([(await probe()).P]);
  console.log(`template tokens: 3D grid ${s5.grid.minorColor} / ${s5.grid.majorColor}, a heavy grid point on screen ${p5}`);
  assert.deepStrictEqual([s5.grid.minorColor, s5.grid.majorColor], ['#ff0000', '#0000ff'], 'the 3D grid follows the template tokens on the Design canvas');
  assert.ok(p5[2] > p5[0] + 40 && p5[2] > p5[1] + 40, 'the heavy grid point is drawn blue on screen');
  await S(`(S.set('STYLE_TEMPLATE', 'default', { persist: false }), S.set('STYLE_PRESETS', { v: 1, presets: [] }, { persist: false }), true)`);
  await sleep(250);
  assert.deepStrictEqual([(await state()).grid.minorColor, (await state()).grid.majorColor], tokens, 'back to the default template: the declared grid colours');

  // 6. Export 2D unchanged: its own background and info card
  await clickEl('#review-view-2d');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc *').length > 0`, 'the 2D view');
  const twoD = await evalJs(`(() => { const a = getComputedStyle(document.getElementById('review-2d')), b = getComputedStyle(document.getElementById('review-2d-info'));
    return { bg: a.backgroundColor, info: [b.color, b.backgroundColor, b.borderRadius, b.padding, b.fontSize, b.lineHeight], canvasHidden: document.getElementById('review-canvas-host').hidden }; })()`);
  console.log('2D view: ' + JSON.stringify(twoD));
  assert.deepStrictEqual(twoD, { bg: 'rgb(201, 206, 214)', info: ['rgb(230, 230, 230)', 'rgba(15, 19, 32, 0.85)', '6px', '5px 9px', '13px', '18.2px'], canvasHidden: true }, 'the 2D view keeps its grey canvas and its info card');
  await shot('desktop-2d.png');
  await clickEl('#review-view-3d');
  await waitFor(`!document.getElementById('review-canvas-host').hidden`, 'back on 3D');

  // PHONE 390 x 844, touch, reloaded on the Export step
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touchMode = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(reviewBuilt({ when: "!document.getElementById('view-review').hidden" }), 'phone: the Export step, 3D', 15000);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(realSolid)})`);
  await sleep(500);
  await clickEl('#review-reset'); await sleep(400);
  const ph = await state();
  assert.strictEqual(ph.background, paper, 'phone: the paper');
  await checkMarks('lines', 'phone');
  await shot('phone-lines.png', null);
  console.log(`frame time (phone 390 x 844 @2x, lines): ${await frameMs()} ms`);
  await clickEl('#review-reset'); await sleep(300);
  await setGridMode('points'); await sleep(200);
  await checkMarks('points', 'phone');
  await shot('phone-points.png', null);
  await setGridMode('lines');
  const pc = await evalJs(`(() => { const r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const pcam = (await state()).camera;
  await touch('touchStart', [[pc.x, pc.y]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[pc.x - 8 * i, pc.y]]); await sleep(30); }
  await touch('touchEnd', []); await sleep(300);
  assert.ok(Math.hypot(...(await state()).camera.map((v, i) => v - pcam[i])) > 1, 'phone: one finger orbits');
  await shot('phone-orbit.png', null);
  await checkMarks('lines', 'phone after a one-finger orbit');

  // APP MODE, DESKTOP: a seeded design (review-live.test.js's), the Design canvas's own drawn grid colours == the 3D grid's
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  touchMode = false;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'the Shaper app');
  await openStage('design');
  await waitForApp('design-canvas');
  await waitFor('!!(window.__designController && window.__designController.state)', 'the design controller');
  await evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const rect = (p, x, y, w, h) => { const n = [p+'a', p+'b', p+'c', p+'d']; [[0,0],[w,0],[w,h],[0,h]].forEach(([dx,dy], i) => st.joints.set(n[i], { x: x+dx, y: y+dy })); [0,1,2,3].forEach((i) => st.shapes.push({ id: p+'s'+i, type: 'line', joints: [n[i], n[(i+1)%4]] })); };
    rect('A', 0, 0, 120, 80); rect('B', 20, 20, 50, 40);
  })()`);
  await setGridMode('lines');
  await openStage('prepare');
  await waitFor(`document.querySelectorAll('#prepare-canvas .sk-edge').length >= 8`, 'Prepare shows the seeded geometry');
  await evalJs(`(async () => {
    const plan = await import('/tests/helpers/plan-v2.js');
    const { findLoops } = await import('#core/loop-finder.js');
    const { loopPolygon } = await import('#core/loop-geometry.js');
    const st = window.__designController.state;
    const loops = findLoops(st).map((l) => ({ ...l, polygon: loopPolygon(l, st, new Map(st.shapes.map((sh) => [sh.id, sh]))) }));
    const B = loops.find((l) => Math.abs(Math.min(...l.polygon.map((p) => p.x)) - 20) < 1e-6);
    plan.V2_PLAN.set(plan.keyOf('loop', B.id), { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 });
  })()`);
  await openStage('review');
  await waitFor(REVIEW_BUILT, 'app mode: the 3D build', 15000);
  await clickEl('#review-reset'); await sleep(300);
  const sa = await state();
  assert.strictEqual(sa.background, paper, 'app mode: the paper');
  await checkMarks('lines', 'app mode');
  await shot('app-lines.png');
  await checkSpacing('app mode Top, mm');
  const tab = await evalJs(`(() => { const t = document.querySelector('.sk-doctab.active'); if (!t) return null; const s = getComputedStyle(t); return { bg: s.backgroundColor, fg: s.color }; })()`);
  console.log('app mode, the active document tab on the Export step: ' + JSON.stringify(tab));
  assert.ok(tab && tab.bg === 'rgb(244, 239, 225)' && lum(tab.fg.match(/\d+/g).map(Number)) < 80, 'the active tab is the paper with a dark title');
  await shot('app-window.png', null);
  // the Design canvas draws its grid with the same two colours (its stylesheet resolves the same tokens)
  await openStage('design');
  await sleep(400);
  const drawn = await evalJs(`(() => { const a = document.querySelector('#design-canvas #grid path'), b = document.querySelector('#design-canvas #grid-heavy path'); return a && b ? [getComputedStyle(a).stroke, getComputedStyle(b).stroke] : null; })()`);
  console.log('the Design canvas grid strokes: ' + JSON.stringify(drawn) + ', the 3D grid: ' + JSON.stringify([sa.grid.minorColor, sa.grid.majorColor]));
  assert.deepStrictEqual(drawn, [sa.grid.minorColor, sa.grid.majorColor].map((h) => `rgb(${hexRgb(h).join(', ')})`), 'the Design canvas grid and the 3D grid: the same colours');
  await shot('app-design-canvas.png', '#design-canvas');
  console.log('review-grid-754-live: all checks passed');
} finally {
  await close();
}
