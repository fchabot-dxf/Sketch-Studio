// tests/stl-orient-808-live.test.js — TASK 808: ORIENT an STL by clicking its floor face, in the real Shaper page.
// A 60 x 40 x 10 block turned 30 degrees about X (built in the test, tests/helpers/stl-mesh.js) is opened (its card shows the tilted size). Orient opens the
// 3D view of the raw mesh; a real click (desktop) / tap (phone 390) on the block's big face makes it the floor; Done re-imports: the size is the un-turned
// block's (60 x 40 x 10 mm) within the grid tolerance, no Up preset is active (a clicked face is no preset); Undo restores the tilted size;
// Cancel leaves it as it was; an Up preset after it sets the same one orientation. Screenshots (.evidence/808/): 1-desktop-orient.png (the view after
// the pick), 2-desktop-done-card.png, 3-phone-orient.png.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import * as M from './helpers/stl-mesh.js';

const EVIDENCE_DIR = path.resolve('.evidence/808');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-808-'));
const A = Math.PI / 6, cs = Math.cos(A), sn = Math.sin(A);
const turn = (x, y, z) => [x, y * cs - z * sn, y * sn + z * cs]; // 30 degrees about X
const block = M.lofted({ outer: [{ z: 10, pts: M.rect(0, 0, 60, 40) }, { z: 0, pts: M.rect(0, 0, 60, 40) }] });
const TILTED = path.join(tmp, 'tilted.stl');
fs.writeFileSync(TILTED, M.binaryStl(M.transformMesh(block, turn)));
// where the block's top face centre is in the Orient view's frame at first: turned, then set on x 0 / y 0 / z 0
const corners = []; for (const x of [0, 60]) for (const y of [0, 40]) for (const z of [0, 10]) corners.push(turn(x, y, z));
const lo = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a])));
const topCentre = turn(30, 20, 10).map((v, a) => v - lo[a]);

const cdp = await launchBrowser({ tag: '808-orient', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const shot = async (name, sel = null) => {
  let clip = null;
  if (sel) clip = await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 1 }; })()`);
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
  await sleep(200);
};
const clickEl = async (sel) => {
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const cardSize = () => evalJs(`(() => { const c = document.querySelector('#prepare-panel .stl-card'); return c && !c.querySelector('.stl-body').hidden ? c.querySelector('.stl-size').textContent : null; })()`);
const dims = (s) => s.replace(/ mm$/, '').split(' × ').map(Number);
const near = (got, want, tol, what) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) <= tol, `${what}: ${got} vs ${want}`));
const openStl = async (stl) => {
  await evalJs('delete window.showOpenFilePicker');
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await clickEl(touch ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
  const chooser = once('Page.fileChooserOpened');
  await clickEl('[data-action="open-stl"]');
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, 'the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [stl], backendNodeId: ch.backendNodeId });
  await waitFor(`!document.getElementById('view-prepare').hidden && /: a relief, /.test(document.getElementById('prepare-notice').textContent)`, 'the import notice');
  await sleep(400);
};
const openCard = async () => {
  if (await cardSize() === null) await clickEl('#prepare-panel .stl-head');
  await waitFor(`!document.querySelector('#prepare-panel .stl-card .stl-body').hidden`, 'the card is open');
};
const orientAndPick = async (what, shotName) => {
  await clickEl('#prepare-panel .stl-orient');
  await waitFor(`!!document.querySelector('.orient-view .orient-host canvas')`, what + ': the Orient view');
  await sleep(500);
  const at = await evalJs(`import('/apps/shaper/src/orient-view.js').then((m) => m.currentOrientView().screenOf(${JSON.stringify(topCentre)}))`);
  await press(Math.round(at.x), Math.round(at.y));
  const o = await evalJs(`import('/apps/shaper/src/orient-view.js').then((m) => m.currentOrientView().orientation())`);
  assert.ok(o.floor && Math.abs(o.floor[1] + sn) < 1e-3 && Math.abs(o.floor[2] - cs) < 1e-3, what + ': the picked normal is the big face\'s: ' + JSON.stringify(o.floor));
  assert.strictEqual(o.up, null, what + ': a tilted floor is no Up preset');
  near([o.size.x, o.size.y, o.size.z], [60, 40, 10], 0.01, what + ': the view shows the part on its floor');
  await shot(shotName, '.orient-view');
};
const doneReimports = async (what) => {
  await clickEl('.orient-done');
  await waitFor(`!document.querySelector('.orient-view') && /^Replaced with tilted\\.stl/.test(document.getElementById('prepare-notice').textContent)`, what + ': Done re-imports');
  await sleep(400);
};

try {
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(600);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);

  // DESKTOP
  await openStl(TILTED);
  await openCard();
  const before = await cardSize();
  near(dims(before), [60, 40 * cs + 10 * sn, 40 * sn + 10 * cs], 0.6, 'opened tilted: ' + before);
  await orientAndPick('desktop', '1-desktop-orient.png');
  await doneReimports('desktop');
  await openCard();
  near(dims(await cardSize()), [60, 40, 10], 0.6, 'desktop: Done: the un-turned block');
  assert.strictEqual(await evalJs(`document.querySelector('.stl-ups .is-active')`), null, 'desktop: no Up preset is active for a clicked face');
  await shot('2-desktop-done-card.png', '#prepare-panel .stl-card');
  await clickEl('#btn-undo');
  await waitFor(`document.querySelector('.stl-size') && document.querySelector('.stl-size').textContent === ${JSON.stringify(before)}`, 'desktop: Undo restores the tilted size');
  // Cancel leaves it as it was
  await clickEl('#prepare-panel .stl-orient');
  await waitFor(`!!document.querySelector('.orient-view')`, 'desktop: the view again');
  await clickEl('.orient-cancel');
  await waitFor(`!document.querySelector('.orient-view')`, 'desktop: Cancel closes');
  assert.strictEqual(await cardSize(), before, 'desktop: Cancel leaves the size as it was');
  // a preset after a clicked face: ONE orientation, two ways to set it
  await clickEl('.stl-ups .cut-preset[data-value="+Y"]');
  await waitFor(`document.querySelector('.stl-ups .is-active') && document.querySelector('.stl-ups .is-active').textContent === '+Y'`, 'desktop: +Y preset');

  // PHONE 390 (tap = pick)
  await resetBufferLive(cdp);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000); await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStl(TILTED);
  await openCard();
  await orientAndPick('phone', '3-phone-orient.png');
  await doneReimports('phone');
  await openCard();
  near(dims(await cardSize()), [60, 40, 10], 0.6, 'phone: Done: the un-turned block');
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('stl-orient-808-live.test.js: ok');
} finally {
  await close();
}
