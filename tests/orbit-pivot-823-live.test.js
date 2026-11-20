// tests/orbit-pivot-823-live.test.js — TASK 823: the 3D orbit turns round the point under the pointer, in the real Shaper page (software WebGL).
// For BOTH 3D views (the Export step's 3D Review, the STL Orient view), desktop 1280 x 800 (mouse) and phone 390 (one finger):
//  1. a press on the board (no move): the picture does not jump (a fixed scene point stays < 0.5 px), the pivot is a point of the drawn surface under
//     the pointer, and the dot shows;
//  2. three drag steps: the pressed point stays where it is drawn (drift < 2 px, in fact ~0) while a far point of the part moves a lot;
//  3. a press on empty background: no pivot, the target is kept (orbit round the model's centre as before);
//  4. the wheel at a drawn point zooms toward it: that point stays under the cursor (< 2 px) and the camera really came closer; (desktop)
//  5. Fit / Reset recentres on the model.
// Screenshots (.evidence/823/): the 4-frame sequence (press + 3 drags) with the pivot, and the same drags from a background press (the target-centred
// orbit it replaces): 1-pivot-*.png / 2-background-*.png (desktop Review), 3-orient-*.png, 4-phone-*.png.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import * as M from './helpers/stl-mesh.js';

const EVIDENCE_DIR = path.resolve('.evidence/823');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const realSolid = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-823-'));
const A = Math.PI / 6, cs = Math.cos(A), sn = Math.sin(A);
const turn = (x, y, z) => [x, y * cs - z * sn, y * sn + z * cs];
const block = M.lofted({ outer: [{ z: 10, pts: M.rect(0, 0, 60, 40) }, { z: 0, pts: M.rect(0, 0, 60, 40) }] });
const TILTED = path.join(tmp, 'tilted.stl');
fs.writeFileSync(TILTED, M.binaryStl(M.transformMesh(block, turn)));
const corners = []; for (const x of [0, 60]) for (const y of [0, 40]) for (const z of [0, 10]) corners.push(turn(x, y, z));
const lo = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a])));
const inView = (x, y, z) => turn(x, y, z).map((v, a) => v - lo[a]); // a block point in the Orient view's frame at first (turned, set on x 0 / y 0 / z 0)

const cdp = await launchBrowser({ tag: '823-orbit', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
let touchMode = false;
const shot = async (name, sel) => {
  const clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
  const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
  console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
};
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', clickCount: 0, ...extra });
const finger = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 1, radiusY: 1, force: 1 })) });
const press = async (x, y) => { // the orbit button / one finger down
  if (touchMode) { await finger('touchStart', [[x, y]]); return; }
  await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
};
const dragTo = async (x, y) => { if (touchMode) await finger('touchMove', [[x, y]]); else await mouse('mouseMoved', x, y, { button: 'left', buttons: 1 }); await sleep(250); };
const release = async (x, y) => { if (touchMode) await finger('touchEnd', []); else await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(200); };
const tap = async (x, y) => {
  if (touchMode) { await finger('touchStart', [[x, y]]); await sleep(40); await finger('touchEnd', []); await sleep(300); return; }
  await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 }); await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
};
const clickEl = async (sel) => {
  await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`);
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await tap(p.x, p.y);
};
const wheel = async (x, y, deltaY) => { await mouse('mouseMoved', x, y); await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, button: 'none' }); await sleep(300); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near3 = (a, b, tol, what) => assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) <= tol, `${what}: ${a} vs ${b}`);

// one view's driver: where a world point is drawn (page CSS px), the pivot / target / camera it reports
const reviewApi = {
  at: (p) => evalJs(`import('/apps/shaper/src/main.js').then((m) => { const v = m.currentReviewView(), s = v.screenOf(${JSON.stringify(p)}), r = document.querySelector('#review-canvas-host canvas').getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; })`),
  state: () => evalJs(`import('/apps/shaper/src/main.js').then((m) => { const i = m.currentReviewView().inspect(); return { pivot: i.pivot, target: i.target, camera: i.camera, box: i.box }; })`),
  canvas: '#review-canvas-host',
};
const orientApi = {
  at: (p) => evalJs(`import('/apps/shaper/src/orient-view.js').then((m) => m.currentOrientView().screenOf(${JSON.stringify(p)}))`),
  state: () => evalJs(`import('/apps/shaper/src/orient-view.js').then((m) => { const v = m.currentOrientView(); return { pivot: v.pivot() }; })`),
  canvas: '.orient-host',
};
// the procedure, on a view `api` with a point `on` of the drawn part's top face, a `far` point of the part, and a `sel` to capture; `tag` names the screenshots
async function orbitChecks(api, { on, far, tag, what, steps, wheelTo, sel }) {
  const c0 = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(api.canvas + ' canvas')}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  // 1. the press does not move the picture
  const p0 = await api.at(on), f0 = await api.at(far), keep = await api.at(far);
  const pos = Math.round(p0.x) + ',' + Math.round(p0.y);
  await press(Math.round(p0.x), Math.round(p0.y)); await sleep(300);
  let st = await api.state();
  assert.ok(st.pivot, `${what}: the press on the part set a pivot`);
  const kept = await api.at(far);
  assert.ok(dist(kept, keep) < 0.5, `${what}: the press does not move the picture (far point ${dist(kept, keep).toFixed(3)} px)`);
  const pv = await api.at(st.pivot);
  assert.ok(dist(pv, p0) < 12, `${what}: the pivot is drawn under the pointer (${dist(pv, p0).toFixed(1)} px from the press ${pos})`);
  await shot(`${tag}-pivot-0.png`, sel);
  // 2. three drag steps
  let x = Math.round(p0.x), y = Math.round(p0.y);
  const pivotScreen0 = pv, drifts = [], farMoves = [];
  for (let i = 0; i < steps.length; i++) {
    x += steps[i][0]; y += steps[i][1];
    await dragTo(x, y);
    const s2 = await api.state();
    near3(s2.pivot, st.pivot, 1e-6, `${what}: the pivot stays the same world point`);
    drifts.push(dist(await api.at(st.pivot), pivotScreen0));
    farMoves.push(dist(await api.at(far), f0));
    await shot(`${tag}-pivot-${i + 1}.png`, sel);
  }
  console.log(`${what}: pivot drift over the 3 drag steps ${drifts.map((d) => d.toFixed(3)).join(' / ')} px; the far point moved ${farMoves.map((d) => d.toFixed(0)).join(' / ')} px`);
  assert.ok(Math.max(...drifts) < 2, `${what}: the pressed point stays put on screen`);
  assert.ok(Math.max(...farMoves) > 30, `${what}: the rest turned round it`);
  await release(x, y);
  assert.strictEqual((await api.state()).pivot, null, `${what}: released: no pivot`);
  return { c0 };
}

async function backgroundPress(api, { tag, what, steps, sel }) {
  const c = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(api.canvas + ' canvas')}).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const bx = Math.round(c.x + c.w * 0.5), by = Math.round(c.y + 10); // the top edge: sky above the part
  const before = await api.state();
  await press(bx, by); await sleep(250);
  assert.strictEqual((await api.state()).pivot, null, `${what}: a press on empty background sets no pivot`);
  await shot(`${tag}-background-0.png`, sel);
  let x = bx, y = by;
  for (let i = 0; i < steps.length; i++) { x += steps[i][0]; y += steps[i][1]; await dragTo(x, y); await shot(`${tag}-background-${i + 1}.png`, sel); }
  const after = await api.state();
  if (before.target) near3(after.target, before.target, 1e-6, `${what}: the target is kept (the orbit is round the model's centre)`);
  assert.strictEqual(after.pivot, null, `${what}: still no pivot while dragging`);
  await release(x, y);
}

try {
  // ---------- 3D REVIEW, desktop ----------
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (new URLSearchParams(location.search).get('host') === 'fusion') window.adsk = { fusionSendData() { return '{}'; } };` });
  const openReview = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
    await waitForApp('design-canvas');
    await waitFor(`!!window.fusionJavaScriptHandler`, 'the Fusion handler'); await sleep(500); // (a phone reload opens on the Export step, as review-grid-754-live does)
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
    await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(realSolid)})`);
    await waitFor(`/8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the real solid imported');
    for (let i = 0; i < 5 && await evalJs(`document.getElementById('view-review').hidden`); i++) { await clickEl('.sk-header-tab[data-tab="review"]'); await sleep(300); }
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, 'the 3D build', 15000);
    await clickEl('#review-reset'); await sleep(400);
  };
  await resetBufferLive(cdp);
  await openReview();
  const box = (await reviewApi.state()).box;
  const topCorner = [box.maxX - 4, 0, box.maxZ - 4]; // near a corner of the board's top face (the relief may cut the very corner)
  const farPoint = [box.minX, 0, box.minZ];
  const steps = [[60, 25], [60, -30], [-110, 40]];
  console.log('desktop review: board', JSON.stringify(box));
  await orbitChecks(reviewApi, { on: topCorner, far: farPoint, tag: '1', what: 'desktop review', steps, sel: '#review-canvas-host' });
  // 3. background: the target is kept; the same drags show the target-centred orbit this replaces
  await clickEl('#review-reset'); await sleep(300);
  await backgroundPress(reviewApi, { tag: '2', what: 'desktop review', steps, sel: '#review-canvas-host' });
  // 4. the wheel zooms toward the cursor
  await clickEl('#review-reset'); await sleep(300);
  {
    const q = [box.maxX - 4, 0, box.maxZ - 4];
    const q0 = await reviewApi.at(q), cam0 = (await reviewApi.state()).camera;
    await wheel(Math.round(q0.x), Math.round(q0.y), -240);
    const q1 = await reviewApi.at(q), cam1 = (await reviewApi.state()).camera, tgt = (await reviewApi.state()).target;
    const d0 = Math.hypot(...cam0.map((v, i) => v - tgt[i]));
    console.log(`wheel at a corner: it moved ${dist(q0, q1).toFixed(2)} px; the camera moved ${Math.hypot(...cam1.map((v, i) => v - cam0[i])).toFixed(1)} mm (distance to the target was ${d0.toFixed(0)})`);
    assert.ok(Math.hypot(...cam1.map((v, i) => v - cam0[i])) > 5, 'the wheel zoomed');
    assert.ok(dist(q0, q1) < 2, 'the point under the cursor stays under it');
    // an orbit after the zoom still holds its pressed point
    const p = await reviewApi.at(q);
    await press(Math.round(p.x), Math.round(p.y)); await sleep(250);
    const st = await reviewApi.state(); assert.ok(st.pivot, 'a press after the zoom picks a pivot');
    const a = await reviewApi.at(st.pivot); await dragTo(Math.round(p.x) + 80, Math.round(p.y) + 20); const b = await reviewApi.at(st.pivot);
    assert.ok(dist(a, b) < 2, 'after the wheel an orbit still turns round its pressed point: ' + dist(a, b).toFixed(3));
    await release(Math.round(p.x) + 80, Math.round(p.y) + 20);
  }
  // 5. Fit recentres on the model
  {
    await clickEl('#review-reset'); await sleep(300);
    const s = await reviewApi.state(), cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
    near3([s.target[0], s.target[2]], [cx, cz], 0.01, 'Reset: the target is the model centre again');
  }

  // ---------- 3D REVIEW, phone 390 ----------
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touchMode = true;
  await openReview();
  await orbitChecks(reviewApi, { on: topCorner, far: farPoint, tag: '4-phone', what: 'phone review', steps: [[30, 12], [30, -15], [-55, 20]], sel: '#review-canvas-host' });
  await clickEl('#review-reset'); await sleep(300);
  await backgroundPress(reviewApi, { tag: '4-phone', what: 'phone review', steps: [[30, 12], [30, -15], [-55, 20]], sel: '#review-canvas-host' });

  // ---------- STL ORIENT, phone then desktop ----------
  const openOrient = async () => {
    await evalJs('delete window.showOpenFilePicker');
    await send('DOM.getDocument', { depth: 0 });
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    await clickEl(touchMode ? '.sk-sidebar-handle' : '.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
    const chooser = once('Page.fileChooserOpened');
    await clickEl('[data-action="open-stl"]');
    const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
    assert.ok(ch, 'the file chooser opened');
    await send('DOM.setFileInputFiles', { files: [TILTED], backendNodeId: ch.backendNodeId });
    await waitFor(`!document.getElementById('view-prepare').hidden && /: a relief, /.test(document.getElementById('prepare-notice').textContent)`, 'the import notice');
    await sleep(400);
    if (await evalJs(`(() => { const c = document.querySelector('#prepare-panel .stl-card'); return !(c && !c.querySelector('.stl-body').hidden); })()`)) await clickEl('#prepare-panel .stl-head');
    await waitFor(`!document.querySelector('#prepare-panel .stl-card .stl-body').hidden`, 'the card is open');
    await clickEl('#prepare-panel .stl-orient');
    await waitFor(`!!document.querySelector('.orient-view .orient-host canvas')`, 'the Orient view');
    await sleep(600);
  };
  const orientChecks = (steps, tag, what) => orbitChecks(orientApi, { on: inView(15, 10, 10), far: inView(60, 40, 0), tag, what, steps, sel: '.orient-view' });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openOrient();
  await orientChecks([[30, 12], [30, -15], [-55, 20]], '5-phone-orient', 'phone orient');
  await backgroundPress(orientApi, { tag: '5-phone-orient', what: 'phone orient', steps: [[30, 12], [30, -15], [-55, 20]], sel: '.orient-view' });
  await clickEl('.orient-cancel'); await waitFor(`!document.querySelector('.orient-view')`, 'Cancel closes');

  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  touchMode = false;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openOrient();
  await orientChecks(steps, '3-orient', 'desktop orient');
  await backgroundPress(orientApi, { tag: '3-orient', what: 'desktop orient', steps, sel: '.orient-view' });
  // a click (no drag) still picks the floor face in the Orient view: the pivot code did not take the press away
  {
    const at = await orientApi.at(inView(30, 20, 10));
    await tap(Math.round(at.x), Math.round(at.y));
    const o = await evalJs(`import('/apps/shaper/src/orient-view.js').then((m) => m.currentOrientView().orientation())`);
    assert.ok(o.floor && Math.abs(o.floor[1] + sn) < 1e-3 && Math.abs(o.floor[2] - cs) < 1e-3, 'a click still picks the big face as the floor: ' + JSON.stringify(o.floor));
  }
  await clickEl('.orient-cancel');
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('orbit-pivot-823-live.test.js: ok');
} finally {
  await close();
}
