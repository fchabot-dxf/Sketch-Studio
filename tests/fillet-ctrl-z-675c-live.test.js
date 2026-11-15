// tests/fillet-ctrl-z-675c-live.test.js -- TASK 675 C (real headless Edge/Chrome, mouse + real keys desktop + phone touch):
// 1. Ctrl+Z (and Cmd+Z) inside #fillet-radius-input puts back the opening default value in ONE step ("12" -> "5.0", never "1"),
//    keeps the box open, updates the live preview to the restored value, never undoes a document step, and a 2nd Ctrl+Z does nothing.
// 2. Owner turn 1756: typing + Ctrl+Z in radius box adds 0 history steps; confirming adds +1 step; ONE canvas Ctrl+Z removes the entire
//    fillet (arc, tangents, radius dimension) leaving the corner sharp again (both desktop & phone).
// 3. Shared boxes (#offset-distance-input, #dualInput Line L/°, #dimInput dimension edit): same one-step Ctrl+Z revert rule.
// 4. Footer #btn-undo while #fillet-radius-input is open: real desktop click AND real phone touch tap both close the box and undo 1 step.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '682');

await (async () => {
  const cdp = await launchBrowser({ tag: '675c', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });

  const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', {
    type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
  });
  const touch = (type, pts) => send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 10, radiusY: 10, force: 1 })),
  });
  const key = (k, code, vk, mods = 0, text = '') => sendRealKey(send, k, code, vk, mods, text).then(() => sleep(180));
  const typeChars = async (str) => {
    for (const ch of str) {
      await send('Input.dispatchKeyEvent', { type: 'char', text: ch });
      await sleep(40);
    }
    await sleep(160);
  };

  try {
    fs.mkdirSync(EVID, { recursive: true });

    // ==================== 1. DESKTOP MOUSE + KEYBOARD (Shaper 1280x800, mm) ====================
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      const tapMouse = async (p) => {
        await mouse('mouseMoved', p.x, p.y, 0); await sleep(50);
        await mouse('mousePressed', p.x, p.y, 1); await sleep(40);
        await mouse('mouseReleased', p.x, p.y, 0); await sleep(200);
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
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
      await sleep(300);

      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.55) };
      const clipBox = { x: Math.max(0, C.x - 160), y: Math.max(0, C.y - 160), width: 320, height: 240 };

      // Draw an L-corner (2 lines meeting at C)
      await pressRibbonTool(evalJs, tapMouse, 'tool-line');
      await tapMouse({ x: C.x - 140, y: C.y });
      await tapMouse(C);
      await tapMouse({ x: C.x, y: C.y - 140 });
      await key('Escape', 'Escape', 27);

      const dState = () => evalJs(`(() => {
        const st = window.__designController.state;
        const inp = document.getElementById('fillet-radius-input');
        const txt = document.querySelector('#fillet-tool-overlay text')?.textContent || null;
        const arcPrev = document.querySelector('#fillet-tool-overlay path[d*=" A "]');
        return {
          open: !!inp,
          focused: !!inp && document.activeElement === inp,
          val: inp ? inp.value : null,
          ariaInvalid: inp ? inp.getAttribute('aria-invalid') : null,
          previewText: txt,
          hasPreviewArc: !!arcPrev,
          hist: st.history.length,
          lines: st.shapes.filter((s) => s.type === 'line').length,
          arcs: st.shapes.filter((s) => s.type === 'arc').length,
          tangents: st.constraints.filter((c) => c.type === 'tangent').length,
          radDims: st.constraints.filter((c) => c.type === 'distance' && c.isRadius).length,
          joints: st.joints.size,
          activeId: document.activeElement?.id || document.activeElement?.tagName || null,
        };
      })()`);

      const base = await dState();
      assert.strictEqual(base.lines, 2, '[desktop] 2 lines drawn');

      // Open fillet radius box on corner
      await pressRibbonTool(evalJs, tapMouse, 'tool-fillet');
      await tapMouse(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[desktop] #fillet-radius-input open');
      await sleep(180);

      const sOpen = await dState();
      assert.strictEqual(sOpen.val, '5.0', `[desktop] opening default is "5.0", got "${sOpen.val}"`);
      assert.strictEqual(sOpen.previewText, 'R 5.0', `[desktop] preview opens at "R 5.0", got "${sOpen.previewText}"`);
      assert.strictEqual(sOpen.focused, true, '[desktop] #fillet-radius-input focused');

      // Ctrl+Z when already showing default does nothing
      await key('z', 'KeyZ', 90, 2);
      const sCtrlUnchanged = await dState();
      assert.strictEqual(sCtrlUnchanged.open, true, '[desktop] Ctrl+Z at default keeps box open');
      assert.strictEqual(sCtrlUnchanged.val, '5.0', '[desktop] Ctrl+Z at default keeps "5.0"');
      assert.strictEqual(sCtrlUnchanged.hist, base.hist, '[desktop] Ctrl+Z at default never undoes document');

      // Type "12" (wait/select replacement): preview updates to R 12, history stays unchanged
      await typeChars('12');
      const sTyped = await dState();
      assert.strictEqual(sTyped.val, '12', `[desktop] typed "12", got "${sTyped.val}"`);
      assert.strictEqual(sTyped.previewText, 'R 12.0', `[desktop] preview follows 12, got "${sTyped.previewText}"`);
      assert.strictEqual(sTyped.hist, base.hist, '[desktop] typing in radius box never adds history steps');

      // Press ONE Ctrl+Z -> puts "5.0" back in ONE step (not "1"!), preview back to "R 5.0", box open & focused, 0 doc steps
      await key('z', 'KeyZ', 90, 2);
      const sAfter1 = await dState();
      assert.strictEqual(sAfter1.open, true, '[desktop] ONE Ctrl+Z keeps #fillet-radius-input open');
      assert.strictEqual(sAfter1.focused, true, '[desktop] #fillet-radius-input stays focused');
      assert.strictEqual(sAfter1.val, '5.0', `[desktop] ONE Ctrl+Z restores "5.0" directly (got "${sAfter1.val}")`);
      assert.strictEqual(sAfter1.previewText, 'R 5.0', `[desktop] preview follows restored "5.0" (got "${sAfter1.previewText}")`);
      assert.strictEqual(sAfter1.hist, base.hist, '[desktop] history unchanged after Ctrl+Z');
      await shotClip('c-desktop-after-ctrlz.png', clipBox);

      // Second Ctrl+Z when already default does nothing
      await key('z', 'KeyZ', 90, 2);
      const sAfter2 = await dState();
      assert.strictEqual(sAfter2.open, true);
      assert.strictEqual(sAfter2.val, '5.0');
      assert.strictEqual(sAfter2.hist, base.hist);

      // Cmd+Z (Meta+Z, modifiers: 4) also restores "5.0" in ONE step
      await typeChars('9');
      assert.strictEqual((await dState()).val, '9');
      await key('z', 'KeyZ', 90, 4);
      assert.strictEqual((await dState()).val, '5.0', '[desktop] Cmd+Z (Meta+Z) restores "5.0" in 1 step');

      // Invalid "abc" -> Ctrl+Z restores valid "5.0" & preview arc
      await typeChars('abc');
      assert.strictEqual((await dState()).ariaInvalid, 'true');
      assert.strictEqual((await dState()).hasPreviewArc, false);
      await key('z', 'KeyZ', 90, 2);
      const sValid = await dState();
      assert.strictEqual(sValid.val, '5.0');
      assert.strictEqual(sValid.ariaInvalid, 'false');
      assert.strictEqual(sValid.hasPreviewArc, true);

      // Turn 1756: Confirm fillet with Enter -> +1 history step (arcs=1, tangents=2, radDims=1)
      await key('Enter', 'Enter', 13, 0, '\r');
      await waitFor(`!document.getElementById('fillet-radius-input')`, '[desktop] Enter closes fillet box');
      const sCommitted = await dState();
      assert.strictEqual(sCommitted.arcs, 1, '[desktop 1756] fillet arc created');
      assert.strictEqual(sCommitted.tangents, 2, '[desktop 1756] 2 tangent constraints created');
      assert.strictEqual(sCommitted.radDims, 1, '[desktop 1756] radius dimension created');
      assert.strictEqual(sCommitted.hist, base.hist + 1, `[desktop 1756] confirming fillet adds exactly 1 history step (${base.hist} -> ${sCommitted.hist})`);
      await shotClip('c-desktop-after-fillet.png', clipBox);

      // ONE Ctrl+Z on canvas removes entire fillet (arc, tangents, radius dim) and leaves corner sharp again
      assert.notStrictEqual(sCommitted.activeId, 'fillet-radius-input', '[desktop 1756] focus returned to canvas');
      await key('z', 'KeyZ', 90, 2);
      const sUndone = await dState();
      assert.strictEqual(sUndone.arcs, 0, '[desktop 1756] single Ctrl+Z removes fillet arc');
      assert.strictEqual(sUndone.tangents, 0, '[desktop 1756] single Ctrl+Z removes tangents');
      assert.strictEqual(sUndone.radDims, 0, '[desktop 1756] single Ctrl+Z removes radius dimension');
      assert.strictEqual(sUndone.lines, 2, '[desktop 1756] corner lines restored');
      assert.strictEqual(sUndone.joints, base.joints, `[desktop 1756] sharp corner restored (joints ${sUndone.joints} === ${base.joints})`);
      await shotClip('c-desktop-after-canvas-undo.png', clipBox);

      // C.3 Desktop footer #btn-undo while #fillet-radius-input is open: closes box & undoes 1 document step
      await tapMouse(C); // open fillet box on sharp corner again
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[desktop btn-undo] fillet box re-opened');
      await typeChars('12');
      const undoPt = await evalJs(`(() => { const r = document.getElementById('btn-undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const beforeBtnUndo = await dState();
      await tapMouse(undoPt);
      await waitFor(`!document.getElementById('fillet-radius-input')`, '[desktop btn-undo] closes box');
      const afterBtnUndo = await dState();
      assert.strictEqual(afterBtnUndo.open, false, '[desktop C.3] #btn-undo closes radius box');
      assert.strictEqual(afterBtnUndo.lines, 1, `[desktop C.3] #btn-undo undoes 1 doc step (lines ${beforeBtnUndo.lines} -> ${afterBtnUndo.lines})`);

      // Shared boxes check on Desktop:
      // a) Offset box (#offset-distance-input)
      await pressRibbonTool(evalJs, tapMouse, 'tool-offset');
      await tapMouse({ x: C.x - 70, y: C.y });
      await waitFor(`!!document.getElementById('offset-distance-input')`, '[desktop] #offset-distance-input open');
      const offDef = await evalJs(`document.getElementById('offset-distance-input').value`);
      await typeChars('25');
      assert.strictEqual(await evalJs(`document.getElementById('offset-distance-input').value`), '25');
      await key('z', 'KeyZ', 90, 2);
      assert.strictEqual(await evalJs(`document.getElementById('offset-distance-input').value`), offDef, '[desktop] Offset box Ctrl+Z restores default in 1 step');
      await key('Escape', 'Escape', 27);

      // b) Line dual boxes (#dualInput L/angle)
      await pressRibbonTool(evalJs, tapMouse, 'tool-line');
      await tapMouse({ x: C.x - 140, y: C.y + 80 });
      await waitFor(`!!document.querySelector('#dualInput input')`, '[desktop] #dualInput open');
      const lineDef = await evalJs(`document.querySelector('#dualInput input').value`);
      await typeChars('45');
      assert.strictEqual(await evalJs(`document.querySelector('#dualInput input').value`), '45');
      await key('z', 'KeyZ', 90, 2);
      assert.strictEqual(await evalJs(`document.querySelector('#dualInput input').value`), lineDef, '[desktop] Line box Ctrl+Z restores default in 1 step');
      assert.strictEqual(await evalJs(`window.__designController.state.currentTool`), 'line', '[desktop] Line tool remains open after reverting typed box');
      await key('Escape', 'Escape', 27);

      // c) Dimension edit box (#dimInput 'edit')
      await pressRibbonTool(evalJs, tapMouse, 'tool-dim');
      await tapMouse({ x: C.x - 70, y: C.y }); // pick remaining horizontal line
      await tapMouse({ x: C.x - 70, y: C.y + 35 }); // place dim -> opens #dimInput edit
      await waitFor(`document.getElementById('dimInput') && getComputedStyle(document.getElementById('dimInput')).display !== 'none'`, '[desktop] #dimInput edit open');
      const dimDef = await evalJs(`document.getElementById('dimInput').value`);
      await typeChars('99');
      assert.strictEqual(await evalJs(`document.getElementById('dimInput').value`), '99');
      await key('z', 'KeyZ', 90, 2);
      assert.strictEqual(await evalJs(`document.getElementById('dimInput').value`), dimDef, '[desktop] #dimInput edit Ctrl+Z restores opening value in 1 step');
      await key('z', 'KeyZ', 90, 2);
      assert.strictEqual(await evalJs(`document.getElementById('dimInput').value`), dimDef, '[desktop] #dimInput edit 2nd Ctrl+Z does nothing');
      await key('Escape', 'Escape', 27);

      console.log('desktop 675 C: ALL PASS');
    }

    // ==================== 2. PHONE TOUCH (Pen Plotter 390x844, mm, real touch + keyboard) ====================
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const tapTouch = async (p) => { await touch('touchStart', [p]); await sleep(60); await touch('touchEnd', []); await sleep(260); };
      const shotClipPhone = async (file, clip) => {
        const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
        fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
      };

      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, '[phone] design tab');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!window.__sketch?.controller?.state`, '[phone] design canvas');
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
      await sleep(350);

      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.48), y: Math.round(cr.t + cr.h * 0.50) };
      const pClip = { x: Math.max(0, C.x - 120), y: Math.max(0, C.y - 120), width: 280, height: 240 };

      await pressRibbonTool(evalJs, tapTouch, 'tool-line');
      await tapTouch({ x: C.x - 100, y: C.y });
      await tapTouch(C);
      await tapTouch({ x: C.x, y: C.y - 100 });
      await key('Escape', 'Escape', 27);

      const pState = () => evalJs(`(() => {
        const st = window.__sketch.controller.state;
        const inp = document.getElementById('fillet-radius-input');
        const ir = inp ? inp.getBoundingClientRect() : null;
        const done = document.querySelector('.sk-done');
        const dr = done ? done.getBoundingClientRect() : null;
        const undo = document.getElementById('btn-undo');
        const ur = undo ? undo.getBoundingClientRect() : null;
        return {
          open: !!inp,
          focused: !!inp && document.activeElement === inp,
          val: inp ? inp.value : null,
          inpPt: ir ? { x: ir.left + ir.width / 2, y: ir.top + ir.height / 2 } : null,
          donePt: dr ? { x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 } : null,
          undoPt: ur ? { x: ur.left + ur.width / 2, y: ur.top + ur.height / 2 } : null,
          previewText: document.querySelector('#fillet-tool-overlay text')?.textContent || null,
          hist: st.history.length,
          lines: st.shapes.filter((s) => s.type === 'line').length,
          arcs: st.shapes.filter((s) => s.type === 'arc').length,
          tangents: st.constraints.filter((c) => c.type === 'tangent').length,
          radDims: st.constraints.filter((c) => c.type === 'distance' && c.isRadius).length,
          joints: st.joints.size,
        };
      })()`);

      const pBase = await pState();
      assert.strictEqual(pBase.lines, 2, '[phone] 2 lines drawn');

      await pressRibbonTool(evalJs, tapTouch, 'tool-fillet');
      await tapTouch(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[phone] #fillet-radius-input open');
      await sleep(250);

      // Tap #fillet-radius-input with real touch to focus, select, type "12"
      const pOpen = await pState();
      await tapTouch(pOpen.inpPt);
      await evalJs(`document.getElementById('fillet-radius-input').select()`);
      await typeChars('12');
      const pTyped = await pState();
      assert.strictEqual(pTyped.val, '12', '[phone] typed 12');
      assert.strictEqual(pTyped.previewText, 'R 12.0', '[phone] preview R 12.0');
      assert.strictEqual(pTyped.hist, pBase.hist, '[phone] typing adds 0 history steps');

      // ONE Ctrl+Z -> back to "5.0" in one step, box open, preview R 5.0
      await key('z', 'KeyZ', 90, 2);
      const pCtrlZ = await pState();
      assert.strictEqual(pCtrlZ.open, true, '[phone] ONE Ctrl+Z keeps box open');
      assert.strictEqual(pCtrlZ.val, '5.0', `[phone] ONE Ctrl+Z restores "5.0", got "${pCtrlZ.val}"`);
      assert.strictEqual(pCtrlZ.previewText, 'R 5.0', `[phone] preview follows "5.0", got "${pCtrlZ.previewText}"`);
      assert.strictEqual(pCtrlZ.hist, pBase.hist, '[phone] Ctrl+Z in box never undoes doc');
      await shotClipPhone('c-phone-after-ctrlz.png', pClip);

      // Confirm via green Done tap -> +1 history step; then ONE #btn-undo touch tap removes entire fillet
      await tapTouch(pCtrlZ.donePt);
      await waitFor(`window.__sketch.controller.state.shapes.filter((s) => s.type === 'arc').length === 1`, '[phone] .sk-done confirmed fillet');
      const pCommitted = await pState();
      assert.strictEqual(pCommitted.arcs, 1, '[phone 1756] arc created');
      assert.strictEqual(pCommitted.tangents, 2, '[phone 1756] 2 tangents created');
      assert.strictEqual(pCommitted.radDims, 1, '[phone 1756] radius dim created');
      assert.strictEqual(pCommitted.hist, pBase.hist + 1, '[phone 1756] fillet adds +1 history step');

      await tapTouch(pCommitted.undoPt);
      await waitFor(`window.__sketch.controller.state.shapes.filter((s) => s.type === 'arc').length === 0`, '[phone 1756] #btn-undo removed fillet');
      const pUndone = await pState();
      assert.strictEqual(pUndone.tangents, 0, '[phone 1756] tangents removed');
      assert.strictEqual(pUndone.radDims, 0, '[phone 1756] radius dim removed');
      assert.strictEqual(pUndone.lines, 2, '[phone 1756] corner sharp again');
      assert.strictEqual(pUndone.joints, pBase.joints, '[phone 1756] joints restored');

      // C.3 Phone footer #btn-undo tap WHILE #fillet-radius-input is open: closes box & undoes 1 step
      await tapTouch(C);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[phone C.3] fillet box re-opened');
      const pReopen = await pState();
      await tapTouch(pReopen.inpPt);
      await evalJs(`document.getElementById('fillet-radius-input').select()`);
      await typeChars('12');
      await tapTouch(pReopen.undoPt);
      await waitFor(`!document.getElementById('fillet-radius-input')`, '[phone C.3] #btn-undo tap closes radius box');
      const pAfterFooterUndo = await pState();
      assert.strictEqual(pAfterFooterUndo.open, false, '[phone C.3] #btn-undo tap closed radius box');
      assert.strictEqual(pAfterFooterUndo.lines, 1, `[phone C.3] #btn-undo tap undid 1 doc step (lines ${pReopen.lines} -> ${pAfterFooterUndo.lines})`);
      await shotClipPhone('c-phone-after-btn-undo.png', pClip);

      console.log('phone 675 C: ALL PASS');
    }

    assert.strictEqual(pageErrors.length, 0, `unexpected runtime errors: ${pageErrors.join('\n')}`);
    console.log('fillet-ctrl-z-675c-live.test.js: ALL PASS');
  } finally {
    await cdp.close();
  }
})();
