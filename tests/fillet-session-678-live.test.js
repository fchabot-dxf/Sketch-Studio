// tests/fillet-session-678-live.test.js -- TASK 678 (real headless Edge/Chrome, mouse + phone touch):
// 1. Desktop (Shaper 1280x800): pick 3 corners of a rectangle while #fillet-radius-input is open, type 5, Enter ->
//    1 radius dimension + 2 EQUAL constraints in 1 undo step; editing that radius dim moves all 3 arcs;
//    ONE canvas Ctrl+Z removes all 3 fillets; Enter between corners gives 3 radius dimensions.
// 2. Phone touch (Pen Plotter 390x844): tap 3 corners while box open, type 6, tap .sk-done ->
//    1 radius dimension + 2 EQUAL constraints in 1 undo step; ONE tap on #btn-undo removes all 3 fillets.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '678');

await (async () => {
  const cdp = await launchBrowser({ tag: '678', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, waitForApp, navigate } = cdp;
  const pageErrors = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(m.params.exceptionDetails));
  });

  const mouse = (type, x, y, buttons = 0, clickCount = 1) => send('Input.dispatchMouseEvent', {
    type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : clickCount,
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
  const shotClip = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
  };

  const fState = () => evalJs(`(() => {
    const st = (window.__designController || window.__sketch?.controller).state;
    const inp = document.getElementById('fillet-radius-input');
    const arcRadii = st.shapes.filter((s) => s.type === 'arc').map((a) => {
      const c = st.joints.get(a.joints[0]), r = st.joints.get(a.joints[1]);
      return Math.hypot(r.x - c.x, r.y - c.y);
    });
    const eqPairs = st.constraints.filter((c) => c && c.type === 'equal' && Array.isArray(c.shapes) && c.shapes.length === 2).length;
    return {
      open: !!inp,
      focused: !!inp && document.activeElement === inp,
      val: inp ? inp.value : null,
      previewArcs: document.querySelectorAll('#fillet-tool-overlay path[d*=" A "]').length,
      hist: st.history.length,
      arcs: arcRadii.length,
      arcRadii,
      radDims: st.constraints.filter((c) => c.type === 'distance' && c.isRadius).length,
      eqPairs,
      activeId: document.activeElement?.id || document.activeElement?.tagName || null,
    };
  })()`);

  try {
    fs.mkdirSync(EVID, { recursive: true });

    // ==================== 1. DESKTOP MOUSE + REAL KEYS (Shaper 1280x800, mm) ====================
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      const tapMouse = async (p) => {
        await mouse('mouseMoved', p.x, p.y, 0); await sleep(50);
        await mouse('mousePressed', p.x, p.y, 1); await sleep(40);
        await mouse('mouseReleased', p.x, p.y, 0); await sleep(200);
      };
      const dblClickMouse = async (p) => {
        await mouse('mouseMoved', p.x, p.y, 0); await sleep(40);
        await mouse('mousePressed', p.x, p.y, 1, 1); await sleep(30);
        await mouse('mouseReleased', p.x, p.y, 0, 1); await sleep(40);
        await mouse('mousePressed', p.x, p.y, 1, 2); await sleep(30);
        await mouse('mouseReleased', p.x, p.y, 0, 2); await sleep(220);
      };

      await resetBufferLive(cdp);
      await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper design tab');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`!!window.__designController && document.querySelector('#design-canvas').getBoundingClientRect().width > 0`, 'shaper design controller');
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
      await sleep(300);

      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.52) };
      const rectPts = [
        { x: C.x - 160, y: C.y - 125 },
        { x: C.x + 160, y: C.y - 125 },
        { x: C.x + 160, y: C.y + 125 },
        { x: C.x - 160, y: C.y + 125 },
      ];
      const clipBox = { x: Math.max(0, C.x - 270), y: Math.max(0, C.y - 200), width: 540, height: 400 };

      // Draw closed 4-line rectangle
      await pressRibbonTool(evalJs, tapMouse, 'tool-line');
      for (const p of rectPts) await tapMouse(p);
      await tapMouse(rectPts[0]);
      await key('Escape', 'Escape', 27);
      const base = await fState();
      assert.strictEqual(base.arcs, 0, 'clean baseline');

      // Activate Fillet tool; pick 3 corners while box remains open
      await pressRibbonTool(evalJs, tapMouse, 'tool-fillet');
      await tapMouse(rectPts[0]);
      await waitFor(`!!document.getElementById('fillet-radius-input')`, '[desktop] box opens on 1st corner');
      await tapMouse(rectPts[1]);
      await tapMouse(rectPts[2]);
      await waitFor(`document.querySelectorAll('#fillet-tool-overlay path[d*=" A "]').length === 3`, '[desktop] all 3 pending corners previewed');
      const sPending = await fState();
      assert.strictEqual(sPending.open, true, '[desktop] radius box stays open after 3 corners');
      assert.strictEqual(sPending.focused, true, '[desktop] radius box stays focused after 3rd corner');
      assert.strictEqual(sPending.hist, base.hist, '[desktop] 0 history steps while picking corners');
      await shotClip('desktop-pending-3.png', clipBox);

      // Type 5 and confirm with Enter -> 1 radius dim + 2 equal constraints in 1 undo step
      await typeChars('5');
      await key('Enter', 'Enter', 13);
      await waitFor(`!document.getElementById('fillet-radius-input')`, '[desktop] Enter closes box');
      const sApplied = await fState();
      assert.strictEqual(sApplied.arcs, 3, '[desktop] 3 arcs created');
      assert.strictEqual(sApplied.radDims, 1, '[desktop] 1 radius dimension created');
      assert.strictEqual(sApplied.eqPairs, 2, '[desktop] 2 EQUAL constraints created');
      assert.strictEqual(sApplied.hist, base.hist + 1, '[desktop] 1 undo step for all 3 fillets');
      for (const r of sApplied.arcRadii) assert.ok(Math.abs(r - 5) < 1e-2, `[desktop] arc radius 5, got ${r}`);
      await shotClip('desktop-applied-equal.png', clipBox);

      // Edit 1st fillet's radius dimension to 10 -> all 3 arcs update to 10
      await pressRibbonTool(evalJs, tapMouse, 'tool-select');
      const dimLabelPt = await evalJs(`(() => {
        const labels = [...document.querySelectorAll('#design-canvas g.dim-label[data-constraint-idx]')];
        const el = labels.find((g) => /R\s*5/i.test(g.textContent || '')) || labels[0];
        if (!el) return null;
        const t = el.querySelector('text') || el;
        const r = t.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      assert.ok(dimLabelPt, '[desktop] found rendered radius dimension label');
      await dblClickMouse(dimLabelPt);
      await waitFor(`(() => { const el = document.getElementById('dimInput'); return el && getComputedStyle(el).display !== 'none'; })()`, '[desktop] #dimInput opens on radius label');
      await typeChars('10');
      await key('Enter', 'Enter', 13);
      await waitFor(`(() => { const el = document.getElementById('dimInput'); return !el || getComputedStyle(el).display === 'none'; })()`, '[desktop] #dimInput closes');
      await sleep(180);
      const sEdited = await fState();
      for (const r of sEdited.arcRadii) assert.ok(Math.abs(r - 10) < 1e-2, `[desktop] edited radius moved arc to 10, got ${r}`);
      await shotClip('desktop-edited-10.png', clipBox);

      // Undo edit back to 5, then ONE Ctrl+Z on canvas removes all 3 fillets
      await key('z', 'KeyZ', 90, 2);
      await sleep(150);
      await key('z', 'KeyZ', 90, 2);
      await sleep(200);
      const sUndone = await fState();
      assert.strictEqual(sUndone.arcs, 0, '[desktop] ONE canvas Ctrl+Z removes all 3 arcs');
      assert.strictEqual(sUndone.radDims, 0, '[desktop] ONE canvas Ctrl+Z removes radius dim');
      assert.strictEqual(sUndone.eqPairs, 0, '[desktop] ONE canvas Ctrl+Z removes equal constraints');
      assert.strictEqual(sUndone.hist, base.hist, '[desktop] history returned to baseline');
      await shotClip('desktop-after-undo.png', clipBox);

      // Enter-between-corners: each corner confirmed individually -> 3 radius dimensions, 0 equal constraints
      await pressRibbonTool(evalJs, tapMouse, 'tool-fillet');
      for (let i = 0; i < 3; i++) {
        await tapMouse(rectPts[i]);
        await waitFor(`!!document.getElementById('fillet-radius-input')`, `[desktop separate] box opens corner ${i}`);
        await key('Enter', 'Enter', 13);
        await waitFor(`!document.getElementById('fillet-radius-input')`, `[desktop separate] box closes corner ${i}`);
      }
      const sSeparate = await fState();
      assert.strictEqual(sSeparate.arcs, 3, '[desktop separate] 3 arcs created');
      assert.strictEqual(sSeparate.radDims, 3, '[desktop separate] 3 radius dimensions created');
      assert.strictEqual(sSeparate.eqPairs, 0, '[desktop separate] 0 equal constraints');
      assert.strictEqual(sSeparate.hist, base.hist + 3, '[desktop separate] 3 undo steps');
      await shotClip('desktop-separate-3.png', clipBox);
    }
    console.log('[desktop] ok');

    // ==================== 2. PHONE TOUCH (Pen Plotter 390x844, mm) ====================
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, hasTouch: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const tapTouch = async (p) => {
        await touch('touchStart', [p]); await sleep(45);
        await touch('touchEnd', []); await sleep(220);
      };

      await resetBufferLive(cdp);
      await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`, 8000);
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'penplotter design tab');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
      await waitForApp('design-canvas');
      await waitFor(`!!(window.__designController || window.__sketch?.controller)?.state && document.querySelector('#design-canvas').getBoundingClientRect().width > 0`, 'penplotter design controller');
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => m.default.set('DOC_UNIT', 'mm'))`);
      await sleep(300);

      const cr = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
      const C = { x: Math.round(cr.l + cr.w * 0.5), y: Math.round(cr.t + cr.h * 0.5) };
      const rectPts = [
        { x: C.x - 85, y: C.y - 65 },
        { x: C.x + 85, y: C.y - 65 },
        { x: C.x + 85, y: C.y + 65 },
        { x: C.x - 85, y: C.y + 65 },
      ];
      const pClip = { x: Math.max(0, C.x - 165), y: Math.max(0, C.y - 160), width: 330, height: 320 };

      await pressRibbonTool(evalJs, tapTouch, 'tool-line');
      for (const p of rectPts) await tapTouch(p);
      await tapTouch(rectPts[0]);
      await key('Escape', 'Escape', 27);
      const pBase = await fState();

      await pressRibbonTool(evalJs, tapTouch, 'tool-fillet');
      await tapTouch(rectPts[0]);
      await waitFor(`!!document.getElementById('fillet-radius-input') && !document.querySelector('.sk-done')?.hidden`, '[phone] box + done shown');
      await tapTouch(rectPts[1]);
      await tapTouch(rectPts[2]);
      await waitFor(`document.querySelectorAll('#fillet-tool-overlay path[d*=" A "]').length === 3`, '[phone] 3 pending previews shown');
      await shotClip('phone-pending-3.png', pClip);

      // Type 6 into #fillet-radius-input and tap .sk-done
      const boxPt = await evalJs(`(() => { const r = document.getElementById('fillet-radius-input').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await tapTouch(boxPt);
      await evalJs(`document.getElementById('fillet-radius-input').select()`);
      await typeChars('6');
      const donePt = await evalJs(`(() => { const r = document.querySelector('.sk-done').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await tapTouch(donePt);
      await waitFor(`!document.getElementById('fillet-radius-input')`, '[phone] done button closes box');

      const pApplied = await fState();
      assert.strictEqual(pApplied.arcs, 3, '[phone] 3 arcs applied');
      assert.strictEqual(pApplied.radDims, 1, '[phone] 1 radius dimension applied');
      assert.strictEqual(pApplied.eqPairs, 2, '[phone] 2 EQUAL constraints applied');
      assert.strictEqual(pApplied.hist, pBase.hist + 1, '[phone] 1 undo step');
      for (const r of pApplied.arcRadii) assert.ok(Math.abs(r - 6) < 1e-2, `[phone] arc radius 6, got ${r}`);
      await shotClip('phone-applied-equal.png', pClip);

      // ONE tap on footer #btn-undo removes all 3 fillets
      const undoPt = await evalJs(`(() => { const r = document.getElementById('btn-undo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await tapTouch(undoPt);
      await sleep(220);
      const pUndone = await fState();
      assert.strictEqual(pUndone.arcs, 0, '[phone] ONE undo removes all 3 arcs');
      assert.strictEqual(pUndone.radDims, 0, '[phone] ONE undo removes radius dim');
      assert.strictEqual(pUndone.eqPairs, 0, '[phone] ONE undo removes equal constraints');
      await shotClip('phone-after-undo.png', pClip);
    }
    console.log('[touch] ok');

    assert.strictEqual(pageErrors.length, 0, 'no uncaught page errors: ' + pageErrors.join('; '));
    console.log('fillet-session-678-live.test.js: ok');
  } finally {
    await cdp.close();
  }
})();
