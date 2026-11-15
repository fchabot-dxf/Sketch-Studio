// tests/document-tabs-close-modal-live.test.js — TASK 681 addition (owner turn 1752): closing a document tab that has unsaved changes asks "This design is not saved." in a
// centred MODAL (the template picker's modal: dimmed backdrop, role=dialog aria-modal=true, focus on the default button), with a mouse and with a finger (390 px):
// Save... (default, Enter), Don't save, Cancel (Esc). Cancel / Esc keep the tab; Don't save closes it; Save... opens the Save as name prompt.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '681m', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  await installFakeDriveSession(cdp);
  try {
    const shot = async (name, clip) => {
      if (!process.env.EVIDENCE_DIR) return;
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
    };
    const center = (sel, i = 0) => evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    for (const mode of ['desktop', 'phone']) {
      const phone = mode === 'phone';
      const press = async (sel, i = 0) => {
        const c = await center(sel, i); assert(c, mode + ': ' + sel + ' exists');
        if (phone) { await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); await sleep(350); return; }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
      };
      await resetBufferLive(cdp);
      if (phone) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
      await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1`, mode + ': one restored tab');
      await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn')`, mode + ': the ribbon');
      // an unsaved Untitled with a line in it, then a second (empty) tab so the first can be closed
      const w = phone ? 390 : 1400;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', text: 'l', windowsVirtualKeyCode: 76 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
      for (const x of [Math.round(w * 0.3), Math.round(w * 0.6)]) {
        const y = phone ? 450 : 400;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
      }
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      await waitFor(`!!document.querySelector('.sk-doctab-dot')`, mode + ': the not-saved dot');
      await press('.sk-doctab-new');
      await waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, mode + ': the template modal');
      await press('.sk-tp-card[data-template="blank"]');
      await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, mode + ': two tabs');
      const names = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
      const modalUp = () => waitFor(`!!document.querySelector('.sk-tp-backdrop [role="dialog"]')`, mode + ': the modal');
      const modalGone = () => waitFor(`!document.querySelector('.sk-tp-backdrop')`, mode + ': the modal is gone');
      const closeFirst = async () => { await press('.sk-doctab-x', 0); await modalUp(); };

      // 1. the modal: dialog, aria-modal, dimmed backdrop over the page, centred, focus on Save..., buttons Save... / Don't save / Cancel
      await closeFirst();
      const m = await evalJs(`(() => { const d = document.querySelector('.sk-tp-backdrop [role="dialog"]'); const b = d.parentElement; const r = d.getBoundingClientRect(); const bs = getComputedStyle(b); const bb = b.getBoundingClientRect();
        const btns = [...d.querySelectorAll('button')].map((e) => ({ t: e.textContent, h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) }));
        return { modal: d.getAttribute('aria-modal'), text: d.textContent, dim: bs.backgroundColor, full: bb.width === innerWidth && bb.height === innerHeight, cx: Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2, cy: Math.abs(r.top + r.height / 2 - innerHeight / 2) < 2, fits: r.left >= 0 && r.right <= innerWidth,
          focus: document.activeElement.textContent, btns, inline: !!document.querySelector('.sk-sidebar-ask'), drawerOpen: !!document.querySelector('.sk-sidebar.open, .sk-sidebar[data-open="true"]') }; })()`);
      assert.strictEqual(m.modal, 'true', mode + ': aria-modal');
      assert(/This design is not saved/.test(m.text), mode + ': the question: ' + m.text);
      assert(m.full && /rgba\(0, 0, 0, 0\.5\)/.test(m.dim), mode + ': a dimmed backdrop over the whole page: ' + m.dim);
      assert(m.cx && m.cy && m.fits, mode + ': centred and fits the screen: ' + JSON.stringify(m));
      assert.strictEqual(m.focus, 'Save…', mode + ': focus on the default button');
      assert.deepStrictEqual(m.btns.map((b) => b.t), ['Save…', "Don't save", 'Cancel'], mode + ': the buttons');
      if (phone) assert(m.btns.every((b) => b.h >= 44), mode + ': buttons are 44 px: ' + JSON.stringify(m.btns));
      assert.strictEqual(m.inline, false, mode + ': not asked inline in the drawer');
      await shot(`modal-${mode}.png`, { x: 0, y: 0, width: w, height: phone ? 844 : 800 });

      // 2. Cancel keeps the tab
      await press('.sk-tp-cancel'); await modalGone();
      assert.strictEqual((await names()).length, 2, mode + ': Cancel keeps the tab');
      // 3. Esc keeps it
      await closeFirst(); await sendRealKey(send, 'Escape', 'Escape', 27); await modalGone();
      assert.strictEqual((await names()).length, 2, mode + ': Esc keeps the tab');
      // 4. Enter = Save...: the Save as name prompt (Esc there changes nothing)
      await closeFirst(); await sendRealKey(send, 'Enter', 'Enter', 13, 0, '\r');
      await waitFor(`!!document.querySelector('.sk-sidebar-ask input')`, mode + ': the Save as name prompt after Enter');
      assert(/Save as/.test(await evalJs(`document.querySelector('.sk-sidebar-ask').textContent`)), mode + ': it is the Save as prompt');
      await press('.sk-sidebar-ask .cancel'); await sleep(300);
      assert.strictEqual((await names()).length, 2, mode + ': cancelling the name prompt keeps the tab');
      // 5. Don't save closes it (the drawer the name prompt opened is closed first)
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(400);
      await closeFirst(); await press('.sk-tp-btn[data-choice="discard"]'); await modalGone();
      await waitFor(`document.querySelectorAll('.sk-doctab').length === 1`, mode + ": Don't save closes the tab");
      if (phone) { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }); }
    }
    console.log('document-tabs-close-modal-live: ok');
  } finally { await cdp.close(); }
})();
