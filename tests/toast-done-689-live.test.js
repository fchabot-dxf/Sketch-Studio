// tests/toast-done-689-live.test.js — TASK 689 (fail-first measurement + verification, phone 390x844 touch + desktop 1280x800 mouse):
// A visible #notification-container toast must NEVER cover the green .sk-done check button or swallow taps on it,
// for every tool that shows .sk-done (Fillet, Line chain, Offset).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.join(process.cwd(), '.evidence', '689');
const prefix = process.env.EVID_PREFIX || 'after';
const STATE = '(window.__sketch && window.__sketch.controller ? window.__sketch.controller.state : window.__designController.state)';

function rectOverlap(a, b) {
  if (!a || !b) return 0;
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

await (async () => {
  const cdp = await launchBrowser({ tag: '689', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });

  try {
    fs.mkdirSync(EVID, { recursive: true });
    for (const kind of ['phone', 'desktop']) {
      const phone = kind === 'phone';
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', phone
        ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, hasTouch: true }
        : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, hasTouch: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: phone ? 5 : 0 });

      const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', {
        type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
      });
      const touch = (type, pts) => send('Input.dispatchTouchEvent', {
        type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })),
      });
      const tap = async (p) => {
        if (phone) { await touch('touchStart', [p]); await sleep(50); await touch('touchEnd', []); await sleep(240); }
        else { await mouse('mouseMoved', p.x, p.y, 0); await sleep(40); await mouse('mousePressed', p.x, p.y, 1); await sleep(35); await mouse('mouseReleased', p.x, p.y, 0); await sleep(220); }
      };
      const key = (k, code, vk) => sendRealKey(send, k, code, vk).then(() => sleep(180));
      const waitNoToasts = () => waitFor(`!document.getElementById('notification-container') || document.getElementById('notification-container').children.length === 0`, `[${kind}] existing toasts cleared`, 15000);
      const readRects = () => evalJs(`(() => {
        const done = document.querySelector('.sk-done');
        const toasts = [...document.querySelectorAll('#notification-container [data-level]')].filter((el) => el.getClientRects().length > 0);
        const rOf = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left * 10) / 10, top: Math.round(r.top * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 }; };
        const dr = done && !done.hidden ? rOf(done) : null;
        const cx = dr ? dr.left + dr.width / 2 : null;
        const cy = dr ? dr.top + dr.height / 2 : null;
        const hit = (cx != null) ? document.elementFromPoint(cx, cy) : null;
        const tRects = toasts.map((t) => ({ rect: rOf(t), text: (t.textContent || '').trim() }));
        return {
          doneRect: dr,
          toastRects: tRects,
          hitTag: hit ? hit.tagName : null,
          hitInDone: !!(done && hit && (hit === done || done.contains(hit))),
          hitInToast: !!(hit && hit.closest && hit.closest('#notification-container')),
        };
      })()`);
      const shot = async (name, box) => {
        const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
        fs.writeFileSync(path.join(EVID, `${prefix}-${kind}-${name}.png`), Buffer.from(s.data, 'base64'));
      };

      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 10000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, `[${kind}] design tab`);
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`!!${STATE} && document.querySelector('#design-canvas').getBoundingClientRect().width > 0`, `[${kind}] design state ready`);
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
      await waitNoToasts();

      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round((cr.l + cr.r) / 2), y: Math.round((cr.t + cr.b) / 2) };

      // Build three clean L-corners:
      // L1 & L1b in upper canvas (trigger two stacked "Fillet applied" toasts, realistic multi-fillet phone flow)
      // L2 in lower-left/middle canvas right above the toast band
      const L1 = { a: { x: C.x + 90, y: C.y - 110 }, c: { x: C.x, y: C.y - 110 }, b: { x: C.x, y: C.y - 25 } };
      const L1b = { a: { x: C.x + 90, y: C.y - 10 }, c: { x: C.x + 90, y: C.y + 70 }, b: { x: C.x + 15, y: C.y + 70 } };
      const corner2X = phone ? Math.max(75, C.x - 110) : C.x - 35;
      const corner2Y = Math.round(cr.b - 65);
      const L2 = { a: { x: corner2X - 50, y: corner2Y }, c: { x: corner2X, y: corner2Y }, b: { x: corner2X, y: corner2Y - 80 } };

      await pressRibbonTool(evalJs, tap, 'tool-line');
      await tap(L1.a); await tap(L1.c); await tap(L1.b);
      await key('Escape', 'Escape', 27);
      await pressRibbonTool(evalJs, tap, 'tool-line');
      await tap(L1b.a); await tap(L1b.c); await tap(L1b.b);
      await key('Escape', 'Escape', 27);
      await pressRibbonTool(evalJs, tap, 'tool-line');
      await tap(L2.a); await tap(L2.c); await tap(L2.b);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 6, `[${kind}] three L-corners drawn`);

      // Also draw a line segment whose end sits just left/above the toast zone for the Offset test
      const offA = { x: corner2X - 55, y: corner2Y - 120 };
      const offB = { x: corner2X, y: corner2Y - 120 };
      await pressRibbonTool(evalJs, tap, 'tool-line');
      await tap(offA); await tap(offB);
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await evalJs(`${STATE}.shapes.filter((s) => s.type === 'line').length`), 7, `[${kind}] offset target line drawn`);

      // ---- 1. FILLET: apply L1 & L1b -> two stacked toasts show -> open L2 while toasts visible ----
      // (TASK 878: an applied fillet no longer shows a toast, so the two stacked toasts the phone flow had are shown here, as section 3 does)
      await pressRibbonTool(evalJs, tap, 'tool-fillet');
      for (const [idx, cPt] of [L1.c, L1b.c].entries()) {
        await tap(cPt);
        await waitFor(`!!document.getElementById('fillet-radius-input') && !document.querySelector('.sk-done')?.hidden`, `[${kind}] L1_${idx} fillet box + check`);
        const dPt = await evalJs(`(() => { const r = document.querySelector('.sk-done').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        await tap(dPt);
        await waitFor(`${STATE}.shapes.filter((s) => s.type === 'arc').length === ${idx + 1}`, `[${kind}] L1_${idx} applied`);
      }
      await evalJs(`import('/packages/ui/notification-manager.js').then((m) => { m.showNotification('Fillet applied (R 5.0)', 'info', 10000); m.showNotification('Fillet applied (R 5.0)', 'info', 10000); })`);
      await sleep(360); // allow toast slide-in transition to settle at translateY(0)

      // Pick L2 while the toasts are on screen
      await tap(L2.c);
      await waitFor(`!!document.getElementById('fillet-radius-input') && !document.querySelector('.sk-done')?.hidden`, `[${kind}] L2 fillet box + check shown with toast`);
      await sleep(220);

      const mFillet = await readRects();
      const filletOv = mFillet.toastRects.map((t) => rectOverlap(mFillet.doneRect, t.rect));
      console.log(`MEASURE[${kind}][fillet] done=${JSON.stringify(mFillet.doneRect)} toasts=${JSON.stringify(mFillet.toastRects)} overlap=${JSON.stringify(filletOv)} hitInDone=${mFillet.hitInDone} hitInToast=${mFillet.hitInToast}`);
      const lowClip = { x: 0, y: Math.max(0, Math.round(cr.b - 220)), width: Math.min(390, Math.round(cr.r)), height: 260 };
      if (!phone) lowClip.x = Math.max(0, C.x - 240), lowClip.width = 480;
      await shot('fillet-toast', lowClip);

      assert.strictEqual(mFillet.toastRects.length >= 1, true, `[${kind} fillet] toast still visible during check tap`);
      for (const [idx, area] of filletOv.entries()) {
        assert.strictEqual(area, 0, `[${kind} fillet] .sk-done overlaps toast #${idx} by ${area}px² (done=${JSON.stringify(mFillet.doneRect)}, toast=${JSON.stringify(mFillet.toastRects[idx].rect)})`);
      }
      assert.strictEqual(mFillet.hitInDone, true, `[${kind} fillet] elementFromPoint at .sk-done must hit .sk-done (got ${mFillet.hitTag}, hitInToast=${mFillet.hitInToast})`);

      // Real tap on the check button where it is drawn MUST apply the 3rd fillet!
      await tap({ x: Math.round(mFillet.doneRect.left + mFillet.doneRect.width / 2), y: Math.round(mFillet.doneRect.top + mFillet.doneRect.height / 2) });
      await waitFor(`${STATE}.shapes.filter((s) => s.type === 'arc').length === 3`, `[${kind} fillet] real tap on .sk-done while toast visible applied 3rd fillet`);

      // ---- 2. LINE CHAIN while toast visible: end joint near lower-left toast band ----
      await pressRibbonTool(evalJs, tap, 'tool-line');
      const segA = { x: corner2X - 50, y: corner2Y - 55 };
      const segB = { x: corner2X, y: corner2Y };
      await tap(segA);
      await tap(segB);
      await waitFor(`!document.querySelector('.sk-done')?.hidden && document.querySelectorAll('#notification-container [data-level]').length >= 1`, `[${kind}] line chain .sk-done + toast visible`);
      await sleep(220);

      const mLine = await readRects();
      const lineOv = mLine.toastRects.map((t) => rectOverlap(mLine.doneRect, t.rect));
      console.log(`MEASURE[${kind}][line] done=${JSON.stringify(mLine.doneRect)} toasts=${JSON.stringify(mLine.toastRects)} overlap=${JSON.stringify(lineOv)} hitInDone=${mLine.hitInDone} hitInToast=${mLine.hitInToast}`);
      await shot('line-toast', lowClip);
      for (const [idx, area] of lineOv.entries()) {
        assert.strictEqual(area, 0, `[${kind} line] .sk-done overlaps toast #${idx} by ${area}px²`);
      }
      assert.strictEqual(mLine.hitInDone, true, `[${kind} line] elementFromPoint hits .sk-done`);
      await tap({ x: Math.round(mLine.doneRect.left + mLine.doneRect.width / 2), y: Math.round(mLine.doneRect.top + mLine.doneRect.height / 2) });
      await waitFor(`!${STATE}.active`, `[${kind} line] real tap on .sk-done while toast visible ended line chain`);

      // ---- 3. OFFSET while toast visible: open Offset near lower canvas ----
      await evalJs(`import('/packages/ui/notification-manager.js').then((m) => m.showNotification('Fillet applied (R 5.0)', 'info', 8000))`);
      await sleep(360);
      await pressRibbonTool(evalJs, tap, 'tool-offset');
      const offLineMid = { x: Math.round((offA.x + offB.x) / 2), y: Math.round((offA.y + offB.y) / 2) };
      await tap(offLineMid);
      await waitFor(`!!document.getElementById('offset-distance-input') && !document.querySelector('.sk-done')?.hidden`, `[${kind}] offset box + check visible with toast`);
      await sleep(220);

      const mOff = await readRects();
      const offOv = mOff.toastRects.map((t) => rectOverlap(mOff.doneRect, t.rect));
      console.log(`MEASURE[${kind}][offset] done=${JSON.stringify(mOff.doneRect)} toasts=${JSON.stringify(mOff.toastRects)} overlap=${JSON.stringify(offOv)} hitInDone=${mOff.hitInDone} hitInToast=${mOff.hitInToast}`);
      await shot('offset-toast', lowClip);
      for (const [idx, area] of offOv.entries()) {
        assert.strictEqual(area, 0, `[${kind} offset] .sk-done overlaps toast #${idx} by ${area}px²`);
      }
      assert.strictEqual(mOff.hitInDone, true, `[${kind} offset] elementFromPoint hits .sk-done`);
      await tap({ x: Math.round(mOff.doneRect.left + mOff.doneRect.width / 2), y: Math.round(mOff.doneRect.top + mOff.doneRect.height / 2) });
      await waitFor(`!document.getElementById('offset-distance-input')`, `[${kind} offset] real tap on .sk-done while toast visible committed offset`);
    }

    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('toast-done-689-live: ok');
  } finally {
    await cdp.close();
  }
})();
