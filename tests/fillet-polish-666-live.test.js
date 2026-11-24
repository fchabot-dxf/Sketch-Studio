// tests/fillet-polish-666-live.test.js -- TASK 666: real browser mouse (Shaper 1280x800) + real phone touch (Pen Plotter 390x844).
// Verifies F7 (radius < 0.1mm), F8 (doc-unit refusal), F9 (invalid red border + hidden preview + disabled .sk-done),
// F10 (cursor on #design-canvas, never hidden icon sprite svg; pointer over .fillet-handle; reset on Select), F18 ("5.0" / "R 5.0").
import assert from 'node:assert';
import fs from 'node:fs';
import { resetBufferLive } from './helpers/reset-buffer.js';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '666');

await (async () => {
  const cdp = await launchBrowser({ tag: '666', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });

  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 1, radiusY: 1, force: 1 })) });
  const key = (k, code, vk) => sendRealKey(send, k, code, vk).then(() => sleep(200));

  try {
    fs.mkdirSync(EVID, { recursive: true });

    // ==================== 1. DESKTOP MOUSE (Shaper Design tab, 1280x800) ====================
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      const tapMouse = async (p) => {
        await mouse('mouseMoved', p.x, p.y, 0); await sleep(60);
        await mouse('mousePressed', p.x, p.y, 1); await sleep(40);
        await mouse('mouseReleased', p.x, p.y, 0); await sleep(220);
      };
      const shotClip = async (file, clip) => {
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
        fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
      };

      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper design tab');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`!!window.__designController && document.querySelector('#design-canvas').getBoundingClientRect().width > 0`, 'shaper design controller');
      await sleep(400);

      // F10: icon sprite svg precedes #design-canvas; cursor changes must apply to #design-canvas only. TASK 880: the header's Export action icons are <svg>s
      // too, so the first <svg> of the page may be one of them: the sprite (#ui/cursor-manager.js ensureIconSymbols: the hidden svg holding the icon <defs>) is found
      // by what it is, and BOTH it and the page's first <svg> (what a stray document.querySelector('svg') would hit) must keep an empty cursor
      const SPRITE = `[...document.querySelectorAll('svg[aria-hidden="true"]')].find((s) => s.querySelector(':scope > defs'))`;
      const hasLeadingSprite = await evalJs(`(() => { const sp = ${SPRITE}, first = document.querySelector('svg'), dc = document.getElementById('design-canvas'); return !!sp && !!dc && !!first && first !== dc && !!(sp.compareDocumentPosition(dc) & Node.DOCUMENT_POSITION_FOLLOWING); })()`);
      assert.strictEqual(hasLeadingSprite, true, 'F10 precondition: hidden icon sprite <svg> exists before #design-canvas, and the first <svg> is not the canvas');

      const cursors = () => evalJs(`({ firstSvg: document.querySelector('svg').style.cursor + ${SPRITE}.style.cursor, canvas: document.getElementById('design-canvas').style.cursor })`);
      for (const toolId of ['tool-fillet', 'tool-trim', 'tool-break']) {
        await pressRibbonTool(evalJs, tapMouse, toolId);
        await sleep(150);
        const cur = await cursors();
        assert.strictEqual(cur.firstSvg, '', `F10 (${toolId}): hidden sprite svg cursor stayed empty, got "${cur.firstSvg}"`);
        assert.strictEqual(cur.canvas, 'crosshair', `F10 (${toolId}): canvas cursor expected crosshair, got "${cur.canvas}"`);
        await pressRibbonTool(evalJs, tapMouse, 'tool-select');
        await sleep(100);
        assert.strictEqual((await cursors()).canvas, '', `F10: switching from ${toolId} back to select cleared canvas cursor`);
      }

      // Draw a clean 30x30 corner on Shaper Design canvas
      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.55) };
      await pressRibbonTool(evalJs, tapMouse, 'tool-line');
      await tapMouse({ x: C.x - 160, y: C.y });
      await tapMouse(C);
      await tapMouse({ x: C.x, y: C.y - 160 });
      await key('Escape', 'Escape', 27);

      await pressRibbonTool(evalJs, tapMouse, 'tool-fillet');
      await tapMouse(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[desktop] radius box');
      await sleep(250);

      // F18: in Shaper default (inches), box ("0.25") and preview ("R 0.25") match; switch to mm -> box "5" and preview "R 5"
      const shaperIn0 = await evalJs(`({ val: document.getElementById('fillet-radius-input')?.value, txt: document.querySelector('#fillet-tool-overlay text')?.textContent })`);
      assert.strictEqual(shaperIn0.val, '0.25', `F18 desktop (in): expected box "0.25", got "${shaperIn0.val}"`);
      assert.strictEqual(shaperIn0.txt, 'R 0.25', `F18 desktop (in): expected preview "R 0.25", got "${shaperIn0.txt}"`);
      await key('Escape', 'Escape', 27);
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
      await pressRibbonTool(evalJs, tapMouse, 'tool-fillet');
      await tapMouse(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[desktop mm] radius box');
      await sleep(250);

      // F18: box "5.0" and preview text "R 5.0"
      const uiState = () => evalJs(`(() => {
        const i = document.getElementById('fillet-radius-input');
        const arc = document.querySelector('#fillet-tool-overlay path[d*=" A "]');
        const hd = document.querySelector('#fillet-tool-overlay .fillet-handle');
        const lbl = document.querySelector('#fillet-tool-overlay text');
        const done = document.querySelector('.sk-done');
        return {
          val: i ? i.value : null,
          ariaInvalid: i ? i.getAttribute('aria-invalid') : null,
          borderColor: i ? getComputedStyle(i).borderColor : null,
          hasArc: !!arc,
          hasHandle: !!hd,
          handleRect: hd ? (() => { const r = hd.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null,
          previewText: lbl ? lbl.textContent : null,
          doneHidden: done ? done.hidden : true,
          doneDisabled: done ? done.disabled : null,
          doneRect: done ? (() => { const r = done.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null,
        };
      })()`);

      const valid0 = await uiState();
      assert.strictEqual(valid0.val, '5', `F18 desktop: expected box "5", got "${valid0.val}"`);
      assert.strictEqual(valid0.previewText, 'R 5', `F18 desktop: expected preview "R 5", got "${valid0.previewText}"`);
      assert.strictEqual(valid0.ariaInvalid, 'false', 'F9 desktop: initially aria-invalid="false"');
      assert.strictEqual(valid0.doneDisabled, false, 'F9 desktop: .sk-done initially enabled');

      await shotClip('desktop-valid.png', { x: Math.max(0, C.x - 120), y: Math.max(0, C.y - 120), width: 320, height: 240 });

      // F10: hover mouse over .fillet-handle -> pointer on canvas; move away -> crosshair
      assert(valid0.handleRect, 'handle rect exists');
      await mouse('mouseMoved', valid0.handleRect.x, valid0.handleRect.y, 0);
      await sleep(120);
      assert.strictEqual((await cursors()).canvas, 'pointer', 'F10 desktop: hover over .fillet-handle sets pointer cursor');
      await mouse('mouseMoved', C.x - 200, C.y - 100, 0);
      await sleep(120);
      assert.strictEqual((await cursors()).canvas, 'crosshair', 'F10 desktop: moving away restores crosshair cursor');

      // F9: type invalid "abc" -> red border, preview & handle hidden, .sk-done disabled
      await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
      for (const ch of 'abc') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(200);
      const inv = await uiState();
      assert.strictEqual(inv.ariaInvalid, 'true', 'F9 desktop: "abc" sets aria-invalid="true"');
      assert.ok(['rgb(248, 113, 113)', 'rgb(239, 68, 68)'].includes(inv.borderColor), `F9 desktop: expected --sk-error red border, got ${inv.borderColor}`);
      assert.strictEqual(inv.hasArc, false, 'F9 desktop: preview arc hidden when invalid');
      assert.strictEqual(inv.hasHandle, false, 'F9 desktop: drag handle hidden when invalid');
      assert.strictEqual(inv.doneDisabled, true, 'F9 desktop: .sk-done disabled when invalid');
      await shotClip('desktop-invalid.png', { x: Math.max(0, C.x - 120), y: Math.max(0, C.y - 120), width: 320, height: 240 });

      // Enter while invalid warns and stays open
      await evalJs(`document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove())`);
      await key('Enter', 'Enter', 13);
      const warnTxt = await evalJs(`[...document.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent).join(' | ')`);
      assert.ok(warnTxt.includes('Enter a radius greater than zero'), `F9 desktop: Enter on invalid warns, got: ${warnTxt}`);

      // F7 + F9 recovery: type "0.05" -> valid again, Enter creates arc with radius 0.05
      await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
      for (const ch of '0.05') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(200);
      const rec = await uiState();
      assert.strictEqual(rec.ariaInvalid, 'false', 'F9 desktop: 0.05 recovers');
      assert.strictEqual(rec.hasArc, true, 'F9 desktop: 0.05 restores preview arc');
      assert.strictEqual(rec.doneDisabled, false, 'F9 desktop: 0.05 re-enables .sk-done');
      await key('Enter', 'Enter', 13);
      await waitFor(`window.__designController.state.shapes.filter((s) => s.type === 'arc').length === 1`, '[desktop] 0.05 arc applied');
      const arcR = await evalJs(`window.__designController.state.constraints.find((c) => c.isRadius)?.value`);
      assert.ok(Math.abs(arcR - 0.05) < 1e-6, `F7 desktop: expected radius 0.05, got ${arcR}`);

      // F8 desktop: switch unit to inches and trigger exact-collapse on a 1.3in corner -> "1.3in"
      await evalJs(`(() => {
        const dc = window.__designController;
        dc.state.clearDocument();
        const mod = dc.setUnit || null;
        document.querySelectorAll('#notification-container [data-level]').forEach((e) => e.remove());
      })()`);
      // Use the host's document unit setting via SettingsManager
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'in'))`);
      await evalJs(`(() => {
        const st = window.__designController.state;
        const len = 1.3 * 25.4;
        const jc = st.genJ(), ja = st.genJ(), jb = st.genJ();
        st.joints.set(jc, { x: 0, y: 0, fixed: false });
        st.joints.set(ja, { x: len, y: 0, fixed: false });
        st.joints.set(jb, { x: 0, y: len, fixed: false });
        st.shapes.push({ id: 's_in_1', type: 'line', joints: [jc, ja] });
        st.shapes.push({ id: 's_in_2', type: 'line', joints: [jc, jb] });
        window.__designController.render?.();
      })()`);
      await sleep(200);
      const inCorner = await evalJs(`(() => {
        const svg = document.getElementById('design-canvas');
        const vb = svg.viewBox.baseVal;
        const r = svg.getBoundingClientRect();
        return { x: r.left + ((0 - vb.x) / vb.width) * r.width, y: r.top + ((0 - vb.y) / vb.height) * r.height };
      })()`);
      await pressRibbonTool(evalJs, tapMouse, 'tool-fillet');
      await tapMouse(inCorner);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[desktop inch] radius box');
      await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
      for (const ch of '1.3') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await key('Enter', 'Enter', 13);
      const inWarn = await evalJs(`[...document.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent).join(' | ')`);
      assert.ok(inWarn.includes('1.3in'), `F8 desktop: expected "1.3in" in warning, got: ${inWarn}`);
      assert.ok(!inWarn.includes('33.02'), `F8 desktop: must not leak raw mm 33.02, got: ${inWarn}`);
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
    }

    // ==================== 2. PHONE TOUCH (Pen Plotter 390x844, real touch) ====================
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const tapTouch = async (p) => { await touch('touchStart', [p]); await sleep(60); await touch('touchEnd', []); await sleep(280); };
      const shotClipPhone = async (file, clip) => {
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
        fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
      };

      await resetBufferLive(cdp); // TASK 684: the open tabs are ONE list for all apps: a new host starts from an empty Untitled, not the previous host's drawing
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, '[phone] design tab');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!window.__sketch?.controller?.state`, '[phone] design canvas');
      await sleep(400);

      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.48), y: Math.round(cr.t + cr.h * 0.45) };
      await pressRibbonTool(evalJs, tapTouch, 'tool-line');
      await tapTouch({ x: C.x - 100, y: C.y });
      await tapTouch(C);
      await tapTouch({ x: C.x, y: C.y - 100 });
      await key('Escape', 'Escape', 27);

      await pressRibbonTool(evalJs, tapTouch, 'tool-fillet');
      await tapTouch(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[phone] radius box');
      await sleep(300);

      // Invalidate with "abc" on phone -> .sk-done disabled, tap .sk-done does nothing
      await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
      for (const ch of 'abc') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(250);

      const pState = () => evalJs(`(() => {
        const i = document.getElementById('fillet-radius-input');
        const done = document.querySelector('.sk-done');
        const arc = document.querySelector('#fillet-tool-overlay path[d*=" A "]');
        const hd = document.querySelector('#fillet-tool-overlay .fillet-handle');
        const r = done ? done.getBoundingClientRect() : null;
        return {
          open: !!i,
          ariaInvalid: i ? i.getAttribute('aria-invalid') : null,
          hasArc: !!arc,
          hasHandle: !!hd,
          doneDisabled: done ? done.disabled : null,
          doneOpacity: done ? getComputedStyle(done).opacity : null,
          donePt: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
          arcsCount: window.__sketch.controller.state.shapes.filter((s) => s.type === 'arc').length,
        };
      })()`);

      const pInv = await pState();
      assert.strictEqual(pInv.ariaInvalid, 'true', 'F9 phone: aria-invalid="true"');
      assert.strictEqual(pInv.doneDisabled, true, 'F9 phone: .sk-done disabled');
      assert.strictEqual(pInv.hasArc, false, 'F9 phone: preview arc hidden');
      await shotClipPhone('phone-invalid.png', { x: Math.max(0, C.x - 80), y: Math.max(0, C.y - 100), width: 310, height: 260 });

      await tapTouch(pInv.donePt);
      await sleep(200);
      const afterDisabledTap = await pState();
      assert.strictEqual(afterDisabledTap.open, true, 'F9 phone: disabled .sk-done tap leaves box open');
      assert.strictEqual(afterDisabledTap.arcsCount, 0, 'F9 phone: disabled .sk-done tap creates no arc');

      // Recover with 0.05 (F7 + F9 touch) -> .sk-done re-enabled -> touch-tap .sk-done applies R=0.05!
      await evalJs(`(() => { const i = document.getElementById('fillet-radius-input'); i.focus(); i.select(); })()`);
      for (const ch of '0.05') await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(250);
      const pValid = await pState();
      assert.strictEqual(pValid.ariaInvalid, 'false', 'F9 phone: 0.05 valid');
      assert.strictEqual(pValid.doneDisabled, false, 'F9 phone: .sk-done enabled');
      assert.strictEqual(pValid.hasArc, true, 'F9 phone: preview arc restored');
      await shotClipPhone('phone-valid.png', { x: Math.max(0, C.x - 80), y: Math.max(0, C.y - 100), width: 310, height: 260 });

      await tapTouch(pValid.donePt);
      await waitFor(`window.__sketch.controller.state.shapes.filter((s) => s.type === 'arc').length === 1`, '[phone] .sk-done applied 0.05 arc');
      const appliedR = await evalJs(`window.__sketch.controller.state.constraints.find((c) => c.isRadius)?.value`);
      assert.ok(Math.abs(appliedR - 0.05) < 1e-6, `F7 phone: expected 0.05 radius, got ${appliedR}`);
    }

    assert.strictEqual(pageErrors.length, 0, `unexpected runtime errors: ${pageErrors.join('\n')}`);
    console.log('fillet-polish-666-live.test.js: ALL PASS');
  } finally {
    await cdp.close();
  }
})();
