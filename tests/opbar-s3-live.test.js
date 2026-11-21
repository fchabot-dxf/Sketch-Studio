// tests/opbar-s3-live.test.js — TASK S3 (owner turns 2944-2950; the placement: the owner's choice A, "Ok ribbon"; the checkbox and reorder feature: "And also use the checkbox
// and reorder feature") and its addition (owner turns 3046-3047, "Fusion style": out of date + Recalculate) in the real Shaper page: desktop 1280 x 800 (a real mouse),
// phone 390 x 844 held upright and 844 x 390 (the short viewport), both real touch; three drawn squares A, B, C and an open line L:
//  * THE OPERATIONS TOOLBAR is Design's tool ribbon in Design's place and style: a bar across the top of Prepare (the rail on the short viewport), its buttons the
//    operation types in the declaration's order, then Recalculate; 44 px targets on a phone; the Operations card starts below it (its top printed);
//  * a shape click, a row tap: NO card; a type with a shape selected = a NEW operation of it, OPEN; with nothing selected = an EMPTY one, open; an impossible pick =
//    nothing created, the one plain line in Prepare's notice; THE 805 PROBE: none of these moves anything outside the card (0 px);
//  * the Operations section's dropdown (TASK 647): a type unchecked leaves the bar and still runs from the dropdown; a reorder (the hold-drag grip) is the bar's order
//    and survives a reload; saved under Prepare's own key, Design's layout untouched;
//  * OUT OF DATE: a Design edit marks the operations (their rows' mark), Recalculate clears it; the Export step's Generate waits with "n operations are out of date"
//    and its Recalculate, the file after it.
// Screenshots to .evidence/S3/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/S3');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const TYPES = ['exterior', 'interior', 'pocket', 'online', 'guide', 'stock', 'roughing', 'contour'];

const cdp = await launchBrowser({ tag: 'S3-opbar', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  let touch = false;
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
  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const press = async (x, y) => {
    if (touch) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y); }
    await sleep(250);
  };
  // a hold, then a drag (the ribbon dropdown's grip: HOLD_MS 300)
  const holdDrag = async (from, to) => {
    if (touch) { await T('touchStart', [from]); await sleep(450); for (let k = 1; k <= 6; k++) { await T('touchMove', [{ x: from.x, y: from.y + (to.y - from.y) * k / 6 }]); await sleep(30); } await T('touchEnd', []); }
    else { await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y, 1); await sleep(450); for (let k = 1; k <= 6; k++) { await mouse('mouseMoved', from.x, from.y + (to.y - from.y) * k / 6, 1); await sleep(30); } await mouse('mouseReleased', to.x, to.y); }
    await sleep(300);
  };
  const boxOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), top: r.top, left: r.left, bottom: r.bottom, right: r.right, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => { const p = await boxOf(sel); assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`); await press(p.x, p.y); return p; };
  const screenOf = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y}; const s = pt.matrixTransform(svg.getScreenCTM());
    const h = document.elementFromPoint(s.x, s.y); return { x: Math.round(s.x), y: Math.round(s.y), free: !!h && !!h.closest('#prepare-canvas') }; })()`);
  const clickWorld = async (x, y) => { const p = await screenOf(x, y); assert.ok(p.free, `the world point ${x},${y} is on the canvas, uncovered: ${JSON.stringify(p)}`); await press(p.x, p.y); };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (await evalJs(`!!document.querySelector('.sk-header-tab[data-tab="${mode}"]') && document.querySelector('.sk-header-tab[data-tab="${mode}"]').getBoundingClientRect().width > 0`)) await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      else {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
      }
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const listOpen = async (open) => { if (await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`) === open) { await clickEl('#prepare-ops .ops-head'); await sleep(300); } };
  const draw = () => evalJs(`import('/tests/helpers/plan-v2.js').then((C) => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const rect = (n, x0, y0, x1, y1) => { [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(n + 'j' + i, { x, y }));
      for (let i = 0; i < 4; i++) st.shapes.push({ id: n + 's' + i, type: 'line', joints: [n + 'j' + i, n + 'j' + ((i + 1) % 4)] }); };
    rect('A', 0, 0, 40, 40); rect('B', 60, 0, 100, 40); rect('C', 120, 0, 160, 40);
    st.joints.set('Lj0', { x: 0, y: 70 }); st.joints.set('Lj1', { x: 160, y: 70 }); st.shapes.push({ id: 'Ls0', type: 'line', joints: ['Lj0', 'Lj1'] });
    st.saveState('draw'); C.V2_PLAN.use(st); C.V2_PLAN.setOrder([]); C.V2_PLAN.clear(); return st.shapes.length; })`);
  const designEdit = async () => { // a Design edit: A widened (one undo step), then back to Prepare
    await openMode('design');
    await evalJs(`(() => { const st = window.__designController.state; st.saveState('edit'); st.joints.get('Aj1').x += 5; st.joints.get('Aj2').x += 5; window.__designController.engine.solve(500); })()`);
    await sleep(300); await openMode('prepare');
  };
  const ops = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => o.type + ':' + o.geometry.length))`);
  const cardState = () => evalJs(`(() => { const c = document.querySelector('#prepare-panel .cut-card'); return !c || c.hidden ? 'hidden' : 'open'; })()`);
  const head = () => evalJs(`document.querySelector('#prepare-panel .cut-op-head').textContent`);
  const notice = () => evalJs(`(() => { const n = document.getElementById('prepare-notice'); return n.hidden ? null : n.textContent; })()`);
  const marks = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row.is-out-of-date')].length`);
  const shownTypes = () => evalJs(`[...document.querySelectorAll('#prepare-ribbon .sk-ribbon-group[data-section="operations"] .sk-ribbon-btn')].filter((b) => !b.hidden).map((b) => b.id.replace('op-type-', ''))`);
  const layout = () => evalJs(`import('/packages/core/settings-manager.js').then((m) => JSON.stringify(m.default.get('RIBBON_LAYOUT') || null))`);
  // THE 805 PROBE: what lies outside the cut card (the canvas, the toolbar, the Operations list's header, Undo, the header)
  const outside = () => evalJs(`(() => { const out = {}; for (const sel of ['#prepare-canvas', '#prepare-ribbon-frame', '#prepare-ops .ops-head', '#btn-undo', '.sk-header']) { const e = document.querySelector(sel); if (!e) continue; const b = e.getBoundingClientRect(); out[sel] = [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 100) / 100).join(','); } return out; })()`);
  const sameOutside = async (ref, what) => assert.deepStrictEqual(await outside(), ref, `${what}: NOTHING outside the card moved (0 px)`);
  const pressType = async (id) => { // the type's bar button, or (not in the bar: a phone) its row in the Operations dropdown
    if (await evalJs(`!document.getElementById('op-type-${id}').hidden`)) { await clickEl(`#op-type-${id}`); return; }
    await clickEl('#prepare-ribbon .sk-ribbon-group[data-section="operations"] button.sk-ribbon-group-label');
    await clickEl(`.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="op-type-${id}"]`);
  };
  const load = async () => {
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"], .sk-sidebar-chevron')`, 'shaper app ready');
  };

  const phase = async (D) => {
    await resetBufferLive(cdp); await load();
    await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', 'mm'); })`);
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    assert.strictEqual(await draw(), 13, D + ': drawn');
    const designRibbon = await evalJs(`JSON.stringify((() => { const r = document.querySelector('#design-ribbon').getBoundingClientRect(); return [r.top, r.height]; })())`);
    await openMode('prepare');
    await listOpen(D === 'desktop');

    // the toolbar: Design's place and style
    const bar = await evalJs(`(() => { const f = document.getElementById('prepare-ribbon-frame'), r = f.getBoundingClientRect(), strip = document.querySelector('.sk-doctabs').getBoundingClientRect();
      const btns = [...document.querySelectorAll('#prepare-ribbon .sk-ribbon-btn')].filter((b) => !b.hidden).map((b) => { const q = b.getBoundingClientRect(); return [b.id, Math.round(q.width), Math.round(q.height)]; });
      const ops = document.getElementById('prepare-ops').getBoundingClientRect();
      return { dir: f.dataset.dir, top: r.top, stripBottom: strip.bottom, left: r.left, width: Math.round(r.width), height: Math.round(r.height), btns, opsTop: ops.top, opsLeft: ops.left,
        groups: [...document.querySelectorAll('#prepare-ribbon .sk-ribbon-group')].map((g) => g.dataset.section + ':' + g.querySelector('.sk-ribbon-group-label').textContent) }; })()`);
    console.log(`${D} toolbar: ${JSON.stringify(bar)} (Design's ribbon top, height: ${designRibbon})`);
    assert.deepStrictEqual(bar.groups, ['operations:Operations', 'recalculate:Recalculate'], D + ': the operation types, then Recalculate; named as Design\'s sections are');
    const ids = bar.btns.map((b) => b[0]);
    assert.deepStrictEqual(ids.filter((id) => id.startsWith('op-type-')), TYPES.map((t) => `op-type-${t}`).filter((id) => ids.includes(id)), D + ': the types in the declaration\'s order');
    assert.ok(ids.includes('op-recalculate'), D + ': Recalculate shown');
    if (D === 'landscape') {
      assert.strictEqual(bar.dir, 'column', D + ': the short viewport: the rail at the left, as Design\'s');
      assert.ok(Math.abs(bar.opsLeft - (bar.left + bar.width + 12)) <= 1, D + `: the Operations card starts right of the rail (${bar.opsLeft})`);
    } else {
      assert.strictEqual(bar.dir, 'row', D + ': a bar across the top, as Design\'s');
      assert.ok(Math.abs(bar.top - bar.stripBottom) <= 1, D + ': right below the document tab strip, where Design\'s ribbon is');
      if (D === 'desktop') assert.ok(Math.abs(bar.opsTop - (bar.top + bar.height + 12)) <= 1, D + `: the Operations card starts 12 px below the toolbar (top ${bar.opsTop})`);
    }
    if (D !== 'desktop') assert.ok(bar.btns.every(([, w, h]) => w >= 44 && h >= 44), D + ': 44 px targets: ' + JSON.stringify(bar.btns));
    assert.ok(TYPES.every((t) => ids.includes(`op-type-${t}`)) || D === 'phone', D + ': every type in the bar');
    await shot(`${D}-1-toolbar.png`);
    await shot(`${D}-1-toolbar-zoom.png`, '#prepare-ribbon-frame', D === 'desktop' ? 2 : 1);
    if (D === 'landscape') { // the short viewport: a type works from the rail
      await clickWorld(0, 20); await pressType('pocket');
      assert.deepStrictEqual([await cardState(), await head()], ['open', 'Pocket 1 · 1 shape'], D + ': Pocket from the rail: a new Pocket of A, open');
      await clickEl('#prepare-panel .cut-ok');
      return;
    }

    const ref = await outside();
    console.log(`${D} outside boxes: ${JSON.stringify(ref)}`);
    // a shape click: no card
    await clickWorld(0, 20);
    assert.strictEqual(await cardState(), 'hidden', D + ': a click on A: NO card');
    await sameOutside(ref, D + ': a shape click');
    // a type with A selected: a NEW Pocket, open; OK
    await pressType('pocket');
    assert.deepStrictEqual([await cardState(), await head()], ['open', 'Pocket 1 · 1 shape'], D + ': Pocket with A selected: a new Pocket, open');
    await sameOutside(ref, D + ': the new operation\'s card opens');
    await shot(`${D}-2-new-pocket-open.png`);
    await clickEl('#prepare-panel .cut-ok');
    await sameOutside(ref, D + ': OK');
    // nothing selected: an EMPTY operation, open; Cancel
    await clickWorld(110, 55);
    await pressType('interior');
    assert.deepStrictEqual([await cardState(), await head()], ['open', 'Inside 2 · no shapes yet'], D + ': Inside with nothing selected: an empty Inside, open');
    await clickEl('#prepare-panel .cut-cancel');
    assert.deepStrictEqual(await ops(), ['pocket:1'], D + ': Cancel: nothing created');
    // an impossible pick: the line, nothing created
    await clickWorld(80, 70);
    await pressType('pocket');
    assert.deepStrictEqual([await ops(), await cardState(), await notice()], [['pocket:1'], 'hidden', 'This open line can’t be a Pocket: a pocket needs a closed shape'], D + ': a Pocket of the open line: nothing created, the one plain line');
    await shot(`${D}-3-refusal-line.png`);
    // a row tap: no card
    await listOpen(true);
    await clickEl('#prepare-ops .ops-row .ops-pick');
    assert.strictEqual(await cardState(), 'hidden', D + ': a tap on the Pocket\'s row: NO card');
    await shot(`${D}-4-row-tap-no-card.png`);
    if (D === 'phone') await listOpen(false);

    // the Operations dropdown: uncheck Guide, drag Contour to the top; saved under Prepare's key; Design's untouched; survives a reload
    const designLayout = JSON.parse(await layout() || 'null');
    await clickEl('#prepare-ribbon .sk-ribbon-group[data-section="operations"] button.sk-ribbon-group-label');
    await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'the Operations dropdown');
    await shot(`${D}-5-operations-dropdown.png`, ['#prepare-ribbon-frame', '.sk-ribbon-sect-menu.show']);
    await clickEl('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row[data-id="op-type-guide"] .sk-ribbon-sect-check input');
    assert.ok(!(await shownTypes()).includes('guide'), D + ': Guide unchecked: it leaves the bar');
    const from = await boxOf('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row[data-id="op-type-contour"] .sk-ribbon-grip');
    const to = await boxOf('.sk-ribbon-sect-menu.show .sk-ribbon-sect-row[data-id="op-type-exterior"]');
    await holdDrag({ x: from.x, y: from.y }, { x: from.x, y: Math.round(to.top + 2) });
    assert.strictEqual((await shownTypes())[0], 'contour', D + ': Contour dragged to the top: first in the bar');
    await clickEl('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="op-type-guide"]'); // runs from the dropdown (the Pocket's row tap selected A: a Guide of A)
    assert.deepStrictEqual([await cardState(), await head()], ['open', 'Guide 1 · 1 shape'], D + ': Guide (not in the bar) runs from the dropdown');
    await clickEl('#prepare-panel .cut-cancel');
    const saved = JSON.parse(await layout());
    assert.strictEqual(saved.apps['shaper-prepare'].operations.order[0], 'op-type-contour', D + ': saved under RIBBON_LAYOUT.apps["shaper-prepare"].operations');
    assert.deepStrictEqual(saved.apps['shaper-prepare'].operations.off, ['op-type-guide'], D + ': (Guide off)');
    assert.deepStrictEqual(saved.apps.shaper || null, (designLayout && designLayout.apps && designLayout.apps.shaper) || null, D + ': Design\'s layout (apps.shaper) untouched');
    await shot(`${D}-6-reordered-bar.png`, '#prepare-ribbon-frame', D === 'desktop' ? 2 : 1);
    await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(800);
    await load(); await openMode('prepare');
    const after = await shownTypes();
    assert.ok(after[0] === 'contour' && !after.includes('guide'), D + ': after a reload: Contour first, Guide out of the bar: ' + JSON.stringify(after));
    await openMode('design');
    assert.ok(!(await evalJs(`[...document.querySelectorAll('#design-ribbon .sk-ribbon-btn')].some((b) => b.id.startsWith('op-'))`)), D + ': (Design\'s ribbon has no operation button)');
    await openMode('prepare');
    // back to the declared layout (Reset)
    await clickEl('#prepare-ribbon .sk-ribbon-group[data-section="operations"] button.sk-ribbon-group-label');
    await clickEl('.sk-ribbon-sect-menu.show .sk-ribbon-sect-reset');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);

    // OUT OF DATE: a Design edit marks the Pocket; Recalculate clears it; the Export waits for it
    await listOpen(true);
    assert.strictEqual(await marks(), 0, D + ': up to date');
    await designEdit();
    await listOpen(true);
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row.is-out-of-date').length === 1`, D + ': the Design edit: the Pocket out of date (its row\'s mark)');
    await shot(`${D}-7-out-of-date-row.png`, '#prepare-ops', D === 'desktop' ? 2 : 1);
    if (D === 'phone') await listOpen(false);
    await clickEl('#op-recalculate');
    await listOpen(true);
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row.is-out-of-date').length === 0`, D + ': Recalculate: the mark gone');
    if (D === 'phone') await listOpen(false);
    await clickEl('#op-recalculate');
    assert.strictEqual(await notice(), 'All toolpaths are up to date.', D + ': nothing to do: the plain line');
    await designEdit();
    await openMode('review');
    await evalJs(`document.getElementById('btn-generate-svg').scrollIntoView({ block: 'center' })`); await sleep(200);
    await clickEl('#btn-generate-svg');
    await waitFor(`/1 operation is out of date/.test(document.getElementById('simexport-status').textContent) && !!document.querySelector('#simexport-status .sk-wait-action')`, D + ': Generate waits: "1 operation is out of date" with Recalculate');
    await shot(`${D}-8-export-out-of-date.png`, '#simexport-panel', D === 'desktop' ? 2 : 1);
    await evalJs(`document.querySelector('#simexport-status .sk-wait-action').scrollIntoView({ block: 'center' })`); await sleep(200);
    await clickEl('#simexport-status .sk-wait-action');
    await waitFor(`/^Exported /.test(document.getElementById('simexport-status').textContent)`, D + ': Recalculate: then the file');
  };

  await load();
  await phase('desktop');
  touch = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await load();
  await phase('phone');
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await load();
  await phase('landscape');
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'no sideways scroll ' + JSON.stringify(side));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('opbar-s3-live: ok');
} finally { await close(); }
