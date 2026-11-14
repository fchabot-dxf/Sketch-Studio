// tests/footer-delete-clear-live.test.js: TASK 619 (live headless, REAL mouse / touch):
// Shared footer Delete (#btn-delete-selection) & Clear sketch (#btn-clear-sketch) across SketchStudio, Shaper, Pen Plotter, and Trace:
// - Icons in shared sprite (#icon-circle-x red filled w/ white X; #icon-trash near-black outlined on light chrome / light on dark chrome), greyed when disabled
// - Gap between Delete and Clear sketch; hidden on non-Design stages; 32x32 desktop, 56x44 phone coarse pointer
// - Delete button matches Delete key exact code path and 1-undo behavior; Clear sketch shows "Clear sketch '<name>'? This can be undone." confirm, Cancel preserves, Confirm clears in 1 undo step
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '619');

function parseRgb(str) {
  const m = String(str || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

await (async () => {
  const cdp = await launchBrowser({ tag: '619-del', width: 1440, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left',
      buttons, clickCount: type === 'mouseMoved' ? 0 : 1,
    });
    const click = async (x, y) => {
      await mouse('mouseMoved', x, y, 0); await sleep(30);
      await mouse('mousePressed', x, y, 1); await sleep(30);
      await mouse('mouseReleased', x, y, 0); await sleep(220);
    };
    const T = (type, pts) => send('Input.dispatchTouchEvent', {
      type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })),
    });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(300); };
    const keyPress = async (key, code, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
      await sleep(220);
    };
    const esc = () => keyPress('Escape', 'Escape', 27);
    const pressDelete = () => keyPress('Delete', 'Delete', 46);

    const centerOf = (sel) => evalJs(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found/visible'); await click(c.x, c.y); };
    const tapEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found/visible'); await tap(c.x, c.y); };
    const goto = async (url, readyExpr) => {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` });
      await Promise.race([loaded, sleep(8000)]);
      await waitFor(readyExpr, url + ' ready');
      await sleep(500);
    };
    const shot = async (file, clip) => {
      const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64'));
    };

    const HOSTS = {
      studio:     { url: '/apps/sketchstudio/index.html', enter: null, otherTab: null, ready: `!!document.querySelector('#svgCanvas')`, canvas: '#svgCanvas', dark: false },
      shaper:     { url: '/apps/shaper/index.html', enter: '.sk-header-tab[data-tab="design"]', otherTab: '.sk-header-tab[data-tab="explore"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: '#design-canvas', dark: true },
      penplotter: { url: '/apps/penplotter/index.html', enter: '.sk-header-tab[data-tab="design"]', otherTab: '.sk-header-tab[data-tab="toolpath"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: '#design-canvas', dark: false },
      trace:      { url: '/apps/trace/index.html', enter: '.sk-header-tab[data-tab="edit"]', otherTab: '.sk-header-tab[data-tab="trace"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="edit"]')`, canvas: '#design-canvas', dark: true },
    };

    const open = async (name) => {
      const h = HOSTS[name];
      // each host starts on a fresh Untitled: the open-tabs buffer (TASK 624) would otherwise bring back the previous pass's drawing
      await resetBufferLive(cdp);
      await goto(h.url, h.ready);
      if (h.enter) { await evalJs(`document.querySelector(${JSON.stringify(h.enter)}).click()`); await sleep(700); }
      await waitFor(`!!document.querySelector('${h.canvas}') && document.querySelector('${h.canvas}').getBoundingClientRect().width > 100`, name + ' canvas');
      await sleep(300);
      return h;
    };

    const shapeCount = () => evalJs(`document.querySelectorAll('.shape-elem').length`);
    const inspect = () => evalJs(`(() => {
      const f = document.querySelector('footer');
      const fr = f ? f.getBoundingClientRect() : null;
      const g = (id) => {
        const b = document.getElementById(id);
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const use = b.querySelector('use');
        return {
          disabled: b.disabled, hidden: b.hidden, display: cs.display,
          aria: b.getAttribute('aria-label'), title: b.title,
          color: cs.color, opacity: Number(cs.opacity),
          useHref: use ? (use.getAttribute('href') || use.getAttribute('xlink:href')) : null,
          w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom,
        };
      };
      const modal = document.querySelector('.sk-footer-confirm[role="alertdialog"]');
      const msg = modal?.querySelector('.sk-footer-confirm-msg')?.textContent || null;
      const cbtn = document.getElementById('btn-construct-toggle');
      const cr = cbtn && cbtn.getBoundingClientRect();
      const sbtn = document.querySelector('.sk-canvas-corner .sk-browser-corner-btn');
      const sr = sbtn && getComputedStyle(sbtn).display !== 'none' ? sbtn.getBoundingClientRect() : null;
      return { vw: innerWidth, vh: innerHeight, fr: fr && { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right }, del: g('btn-delete-selection'), clr: g('btn-clear-sketch'), undo: g('btn-undo'), redo: g('btn-redo'),
        footerHasConstruct: !!(f && f.querySelector('#btn-construct-toggle')),
        cornerConstruct: cr ? { inCorner: !!cbtn.closest('.sk-canvas-corner'), w: Math.round(cr.width * 10) / 10, h: Math.round(cr.height * 10) / 10, l: cr.left, r: cr.right, t: cr.top, pressed: cbtn.getAttribute('aria-pressed'), bg: getComputedStyle(cbtn).backgroundColor } : null,
        cornerSketches: sr ? { w: Math.round(sr.width * 10) / 10, h: Math.round(sr.height * 10) / 10, l: sr.left, r: sr.right, t: sr.top } : null,
        modalMsg: msg };
    })()`);

    const drawLine = async (canvasSel, dx = 0, dy = -50, isTouch = false) => {
      const c = await centerOf(canvasSel);
      assert(c, 'canvas center missing');
      const p1 = { x: c.x - 100 + dx, y: c.y + dy };
      const p2 = { x: c.x + 100 + dx, y: c.y + 10 + dy };
      if (isTouch) {
        await tapEl('#tool-line');
        await tap(p1.x, p1.y);
        await tap(p2.x, p2.y);
      } else {
        await clickEl('#tool-line');
        await click(p1.x, p1.y);
        await click(p2.x, p2.y);
      }
      await esc();
      return { mx: Math.round((p1.x + p2.x) / 2), my: Math.round((p1.y + p2.y) / 2) };
    };

    // ---- 1. Desktop (1440x900) across all 4 hosts
    for (const [name, h] of Object.entries(HOSTS)) {
      await open(name);

      // Non-design stage hides Delete & Clear sketch
      if (h.otherTab) {
        await clickEl(h.otherTab);
        await sleep(500);
        const sOther = await inspect();
        assert.strictEqual(sOther.del.hidden, true, name + ': Delete hidden off Design/Edit stage');
        assert.strictEqual(sOther.clr.hidden, true, name + ': Clear sketch hidden off Design/Edit stage');
        await clickEl(h.enter);
        await waitFor(`!!document.querySelector('${h.canvas}') && document.querySelector('${h.canvas}').getBoundingClientRect().width > 100`, name + ' re-enter design');
        await sleep(300);
      }

      // Empty initial state
      const s0 = await inspect();
      assert(s0.del && s0.clr, name + ': Delete and Clear sketch buttons exist');
      assert.strictEqual(s0.footerHasConstruct, false, name + ': Construction is NOT in footer');
      if (name === 'penplotter') {
        assert.strictEqual(s0.cornerConstruct, null, 'penplotter: Construction stays disabled (safety check)');
      } else {
        assert(s0.cornerConstruct && s0.cornerConstruct.inCorner && s0.cornerConstruct.w === 32 && s0.cornerConstruct.h === 32,
          name + ': desktop Construction is 32x32 in .sk-canvas-corner: ' + JSON.stringify(s0.cornerConstruct));
        assert.strictEqual(s0.cornerSketches, null, name + ': desktop hides Sketches corner button so Construction sits alone');
        if (name === 'studio') {
          await clickEl('#btn-construct-toggle');
          const sOn = await inspect();
          assert.strictEqual(sOn.cornerConstruct.pressed, 'true');
          assert.strictEqual(sOn.cornerConstruct.bg, 'rgb(249, 115, 22)', 'desktop Construction ON is orange');
          const cTop = Math.max(0, Math.floor(sOn.cornerConstruct.t - 12));
          await shot('corner-desktop-studio.png', { x: Math.max(0, Math.floor(sOn.cornerConstruct.l - 24)), y: cTop, width: 80, height: 64 });
          await clickEl('#btn-construct-toggle');
        }
      }
      assert.strictEqual(s0.del.hidden, false); assert.strictEqual(s0.clr.hidden, false);
      assert.strictEqual(s0.del.aria, 'Delete'); assert.strictEqual(s0.clr.aria, 'Clear sketch');
      assert.strictEqual(s0.del.useHref, '#icon-circle-x');
      assert.strictEqual(s0.clr.useHref, '#icon-trash');
      assert.strictEqual(s0.del.disabled, true, name + ': Delete disabled on empty sketch');
      assert.strictEqual(s0.clr.disabled, true, name + ': Clear sketch disabled on empty sketch');
      assert(s0.del.w === 32 && s0.del.h === 32 && s0.clr.w === 32 && s0.clr.h === 32, name + ': desktop buttons 32x32');
      assert(s0.clr.l - s0.del.r >= 4, name + ': gap between Delete and Clear sketch: ' + (s0.clr.l - s0.del.r));
      const disabledDelColor = s0.del.color;

      // Draw a line -> Clear enabled, Delete still disabled (nothing selected)
      const n0 = await shapeCount();
      const mid1 = await drawLine(h.canvas, 0, -50, false);
      const n1 = await shapeCount();
      assert(n1 > n0, name + ': line drawn');
      const sDrawn = await inspect();
      assert.strictEqual(sDrawn.clr.disabled, false, name + ': Clear sketch enabled when active sketch non-empty');
      assert.strictEqual(sDrawn.del.disabled, true, name + ': Delete still disabled when nothing selected');

      // Select line -> Delete enabled, capture screenshot with BOTH enabled (red Delete + black/ink Clear)
      await clickEl('#tool-select');
      await click(mid1.mx, mid1.my);
      await waitFor(`!document.getElementById('btn-delete-selection').disabled`, name + ': Delete enables after clicking line');
      const sSel = await inspect();
      assert.strictEqual(sSel.del.disabled, false);
      assert.notStrictEqual(sSel.del.color, disabledDelColor, name + ': enabled Delete color differs from greyed disabled');
      const delRgb = parseRgb(sSel.del.color);
      assert(delRgb && delRgb[0] > 180 && delRgb[0] - delRgb[1] > 100 && delRgb[0] - delRgb[2] > 100, name + ': Delete enabled is red, got ' + sSel.del.color);
      const clrRgb = parseRgb(sSel.clr.color);
      if (h.dark) {
        assert(clrRgb && clrRgb[0] > 180 && clrRgb[1] > 180, name + ': dark footer Clear trash uses light header fg, got ' + sSel.clr.color);
      } else {
        assert(clrRgb && clrRgb[0] < 40 && clrRgb[1] < 40 && clrRgb[2] < 50, name + ': light footer Clear trash is near-black, got ' + sSel.clr.color);
      }
      await shot(`delete-clear-desktop-${name}.png`, { x: 0, y: sSel.fr.top - 2, width: sSel.vw, height: sSel.vh - sSel.fr.top + 2 });

      // Esc deselects -> Delete disables again, then re-select & click Delete button
      await esc();
      assert.strictEqual((await inspect()).del.disabled, true, name + ': Esc deselects and disables Delete');
      await click(mid1.mx, mid1.my);
      await waitFor(`!document.getElementById('btn-delete-selection').disabled`, name + ': re-select enables Delete');

      // Click Delete button -> deleted in 1 undo step, Undo restores
      await clickEl('#btn-delete-selection');
      assert.strictEqual(await shapeCount(), n0, name + ': clicking Delete removes the line');
      assert.strictEqual((await inspect()).del.disabled, true, name + ': Delete disabled after deleting');
      assert.strictEqual((await inspect()).clr.disabled, true, name + ': Clear disabled when last shape deleted');
      await clickEl('#btn-undo');
      assert.strictEqual(await shapeCount(), n1, name + ': ONE footer Undo restores button-deleted line');

      // Parity with Delete key: re-select -> press Delete key -> deleted in 1 undo step, Undo restores
      await click(mid1.mx, mid1.my);
      await waitFor(`!document.getElementById('btn-delete-selection').disabled`, name + ': select before Delete key');
      await pressDelete();
      assert.strictEqual(await shapeCount(), n0, name + ': Delete key removes the line');
      await clickEl('#btn-undo');
      assert.strictEqual(await shapeCount(), n1, name + ': ONE footer Undo restores key-deleted line');

      // Draw a second line so sketch has 2 shapes, then test Clear sketch Cancel -> Confirm -> Undo
      await drawLine(h.canvas, 0, -95, false);
      const n2 = await shapeCount();
      assert(n2 > n1, name + ': second line drawn');
      await clickEl('#btn-clear-sketch');
      const sAsk = await inspect();
      assert.strictEqual(sAsk.modalMsg, "Clear sketch 'Sketch 1'? This can be undone.", name + ': confirm prompt text');
      await clickEl('.sk-footer-confirm .cancel');
      assert.strictEqual((await inspect()).modalMsg, null, name + ': Cancel closes confirm');
      assert.strictEqual(await shapeCount(), n2, name + ': Cancel keeps shapes intact');

      await clickEl('#btn-clear-sketch');
      await clickEl('.sk-footer-confirm .ok');
      assert.strictEqual((await inspect()).modalMsg, null, name + ': Confirm closes modal');
      assert.strictEqual(await shapeCount(), n0, name + ': Confirm empties active sketch');
      assert.strictEqual((await inspect()).clr.disabled, true, name + ': Clear sketch disables when empty');
      assert.strictEqual((await inspect()).undo.disabled, false, name + ': Undo enables after Clear sketch');
      await clickEl('#btn-undo');
      assert.strictEqual(await shapeCount(), n2, name + ': ONE footer Undo restores entire cleared sketch');
      console.log('desktop delete/clear ok:', name);
    }

    // ---- 2. Phone portrait (390x844, coarse pointer / touch) across all 4 hosts + confirm dialog shot
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    for (const [name, h] of Object.entries(HOSTS)) {
      await open(name);
      const mid = await drawLine(h.canvas, 0, -50, true);
      await tapEl('#tool-select');
      await tap(mid.mx, mid.my);
      await waitFor(`!document.getElementById('btn-delete-selection').disabled`, name + ' phone: select line');
      const s = await inspect();
      assert(s.del.w >= 55 && s.del.h >= 43.5 && s.clr.w >= 55 && s.clr.h >= 43.5, name + ' phone: 56x44 buttons: ' + JSON.stringify([s.del, s.clr]));
      assert(s.clr.l - s.del.r >= 4, name + ' phone: gap preserved');
      assert.strictEqual(s.footerHasConstruct, false, name + ' phone: Construction is NOT in footer');
      if (name === 'penplotter') {
        assert.strictEqual(s.cornerConstruct, null, 'penplotter phone: Construction stays disabled');
      } else {
        assert(s.cornerConstruct && s.cornerConstruct.inCorner && s.cornerConstruct.w === 44 && s.cornerConstruct.h === 44,
          name + ' phone: Construction is 44x44 in .sk-canvas-corner: ' + JSON.stringify(s.cornerConstruct));
        assert(s.cornerSketches && s.cornerSketches.w === 44 && s.cornerSketches.h === 44 && s.cornerConstruct.r < s.cornerSketches.l,
          name + ' phone: Construction sits beside Sketches in .sk-canvas-corner: ' + JSON.stringify({ c: s.cornerConstruct, s: s.cornerSketches }));
        if (name === 'studio') {
          await tapEl('#btn-construct-toggle');
          const cTop = Math.max(0, Math.floor(s.cornerConstruct.t) - 16);
          await shot('corner-portrait-studio.png', { x: Math.max(0, s.vw - 140), y: cTop, width: 140, height: 80 });
          await tapEl('#btn-construct-toggle');
        }
      }
      await shot(`delete-clear-portrait-${name}.png`, { x: 0, y: s.fr.top - 2, width: s.vw, height: s.vh - s.fr.top + 2 });

      // Tap Delete -> deletes -> Tap Undo -> restores
      const nBefore = await shapeCount();
      assert(nBefore > 0);
      await tapEl('#btn-delete-selection');
      assert.strictEqual(await shapeCount(), 0, name + ' phone: tap Delete removes selected shape');
      await tapEl('#btn-undo');
      assert.strictEqual(await shapeCount(), nBefore, name + ' phone: tap Undo restores');

      // Tap Clear sketch -> screenshot confirm dialog (on studio), then confirm -> Undo restores
      await tapEl('#btn-clear-sketch');
      const sModal = await inspect();
      assert.strictEqual(sModal.modalMsg, "Clear sketch 'Sketch 1'? This can be undone.");
      if (name === 'studio') await shot('delete-clear-confirm-portrait.png');
      await tapEl('.sk-footer-confirm .ok');
      assert.strictEqual(await shapeCount(), 0, name + ' phone: tap Clear confirm empties sketch');
      await tapEl('#btn-undo');
      assert.strictEqual(await shapeCount(), nBefore, name + ' phone: tap Undo restores cleared sketch');
      console.log('phone portrait delete/clear ok:', name);
    }

    console.log('footer-delete-clear-live: ok');
  } finally {
    await cdp.close();
  }
})();
