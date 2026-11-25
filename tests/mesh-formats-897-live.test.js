// tests/mesh-formats-897-live.test.js — TASK 897: OBJ and 3MF meshes in the real Shaper page (web mode), inserted through the real file chooser (<input type=file>:
// Page.setInterceptFileChooserDialog + DOM.setFileInputFiles) and real clicks / touches, like an STL (insert-stl-841-live):
//  DESKTOP 1280 x 800 and PHONE 390 x 844 (touch), each from an empty design (resetBufferLive):
//   Insert (desktop: the Prepare toolbar's INSERT > Mesh; phone: the drawer's Insert 3D mesh…) relief.obj (the synthetic relief of task 889, written as an OBJ
//   by tests/helpers/mesh-writers.js): the notice "Inserted relief.obj: a relief, N levels · ... tall: the stock is ..."; ONE Roughing holding the part and its levels; the card shows relief.obj,
//   OBJ; the OBJ / 3MF readers load only then (no mesh loader script before the first OBJ). Then cube.3mf (tests/fixtures/mesh-897/): a second part, a second
//   Roughing; the card shows cube.3mf, 3MF. The chooser offers .stl, .obj, .3mf.
// No console error / page exception. Screenshots (.evidence/897/): <phase>-1-card-obj.png, <phase>-2-card-3mf.png (the card), <phase>-3-prepare.png.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { objText } from './helpers/mesh-writers.js';
import { reliefTerrain } from './fixtures/relief-terrain-889.js';

const EVIDENCE_DIR = path.resolve('.evidence/897');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-897-'));
const OBJ = path.join(tmp, 'relief.obj');
fs.writeFileSync(OBJ, objText(reliefTerrain()));
const TMF = path.resolve('tests/fixtures/mesh-897/cube.3mf');

const cdp = await launchBrowser({ tag: '897-mesh', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
const scripts = []; // every script the page loaded (Network)
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
  if (m.method === 'Network.requestWillBeSent') scripts.push(m.params.request.url);
});
await send('Network.enable');
const shot = async (name, sel = null) => {
  const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.right) - Math.max(0, r.left), height: Math.min(innerHeight, r.bottom) - Math.max(0, r.top), scale: 2 }; })()`) : null;
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
  const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
  await press(p.x, p.y);
};
const notice = () => evalJs(`document.getElementById('prepare-notice').textContent`);
const pressToolbar = async (id, section) => {
  if (await evalJs(`!document.getElementById(${JSON.stringify(id)}).hidden`)) { await clickEl('#' + id); return; }
  await clickEl(`#prepare-ribbon .sk-ribbon-group[data-section="${section}"] button.sk-ribbon-group-label`);
  await clickEl(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="${id}"]`);
};
const openDrawer = async (what) => {
  await clickEl(touch ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
  await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, what + ': the drawer opens'); await sleep(300);
};
const openStage = async (id) => {
  if (touch) { await openDrawer('stage ' + id); await clickEl(`.sk-sidebar-stage[data-tab="${id}"]`); } else await clickEl(`.sk-header-tab[data-tab="${id}"]`);
  await waitFor(`!document.getElementById(${JSON.stringify(id === 'design' ? 'design-view' : `view-${id}`)}).hidden`, `the ${id} stage`);
  await sleep(300);
};
// the page's state, read through its own modules
const facts = () => evalJs(`Promise.all([import('/apps/shaper/src/operations-store.js'), import('/apps/shaper/src/selection-list.js'), import('/apps/shaper/src/stl-source.js')])
  .then(([O, S, L]) => ({ ops: O.storeOps().map((o) => ({ type: o.type, keys: o.geometry.map((r) => r.key) })), parts: S.getSelections().filter((x) => x.kind === 'stl').map((e) => ({ keys: e.cutKeys, levels: (O.regionOf(e.cutKeys[0]).levels || []).length })),
    sources: L.getStlSources().map((s) => [s.name, s.format || 'stl']) }))`);
const card = () => evalJs(`(() => { const c = document.querySelector('#prepare-panel .stl-card'); return c && !c.hidden ? { name: c.querySelector('.stl-name').textContent, format: c.querySelector('.stl-format').textContent } : null; })()`);
const loaderScripts = () => scripts.filter((u) => /mesh-loaders\.js|OBJLoader\.js|3MFLoader\.js|fflate\.module\.js/.test(u)).map((u) => u.replace(/^.*\//, ''));

// one insert through the chooser: the page's Insert (desktop: the toolbar; phone: the drawer), the chooser answered with `file`
async function insert(name, file) {
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = once('Page.fileChooserOpened');
  if (touch) {
    await openDrawer(name);
    assert.strictEqual(await evalJs(`document.querySelector('[data-action="insert-stl"]').textContent.trim()`), 'Insert 3D mesh…', name + ': the drawer entry');
    await clickEl('[data-action="insert-stl"]');
  } else {
    assert.strictEqual(await evalJs(`document.getElementById('prepare-insert-stl').textContent.trim()`), 'Mesh', name + ': the toolbar INSERT > Mesh');
    await pressToolbar('prepare-insert-stl', 'insert');
  }
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, name + ': the file chooser opened');
  const accept = await evalJs(`(() => { const i = [...document.querySelectorAll('input[type=file]')].pop(); return i ? i.accept : null; })()`);
  assert.strictEqual(accept, '.stl,.obj,.3mf,model/stl', name + ': the chooser offers STL, OBJ, 3MF');
  await send('DOM.setFileInputFiles', { files: [file], backendNodeId: ch.backendNodeId });
  const base = path.basename(file);
  await waitFor(`document.getElementById('prepare-notice').textContent.startsWith(${JSON.stringify(`Inserted ${base}: a relief, `)})`, `${name}: the notice for ${base}`, 30000);
  await sleep(500);
}

async function phase(name) {
  await resetBufferLive(cdp);
  scripts.length = 0;
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  await openStage('prepare');
  await evalJs('delete window.showOpenFilePicker'); // the <input type=file> path (as on a phone): the chooser can be intercepted
  assert.deepStrictEqual(loaderScripts(), [], name + ': no mesh loader loaded with the page');

  await insert(name, OBJ);
  // the relief is 23.5 mm tall, the default stock 19.05 mm: the insert says so (task 841), the stock unchanged
  assert.ok(/^Inserted relief\.obj: a relief, \d+ levels · relief\.obj is 23\.501 mm tall: the stock is 19\.05 mm$/.test(await notice()), name + ': the OBJ notice: ' + await notice());
  const a = await facts();
  assert.deepStrictEqual(a.ops.map((o) => [o.type, o.keys]), [['roughing', a.parts[0].keys]], name + ': ONE Roughing holding the OBJ relief');
  assert.ok(a.parts.length === 1 && a.parts[0].levels > 20, name + ': the relief part and its levels: ' + JSON.stringify(a.parts));
  assert.deepStrictEqual(a.sources, [['relief.obj', 'obj']], name + ': its source, format OBJ');
  assert.deepStrictEqual(loaderScripts().sort(), ['OBJLoader.js', 'mesh-loaders.js'], name + ': the OBJ reader loaded (only it): ' + JSON.stringify(loaderScripts()));
  await waitFor(`!document.querySelector('#prepare-panel .stl-card').hidden && document.querySelector('#prepare-panel .stl-card .stl-format').textContent === 'OBJ'`, name + ': the card shows OBJ');
  assert.deepStrictEqual(await card(), { name: 'relief.obj', format: 'OBJ' }, name + ': the card: relief.obj, OBJ');
  await shot(`${name}-1-card-obj.png`, '#prepare-panel .stl-card');

  await insert(name, TMF);
  assert.ok(/^Inserted cube\.3mf: a relief, \d+ levels$/.test(await notice()), name + ': the 3MF notice: ' + await notice());
  const b = await facts();
  assert.deepStrictEqual(b.ops.map((o) => o.type), ['roughing', 'roughing'], name + ': a second Roughing');
  assert.deepStrictEqual(b.ops.map((o) => JSON.stringify(o.keys)).sort(), b.parts.map((p) => JSON.stringify(p.keys)).sort(), name + ': ... each Roughing holds one part (the 3MF its own)');
  assert.deepStrictEqual(b.sources, [['relief.obj', 'obj'], ['cube.3mf', '3mf']], name + ': two sources, each with its format');
  assert.ok(loaderScripts().includes('3MFLoader.js') && loaderScripts().includes('fflate.module.js'), name + ': the 3MF reader loaded: ' + JSON.stringify(loaderScripts()));
  await waitFor(`document.querySelector('#prepare-panel .stl-card .stl-format').textContent === '3MF'`, name + ': the card shows 3MF');
  assert.deepStrictEqual(await card(), { name: 'cube.3mf', format: '3MF' }, name + ': the card: cube.3mf, 3MF');
  await shot(`${name}-2-card-3mf.png`, '#prepare-panel .stl-card');
  await evalJs(`window.__prepareView.setView({ x: 60, y: -40, w: ${touch ? 260 : 420} })`); // the relief (120 x 80 from the origin) and the cube placed beside it
  await sleep(300);
  await shot(`${name}-3-prepare.png`, touch ? null : '#prepare-canvas');
  console.log(`${name}: ${JSON.stringify(b)}; loaders ${JSON.stringify(loaderScripts())}`);
}

try {
  await phase('desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await phase('phone');
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('mesh-formats-897-live: ALL CHECKS PASSED');
} finally {
  await close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
