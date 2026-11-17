// tests/helpers/groups-live.js — TASK 756: THE user-group scenario run in the REAL app, the same in each of the four apps (one test file per app and phase,
// calls runGroupsLive with the app's page, its Design canvas and how to show it). Headless Edge / Chrome via CDP, real mouse / touch / keys.
// Everything is read from what the page draws (no app state is reached: SketchStudio exposes none): the curves lit in the selection / hover
// blue (#017AFD, the --sk-selection token) are the selection or the hover; the elements inside a <g class="sketch-inactive"> are the dimmed
// geometry (the shared renderer's run, and Pen Plotter's static underlay); the shape elements' own coordinates (world) give the drag.
//  DESKTOP 1280 x 800, mouse: the letters file (tests/fixtures/svg/letters-756.svg: 41 curves, 7 groups) is dropped on the canvas and lands
//    grouped; the hover on letter O (nothing selected) lights the WHOLE file group (41); a click selects it (41); a drag moves every curve by the
//    same vector; a double click enters the file (the letter O selected: 8), the rest is dimmed; Esc steps out (nothing dimmed); the right-click
//    menu on O offers Ungroup + Enter group; Enter group from it enters; inside, the menu offers Leave group and it leaves; inside the file, O +
//    the dot (Shift) selected, the menu offers Group and it groups (a new row in the browser).
//  PHONE 390 x 844, touch: the same file dropped; a tap selects the file (41); a touch drag moves it rigidly; a double tap (7 px apart) enters
//    (O selected, the rest dimmed); a tap on empty canvas steps out; touch and hold on O opens the menu (rows >= 44 px) with Ungroup + Enter
//    group; Ungroup from it dissolves the file group: a tap on O then selects the letter O alone (8): a phone user ungroups by menu only.
// Screenshots (.evidence/756, local): the hover, the entered group (rest dimmed), the phone hold menu.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './cdp-browser.js';
import { installFakeDriveSession } from './fake-drive-session.js';
import { resetBufferLive } from './reset-buffer.js';

const LETTERS = fs.readFileSync(path.resolve('tests/fixtures/svg/letters-756.svg'), 'utf8');
const FILE_N = 41, O_N = 8; // the fixture: 41 curves in the file group; the letter O = outline + hole = 8 lines

/** host = { name, url, canvas: '#svgCanvas' | '#design-canvas', canvasId, show: js that shows the Design tab (or null) }; phase = 'desktop' | 'phone'
 *  (one test file per app and phase, so each stays short). */
export async function runGroupsLive(host, phase) {
  const EVID = path.resolve('.evidence/756');
  fs.mkdirSync(EVID, { recursive: true });
  const cdp = await launchBrowser({ tag: '756-' + host.name + '-' + phase, width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return null; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const out = {};
  const C = host.canvas;
  const mouse = (type, x, y, buttons, clickCount = 1, modifiers = 0, button) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), modifiers, button: button || (type === 'mouseMoved' && !buttons ? 'none' : 'left'), buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount });
  const click = async (p, modifiers = 0) => { await mouse('mouseMoved', p.x, p.y, 0, 0, modifiers); await sleep(50); await mouse('mousePressed', p.x, p.y, 1, 1, modifiers); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, modifiers); await sleep(600); };
  const dblclick = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(90); await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(600); };
  const rightClick = async (p) => { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 2, 1, 0, 'right'); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0, 1, 0, 'right'); await sleep(400); };
  const mouseDrag = async (a, b, steps = 12) => { await mouse('mouseMoved', a.x, a.y, 0); await sleep(50); await mouse('mousePressed', a.x, a.y, 1); await sleep(50); for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 1); await sleep(25); } await sleep(80); await mouse('mouseReleased', b.x, b.y, 0); await sleep(500); };
  const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p, hold = 70) => { await T('touchStart', [p]); await sleep(hold); await T('touchEnd', []); };
  const touchDrag = async (a, b, steps = 12) => { await T('touchStart', [a]); await sleep(60); for (let i = 1; i <= steps; i++) { await T('touchMove', [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }]); await sleep(25); } await sleep(80); await T('touchEnd', []); await sleep(400); };
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); return name; };

  // what the page draws
  const SHAPES = `[...document.querySelectorAll('${C} [data-shape-id], #pen-underlay [data-shape-id]')]`;
  const lit = () => evalJs(`[...new Set([...document.querySelectorAll('${C} .shape-elem')].filter((e) => /--sk-selection|#017afd/i.test(e.getAttribute('style') || '')).map((e) => e.dataset.shapeId))].length`);
  const dimmed = () => evalJs(`new Set([...document.querySelectorAll('g.sketch-inactive [data-shape-id]')].map((e) => e.dataset.shapeId)).size`);
  const geo = () => evalJs(`(() => { const o = {}; for (const e of document.querySelectorAll('${C} .shape-elem')) { if (!/--sk-selection|#017afd/i.test(e.getAttribute('style') || '')) continue; const a = (k) => +e.getAttribute(k);
    o[e.dataset.shapeId] = e.tagName === 'line' ? [a('x1'), a('y1'), a('x2'), a('y2')] : e.tagName === 'circle' ? [a('cx'), a('cy')] : null; } return o; })()`);
  const rigid = (g0, g1) => { const ks = Object.keys(g0).filter((k) => g0[k] && g1[k]); const v = [g1[ks[0]][0] - g0[ks[0]][0], g1[ks[0]][1] - g0[ks[0]][1]]; let spread = 0; for (const k of ks) for (let i = 0; i < g0[k].length; i += 2) spread = Math.max(spread, Math.hypot(g1[k][i] - g0[k][i] - v[0], g1[k][i + 1] - g0[k][i + 1] - v[1])); return { n: ks.length, v, spread }; };
  // a point on the left edge of the letter O (the drawing's leftmost element: O's outline), the drawing's screen box, the dot (rightmost element)
  const where = () => evalJs(`(() => { const els = ${SHAPES}.filter((e) => e.getClientRects().length); const rs = els.map((e) => ({ e, r: e.getBoundingClientRect() }));
    const L = rs.reduce((a, b) => (b.r.left < a.r.left ? b : a)), R = rs.reduce((a, b) => (b.r.right > a.r.right ? b : a));
    const box = { x: Math.min(...rs.map((q) => q.r.left)), y: Math.min(...rs.map((q) => q.r.top)), r: Math.max(...rs.map((q) => q.r.right)), b: Math.max(...rs.map((q) => q.r.bottom)) };
    return { o: { x: L.r.left + L.r.width / 2, y: L.r.top + L.r.height / 2 }, dot: { x: R.r.right - 0.5, y: R.r.top + R.r.height / 2 }, box, clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 20), width: box.r - box.x + 40, height: box.b - box.y + 40 } }; })()`);
  const menuIds = () => evalJs(`[...document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id)`);
  const menuRow = (id) => evalJs(`(() => { const r = document.querySelector('.sk-context-menu .sk-context-item[data-id="${id}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; })()`);
  const openApp = async (label) => {
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}${host.url}`, 10000);
    if (host.show) { await sleep(500); await evalJs(host.show); }
    await waitForApp(host.canvasId); await sleep(500);
    await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(LETTERS)}], 'letters.svg', { type: 'image/svg+xml' })); const c = document.querySelector('${C}'); c.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
    await waitFor(`${SHAPES}.length >= ${FILE_N}`, label + ': the dropped letters drawn'); await sleep(900);
  };
  const empty = (w) => ({ x: (w.box.x + w.box.r) / 2, y: w.box.b + 45 }); // under the drawing: empty canvas

  try {
    await installFakeDriveSession(cdp);
    if (phase === 'desktop') {
      // ── desktop ──
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await openApp('desktop');
      let w = await where();
      await mouse('mouseMoved', w.o.x, w.o.y, 0); await sleep(400);
      out.hover = await lit();
      out.hoverShot = await shot(`${host.name}-desktop-hover-lights-file-group.png`, w.clip);
      assert.strictEqual(out.hover, FILE_N, `${host.name}: the hover on the letter O lights the whole file group (${FILE_N} curves)`);
      await click(w.o);
      out.click = await lit();
      assert.strictEqual(out.click, FILE_N, `${host.name}: a click selects the whole file group`);
      const g0 = await geo();
      await mouseDrag(w.o, { x: w.o.x + 60, y: w.o.y + 30 });
      out.drag = rigid(g0, await geo());
      assert.ok(out.drag.n === FILE_N && Math.hypot(...out.drag.v) > 1 && out.drag.spread < 1e-6, `${host.name}: the drag moved every curve of the file by the same vector: ${JSON.stringify(out.drag)}`);
      w = await where();
      await dblclick(w.o);
      out.enteredFile = { lit: await lit(), dimmed: await dimmed() };
      assert.deepStrictEqual(out.enteredFile, { lit: O_N, dimmed: 0 }, `${host.name}: a double click enters the file: the letter O selected (the whole drawing is the file: nothing outside it)`);
      await sleep(300); await dblclick(w.o);
      out.enteredO = { lit: await lit(), dimmed: await dimmed() };
      out.enteredShot = await shot(`${host.name}-desktop-entered-letter-O-rest-dimmed.png`, w.clip);
      assert.deepStrictEqual(out.enteredO, { lit: 1, dimmed: FILE_N - O_N }, `${host.name}: a second double click enters the letter O: one curve selected, the rest of the drawing dimmed`);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(400);
      out.escDimmed = await dimmed();
      assert.strictEqual(out.escDimmed, 0, `${host.name}: Esc steps out of O (back in the file: nothing dimmed)`);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(400);
      await click(w.o);
      assert.strictEqual(await lit(), FILE_N, `${host.name}: Esc again: at the top, a click selects the file group`);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      // the right-click menu: Enter group / Leave group
      await rightClick(w.o);
      out.menuTop = await menuIds();
      assert.ok(out.menuTop.includes('grp-ungroup') && out.menuTop.includes('grp-enter') && !out.menuTop.includes('grp-group') && !out.menuTop.includes('grp-leave'), `${host.name}: the menu on the file group: Ungroup + Enter group: ${out.menuTop}`);
      await click(await menuRow('grp-enter'));
      await click(w.o);
      out.menuEntered = await lit();
      assert.strictEqual(out.menuEntered, O_N, `${host.name}: Enter group (menu): inside the file a click selects the letter O`);
      await rightClick(w.o);
      out.menuInside = await menuIds();
      assert.ok(out.menuInside.includes('grp-leave'), `${host.name}: inside, the menu offers Leave group: ${out.menuInside}`);
      await click(await menuRow('grp-leave'));
      await click(w.o);
      assert.strictEqual(await lit(), FILE_N, `${host.name}: Leave group (menu): at the top again, a click selects the file`);
      // Group (menu): inside the file, the letter O + the dot (Shift) selected
      await sleep(300); await dblclick(w.o); await click(w.dot, 8);
      await rightClick(w.dot);
      out.menuTwo = await menuIds();
      assert.ok(out.menuTwo.includes('grp-group'), `${host.name}: O + the dot selected: the menu offers Group: ${out.menuTwo}`);
      await click(await menuRow('grp-group'));
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      await click(w.o);
      out.grouped = await lit();
      assert.strictEqual(out.grouped, FILE_N, `${host.name}: (stepped out: a click selects the file group again)`);
      await sleep(300); await dblclick(w.o);
      out.groupedInner = await lit();
      assert.strictEqual(out.groupedInner, O_N + 1, `${host.name}: Group (menu) made O + the dot one group: inside the file a click on O selects both`);
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(200);

    }
    if (phase === 'phone') {
      // ── phone ──
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await openApp('phone');
      let w = await where();
      await tap(w.o); await sleep(600);
      out.phoneTap = await lit();
      assert.strictEqual(out.phoneTap, FILE_N, `${host.name} phone: a tap selects the whole file group`);
      const p0 = await geo();
      await sleep(500);
      await touchDrag(w.o, { x: w.o.x + 30, y: w.o.y + 60 });
      out.phoneDrag = rigid(p0, await geo());
      assert.ok(out.phoneDrag.n === FILE_N && Math.hypot(...out.phoneDrag.v) > 1 && out.phoneDrag.spread < 1e-6, `${host.name} phone: the touch drag moved the file rigidly: ${JSON.stringify(out.phoneDrag)}`);
      w = await where();
      await sleep(600);
      const dtap = async (p) => { await tap(p); await sleep(180); await tap({ x: p.x + 5, y: p.y + 5 }); await sleep(600); };
      await dtap(w.o);
      out.phoneEnteredFile = await lit();
      assert.strictEqual(out.phoneEnteredFile, O_N, `${host.name} phone: a double tap (7 px apart) enters the file: the letter O selected`);
      await dtap(w.o);
      out.phoneEnteredO = { lit: await lit(), dimmed: await dimmed() };
      out.phoneEnteredShot = await shot(`${host.name}-phone-entered-letter-O-rest-dimmed.png`, { x: 0, y: Math.max(0, w.box.y - 40), width: 390, height: Math.min(400, w.box.b - w.box.y + 80) });
      assert.deepStrictEqual(out.phoneEnteredO, { lit: 1, dimmed: FILE_N - O_N }, `${host.name} phone: a second double tap enters O: the rest dimmed`);
      await tap(empty(w)); await sleep(600);
      assert.strictEqual(await dimmed(), 0, `${host.name} phone: a tap on empty canvas steps out (back in the file)`);
      await tap(empty(w)); await sleep(600);
      await T('touchStart', [w.o]); await sleep(750); await T('touchEnd', []); await sleep(300);
      out.phoneMenu = await menuIds();
      const ung = await menuRow('grp-ungroup');
      out.phoneMenuRowH = ung.h;
      out.phoneMenuShot = await shot(`${host.name}-phone-hold-menu.png`, { x: 0, y: Math.max(0, Math.min(w.box.y, ung.y) - 140), width: 390, height: 330 });
      assert.ok(out.phoneMenu.includes('grp-ungroup') && out.phoneMenu.includes('grp-enter') && ung.h >= 44, `${host.name} phone: the hold menu offers Ungroup + Enter group, rows >= 44 px: ${out.phoneMenu} (${ung.h} px)`);
      await tap(ung); await sleep(600);
      await tap(empty(w)); await sleep(600);
      await tap(w.o); await sleep(600);
      out.phoneAfterUngroup = await lit();
      assert.strictEqual(out.phoneAfterUngroup, O_N, `${host.name} phone: after Ungroup (menu only) a tap selects the letter O alone`);
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
    console.log(`groups-756-live ${host.name} ${phase}: ALL CHECKS PASSED ${JSON.stringify(out)}`);
    return out;
  } finally {
    await cdp.close();
  }
}
