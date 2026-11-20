// tests/opfirst-ui-s2-live.test.js — TASK S2 (docs/OPERATIONS-MODEL.md section 9: the owner's rulings turns 2709-2734) in the real Shaper page, desktop 1280 x 800 (a real
// mouse) and phone 390 x 844 (real touch), three drawn squares A, B, C and an open line L:
//  * a click on a shape only SELECTS it: the card is the quick flow's type menu only; the Operations rows of its operations are highlighted (C in Roughing + Contour:
//    exactly those 2 rows); every type offered (the Contour too: never greyed);
//  * the quick flow: a type = a NEW operation, OPEN (its header, its Shapes, OK / Cancel); a click puts a shape in / takes it out; an open line is refused with one
//    line in the card's note area; OK = ONE undo step (the footer Undo / Redo); Cancel = nothing created, nothing in the undo stack;
//  * the list: a row tap selects it and ONLY that row shows Edit, Duplicate, X (in that order, 44 px on a phone); a tap on another row moves them; the rows' heights
//    never change; Edit + a change + Cancel = as it was; Duplicate + Cancel = no copy;
//  * the Contour (a plain operation): its ONE depth, the live Depth row (From model, or a typed depth the cut stops at; no Bottom row), the tooltips (hover / long
//    press) of its Depth and of a flat Depth: the owner's words;
//  * THE 805 LAYOUT PROBE: opening / closing the card (a selection, an open operation, OK, Cancel) moves NOTHING outside the card (0 px: the canvas, the list's bar,
//    the footer);
//  * an EMPTY operation is listed "no shapes yet", saved and still there after a reload.
// Screenshots to .evidence/S2/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { probe, tipProblems } from './helpers/tooltip-live.js';
import { okLive, openOpLive } from './helpers/prepare-open-live.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/S2');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const LEVELS_DEPTH = 'From model: each shape to its own model depth. A typed depth: the cut follows the model’s slope and stops flat at that depth.';
const FLAT_DEPTH = 'One flat depth for every shape. From model: each shape’s own model depth (the deepest point of a sloped shape).';

const cdp = await launchBrowser({ tag: 'S2-opui', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  let phone = false;
  const shot = async (name, sels = null, scale = 1) => {
    let clip = null;
    if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q)).filter((e) => e && e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 4), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 4);
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 4) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 4) - y, scale: ${scale} }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const mouse = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const press = async (x, y) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
    await sleep(250);
  };
  const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => { const p = await boxOf(sel); assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`); await press(p.x, p.y); return p; };
  const screenOf = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const s = pt.matrixTransform(svg.getScreenCTM());
    const h = document.elementFromPoint(s.x, s.y); return { x: Math.round(s.x), y: Math.round(s.y), free: !!h && !!h.closest('#prepare-canvas') && s.x > 4 && s.x < innerWidth - 4 }; })()`);
  // a phone: the open card covers the right of the canvas; the user pans the drawing (two fingers on Prepare's canvas) until the shape is uncovered: here a
  // two-finger stroke leftwards on empty canvas above the drawing, as often as needed
  const reveal = async (x, y) => {
    for (let i = 0; i < 4; i++) {
      const p = await screenOf(x, y);
      if (p.free) return p;
      await T('touchStart', [{ x: 130, y: 120 }, { x: 130, y: 180 }]);
      for (let k = 1; k <= 8; k++) { await T('touchMove', [{ x: 130 - k * 15, y: 120 }, { x: 130 - k * 15, y: 180 }]); await sleep(16); }
      await T('touchEnd', []); await sleep(250);
    }
    assert.fail(`the world point ${x},${y} stays covered`);
  };
  const clickWorld = async (x, y) => { const p = await reveal(x, y); await press(p.x, p.y); };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-handle');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
      } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const listOpen = async (open) => { if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`) === open) { await clickEl('#prepare-ops .ops-head'); await sleep(300); } };
  const t = { get phone() { return phone; }, evalJs, send, waitFor, clickEl, clickWorld };
  const draw = () => evalJs(`import('/tests/helpers/plan-v2.js').then((C) => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const rect = (n, x0, y0, x1, y1) => { [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(n + 'j' + i, { x, y }));
      for (let i = 0; i < 4; i++) st.shapes.push({ id: n + 's' + i, type: 'line', joints: [n + 'j' + i, n + 'j' + ((i + 1) % 4)] }); };
    rect('A', 0, 0, 40, 40); rect('B', 60, 0, 100, 40); rect('C', 120, 0, 160, 40);
    st.joints.set('Lj0', { x: 0, y: 70 }); st.joints.set('Lj1', { x: 160, y: 70 }); st.shapes.push({ id: 'Ls0', type: 'line', joints: ['Lj0', 'Lj1'] });
    st.saveState('draw');
    C.V2_PLAN.use(st); C.V2_PLAN.setOrder([]); C.V2_PLAN.clear();
    return st.shapes.length; })`);
  const store = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => JSON.stringify(m.captureStore().operations))`);
  const ops = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => ({ id: o.id, type: o.type, n: o.geometry.length, settings: o.settings })))`);
  const hist = () => evalJs(`window.__designController.state.history.length`);
  const cardState = () => evalJs(`(() => { const c = document.querySelector('#prepare-panel .cut-card'); if (!c || c.hidden) return 'hidden';
    return !document.querySelector('#prepare-panel .cut-actions').hidden ? 'open' : document.querySelector('#prepare-panel .cut-rows').hidden && document.querySelector('#prepare-panel .cut-op-headrow').hidden ? 'type menu' : 'other'; })()`);
  const head = () => evalJs(`document.querySelector('#prepare-panel .cut-op-head').textContent`);
  const shapes = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-geo-shape .cut-geo-name')].map((e) => e.textContent)`);
  const note = () => evalJs(`[...document.querySelectorAll('#prepare-panel .cut-note div')].map((d) => d.textContent)`);
  const rows = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => ({ id: r.dataset.id, picked: r.classList.contains('is-picked'), acts: [...r.querySelectorAll('.ops-act')].map((b) => b.classList[1]), h: Math.round(r.getBoundingClientRect().height * 100) / 100,
    actBox: [...r.querySelectorAll('.ops-act')].map((b) => { const q = b.getBoundingClientRect(); return [Math.round(q.width), Math.round(q.height)]; }) }))`);
  const pickType = async (id) => { await clickEl('#prepare-panel .cut-type-trigger'); await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu'); await clickEl(`.cut-type-opt[data-id="${id}"]`); await sleep(200); };
  const typeField = async (cls, v) => { await evalJs(`(() => { const i = document.querySelector('${cls}'); i.value = '${v}'; i.dispatchEvent(new Event('change')); })()`); await sleep(200); };
  const tab = async (id) => { if (!await evalJs(`document.querySelector('.cut-tab[data-tab="${id}"]').classList.contains('is-active')`)) await clickEl(`.cut-tab[data-tab="${id}"]`); };
  // THE 805 LAYOUT PROBE: the boxes OUTSIDE the card (the canvas, the Operations list's bar, the footer's Undo / Redo, the header / drawer handle)
  const outside = () => evalJs(`(() => { const out = {}; for (const sel of ['#prepare-canvas', '#prepare-ops .ops-head', '#btn-undo', '#btn-redo', '.sk-header', '.sk-sidebar-handle']) { const e = document.querySelector(sel); if (!e) continue; const b = e.getBoundingClientRect(); out[sel] = [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 100) / 100).join(','); } return out; })()`);
  const sameOutside = async (ref, what) => { const now = await outside(); assert.deepStrictEqual(now, ref, `${what}: NOTHING outside the card moved (0 px)`); };

  const phase = async (label) => {
    const D = phone ? 'phone' : 'desktop';
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    assert.strictEqual(await draw(), 13, label + ': drawn');
    await openMode('prepare');
    await listOpen(false);
    const ref = await outside();
    console.log(label + ' outside boxes: ' + JSON.stringify(ref));

    // a click only selects: the type menu only; every type offered
    await clickWorld(0, 20);
    assert.strictEqual(await cardState(), 'type menu', label + ': a click on A: the card is the type menu only');
    await sameOutside(ref, label + ': the card appears for a selection');
    await clickEl('#prepare-panel .cut-type-trigger');
    const menu = await evalJs(`[...document.querySelectorAll('.cut-type-opt')].map((o) => o.dataset.id + (o.getAttribute('aria-disabled') === 'true' ? ':off' : ''))`);
    assert.deepStrictEqual(menu, ['online', 'guide', 'interior', 'pocket', 'roughing', 'contour', 'exterior', 'stock'], label + ': every type offered, the Contour too, none greyed');
    await shot(`${D}-1-selection-type-menu-contour.png`, ['#prepare-panel .cut-card', '.cut-type-menu'], 2);
    await clickEl('#prepare-panel .cut-type-trigger'); // close

    // the quick flow and its Cancel
    const s0 = await store(), h0 = await hist();
    await pickType('pocket');
    assert.deepStrictEqual([await cardState(), await head(), await shapes()], ['open', 'Pocket 1 · 1 shape', ['Shape 40 × 40 mm']], label + ': a NEW Pocket, OPEN: its header, its Shapes');
    await sameOutside(ref, label + ': the operation card opens');
    await clickEl('#prepare-panel .cut-cancel');
    assert.deepStrictEqual([await store(), await hist(), await cardState()], [s0, h0, 'hidden'], label + ': Cancel: nothing created, nothing in the undo stack, the card closes');
    await sameOutside(ref, label + ': the card closes');

    // an open operation: clicks put shapes in / take them out; an open line refused with its line; OK = ONE undo step
    await clickWorld(0, 20); await pickType('pocket');
    await clickWorld(60, 20);
    assert.deepStrictEqual([await head(), await shapes()], ['Pocket 1 · 2 shapes', ['Shape 40 × 40 mm', 'Shape 40 × 40 mm']], label + ': a click on B puts it in');
    await clickWorld(80, 70);
    assert.strictEqual((await note())[0], 'This open line can’t be a Pocket: a pocket needs a closed shape', label + ': the open line is not added: the card\'s note area says why');
    assert.strictEqual(await head(), 'Pocket 1 · 2 shapes', label + ': (still 2 shapes)');
    await shot(`${D}-2-op-card-open-refused-line.png`, '#prepare-panel .cut-card', 2);
    await shot(`${D}-2-op-card-open-full.png`);
    await typeField('.cut-depth', '6');
    await clickEl('#prepare-panel .cut-ok');
    assert.deepStrictEqual([await hist() - h0, await cardState()], [1, 'hidden'], label + ': OK: the session is ONE undo step; the card closes');
    await clickEl('#btn-undo');
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().length === 0)`, label + ': the footer Undo: as before the session');
    await clickEl('#btn-redo');
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().length === 1 && m.storeOps()[0].geometry.length === 2)`, label + ': Redo: the Pocket of A and B again');
    const pocketId = (await ops())[0].id;

    // Roughing + Contour on C; a click on C: exactly those 2 rows highlighted, the card the type menu only
    await clickWorld(120, 20); await pickType('roughing');
    await tab('heights'); await typeField('.cut-depth', '8'); await okLive(t);
    await clickWorld(120, 20);
    await pickType('contour');
    await tab('heights');
    const depthRow = await evalJs(`(() => { const r = document.querySelector('.cut-row[data-param="cutDepth"]'); return { off: 'off' in r.dataset, value: document.querySelector('.cut-depth').value, placeholder: document.querySelector('.cut-depth').placeholder, bottom: !!document.querySelector('.cut-row[data-row="bottomDepth"]') }; })()`);
    assert.deepStrictEqual(depthRow, { off: false, value: '', placeholder: 'From model', bottom: false }, label + ': the Contour ONE depth: the live Depth row, From model; no Bottom row');
    await typeField('.cut-depth', '5');
    assert.strictEqual(await evalJs(`document.querySelector('.cut-depth').value`), '5', label + ': its own depth 5 (the cut stops there)');
    await shot(`${D}-3-contour-card-heights.png`, '#prepare-panel .cut-card', 2);
    // the tooltips: the greyed Depth, the Bottom (hover / long press)
    const tp = probe(t);
    for (const [sel, text, name] of [['#prepare-panel .cut-row[data-param="cutDepth"] .cut-field-label', LEVELS_DEPTH, 'contour-depth']]) {
      const pt = await tp.show(sel), tip = await tp.tip();
      console.log(`${label} tooltip ${name}: ${JSON.stringify(tip)}`);
      assert.deepStrictEqual(tipProblems(tip, pt, text, { phone }), [], `${label}: the ${name} tooltip (${phone ? 'long press' : 'hover'}) is the owner's words`);
      await shot(`${D}-4-tooltip-${name}.png`, ['#prepare-panel .cut-card', '#sk-cursor-tip'], 2);
      if (phone) await tp.release(); else await tp.leave();
    }
    assert.strictEqual(await cardState(), 'open', label + ': (the operation is still open)');
    await okLive(t);
    const contourId = (await ops()).find((o) => o.type === 'contour').id, roughId = (await ops()).find((o) => o.type === 'roughing').id;
    await clickWorld(120, 20);
    await listOpen(true);
    const r2 = await rows();
    assert.deepStrictEqual([r2.filter((r) => r.picked).map((r) => r.id).sort(), await cardState()], [[contourId, roughId].sort(), 'type menu'], label + ': a click on C (in Roughing + Contour): exactly those 2 rows highlighted; the card the type menu only');
    assert.ok(r2.every((r) => r.acts.length === 0), label + ': (a shape click selects no row: no row actions)');
    await shot(`${D}-5-two-rows-highlighted.png`, '#prepare-ops', 2);

    // the list: the selected row alone shows Edit, Duplicate, X; another row tap moves them; the heights never change
    const h1 = (await rows()).map((r) => r.h);
    await clickEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
    const r3 = await rows();
    assert.deepStrictEqual(r3.map((r) => [r.id, r.acts]), r3.map((r) => [r.id, r.id === pocketId ? ['ops-edit', 'ops-dup', 'ops-del'] : []]), label + ': only the selected row shows Edit, Duplicate, X (in that order)');
    assert.deepStrictEqual(r3.map((r) => r.h), h1, label + ': the row heights are unchanged (0 px)');
    if (phone) assert.ok(r3.find((r) => r.id === pocketId).actBox.every(([w, h]) => w >= 44 && h >= 44), label + ': 44 px action targets on a phone: ' + JSON.stringify(r3.find((r) => r.id === pocketId).actBox));
    await shot(`${D}-6-row-actions.png`, '#prepare-ops', 2);
    await clickEl(`#prepare-ops .ops-row[data-id="${roughId}"] .ops-pick`);
    const r4 = await rows();
    assert.deepStrictEqual(r4.filter((r) => r.acts.length).map((r) => r.id), [roughId], label + ': a tap on another row moves them');
    assert.deepStrictEqual(r4.map((r) => r.h), h1, label + ': the row heights still unchanged');
    // Edit + a change + Cancel; Duplicate + Cancel
    const s5 = await store(), h5 = await hist();
    await clickEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`); await clickEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-edit`);
    await listOpen(false);
    assert.strictEqual(await cardState(), 'open', label + ': Edit opens it');
    await typeField('.cut-depth', '9');
    const tpF = probe(t), ptF = await tpF.show('#prepare-panel .cut-row[data-param="cutDepth"] .cut-field-label'), tipF = await tpF.tip();
    assert.deepStrictEqual(tipProblems(tipF, ptF, FLAT_DEPTH, { phone }), [], label + ': a flat Depth\'s tooltip: the owner\'s words');
    if (phone) await tpF.release(); // the finger lifts (a phone has no Esc key: the next tap hides the tooltip)
    else { // desktop: an Esc while the tooltip shows hides the tooltip ONLY: the operation stays open (its Esc = Cancel needs a second press)
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(150);
      assert.deepStrictEqual([await tpF.tip(), await cardState()], [null, 'open'], label + ': Esc with a tooltip showing: the tooltip hides, the operation stays open');
      await tpF.leave();
    }
    await clickEl('#prepare-panel .cut-cancel');
    assert.deepStrictEqual([await store(), await hist()], [s5, h5], label + ': Cancel: as it was, nothing in the undo stack');
    await listOpen(true);
    await clickEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`); await clickEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-dup`);
    await listOpen(false);
    assert.ok((await ops()).length === 4 && await cardState() === 'open', label + ': Duplicate: the copy, open');
    await clickEl('#prepare-panel .cut-cancel');
    assert.deepStrictEqual([await store(), await hist()], [s5, h5], label + ': Duplicate + Cancel: no copy, nothing in the undo stack');

    // an EMPTY operation (its shapes taken out), saved, still there after a reload
    await openOpLive(t, pocketId);
    for (let i = 0; i < 2; i++) await clickEl('#prepare-panel .cut-geo-shape .cut-geo-x');
    assert.strictEqual(await head(), `Pocket ${(await ops()).findIndex((o) => o.id === pocketId) + 1} · no shapes yet`, label + ': both shapes taken out');
    await clickEl('#prepare-panel .cut-ok');
    await listOpen(true);
    assert.ok(await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row .ops-sub')].some((e) => e.textContent === 'no shapes yet: click shapes to add')`), label + ': listed "no shapes yet"');
    await shot(`${D}-7-empty-operation-listed.png`, '#prepare-ops', 2);
    await listOpen(false);
    await sleep(1500); // the autosave
    const before = (await ops()).map((o) => [o.type, o.n]);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('${phone ? '.sk-sidebar-handle' : '.sk-header-tab[data-tab="design"]'}')`, 'reloaded');
    await openMode('prepare');
    await waitFor(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().length === ${before.length})`, label + ': reloaded: the operations');
    assert.deepStrictEqual((await ops()).map((o) => [o.type, o.n]), before, label + ': reloaded: the same operations, the empty one too');
  };

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); })`);
  await phase('desktop');

  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-sidebar-handle')`, 'shaper app ready (phone)');
  await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); })`);
  await phase('phone');
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('opfirst-ui-s2-live: ok');
} finally { await close(); }
