// tests/done-check-fillet-edge-653-live.test.js -- TASK 653 (fillet audit F5 + F5b; live headless, REAL touch on a 390 x 844 phone and REAL mouse at 1600 x 900,
// Pen Plotter = the shared Design tab). With a remembered radius of 15:
//  - phone, an L whose corner is 40 px inside the canvas's bottom-right: the tap that opens the Fillet opens the radius box and makes NO arc; the green check is
//    on screen, >= 44 px (centre) from the corner and clear of the box; tapping the check then applies the fillet;
//  - phone, the corner 20 px inside the right edge: the radius box lies inside the canvas;
//  - desktop, a corner in the middle: the check sits 16 px below-right of the corner and the box 14 px below-right (no change where a slot is free).
// Screenshots: .evidence/653.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '653');
const STATE = 'window.__sketch.controller.state';

await (async () => {
  const cdp = await launchBrowser({ tag: '653', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    for (const kind of ['touch', 'mouse']) {
      const phone = kind === 'touch';
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
      const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
      const tap = async (p) => {
        if (phone) { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(300); }
        else { await mouse('mouseMoved', p.x, p.y, 0); await sleep(60); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(250); }
      };
      const key = (k, code, vk) => sendRealKey(send, k, code, vk).then(() => sleep(200));
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `[${kind}] the stage button`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, `[${kind}] the design canvas`);
      await sleep(500);
      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`);
      const arcs = () => evalJs(`${STATE}.shapes.filter((s) => s.type === 'arc').length`);
      const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e || e.hidden || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const shot = async (name, E) => send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(0, E.x - 230), y: Math.max(0, E.y - 200), width: Math.min(260, cr.r - E.x + 240), height: 240, scale: phone ? 2 : 1 } })
        .then((r) => fs.writeFileSync(path.join(EVID, `${name}-${kind}.png`), Buffer.from(r.data, 'base64')));
      const drawL = async (E) => {
        await waitFor(`!document.getElementById('notification-container') || document.getElementById('notification-container').children.length === 0`, `[${kind}] the toasts to go (they lie over the lower canvas)`, 20000);
        await evalJs(`${STATE}.clearDocument()`); await sleep(150);
        await pressRibbonTool(evalJs, tap, 'tool-line'); await sleep(200);
        const A = phone ? 120 : 300; // arms long enough for R 15 at the desktop's scale
        await tap({ x: E.x - A, y: E.y }); await tap(E); await tap({ x: E.x, y: E.y - A }); await key('Escape', 'Escape', 27);
        assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 2, `[${kind}] the L is drawn`);
        await pressRibbonTool(evalJs, tap, 'tool-fillet'); await sleep(200);
      };
      // remember R = 15: one fillet typed and applied in the middle of the canvas
      const M = { x: (cr.l + cr.r) / 2 + 40, y: (cr.t + cr.b) / 2 };
      await drawL(M);
      await tap(M);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, `[${kind}] the radius box (middle)`);
      await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
      for (const ch of '15') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await key('Enter', 'Enter', 13);
      assert.strictEqual(await arcs(), 1, `[${kind}] the first fillet (R 15) is applied`);

      if (!phone) {
        // desktop, a free slot: the check and the box are where they always were
        await drawL(M);
        await tap(M);
        await waitFor(`!!document.getElementById('fillet-radius-input')`, '[mouse] the radius box');
        await sleep(300);
        const b = await rectOf('#fillet-radius-input'), d = await rectOf('.sk-done');
        assert(d, '[mouse] the check shows');
        assert(Math.abs(b.l - (M.x + 14)) <= 3 && Math.abs(b.t - (M.y + 14)) <= 3, `[mouse] the box is 14 px below-right of the corner: ${JSON.stringify(b)} corner ${JSON.stringify(M)}`);
        const cand = [[M.x + 16, M.y + 16], [M.x + 16, M.y - 16 - 40], [M.x - 16 - 40, M.y + 16], [M.x - 16 - 40, M.y - 16 - 40]];
        const hit = cand.find(([x, y]) => Math.abs(d.l - x) <= 3 && Math.abs(d.t - y) <= 3);
        console.log(`[mouse] box ${JSON.stringify(b)} check ${JSON.stringify(d)} corner ${JSON.stringify(M)} slot ${JSON.stringify(hit)}`);
        assert(hit, '[mouse] the check sits on one of the four slots beside the corner');
        await shot('desktop-middle', M);
        continue;
      }
      // phone, the corner 40 px inside the bottom-right
      const E = { x: cr.r - 40, y: cr.b - 40 };
      await drawL(E);
      await tap(E);
      await sleep(400);
      const nArcs = await arcs(), box = await rectOf('#fillet-radius-input'), done = await rectOf('.sk-done');
      await shot('corner40', E);
      console.log(`[touch] 40px corner: arcs ${nArcs} box ${JSON.stringify(box)} check ${JSON.stringify(done)} corner ${JSON.stringify(E)}`);
      assert.strictEqual(nArcs, 0, `[touch] the tap that opens the Fillet does not also apply it (arcs ${nArcs})`);
      assert(box, '[touch] the radius box is open');
      assert(box.l >= cr.l && box.r <= cr.r && box.t >= cr.t && box.b <= cr.b, `[touch] the box is inside the canvas: ${JSON.stringify(box)}`);
      assert(done, '[touch] the green check is on screen');
      assert(done.l >= cr.l && done.r <= cr.r && done.t >= cr.t && done.b <= cr.b, `[touch] the check is inside the canvas: ${JSON.stringify(done)}`);
      assert(Math.hypot(done.x - E.x, done.y - E.y) >= 44, `[touch] the check is >= 44 px from the corner: ${Math.hypot(done.x - E.x, done.y - E.y)}`);
      assert(!(done.l < box.r && done.r > box.l && done.t < box.b && done.b > box.t), '[touch] the check does not cover the box');
      const hd = await rectOf('#fillet-tool-overlay .fillet-handle');
      if (hd) assert(!(box.l < hd.r && box.r > hd.l && box.t < hd.b && box.b > hd.t), `[touch] the box does not cover the arrow: ${JSON.stringify(hd)}`);
      await tap({ x: done.x, y: done.y });
      assert.strictEqual(await arcs(), 1, '[touch] tapping the check applies the fillet');
      // phone, the corner 20 px inside the right edge
      const E2 = { x: cr.r - 20, y: cr.b - 20 };
      await drawL(E2);
      await tap(E2);
      await sleep(400);
      const b2 = await rectOf('#fillet-radius-input'), d2 = await rectOf('.sk-done');
      await shot('corner20', E2);
      console.log(`[touch] 20px corner: arcs ${await arcs()} box ${JSON.stringify(b2)} check ${JSON.stringify(d2)} canvas ${JSON.stringify(cr)}`);
      assert(b2 && b2.l >= cr.l && b2.r <= cr.r && b2.t >= cr.t && b2.b <= cr.b, `[touch] the box is inside the canvas: ${JSON.stringify(b2)} canvas ${JSON.stringify(cr)}`);
      assert.strictEqual(await arcs(), 0, '[touch] the 20 px tap did not apply the fillet');
      assert(d2 && Math.hypot(d2.x - E2.x, d2.y - E2.y) >= 44, `[touch] the check is >= 44 px from the corner: ${JSON.stringify(d2)}`);
      assert(!(d2.l < b2.r && d2.r > b2.l && d2.t < b2.b && d2.b > b2.t), '[touch] the check does not cover the box (20 px)');
    }
    console.log('done-check-fillet-edge-653-live.test.js: ok');
  } finally { await cdp.close(); }
})();
