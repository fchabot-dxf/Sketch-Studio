// tests/boxes-parity-ux17-1013-live.test.js — TASK 1013 live headless visual test (Desktop 1280x800 + Phone 390x844)
// Guards browser-level layout and interaction of UX-17 (a/b/c):
//   1. Line draw-time box (#dualInput): typing "d" opens #dimComplete right below #dualInput, inside viewport, non-overlapping;
//      Tab inserts "d1", typing " / 2" + Enter creates the dimensioned line; typing "w = 50" + Enter names the dimension "w".
//   2. Edit box (#dimInput): typing "-5" + Enter keeps the box OPEN with red #dimHint inside viewport (no toast, text preserved).
// Runs on BOTH Desktop 1280x800 and Phone 390x844. Pass EVIDENCE_DIR=.evidence/1013 to write cropped screenshots.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '1013-boxes-parity', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const url = (p) => `http://127.0.0.1:${port}${p}`;

  try {
    const mouse = (type, x, y, buttons = 0, clickCount) =>
      send('Input.dispatchMouseEvent', { type, x, y, button: (type === 'mouseMoved' && !buttons) ? 'none' : 'left', buttons, clickCount: clickCount != null ? clickCount : (type === 'mouseMoved' ? 0 : 1) });
    const touch = (type, pts) =>
      send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
    const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(150); };
    const insertText = async (text) => { await send('Input.insertText', { text }); await sleep(150); };
    const rectOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null; })()`);
    const overlaps = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

    const shot = async (name, sels, vw, vh) => {
      if (!process.env.EVIDENCE_DIR) return;
      fs.mkdirSync(process.env.EVIDENCE_DIR, { recursive: true });
      const rs = (await Promise.all(sels.map(rectOf))).filter(Boolean);
      if (!rs.length) return;
      const pad = 48;
      const l = Math.max(0, Math.min(...rs.map((r) => r.l)) - pad);
      const t = Math.max(0, Math.min(...rs.map((r) => r.t)) - pad);
      const r = Math.min(vw, Math.max(...rs.map((x) => x.r)) + pad);
      const b = Math.min(vh, Math.max(...rs.map((x) => x.b)) + pad);
      const buf = Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { x: l, y: t, width: Math.max(200, r - l), height: Math.max(160, b - t), scale: 2 } })).data, 'base64');
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), buf);
    };

    const PHASES = [
      { name: 'desktop', vw: 1280, vh: 800, mobile: false, dpr: 1 },
      { name: 'phone', vw: 390, vh: 844, mobile: true, dpr: 2 },
    ];

    for (const ph of PHASES) {
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', { width: ph.vw, height: ph.vh, deviceScaleFactor: ph.dpr, mobile: ph.mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: ph.mobile, maxTouchPoints: ph.mobile ? 5 : 0 });
      await navigate(url('/apps/sketchstudio/index.html'), 8000);
      await waitFor(`!!document.getElementById('svgCanvas') && document.getElementById('svgCanvas').getBoundingClientRect().width > 0 && !!document.getElementById('tool-line')`, `[${ph.name}] app`);
      await waitForApp('svgCanvas');
      await sleep(400);

      const tap = ph.mobile
        ? async (p) => { await touch('touchStart', [p]); await sleep(50); await touch('touchEnd', []); await sleep(300); }
        : async (p) => { await mouse('mouseMoved', p.x, p.y); await sleep(50); await mouse('mousePressed', p.x, p.y, 1); await sleep(40); await mouse('mouseReleased', p.x, p.y); await sleep(250); };
      const dbltap = ph.mobile
        ? async (p) => { await touch('touchStart', [p]); await sleep(40); await touch('touchEnd', []); await sleep(80); await touch('touchStart', [p]); await sleep(40); await touch('touchEnd', []); await sleep(400); }
        : async (p) => { await mouse('mouseMoved', p.x, p.y); await sleep(60); for (const n of [1, 2]) { await mouse('mousePressed', p.x, p.y, 1, n); await sleep(30); await mouse('mouseReleased', p.x, p.y, 0, n); await sleep(60); } await sleep(350); };

      const cr = await evalJs(`(() => { const r = document.getElementById('svgCanvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const F = (fx, fy) => ({ x: Math.round(cr.l + cr.w * fx), y: Math.round(cr.t + cr.h * fy) });
      const tool = (id) => pressRibbonTool(evalJs, tap, id);

      // 1. Draw baseline line with w = 4 in draw-time box (UX-17a; 4 mm fits inside initial viewport on desktop & phone)
      await tool('tool-line');
      await tap(F(0.25, 0.50));
      if (!ph.mobile) await mouse('mouseMoved', F(0.55, 0.50).x, F(0.55, 0.50).y);
      await waitFor(`(() => { const d = document.getElementById('dualInput'); return !!d && !d.classList.contains('hidden'); })()`, `[${ph.name}] dualInput open`, 5000);
      await evalJs(`(() => { const i = document.querySelector('#dualInput input'); i.focus(); i.select(); })()`);
      await insertText('w = 4');
      const invalidW = await evalJs(`document.querySelector('#dualInput input').getAttribute('aria-invalid')`);
      assert.strictEqual(invalidW, 'false', `[${ph.name}] w = 4 valid in draw-time box`);
      await key('Enter', 'Enter', 13, 0, '\r');
      await sleep(300);

      // 2. Second segment named "width = 3"
      if (!ph.mobile) await mouse('mouseMoved', F(0.55, 0.70).x, F(0.55, 0.70).y);
      await evalJs(`(() => { const i = document.querySelector('#dualInput input'); i.focus(); i.select(); })()`);
      await insertText('width = 3');
      await key('Enter', 'Enter', 13, 0, '\r');
      await sleep(300);

      // Now in the third segment's draw-time box, type "wi" -> #dimComplete opens with "width" inside viewport & non-overlapping!
      await evalJs(`(() => { const i = document.querySelector('#dualInput input'); i.focus(); i.select(); })()`);
      await insertText('wi');
      await waitFor(`(() => { const c = document.getElementById('dimComplete'); return !!c && !c.classList.contains('hidden') && c.children.length > 0; })()`, `[${ph.name}] #dimComplete open in draw-time box`, 4000);
      const dualR = await rectOf('#dualInput');
      const compR = await rectOf('#dimComplete');
      assert(dualR && compR, `[${ph.name}] dual and complete rects present`);
      assert(compR.l >= 0 && compR.r <= ph.vw && compR.t >= 0 && compR.b <= ph.vh, `[${ph.name}] #dimComplete inside viewport: ${JSON.stringify(compR)}`);
      assert(!overlaps(dualR, compR), `[${ph.name}] #dimComplete does not overlap #dualInput: ${JSON.stringify({ dualR, compR })}`);
      await shot(`${ph.name}-1-draw-autocomplete.png`, ['#dualInput', '#dimComplete', '#dimHint'], ph.vw, ph.vh);

      // Tab inserts "width"
      await key('Tab', 'Tab', 9);
      const valAfterTab = await evalJs(`document.querySelector('#dualInput input').value`);
      assert.strictEqual(valAfterTab, 'width', `[${ph.name}] Tab inserted width in draw-time box (got "${valAfterTab}")`);
      await key('Escape', 'Escape', 27);
      await key('Escape', 'Escape', 27);
      await sleep(250);

      // 3. Edit box (-5): draw a fresh line and place its dimension on-screen with Dim tool (guaranteed inside canvas on both desktop & phone)
      await tool('tool-line');
      const A = F(0.10, 0.72), B = F(0.90, 0.72);
      await tap(A);
      if (!ph.mobile) { await mouse('mouseMoved', B.x, B.y); await sleep(80); }
      await tap(B);
      await key('Escape', 'Escape', 27);
      await sleep(250);
      await tool('tool-dim');
      const lineBody = await evalJs(`(() => {
        const ls = [...document.querySelectorAll('#svgCanvas line.shape-elem')];
        const l = ls[ls.length - 1];
        if (!l) return null;
        const m = l.getScreenCTM();
        const x1 = +l.getAttribute('x1'), y1 = +l.getAttribute('y1'), x2 = +l.getAttribute('x2'), y2 = +l.getAttribute('y2');
        const p = new DOMPoint(x1 + (x2 - x1) * 0.25, y1 + (y2 - y1) * 0.25).matrixTransform(m);
        return { x: Math.round(p.x), y: Math.round(p.y) };
      })()`);
      assert(lineBody, `[${ph.name}] last line found on canvas`);
      await tap(lineBody);
      const drop = { x: lineBody.x, y: lineBody.y - 50 };
      if (!ph.mobile) { await mouse('mouseMoved', drop.x, drop.y); await sleep(150); }
      await tap(drop);
      await waitFor(`!document.getElementById('dimInput').classList.contains('hidden')`, `[${ph.name}] edit box open`, 5000);
      await evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove())`);
      await evalJs(`(() => { const i = document.getElementById('dimInput'); i.focus(); i.select(); })()`);
      await insertText('-5');
      await key('Enter', 'Enter', 13, 0, '\r');
      await sleep(250);

      const editState = await evalJs(`(() => {
        const i = document.getElementById('dimInput'), h = document.getElementById('dimHint');
        const toasts = [...document.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim());
        return { open: !i.classList.contains('hidden'), value: i.value, invalid: i.getAttribute('aria-invalid'), hint: h && !h.classList.contains('hidden') ? h.textContent.trim() : null, hintErr: !!(h && h.classList.contains('err')), toasts };
      })()`);
      assert.strictEqual(editState.open, true, `[${ph.name}] edit box stays open on -5: ${JSON.stringify(editState)}`);
      assert.strictEqual(editState.value, '-5', `[${ph.name}] edit box keeps "-5"`);
      assert.strictEqual(editState.invalid, 'true', `[${ph.name}] edit box aria-invalid="true"`);
      assert(editState.hint && /more than 0/i.test(editState.hint) && editState.hintErr, `[${ph.name}] inline error hint shown: ${JSON.stringify(editState)}`);
      assert.deepStrictEqual(editState.toasts, [], `[${ph.name}] no toast on -5 refusal`);

      const inpR = await rectOf('#dimInput');
      const hintR = await rectOf('#dimHint');
      assert(inpR && hintR, `[${ph.name}] edit box and hint visible`);
      assert(hintR.l >= 0 && hintR.r <= ph.vw && hintR.t >= 0 && hintR.b <= ph.vh, `[${ph.name}] #dimHint inside viewport: ${JSON.stringify(hintR)}`);
      assert(!overlaps(inpR, hintR), `[${ph.name}] #dimHint does not overlap #dimInput: ${JSON.stringify({ inpR, hintR })}`);
      await shot(`${ph.name}-2-edit-neg-stays-open.png`, ['#dimInput', '#dimHint'], ph.vw, ph.vh);

      await key('Escape', 'Escape', 27);
      console.log(`  ok: [${ph.name} ${ph.vw}x${ph.vh}] draw-time w=50 + #dimComplete + edit -5 stays open with inline hint`);
    }

    console.log('PASS boxes-parity-ux17-1013-live');
  } finally {
    await cdp.close();
  }
})();
