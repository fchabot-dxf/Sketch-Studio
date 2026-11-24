// tests/op-ticks-798-live.test.js — TASK 798 (owner turns 2515-2537): the Operations list's CHECKBOXES in the real Shaper page, desktop 1280 x 800 (real mouse,
// inches) and phone 390 x 844 (real touch, mm). A 160 x 100 mm Stock board, a part outline (Outside, 3/4 in deep, 1/8 in bit), a pocket (1/4 in deep, 1/4 in
// bit) and a round hole (Inside, 3/4 in, 1/4 in bit):
//  * every row and every tool heading has a checkbox, ticked; the Stock's is ticked and disabled; on the phone each box is a 44 px target;
//  * a tap on a row's box unticks it (the row dims); the footer Undo ticks it again, Redo unticks it; its row tap still opens its card, and Prepare draws no tool
//    path for it; a tap on a heading's box unticks / ticks its whole bit run (mixed when some are ticked);
//  * the Export step follows: the 3D Review is rebuilt from the ticked operations (fewer triangles with the outline unticked), the 2D and Paths lists show the
//    ticked operations only, the Export line names the unticked ones; the DOWNLOAD holds only the ticked operations' elements, byte-identical to the full file's,
//    on the full file's page with the Stock guide;
//  * desktop only: the two hand-check files for the owner's Origin (.evidence/798/handcheck-1-pocket-quarter-inch.svg: the 1/4 in pocket alone;
//    handcheck-2-outline-eighth-inch.svg: the 1/8 in outline alone; same page, same Stock guide).
// Screenshots to .evidence/798/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressExportAction } from './helpers/export-actions.js'; // TASK 880: the Export actions are the header's (the drawer's on a phone)

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/798');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '798-ticks', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-798-dl-'));

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const shot = async (name, sels = null, scale = 1) => {
    let clip = null;
    if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 4), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 4);
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 4) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 4) - y, scale: ${scale} }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  let phone = false;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const press = async (x, y) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
    await sleep(250);
  };
  const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => {
    const p = await boxOf(sel);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
    return p;
  };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
      } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const openList = async () => { if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) { await clickEl('#prepare-ops .ops-head'); await waitFor(`!document.querySelector('#prepare-ops .ops-body').hidden`, 'the list opens'); } };
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  const drawAndPlan = () => evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/tests/helpers/plan-v2.js')]).then(([L, C]) => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const rect = (name, x0, y0, x1, y1) => { [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y }));
      for (let i = 0; i < 4; i++) st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % 4)] }); };
    rect('SB', 0, 0, 160, 100); rect('PT', 20, 20, 140, 80); rect('PK', 35, 35, 75, 65);
    st.joints.set('HLc', { x: 110, y: 50 }); st.shapes.push({ id: 'HL', type: 'circle', joints: ['HLc'], radius: 10 });
    const loops = L.findLoops(st);
    const loopKey = (shapeId) => 'loop:' + loops.find((l) => l.edges.includes(shapeId)).id;
    const rec = (cutType, cutDepth, toolDia) => ({ cutType, cutDepth, cutOffset: 0, toolDia, cutterShape: 'endmill', cutterAngle: 90 });
    C.V2_PLAN.use(st); C.V2_PLAN.setOrder([]); C.V2_PLAN.clear();
    C.V2_PLAN.set(loopKey('SBs0'), rec('stock', 19.05, 6.35));
    C.V2_PLAN.set(loopKey('PTs0'), rec('exterior', 19.05, 3.175));
    C.V2_PLAN.set(loopKey('PKs0'), rec('pocket', 6.35, 6.35));
    C.V2_PLAN.set(loopKey('HL'), rec('interior', 19.05, 6.35));
    return { stock: loopKey('SBs0'), part: loopKey('PTs0'), pocket: loopKey('PKs0'), hole: loopKey('HL') };
  })`);
  const ops = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => ({ id: o.id, type: o.type, on: o.on })))`);
  const idOf = async (type) => (await ops()).find((o) => o.type === type).id;
  const ticks = () => evalJs(`({ rows: [...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => { const b = r.querySelector('.ops-tick input'); return [r.querySelector('.ops-name').textContent, b.checked, b.disabled, r.classList.contains('is-off')]; }),
    groups: [...document.querySelectorAll('#prepare-ops .ops-tool')].map((h) => { const b = h.querySelector('.ops-tick input'); return [h.textContent, b.indeterminate ? 'some' : b.checked ? 'all' : 'none', b.disabled]; }) })`);
  const rowBoxSel = (id) => `#prepare-ops .ops-row[data-id="${id}"] .ops-tick`;
  const headBoxSel = async (heading) => `#prepare-ops .ops-tool:nth-of-type(${await evalJs(`[...document.querySelector('#prepare-ops .ops-body').children].findIndex((e) => e.classList.contains('ops-tool') && e.textContent === ${JSON.stringify(heading)}) + 1`)}) .ops-tick`;
  const download = async () => {
    await openMode('review');
    for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
    await pressExportAction({ evalJs, waitFor }, clickEl, 'btn-generate-svg'); // TASK 880
    let file = null;
    for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg') && !n.endsWith('.crdownload')); if (f) file = path.join(dlDir, f); else await sleep(100); }
    assert.ok(file, 'the export downloaded');
    await sleep(200);
    return fs.readFileSync(file, 'utf8');
  };
  const pageFull = () => evalJs(`Promise.all([import('/apps/shaper/src/export-payload.js'), import('/apps/shaper/src/cut-plan.js')]).then(([E, C]) => E.shaperSvgOf(window.__designController.state, C.planEntries()))`);
  const header = (svg) => svg.split('\n')[0];
  const elements = (svg) => svg.split('\n').slice(1, -1);
  const view = async (v) => {
    await openMode('review');
    if (await evalJs(`document.getElementById('review-view-${v}').getAttribute('aria-pressed')`) !== 'true') await clickEl(`#review-view-${v}`);
    await sleep(500);
  };

  const phase = async (label) => {
    const D = phone ? 'phone' : 'desktop';
    const unit = await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit())`);
    const full = unit === 'in' ? '0.75 in' : '19.05 mm';
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    const K = await drawAndPlan();
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length === 4`, label + ': 4 operations listed');
    await openList();

    // the boxes
    const t0 = await ticks();
    console.log(label + ' ticks: ' + JSON.stringify(t0));
    assert.deepStrictEqual(t0.rows.map((r) => r.slice(1)), [[true, true, false], [true, false, false], [true, false, false], [true, false, false]], label + ': every row ticked; the Stock\'s box disabled');
    assert.deepStrictEqual(t0.groups.map((g) => [g[1], g[2]]), [['all', true], ['all', false], ['all', false]], label + ': every heading ticked; the Stock\'s heading (Stock alone) disabled');
    const boxes = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-tick')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
    console.log(label + ' box targets: ' + JSON.stringify(boxes));
    assert.strictEqual(boxes.length, 7, label + ': 4 row boxes + 3 heading boxes');
    if (phone) for (const [w, h] of boxes) assert.ok(w >= 44 && h >= 44, `${label}: a box target is ${w} x ${h} (44 px on a phone)`);
    const fullFile = await pageFull();
    await shot(`${D}-ops-ticked.png`, '#prepare-ops', phone ? 2 : 2);

    // a row's box: the Outside unticked; Undo / Redo
    const ext = await idOf('exterior');
    await clickEl(rowBoxSel(ext));
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'exterior').on === false)`, label + ': the Outside unticked');
    await waitFor(`document.querySelector('#prepare-ops .ops-row[data-id="${ext}"]').classList.contains('is-off')`, label + ': its row dims');
    await clickEl('#btn-undo');
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'exterior').on === true)`, label + ': Undo ticks it again');
    await clickEl('#btn-redo');
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'exterior').on === false)`, label + ': Redo unticks it');
    await openList();
    // its row tap still opens its card; Prepare draws no tool path for it
    await clickEl(`#prepare-ops .ops-row[data-id="${ext}"] .ops-pick`);
    await clickEl(`#prepare-ops .ops-row[data-id="${ext}"] .ops-edit`); // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): a tap selects; the row's Edit opens its card
    const picked = await evalJs(`({ sel: [...window.__prepareView.selection.keys()], card: document.querySelector('.cut-type-cur') && document.querySelector('.cut-type-cur').textContent, paths: document.querySelectorAll('#prepare-toolpath-group path, #prepare-toolpath-group polyline').length, band: document.getElementById('prepare-cut-group').innerHTML.length })`);
    console.log(label + ' unticked picked: ' + JSON.stringify(picked));
    assert.deepStrictEqual(picked, { sel: [K.part], card: 'Outside', paths: 0, band: 0 }, label + ': the unticked Outside: its card opens (Outside), no band and no tool path drawn');
    await shot(`${D}-prepare-unticked-picked.png`);
    // TASK S2: confirmed (nothing changed: no undo step); on a phone the open list's sheet is folded first (it lies over the card's foot)
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) { await clickEl('#prepare-ops .ops-head'); await waitFor(`document.querySelector('#prepare-ops .ops-body').hidden`, 'the list folds'); }
    await clickEl('#prepare-panel .cut-ok');
    // the ticked pocket, picked: drawn
    await openList();
    await clickEl(`#prepare-ops .ops-row[data-id="${await idOf('pocket')}"] .ops-pick`);
    assert.ok(await evalJs(`document.querySelectorAll('#prepare-toolpath-group path, #prepare-toolpath-group polyline').length > 0`), label + ': a ticked operation picked draws its tool path');
    // a heading's box: the 1/4 in run
    await openList();
    const quarter = (await ticks()).groups.find((g) => /¼/.test(g[0]))[0];
    await clickEl(await headBoxSel(quarter));
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().filter((o) => o.type === 'pocket' || o.type === 'interior').every((o) => o.on === false))`, label + ': the 1/4 in heading unticks its run');
    assert.strictEqual((await ticks()).groups.find((g) => g[0] === quarter)[1], 'none', label + ': heading none');
    await clickEl(await headBoxSel(quarter));
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().filter((o) => o.type === 'pocket' || o.type === 'interior').every((o) => o.on === true))`, label + ': tapped again: ticks its run');
    await clickEl(rowBoxSel(await idOf('interior')));
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().find((o) => o.type === 'interior').on === false)`, label + ': the Inside unticked');
    const t1 = await ticks();
    console.log(label + ' ticks (Outside + Inside unticked): ' + JSON.stringify(t1));
    assert.deepStrictEqual(t1.groups.map((g) => g[1]), ['all', 'some', 'none'], label + ': the headings: Not cut all, 1/4 in mixed, 1/8 in none');
    await shot(`${D}-ops-unticked.png`, '#prepare-ops', 2);
    await clickEl(rowBoxSel(await idOf('interior'))); // the Inside ticked again: only the Outside is unticked

    // the Export step: 3D, 2D, Paths, the line, the download
    await view('3d');
    await waitFor(`import('/apps/shaper/src/main.js').then((m) => !!(m.currentReviewView() && m.currentReviewView().lastBuild))`, label + ': the 3D built');
    await sleep(800);
    const build1 = await evalJs(`import('/apps/shaper/src/main.js').then((m) => ({ triangles: m.currentReviewView().lastBuild.triangles, levels: m.currentReviewView().lastBuild.levels }))`);
    const line = await evalJs(`(() => { const e = document.getElementById('simexport-ticked'); return { hidden: e.hidden, text: e.textContent }; })()`);
    console.log(label + ' 3D (Outside unticked): ' + JSON.stringify(build1) + ' line: ' + JSON.stringify(line));
    assert.deepStrictEqual(line, { hidden: false, text: `Exporting 2 of 3 operations (unticked: 4. Outside · ${full} (⅛″ end mill)). Place it with the same anchor as the earlier file.` }, label + ': the Export line names the unticked Outside');
    await shot(`${D}-export-3d-outline-unticked.png`);
    await shot(`${D}-export-line.png`, '#review-cards', 2); // TASK 880: the line is a card over the view
    await view('2d');
    await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-op').length > 0`, label + ': the 2D list');
    const list2d = await evalJs(`[...document.querySelectorAll('#review-cuts-list .rv2d-op')].map((e) => e.firstChild.textContent)`);
    console.log(label + ' 2D list: ' + JSON.stringify(list2d));
    assert.ok(list2d.length === 3 && !list2d.some((t) => /Outside/.test(t)), label + ': the 2D list: the Stock, the pocket and the hole, no Outside');
    await shot(`${D}-export-2d-outline-unticked.png`);
    await view('paths');
    await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-op').length > 0`, label + ': the Paths list');
    const listPaths = await evalJs(`[...document.querySelectorAll('#review-cuts-list .rv2d-op')].map((e) => e.firstChild.textContent)`);
    assert.deepStrictEqual(listPaths, list2d, label + ': the Paths list = the 2D list');
    await shot(`${D}-export-paths-outline-unticked.png`);
    await view('3d');
    const file1 = await download();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-download-outline-unticked.svg`), file1);
    const fullEls = elements(fullFile);
    assert.strictEqual(header(file1), header(fullFile), label + ': the download has the full file\'s page');
    assert.deepStrictEqual(elements(file1), fullEls.filter((l) => !/shaper:cutType="outside"/.test(l)), label + ': the download = the full file without the Outside, byte-identical elements');
    assert.ok(elements(file1)[0].includes('fill="#0068FF"'), label + ': the Stock guide is in it (first)');
    // everything ticked again: the full file; the 3D has more triangles (the outline cut back in)
    await openMode('prepare'); await openList();
    await clickEl(rowBoxSel(ext));
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().every((o) => o.on))`, label + ': all ticked');
    await view('3d');
    await waitFor(`document.getElementById('simexport-ticked').hidden`, label + ': no Export line with everything ticked');
    await sleep(800);
    const build0 = await evalJs(`import('/apps/shaper/src/main.js').then((m) => ({ triangles: m.currentReviewView().lastBuild.triangles, levels: m.currentReviewView().lastBuild.levels }))`);
    console.log(label + ' 3D (all ticked): ' + JSON.stringify(build0));
    assert.notDeepStrictEqual(build0, build1, label + ': the 3D Review is rebuilt from the ticked operations (the outline changes it)');
    await shot(`${D}-export-3d-all-ticked.png`);
    const file0 = await download();
    assert.strictEqual(file0, fullFile, label + ': everything ticked: the download is the full file, byte for byte');

    if (!phone) { // the two hand-check files for the owner's Origin: the 1/4 in pocket alone, then the 1/8 in outline alone
      const only = async (types) => { await openMode('prepare'); for (const o of await ops()) { const want = o.type === 'stock' || types.includes(o.type); if (o.on !== want) await clickEl(rowBoxSel(o.id)); } };
      await only(['pocket']);
      const a = await download();
      await only(['exterior']);
      const b = await download();
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'handcheck-1-pocket-quarter-inch.svg'), a);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'handcheck-2-outline-eighth-inch.svg'), b);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'handcheck-0-everything.svg'), file0);
      console.log('hand-check A:\n' + a + '\nhand-check B:\n' + b);
      assert.deepStrictEqual([header(a), header(b)], [header(fullFile), header(fullFile)], 'hand-check: both files have the full file\'s page');
      assert.deepStrictEqual(elements(a).map((l) => /shaper:cutType="(\w+)"/.exec(l)[1]), ['guide', 'pocket'], 'hand-check A: the Stock guide + the pocket');
      assert.deepStrictEqual(elements(b).map((l) => /shaper:cutType="(\w+)"/.exec(l)[1]), ['guide', 'outside'], 'hand-check B: the Stock guide + the outline');
      assert.strictEqual(elements(a)[0], elements(b)[0], 'hand-check: the same Stock guide element in both');
      await only(['pocket', 'interior', 'exterior']);
      // the same design with NO Stock (advisor turn 2705, option b): the Stock binned; the pocket alone, then the outline alone: each starts with the FRAME GUIDE =
      // the full file's drawn extent (the outline 20..140 x 20..80), in the Stock guide's encoding; everything ticked: the plain file (no guide)
      await openMode('prepare'); await openList();
      await clickEl(`#prepare-ops .ops-row[data-id="${await idOf('stock')}"] .ops-pick`); // TASK S2: the bin is on the selected row
      await clickEl(`#prepare-ops .ops-row[data-id="${await idOf('stock')}"] .ops-del`);
      await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => !m.storeOps().some((o) => o.type === 'stock'))`, 'no-Stock: the Stock binned');
      const fullNs = await pageFull();
      const ns0 = await download();
      assert.strictEqual(ns0, fullNs, 'no-Stock: everything ticked: the plain whole-plan file');
      assert.ok(!ns0.includes('shaper:cutType="guide"'), 'no-Stock: everything ticked: no guide');
      await only(['pocket']);
      const na = await download();
      await only(['exterior']);
      const nb = await download();
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'handcheck-nostock-1-pocket-quarter-inch.svg'), na);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'handcheck-nostock-2-outline-eighth-inch.svg'), nb);
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'handcheck-nostock-0-everything.svg'), ns0);
      console.log('no-Stock hand-check A:\n' + na + '\nno-Stock hand-check B:\n' + nb);
      const frameGuide = '  <path d="M 20 20 L 140 20 L 140 80 L 20 80 Z" fill="#0068FF" stroke="#0068FF" shaper:cutType="guide" shaper:cutOffset="0in"/>';
      assert.deepStrictEqual(elements(na), [frameGuide, ...elements(fullNs).filter((l) => /shaper:cutType="pocket"/.test(l))], 'no-Stock hand-check A: the frame guide + the pocket');
      assert.deepStrictEqual(elements(nb), [frameGuide, ...elements(fullNs).filter((l) => /shaper:cutType="outside"/.test(l))], 'no-Stock hand-check B: the frame guide + the outline');
      assert.deepStrictEqual([header(na), header(nb)], [header(fullNs), header(fullNs)], 'no-Stock hand-check: the full file\'s page in both');
      await view('paths');
      await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-row, #review-cuts-list .rv2d-op').length > 0`, 'no-Stock: the Paths view with the frame guide');
      await shot('desktop-nostock-paths-outline-alone.png');
      await view('2d');
      await shot('desktop-nostock-2d-outline-alone.png');
      await view('3d');
    }
    await openMode('prepare');
  };

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await setUnit('in');
  await phase('desktop (in)');

  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper app ready (phone)');
  await setUnit('mm');
  await phase('phone (mm)');
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('op-ticks-798-live: ok');
} finally { await close(); }
