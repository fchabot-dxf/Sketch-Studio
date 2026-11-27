// tests/body-drag-no-snap-1032-live.test.js — TASK 1032 in the REAL Shaper Design canvas (headless, real CDP mouse on desktop 1280x800, real
// CDP touch on a phone 390x844): a line dragged by its MIDDLE takes no snap during the drag. Its grabbed spot passes 1 mm right of the Y axis
// (inside the snap magnet) and its end is dropped 0.1 cm from another line's end point (Fusion's measured case A, 2026-11-27, real mouse:
// end at (8.0861, 3.0596) cm, no constraint added). No snap is held (state.activeSnap / snapTarget) and no snap glyph is drawn (the axis
// highlight [data-snap-axis], the snap diamond) at any pointer of the drag; on release the end is at the cursor's offset, no constraint is
// added, one undo step. Before (BUG-340) the grabbed spot snapped onto the Y axis (the owner's phone: the on-line diamond, the line jumped).
// Evidence: .evidence/1032/live-<tag>-at-axis.png and live-<tag>-at-drop.png (the canvas around the pointer as the grabbed spot crosses the Y axis,
// and at the last pointer before the release; zoomed 2x).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const EVIDENCE_DIR = path.resolve('.evidence/1032');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) { failures.push(msg); console.log('  FAIL ' + msg); } else console.log('  ok ' + msg); };
const ST = 'window.__designController.state';
// world mm: the target line T, its end T2 (the "(8,3) cm" point, scaled to fit a phone), the free line L dragged by its middle
const T1 = { x: 20, y: 15 }, T2 = { x: 40, y: 15 }, P = { x: -30, y: -30 }, Q = { x: -15, y: -30 };
const OFF = { x: 0.861, y: 0.596 }; // Fusion's drop offset from the point, mm

async function run({ width, height, tag }) {
  const label = `${width}x${height}`;
  const isPhone = width <= 640;
  const cdp = await launchBrowser({ tag: `1032-${tag}`, width, height,
    args: ['--host-resolver-rules=MAP *googleapis.com ~NOTFOUND, MAP *google.com ~NOTFOUND, MAP *gstatic.com ~NOTFOUND, MAP *shapertools.com ~NOTFOUND'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
  const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
  const mouse = (type, p, buttons) => send('Input.dispatchMouseEvent', { type, x: Math.round(p.x), y: Math.round(p.y), button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
    buttons: buttons !== undefined ? buttons : type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touches = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const tap = async (p) => {
    if (isPhone) { await touches('touchStart', [p]); await sleep(60); await touches('touchEnd', []); }
    else { await mouse('mouseMoved', p); await sleep(40); await mouse('mousePressed', p); await sleep(40); await mouse('mouseReleased', p); }
    await sleep(200);
  };
  const w2s = (wx, wy) => evalJs(`(() => { const svg = document.getElementById('design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${wx}; pt.y = ${wy}; const p = pt.matrixTransform(svg.getScreenCTM()); return { x: p.x, y: p.y }; })()`);
  const s2w = (p) => evalJs(`(() => { const svg = document.getElementById('design-canvas'); const pt = svg.createSVGPoint(); pt.x = ${Math.round(p.x)}; pt.y = ${Math.round(p.y)}; const w = pt.matrixTransform(svg.getScreenCTM().inverse()); return { x: w.x, y: w.y }; })()`);
  const esc = async () => { await sendRealKey(send, 'Escape', 'Escape', 27, 0, ''); await sleep(150); };
  // after two frames (the render loop drew this pointer): the snap held and the snap glyphs drawn
  const sample = () => evalJs(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => { const st = ${ST}; const svg = document.getElementById('design-canvas'); const s = st.activeSnap || st.snapTarget;
    r({ snap: s ? (s.type + ':' + (s.targetId || '')) : null, axis: svg.querySelectorAll('[data-snap-axis]').length, diamonds: svg.querySelectorAll('rect[transform^="rotate(45"]').length,
        drag: st.drag ? st.drag.type : null, body: !!(st.drag && st.drag.body), startWorld: st.drag ? st.drag.startWorld : null }); })))`);
  const line = (id) => evalJs(`(() => { const st = ${ST}; const s = st.shapes.find((x) => x.id === ${JSON.stringify(id)}); return s.joints.map((j) => ({ id: j, x: st.joints.get(j).x, y: st.joints.get(j).y })); })()`);
  const counts = () => evalJs(`(() => { const st = ${ST}; return { constraints: st.constraints.length, U: st.history.length, lines: st.shapes.filter((s) => s.type === 'line').map((s) => s.id) }; })()`);
  const shot = async (name, at) => {
    const R = 70; const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, at.x - R), y: Math.max(0, at.y - R), width: 2 * R, height: 2 * R, scale: 2 } });
    const f = path.join(EVIDENCE_DIR, `${name}.png`); fs.writeFileSync(f, Buffer.from(data, 'base64')); return f;
  };

  try {
    await installFakeDriveSession(cdp);
    if (isPhone) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmitTouchEventsForMouse', { enabled: false });
    }
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 15000);
    await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper design tab', 12000);
    await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    await waitForApp('design-canvas');
    await waitFor(`!!(${ST}) && document.getElementById('design-canvas').getBoundingClientRect().width > 0`, 'design controller', 12000);
    await sleep(400);
    if (!isPhone) await evalJs(`(() => { const b = document.querySelector('.sk-browser'); const t = document.querySelector('.sk-browser-toggle'); if (b && t && !b.classList.contains('collapsed')) t.click(); })()`);
    await esc();
    await evalJs(`(async () => { const st = ${ST}; const m = await import('/packages/ui/input-manager.js'); m.switchToTool(st, 'select'); st.clearDocument();
      st.view.x = 5; st.view.y = -8; st.view.w = 110; const { updateViewBox } = await import('/packages/ui/input-handlers/pan-zoom.js');
      updateViewBox(document.getElementById('design-canvas'), st.view); })()`);
    await sleep(200);

    // the two lines, drawn with the Line tool (each its own chain)
    for (const [u, v] of [[T1, T2], [P, Q]]) { // Esc ends the Line tool: it is pressed again for each line
      await pressRibbonTool(evalJs, tap, 'tool-line'); await sleep(120);
      await tap(await w2s(u.x, u.y)); await tap(await w2s(v.x, v.y)); await esc();
    }
    await pressRibbonTool(evalJs, tap, 'tool-select'); await sleep(150); await esc();
    const c0 = await counts();
    check(c0.lines.length === 2, `[${label}] two lines drawn (${c0.lines.join(' ')})`);
    // L: the line whose ends are near P / Q; T2: the drawn end of T near (40, 15)
    const all = await Promise.all(c0.lines.map(line));
    const iL = all.findIndex((js) => js.some((j) => Math.hypot(j.x - P.x, j.y - P.y) < 3));
    const L = all[iL], Tl = all[1 - iL];
    const q0 = L.reduce((a, b) => (b.x > a.x ? b : a)), p0 = L.find((j) => j !== q0);
    const t2 = Tl.reduce((a, b) => (b.x > a.x ? b : a));
    console.log(`[${label}] L ${JSON.stringify(L)} T ${JSON.stringify(Tl)}`);

    // the drag: press on L's middle, the grabbed spot passes 1 mm right of the Y axis, the end is dropped 0.1 cm (OFF) from T's end
    const mid0 = { x: (p0.x + q0.x) / 2, y: (p0.y + q0.y) / 2 };
    const endMid = { x: mid0.x + (t2.x + OFF.x - q0.x), y: mid0.y + (t2.y + OFF.y - q0.y) };
    const a = await w2s(mid0.x, mid0.y), ax = await w2s(1, (mid0.y + endMid.y) / 2), b = await w2s(endMid.x, endMid.y);
    const pts = [];
    for (const [u, v] of [[a, ax], [ax, b]]) for (let i = 1; i <= 14; i++) pts.push({ x: Math.round(u.x + (v.x - u.x) * i / 14), y: Math.round(u.y + (v.y - u.y) * i / 14), atAxis: v === ax && i === 14 });
    if (isPhone) { await touches('touchStart', [a]); await sleep(40); } else { await mouse('mouseMoved', a); await sleep(60); await mouse('mousePressed', a); await sleep(60); }
    const seen = []; let startWorld = null, axisShot = null, axisGrab = null, dropShot = null;
    for (const p of pts) {
      if (isPhone) await touches('touchMove', [p]); else await mouse('mouseMoved', p, 1);
      await sleep(25);
      const s = await sample();
      if (!startWorld && s.startWorld) startWorld = s.startWorld;
      if (s.snap || s.axis || s.diamonds) seen.push(`(${p.x}, ${p.y}) snap ${s.snap} axis ${s.axis} diamonds ${s.diamonds}`);
      if (p.atAxis) {
        const ln = await line(c0.lines[iL]); const g = { x: (ln[0].x + ln[1].x) / 2, y: (ln[0].y + ln[1].y) / 2 };
        axisGrab = { cursor: await s2w(p), grabbed: g, drag: s.drag, body: s.body };
        axisShot = await shot(`live-${tag}-at-axis`, p);
      }
      if (p === pts[pts.length - 1]) dropShot = await shot(`live-${tag}-at-drop`, await w2s(t2.x, t2.y)); // the last pointer, held: around T's end, where L's end is dropped
    }
    if (isPhone) { await touches('touchEnd', []); } else { await mouse('mouseReleased', b); }
    await sleep(400);
    const c1 = await counts();
    const L1 = await line(c0.lines[iL]); const q1 = L1.find((j) => j.id === q0.id);
    const cursorEnd = await s2w(b);
    const want = { x: q0.x + cursorEnd.x - startWorld.x, y: q0.y + cursorEnd.y - startWorld.y };
    console.log(`[${label}] at the Y axis: ${JSON.stringify(axisGrab)}; end ${JSON.stringify(q1)} want ${JSON.stringify(want)}; T2 ${JSON.stringify(t2)}; evidence ${axisShot} ${dropShot}`);
    check(axisGrab && axisGrab.drag === 'line' && axisGrab.body, `[${label}] the press on the middle is a BODY drag of the line (${axisGrab && axisGrab.drag}, body ${axisGrab && axisGrab.body})`);
    check(seen.length === 0, `[${label}] no snap held and no snap glyph drawn at any of the ${pts.length} pointers of the body drag${seen.length ? ': ' + seen.slice(0, 3).join('; ') : ''}`);
    check(axisGrab && Math.abs(axisGrab.grabbed.x - (axisGrab.cursor.x - (startWorld.x - mid0.x))) < 0.05, `[${label}] at the Y axis the grabbed spot is at the cursor, not on the axis (grabbed x ${axisGrab && axisGrab.grabbed.x.toFixed(4)}, cursor x ${axisGrab && axisGrab.cursor.x.toFixed(4)})`);
    check(Math.hypot(q1.x - want.x, q1.y - want.y) < 1e-3, `[${label}] the end is at the cursor offset (${q1.x.toFixed(4)}, ${q1.y.toFixed(4)}) vs (${want.x.toFixed(4)}, ${want.y.toFixed(4)})`);
    check(Math.hypot(q1.x - t2.x, q1.y - t2.y) > 0.3, `[${label}] the end did not snap onto T's end`);
    check(c1.constraints === c0.constraints, `[${label}] no constraint added (${c0.constraints} -> ${c1.constraints})`);
    check(c1.U === c0.U + 1, `[${label}] one undo step (${c0.U} -> ${c1.U})`);
    console.log(`[${label}] done`);
  } finally {
    await close();
  }
}

await run({ width: 1280, height: 800, tag: 'desktop' });
await run({ width: 390, height: 844, tag: 'phone' });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('body-drag-no-snap-1032-live: PASS');
