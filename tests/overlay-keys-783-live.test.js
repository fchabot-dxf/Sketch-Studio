// tests/overlay-keys-783-live.test.js — TASK 783 A + B, SketchStudio and Shaper (the shared overlays and key router), fake Google only, every non-local request blocked.
//  A. a key pressed while the keyboard focus is INSIDE an open overlay (the account menu, the drawer, the Settings panel) belongs to the overlay, never to the drawing behind it:
//     with a line selected, Delete / Backspace / a tool letter (R) / Ctrl+Z / Ctrl+Y do nothing to the drawing (the line count, the selection and the active tool stay); the overlay
//     stays open; after Esc closes it the SAME keys work again (R switches to Rect, Delete removes the line, Ctrl+Z brings it back). Desktop 1280 and phone 390 (touch).
//  B. the account menu is rebuilt while open when the settings sync status changes (about 2 s after a settings change): the focused control stays focused through two status
//     changes, and a running "Check Google Drive connection" stays running (button disabled, its step list kept and still updating, then enabled when it ends).
// Screenshots to EVIDENCE_DIR (default .evidence/783).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/783');
fs.mkdirSync(EVID, { recursive: true });
const HOSTS = {
  sketchstudio: { url: '/apps/sketchstudio/index.html', enter: null, canvas: 'svgCanvas' },
  shaper: { url: '/apps/shaper/index.html', enter: '.sk-header-tab[data-tab="design"]', canvas: 'design-canvas' },
};
const SIZES = [{ name: 'desktop-1280', w: 1280, h: 800, touch: false }, { name: 'phone-390', w: 390, h: 844, touch: true }];
const OVERLAYS = [
  { name: 'account menu', open: `document.querySelector('.sk-account').click()`, isOpen: `!document.querySelector('.sk-account-menu').hidden`, inside: `document.querySelector('.sk-account-menu').contains(document.activeElement)` },
  { name: 'drawer', open: `(document.querySelector('.sk-sidebar-btn') || document.querySelector('.sk-sidebar-handle')).click()`, isOpen: `!!document.querySelector('.sk-sidebar.open')`, inside: `document.querySelector('.sk-sidebar').contains(document.activeElement)` },
  { name: 'Settings panel', open: `document.getElementById('btn-settings').click()`, isOpen: `!document.querySelector('.sk-style-panel').classList.contains('sk-hidden')`, inside: `document.querySelector('.sk-style-panel').contains(document.activeElement)` },
];

await (async () => {
  const cdp = await launchBrowser({ tag: '783a', width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  try {
    await blockRemote(cdp);
    await installFakeDriveSession(cdp, { signedIn: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(250); };
    const key = async (k, code, vk, mods = 0, text = '') => { await sendRealKey(send, k, code, vk, mods, text); await sleep(250); };
    const lines = (c) => evalJs(`document.querySelectorAll('#${c} [data-shape-id]').length`);
    const selected = () => evalJs(`!document.getElementById('btn-delete-selection').disabled`);
    const activeTool = () => evalJs(`[...document.querySelectorAll('.sk-ribbon-btn.active')].map((b) => b.id).join()`);
    const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const setSize = async (s) => {
      await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.touch, screenOrientation: s.w > s.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 0 });
      await sleep(250);
    };
    const open = async (name) => {
      const h = HOSTS[name];
      await resetBufferLive(cdp);
      await navigate(`http://127.0.0.1:${port}${h.url}`, 15000); await waitForApp(h.canvas);
      if (h.enter) { await evalJs(`document.querySelector(${JSON.stringify(h.enter)}).click()`); await sleep(800); }
      await waitFor(`document.getElementById('${h.canvas}').getBoundingClientRect().width > 100 && !!document.querySelector('.sk-account')`, name + ' ready'); await sleep(300);
    };
    // draw ONE line on the Design canvas, then leave Select active
    const drawLine = async (c) => {
      const base = await lines(c);
      const r = await evalJs(`(() => { const b = document.getElementById('${c}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; })()`);
      const half = Math.min(120, r.w / 4);
      await evalJs(`document.getElementById('tool-line').click()`); await sleep(200);
      await click(r.x - half, r.y); await click(r.x + half, r.y); await key('Escape', 'Escape', 27);
      await evalJs(`document.getElementById('tool-select').click()`); await sleep(200);
      assert.strictEqual(await lines(c), base + 1, c + ': a line was drawn');
    };
    const selectLine = async (c) => {
      await evalJs(`document.getElementById('tool-select').click()`); await sleep(150);
      const p = await evalJs(`(() => { const e = document.querySelector('#${c} [data-shape-id]'); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + r.height * 0.3) }; })()`); // a point along the line, not its middle (Shaper puts a grip there)
      await click(p.x, p.y);
      await waitFor(`!document.getElementById('btn-delete-selection').disabled`, 'the line is selected', 4000);
    };

    // ---- A ----
    for (const size of SIZES) {
      for (const hostName of Object.keys(HOSTS)) {
        const c = HOSTS[hostName].canvas;
        await setSize(SIZES[0]); await open(hostName);
        await drawLine(c);
        await setSize(size); await sleep(300);
        for (const o of OVERLAYS) {
          const tag = `${hostName} ${size.name} ${o.name}`;
          await selectLine(c);
          const before = await lines(c), toolBefore = await activeTool();
          await evalJs(o.open); await sleep(400);
          assert.strictEqual(await evalJs(o.isOpen), true, tag + ': the overlay is open');
          assert.strictEqual(await evalJs(o.inside), true, tag + ': the keyboard focus is inside the overlay: ' + await evalJs(`document.activeElement && (document.activeElement.className || document.activeElement.id || document.activeElement.tagName)`));
          for (const [name, k, code, vk, mods, text] of [['Delete', 'Delete', 'Delete', 46, 0, ''], ['Backspace', 'Backspace', 'Backspace', 8, 0, ''], ['the letter R', 'r', 'KeyR', 82, 0, 'r'], ['Ctrl+Z', 'z', 'KeyZ', 90, 2, ''], ['Ctrl+Y', 'y', 'KeyY', 89, 2, '']]) {
            await key(k, code, vk, mods, text);
            assert.strictEqual(await lines(c), before, `${tag}: ${name} did not touch the drawing (lines)`);
            assert.strictEqual(await activeTool(), toolBefore, `${tag}: ${name} did not switch the tool`);
            assert.strictEqual(await selected(), true, `${tag}: ${name} kept the selection`);
          }
          assert.strictEqual(await evalJs(o.isOpen), true, tag + ': still open after the keys');
          if (hostName === 'sketchstudio' && size === SIZES[0]) await shot(`keys-overlay-${o.name.replace(/ /g, '-')}.png`);
          await key('Escape', 'Escape', 27);
          if (await evalJs(o.isOpen)) await key('Escape', 'Escape', 27);
          assert.strictEqual(await evalJs(o.isOpen), false, tag + ': Esc closes it');
          // after the overlay is closed the same keys work again
          await selectLine(c);
          await key('r', 'KeyR', 82, 0, 'r');
          assert.strictEqual(await evalJs(`document.getElementById('tool-rect').classList.contains('active')`), true, tag + ': after closing, R switches to Rect again');
          await key('Escape', 'Escape', 27); await selectLine(c);
          await key('Delete', 'Delete', 46);
          assert.strictEqual(await lines(c), before - 1, tag + ': after closing, Delete removes the selected line');
          await key('z', 'KeyZ', 90, 2);
          assert.strictEqual(await lines(c), before, tag + ': after closing, Ctrl+Z brings it back');
          console.log(`A ok: ${tag}`);
        }
      }
    }

    // ---- B: SketchStudio, desktop ----
    await setSize(SIZES[0]); await open('sketchstudio');
    await evalJs(`document.querySelector('.sk-account').click()`); await sleep(300);
    await key('Tab', 'Tab', 9);
    const where = () => evalJs(`(() => { const a = document.activeElement; return { el: a && a.dataset.account || (a && (a.id || a.tagName)), inMenu: document.querySelector('.sk-account-menu').contains(a) }; })()`);
    assert.deepStrictEqual(await where(), { el: 'sign-out', inMenu: true }, 'B: after one Tab the focus is on Sign out');
    // two sync status changes: a settings change, then wait for its saving + saved
    for (let i = 1; i <= 2; i++) {
      await evalJs(`window.__t783 = 0; import('/packages/ui/cloud/settings-sync.js').then((m) => { window.__t783off = m.onSettingsSyncStatus(() => { window.__t783++; }); });`);
      await evalJs(`import('/packages/core/settings-manager.js').then((m) => { m.default.set('SHOW_GRID', !m.default.get('SHOW_GRID'), { persist: 'local' }); return true; })`);
      await waitFor(`window.__t783 >= 2`, `sync status change ${i} (saving, saved)`, 12000);
      await evalJs(`window.__t783off()`); await sleep(200);
      assert.deepStrictEqual(await where(), { el: 'sign-out', inMenu: true }, `B: after status change ${i} the focus is still on Sign out`);
    }
    await key('Escape', 'Escape', 27);
    // a running check keeps its state through a redraw: a second avatar whose check waits for us (the real one finishes in a blink)
    await evalJs(`import('/packages/ui/account-avatar.js').then((m) => {
      const ada = { name: 'Ada', email: 'a@example.com', picture: '', initials: 'AL' };
      window.__t783steps = (state) => [{ id: 's1', label: 'Step one', state }, { id: 's2', label: 'Step two', state: 'pending' }];
      const a = m.createAccountAvatar({ account: { state: () => ({ signedIn: true }), subscribe: () => () => {}, userInfo: async () => ada, signIn: async () => {}, signOut: async () => {} },
        check: (onStep) => new Promise((res) => { onStep(window.__t783steps('running')); window.__t783done = () => { onStep(window.__t783steps('ok')); res(); }; }) });
      document.body.append(a.el); window.__t783avatar = a; return true; })`);
    await evalJs(`window.__t783avatar.open()`); await sleep(200);
    await evalJs(`(() => { const b = window.__t783avatar.menu.querySelector('[data-account="check-drive"]'); b.focus(); b.click(); })()`); await sleep(200);
    const checkState = () => evalJs(`(() => { const m = window.__t783avatar.menu; const b = m.querySelector('[data-account="check-drive"]'), l = m.querySelector('[data-account="check-result"]');
      return { disabled: b.disabled, listShown: !l.hidden, steps: [...l.querySelectorAll('li')].map((li) => li.dataset.state), inMenu: m.contains(document.activeElement) }; })()`);
    assert.deepStrictEqual(await checkState(), { disabled: true, listShown: true, steps: ['running', 'pending'], inMenu: true }, 'B: the check is running');
    await evalJs(`window.__t783avatar.refresh()`); await sleep(200); // the redraw a status change causes
    assert.deepStrictEqual(await checkState(), { disabled: true, listShown: true, steps: ['running', 'pending'], inMenu: true }, 'B: after a redraw the check is still running (button disabled, steps kept, the focus kept in the menu)');
    await evalJs(`window.__t783done()`); await sleep(200);
    assert.deepStrictEqual(await checkState(), { disabled: false, listShown: true, steps: ['ok', 'pending'], inMenu: true }, 'B: the check ended: the NEW list got the result, the button is enabled again');
    await shot('account-menu-check-783.png');
    console.log('B ok: focus kept through two sync status changes; a running check survives a redraw');
    console.log('overlay-keys-783-live: ok');
  } finally {
    try { await cdp.close(); } catch (e) { console.error('close: ' + e.message); }
  }
})();
