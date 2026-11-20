// tests/op-list-743-live.test.js — TASK 743: Prepare's OPERATIONS list in the real Shaper page, desktop 1280 x 800 (real mouse, inches) and phone 390 x 844
// (real touch, mm). A 240 x 120 mm plate (Outside, 3/4 in deep, 1/4 in bit) with two holes (Inside, 3/4 in, 1/8 in bit), two 1/4 in deep pockets and one 1/8 in
// deep pocket (1/4 in bit) and an open slot line (On line, 1/16 in, 1/8 in bit):
//  * the list: tool headings ("Change to ⅛″ end mill" then "Change to ¼″ end mill": the 1/8 in bit's last cut is a hole, the 1/4 in bit's the outside cut
//    that frees the part) and the operations in the default order (On line, Inside | Pocket 1/8, Pocket 1/4, Outside), each with its depth in the doc unit;
//  * a tap on an operation selects its regions on the canvas (the card shows the type, the rows are marked);
//  * TASK 745: NO arrow buttons; a drag reorders (one undo step each: the footer's Undo puts the order back): on the desktop a mouse drag on the grip, on the
//    phone a PRESS-AND-HOLD (the row lifts) then a drag anywhere on the row; on the phone a quick swipe on the list scrolls it and reorders nothing, and a
//    hold released without a move selects nothing and reorders nothing; each row's delete bin unassigns its regions (one undo step brings them back);
//  * Export 2D: the same operations in the same order under the same headings; a header picks its elements. Operations are DISPLAY ONLY (owner ruling,
//    the 743 send-back): the downloaded SVG is byte-identical before and after the reorders, with no <g id> / <title> / data-*;
//  * phone: the list is a folded bar at the bottom (opens on a tap), its grips and bins are 44 px wide, no sideways scroll.
// Screenshots to .evidence/743/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/743');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '743-ops', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-743-dl-'));

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
    return { x, y, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
  const clickEl = async (sel) => {
    const p = await boxOf(sel);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
    return p;
  };
  // a drag from the centre of `fromSel` to the point `to` in small moves (mouse on the desktop: at once; one finger on the phone: TASK 745, held HOLD_MS + 150 first)
  const drag = async (fromSel, to) => {
    const p = await boxOf(fromSel);
    assert.ok(p && p.onTop, `${fromSel} is on screen: ${JSON.stringify(p)}`);
    const steps = 8;
    if (phone) {
      await T('touchStart', [{ x: p.x, y: p.y }]);
      await sleep(500);
      for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: p.x, y: Math.round(p.y + (to.y - p.y) * i / steps) }]); await sleep(30); }
      await T('touchEnd', []);
    } else {
      await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y, 1);
      for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', p.x, Math.round(p.y + (to.y - p.y) * i / steps), 1); await sleep(30); }
      await mouse('mouseReleased', p.x, to.y);
    }
    await sleep(300);
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
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  // the design: a plate, two holes, three pockets, an open slot line; then the cut plan on their loop / chain keys
  const drawAndPlan = () => evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/tests/helpers/plan-v2.js')]).then(([L, C]) => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const rect = (name, x0, y0, x1, y1) => { [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(name + 'j' + i, { x, y }));
      for (let i = 0; i < 4; i++) st.shapes.push({ id: name + 's' + i, type: 'line', joints: [name + 'j' + i, name + 'j' + ((i + 1) % 4)] }); };
    rect('PL', 0, 0, 240, 120);
    rect('PA', 20, 20, 70, 60); rect('PB', 90, 20, 140, 60); rect('PC', 160, 20, 210, 60);
    st.joints.set('HAc', { x: 60, y: 90 }); st.shapes.push({ id: 'HA', type: 'circle', joints: ['HAc'], radius: 8 });
    st.joints.set('HBc', { x: 180, y: 90 }); st.shapes.push({ id: 'HB', type: 'circle', joints: ['HBc'], radius: 8 });
    st.joints.set('SLa', { x: 95, y: 90 }); st.joints.set('SLb', { x: 145, y: 90 }); st.shapes.push({ id: 'SL', type: 'line', joints: ['SLa', 'SLb'] });
    const loops = L.findLoops(st), chains = L.findOpenChains(st, loops);
    const loopKey = (shapeId) => 'loop:' + loops.find((l) => l.edges.includes(shapeId)).id;
    const rec = (cutType, cutDepth, toolDia) => ({ cutType, cutDepth, cutOffset: 0, toolDia, cutterShape: 'endmill', cutterAngle: 90 });
    C.V2_PLAN.clear();
    C.V2_PLAN.set(loopKey('PLs0'), rec('exterior', 19.05, 6.35));
    C.V2_PLAN.set(loopKey('HA'), rec('interior', 19.05, 3.175));
    C.V2_PLAN.set(loopKey('PAs0'), rec('pocket', 6.35, 6.35));
    C.V2_PLAN.set(loopKey('PBs0'), rec('pocket', 3.175, 6.35));
    C.V2_PLAN.set(loopKey('HB'), rec('interior', 19.05, 3.175));
    C.V2_PLAN.set(loopKey('PCs0'), rec('pocket', 6.35, 6.35));
    C.V2_PLAN.set('chain:' + chains.find((c) => c.shapes.some((s) => s.id === 'SL')).id, rec('online', 1.5875, 3.175));
    return [...C.V2_PLAN.keys()];
  })`);
  const list = () => evalJs(`[...document.querySelectorAll('#prepare-ops .ops-body > *')].map((e) => e.classList.contains('ops-tool') ? '# ' + e.textContent : e.querySelector('.ops-num').textContent + '. ' + e.querySelector('.ops-name').textContent + ' | ' + e.querySelector('.ops-sub').textContent)`);
  const rowsText = (l) => l.filter((t) => !t.startsWith('# ')).map((t) => t.replace(/^\d+\. /, '').split(' | ')[0]);
  // the selector of the n-th operation row (1-based), or of `inner` in it
  const rowSel = async (n, inner = '') => `#prepare-ops .ops-row[data-id="${await evalJs(`document.querySelectorAll('#prepare-ops .ops-row')[${n - 1}].dataset.id`)}"] ${inner}`.trim();
  const stored = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => m.storeOps().map((o) => o.id))`); // TASK S1: the list order IS the stored operations' order
  let def0 = null; // the stored order before any reorder
  const download = async () => {
    await openMode('review'); // Generate Shaper SVG is on the Export step
    for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
    await clickEl('#btn-generate-svg');
    let file = null;
    for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
    assert.ok(file, 'the export downloaded');
    return fs.readFileSync(file, 'utf8');
  };
  const export2d = async (label) => {
    await openMode('review');
    if (await evalJs(`document.getElementById('review-view-2d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-2d');
    await waitFor(`document.querySelectorAll('#review-cuts-list .rv2d-op').length > 0`, label + ': the 2D list');
    await evalJs(`document.getElementById('review-side').scrollTop = 0`); // the list at the top of the side card (a download scrolled it to the buttons)
    await sleep(300);
    const l = await evalJs(`[...document.querySelectorAll('#review-cuts-list > *')].filter((e) => e.matches('.rv2d-tool, .rv2d-op')).map((e) => e.matches('.rv2d-tool') ? '# ' + e.textContent : e.firstChild.textContent)`);
    console.log(label + ' 2D list: ' + JSON.stringify(l));
    return l;
  };

  const phase = async (label) => {
    const D = phone ? 'phone' : 'desktop';
    const unit = await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit())`);
    const L = unit === 'in' ? { online: '0.063 in', full: '0.75 in', shallow: '0.125 in', deep: '0.25 in' } : { online: '1.587 mm', full: '19.05 mm', shallow: '3.175 mm', deep: '6.35 mm' };
    await openMode('design');
    await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
    const keys = await drawAndPlan();
    console.log(label + ' plan: ' + JSON.stringify(keys));
    await openMode('prepare');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length === 5`, label + ': 5 operations listed');
    if (phone) { // folded on a phone: a bar at the bottom; a tap opens it
      const bar = await boxOf('#prepare-ops .ops-head');
      console.log(label + ' folded bar: ' + JSON.stringify(bar));
      assert.ok(await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`), label + ': folded on a phone');
      assert.ok(bar.h >= 44, label + ': the bar is a 44 px target');
      await shot(`${D}-prepare-folded.png`);
      await clickEl('#prepare-ops .ops-head');
      await waitFor(`!document.querySelector('#prepare-ops .ops-body').hidden`, label + ': the list opens');
    }
    const l0 = await list();
    console.log(label + ' list: ' + JSON.stringify(l0));
    assert.deepStrictEqual(l0, ['# Change to ⅛″ end mill', `1. On line · ${L.online} | 1 path`, `2. Inside · ${L.full} | 2 regions`,
      '# Change to ¼″ end mill', `3. Pocket · ${L.shallow} | 1 region`, `4. Pocket · ${L.deep} | 2 regions`, `5. Outside · ${L.full} | 1 region`], label + ': the default order under tool headings');
    def0 = await stored(); // TASK S1: the default order, as stored
    assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-ops .ops-up, #prepare-ops .ops-down, #prepare-ops .ops-move').length`), 0, label + ': TASK 745: no arrow buttons');
    const targets = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-grip, #prepare-ops .ops-del')].map((b) => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)]; })`);
    assert.strictEqual(targets.length, 10, label + ': a grip and a bin on each of the 5 rows');
    if (phone) for (const [c, w, h] of targets) assert.ok(w >= 44 && h >= 44, `${label}: ${c} is ${w} x ${h} (44 px on a phone)`);
    await shot(`${D}-prepare-ops.png`);
    await shot(`${D}-ops-list.png`, '#prepare-ops', phone ? 1 : 2);

    // a tap on "Pocket · 1/4 in (2 regions)" selects both pockets on the canvas
    await clickEl(await rowSel(4, '.ops-pick'));
    const picked = await evalJs(`(() => { const v = window.__prepareView; return { sel: [...v.selection.keys()].sort(), drawn: document.querySelectorAll('#prepare-select-group path').length,
      card: document.querySelector('.cut-type-cur').textContent, marked: [...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => r.classList.contains('is-picked')) }; })()`);
    console.log(label + ' picked: ' + JSON.stringify(picked));
    assert.deepStrictEqual(picked.sel, [keys[2], keys[5]].sort(), label + ': the tap selected the two 1/4 in deep pockets');
    assert.strictEqual(picked.drawn, 2, label + ': both are drawn selected on the canvas');
    assert.strictEqual(picked.card, 'Pocket', label + ': the card shows their type');
    assert.deepStrictEqual(picked.marked, [false, false, false, true, false], label + ': the row is marked');
    await shot(`${D}-prepare-op-picked.png`);
    const file0 = await download(); // the export before any reorder (Generate lives on the Export step: come back after)
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-download-default.svg`), file0);
    await openMode('prepare');
    if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');

    // TASK 745, the phone: a quick swipe on the list scrolls and reorders nothing; a hold released without a move lifts the row, then selects and reorders nothing
    if (phone) {
      const order0 = rowsText(await list());
      const sel0 = await evalJs(`window.__prepareView.selection.size`);
      const r2 = await boxOf(await rowSel(2, '.ops-name'));
      await evalJs(`document.querySelector('#prepare-ops .ops-body').scrollTop = 0`);
      await T('touchStart', [{ x: r2.x, y: r2.y }]);
      for (let i = 1; i <= 6; i++) { await T('touchMove', [{ x: r2.x, y: r2.y - 14 * i }]); await sleep(16); }
      await T('touchEnd', []);
      await sleep(400);
      const swiped = await evalJs(`({ lifted: document.querySelectorAll('#prepare-ops .ops-lifted').length, scrollable: (() => { const b = document.querySelector('#prepare-ops .ops-body'); return b.scrollHeight > b.clientHeight; })(), scrollTop: document.querySelector('#prepare-ops .ops-body').scrollTop })`);
      console.log(label + ' swipe: ' + JSON.stringify(swiped));
      assert.deepStrictEqual(rowsText(await list()), order0, label + ': a quick swipe reorders nothing');
      assert.deepStrictEqual(await stored(), def0, label + ': nothing stored by the swipe');
      if (swiped.scrollable) assert.ok(swiped.scrollTop > 0, label + ': the swipe scrolled the list');
      await evalJs(`document.querySelector('#prepare-ops .ops-body').scrollTop = 0`);
      await sleep(200);
      const r3 = await boxOf(await rowSel(3, '.ops-name'));
      await T('touchStart', [{ x: r3.x, y: r3.y }]);
      await sleep(550);
      const lifted = await evalJs(`[...document.querySelectorAll('#prepare-ops .ops-row')].map((r) => r.classList.contains('ops-lifted'))`);
      await shot(`${D}-ops-row-lifted.png`, '#prepare-ops', 2);
      await T('touchEnd', []);
      await sleep(500);
      assert.deepStrictEqual(lifted, [false, false, true, false, false], label + ': after the hold the row is LIFTED');
      assert.deepStrictEqual(rowsText(await list()), order0, label + ': hold + release reorders nothing');
      assert.strictEqual(await evalJs(`window.__prepareView.selection.size`), sel0, label + ': hold + release selects nothing (the row\u2019s tap is swallowed)');
      assert.strictEqual(await evalJs(`document.querySelectorAll('#prepare-ops .ops-lifted').length`), 0, label + ': the row drops back');
    }
    // a drag of operation 1 (On line) below operation 2 (Inside): Inside first; the order is stored; the footer Undo puts it back, Redo again
    const b2 = await boxOf(await rowSel(2));
    await drag(phone ? await rowSel(1, '.ops-name') : await rowSel(1, '.ops-grip'), { y: b2.y + Math.round(b2.h / 2) - 4 });
    const l1 = await list();
    console.log(label + ' after drag 1: ' + JSON.stringify(l1));
    assert.deepStrictEqual(rowsText(l1), [`Inside · ${L.full}`, `On line · ${L.online}`, `Pocket · ${L.shallow}`, `Pocket · ${L.deep}`, `Outside · ${L.full}`], label + ': the drag moved On line below Inside');
    assert.ok((await stored()).length === 5 && JSON.stringify(await stored()) !== JSON.stringify(def0), label + ': the order is stored (the 5 operations in their new order)');
    await clickEl('#btn-undo');
    await waitFor(`document.querySelector('#prepare-ops .ops-row .ops-name').textContent.startsWith('On line')`, label + ': Undo puts On line back first');
    assert.deepStrictEqual(rowsText(await list()), rowsText(l0), label + ': Undo: the default order again');
    await clickEl('#btn-redo');
    await waitFor(`document.querySelector('#prepare-ops .ops-row .ops-name').textContent.startsWith('Inside')`, label + ': Redo moves it again');
    // the last (Outside) dragged above the deep pocket
    const b4 = await boxOf(await rowSel(4));
    await drag(phone ? await rowSel(5, '.ops-name') : await rowSel(5, '.ops-grip'), { y: b4.y - Math.round(b4.h / 2) + 6 });
    const l2 = await list();
    console.log(label + ' after drag 2: ' + JSON.stringify(l2));
    assert.deepStrictEqual(rowsText(l2), [`Inside · ${L.full}`, `On line · ${L.online}`, `Pocket · ${L.shallow}`, `Outside · ${L.full}`, `Pocket · ${L.deep}`], label + ': the drag moved Outside above the deep pocket');
    // a drag on the grip of row 5 (Pocket 1/4 in) to the top of row 3 (Pocket 1/8 in): it goes before it
    const r3 = await boxOf(await rowSel(3));
    await drag(await rowSel(5, phone ? '.ops-name' : '.ops-grip'), { y: r3.top + 6 }); // the phone holds the row anywhere
    const l3 = await list();
    console.log(label + ' after drag: ' + JSON.stringify(l3));
    assert.deepStrictEqual(rowsText(l3), [`Inside · ${L.full}`, `On line · ${L.online}`, `Pocket · ${L.deep}`, `Pocket · ${L.shallow}`, `Outside · ${L.full}`], label + ': the drag put the deep pocket above the shallow one');
    assert.deepStrictEqual(l3.filter((t) => t.startsWith('# ')), ['# Change to ⅛″ end mill', '# Change to ¼″ end mill'], label + ': still two tool headings');
    await shot(`${D}-prepare-ops-reordered.png`);
    await shot(`${D}-ops-list-reordered.png`, '#prepare-ops', phone ? 1 : 2);
    // the drag is one undo step too
    await clickEl('#btn-undo');
    await waitFor(`[...document.querySelectorAll('#prepare-ops .ops-name')].map((e) => e.textContent).join('|') === ${JSON.stringify(rowsText(l2).join('|'))}`, label + ': Undo of the drag');
    await clickEl('#btn-redo');
    await waitFor(`[...document.querySelectorAll('#prepare-ops .ops-name')].map((e) => e.textContent).join('|') === ${JSON.stringify(rowsText(l3).join('|'))}`, label + ': Redo of the drag');

    // Export 2D: the same operations, the same order, the same headings
    const l2d = await export2d(label);
    assert.deepStrictEqual(l2d.filter((t) => t.startsWith('# ')), ['# Change to ⅛″ end mill', '# Change to ¼″ end mill'], label + ': 2D: the tool headings');
    assert.deepStrictEqual(l2d.filter((t) => !t.startsWith('# ')), l3.filter((t) => !t.startsWith('# ')).map((t) => t.replace(/^\d+\. /, '').replace(' | ', ' · ')), label + ': 2D: the operations in the Prepare order, in its words');
    await shot(`${D}-export-2d-ops.png`, phone ? null : ['#review-stage', '#review-side']);
    if (!phone) await shot(`${D}-export-2d-list.png`, '#review-cuts', 2);
    // a tap on an operation's header picks every element of it (the two 1/8 in holes)
    await clickEl('#review-cuts-list .rv2d-op');
    const opPick = await evalJs(`({ label: document.getElementById('review-2d-info').textContent, picked: [...document.querySelectorAll('#review-2d-canvas .rv2d-picked')].map((e) => e.localName), pressed: document.querySelector('#review-cuts-list .rv2d-op').getAttribute('aria-pressed') })`);
    console.log(label + ' 2D op pick: ' + JSON.stringify(opPick));
    assert.deepStrictEqual(opPick, { label: `⅛″ end mill · Inside · ${L.full} (2 regions) · 2 elements`, picked: ['circle', 'circle'], pressed: 'true' }, label + ': 2D: the operation header picks its elements');
    if (phone) await shot(`${D}-export-2d-op-picked.png`);
    // the downloaded file: the operations are a display grouping, the file is byte-identical before and after the reorders
    const file1 = await download();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${D}-download-reordered.svg`), file1);
    console.log(label + ` download: ${file0.length} bytes before, ${file1.length} after the reorders`);
    assert.strictEqual(file1, file0, label + ': the download is byte-identical before and after the reorders');
    assert.ok(!/<g id=|<title>|data-/.test(file1), label + ': no <g id>, <title> or data-* in the downloaded file');
    // TASK 745: the bin of the Inside operation (the 2 holes): both unassigned in ONE undo step, the export loses exactly those two elements; Undo brings them back
    await openMode('prepare');
    if (phone && await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');
    const plan0 = await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => JSON.stringify([...m.V2_PLAN]))`);
    const order0 = await stored();
    assert.ok(/^Inside/.test(rowsText(await list())[0]), label + ': row 1 is the Inside operation');
    await clickEl(await rowSel(1, '.ops-del'));
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length === 4`, label + ': the operation is gone');
    const holes = await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => [${JSON.stringify(keys[1])}, ${JSON.stringify(keys[4])}].map((k) => m.V2_PLAN.get(k) && m.V2_PLAN.get(k).cutType))`); // TASK S1: binned, they are in no operation (get: null)
    assert.deepStrictEqual(holes, [null, null], label + ': both holes unassigned');
    await shot(`${D}-ops-after-delete.png`, '#prepare-ops', phone ? 1 : 2);
    const file2 = await download();
    // the file's elements with their resolved cut attributes (a <g> hoists the shared ones)
    const els = (f) => { const out = []; let g = ''; for (const l of f.split(String.fromCharCode(10)).map((x) => x.trim())) { if (l.startsWith('<g')) throw new Error('TASK 802: the export has a <g>'); else if (/^<(path|circle)/.test(l)) out.push(l.replace('/>', ' ' + g).trim()); } return out; };
    const gone = els(file1).filter((l) => !els(file2).includes(l)), added = els(file2).filter((l) => !els(file1).includes(l));
    console.log(label + ' delete: the export lost ' + JSON.stringify(gone) + ', gained ' + JSON.stringify(added));
    assert.deepStrictEqual(gone.map((l) => [l.split(' ')[0], /toolDia="0\.125 in"|toolDia="3\.175 mm"/.test(l)]), [['<circle', true], ['<circle', true]], label + ': the export loses exactly the two holes’ own cuts (1/8 in bit)');
    assert.deepStrictEqual(added.map((l) => [l.split(' ')[0], /cutType="inside"/.test(l), /toolDia="0\.250 in"|toolDia="6\.350 mm"/.test(l)]), [['<circle', true, true], ['<circle', true, true]],
      label + ': unassigned, they are the Outside plate’s automatic holes again (TASK 711: a hole with no record of its own is cut by its plate, with the plate’s bit)');
    assert.strictEqual(els(file2).length, els(file1).length, label + ': nothing else changes');
    await openMode('prepare');
    await clickEl('#btn-undo');
    await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length === 5`, label + ': Undo brings the operation back');
    assert.strictEqual(await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => JSON.stringify([...m.V2_PLAN]))`), plan0, label + ': Undo: the records as before');
    assert.deepStrictEqual(await stored(), order0, label + ': and the order (the operation in its place)');
    assert.deepStrictEqual(rowsText(await list()), rowsText(l3), label + ': the list as before');
    assert.strictEqual(await download(), file1, label + ': the export as before');
    await openMode('prepare');
  };

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await setUnit('in');
  await phase('desktop (in)');

  // the phone: 390 x 844, real touch, a reloaded page in mm
  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper app ready (phone)');
  await setUnit('mm');
  await phase('phone (mm)');
  // TASK 745: a list long enough to scroll (12 pockets, 12 depths = 12 operations): a quick swipe on a row SCROLLS the list (native scrolling) and reorders nothing
  await openMode('design');
  await evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/tests/helpers/plan-v2.js'), import('/apps/shaper/src/operations.js')]).then(([L, C, O]) => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    for (let n = 0; n < 12; n++) { const x0 = (n % 4) * 30, y0 = Math.floor(n / 4) * 30; [[x0, y0], [x0 + 20, y0], [x0 + 20, y0 + 20], [x0, y0 + 20]].forEach(([x, y], i) => st.joints.set('Q' + n + 'j' + i, { x, y }));
      for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Q' + n + 's' + i, type: 'line', joints: ['Q' + n + 'j' + i, 'Q' + n + 'j' + ((i + 1) % 4)] }); }
    const loops = L.findLoops(st);
    C.V2_PLAN.use(st); C.V2_PLAN.setOrder([]); C.V2_PLAN.clear();
    for (let n = 0; n < 12; n++) C.V2_PLAN.set('loop:' + loops.find((l) => l.edges.includes('Q' + n + 's0')).id, { cutType: 'pocket', cutDepth: n + 1, cutOffset: 0, toolDia: 6.35, cutterShape: 'endmill', cutterAngle: 90 });
  })`);
  await openMode('prepare');
  await waitFor(`document.querySelectorAll('#prepare-ops .ops-row').length === 12`, 'phone: 12 operations');
  if (await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickEl('#prepare-ops .ops-head');
  await evalJs(`document.querySelector('#prepare-ops .ops-body').scrollTop = 0`);
  await sleep(200);
  const before = rowsText(await list()), phone0 = await stored();
  const can = await evalJs(`(() => { const b = document.querySelector('#prepare-ops .ops-body'); return { sh: b.scrollHeight, ch: b.clientHeight }; })()`);
  assert.ok(can.sh > can.ch, 'phone: the 12-row list overflows its sheet (it scrolls) ' + JSON.stringify(can));
  const rr = await boxOf('#prepare-ops .ops-row:nth-of-type(3) .ops-name');
  await T('touchStart', [{ x: rr.x, y: rr.y }]);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: rr.x, y: rr.y - 18 * i }]); await sleep(16); }
  await T('touchEnd', []);
  await sleep(600);
  const after = await evalJs(`({ top: document.querySelector('#prepare-ops .ops-body').scrollTop, lifted: document.querySelectorAll('#prepare-ops .ops-lifted').length, sel: window.__prepareView.selection.size })`);
  console.log('phone swipe on a long list: ' + JSON.stringify(after));
  assert.ok(after.top > 0, 'phone: the quick swipe scrolled the list (scrollTop ' + after.top + ')');
  assert.deepStrictEqual([after.lifted, after.sel], [0, 0], 'phone: no row lifted, nothing selected');
  assert.deepStrictEqual(rowsText(await list()), before, 'phone: the swipe reordered nothing');
  assert.deepStrictEqual(await stored(), phone0, 'phone: no order stored (the stored order unchanged)');
  await shot('phone-ops-long-list-swiped.png', '#prepare-ops', 1);
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('op-list-743-live: ok');
} finally { await close(); }
