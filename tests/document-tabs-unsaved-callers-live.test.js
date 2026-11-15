// tests/document-tabs-unsaved-callers-live.test.js — TASK 681 (owner 1765 / 1767): every place the app ASKS "This design is not saved." (or the failed-save question) uses the ONE modal
// (template-picker.js openChoiceModal / openPromptModal); and the places that open a NEW TAB ask nothing. SketchStudio, mouse and phone tap:
//   - GO TO another app with an unsaved Untitled: the modal; Cancel stays on the page; Dont save leaves it
//   - a stored design whose last save failed, tab closed: "The last save of this design failed." in the modal (Try saving again / Close anyway / Cancel); Cancel keeps the tab, Close anyway closes it
//   - Save... then asks the name in the same modal (a name field + Save / Cancel), not inline in the drawer
//   - Open recent (a stored design) and New design with an unsaved active tab: NO question of any kind, a NEW tab opens, the unsaved tab stays
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '681u', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  await installFakeDriveSession(cdp);
  try {
    const shot = async (name, w, h) => {
      if (!process.env.EVIDENCE_DIR) return;
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
    };
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    for (const mode of ['desktop', 'phone']) {
      const phone = mode === 'phone';
      const center = async (sel, i = 0) => {
        await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (e) e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); })()`); await sleep(80);
        const c = await evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        assert(c, mode + ': ' + sel + ' exists'); return c;
      };
      const press = async (sel, i = 0) => {
        const c = await center(sel, i);
        if (phone) { await T('touchStart', [c]); await sleep(40); await T('touchEnd', []); await sleep(350); return; }
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
      };
      const names = () => evalJs(`[...document.querySelectorAll('.sk-doctab-name')].map((e) => e.textContent)`);
      const modal = () => evalJs(`(() => { const d = document.querySelector('.sk-tp-backdrop [role="dialog"]'); return d ? { text: d.textContent, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent), input: !!d.querySelector('input'), inline: !!document.querySelector('.sk-sidebar-ask') } : null; })()`);
      const modalUp = (what) => waitFor(`!!document.querySelector('.sk-tp-backdrop [role="dialog"]')`, `${mode}: ${what}`);
      const noModal = async (what) => { await sleep(500); assert.strictEqual(await evalJs(`!!document.querySelector('.sk-tp-backdrop [role="dialog"]') || !!document.querySelector('.sk-sidebar-ask')`), false, `${mode}: ${what}: no question`); };
      const openMenu = async () => { if (!(await evalJs(`(() => { const g = document.querySelector('.sk-sidebar-goto'); if (!g) return false; const r = g.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; })()`))) await press(phone ? '.sk-sidebar-handle' : '.sk-sidebar-btn'); await waitFor(`(() => { const g = document.querySelector('.sk-sidebar-goto'); if (!g) return false; const r = g.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.left < innerWidth; })()`, mode + ': the menu'); };
      await resetBufferLive(cdp);
      if (phone) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
      await waitFor(`document.querySelectorAll('.sk-doctab-name').length === 1`, mode + ': one tab');
      await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn')`, mode + ': the ribbon');
      const w = phone ? 390 : 1400, y = phone ? 450 : 400;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'l', code: 'KeyL', text: 'l', windowsVirtualKeyCode: 76 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76 });
      for (const x of [Math.round(w * 0.3), Math.round(w * 0.6)]) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
      }
      await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
      await waitFor(`!!document.querySelector('.sk-doctab-dot')`, mode + ': the unsaved dot');
      const storedId = await evalJs(CREATE_NAMED_DESIGN('sketchstudio', 'Stored one'));

      // ---- tabs host: Open recent and New design with an unsaved ACTIVE tab ask nothing and open a NEW tab ----
      await openMenu(); await press('[data-action="open-recent"]');
      await waitFor(`!!document.querySelector('.sk-pm-tile[data-design="${storedId}"]')`, mode + ': the stored tile');
      await press(`.sk-pm-tile[data-design="${storedId}"]`);
      await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, mode + ': Open recent opens a new tab');
      await noModal('Open recent');
      assert.deepStrictEqual(await names(), ['Untitled', 'Stored one'], mode + ': the unsaved tab stays, the design opened beside it');
      await press('.sk-doctab-main', 0); await sleep(400);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent`), 'Untitled', mode + ': the unsaved tab is active');
      await openMenu(); await press('[data-action="new-design"]');
      await waitFor(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`, mode + ': the template picker');
      await press('.sk-tp-card[data-template="blank"]');
      await waitFor(`document.querySelectorAll('.sk-doctab').length === 3`, mode + ': New design opens a new tab');
      await noModal('New design');
      assert.deepStrictEqual(await names(), ['Untitled', 'Stored one', 'Untitled'], mode + ': New design: a new tab, the unsaved one stays');

      // ---- the failed-save question (a stored design whose last save failed), in the modal ----
      await press('.sk-doctab-main', 1); await sleep(400);
      await evalJs(`import('/packages/ui/project-store.js').then((m) => { const s = m.getProjectStore(); const real = s.status.bind(s); s.status = (id) => (id === ${JSON.stringify(storedId)} ? { state: 'failed' } : real(id)); })`);
      await sleep(700);
      await press('.sk-doctab-x', 1); await modalUp('the failed-save question');
      let m = await modal();
      assert(/last save of this design failed/.test(m.text) && !m.inline, mode + ': the failed-save question is in the modal: ' + JSON.stringify(m));
      assert.deepStrictEqual(m.buttons, ['Try saving again', 'Close anyway', 'Cancel'], mode + ': its answers');
      await shot(`failed-save-${mode}.png`, w, phone ? 844 : 800);
      await press('.sk-tp-cancel'); await sleep(300);
      assert.strictEqual((await names()).length, 3, mode + ': Cancel keeps the tab');
      await press('.sk-doctab-x', 1); await modalUp('the failed-save question again'); await press('.sk-tp-btn[data-choice="close"]');
      await waitFor(`document.querySelectorAll('.sk-doctab').length === 2`, mode + ': Close anyway closes the tab');

      // ---- GO TO with the unsaved Untitled active: the modal; Save... asks the name in the modal; Cancel stays; Dont save leaves ----
      await press('.sk-doctab-main', 0); await sleep(500);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-doctab.active .sk-doctab-dot') !== null`), true, mode + ': the unsaved tab is active');
      await openMenu(); await press('.sk-sidebar-goto [data-app="shaper"]'); await modalUp('GO TO asks');
      m = await modal();
      assert(/This design is not saved/.test(m.text) && !m.inline, mode + ': GO TO asks in the modal: ' + JSON.stringify(m));
      assert.deepStrictEqual(m.buttons, ['Save…', "Don't save", 'Cancel'], mode + ': GO TO: the three answers');
      await shot(`goto-${mode}.png`, w, phone ? 844 : 800);
      await press('.sk-tp-btn[data-choice="save"]');
      await waitFor(`!!document.querySelector('.sk-tp-backdrop [role="dialog"] input')`, mode + ': the Save as name prompt');
      m = await modal();
      assert(/Save as/.test(m.text) && m.input && !m.inline && m.buttons.join() === 'Save,Cancel', mode + ': the name prompt is in the same modal (name field, Save, Cancel): ' + JSON.stringify(m));
      await shot(`save-as-${mode}.png`, w, phone ? 844 : 800);
      await press('.sk-tp-backdrop .sk-tp-cancel'); await sleep(400);
      assert(/\/apps\/sketchstudio\//.test(await evalJs('location.pathname')), mode + ': Cancel stays on the page');
      await openMenu(); await press('.sk-sidebar-goto [data-app="shaper"]'); await modalUp('GO TO asks again'); await press('.sk-tp-btn[data-choice="discard"]');
      await waitFor(`/\\/apps\\/shaper\\//.test(location.pathname)`, mode + ': Dont save leaves for Shaper');
      if (phone) { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }); }
    }
    console.log('document-tabs-unsaved-callers-live: ok');
  } finally { await cdp.close(); }
})();
