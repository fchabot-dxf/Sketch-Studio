// tests/hold-part-822-live.test.js — TASK 822 (owner turn 2771) in the real Shaper page, desktop 1280 x 800 (real mouse) and phone 390 x 844 (real touch), inches:
// the owner's keyhole (circle R 0.375 in + a 0.313 in wide stem 1.375 in long), Inside, depth 0.156 in, Tabs 5 x 0.063 in wide / thick, 1/8 in bit.
// TASK S3: the Inside is made with the operations toolbar's button (a shape click shows no card).
//  * the tabs are PLACED (before: "tabs refused: the outline is too tight for the gap strips here"): 5 tab marks, 5 gap strips, all on the circle; the note says
//    they were placed where a gap strip fits;
//  * the tab HANDLES show only while the operation is open (the drag handle's style, a 44 px target); a real drag slides a tab along the circle: while
//    dragging, the 5 tabs and their strips are redrawn in the drag layer (the old ones faded); dropped, the tab is there (stored on the shape: tabsAt), the
//    marks / strips redrawn, the count row shows 5 (not Auto); into the stem the handle shows refused and the tab does not move; OK closes: no handle.
// Zoomed screenshots to .evidence/822/.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { clickOpenLive, stepLive, okLive } from './helpers/prepare-open-live.js';

const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/822');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const IN = 25.4, R = 0.375 * IN, H = 0.313 * IN / 2, L = 1.375 * IN, YJ = -Math.sqrt(R * R - H * H);

const cdp = await launchBrowser({ tag: '822-tabs', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;

try {
  let phone = false;
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
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
  // a real drag: press at `from`, move through `path`, release at its last point; `during(i)` runs after each move
  const dragPath = async (from, pathPts, during = async () => {}) => {
    if (phone) await T('touchStart', [from]);
    else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 }); }
    await sleep(60);
    for (let i = 0; i < pathPts.length; i++) {
      const p = pathPts[i];
      if (phone) await T('touchMove', [p]); else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
      await sleep(60);
      await during(i);
    }
    const last = pathPts[pathPts.length - 1];
    if (phone) await T('touchEnd', []); else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
  };
  const clickElRaw = async (sel) => {
    await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'nearest' }); })()`);
    const p = await evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2); const hit = document.elementFromPoint(x, y);
      return { x, y, onTop: !!hit && (hit === e || e.contains(hit)) }; })()`);
    assert.ok(p && p.onTop, `${sel} is on screen and not covered: ${JSON.stringify(p)}`);
    await press(p.x, p.y);
  };
  const s2Steps = { get phone() { return phone; }, evalJs, waitFor, clickEl: clickElRaw };
  const clickEl = (sel) => stepLive(s2Steps, () => clickElRaw(sel));
  const activeStage = () => evalJs(`(() => { const e = document.querySelector('.sk-sidebar-stage.active') || document.querySelector('.sk-header-tab.active'); return e ? e.dataset.tab : null; })()`);
  const openMode = async (mode) => {
    for (let i = 0; i < 5; i++) {
      if (await activeStage() === mode) return;
      if (phone) {
        if (!await evalJs(`document.querySelector('.sk-sidebar').classList.contains('open')`)) await clickElRaw('.sk-sidebar-chevron');
        await waitFor(`document.querySelector('.sk-sidebar').classList.contains('open')`, 'the drawer opens'); await sleep(300);
        await clickElRaw(`.sk-sidebar-stage[data-tab="${mode}"]`);
      } else await clickElRaw(`.sk-header-tab[data-tab="${mode}"]`);
      await sleep(400);
    }
    assert.fail('could not open the ' + mode + ' stage');
  };
  const screenOf = (x, y) => evalJs(`(() => { const svg = document.getElementById('prepare-canvas'); const p = svg.createSVGPoint(); p.x = ${x}; p.y = ${y}; const s = p.matrixTransform(svg.getScreenCTM()); return { x: Math.round(s.x), y: Math.round(s.y) }; })()`);
  const clickWorld = (x, y) => clickOpenLive(s2Steps, async () => { const p = await screenOf(x, y); await press(p.x, p.y); });
  const typeInto = async (sel, text) => {
    await clickEl(sel);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, commands: ['selectAll'] });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.insertText', { text });
    await stepLive(s2Steps, () => evalJs(`document.querySelector(${JSON.stringify(sel)}).blur()`));
    await sleep(200);
  };
  const setUnit = (u) => evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('DOC_UNIT', '${u}'); })`);
  const drawKeyhole = () => evalJs(`(() => {
    const st = window.__designController.state;
    for (const k of [...st.joints.keys()]) st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0;
    const J = { c: [0, 0], jr: [${H}, ${YJ}], jl: [${-H}, ${YJ}], bl: [${-H}, ${-L}], br: [${H}, ${-L}], cb: [0, ${-L}] };
    for (const [k, [x, y]] of Object.entries(J)) st.joints.set('K' + k, { x, y });
    st.shapes.push({ id: 'Kbig', type: 'arc', subType: 'CENTER', joints: ['Kc', 'Kjr', 'Kjl'], sweep: true }, { id: 'Ksl', type: 'line', joints: ['Kjl', 'Kbl'] },
      { id: 'Kbot', type: 'arc', subType: 'CENTER', joints: ['Kcb', 'Kbl', 'Kbr'], sweep: true }, { id: 'Ksr', type: 'line', joints: ['Kbr', 'Kjr'] });
    st.saveState('draw the keyhole');
  })()`);
  // the keyhole framed in the canvas's free part (left of the card), as large as it fits: on a phone (142 px beside the card) its right half and the stem's top,
  // where the dragged tab and the stem are
  const BOX = () => (phone ? { x0: -2, x1: 12, y0: -24, y1: 12 } : { x0: -12, x1: 12, y0: -L - 6, y1: 12 });
  const frame = () => evalJs(`(() => {
    const v = window.__prepareView, svg = document.getElementById('prepare-canvas'), c = svg.getBoundingClientRect(), card = document.querySelector('#prepare-panel .cut-card').getBoundingClientRect();
    const box = ${JSON.stringify(BOX())};
    const R = { l: c.left + 8, r: card.left - 8, t: c.top + 24, b: c.bottom - 24 };
    const k = Math.min((R.r - R.l) / (box.x1 - box.x0), (R.b - R.t) / (box.y1 - box.y0)), w = c.width / k, h = c.height / k;
    const sx = (R.l + R.r) / 2, sy = (R.t + R.b) / 2, wx = (box.x0 + box.x1) / 2, wy = (box.y0 + box.y1) / 2;
    v.setView({ x: wx - (sx - c.left) / k + w / 2, y: wy - (sy - c.top) / k + h / 2, w });
    return { k: Math.round(k * 100) / 100, c: [c.left, c.top, c.right, c.bottom].map(Math.round), card: [card.left, card.top, card.right, card.bottom].map(Math.round) }; })()`);
  // a screenshot of the keyhole, magnified
  const shotKeyhole = async (name) => {
    const bx = BOX(), a = await screenOf(bx.x0, bx.y1), b = await screenOf(bx.x1, bx.y0);
    const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), scale: 2 } });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(data, 'base64'));
    console.log('screenshot ' + path.join(EVIDENCE_DIR, name));
  };
  const handles = () => evalJs(`[...document.querySelectorAll('#prepare-canvas .sk-tab-handle')].map((g) => { const m = /translate\\(([-\\d.e]+) ([-\\d.e]+)\\)/.exec(g.getAttribute('transform')); const h = g.querySelector('.sk-lead-hit').getBoundingClientRect(); const r = g.getBoundingClientRect();
    return { x: Number(m[1]), y: Number(m[2]), at: g.getAttribute('data-tab-at'), cls: g.getAttribute('class'), hitW: Math.round(h.width), hitH: Math.round(h.height), sx: Math.round(r.left + r.width / 2), sy: Math.round(r.top + r.height / 2) }; })`);
  const marks = () => evalJs(`({ tabs: document.querySelectorAll('#prepare-toolpath-group .sk-tab-mark').length, strips: document.querySelectorAll('#prepare-toolpath-group .sk-strip').length,
    dragTabs: document.querySelectorAll('#prepare-lead-drag-group .sk-tab-mark').length, dragStrips: document.querySelectorAll('#prepare-lead-drag-group .sk-strip').length,
    faded: document.getElementById('prepare-toolpath-group').classList.contains('is-tab-dragging'), refused: !!document.querySelector('#prepare-canvas .sk-tab-handle.is-dragging.is-refused') })`);
  const tabsAt = () => evalJs(`import('/apps/shaper/src/operations-store.js').then((m) => { const op = window.__prepareView.activeOp() || m.storeOps().find((o) => o.type === 'interior'); return op && op.geometry[0] && op.geometry[0].tabsAt ? op.geometry[0].tabsAt : null; })`);
  const note = () => evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  const countRow = () => evalJs(`({ value: document.querySelector('.cut-tab-count').value, autoActive: !!document.querySelector('.cut-row[data-row="tabCount"] .cut-preset.is-active') })`);

  const phase = async (label) => {
    const D = phone ? 'phone' : 'desktop';
    await openMode('prepare');
    await waitFor(`!!document.getElementById('prepare-canvas').getScreenCTM() && document.getElementById('prepare-canvas').children.length > 0`, 'prepare canvas ready');
    if (phone && !await evalJs(`document.querySelector('#prepare-ops .ops-body').hidden`)) await clickElRaw('#prepare-ops .ops-head');
    await evalJs(`window.__prepareView.setView({ x: 0, y: ${(-L + R) / 2}, w: 160 })`);
    await sleep(200);
    await clickWorld(0, 0); // inside the circle: the keyhole
    await waitFor(`window.__prepareView.selectedTargets().length === 1 && document.querySelector('.cut-card').hidden`, 'the keyhole selected (TASK S3: no card)');
    await clickEl('#op-type-interior'); // TASK S3: the operations toolbar's Inside: a new Inside operation, open
    await waitFor(`document.querySelector('.cut-type-cur').textContent.toLowerCase().includes('inside')`, 'Inside picked');
    await typeInto('.cut-depth', '0.156');
    await clickEl('.cut-row[data-row="holdPart"] .cut-preset[data-value="tabs"]');
    await typeInto('.cut-tab-count', '5');
    await typeInto('.cut-tab-width', '0.063');
    await typeInto('.cut-hold-thickness', '0.063');
    await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => /5 tabs/.test(d.textContent))`, label + ': the 5 tabs note');
    const n0 = await note();
    console.log(label + ' note: ' + JSON.stringify(n0));
    assert.ok(n0[0].startsWith('Inside: 5 tabs, 0.063 in wide, 0.063 in thick') && n0.includes('Placed where a gap strip fits: part of the outline is too narrow for one'), label + ': placed, the note says where (TASK 878: a plain line, not a warning listed first)');
    const k = await frame();
    await sleep(300);
    console.log(label + ' frame: ' + JSON.stringify(k));
    assert.deepStrictEqual(await marks(), { tabs: 5, strips: 5, dragTabs: 0, dragStrips: 0, faded: false, refused: false }, label + ': 5 tab marks, 5 gap strips');
    let hs = await handles();
    console.log(label + ' handles: ' + JSON.stringify(hs.map((h) => [Math.round(h.x * 100) / 100, Math.round(h.y * 100) / 100, h.hitW, h.hitH])));
    assert.strictEqual(hs.length, 5, label + ': the open operation shows 5 tab handles');
    assert.ok(hs.every((h) => Math.abs(Math.hypot(h.x, h.y) - R) < 1e-3), label + ': all on the circle (none in the stem)');
    assert.ok(hs.every((h) => h.hitW >= 43 && h.hitH >= 43 && /sk-lead-handle/.test(h.cls)), label + ': the lead-in handle\'s style, a 44 px target');
    await shotKeyhole(`${D}-1-placed-open.png`);
    // drag the tab nearest the right neck corner 3 mm further toward it, along the circle (in steps)
    const h0 = hs.reduce((a, h) => (Math.hypot(h.x - H, h.y - YJ) < Math.hypot(a.x - H, a.y - YJ) ? h : a), hs[0]);
    const a0 = Math.atan2(h0.y, h0.x), aT = a0 + Math.sign(Math.atan2(YJ, H) - a0) * (3 / R);
    const pts = [];
    for (let i = 1; i <= 4; i++) { const a = a0 + ((aT - a0) * i) / 4; pts.push(await screenOf(R * Math.cos(a), R * Math.sin(a))); }
    let mid = null;
    const hStart = await evalJs(`window.__designController.state.history.length`); // the operation open, no change yet
    await dragPath({ x: h0.sx, y: h0.sy }, pts, async (i) => { if (i === 1) { mid = await marks(); await shotKeyhole(`${D}-2-dragging.png`); } });
    console.log(label + ' while dragging: ' + JSON.stringify(mid));
    assert.deepStrictEqual(mid, { tabs: 5, strips: 5, dragTabs: 5, dragStrips: 5, faded: true, refused: false }, label + ': while dragging, the 5 tabs and strips redrawn in the drag layer, the old ones faded');
    const stored = await tabsAt();
    assert.ok(Array.isArray(stored) && stored.length === 5, label + ': dropped: the tabs stored on the shape (tabsAt) ' + JSON.stringify(stored));
    hs = await handles();
    const tgt = { x: R * Math.cos(aT), y: R * Math.sin(aT) };
    const near = Math.min(...hs.map((h) => Math.hypot(h.x - tgt.x, h.y - tgt.y)));
    console.log(label + ' dropped: nearest handle ' + near.toFixed(3) + ' mm from the target');
    assert.ok(near < 0.3, label + ': a tab is where it was dropped');
    assert.deepStrictEqual(await marks(), { tabs: 5, strips: 5, dragTabs: 0, dragStrips: 0, faded: false, refused: false }, label + ': the marks and strips redrawn');
    assert.deepStrictEqual(await countRow(), { value: '5', autoActive: false }, label + ': the count row: 5, fixed (not Auto)');
    await shotKeyhole(`${D}-3-dropped.png`);
    // into the stem: refused, the tab does not move
    const before = JSON.stringify(await tabsAt());
    const hA = hs.reduce((a, h) => (Math.hypot(h.x - H, h.y - YJ) < Math.hypot(a.x - H, a.y - YJ) ? h : a), hs[0]);
    const stem = [await screenOf(H + 0.5, YJ - 4), await screenOf(H, -20)];
    let refusedSeen = null;
    await dragPath({ x: hA.sx, y: hA.sy }, stem, async (i) => { if (i === 1) { refusedSeen = await marks(); await shotKeyhole(`${D}-4-refused-in-stem.png`); } });
    console.log(label + ' over the stem: ' + JSON.stringify(refusedSeen));
    assert.ok(refusedSeen.refused && refusedSeen.dragTabs === 5 && refusedSeen.dragStrips === 5, label + ': over the stem the handle shows refused, the tabs drawn where they stay');
    assert.strictEqual(JSON.stringify(await tabsAt()), before, label + ': released there, the tab did not move');
    // OK: the operation closes, no handle
    await okLive(s2Steps);
    assert.strictEqual((await handles()).length, 0, label + ': OK: no tab handle once the operation is closed');
    assert.strictEqual(await evalJs(`window.__designController.state.history.length`), hStart + 1, label + ': the drag, OK = ONE undo step');
    assert.strictEqual(JSON.stringify(await tabsAt()), before, label + ': kept');
    await shotKeyhole(`${D}-5-closed.png`);
  };

  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready');
  await setUnit('in');
  await drawKeyhole();
  await phase('desktop (in)');

  phone = true;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
  await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper app ready (phone)');
  await openMode('design');
  await waitFor('!!(window.__designController && window.__designController.state)', 'design controller ready (phone)');
  await setUnit('in');
  await drawKeyhole();
  await phase('phone (in)');
  const side = await evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  await setUnit('mm');
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  console.log('hold-part-822-live: ok');
} finally { await close(); }
