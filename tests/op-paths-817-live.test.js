// tests/op-paths-817-live.test.js — TASK 817 (owner turns 2745-2748: "In fusion a toolpath generate is on ok and allow to work still, spin wheel on item only" / "i guess we
// can adjust lead in only before and show path on ok" / the Preview button in the op edit panel) in the real Shaper page, desktop 1280 x 800 (mouse) and phone 390 x 844
// (touch), on a synthetic relief the size of the owner's rose (a petal dome: 40 rings of 720 points, built in the test; the owner's STL is never used here):
//  1. the Roughing OPEN: the canvas shows its shapes and its paths as opened, FAINT; no new path; a change asks for no generation;
//  2. PREVIEW: in the card's action bar (Preview, Cancel, OK; 44 px on a phone): pressed, it spins while the worker generates (the bar does not move: 805 probe 0 px),
//     then draws the paths of the card's settings; a later change: faded, "Preview" again;
//  3. OK: the row spins (only that row; the 805 probe: nothing moves when the spinner appears), the page stays usable: a click on the canvas and a pan / pinch while it
//     generates (their input delay measured in the page), the main thread's LONG TASKS during the generation (none over 100 ms; the numbers printed); the paths appear;
//  4. an On line, open: its paths as opened faint, no new path; a change asks for no generation. (TASK 836: the lead-in, and its handle checked here, are gone. The
//     open operation's TAB handles are checked in tests/op-paths-817-node.test.js case 4: this relief's outline, 720 short segments, takes no tab: refused, no handle.)
// TASK S3: the On line is made with Prepare's operations toolbar (the card's type menu only changes an open operation).
// No console error, no page exception. Screenshots .evidence/817/ (the spinning row zoomed, the Preview button spinning, the open session).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { probe } from './helpers/tooltip-live.js';
import { openOpLive, typeLive } from './helpers/prepare-open-live.js';
import * as M from './helpers/stl-mesh.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/817');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-817-'));
const STL = path.join(tmp, 'petal.stl');
{ // the petal dome: rings shrink and wave as they rise (a rose-like relief: each level's outline a few hundred points)
  const outer = [], N = 40, P = 720;
  for (let i = 1; i <= N; i++) { const a = (Math.PI / 2) * (i / N), r = 60 * Math.sin(a); outer.push({ z: 4 + 30 * Math.cos(a), pts: Array.from({ length: P }, (_, k) => { const t = (2 * Math.PI * k) / P, rr = r * (1 + 0.18 * Math.sin(6 * t + i * 0.35) + 0.06 * Math.sin(17 * t)); return [80 + rr * Math.cos(t), 80 + rr * Math.sin(t)]; }) }); }
  outer.push({ z: 0, pts: Array.from({ length: P }, (_, k) => { const t = (2 * Math.PI * k) / P; return [80 + 75 * Math.cos(t), 80 + 75 * Math.sin(t)]; }) });
  fs.writeFileSync(STL, M.binaryStl(M.lofted({ outer, apex: [80, 80, 34] })));
}

const cdp = await launchBrowser({ tag: '817-paths', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, once, ws, evalJs, waitFor, navigate, close } = cdp;
const problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + JSON.stringify(m.params.exceptionDetails).slice(0, 400));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + JSON.stringify(m.params.args.map((a) => a.value ?? a.description)).slice(0, 400));
});
const results = {};
try {
  let phone = false, D = 'desktop';
  const shot = async (name, sels, scale = 2) => {
    const clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q)).filter((e) => e && e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 6), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 6);
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 6) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 6) - y, scale: ${scale} }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-${name}`), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, `${D}-${name}`));
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const press = async (x, y) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y); }
    await sleep(200);
  };
  const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => { const p = await boxOf(sel); assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`); await press(p.x, p.y); return p; };
  const typeField = async (cls, v) => { await evalJs(`(() => { const i = document.querySelector('${cls}'); i.value = '${v}'; i.dispatchEvent(new Event('change')); })()`); await sleep(150); };
  const t = { get phone() { return phone; }, evalJs, send, waitFor, clickEl };
  const generating = () => evalJs(`import('/apps/shaper/src/op-paths.js').then((m) => m.generatingCount())`);
  const faint = () => evalJs(`document.querySelectorAll('#prepare-canvas .sk-faint').length`);
  const solid = () => evalJs(`[...document.querySelectorAll('#prepare-toolpath-group path, #prepare-cut-group path')].filter((p) => !p.closest('.sk-faint')).length`);
  const opIdOf = (type) => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => (m.storeOps().find((o) => o.type === '${type}') || {}).id)`);
  const rowSel = (id) => `#prepare-ops .ops-row[data-id="${id}"]`;
  const spinningRows = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row.is-generating')].filter((r) => r.querySelector('.ops-spin')).map((r) => r.dataset.id)`);
  const listOpen = async (open) => { if (await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`) === open) { await clickEl('#prepare-ops .ops-head'); await sleep(300); } };
  const outside = () => evalJs(`(() => { const out = {}; for (const sel of ['#prepare-canvas', '#prepare-ops .ops-head', '#btn-undo', '#btn-redo', '.sk-header', '.sk-sidebar-chevron']) { const e = document.querySelector(sel); if (!e) continue; const b = e.getBoundingClientRect(); out[sel] = [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 100) / 100).join(','); } return out; })()`);
  const barBoxes = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-actions button')].map((b) => { const r = b.getBoundingClientRect(); return [b.className, [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(',')]; })`);

  const openStl = async () => {
    await evalJs('delete window.showOpenFilePicker');
    await send('DOM.getDocument', { depth: 0 });
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    await clickEl(phone ? '.sk-sidebar-chevron' : '.sk-sidebar-btn');
    await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, D + ': the drawer opens'); await sleep(300);
    const chooser = once('Page.fileChooserOpened');
    await clickEl('[data-action="open-stl"]');
    const ch = await Promise.race([chooser, sleep(5000).then(() => null)]);
    assert.ok(ch, D + ': the file chooser opened');
    await send('DOM.setFileInputFiles', { files: [STL], backendNodeId: ch.backendNodeId });
    await waitFor(`!document.getElementById('view-prepare').hidden && document.getElementById('prepare-notice').textContent.includes(': a relief, ')`, D + ': the import notice', 120000);
  };

  const phase = async () => {
    const R = results[D] = {};
    await openStl();
    await waitFor(`import('/apps/shaper/src/op-paths.js').then((m) => m.generatingCount() === 0)`, D + ': the imported Roughing generated', 120000);
    const rough = await opIdOf('roughing');
    assert.ok(rough, D + ': the import made a Roughing');
    await listOpen(true);
    await sleep(300);
    // ── 1. open: its shapes, its paths as opened FAINT, no new path; a change asks for nothing ──
    await openOpLive(t, rough);
    await listOpen(false);
    assert.ok(await faint() > 0, D + ': open: its paths as opened are drawn faint');
    assert.strictEqual(await solid(), 0, D + ': open: no other (new) path is drawn');
    assert.ok(await evalJs(`document.getElementById('prepare-select-group').innerHTML.includes('sk-hl-select')`), D + ': open: its shape is highlighted');
    await shot('1-open-faint.png', ['#prepare-canvas'], 1);
    await typeField('.cut-step-depth', '0.75');
    assert.strictEqual(await generating(), 0, D + ': a change while open asks for no generation (its paths wait for OK)');
    // ── 2. Preview: in the action bar; spins (the bar does not move), then draws; a later change fades it ──
    const bar = await barBoxes();
    assert.deepStrictEqual(bar.map(([c]) => c), ['cut-preview', 'cut-cancel', 'cut-ok'], D + ': the action bar: Preview, then Cancel, OK');
    if (phone) assert.ok(bar.every(([, b]) => Number(b.split(',')[3]) >= 44), D + ': 44 px buttons on a phone: ' + JSON.stringify(bar));
    await clickEl('#prepare-panel .cut-preview');
    const busy = await evalJs(`document.querySelector('#prepare-panel .cut-preview').dataset.state`);
    assert.strictEqual(busy, 'busy', D + ': Preview pressed: generating (busy)');
    assert.ok(await evalJs(`!!document.querySelector('#prepare-panel .cut-preview .cut-spin')`), D + ': the Preview button spins');
    await shot('2-preview-busy.png', ['#prepare-panel .cut-actions'], 3);
    assert.deepStrictEqual(await barBoxes(), bar, D + ': 805 probe: the action bar did not move when the Preview spinner showed (0 px)');
    await waitFor(`document.querySelector('#prepare-panel .cut-preview').dataset.state === 'fresh'`, D + ': the preview generated', 120000);
    assert.ok(await solid() > 0, D + ': the preview is drawn (the card\'s settings now)');
    assert.deepStrictEqual(await barBoxes(), bar, D + ': the bar still in place (fresh)');
    await typeField('.cut-step-depth', '0.4');
    assert.deepStrictEqual([await evalJs(`document.querySelector('#prepare-panel .cut-preview').dataset.state`), await evalJs(`document.querySelector('#prepare-panel .cut-preview').textContent`), await solid(), (await faint()) > 0], ['stale', 'Preview', 0, true], D + ': a later change: the preview faded (stale), the button "Preview" again');
    // ── 3. OK: the row spins, the page stays usable, the long tasks, the paths appear ──
    await evalJs(`(() => { window.__lt = []; window.__inp = []; if (!window.__ltObs) { window.__ltObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }); window.__ltObs.observe({ type: 'longtask' });
      for (const ty of ['pointerdown', 'wheel', 'touchstart', 'click']) document.addEventListener(ty, (e) => window.__inp.push([ty, Math.round(performance.now() - e.timeStamp)]), { capture: true, passive: true }); } })()`);
    // desktop: the list open beside the card (the row in view when OK is pressed); a phone: the open card covers the list sheet, so the sheet is opened after OK
    if (!phone) await listOpen(true);
    // (a free point of the canvas: nothing else over it, no shape under it, room for the pan below it)
    const c = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'), r = svg.getBoundingClientRect();
      for (let y = r.top + 40; y < r.bottom - 140; y += 20) for (let x = r.left + 20; x < r.right - 220; x += 20) { const ok = [[0, 0], [0, 40], [0, 100], [60, 100], [200, 200]].every(([dx, dy]) => { const h = document.elementFromPoint(x + dx, y + dy); return h === svg; }); if (ok) return { x: Math.round(x), y: Math.round(y) }; }
      return null; })()`);
    assert.ok(c, D + ': a free point of the canvas');
    const okAt = await evalJs('performance.now()');
    await clickEl('#prepare-panel .cut-ok');
    const snapA = phone ? null : await probe(t).snap(); // (before the spinner: it shows after 150 ms)
    if (phone) await listOpen(true);
    // the page stays usable while it generates: at once after OK, a click on empty canvas and a pan (wheel on a desktop, a two-finger pan on a phone)
    await press(c.x, c.y);
    if (phone) { await T('touchStart', [{ x: c.x, y: c.y + 40 }, { x: c.x, y: c.y + 100 }]); for (let k = 1; k <= 6; k++) { await T('touchMove', [{ x: c.x + k * 10, y: c.y + 40 }, { x: c.x + k * 10, y: c.y + 100 }]); await sleep(16); } await T('touchEnd', []); }
    else for (let k = 0; k < 3; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x + 200, y: c.y + 200, deltaX: 0, deltaY: k % 2 ? -80 : 80 }); await sleep(60); }
    const stillGenerating = await generating();
    if (phone) await listOpen(true); // (a tap on the canvas folds the phone's sheet)
    const ref = await outside();
    await waitFor(`!!document.querySelector('${rowSel(rough)}.is-generating .ops-spin')`, D + ': the row spins', 5000);
    const spinAt = await evalJs('performance.now()');
    R.spinnerAfterMs = Math.round(spinAt - okAt);
    assert.deepStrictEqual(await spinningRows(), [rough], D + ': only that row spins');
    const snapSpin = await probe(t).snap();
    if (snapA) assert.deepStrictEqual(probe(t).movedBoxes(snapA, snapSpin), [], D + ': 805 probe: nothing moved when the spinner appeared (0 px)');
    await shot('3-row-spinning.png', [rowSel(rough)], 4);
    await waitFor(`import('/apps/shaper/src/op-paths.js').then((m) => m.generatingCount() === 0)`, D + ': the generation finished', 120000);
    const doneAt = await evalJs('performance.now()');
    R.generationMs = Math.round(doneAt - okAt);
    R.longTasksDuringGeneration = await evalJs(`window.__lt.filter(([s]) => s >= ${okAt} && s <= ${doneAt})`);
    R.inputDelaysMs = await evalJs('window.__inp');
    console.log(`${D}: OK -> spinner ${R.spinnerAfterMs} ms, generated in ${R.generationMs} ms (${stillGenerating ? 'still generating after the click and the pan' : 'done before the pan'}); long tasks during it [start, ms]: ${JSON.stringify(R.longTasksDuringGeneration)}; input delays: ${JSON.stringify(R.inputDelaysMs)}`);
    assert.ok(stillGenerating > 0, D + ': the click and the pan happened while it generated');
    assert.ok(R.inputDelaysMs.length > 0 && R.inputDelaysMs.every(([, ms]) => ms < 100), D + ': every input handled within 100 ms while generating: ' + JSON.stringify(R.inputDelaysMs));
    assert.ok(R.longTasksDuringGeneration.every(([, ms]) => ms <= 100), D + ': no main-thread long task over 100 ms during the generation: ' + JSON.stringify(R.longTasksDuringGeneration));
    await waitFor(`!document.querySelector('${rowSel(rough)}.is-generating')`, D + ': the spinner goes');
    assert.deepStrictEqual(probe(t).movedBoxes(snapSpin, await probe(t).snap()), [], D + ': 805 probe: nothing moved when the spinner went (0 px: the row is the same with and without it)');
    assert.deepStrictEqual(await outside(), ref, D + ': 805 probe: nothing outside the card / list moved');
    await listOpen(true);
    await clickEl(`${rowSel(rough)} .ops-pick`);
    await sleep(300);
    assert.ok(await solid() > 0 && await faint() === 0, D + ': the paths appear (drawn, not faint)');
    assert.ok(/levels/.test(await evalJs(`document.querySelector('${rowSel(rough)} .ops-sub').textContent`)), D + ': the row tells what it cuts');
    // ── 4. an On line, open: its paths as opened faint, no new path; a change asks for nothing ──
    await listOpen(false);
    await typeLive(t, 'online'); await sleep(200); // TASK S3: the row's shapes selected, the operations toolbar's On line: their new On line, open
    await typeField('.cut-depth', '2');
    await clickEl('#prepare-panel .cut-ok');
    await waitFor(`import('/apps/shaper/src/op-paths.js').then((m) => m.generatingCount() === 0)`, D + ': the On line generated', 60000);
    const online = await opIdOf('online');
    await openOpLive(t, online);
    await listOpen(false);
    assert.ok(await faint() > 0 && await solid() === 0, D + ': the open On line: its paths as opened, faint; no new path');
    await typeField('.cut-depth', '3');
    assert.ok(await generating() === 0 && await faint() > 0 && await solid() === 0, D + ': a change while open: no generation, the faint paths as opened, no new path');
    await shot('4-open-online.png', ['#prepare-canvas'], 1);
    await clickEl('#prepare-panel .cut-cancel');
  };

  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); })`);
  await phase();

  phone = true; D = 'phone';
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper app ready (phone)');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); })`);
  await phase();
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });

  // ── 5. the worker = the page's main thread, IN THE BROWSER (arcs: the page samples them with its SVG DOM, the worker derives with those samples): the real Fusion
  // plate of TASK 711 (R10 corners, holes, a slot, pockets, an island) sent the way the add-in sends it; every plan membership's derivation and the files ──
  D = 'fusion-plate';
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await resetBufferLive(cdp);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.adsk = { _sent: [], fusionSendData(a, d) { this._sent.push({ a, d }); return '{}'; } };` });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`, 8000);
  await waitFor(`!!window.fusionJavaScriptHandler`, 'the Fusion handler');
  const plate = fs.readFileSync(new URL('./fixtures/real-solid-plate-711.json', import.meta.url), 'utf8');
  await evalJs(`window.fusionJavaScriptHandler.handle('selection_data', ${JSON.stringify(plate)})`);
  await waitFor(`document.getElementById('prepare-notice') && /8 regions/.test(document.getElementById('prepare-notice').textContent)`, 'the plate imported (8 regions)');
  const same = await evalJs(`Promise.all(['/apps/shaper/src/export-payload.js', '/apps/shaper/src/cut-plan.js', '/apps/shaper/src/op-derive.js', '/apps/shaper/src/op-paths.js'].map((u) => import(u))).then(async ([ep, cp, od, op]) => {
    const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Map) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x instanceof Map ? [...x] : typeof x === 'function' ? undefined : x));
    const st = window.__designController.state;
    const { loops, loopPolys } = cp.loopsWithPolygons(st), owned = cp.planOwnedLoops(st, loops, loopPolys), ctx = cp.pathsCtx(st, { loops, loopPolys, owned });
    const items = cp.planMemberItems().map((it) => cp.pathsInputOf(it.planKey, it.rec)).filter(Boolean);
    for (const x of items) op.lookup(ctx, x.target, x.rec);
    await op.idle();
    const arcs = st.shapes.filter((s) => s.type === 'arc').length;
    const derivations = items.map((x) => canon(op.lookup(ctx, x.target, x.rec, { request: false })) === canon(od.deriveItem(x.target, x.rec, st, loops, loopPolys, owned)));
    const dl = ep.exportFileOf(st), bg = await ep.exportFileInBackground(st);
    const pm = ep.exportFileOf(st, { preview: true }), pb = await ep.exportFileInBackground(st, { preview: true });
    return { arcs, items: items.length, derivations, file: dl.svg === bg.svg, preview: pm.svg === pb.svg, paths: canon(ep.bitCentrePaths(st, pm.written)) === canon(pb.bitPaths), bytes: bg.svg.length };
  })`);
  console.log('fusion plate, page main thread vs worker: ' + JSON.stringify(same));
  assert.ok(same.arcs > 0, 'the plate has arcs (sampled by the page SVG DOM)');
  assert.deepStrictEqual([same.derivations.every(Boolean), same.file, same.preview, same.paths], [true, true, true, true], 'in the browser: every membership derivation, the file, its preview copy and the Paths view made by the worker = the page own');
  results[D] = same;
  assert.deepStrictEqual(problems, [], 'no console error, no page exception');
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'live-measurements.json'), JSON.stringify(results, null, 1));
  console.log('op-paths-817-live: ok ' + JSON.stringify(results));
} finally { await close(); fs.rmSync(tmp, { recursive: true, force: true }); }
