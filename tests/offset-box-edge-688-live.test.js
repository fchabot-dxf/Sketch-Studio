// tests/offset-box-edge-688-live.test.js -- TASK 688 (live headless, REAL mouse 1600x900 + REAL phone touch 390x844, Pen Plotter Design tab):
// Offset distance box uses shared placeAnchoredBox (packages/ui/numeric-input-manager.js):
// near every canvas edge (right, bottom, left, top), #offset-distance-input stays inside #design-canvas,
// clear of the footer, clear of .offset-handle, and clear of .sk-done; focus, typing, Ctrl+Z (675C), Esc, and Enter work.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '688');
const STATE = 'window.__sketch.controller.state';
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

await (async () => {
  const cdp = await launchBrowser({ tag: '688', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(180));
    const ctrlOrCmd = process.platform === 'darwin' ? 4 : 2;
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { x: Math.max(0, Math.round(clip.x)), y: Math.max(0, Math.round(clip.y)), width: Math.round(clip.w), height: Math.round(clip.h), scale: 1 } } : {}) });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };

    for (const kind of ['mouse', 'touch']) {
      const phone = kind === 'touch';
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } : { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });
      const tap = async (p) => {
        if (phone) { await T('touchStart', [p]); await sleep(60); await T('touchEnd', []); await sleep(280); }
        else { await mouse('mouseMoved', p.x, p.y, 0); await sleep(50); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y, 0); await sleep(220); }
      };

      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `[${kind}] design tab`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, `[${kind}] design canvas`);
      await sleep(300);

      const cr = await evalJs(`(() => { const r = document.querySelector('#design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
      const edges = [
        { name: 'right',  p1: { x: cr.r - 12, y: cr.t + 170 }, p2: { x: cr.r - 12, y: cr.t + 300 }, hover: { x: cr.r - 2, y: cr.t + 235 } },
        { name: 'bottom', p1: { x: cr.l + 150, y: cr.b - 12 }, p2: { x: cr.l + 270, y: cr.b - 12 }, hover: { x: cr.l + 210, y: cr.b - 2 } },
        { name: 'left',   p1: { x: cr.l + 12, y: cr.t + 400 }, p2: { x: cr.l + 12, y: cr.t + 520 }, hover: { x: cr.l + 2, y: cr.t + 460 } },
        { name: 'top',    p1: { x: Math.round(cr.l + cr.w * 0.36), y: cr.t + 14 }, p2: { x: Math.round(cr.l + cr.w * 0.54), y: cr.t + 14 }, hover: { x: Math.round(cr.l + cr.w * 0.45), y: cr.t + 2 } },
      ];

      for (const edge of edges) {
        await waitFor(`!document.getElementById('notification-container') || document.getElementById('notification-container').children.length === 0`, `[${kind} ${edge.name}] clear toasts`, 20000);
        await evalJs(`${STATE}.clearDocument()`);
        await sleep(120);
        await pressRibbonTool(evalJs, tap, 'tool-line');
        await sleep(150);
        await tap(edge.p1);
        await tap(edge.p2);
        await key('Escape', 'Escape', 27);
        assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 1, `[${kind} ${edge.name}] 1 source line drawn`);

        await pressRibbonTool(evalJs, tap, 'tool-offset');
        await sleep(150);
        const mid = { x: Math.round((edge.p1.x + edge.p2.x) / 2), y: Math.round((edge.p1.y + edge.p2.y) / 2) };
        await tap(mid);
        await waitFor(`!!document.getElementById('offset-distance-input')`, `[${kind} ${edge.name}] distance box opened`);
        if (!phone) {
          await mouse('mouseMoved', edge.hover.x, edge.hover.y, 0);
          await sleep(100);
        }
        await waitFor(`!!document.querySelector('#offset-tool-overlay .offset-handle')`, `[${kind} ${edge.name}] drag arrow rendered`);
        await sleep(120);

        const m = await evalJs(`(() => {
          const el = document.getElementById('offset-distance-input');
          const c = document.getElementById('design-canvas').getBoundingClientRect();
          const f = document.querySelector('.sk-footer')?.getBoundingClientRect();
          const hd = document.querySelector('#offset-tool-overlay .offset-handle')?.getBoundingClientRect();
          const dn = document.querySelector('.sk-done:not([hidden])')?.getBoundingClientRect();
          const b = el.getBoundingClientRect();
          const norm = (r) => r ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null;
          return { canvas: norm(c), footer: norm(f), box: norm(b), handle: norm(hd), done: norm(dn), activeId: document.activeElement?.id, val: el.value };
        })()`);
        console.log(`[${kind} ${edge.name}]`, JSON.stringify(m));

        if (edge.name === 'right' || edge.name === 'bottom') {
          const cx = edge.name === 'right' ? Math.max(0, m.canvas.r - 240) : Math.max(0, m.box.l - 60);
          const cy = edge.name === 'bottom' ? Math.max(0, m.canvas.b - 180) : Math.max(0, m.box.t - 80);
          await shot(`${kind}-${edge.name}.png`, { x: cx, y: cy, w: Math.min(260, m.canvas.w), h: Math.min(220, m.canvas.h) });
        }

        assert(m.box.l >= m.canvas.l && m.box.r <= m.canvas.r && m.box.t >= m.canvas.t && m.box.b <= m.canvas.b,
          `[${kind} ${edge.name}] box must be inside canvas: box=${JSON.stringify(m.box)} canvas=${JSON.stringify(m.canvas)}`);
        if (m.footer) assert(!overlap(m.box, m.footer), `[${kind} ${edge.name}] box must be clear of footer: box=${JSON.stringify(m.box)} footer=${JSON.stringify(m.footer)}`);
        if (m.handle) assert(!overlap(m.box, m.handle), `[${kind} ${edge.name}] box must not overlap .offset-handle: box=${JSON.stringify(m.box)} handle=${JSON.stringify(m.handle)}`);
        if (m.done) assert(!overlap(m.box, m.done), `[${kind} ${edge.name}] box must not overlap .sk-done: box=${JSON.stringify(m.box)} done=${JSON.stringify(m.done)}`);

        // Verify typing + live preview + 675C Ctrl+Z + Enter commit on bottom edge
        if (edge.name === 'bottom') {
          const defVal = m.val;
          const hBefore = await evalJs(`${STATE}.history.length`);
          await evalJs(`(() => { const i = document.getElementById('offset-distance-input'); i.focus(); i.select(); })()`);
          for (const ch of '12') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
          await sleep(100);
          assert.strictEqual(await evalJs(`document.getElementById('offset-distance-input').value`), '12', `[${kind}] typed 12`);
          await key('z', 'KeyZ', 90, ctrlOrCmd);
          assert.strictEqual(await evalJs(`document.getElementById('offset-distance-input').value`), defVal, `[${kind}] Ctrl+Z restored default`);
          assert.strictEqual(await evalJs(`${STATE}.history.length`), hBefore, `[${kind}] Ctrl+Z in box did not undo document`);
          await key('Enter', 'Enter', 13);
          assert.strictEqual(await evalJs(`document.getElementById('offset-distance-input')`), null, `[${kind}] Enter closed box`);
          assert.strictEqual(await evalJs(`${STATE}.constraints.filter((c) => c.type === 'offset').length`), 1, `[${kind}] Enter applied offset`);
        } else {
          await key('Escape', 'Escape', 27);
          assert.strictEqual(await evalJs(`document.getElementById('offset-distance-input')`), null, `[${kind} ${edge.name}] Esc closed box`);
        }
      }
    }
    console.log('offset-box-edge-688-live: ok');
  } finally { await cdp.close(); }
})();
