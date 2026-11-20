// tests/hold-part-742-live.test.js — TASK 742: HOLD PART on a Shaper Outside cut in the real page, desktop 1280 x 800 with real mouse clicks and phone
// 390 x 844 with real touch taps. A 200 x 100 mm plate with a 15 mm hole, Outside, depth 18 mm:
//  * the card: Hold part Off | Tabs | Onion skin; Tabs -> count Auto (4), width 10 mm, thickness 2 mm (on the phone, a reloaded page in INCHES: 3/8 in,
//    1/16 in); the note; count + -> 5, width + , thickness - ; every change redraws Prepare's tab marks (.sk-tab-mark) and gap strips (.sk-strip);
//  * Export 2D: the hole, 1 pass (outside, depth - thickness), N gap strips (inside, full depth) == the downloaded file, element by element; the list
//    says "pass (tabs)" and "gaps"; every path of the file is closed; no data-* in the file;
//  * Export 3D: the info lists the pass and the gaps, the board shows the tabs standing (screenshot);
//  * Onion skin: one skin mark, no strips; 2D: one pass, no strips == the file.
// Screenshots to .evidence/742/.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { clickOpenLive, stepLive, previewLive } from './helpers/prepare-open-live.js'; // TASK S2: an operation is opened, changed, confirmed; TASK 817: its paths drawn on its Preview

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/742');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const cdp = await launchBrowser({ tag: '742-tabs', width: 1280, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-742-dl-'));

// the file's elements (a <g> hoists the shared attributes; its children inherit them)
function fileElements(svg) {
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const out = []; let group = null;
  for (const line of svg.split('\n').map((l) => l.trim())) {
    if (line.startsWith('<g')) throw new Error('TASK 802: the export has a <g>, every element must carry its own cut attributes: ' + line);
    if (line.startsWith('</g')) { group = null; continue; }
    const m = /^<(path|circle|polygon)\s(.*)\/>$/.exec(line);
    if (!m) continue;
    const a = { ...(group || {}), ...attrs(m[2]) };
    out.push({ key: `${m[1]} ${a['shaper:cutType']} ${a['shaper:cutDepth']}`, d: a.d || null });
  }
  return out;
}

try {
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const shot = async (name, sels = null) => {
    let clip = null;
    if (sels) clip = await evalJs(`(() => { const rs = ${JSON.stringify([].concat(sels))}.map((q) => document.querySelector(q).getBoundingClientRect());
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - 4), y = Math.max(0, Math.min(...rs.map((r) => r.top)) - 4);
      return { x, y, width: Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 4) - x, height: Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 4) - y, scale: 1 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  let phone = false;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
  const press = async (x, y) => {
    if (phone) { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); }
    else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(250);
  };
  const clickElRaw = async (sel) => {
    await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'nearest' }); })()`);
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, w: r.width, h: r.height, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
    return p;
  };
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickEl('.sk-sidebar-chevron'); // the drawer may still be open from the last stage pick
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickEl(`.sk-sidebar-stage[data-tab="${mode}"]`);
      } else await clickEl(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const clickWorldRaw = async (x, y) => {
    const p = await evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const pt = svg.createSVGPoint(); pt.x = ${x}; pt.y = ${y};
      const s = pt.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
    await press(p.x, p.y);
  };
  // TASK S2 (docs/OPERATIONS-MODEL.md 9.1): the steps of before S2 in today's terms (tests/helpers/prepare-open-live.js): a click on the canvas = OK on the open
  // operation, the click, and the clicked shape's operation opened (it is in one); a press / a typed field that changes the open operation = its own step
  const s2Steps = { get phone() { return phone; }, evalJs, waitFor, clickEl: clickElRaw };
  const clickEl = (sel) => stepLive(s2Steps, () => clickElRaw(sel));
  const clickWorld = (x, y) => clickOpenLive(s2Steps, () => clickWorldRaw(x, y));
  const typeInto = async (sel, text) => { // a real focus by click, select all, typed text, Enter (the field's change)
    await clickEl(sel);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.insertText', { text });
    await evalJs(`document.querySelector(${JSON.stringify(sel)}).blur()`);
    await sleep(200);
  };
  const rec = () => evalJs(`import('/tests/helpers/plan-v2.js').then((m) => { const r = [...m.V2_PLAN.values()].find((x) => x.cutType === 'exterior'); return r ? { holdPart: r.holdPart, tabCount: r.tabCount, tabWidth: r.tabWidth, holdThickness: r.holdThickness, cutDepth: r.cutDepth } : null; })`);
  const note = () => evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  const marks = () => evalJs(`({ tabs: document.querySelectorAll('#prepare-canvas .sk-tab-mark').length, strips: document.querySelectorAll('#prepare-canvas .sk-strip').length, skin: document.querySelectorAll('#prepare-canvas .sk-skin-mark').length })`);
  const shownElements = () => evalJs(`import('/apps/shaper/src/export-preview.js').then((m) => m.previewItems(document.querySelector('#review-2d-canvas .rv2d-doc') || document.createElement('div')).map((e) => ({ key: e.tag + ' ' + e.cutType + ' ' + e.depth, d: e.el.getAttribute('d'), hold: e.el.getAttribute('data-hold') })))`);
  const download = async () => {
    for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f));
    await clickEl('#btn-generate-svg');
    let file = null;
    for (let i = 0; i < 100 && !file; i++) { const f = fs.readdirSync(dlDir).find((n) => n.endsWith('.svg')); if (f) file = path.join(dlDir, f); else await sleep(100); }
    assert.ok(file, 'the export downloaded');
    return fs.readFileSync(file, 'utf8');
  };
  // the Top view's centre column, magnified: the board's centre is the canvas centre there, so the tab in the middle of the y = 0 side and the hole are in it
  const shot3dCentre = async (name) => {
    const clip = await evalJs(`(() => { const r = document.getElementById('review-canvas-host').getBoundingClientRect(); const w = Math.min(r.width, 160);
      return { x: Math.round(r.left + r.width / 2 - w / 2), y: Math.round(r.top), width: Math.round(w), height: Math.round(r.height), scale: 3 }; })()`);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  const drawPlate = () => evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    [[0, 0], [200, 0], [200, 100], [0, 100]].forEach(([x, y], i) => st.joints.set('P' + i, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: 'Ps' + i, type: 'line', joints: ['P' + i, 'P' + ((i + 1) % 4)] });
    st.joints.set('Ho', { x: 100, y: 50 }); st.shapes.push({ id: 'H', type: 'circle', joints: ['Ho'], radius: 15 });
  })()`);

  // TASK 743: the 2D view paints the OUTSIDE elements at the back, deepest first (export-preview.js): its element order = the file's with those moved first
  const paintOrder = (list, keyOf = (e) => e) => { const depth = (e) => parseFloat(keyOf(e).split(' ')[2]); const outs = list.filter((e) => keyOf(e).split(' ')[1] === 'outside').sort((a, b) => depth(b) - depth(a)); return [...outs, ...list.filter((e) => !outs.includes(e))]; };
  // a 2D check: the shown elements == the downloaded file (type + depth + geometry, element by element), every path closed, no data-* in the file
  const export2d = async (label, expectKeys, expectHolds) => {
    await openMode('review');
    if (await evalJs(`document.getElementById('review-view-2d').getAttribute('aria-pressed')`) !== 'true') await clickEl('#review-view-2d');
    await waitFor(`document.querySelectorAll('#review-2d-canvas .rv2d-doc *').length >= ${expectKeys.length}`, label + ': the 2D view');
    await sleep(300);
    const shown = await shownElements();
    console.log(label + ' 2D: ' + JSON.stringify(shown.map((e) => e.key + (e.hold ? ' [' + e.hold + ']' : ''))));
    const expected = paintOrder(expectKeys.map((k, i) => ({ key: k, hold: expectHolds[i] })), (e) => e.key); // the file order given, as the view paints it
    assert.deepStrictEqual(shown.map((e) => e.key), expected.map((e) => e.key), label + ': the 2D view elements');
    assert.deepStrictEqual(shown.map((e) => e.hold), expected.map((e) => e.hold), label + ': the preview\'s pass / gap marks');
    const rows = await evalJs(`[...document.querySelectorAll('#review-cuts-list .rv2d-row')].map((b) => b.textContent)`);
    console.log(label + ' list: ' + JSON.stringify(rows));
    const file = await download();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${label}-download.svg`), file);
    const fe = fileElements(file);
    assert.deepStrictEqual(shown.map((e) => [e.key, e.d]), paintOrder(fe, (e) => e.key).map((e) => [e.key, e.d]), label + ': the 2D view == the downloaded file, element by element (geometry too)');
    assert.ok(!/data-/.test(file), label + ': the downloaded file has no data-* attribute');
    assert.ok(fe.every((e) => !e.d || /Z\s*$/.test(e.d)), label + ': every path of the file is CLOSED');
    return { shown, rows, file };
  };

  const phase = async (label) => {
    const D = phone ? 'phone' : 'desktop';
    await openMode('prepare');
    await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas ready');
    await clickWorld(20, 20); // inside the plate, off the hole
    await waitFor(`!document.querySelector('.cut-card').hidden`, 'the cut card');
    await clickEl('#prepare-panel .cut-type-trigger');
    await waitFor(`!document.querySelector('.cut-type-menu').hidden`, 'the type menu');
    await clickEl('.cut-type-opt[data-id="exterior"]');
    await waitFor(`document.querySelector('.cut-type-cur').textContent.toLowerCase().includes('outside')`, 'Outside picked');
    const unit = await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.docUnit())`);
    await typeInto('.cut-depth', unit === 'in' ? '0.75' : '18');
    // Hold part row: Off active, no other hold row
    assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('.cut-row[data-row="holdPart"] .cut-preset')].map((b) => b.textContent + (b.classList.contains('is-active') ? '*' : ''))`), ['Off*', 'Tabs', 'Onion skin'], label + ': Off | Tabs | Onion skin, Off');
    assert.deepStrictEqual(await marks(), { tabs: 0, strips: 0, skin: 0 }, label + ': Off: no marks');
    await clickEl('.cut-row[data-row="holdPart"] .cut-preset[data-value="tabs"]');
    await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => /tabs?,/.test(d.textContent))`, label + ': the tabs note');
    const r1 = await rec();
    console.log(label + ' record: ' + JSON.stringify(r1));
    const fields = await evalJs(`({ count: document.querySelector('.cut-tab-count').value, placeholder: document.querySelector('.cut-tab-count').placeholder, width: document.querySelector('.cut-tab-width').value, thick: document.querySelector('.cut-hold-thickness').value })`);
    console.log(label + ' fields: ' + JSON.stringify(fields) + ' note: ' + JSON.stringify(await note()));
    if (unit === 'in') {
      assert.deepStrictEqual([r1.tabCount, r1.tabWidth, r1.holdThickness], ['auto', 25.4 * 3 / 8, 25.4 / 16], label + ': inch defaults 3/8 in wide, 1/16 in thick');
      assert.deepStrictEqual(await note(), ['Outside: 4 tabs, 0.375 in wide, 0.063 in thick: 1 pass at 0.688 in + 4 gaps at 0.75 in', 'Gaps: cut the side against the part; the return leg is optional'], label + ': the note in inches');
    } else {
      assert.deepStrictEqual([r1.tabCount, r1.tabWidth, r1.holdThickness], ['auto', 10, 2], label + ': mm defaults 10 mm wide, 2 mm thick');
      assert.deepStrictEqual(await note(), ['Outside: 4 tabs, 10 mm wide, 2 mm thick: 1 pass at 16 mm + 4 gaps at 18 mm', 'Gaps: cut the side against the part; the return leg is optional'], label + ': the note');
    }
    assert.strictEqual(fields.placeholder, 'Auto (4)', label + ': count Auto (4)');
    await previewLive(s2Steps, label + ': the Preview of Tabs'); // TASK 817: the open operation's tab marks / strips are its paths: drawn on its Preview (generated in the background)
    assert.deepStrictEqual(await marks(), { tabs: 4, strips: 4, skin: 0 }, label + ': Prepare: 4 tab marks, 4 strips');
    // every hold target is reachable; on the phone >= 44 px and the card fits
    const targets = await evalJs(`[...document.querySelectorAll('.cut-row[data-row="holdPart"] .cut-preset, .cut-row[data-row="tabCount"] .cut-step, .cut-row[data-row="tabWidth"] .cut-step, .cut-row[data-row="holdThickness"] .cut-step')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.width), Math.round(r.height)]; })`);
    console.log(label + ' hold targets: ' + JSON.stringify(targets));
    if (phone) for (const [n, w, h] of targets.filter((t) => t[0] === '−' || t[0] === '+')) assert.ok(w >= 44 && h >= 44, `${label} stepper ${n}: ${w} x ${h}`);
    const fit = await evalJs(`(() => { const c = document.querySelector('.cut-card').getBoundingClientRect(); const bx = [...document.querySelectorAll('.cut-card .cut-box')].map((b) => b.scrollWidth - b.clientWidth);
      return { left: c.left, right: c.right, vw: innerWidth, docScroll: document.documentElement.scrollWidth, boxOverflow: Math.max(...bx), hold: [...document.querySelectorAll('.cut-row[data-row="holdPart"] .cut-preset')].map((b) => b.scrollWidth - b.clientWidth) }; })()`);
    console.log(label + ' card fit: ' + JSON.stringify(fit));
    assert.ok(fit.left >= 0 && fit.right <= fit.vw && fit.docScroll <= fit.vw && fit.boxOverflow <= 0 && Math.max(...fit.hold) <= 0, label + ': the card and its Hold part buttons fit');
    // the card with the Tabs rows still fits the Prepare view: its rows scroll, so the last row (cutter shape) is reachable
    const reach = await evalJs(`(() => { const v = document.getElementById('view-prepare').getBoundingClientRect(), c = document.querySelector('.cut-card').getBoundingClientRect();
      const sh = document.querySelector('.cut-row[data-row="cutterShape"] .cut-shape-trigger'); sh.scrollIntoView({ block: 'nearest' }); const r = sh.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const rows = document.querySelector('.cut-card .cut-rows');
      return { cardBottom: Math.round(c.bottom), viewBottom: Math.round(v.bottom), shapeReachable: !!hit && sh.contains(hit), scroll: [rows.scrollHeight, rows.clientHeight, rows.scrollTop] }; })()`);
    console.log(label + ' card reach: ' + JSON.stringify(reach));
    assert.ok(reach.cardBottom <= reach.viewBottom && reach.shapeReachable, label + ': the card ends inside the view and its last row is reachable');
    await evalJs(`document.querySelector('.cut-card .cut-rows').scrollTop = 0`);
    await shot(`${D}-prepare-tabs-4.png`, '#prepare-canvas');
    await shot(`${D}-card-tabs.png`, '#prepare-panel .cut-card');
    // count + -> 5; width + (one step); thickness - (one step)
    await clickEl('.cut-row[data-row="tabCount"] .cut-step[data-d="1"]');
    await previewLive(s2Steps, label + ': the Preview of 5 tabs');
    await waitFor(`document.querySelectorAll('#prepare-canvas .sk-tab-mark').length === 5`, label + ': 5 tab marks after count +');
    assert.strictEqual((await rec()).tabCount, 5, label + ': count 5');
    await clickEl('.cut-row[data-row="tabWidth"] .cut-step[data-d="1"]');
    await clickEl('.cut-row[data-row="holdThickness"] .cut-step[data-d="-1"]');
    const r2 = await rec();
    console.log(label + ' after +/-: ' + JSON.stringify(r2) + ' note: ' + JSON.stringify(await note()));
    if (unit === 'in') { assert.ok(Math.abs(r2.tabWidth - 25.4 * 7 / 16) < 1e-9 && Math.abs(r2.holdThickness - 25.4 * 3 / 64) < 1e-9, label + ': width 7/16 in, thickness 3/64 in'); }
    else { assert.ok(r2.tabWidth === 11 && r2.holdThickness === 1.5, label + ': width 11, thickness 1.5'); }
    await previewLive(s2Steps, label + ': the Preview of the wider, thinner tabs');
    assert.deepStrictEqual(await marks(), { tabs: 5, strips: 5, skin: 0 }, label + ': Prepare: 5 tab marks, 5 strips');
    await shot(`${D}-prepare-tabs-5.png`, '#prepare-canvas');
    const pass = unit === 'in' ? '0.703 in' : '16.500 mm', full = unit === 'in' ? '0.750 in' : '18.000 mm';
    const ex = await export2d(`${D}-tabs`, [...Array(6).fill(`path inside ${full}`).map((k, i) => (i === 0 ? `circle inside ${full}` : k)), `path outside ${pass}`],
      [null, 'gap 1/5', 'gap 2/5', 'gap 3/5', 'gap 4/5', 'gap 5/5', 'pass']);
    assert.ok(ex.rows.some((t) => /pass \(tabs\)/.test(t)) && ex.rows.some((t) => /gaps/.test(t)), label + ': the list says pass (tabs) and gaps');
    await shot(`${D}-export-2d-tabs.png`, phone ? null : '#review-stage');
    // 3D: the info lists the pass and the gaps; the tabs stand (the stock as thick as the cut is deep, so the gaps go through and the tabs bridge them)
    await clickEl('#review-view-3d');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the 3D board');
    await typeInto('#review-stock-thickness', unit === 'in' ? '0.75' : '18');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the 3D board, stock = the cut depth');
    const info = await evalJs(`document.getElementById('review-info').textContent`);
    console.log(label + ' 3D info: ' + info);
    assert.ok(/5 tabs/.test(info) && /5 gaps/.test(info), label + ': the 3D info lists the tabs pass and the gaps');
    await sleep(500);
    await shot(`${D}-export-3d-tabs.png`, phone ? null : '#review-stage');
    await clickEl('#review-top');
    await sleep(500);
    await shot3dCentre(`${D}-export-3d-tabs-top-zoom.png`);
    // Onion skin: one skin mark, no strips; the export: one pass, no strips
    await openMode('prepare');
    await clickWorld(20, 20);
    await waitFor(`!document.querySelector('.cut-card').hidden`, 'the cut card again');
    await clickEl('.cut-row[data-row="holdPart"] .cut-preset[data-value="skin"]');
    await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => /onion skin/.test(d.textContent))`, label + ': the skin note');
    console.log(label + ' skin note: ' + JSON.stringify(await note()));
    assert.deepStrictEqual(await marks(), { tabs: 0, strips: 0, skin: 1 }, label + ': Prepare: the whole outline marked, no strips');
    await shot(`${D}-prepare-skin.png`, '#prepare-canvas');
    await export2d(`${D}-skin`, [`circle inside ${full}`, `path outside ${pass}`], [null, 'skin']);
    await clickEl('#review-view-3d');
    await waitFor(`/triangles/.test(document.getElementById('review-info').textContent)`, label + ': the 3D board (skin)');
    await sleep(500);
    await shot(`${D}-export-3d-skin.png`, phone ? null : '#review-stage');
    await clickEl('#review-top');
    await sleep(500);
    await shot3dCentre(`${D}-export-3d-skin-top-zoom.png`);
    await openMode('prepare');
  };

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await setUnit('mm');
  await drawPlate();
  await phase('desktop (mm)');

  // the phone: 390 x 844, real touch, a reloaded page (fresh remembered values) in INCHES
  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready (phone)');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready (phone)');
  await evalJs(`import('/tests/helpers/plan-v2.js').then((m) => m.V2_PLAN.clear())`);
  await setUnit('in');
  await drawPlate();
  await phase('phone (in)');
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  await setUnit('mm');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('hold-part-742-live: ok');
} finally { await close(); }
