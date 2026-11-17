// tests/vcarve-removed-741-live.test.js — TASK 741: V-carve removed from Shaper, in the REAL page (headless Edge, software WebGL), desktop 1400 x 800 (mouse) and
// phone 390 x 844 (touch):
//   1. the step bar has 3 steps: Design, Prepare, Export (desktop: the header; phone: the drawer's stage row), and Prepare, Export in Fusion mode (?host=fusion);
//   2. an old design that had a V-carve region (geometry.vcarves) opens with no V-carve in the state, and Prepare shows the one-time notice (#prepare-notice);
//   3. a V-bit On Line cut (the V-bit cutter shape on the cut card) still previews with V walls in Export 3D: its groove is SHAPE_SLICES.vbit terraces deep.
// EVIDENCE_DIR set: cropped screenshots (stepbar-*, notice-*, vbit-3d-*).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js'; // saving is Google Drive only: an in-memory fake Drive (no real Google call)
import { findLoops } from '#core/loop-finder.js';
import { SHAPE_SLICES } from '#core/cutter-profile.js';

// the old design: a 60 x 40 rectangle whose loop was V-carved (a region picked in the removed Vcarve stage), and nothing in its cut plan
const joints = [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }]], shapes = [];
[[-30, -20], [30, -20], [30, 20], [-30, 20]].forEach(([x, y], i) => joints.push(['R' + i, { x, y, sketchId: 'sketch-1' }]));
for (let i = 0; i < 4; i++) shapes.push({ id: 'Rs' + i, type: 'line', joints: ['R' + i, 'R' + ((i + 1) % 4)], sketchId: 'sketch-1' });
const loopId = findLoops({ joints: new Map(joints), shapes, constraints: [] })[0].id;
const OLD_DOC = { version: 3, geometry: { joints, shapes, constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1', groups: [], profiles: [], parameters: [],
  vcarves: [{ id: 'vcarve-1', region: 'loop:' + loopId, vbit: { angle: 60 }, dStep: 0.5, maxDepth: 6 }] }, hosts: {} };
const NOTICE = 'This design had a V-carve region; V-carve was removed. Pick a cut type for it (V-bit cutter shape for a V-groove).';

await (async () => {
  const cdp = await launchBrowser({ tag: '741', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, ws } = cdp;
  await installFakeDriveSession(cdp);
  const problems = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  });
  const url = (q = '') => `http://127.0.0.1:${port}/apps/shaper/index.html${q}`;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const touch = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(300); };
  const mouse = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
  };
  let phone = false;
  const press = async (sel, what) => {
    const p = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; })()`);
    assert(p, what + ': ' + sel + ' not found');
    assert(p.hit, what + ': ' + sel + ' is covered at its centre ' + JSON.stringify(p));
    await (phone ? touch : mouse)(p.x, p.y);
  };
  const shot = async (name, sel, pad = 8) => {
    if (!process.env.EVIDENCE_DIR) return;
    const r = sel ? await evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`) : null;
    const clip = r ? { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale: phone ? 1 : 2 } : undefined;
    const s = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
  };
  const isPhone = () => evalJs(`getComputedStyle(document.querySelector('header.sk-header')).display === 'none'`);
  const stages = () => evalJs(`[...document.querySelectorAll(getComputedStyle(document.querySelector('header.sk-header')).display === 'none' ? '.sk-sidebar-stage' : '.sk-header-tab')].map((b) => [b.dataset.tab, b.textContent.trim()])`);
  const openMenu = async (what) => {
    await press(phone ? '.sk-sidebar-handle' : '.sk-sidebar-btn', what + ': the menu');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, what + ': the menu opens'); await sleep(300);
  };
  const closeMenu = async () => { await evalJs(`(() => { const b = document.querySelector('.sk-sidebar-backdrop'); if (b) b.click(); })()`); await sleep(300); };
  const openStage = async (id, what) => {
    if (phone) { await openMenu(what); await press(`.sk-sidebar-stage[data-tab="${id}"]`, what + ': ' + id); }
    else await press(`.sk-header-tab[data-tab="${id}"]`, what + ': ' + id);
    await waitFor(`(document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active')).dataset.tab === '${id}'`, what + ': ' + id + ' shows');
    if (phone) await closeMenu();
  };
  const fresh = async (q = '') => {
    await resetBufferLive(cdp);
    await evalJs(`localStorage.removeItem('shaper-mode'); localStorage.removeItem('shaper-review-view')`);
    await navigate(url(q), 15000);
    await waitFor(`!!document.querySelector('.sk-header-tab') || !!document.querySelector('.sk-sidebar-stage')`, 'shaper ready');
    await sleep(500);
  };

  const phase = async (label) => {
    // 1. the step bar
    await fresh();
    if (phone) await openMenu(label + ' step bar');
    const st = await stages();
    console.log(label + ' stages: ' + JSON.stringify(st));
    assert.deepStrictEqual(st, [['design', 'Design'], ['prepare', 'Prepare'], ['review', 'Export']], label + ': the step bar has 3 steps: Design, Prepare, Export');
    await shot(`stepbar-${label}.png`, phone ? '.sk-sidebar' : 'header.sk-header');
    if (phone) await closeMenu();
    await fresh('?host=fusion');
    if (phone) await openMenu(label + ' fusion step bar');
    const fst = await stages();
    console.log(label + ' fusion stages: ' + JSON.stringify(fst));
    assert.deepStrictEqual(fst, [['prepare', 'Prepare'], ['review', 'Export']], label + ': Fusion mode: Prepare, Export');
    await shot(`stepbar-fusion-${label}.png`, phone ? '.sk-sidebar' : 'header.sk-header');
    if (phone) await closeMenu();

    // 2. the old V-carve design opens with the notice (stored from the app page, as a user's earlier save; the next load restores it)
    await fresh();
    await evalJs(`import('/packages/ui/project-store.js').then(async (m) => { const store = m.getProjectStore(); const d = await store.newDesign('Old V-carve', { app: 'shaper' }); await store.save(${JSON.stringify(OLD_DOC)}, { app: 'shaper', id: d.id }); return d.id; })`);
    await evalJs(`localStorage.removeItem('shaper-mode'); localStorage.removeItem('shaper-review-view')`);
    await navigate(url(), 15000);
    await waitFor(`!!(window.__designController && window.__designController.state && window.__designController.state.shapes.length === 4)`, label + ': the old design is restored');
    assert.strictEqual(await evalJs(`'vcarves' in window.__designController.state`), false, label + ': no V-carve in the state');
    await openStage('prepare', label);
    await waitFor(`!document.getElementById('prepare-notice').hidden`, label + ': the Prepare notice shows');
    const notice = await evalJs(`document.getElementById('prepare-notice').textContent`);
    console.log(label + ' notice: ' + notice);
    assert.strictEqual(notice, NOTICE, label + ': the notice text');
    await shot(`notice-${label}.png`, '#prepare-notice', 24);
    const plan = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => [...m.CUT_PLAN.keys()])`);
    assert.deepStrictEqual(plan, [], label + ': the V-carved region is simply unassigned');

    // 3. a V-bit On Line cut on that loop previews with V walls in Export 3D
    await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => { m.CUT_PLAN.set('loop:${loopId}', { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: 6.35, cutterShape: 'vbit', cutterAngle: 60 }); })`);
    await openStage('review', label);
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the 3D board is built', 20000);
    const build = await evalJs(`import('/apps/shaper/src/main.js').then((m) => { const b = m.currentReviewView().lastBuild; return { levels: b.levels, triangles: b.triangles }; })`);
    console.log(label + ' V-bit groove build: ' + JSON.stringify(build));
    assert.strictEqual(build.levels, SHAPE_SLICES.vbit, label + ': the V-bit groove is ' + SHAPE_SLICES.vbit + ' terraces (its V walls), not one flat floor');
    await press('#review-top', label + ': Top'); await sleep(600); // render settle before the screenshot
    await shot(`vbit-3d-top-${label}.png`, '#review-canvas-host', 0);
    await press('#review-reset', label + ': Reset'); await sleep(600);
    await shot(`vbit-3d-${label}.png`, '#review-canvas-host', 0);
  };

  try {
    await send('Runtime.enable');
    await phase('desktop');
    phone = true;
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await fresh();
    assert.strictEqual(await isPhone(), true, 'the phone layout (no header bar)');
    await phase('phone390');
    assert.deepStrictEqual(problems, [], 'no page exception');
    console.log('vcarve-removed-741-live: ok');
  } finally {
    await cdp.close();
  }
})();
