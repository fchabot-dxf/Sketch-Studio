// tests/arc-3point-1022-live.test.js — TASK 1022 (live headless, real mouse and real touch via CDP, SketchStudio): the Arc button's variant menu shows
// Center Point Arc and 3-Point Arc on desktop (1280 x 800) and on a phone (390 x 844), and a 3-Point Arc drawn by pointer (start, end, a point on the arc)
// appears on the canvas. Screenshots to .evidence/1022/. The node twin with every rule: tests/arc-3point-1022-node.test.js.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID_DIR = path.join(WORKTREE_ROOT, '.evidence', '1022');
const EXPECTED = [{ mode: 'arc-cse', label: 'Center Point Arc' }, { mode: 'arc-3pt', label: '3-Point Arc' }];

await (async () => {
  const cdp = await launchBrowser({ tag: '1022-arc3pt', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID_DIR, { recursive: true });
    const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;
    const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: 0, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
    const move = async (x, y) => { await mouse('mouseMoved', Math.round(x), Math.round(y)); await sleep(60); };
    const click = async (x, y) => { const rx = Math.round(x), ry = Math.round(y); await move(rx, ry); await mouse('mousePressed', rx, ry, { buttons: 1 }); await sleep(40); await mouse('mouseReleased', rx, ry); await sleep(180); };
    const tap = async (x, y) => {
      const rx = Math.round(x), ry = Math.round(y);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rx, y: ry, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
      await sleep(50);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(220);
    };
    const shot = async (file, clip) => {
      await sleep(150);
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
      fs.writeFileSync(path.join(EVID_DIR, file), Buffer.from(r.data, 'base64'));
      console.log('  screenshot', path.join('.evidence', '1022', file));
    };
    const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
    const canvasAt = (dx, dy) => evalJs(`(() => { const r = document.querySelector('#svgCanvas').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2 + ${dx}), y: Math.round(r.top + r.height / 2 + ${dy}) }; })()`);
    const toWorld = (p) => evalJs(`(() => { const s = document.querySelector('#svgCanvas'); const q = s.createSVGPoint(); q.x = ${p.x}; q.y = ${p.y}; const w = q.matrixTransform(s.getScreenCTM().inverse()); return { x: w.x, y: w.y }; })()`);
    // the drawn arcs: each arc path's "M sx sy A r r 0 large sweep ex ey" (world units)
    const arcPaths = () => evalJs(`[...document.querySelectorAll('#svgCanvas path.shape-elem')].map((p) => p.getAttribute('d') || '').filter((d) => / A /.test(d)).map((d) => d.trim().split(/[\\s,]+/))`);
    const variantMenu = async (pressAt) => {   // the Arc button (or, when the bar has no room for it, its row in CREATE's dropdown), then its variant menu
      const hidden = await evalJs(`document.getElementById('tool-arc').hidden || document.getElementById('tool-arc').getBoundingClientRect().width === 0`);
      if (hidden) {
        const sec = await rectOf('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label');
        await pressAt(sec.cx, sec.cy);
        await waitFor(`!!document.querySelector('.sk-ribbon-sect-menu.show')`, 'CREATE dropdown');
        const row = await rectOf('.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="tool-arc"]');
        await pressAt(row.cx, row.cy);
      } else {
        const b = await rectOf('#tool-arc');
        await pressAt(b.cx, b.cy);
      }
      await waitFor(`!!document.querySelector('.sk-ribbon-menu.show [data-mode="arc-3pt"]')`, 'the Arc variant menu');
      const items = await evalJs(`[...document.querySelectorAll('.sk-ribbon-menu.show .sk-ribbon-menu-item')].map((el) => ({ mode: el.dataset.mode, label: el.textContent.trim() }))`);
      assert.deepStrictEqual(items, EXPECTED, 'the Arc variants: Center Point Arc, 3-Point Arc');
      return evalJs(`(() => { const m = document.querySelector('.sk-ribbon-menu.show').getBoundingClientRect(); const b = (document.getElementById('tool-arc').getBoundingClientRect().width ? document.getElementById('tool-arc') : document.querySelector('.sk-ribbon-group[data-section="create"] .sk-ribbon-group-label')).getBoundingClientRect();
        const x = Math.max(0, Math.floor(Math.min(b.left, m.left) - 12)), y = Math.max(0, Math.floor(Math.min(b.top, m.top) - 10));
        return { x, y, width: Math.min(innerWidth - x, Math.ceil(Math.max(b.right, m.right) + 16 - x)), height: Math.ceil(Math.max(b.bottom, m.bottom) + 12 - y) }; })()`);
    };
    /** three presses: start, end, a point on the arc; checks one arc appears through them (the third point on its circle, the snaps' slack allowed) */
    const drawThreePoint = async (pressAt, [a, b, c], label) => {
      const before = (await arcPaths()).length;
      for (const p of [a, b, c]) { if (pressAt === click) await move(p.x, p.y); await pressAt(p.x, p.y); }
      await sleep(250);
      const paths = await arcPaths();
      assert.strictEqual(paths.length, before + 1, `${label}: one arc appears (${paths.length - before})`);
      const d = paths[paths.length - 1];
      const r = Number(d[4]);
      const [ws, we, wp] = [await toWorld(a), await toWorld(b), await toWorld(c)];
      const D = 2 * (ws.x * (we.y - wp.y) + we.x * (wp.y - ws.y) + wp.x * (ws.y - we.y));
      const ux = ((ws.x ** 2 + ws.y ** 2) * (we.y - wp.y) + (we.x ** 2 + we.y ** 2) * (wp.y - ws.y) + (wp.x ** 2 + wp.y ** 2) * (ws.y - we.y)) / D;
      const uy = ((ws.x ** 2 + ws.y ** 2) * (wp.x - we.x) + (we.x ** 2 + we.y ** 2) * (ws.x - wp.x) + (wp.x ** 2 + wp.y ** 2) * (we.x - ws.x)) / D;
      const rClicks = Math.hypot(ws.x - ux, ws.y - uy);
      assert(Math.abs(r - rClicks) < 0.03 * rClicks, `${label}: the arc's radius ${r} is the circle through the three clicks' ${rClicks.toFixed(3)}`);
      assert(Math.hypot(Number(d[1]) - ws.x, Number(d[2]) - ws.y) < 0.03 * rClicks, `${label}: it starts at the first click`);
      assert(Math.hypot(Number(d[9]) - we.x, Number(d[10]) - we.y) < 0.03 * rClicks, `${label}: it ends at the second click`);
      return { r, d };
    };
    const arcClip = async (pts) => ({ x: Math.max(0, Math.min(...pts.map((p) => p.x)) - 60), y: Math.max(0, Math.min(...pts.map((p) => p.y)) - 60), width: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) + 120, height: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) + 120 });

    // ── 1. desktop 1280 x 800 ──
    await resetBufferLive({ port, navigate, waitFor });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-arc')`, 'ribbon #tool-arc');
    const menuClip = await variantMenu(click);
    await shot('arc-variants-desktop.png', menuClip);
    const row = await rectOf('.sk-ribbon-menu.show [data-mode="arc-3pt"]');
    await click(row.cx, row.cy);
    await waitFor(`!document.querySelector('.sk-ribbon-menu.show') && document.getElementById('tool-arc').classList.contains('active')`, '3-Point Arc active');
    const pts = [await canvasAt(-150, 40), await canvasAt(150, 40), await canvasAt(10, -90)];
    const desk = await drawThreePoint(click, pts, 'desktop');
    await move(pts[2].x + 200, pts[2].y + 150);
    await shot('arc-3pt-desktop.png', await arcClip(pts));
    console.log('1. desktop: variant menu + 3-point arc OK', JSON.stringify(desk.d.join(' ')));

    // ── 2. phone 390 x 844, touch ──
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await resetBufferLive({ port, navigate, waitFor });
    await navigate(url);
    await waitForApp('svgCanvas');
    await waitFor(`!!document.querySelector('#tool-arc')`, 'phone ribbon #tool-arc');
    const phoneMenu = await variantMenu(tap);
    await shot('arc-variants-phone.png', phoneMenu);
    const prow = await rectOf('.sk-ribbon-menu.show [data-mode="arc-3pt"]');
    await tap(prow.cx, prow.cy);
    await waitFor(`!document.querySelector('.sk-ribbon-menu.show')`, 'phone menu closed');
    const ppts = [await canvasAt(-120, 60), await canvasAt(120, 60), await canvasAt(0, -40)];
    const phone = await drawThreePoint(tap, ppts, 'phone');
    await shot('arc-3pt-phone.png', { x: 0, y: Math.max(0, Math.min(...ppts.map((p) => p.y)) - 140), width: 390, height: 360 });
    console.log('2. phone: variant menu + 3-point arc by touch OK', JSON.stringify(phone.d.join(' ')));
    console.log('arc-3point-1022-live: ALL CHECKS PASSED');
  } finally {
    await cdp.close();
  }
})();
