// tests/review-look-729-live.test.js — TASK 729: the Export step's 3D LOOK and navigation in the real page, Fusion mode (Shaper ?host=fusion,
// window.adsk stubbed, the real Fusion solid tests/fixtures/real-solid-plate-711.json sent through window.fusionJavaScriptHandler as the add-in does):
// DESKTOP 1280 x 800
//  1. the Export step opens on 3D with the Look card: Material = Plywood (the default), no colour swatches; the photos load;
//  2. each look picked with REAL input (the Material select by keyboard, the swatches by click): Plywood, Solid colour (natural / red / blue),
//     MDF, Walnut, Acrylic (clear / white / black): the face and wall materials carry the look (map / colour / transparent / opacity /
//     roughness / metalness / edge glow == lookSpec), the SAME two materials, the SAME geometries and the same build (no rebuild), the same
//     camera -> one screenshot per look; the downloaded SVG is byte-identical to the Plywood one every time; the 2D view is unchanged;
//  3. a custom colour (the native colour input's value + its input event: a native picker dialog can't be driven) applies;
//  4. navigation: a left drag orbits (the target stays), a middle drag, a Shift + left drag and a right drag pan (the target moves),
//     the wheel zooms toward the cursor, Fit recentres the target;
//  5. reload: the look (and each look's colour) is remembered;
// PHONE 390 x 844 (mobile, touch), reloaded: the Look card on screen, no sideways scroll; a tap on a swatch swaps the material (no rebuild);
//  one finger orbits (the target stays), two fingers pan (the target moves).
// Screenshots + the downloaded files: .evidence/729/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { fileSourceTypesAndRemount } from './helpers/file-fusion-types-live.js'; // TASK 882: a Fusion selection makes no operation: the set-up files the hinted types

const EVIDENCE_DIR = path.resolve('.evidence/729');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const realSolid = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');

const cdp = await launchBrowser({ tag: '729-look', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-729-dl-'));

let touchMode = false;
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', clickCount: 0, ...extra });
const tap = async (x, y) => {
  if (touchMode) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] }); await sleep(40);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300); return;
  }
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(150);
};
// a real click / tap on the element's centre, after checking it is on screen and nothing covers it there
const clickEl = async (sel) => {
  await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`);
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }; })()`);
  assert.ok(p && p.onTop && p.inView, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
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
  return fs.readFileSync(file);
};
const shot = async (name, sel) => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
// the mounted 3D view's state, read through the app module (main.js currentReviewView: no window global) + the Look card's controls
const state = () => evalJs(`Promise.all([import('/apps/shaper/src/main.js'), import('/apps/shaper/src/review-view.js')]).then(([m, rv]) => {
  const v = m.currentReviewView(); const i = v.inspect();
  return { ...i, spec: rv.lookSpec(i.look), build: { triangles: v.lastBuild.triangles, ms: v.lastBuild.ms },
    select: document.getElementById('review-look-select').value, colorsShown: !document.getElementById('review-look-colors').hidden,
    pressed: [...document.querySelectorAll('#review-look-colors [aria-pressed="true"]')].map((b) => b.dataset.hex || b.id), stored: localStorage.getItem('shaper-review-look') }; })`);
// pick a Material with the keyboard (focus the select, arrow keys: a real key event changes a closed select and fires 'change')
const pickMaterial = async (id) => {
  const ids = await evalJs(`[...document.getElementById('review-look-select').options].map((o) => o.value)`);
  await evalJs(`document.getElementById('review-look-select').focus()`);
  for (let i = 0; i < 10; i++) {
    const cur = await evalJs(`document.getElementById('review-look-select').value`);
    if (cur === id) break;
    if (ids.indexOf(id) > ids.indexOf(cur)) await sendRealKey(send, 'ArrowDown', 'ArrowDown', 40); else await sendRealKey(send, 'ArrowUp', 'ArrowUp', 38);
    await sleep(120);
  }
  await waitFor(`document.getElementById('review-look-select').value === ${JSON.stringify(id)} && import('/apps/shaper/src/main.js').then((m) => m.currentReviewView().look.id === ${JSON.stringify(id)})`, 'Material ' + id);
};
// the materials as applied == the look's spec
const checkMaterials = (s, why) => {
  for (const name of ['face', 'edge']) {
    const m = s[name], part = s.spec[name];
    const map = part.image ? 'image' : part.paint ? 'painted' : null;
    assert.strictEqual(m.map, map, `${why}: the ${name} map`);
    assert.strictEqual(m.color, map ? 'ffffff' : s.spec.color.slice(1), `${why}: the ${name} colour`);
    assert.deepStrictEqual([m.transparent, m.opacity, m.roughness, m.metalness], [s.spec.transparent, s.spec.opacity, s.spec.roughness, s.spec.metalness], `${why}: the ${name} surface`);
    assert.strictEqual(m.emissive !== '000000', part.glow > 0, `${why}: the ${name} glow`);
  }
};
const centre = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const drag = async (from, d, button, buttons, modifiers = 0) => {
  await mouse('mouseMoved', from.x, from.y, { modifiers });
  await mouse('mousePressed', from.x, from.y, { button, buttons, clickCount: 1, modifiers });
  for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', from.x + (d.x * k) / 8, from.y + (d.y * k) / 8, { button, buttons, modifiers }); await sleep(25); }
  await mouse('mouseReleased', from.x + d.x, from.y + d.y, { button, buttons: 0, clickCount: 1, modifiers });
  await sleep(200);
};
const moved = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const noSideScroll = () => evalJs(`({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, vw: innerWidth })`);

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!!window.fusionJavaScriptHandler && !!document.getElementById('btn-fusion-add-selection') && !document.getElementById('view-prepare').hidden`, 'the Fusion Prepare bar');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(realSolid)})`);
  await fileSourceTypesAndRemount({ evalJs, waitFor }); // TASK 882: the import makes no operation: file the types Fusion hinted (what the old import did)
  await waitFor(`/8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the real solid imported (8 regions)');

  // 1. the Export step on 3D, the default look
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'the 3D build', 15000);
  await waitFor(`import('/apps/shaper/src/main.js').then((m) => { const i = m.currentReviewView().inspect(); return i.mapLoaded && i.edgeLoaded; })`, 'the plywood photos', 15000);
  await clickEl('#review-reset'); await sleep(300);
  const s0 = await state();
  console.log('first open: ' + JSON.stringify({ look: s0.look, select: s0.select, colorsShown: s0.colorsShown, stored: s0.stored, build: s0.build, meshes: s0.meshes.map((m) => m.name + ':' + m.material) }));
  assert.deepStrictEqual([s0.look.id, s0.select, s0.colorsShown, s0.stored], ['plywood', 'plywood', false, null], 'the default: Plywood, no swatches, nothing stored yet');
  assert.deepStrictEqual(await evalJs(`[...document.getElementById('review-look-select').options].map((o) => o.textContent)`), ['Plywood', 'Solid colour', 'MDF', 'Walnut', 'Acrylic'], 'the Material options (from LOOKS)');
  checkMaterials(s0, 'Plywood');
  const plyFile = await download();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'real-solid-plywood.svg'), plyFile);
  await clickEl('#review-view-2d');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc *').length > 0`, 'the 2D view');
  const twoD0 = await evalJs(`document.querySelector('#review-2d-canvas .rv2d-doc').outerHTML`);
  await clickEl('#review-view-3d');
  await waitFor(`!document.getElementById('review-canvas-host').hidden`, 'back on 3D');
  await sleep(300);
  await shot('desktop-plywood.png', '#review-canvas-host');

  // 2. every look, real input; same materials, same geometry, same build, same camera; export unchanged
  const geomIds = JSON.stringify(s0.meshes);
  const steps = [
    ['solid', '#eddabc', 'solid-natural'], ['solid', '#c0392b', 'solid-red'], ['solid', '#2f6fc4', 'solid-blue'],
    ['mdf', null, 'mdf'], ['walnut', null, 'walnut'],
    ['acrylic', '#d8eef2', 'acrylic-clear'], ['acrylic', '#f4f4f2', 'acrylic-white'], ['acrylic', '#1b1c1f', 'acrylic-black'],
  ];
  for (const [id, hex, name] of steps) {
    await pickMaterial(id);
    if (hex) await clickEl(`#review-look-colors button[data-hex="${hex}"]`);
    await sleep(300);
    const s = await state();
    console.log(`${name}: ${JSON.stringify({ look: s.look, face: s.face, edge: s.edge, pressed: s.pressed, build: s.build, textures: s.textures })}`);
    assert.strictEqual(s.look.id, id, name + ': the look');
    if (hex) assert.deepStrictEqual([s.look.colors[id], s.pressed[0]], [hex, hex], name + ': the colour picked, its swatch pressed');
    assert.strictEqual(s.colorsShown, !!hex, name + ': swatches only for a look that takes a colour');
    checkMaterials(s, name);
    assert.deepStrictEqual([s.face.uuid, s.edge.uuid], [s0.face.uuid, s0.edge.uuid], name + ': the same two materials');
    assert.strictEqual(JSON.stringify(s.meshes), geomIds, name + ': the same meshes and geometries (no rebuild)');
    assert.deepStrictEqual(s.build, s0.build, name + ': the same build (triangles, build time)');
    assert.deepStrictEqual([s.camera, s.target], [s0.camera, s0.target], name + ': the same camera');
    assert.strictEqual(JSON.parse(s.stored).id, id, name + ': stored');
    await shot(`desktop-${name}.png`, '#review-canvas-host');
    const file = await download();
    assert.ok(file.equals(plyFile), name + ': the downloaded SVG is byte-identical to the Plywood one');
  }
  console.log(`export: ${steps.length} downloads byte-identical to the Plywood one (${plyFile.length} bytes)`);
  await clickEl('#review-view-2d');
  await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc *').length > 0`, 'the 2D view again');
  assert.strictEqual(await evalJs(`document.querySelector('#review-2d-canvas .rv2d-doc').outerHTML`), twoD0, 'the 2D view is unchanged by the look');
  await clickEl('#review-view-3d');
  await waitFor(`!document.getElementById('review-canvas-host').hidden`, 'back on 3D');
  const sBack = await state();
  assert.strictEqual(JSON.stringify(sBack.meshes), geomIds, 'back on 3D: no rebuild');

  // 3. a custom colour on Solid colour (the colour input's value + its input event)
  await pickMaterial('solid');
  await evalJs(`(() => { const c = document.getElementById('review-look-custom'); c.value = '#3c8d5a'; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const sc = await state();
  console.log('custom colour: ' + JSON.stringify({ look: sc.look, face: sc.face.color, edge: sc.edge.color, pressed: sc.pressed }));
  assert.deepStrictEqual([sc.look.colors.solid, sc.face.color, sc.edge.color, sc.pressed], ['#3c8d5a', '3c8d5a', '3c8d5a', ['review-look-custom']], 'a custom colour on faces and walls, the picker marked');
  await pickMaterial('walnut'); // leave a solid-wood look for the reload check

  // 4. navigation
  const c = await centre('#review-canvas-host canvas');
  const n0 = await state();
  await drag(c, { x: -120, y: -40 }, 'left', 1);
  const n1 = await state();
  console.log(`left drag: target moved ${moved(n0.target, n1.target).toFixed(3)} mm, camera moved ${moved(n0.camera, n1.camera).toFixed(1)} mm`);
  // TASK 823: the drag starts on the board, so the orbit turns round the pressed point and the target turns with the camera (before: the target stayed);
  // it is still an orbit: the camera moves and its distance to the target is kept (a pan or a zoom would change one of them)
  assert.ok(moved(n0.camera, n1.camera) > 1, 'a left drag orbits: the camera moves');
  assert.ok(Math.abs(moved(n0.camera, n0.target) - moved(n1.camera, n1.target)) < 1e-6 * moved(n0.camera, n0.target) + 1e-6, 'a left drag orbits: the camera-target distance is kept');
  for (const [label, button, buttons, modifiers] of [['middle drag', 'middle', 4, 0], ['Shift + left drag', 'left', 1, 8], ['right drag', 'right', 2, 0]]) {
    const a = await state();
    await drag(c, { x: 80, y: 50 }, button, buttons, modifiers);
    const b = await state();
    console.log(`${label}: target moved ${moved(a.target, b.target).toFixed(2)} mm`);
    assert.ok(moved(a.target, b.target) > 1, label + ' pans: the target moves');
    assert.ok(Math.abs(moved(a.camera, a.target) - moved(b.camera, b.target)) < 1e-6 * moved(a.camera, a.target) + 1e-6, label + ': the distance stays (a pan, not a zoom)');
  }
  const w0 = await state();
  const off = { x: c.x + 150, y: c.y - 80 };
  await mouse('mouseMoved', off.x, off.y);
  for (let i = 0; i < 3; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: off.x, y: off.y, deltaX: 0, deltaY: -120 }); await sleep(80); }
  await sleep(200);
  const w1 = await state();
  console.log(`wheel at a corner: distance ${moved(w0.camera, w0.target).toFixed(1)} -> ${moved(w1.camera, w1.target).toFixed(1)} mm, target moved ${moved(w0.target, w1.target).toFixed(2)} mm`);
  assert.ok(moved(w1.camera, w1.target) < moved(w0.camera, w0.target), 'the wheel zooms in');
  assert.ok(moved(w0.target, w1.target) > 0.5, 'toward the cursor: the target follows the point under the cursor');
  await clickEl('#review-fit');
  const f = await state();
  console.log(`Fit: target ${JSON.stringify(f.target)} (first open ${JSON.stringify(s0.target)})`);
  assert.ok(moved(f.target, s0.target) < 1e-6, 'Fit recentres the target on the board');
  await clickEl('#review-reset'); await sleep(200);
  assert.deepStrictEqual((await state()).camera, s0.camera, 'Reset: the first view again');

  // 5. reload: remembered
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!document.getElementById('view-review').hidden && /triangles/.test(document.getElementById('review-info').textContent)`, 'the reloaded page on the Export step, 3D', 15000);
  const r = await state();
  console.log('reload: ' + JSON.stringify({ look: r.look, select: r.select, stored: r.stored }));
  assert.deepStrictEqual([r.look.id, r.select, r.look.colors.solid, r.look.colors.acrylic], ['walnut', 'walnut', '#3c8d5a', '#1b1c1f'], 'reload: the look and each look\'s colour are remembered');
  checkMaterials(r, 'reload');

  // PHONE 390 x 844
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touchMode = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitForApp('design-canvas');
  await waitFor(`!document.getElementById('view-review').hidden && /triangles/.test(document.getElementById('review-info').textContent)`, 'phone: the Export step, 3D', 15000);
  // (a page that reopens straight on the Export step builds the 3D view before the Fusion design is back, and only a first build frames the
  // camera: seen on this branch, the framing code is not touched by task 729; Reset frames the board for the screenshot)
  await clickEl('#review-reset'); await sleep(300);
  const p0 = await state();
  assert.strictEqual(p0.look.id, 'walnut', 'phone: the remembered look');
  await pickMaterial('acrylic');
  await clickEl('#review-look-colors button[data-hex="#d8eef2"]');
  await sleep(300);
  const p1 = await state();
  console.log('phone acrylic clear: ' + JSON.stringify({ look: p1.look, face: p1.face, edge: p1.edge }));
  checkMaterials(p1, 'phone acrylic clear');
  assert.strictEqual(p1.look.colors.acrylic, '#d8eef2', 'phone: the tapped swatch applies');
  assert.strictEqual(JSON.stringify(p1.meshes), JSON.stringify(p0.meshes), 'phone: no rebuild');
  const lk = await evalJs(`(() => { const box = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; }; return { select: box('#review-look-select'), colors: box('#review-look-colors'), card: box('#review-look') }; })()`);
  for (const k of Object.keys(lk)) assert.ok(lk[k].left >= 0 && lk[k].right <= 390, `phone: ${k} inside the screen width: ${JSON.stringify(lk[k])}`);
  const sc2 = await noSideScroll();
  assert.ok(sc2.doc <= 390 && sc2.body <= 390, 'phone: no sideways scroll: ' + JSON.stringify(sc2));
  await shot('phone-acrylic-clear.png', '#view-review');
  // touch: one finger orbits, two fingers pan
  await evalJs(`document.getElementById('review-stage').scrollIntoView({ block: 'nearest' })`);
  const pc = await centre('#review-canvas-host canvas');
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const t0 = await state();
  await T('touchStart', [pc]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: pc.x - 8 * i, y: pc.y - 3 * i }]); await sleep(30); }
  await T('touchEnd', []); await sleep(200);
  const t1 = await state();
  console.log(`phone one finger: target moved ${moved(t0.target, t1.target).toFixed(3)} mm, camera moved ${moved(t0.camera, t1.camera).toFixed(1)} mm`);
  // TASK 823: the finger lands on the board: the orbit turns round that point, the target turns with the camera (distance kept)
  assert.ok(moved(t0.camera, t1.camera) > 1 && Math.abs(moved(t0.camera, t0.target) - moved(t1.camera, t1.target)) < 1e-6 * moved(t0.camera, t0.target) + 1e-6, 'phone: one finger orbits (the camera moves, its distance to the target is kept)');
  await T('touchStart', [{ x: pc.x - 30, y: pc.y }, { x: pc.x + 30, y: pc.y }]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: pc.x - 30 + 8 * i, y: pc.y + 5 * i }, { x: pc.x + 30 + 8 * i, y: pc.y + 5 * i }]); await sleep(30); }
  await T('touchEnd', []); await sleep(200);
  const t2 = await state();
  console.log(`phone two fingers: target moved ${moved(t1.target, t2.target).toFixed(2)} mm`);
  assert.ok(moved(t1.target, t2.target) > 1, 'phone: two fingers pan (the target moves)');
  console.log('review-look-729-live.test.js: ok');
} finally {
  await close();
  fs.rmSync(dlDir, { recursive: true, force: true });
}
