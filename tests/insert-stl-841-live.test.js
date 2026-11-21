// tests/insert-stl-841-live.test.js — TASK 841: INSERT STL in the real Shaper page (web mode), the STL built in the test (smallBlock below, from tests/helpers/stl-mesh.js lofted:
// a 40 x 30 x 12 block with a pocket; never an owner's file), inserted through the drawer's "Insert STL…" and the real file chooser (<input type=file>:
// Page.setInterceptFileChooserDialog + DOM.setFileInputFiles), real mouse clicks / touches:
//  DESKTOP 1280 x 800 and PHONE 390 x 844 (touch), each from an empty design (resetBufferLive):
//   a 100 x 60 plate drawn, made an Outside in Prepare (a click inside it, the type menu, OK); the drawer's Insert STL…: the notice "Inserted small.stl: a relief,
//   N levels"; the plate and its Outside untouched; ONE new Roughing holding the part, which lies clear of the plate; the stock unchanged; the STL card shows
//   small.stl; the 3D Review shows BOTH (its info line names the relief's Roughing and the plate's Outside; screenshots).
// No console error / page exception. Screenshots (.evidence/841/): desktop-1-prepare.png, desktop-2-review-top.png, desktop-3-review-angled.png,
// phone-1-prepare.png, phone-2-review.png.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import * as M from './helpers/stl-mesh.js';
// the Insert STL tests' part: a 40 x 30 x 12 block (z 0..12) with a 20 x 14 x 4 pocket at (8..28, 8..22), off centre (a turn shows); built here, never an owner's file
const smallBlock = () => M.lofted({
  outer: [{ z: 12, pts: M.rect(0, 0, 40, 30) }, { z: 0, pts: M.rect(0, 0, 40, 30) }],
  cavities: [{ rings: [{ z: 12, pts: M.rect(8, 8, 28, 22) }, { z: 8, pts: M.rect(8, 8, 28, 22) }] }],
});

const EVIDENCE_DIR = path.resolve('.evidence/841');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-841-'));
const SMALL = path.join(tmp, 'small.stl');
fs.writeFileSync(SMALL, M.binaryStl(smallBlock()));

const cdp = await launchBrowser({ tag: '841-insert', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const shot = async (name, sel = null) => {
  const clip = sel ? await evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.right) - Math.max(0, r.left), height: Math.min(innerHeight, r.bottom) - Math.max(0, r.top), scale: 1 }; })()`) : null;
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
const clickWorld = async (x, y) => {
  const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
    const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  await press(p.x, p.y);
};
const notice = () => evalJs(`document.getElementById('prepare-notice').textContent`);
// a toolbar button (TASK S3): in the bar, or (not in the bar: a phone) its row in its section's dropdown
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
const facts = () => evalJs(`Promise.all([import('/apps/shaper/src/operations-store.js'), import('/apps/shaper/src/selection-list.js'), import('/apps/shaper/src/stl-source.js'), import('/apps/shaper/src/stock.js'), import('/packages/core/geometry-bounds.js')])
  .then(([O, S, L, K, G]) => { const st = window.__designController.state; const sel = S.getSelections(); const e = sel.find((x) => x.kind === 'stl');
    const box = e ? G.computeGeometryBounds(Object.create(st, { shapes: { value: st.shapes.filter((s) => e.shapeIds.includes(s.id)) } })) : null;
    return { ops: O.storeOps().map((o) => ({ id: o.id, type: o.type, keys: o.geometry.map((r) => r.key) })), selections: sel.map((x) => x.kind), sources: L.getStlSources().map((s) => s.name), card: (L.getStlSource() || {}).name || null,
      stock: K.getStock().thickness, shapes: st.shapes.length, part: e ? { keys: e.cutKeys, box } : null, levels: e ? (O.regionOf(e.cutKeys[0]).levels || []).length : 0 }; })`);

async function phase(name) {
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitForApp('design-canvas'); await sleep(800);
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
  // the plate (drawn in Design: the page's own rectangle op), then an Outside on it in Prepare (a click inside, the type menu, OK)
  await evalJs(`import('/packages/core/tool-ops.js').then((m) => { const st = window.__designController.state; st.saveState('draw'); m.rect(st, 0, -60, 100, 0); window.__designController.engine.solve(500); })`);
  await openStage('prepare');
  // TASK S3: a click inside selects the plate; the toolbar's Outside = a new Outside of it, open; OK
  await clickWorld(80, -10); await sleep(200);
  await pressToolbar('op-type-exterior', 'operations');
  await waitFor(`!document.querySelector('#prepare-panel .cut-card').hidden && !!document.querySelector('#prepare-panel .cut-ok')`, name + ': the new Outside, open');
  await clickEl('#prepare-panel .cut-ok'); await sleep(300);
  const before = await facts();
  assert.deepStrictEqual(before.ops.map((o) => o.type), ['exterior'], name + ': the plate is an Outside');
  // TASK 841: the toolbar's FIRST section is INSERT (its STL button)
  const groups = await evalJs(`[...document.querySelectorAll('#prepare-ribbon .sk-ribbon-group')].map((g) => g.dataset.section + ':' + g.querySelector('.sk-ribbon-group-label').textContent)`);
  assert.deepStrictEqual(groups, ['insert:Insert', 'operations:Operations', 'recalculate:Recalculate', 'tools:Tools'], name + ': INSERT first in Prepare\'s toolbar (TASK 842: Tools last)');
  // Insert STL (desktop: the toolbar's INSERT > STL; phone: the drawer's Insert STL…, next to Open STL…), the chooser answered with small.stl
  await evalJs('delete window.showOpenFilePicker'); // the <input type=file> path (as on a phone): the chooser can be intercepted
  await send('DOM.getDocument', { depth: 0 });
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = once('Page.fileChooserOpened');
  if (touch) {
    await openDrawer(name);
    assert.strictEqual(await evalJs(`document.querySelector('[data-action="insert-stl"]').textContent.trim()`), 'Insert STL…', name + ': the entry');
    const order = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-action]')].map((e) => e.dataset.action).filter((a) => a.endsWith('-stl'))`);
    assert.deepStrictEqual(order, ['open-stl', 'insert-stl'], name + ': Insert STL next to Open STL');
    await clickEl('[data-action="insert-stl"]');
  } else {
    assert.strictEqual(await evalJs(`document.getElementById('prepare-insert-stl').textContent.trim()`), 'STL', name + ': the toolbar\'s INSERT > STL');
    await shot(`${name}-0-toolbar-insert.png`, '#prepare-ribbon-frame');
    await pressToolbar('prepare-insert-stl', 'insert');
  }
  const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
  assert.ok(ch, name + ': the file chooser opened');
  await send('DOM.setFileInputFiles', { files: [SMALL], backendNodeId: ch.backendNodeId });
  await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.startsWith('Inserted small.stl: a relief, ')`, name + ': the insert notice');
  await sleep(500);
  const after = await facts();
  assert.ok(/^Inserted small\.stl: a relief, \d+ levels$/.test(await notice()), name + ': the notice: ' + await notice());
  assert.deepStrictEqual(after.ops.filter((o) => o.id === before.ops[0].id), before.ops, name + ': the plate’s Outside untouched');
  assert.deepStrictEqual(after.ops.filter((o) => o.id !== before.ops[0].id).map((o) => [o.type, o.keys]), [['roughing', after.part.keys]], name + ': ONE new Roughing holding the part');
  assert.deepStrictEqual([after.selections, after.sources, after.card, after.stock], [['stl'], ['small.stl'], 'small.stl', before.stock], name + ': one part, its STL source and card, the stock unchanged');
  const b = after.part.box;
  assert.ok(b.minX >= 105 - 1e-6 || b.maxX <= -5 + 1e-6 || b.minY >= 5 - 1e-6 || b.maxY <= -65 + 1e-6, name + ': the part lies clear of the plate: ' + JSON.stringify(b));
  assert.ok(Math.abs(b.maxX - b.minX - 40) < 1e-6 && Math.abs(b.maxY - b.minY - 30) < 1e-6, name + ': the part is 40 x 30');
  console.log(`${name}: part at ${JSON.stringify(b)}, ${after.levels} levels, ops ${after.ops.map((o) => o.type).join(', ')}`);
  // the card: the inserted file (a phone folds it)
  await waitFor(`!document.querySelector('#prepare-panel .stl-card').hidden && document.querySelector('#prepare-panel .stl-card .stl-name').textContent === 'small.stl'`, name + ': the STL card shows small.stl');
  // both on the Prepare canvas: framed so both show
  await evalJs(`(() => { const v = window.__prepareView; const b = ${JSON.stringify(b)}; const x0 = Math.min(0, b.minX), x1 = Math.max(100, b.maxX), y0 = Math.min(-60, b.minY), y1 = Math.max(0, b.maxY);
    v.setView({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: (x1 - x0) * ${touch ? 1.6 : 2.6} }); })()`);
  await sleep(300);
  await shot(`${name}-1-prepare.png`, touch ? null : '#prepare-canvas');
  // the 3D Review: both parts
  const plateOnly = await evalJs(`import('/apps/shaper/src/cut-plan.js').then((m) => m.planEntries({ ticked: true }).length)`);
  assert.strictEqual(plateOnly, 2, name + ': two operations to show (the Outside, the Roughing)');
  await openStage('review');
  await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, name + ': the Review built', 60000);
  await sleep(800);
  const info = await evalJs(`document.getElementById('review-info').textContent`);
  console.log(`${name}: review ${JSON.stringify(info)}`);
  assert.ok(/Roughing: \d+ levels?/.test(info) && /Outside\/Inside cut/.test(info), `${name}: the Review shows both: the relief's Roughing and the plate's Outside (${JSON.stringify(info)})`);
  if (!touch) {
    await clickEl('#review-top'); await sleep(600);
    await shot(`${name}-2-review-top.png`, '#review-canvas-host');
    await clickEl('#review-reset'); await sleep(600);
    await shot(`${name}-3-review-angled.png`, '#review-canvas-host');
    // the part moved in Design (+20, +10: one undo step): out of date (TASK S3), the Review waits with Recalculate; Recalculate = the levels where the part is now
    const levelsAt = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((O) => O.regionOf(${JSON.stringify(after.part.keys[0])}).levels.flatMap((lv) => lv.loops.flatMap((f) => f)))`);
    const lv0 = await levelsAt();
    await openStage('design');
    await evalJs(`import('/apps/shaper/src/selection-list.js').then((S) => { const st = window.__designController.state, e = S.getSelections().find((x) => x.kind === 'stl'); st.saveState('move');
      for (const j of new Set(st.shapes.filter((s) => e.shapeIds.includes(s.id)).flatMap((s) => s.joints))) { const p = st.joints.get(j); p.x += 20; p.y += 10; } })`);
    assert.deepStrictEqual(await levelsAt(), lv0, name + ': right after the move: the levels as they were');
    await openStage('review');
    await waitFor(`/out of date/.test(document.getElementById('review-info').textContent) && !!document.querySelector('#review-info .sk-wait-action')`, name + ': the Review waits: out of date, with Recalculate', 30000);
    const line = await evalJs(`document.getElementById('review-info').textContent`);
    console.log(`${name}: after the move: ${JSON.stringify(line)}`);
    await shot(`${name}-4-review-out-of-date.png`, '#review-info');
    await clickEl('#review-info .sk-wait-action');
    await waitFor(`/Roughing: \\d+ levels?/.test(document.getElementById('review-info').textContent)`, name + ': Recalculate: the Review built again', 60000);
    const lv1 = await levelsAt();
    const worst = lv0.reduce((w, v, i) => Math.max(w, Math.abs(lv1[i] - v - (i % 2 ? 10 : 20))), 0);
    assert.ok(lv1.length === lv0.length && worst <= 2e-6, `${name}: Recalculate: every level point moved by exactly (+20, +10) (worst ${worst} mm)`);
    await sleep(600);
    await clickEl('#review-top'); await sleep(600);
    await shot(`${name}-5-review-moved-top.png`, '#review-canvas-host');
  } else {
    await clickEl('#review-top'); await sleep(600);
    await shot(`${name}-2-review.png`);
  }
}

try {
  await phase('desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  touch = true;
  await phase('phone');
  assert.deepStrictEqual(problems, [], 'no console error / page exception');
  console.log('insert-stl-841-live: ALL CHECKS PASSED');
} finally {
  await close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
