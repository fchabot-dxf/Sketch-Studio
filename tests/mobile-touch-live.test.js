// tests/mobile-touch-live.test.js — TASK 562, mobile step 1 (SketchStudio + the shared Design tab). Real CDP touch (mobile emulation, 390x844):
//  touch and hold opens the shared context menu (no drag / pan, one menu even when Android also fires `contextmenu`), menu rows >= 44 px
//  and beside the finger, the magnifier is on under a drawing finger, "Done" ends a Line chain (undo then removes the segment), the
//  one touch snap boost, the phone layout, and the desktop (1400 px, mouse) staying as it was.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { findSnap, snapBoostFor, TOUCH_SNAP_BOOST } from '#ui/snap-detection.js';
import { SNAP } from '#core/constants.js';

const EVID = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : null;
if (EVID) fs.mkdirSync(EVID, { recursive: true });

// ── 1. the one touch snap boost (node): a tap 50 px from a joint and 32 px from an edge ──
{
  const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } } };
  const joints = new Map([['a', { x: 300, y: 300 }], ['b', { x: 100, y: 372 }], ['c', { x: 700, y: 372 }]]);
  const shapes = [{ id: 'e', type: 'line', joints: ['b', 'c'] }];
  const tap = { x: 330, y: 340 };
  const pick = (boost) => { const s = findSnap(joints, shapes, SVG, tap, [], false, false, boost); return s ? s.type + ':' + s.targetId : null; };
  assert.strictEqual(TOUCH_SNAP_BOOST, 2);
  assert.strictEqual(snapBoostFor(true), 2); assert.strictEqual(snapBoostFor(false), 1);
  assert.strictEqual(pick(snapBoostFor(false)), null, 'a mouse at 50 px from the joint / 32 px from the edge picks nothing (reach 30 / 20)');
  assert.strictEqual(pick(snapBoostFor(true)), 'shape:e', 'a finger there picks the NEARER edge (reach 40), not the joint 50 px away that the old 60 / 20 reaches handed it');
  console.log(`snap reach: mouse joint ${SNAP.JOINT_PX} line ${SNAP.LINE_PX} axis ${SNAP.AXIS_PX}; finger joint ${SNAP.JOINT_PX * TOUCH_SNAP_BOOST} line ${SNAP.LINE_PX * TOUCH_SNAP_BOOST} axis ${SNAP.AXIS_PX * TOUCH_SNAP_BOOST}`);
}

const cdp = await launchBrowser({ tag: '562', width: 1400, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate } = cdp;
const shot = async (name) => { if (!EVID) return; const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVID, name + '.png'), Buffer.from(r.data, 'base64')); };

try {
  // ═══ DESKTOP, 1400 px, a mouse: nothing changed ═══
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000);
  await waitFor(`!!document.querySelector('.sk-ribbon') && !!document.getElementById('btn-mag-toggle') && !!document.getElementById('btn-tuning-toggle')`, 'SketchStudio loaded');
  const desk = await evalJs(`(() => {
    const m = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, cs.fontSize, cs.display]; };
    return { coarse: matchMedia('(pointer: coarse)').matches, menuBtn: m('.sk-sidebar-btn'), tab: m('.sk-header-tab'), style: m('.sk-header-style'), debug: m('#btn-debug-toggle'), ribbonBtn: m('.sk-ribbon-btn'),
      ribbonLbl: m('.sk-ribbon-lbl'), construct: m('#btn-construct-toggle'), recenter: m('#btn-recenter-view'), mag: m('#btn-mag-toggle'),
      tune: m('#btn-tuning-toggle'), log: m('.sk-diag-toggle'), diagSlot: m('#status-diag-slot'), coords: m('#viewport-size'), fade: getComputedStyle(document.querySelector('.sk-ribbon')).maskImage }; })()`);
  console.log('desktop 1400:', JSON.stringify(desk));
  assert.strictEqual(desk.coarse, false);
  assert.ok(desk.menuBtn[1] < 44 && desk.style[1] < 44 && desk.debug[1] < 44, 'desktop keeps its compact header (no 44 px growth)');
  assert.deepStrictEqual([desk.ribbonBtn[0], desk.ribbonBtn[1], desk.ribbonLbl[2]], [48, 56, '8px'], 'desktop ribbon: 48x56 buttons, 8 px labels (unchanged)');
  for (const k of ['style', 'debug', 'mag', 'tune', 'log', 'diagSlot']) assert.notStrictEqual(desk[k][3], 'none', `desktop still shows ${k} where it was`);
  assert.ok(desk.fade === 'none' || desk.fade === '', 'no edge fade on the desktop ribbon');
  await shot('desktop-1400');
  if (process.env.WRITE_DESKTOP_JSON) fs.writeFileSync(process.env.WRITE_DESKTOP_JSON, JSON.stringify(desk, null, 1));
  // TASK 558: only a NAMED design autosaves; the drawing made on the phone below is carried to Shaper through the store, so start from one
  await evalJs(CREATE_NAMED_DESIGN('sketchstudio', 'Phone'));

  // ═══ PHONE, 390x844, a finger ═══
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 15000);
  await waitFor(`!!document.querySelector('.sk-ribbon') && !!document.getElementById('svgCanvas') && !!document.getElementById('btn-tuning-toggle')`, 'SketchStudio loaded (phone)');
  await sleep(600);
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p, hold = 40) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); await sleep(150); };
  const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ inline: 'center', block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const tapSel = async (sel) => { const c = await centre(sel); assert(c, sel + ' missing'); await sleep(60); await tap(await centre(sel)); };
  const shapes = () => evalJs(`document.querySelectorAll('.shape-elem').length`);
  const menu = () => evalJs(`(() => { const ms = [...document.querySelectorAll('.sk-context-menu')]; const m = ms[0]; if (!m) return { n: 0 }; const r = m.getBoundingClientRect(); return { n: ms.length, left: r.left, right: r.right, top: r.top, bottom: r.bottom, rows: [...m.querySelectorAll('.sk-context-item')].map((x) => [x.textContent, x.getBoundingClientRect().height]) }; })()`);
  const closeMenu = async () => { await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(100); };

  const ph = await evalJs(`(() => {
    const m = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10, cs.fontSize, cs.display]; };
    return { coarse: matchMedia('(pointer: coarse)').matches, vw: innerWidth, menuBtn: m('.sk-sidebar-btn'), tab: m('.sk-header-tab'), actions: m('.sk-header-actions'), ribbonBtn: m('.sk-ribbon-btn'), ribbonLbl: m('.sk-ribbon-lbl'), groupLbl: m('.sk-ribbon-group-label'),
      construct: m('#btn-construct-toggle'), recenter: m('#btn-recenter-view'), mag: m('#btn-mag-toggle'), tune: m('#btn-tuning-toggle'), diagSlot: m('#status-diag-slot'), coords: m('#viewport-size'),
      fade: getComputedStyle(document.querySelector('.sk-ribbon')).maskImage.slice(0, 40), hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      headerRight: Math.round(document.querySelector('.sk-header').getBoundingClientRect().right), ribbonScroll: [document.querySelector('.sk-ribbon').scrollWidth, document.querySelector('.sk-ribbon').clientWidth] }; })()`);
  console.log('phone 390:', JSON.stringify(ph));
  assert.strictEqual(ph.coarse, true, 'the emulated phone is a coarse pointer');
  for (const k of ['menuBtn', 'tab', 'ribbonBtn', 'construct', 'recenter']) assert.ok(ph[k][0] >= 44 && ph[k][1] >= 44, `${k} is >= 44x44 on a phone: ${ph[k]}`);
  for (const k of ['ribbonLbl', 'groupLbl', 'coords']) assert.ok(parseFloat(ph[k][2]) >= 12, `${k} text >= 12 px: ${ph[k][2]}`);
  assert.strictEqual(ph.actions[3], 'none', 'Style + Debug left the header at phone width');
  assert.ok(ph.headerRight <= 390 && !ph.hscroll, 'the header fits the screen (no clipped button, no page scroll)');
  for (const k of ['mag', 'tune', 'diagSlot']) assert.strictEqual(ph[k][3], 'none', `${k} left the footer on a phone`);
  assert.ok(ph.fade.includes('linear-gradient'), 'the ribbon has the edge-fade cue at phone width');
  assert.ok(ph.ribbonScroll[0] > ph.ribbonScroll[1], 'the ribbon scrolls');
  const fadeVars = () => evalJs(`document.querySelector('.sk-ribbon').dataset.fade`);
  assert.strictEqual(await fadeVars(), 'right', 'at the start only the right edge fades');
  await evalJs(`document.querySelector('.sk-ribbon').scrollLeft = 99999`); await sleep(300);
  assert.strictEqual(await fadeVars(), 'left', 'at the end only the left edge fades');
  await evalJs(`document.querySelector('.sk-ribbon').scrollLeft = 0`); await sleep(300);
  // Style / Debug / Log / Tune are in the menu
  await tapSel('.sk-sidebar-btn'); await sleep(400);
  const menuActions = await evalJs(`[...document.querySelectorAll('.sk-sidebar [data-action]')].map((b) => b.dataset.action)`);
  for (const a of ['phone-style', 'phone-debug', 'phone-log', 'phone-tune']) assert.ok(menuActions.includes(a), `the menu has ${a}: ${menuActions}`);
  await shot('phone-menu');
  await tapSel('.sk-sidebar [data-action="phone-style"]'); await sleep(500);
  assert.ok(await evalJs(`!!document.querySelector('.sk-style-panel') && !document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`), 'menu > Style opens the style panel');
  await tapSel('.sk-style-close'); await sleep(200);
  await shot('phone-first-screen');

  // ── draw by touch: Line, two taps; the Done button; the magnifier under a drawing finger ──
  const cr = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
  const P = (fx, fy) => ({ x: cr.l + cr.w * fx, y: cr.t + cr.h * fy });
  assert.strictEqual(await shapes(), 0, 'an empty canvas');
  // TASK 596: the polygon's size / sides boxes show on the canvas after the centre tap; every field is a finger (>= 44 px tall); Esc closes them
  await tapSel('#tool-polygon'); await tap(P(0.3, 0.5));
  const polyBoxes = await evalJs(`[...document.querySelectorAll('.sk-dual-input')].filter((b) => getComputedStyle(b).display !== 'none').flatMap((b) => [...b.querySelectorAll('input')].map((i) => { const r = i.getBoundingClientRect(); return [i.placeholder, Math.round(r.width), Math.round(r.height)]; }))`);
  assert.strictEqual(polyBoxes.length, 2, 'the size and the sides boxes show after the centre tap: ' + JSON.stringify(polyBoxes));
  for (const [name, w, h] of polyBoxes) assert.ok(w >= 44 && h >= 44, `the ${name} box is >= 44x44: ${w}x${h}`);
  await evalJs(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(150);
  assert.strictEqual(await evalJs(`[...document.querySelectorAll('.sk-dual-input')].filter((b) => getComputedStyle(b).display !== 'none').length`), 0, 'Esc closes the polygon boxes');
  await tapSel('#tool-line');
  assert.ok(await evalJs(`document.querySelector('.sk-touch-done') ? document.querySelector('.sk-touch-done').hidden : true`), 'Done is hidden before a chain starts');
  await tap(P(0.25, 0.35));
  const done0 = await evalJs(`(() => { const b = document.querySelector('.sk-touch-done'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
  assert.ok(done0, 'Done appears once a touch chain is open');
  assert.ok(done0.w >= 44 && done0.h >= 44, `Done is thumb sized: ${done0.w}x${done0.h}`);
  assert.ok(done0.l + done0.w > 390 - 40 && done0.t + done0.h > cr.t + cr.h - 40, 'Done sits in the canvas bottom-right corner (thumb reach), off the drawing centre');
  // finger down on the second point: the lens shows by itself and the rubber band is drawn
  const second = P(0.7, 0.35);
  await T('touchStart', [second]); await sleep(120); await T('touchMove', [{ x: second.x + 10, y: second.y + 6 }]); await sleep(150);
  const lens = await evalJs(`(() => { const m = document.getElementById('magnifier'); return { shown: m.style.display, hasUse: !!m.querySelector('use'), r: m.querySelector(':scope > circle').getAttribute('r') }; })()`);
  assert.strictEqual(lens.shown, 'block', 'the magnifier is ON while a finger draws (no toggle)');
  assert.ok(lens.hasUse, 'the lens shows the live drawing');
  const band = await evalJs(`document.querySelectorAll('#world-group line, #world-group path').length`);
  await shot('phone-line-finger-down-lens');
  await T('touchEnd', []); await sleep(250);
  assert.strictEqual(await evalJs(`document.getElementById('magnifier').style.display`), 'none', 'the lens is gone when the finger lifts');
  console.log('lens r(world)=', lens.r, 'line / path elements while drawing=', band);
  assert.strictEqual(await shapes(), 1, 'one segment drawn');
  assert.ok(await evalJs(`!document.querySelector('.sk-touch-done').hidden`), 'the chain is still open: Done still shown');
  await tap(P(0.7, 0.6)); // a second segment of the chain
  assert.strictEqual(await shapes(), 2, 'two segments');
  await shot('phone-done-visible');
  await tap(await centre('.sk-touch-done'));
  await sleep(300);
  assert.ok(await evalJs(`document.querySelector('.sk-touch-done').hidden`), 'Done disappears when the chain ends');
  assert.strictEqual(await shapes(), 2, 'Done keeps the committed segments (like Enter)');
  await tapSel('#btn-undo'); await sleep(200);
  assert.strictEqual(await shapes(), 1, 'undo then removes the LAST segment only (task 549)');
  await tapSel('#btn-redo'); await sleep(200);
  assert.strictEqual(await shapes(), 2, 'redo brings it back');
  // a mouse never gets Done
  const mp = P(0.3, 0.8);
  await tapSel('#tool-line');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mp.x, y: mp.y, button: 'none' });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mp.x, y: mp.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mp.x, y: mp.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
  assert.ok(await evalJs(`document.querySelector('.sk-touch-done').hidden`), 'with a mouse Done stays hidden (Esc / right click end the chain)');
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
  await tapSel('#tool-select');

  // ── touch and hold ──
  const geo = () => evalJs(`(() => { const l = document.querySelector('.shape-elem'); return l ? [l.getAttribute('x1'), l.getAttribute('y1'), l.getAttribute('x2'), l.getAttribute('y2')].join(',') : null; })()`);
  const viewBox = () => evalJs(`document.getElementById('svgCanvas').getAttribute('viewBox')`);
  const hotspots = await evalJs(`(() => { const svg = document.getElementById('svgCanvas'); const l = svg.querySelector('.shape-elem'); const m = l.getScreenCTM(); const pt = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(m); return { x: q.x, y: q.y }; };
    const a = pt(+l.getAttribute('x1'), +l.getAttribute('y1')), b = pt(+l.getAttribute('x2'), +l.getAttribute('y2')); return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }; })()`);
  const holdAt = async (p, ms = 700, during = null) => { await T('touchStart', [p]); if (during) { await sleep(ms / 2); await during(); await sleep(ms / 2); } else await sleep(ms); const mm = await menu(); await T('touchEnd', []); await sleep(250); return mm; };
  const beforeGeo = await geo(), beforeVb = await viewBox();
  // shape (edge midpoint)
  let m = await holdAt(hotspots.mid);
  assert.strictEqual(m.n, 1, 'a 700 ms hold on a shape opens the context menu');
  assert.deepStrictEqual(m.rows.map((r) => r[0]), ['Lock', 'Delete']);
  for (const [label, h] of m.rows) assert.ok(h >= 44, `${label} row is ${h}px (>= 44)`);
  assert.ok(m.left >= 0 && m.right <= 390 && m.top >= 0 && m.bottom <= 844, 'the menu is inside the viewport');
  console.log('menu', JSON.stringify(m), 'finger', JSON.stringify(hotspots.mid));
  assert.ok(!(hotspots.mid.x >= m.left && hotspots.mid.x <= m.right && hotspots.mid.y >= m.top && hotspots.mid.y <= m.bottom), 'the menu is BESIDE the finger: the pressed point is not under it');
  assert.strictEqual(await geo(), beforeGeo, 'the hold did not drag the shape'); assert.strictEqual(await viewBox(), beforeVb, 'the hold did not pan the view');
  assert.strictEqual((await menu()).n, 1, 'the menu stays open after the finger lifts');
  await shot('phone-longpress-shape-menu');
  await closeMenu();
  // joint
  m = await holdAt(hotspots.a);
  assert.strictEqual(m.n, 1, 'a hold on a joint opens the menu'); for (const [label, h] of m.rows) assert.ok(h >= 44, `${label} ${h}`);
  assert.strictEqual(await geo(), beforeGeo, 'the hold on a joint did not drag it');
  await shot('phone-longpress-joint-menu');
  await closeMenu();
  // Android: the browser ALSO fires contextmenu during the hold (a PointerEvent, and the old MouseEvent form): one menu only
  m = await holdAt(hotspots.mid, 700, async () => {
    await evalJs(`(() => { const el = document.elementFromPoint(${hotspots.mid.x}, ${hotspots.mid.y}); el.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${hotspots.mid.x}, clientY: ${hotspots.mid.y}, pointerType: 'touch', button: 2 })); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${hotspots.mid.x}, clientY: ${hotspots.mid.y}, button: 2 })); })()`);
  });
  assert.strictEqual(m.n, 1, 'a contextmenu during the hold (Android) opens no second menu');
  assert.strictEqual((await evalJs(`document.querySelectorAll('.sk-context-menu').length`)), 1);
  await closeMenu();
  // a touch contextmenu NOT in a hold (Android fires it after our timer too): suppressed, no menu from it
  await sleep(900);
  const prevented = await evalJs(`(() => { const el = document.elementFromPoint(${hotspots.mid.x}, ${hotspots.mid.y}); const ev = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${hotspots.mid.x}, clientY: ${hotspots.mid.y}, pointerType: 'touch', button: 2 }); el.dispatchEvent(ev); return { prevented: ev.defaultPrevented, menus: document.querySelectorAll('.sk-context-menu').length }; })()`);
  assert.deepStrictEqual(prevented, { prevented: true, menus: 0 }, 'a stray touch contextmenu opens nothing (the hold detector owns touch) and is not left to the native menu');
  // a hold that drifts: the finger moves 40 px => no menu, a normal drag happens
  await T('touchStart', [hotspots.a]); await sleep(120);
  for (let i = 1; i <= 8; i++) { await T('touchMove', [{ x: hotspots.a.x + 5 * i, y: hotspots.a.y + 4 * i }]); await sleep(20); }
  await sleep(650); await T('touchEnd', []); await sleep(250);
  assert.strictEqual((await menu()).n, 0, 'a finger that moves more than ~8 px is a drag, not a hold');
  assert.notStrictEqual(await geo(), beforeGeo, 'and the drag moved the joint');
  // a hold on empty canvas: no menu
  m = await holdAt(P(0.1, 0.9)); assert.strictEqual(m.n, 0, 'a hold on empty canvas opens no menu');
  // Dimension tool: the hold works there too
  await tapSel('#tool-dim');
  const hs2 = await evalJs(`(() => { const svg = document.getElementById('svgCanvas'); const l = svg.querySelector('.shape-elem'); const m = l.getScreenCTM(); const p = svg.createSVGPoint(); p.x = (+l.getAttribute('x1') + +l.getAttribute('x2')) / 2; p.y = (+l.getAttribute('y1') + +l.getAttribute('y2')) / 2; const q = p.matrixTransform(m); return { x: q.x, y: q.y }; })()`);
  m = await holdAt(hs2); assert.strictEqual(m.n, 1, 'a hold in the Dimension tool opens the menu too');
  await closeMenu();
  assert.strictEqual(await evalJs(`document.querySelectorAll('.dim-label').length`), 0, 'the hold left no half-made dimension behind');
  await tapSel('#tool-select');

  // ── Shaper's Design tab (the shared Design tab): the same hold ──
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
  await waitFor(`!!document.querySelector('.mode-btn[data-mode="design"]')`, 'Shaper loaded');
  await sleep(500);
  await tapSel('.mode-btn[data-mode="design"]'); await sleep(900);
  const sh = await evalJs(`(() => { const svg = document.getElementById('design-canvas'); const l = svg.querySelector('.shape-elem'); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: l.tagName }; })()`);
  assert.ok(sh, 'Shaper Design has a demo line to hold');
  await evalJs(`(() => { const b = document.querySelector('#tool-select'); if (b) b.click(); })()`);
  const sm = await holdAt({ x: sh.x, y: sh.y });
  assert.strictEqual(sm.n, 1, 'Shaper Design: a hold on a shape opens the same shared menu');
  for (const [label, h] of sm.rows) assert.ok(h >= 44, `Shaper menu ${label} ${h}`);
  await shot('shaper-design-longpress-menu');
  await closeMenu();
  // Shaper Design: the lens is on under a drawing finger too (the shared Design tab declares it), and Done ends a chain there
  await evalJs(`document.querySelector('#tool-line').click()`); await sleep(200);
  const dc = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
  await tap({ x: dc.l + dc.w * 0.3, y: dc.t + dc.h * 0.75 });
  assert.ok(await evalJs(`!document.querySelector('.sk-touch-done').hidden`), 'Shaper Design: Done is shown while a touch chain is open');
  await T('touchStart', [{ x: dc.l + dc.w * 0.7, y: dc.t + dc.h * 0.75 }]); await sleep(120); await T('touchMove', [{ x: dc.l + dc.w * 0.7 + 8, y: dc.t + dc.h * 0.75 + 4 }]); await sleep(150);
  assert.strictEqual(await evalJs(`document.getElementById('design-magnifier') && document.getElementById('design-magnifier').style.display`), 'block', 'Shaper Design: the lens is on under a drawing finger');
  await shot('shaper-design-lens');
  await T('touchEnd', []); await sleep(250);
  assert.strictEqual(await evalJs(`document.getElementById('design-magnifier').style.display`), 'none');
  await tap(await centre('.sk-touch-done')); await sleep(300);
  assert.ok(await evalJs(`document.querySelector('.sk-touch-done').hidden`), 'Shaper Design: Done ends the chain');
  console.log('mobile-touch-live: ALL PASS');
} finally {
  await cdp.close();
}
