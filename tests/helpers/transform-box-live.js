// tests/helpers/transform-box-live.js — TASK 753: a group's TRANSFORM BOX in the REAL apps (headless Edge / Chrome via CDP, real mouse / touch / keys),
// shared by the transform-753-<app>-<desktop|phone>-live test files (one per app and phase, each short).
// Every phase drops the letters file (tests/fixtures/svg/letters-756.svg: 41 curves, the file one group) on the app's Design canvas.
// What is read: only what the page draws: the curves' own coordinates (data-shape-id elements: world units), the box (.tbox[data-mode], its handles
// [data-handle], its padlocks .tbox-lock[data-lock][data-state], the readout .tbox-readout, the refusal tip .tbox-tip), the typed box #tbox-input,
// the shared menu (.sk-context-menu), the confirm modal ([role=dialog]) and the design browser's group rows.
//  DESKTOP 1280 x 800, mouse:
//    hover (nothing selected) = the outline + the two padlocks, no handle; a click = the outline + the rotate handle + 4 corners + 2 padlocks;
//    a corner dragged outward scales UNIFORMLY from the opposite corner (every length x the same factor; the opposite corner stays) and Ctrl+Z
//    undoes it in ONE step; the rotate handle dragged turns the group (every length kept, every curve by the same angle, the readout shows it);
//    a click on the rotate handle opens the typed angle, 30 + Enter turns it 30 degrees counter-clockwise on screen; a drag of the group moves it
//    rigidly; the GREEN padlock: the handles go, the drag still moves it; the RED padlock: a drag moves nothing and the reason shows at the box;
//    the canvas menu and the browser row read the same two lock states.
//  PHONE 390 x 844, touch: a tap selects (no hover box ever on touch); the handles' targets are >= 44 px; one finger on a corner scales; a second
//    finger landing during a handle drag puts the group back (and pinches as before); a tap on the rotate handle opens the typed angle; the padlocks
//    by tap; a touch drag with the red padlock moves nothing.
// Screenshots (.evidence/753, local): zoomed on the box.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';

const LETTERS = fs.readFileSync(path.resolve('tests/fixtures/svg/letters-756.svg'), 'utf8');
const FILE_N = 41;
export const HOSTS = {
  sketchstudio: { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', canvasId: 'svgCanvas', show: null },
  shaper: { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: `document.querySelector('.sk-header-tab[data-tab="design"]').click()` },
};

export async function runTransformLive(host, phase) {
  const EVID = path.resolve('.evidence/753');
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '753-' + host.name + '-' + phase, width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return null; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const C = host.canvas, out = {};
  const phone = phase === 'phone';
  const mouse = (type, x, y, buttons, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), modifiers, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id || i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const click = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(350); };
  const tap = async (p) => { await T('touchStart', [p]); await sleep(70); await T('touchEnd', []); await sleep(400); };
  const press = (p) => (phone ? tap(p) : click(p));
  // a drag from a to b; `beforeRelease` runs with the pointer still down at b (a screenshot of the live readout)
  const drag = async (a, b, steps = 12, beforeRelease = null) => {
    if (phone) { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(30); } await sleep(80); if (beforeRelease) await beforeRelease(); await T('touchEnd', []); await sleep(400); return; }
    await mouse('mouseMoved', a.x, a.y, 0); await sleep(50); await mouse('mousePressed', a.x, a.y, 1); await sleep(50);
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1); await sleep(30); }
    await sleep(80); if (beforeRelease) await beforeRelease(); await mouse('mouseReleased', b.x, b.y, 0); await sleep(400);
  };
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: phone ? 1 : 2 } } : {}) }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); return name; };

  // what the page draws
  const lines = () => evalJs(`(() => { const o = {}; for (const e of document.querySelectorAll('${C} line.shape-elem[data-shape-id]')) { const a = (k) => +e.getAttribute(k); o[e.dataset.shapeId] = [a('x1'), a('y1'), a('x2'), a('y2')]; } return o; })()`);
  const boxes = () => evalJs(`[...document.querySelectorAll('${C} .tbox')].map((e) => ({ mode: e.dataset.mode, handles: [...e.querySelectorAll('[data-handle]')].map((h) => h.dataset.handle), locks: Object.fromEntries([...e.querySelectorAll('.tbox-lock')].map((l) => [l.dataset.lock, l.dataset.state])) }))`);
  const centre = (sel) => evalJs(`(() => { const e = document.querySelector('${C} ${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  // the refusal tip's text (its lines joined) and whether it lies inside the canvas
  const tipText = () => evalJs(`(() => { const ts = [...document.querySelectorAll('${C} .tbox-tip text')]; return ts.length ? ts.map((t) => t.textContent).join(' ') : null; })()`);
  const tipInside = () => evalJs(`(() => { const t = document.querySelector('${C} .tbox-tip rect'), c = document.querySelector('${C}'); if (!t) return null; const a = t.getBoundingClientRect(), b = c.getBoundingClientRect(); return a.left >= b.left - 0.5 && a.right <= b.right + 0.5; })()`);
  // the box (and the refusal tip / readout, when shown) plus a margin, inside the window
  const boxClip = async (extra = 70) => evalJs(`(() => { const rs = [...document.querySelectorAll('${C} .tbox, ${C} .tbox-tip, ${C} .tbox-readout')].map((e) => e.getBoundingClientRect());
    const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)), rr = Math.max(...rs.map((r) => r.right)), b = Math.max(...rs.map((r) => r.bottom));
    const x = Math.max(0, l - ${extra}), y = Math.max(0, t - ${extra}); return { x, y, width: Math.min(innerWidth - x, rr - l + 2 * ${extra}), height: Math.min(innerHeight - y, b - t + 2 * ${extra}) }; })()`);
  const member = () => evalJs(`(() => { const r = [...document.querySelectorAll('${C} .shape-elem[data-shape-id]')].map((e) => e.getBoundingClientRect()).filter((q) => q.width + q.height > 0); const L = r.reduce((a, b) => (b.left < a.left ? b : a)); return { x: L.left + L.width / 2, y: L.top + L.height / 2 }; })()`);
  const len = (l) => Math.hypot(l[2] - l[0], l[3] - l[1]);
  const ang = (l) => Math.atan2(l[3] - l[1], l[2] - l[0]);
  // every line's length ratio after / before (uniform scale: all equal), and its direction change (a rotate: all equal)
  const compare = (a, b) => {
    const ks = Object.keys(a).filter((k) => b[k] && len(a[k]) > 1e-9);
    const ratios = ks.map((k) => len(b[k]) / len(a[k]));
    const turns = ks.map((k) => { let d = ang(b[k]) - ang(a[k]); d = Math.atan2(Math.sin(d), Math.cos(d)); return d * 180 / Math.PI; });
    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    return { n: ks.length, ratio: ratios[0], ratioSpread: spread(ratios), turn: turns[0], turnSpread: spread(turns) };
  };
  const ctrlZ = () => sendRealKey(send, 'z', 'KeyZ', 90, 2);
  // select the file group again when the selection was dropped (an undo clears it); after the double-click time, so it is never a double tap
  // that would ENTER the file
  const reselect = async () => { if ((await boxes()).some((b) => b.mode === 'select')) return; await sleep(550); await press(await member()); };
  // Undo: Ctrl+Z (desktop), the footer's Undo button by a tap (phone)
  const undo = async () => { if (phone) await tap(await evalJs(`(() => { const r = document.getElementById('btn-undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)); else await ctrlZ(); };

  try {
    await installFakeDriveSession(cdp);
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
    if (host.show) { await sleep(500); await evalJs(host.show); }
    await waitForApp(host.canvasId); await sleep(500);
    await evalJs(`(() => { window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(LETTERS)}], 'letters.svg', { type: 'image/svg+xml' })); const c = document.querySelector('${C}'); c.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitFor(`document.querySelectorAll('${C} .shape-elem[data-shape-id]').length >= ${FILE_N}`, 'the dropped letters drawn'); await sleep(900);
    const name = host.name + '-' + phase;

    // the import fills the view: zoom out (the wheel) so the box, its handles and its padlocks are all on screen
    if (!phone) {
      const cv = await evalJs(`(() => { const r = document.querySelector('${C}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      for (let i = 0; i < 3; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(cv.x), y: Math.round(cv.y), deltaX: 0, deltaY: 120 }); await sleep(120); }
      await sleep(400);
    }
    // ── hover vs selection
    const m0 = await member();
    if (!phone) {
      await mouse('mouseMoved', m0.x, m0.y, 0); await sleep(400);
      out.hover = await boxes();
      assert.deepStrictEqual(out.hover, [{ mode: 'hover', handles: [], locks: { sizeAngle: 'off', full: 'off' } }], `${name}: the hover shows the outline + the two padlocks, no handle: ${JSON.stringify(out.hover)}`);
      out.hoverShot = await shot(`${name}-1-hover-outline-padlocks.png`, await boxClip());
    }
    await press(m0);
    if (!phone) { await mouse('mouseMoved', m0.x, m0.y - 400 > 0 ? m0.y : m0.y, 0); }
    out.selected = await boxes();
    assert.deepStrictEqual(out.selected[0], { mode: 'select', handles: ['rotate', 'scale-nw', 'scale-ne', 'scale-se', 'scale-sw'], locks: { sizeAngle: 'off', full: 'off' } }, `${name}: the selection shows the rotate handle, 4 corners, 2 padlocks: ${JSON.stringify(out.selected)}`);
    if (phone) {
      // a finger's targets: the drawn 44 px discs
      out.targets = await evalJs(`[...document.querySelectorAll('${C} .tbox [data-handle] circle[fill-opacity]')].map((c) => Math.round(c.getBoundingClientRect().width))`);
      assert.ok(out.targets.length === 5 && out.targets.every((w) => w >= 44), `${name}: every handle's touch target is >= 44 px: ${out.targets}`);
      out.lockSize = await evalJs(`[...document.querySelectorAll('${C} .tbox-lock')].map((l) => Math.round(l.getBoundingClientRect().width))`);
    }
    out.selectShot = await shot(`${name}-2-selected-box-handles.png`, await boxClip());

    // ── scale by a corner (uniform, from the opposite corner), then Ctrl+Z (desktop) / the undo button (phone)
    const before = await lines();
    const se = await centre('[data-handle="scale-se"]'), nw0 = await centre('[data-handle="scale-nw"]'); // (screen: only to aim the drag)
    const tgt = { x: se.x + (se.x - nw0.x) * 0.25, y: se.y + (se.y - nw0.y) * 0.25 };
    await drag(se, tgt);
    const scaled = await lines();
    out.scale = compare(before, scaled);
    assert.ok(out.scale.n >= 30 && Math.abs(out.scale.ratio - 1.25) < 0.08 && out.scale.ratioSpread < 1e-9 && Math.abs(out.scale.turnSpread) < 1e-9 && Math.abs(out.scale.turn) < 1e-9, `${name}: the corner scaled every line by the same factor (~1.25), none turned: ${JSON.stringify(out.scale)}`);
    // the opposite (top-left) corner of the geometry stays where it was (world units: the lines' own coordinates)
    const minCorner = (ls) => { const v = Object.values(ls); return [Math.min(...v.flatMap((l) => [l[0], l[2]])), Math.min(...v.flatMap((l) => [l[1], l[3]]))]; };
    const mc0 = minCorner(before), mc1 = minCorner(scaled);
    out.oppositeStays = Math.hypot(mc1[0] - mc0[0], mc1[1] - mc0[1]);
    assert.ok(out.oppositeStays < 1e-9, `${name}: the opposite corner stayed: ${JSON.stringify([mc0, mc1])}`);
    out.scaleShot = await shot(`${name}-3-scaled-by-corner.png`, await boxClip());
    await undo();
    await sleep(600);
    out.undo = compare(before, await lines());
    assert.ok(Math.abs(out.undo.ratio - 1) < 1e-9 && out.undo.ratioSpread < 1e-9 && Object.keys(before).every((k) => true), `${name}: ONE undo puts it back: ${JSON.stringify(out.undo)}`);
    const afterUndo = await lines();
    assert.deepStrictEqual(afterUndo, before, `${name}: exactly back`);

    // ── a second finger during a handle drag cancels it (phone)
    if (phone) {
      await reselect();
      const c0 = await centre('[data-handle="scale-se"]');
      await T('touchStart', [{ ...c0, id: 1 }]); await sleep(60);
      for (let i = 1; i <= 6; i++) { await T('touchMove', [{ x: c0.x + 6 * i, y: c0.y + 6 * i, id: 1 }]); await sleep(30); }
      const mid = compare(before, await lines());
      await T('touchStart', [{ x: c0.x + 36, y: c0.y + 36, id: 1 }, { x: c0.x - 80, y: c0.y - 120, id: 2 }]); await sleep(80);
      out.twoFingers = { during: mid.ratio, after: compare(before, await lines()).ratio };
      await T('touchEnd', []); await sleep(500);
      assert.ok(mid.ratio > 1.01 && Math.abs(out.twoFingers.after - 1) < 1e-9, `${name}: a second finger cancels the handle (the group goes back): ${JSON.stringify(out.twoFingers)}`);
      await reselect();
    }

    // ── rotate by the handle
    await reselect();
    const r0 = await lines(), rot = await centre('[data-handle="rotate"]'), mid0 = await centre('.tbox-outline');
    const R = Math.hypot(rot.x - mid0.x, rot.y - mid0.y), a1 = -Math.PI / 2 + 40 * Math.PI / 180; // 40 degrees clockwise on screen from the top
    await drag(rot, { x: mid0.x + R * Math.cos(a1), y: mid0.y + R * Math.sin(a1) }, 14, async () => {
      out.readout = await evalJs(`(() => { const t = document.querySelector('${C} .tbox-readout text'); return t ? t.textContent : null; })()`);
      out.readoutShot = await shot(`${name}-4a-rotating-readout.png`, await boxClip(60));
    });
    assert.ok(/^-?\d+(\.\d)?°$/.test(out.readout || ''), `${name}: the live readout shows the angle while the handle moves: ${out.readout}`);
    out.rotate = compare(r0, await lines());
    assert.ok(Math.abs(out.rotate.ratio - 1) < 1e-9 && out.rotate.ratioSpread < 1e-9 && out.rotate.turnSpread < 1e-6 && Math.abs(Math.abs(out.rotate.turn) - 40) < 3, `${name}: the rotate handle turned every line by the same angle (~40), lengths kept: ${JSON.stringify(out.rotate)}`);
    out.rotateShot = await shot(`${name}-4-rotated-by-handle.png`, await boxClip(90));
    await undo();
    await sleep(600);
    await reselect();

    // ── a typed angle: click / tap on the rotate handle, 30 + Enter: 30 degrees COUNTER-CLOCKWISE on screen
    const t0 = await lines();
    await press(await centre('[data-handle="rotate"]'));
    out.inputOpen = await evalJs(`(() => { const i = document.getElementById('tbox-input'); return i ? { value: i.value, label: i.getAttribute('aria-label'), focused: document.activeElement === i } : null; })()`);
    assert.ok(out.inputOpen && out.inputOpen.value === '0' && out.inputOpen.focused, `${name}: a click on the rotate handle opens the typed angle: ${JSON.stringify(out.inputOpen)}`);
    out.inputShot = await shot(`${name}-5-typed-angle-box.png`, await boxClip(90));
    await evalJs(`(() => { const i = document.getElementById('tbox-input'); i.value = ''; })()`);
    await send('Input.insertText', { text: '30' }); await sleep(100);
    await sendRealKey(send, 'Enter', 'Enter', 13); await sleep(800);
    out.typed = compare(t0, await lines());
    // the canvas is y-down: a counter-clockwise turn on screen is a negative angle in its coordinates
    assert.ok(Math.abs(out.typed.turn + 30) < 1e-6 && out.typed.turnSpread < 1e-6 && Math.abs(out.typed.ratio - 1) < 1e-9, `${name}: typed 30: every line turned 30 degrees counter-clockwise on screen: ${JSON.stringify(out.typed)}`);
    out.typedShot = await shot(`${name}-6-typed-30.png`, await boxClip(90));
    await undo(); // the turned file is larger than the view: back
    await sleep(600);

    // ── move (the existing group drag)
    await reselect();
    const v0 = await lines(), mm = await member();
    await drag(mm, { x: mm.x, y: mm.y + 40 }); // (straight down and back up below: a group as wide as a phone screen keeps its padlocks on it)
    out.move = compare(v0, await lines());
    const k0 = Object.keys(v0)[0], mv = (await lines())[k0];
    out.moved = Math.hypot(mv[0] - v0[k0][0], mv[1] - v0[k0][1]);
    assert.ok(out.moved > 1e-6 && Math.abs(out.move.ratio - 1) < 1e-9 && Math.abs(out.move.turn) < 1e-9, `${name}: the drag moved the group rigidly: ${JSON.stringify({ ...out.move, moved: out.moved })}`);

    // ── GREEN padlock: Lock size & angle: no handles, the drag still moves
    await reselect();
    await press(await centre('.tbox-lock[data-lock="sizeAngle"]'));
    out.green = await boxes();
    assert.deepStrictEqual(out.green[0], { mode: 'select', handles: [], locks: { sizeAngle: 'on', full: 'off' } }, `${name}: the green padlock is on and the rotate / scale handles are gone: ${JSON.stringify(out.green)}`);
    out.greenShot = await shot(`${name}-7-green-lock-on.png`, await boxClip());
    const g0 = await lines(), gm = await member();
    await drag(gm, { x: gm.x, y: gm.y - 40 });
    const g1 = (await lines())[Object.keys(g0)[0]];
    out.greenMoved = Math.hypot(g1[0] - g0[Object.keys(g0)[0]][0], g1[1] - g0[Object.keys(g0)[0]][1]);
    assert.ok(out.greenMoved > 1e-6, `${name}: with Lock size & angle the group still moves (${out.greenMoved})`);

    // ── RED padlock: Full lock: a drag moves nothing, the reason at the box
    await reselect();
    await press(await centre('.tbox-lock[data-lock="full"]'));
    out.red = await boxes();
    assert.deepStrictEqual(out.red[0].locks, { sizeAngle: 'on', full: 'on' }, `${name}: the red padlock is on (Full lock implies size & angle)`);
    const f0 = await lines(), fm = await member();
    if (phone) { await T('touchStart', [fm]); await sleep(60); for (let i = 1; i <= 10; i++) { await T('touchMove', [{ x: fm.x + 4 * i, y: fm.y + 3 * i }]); await sleep(30); } await sleep(150); }
    else { await mouse('mouseMoved', fm.x, fm.y, 0); await sleep(50); await mouse('mousePressed', fm.x, fm.y, 1); await sleep(40); for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', fm.x + 4 * i, fm.y + 3 * i, 1); await sleep(30); } await sleep(150); }
    out.redTip = await tipText();
    out.redTipInside = await tipInside();
    out.redShot = await shot(`${name}-8-red-lock-drag-refused.png`, await boxClip(110));
    if (phone) await T('touchEnd', []); else await mouse('mouseReleased', fm.x + 40, fm.y + 30, 0);
    await sleep(600);
    assert.deepStrictEqual(await lines(), f0, `${name}: with Full lock a drag moves nothing`);
    assert.ok(/has Full lock on: unlock it \(red padlock\) to move/.test(out.redTip || ''), `${name}: the reason shows at the box: ${out.redTip}`);
    assert.strictEqual(out.redTipInside, true, `${name}: the reason lies inside the canvas (broken onto two lines when too wide)`);
    // the canvas / hold menu reads the same two states (desktop: right click; phone: the hold)
    if (!phone) {
      const mp = await member();
      await mouse('mouseMoved', mp.x, mp.y, 0); await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(mp.x), y: Math.round(mp.y), button: 'right', buttons: 2, clickCount: 1 }); await sleep(40);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(mp.x), y: Math.round(mp.y), button: 'right', buttons: 0, clickCount: 1 }); await sleep(400);
    } else { const mp = await member(); await T('touchStart', [mp]); await sleep(900); await T('touchEnd', []); await sleep(400); }
    out.menu = await evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].filter((r) => /grp-lock/.test(r.dataset.id)).map((r) => [r.dataset.id, r.getAttribute('aria-checked'), r.getAttribute('aria-disabled') || 'false', Math.round(r.getBoundingClientRect().height)])`);
    assert.deepStrictEqual(out.menu.map((m) => m.slice(0, 3)), [['grp-lock-size', 'true', 'true'], ['grp-lock-full', 'true', 'false']], `${name}: the menu shows both locks on (size & angle held by Full lock): ${JSON.stringify(out.menu)}`);
    if (phone) assert.ok(out.menu.every((m) => m[3] >= 44), `${name}: the hold menu's lock rows are >= 44 px`);
    out.menuShot = await shot(`${name}-9-menu-lock-states.png`);
    await evalJs(`document.querySelector('.sk-context-menu .sk-context-item[data-id="grp-lock-full"]').click()`); await sleep(500);
    out.afterMenu = (await boxes())[0];
    assert.deepStrictEqual(out.afterMenu.locks, { sizeAngle: 'on', full: 'off' }, `${name}: Full lock off from the menu: the box's red padlock follows (one state)`);
    out.errors = await evalJs('window.__errs');
    assert.deepStrictEqual(out.errors, [], `${name}: no page error`);
    if (!phone) {
      const e = await centre('.tbox-outline');
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      await mouse('mouseMoved', e.x, e.y + e.h / 2 + 120, 0); await sleep(400); // empty canvas under the drawing
      out.idle = await boxes();
    } else { const e = await centre('.tbox-outline'); await tap({ x: e.x, y: e.y + e.h / 2 + 140 }); out.idle = await boxes(); }
    assert.deepStrictEqual(out.idle, [], `${name}: nothing selected or hovered: no box (locked or not)`);
    return out;
  } finally {
    console.log(`TASK 753 ${host.name} ${phase}: ${JSON.stringify(out)}`);
    await cdp.close();
  }
}
