// tests/account-avatar-776-live.test.js — TASK 776: THE account avatar (packages/ui/account-avatar.js) in the real pages, FAKE Google only (tests/helpers/fake-drive-session.js: a fake
// Drive + a fake Google sign-in; every non-local request is blocked, tests/helpers/block-remote.js; the fake profile picture URL is an example.invalid address, so the <img> fails
// and the initials show: that fallback is tested here too).
//  A. all four apps (SketchStudio, Shaper, Pen Plotter, Trace), signed in, desktop 1440: ONE avatar at the far right of the footer (after Save), initials "AL" (the picture failed),
//     name as aria-label / tooltip, the email NOT in the footer, no account row in the drawer; a real click opens the menu UPWARD from the footer, inside the screen: picture slot,
//     name, email, the purpose line, the status lines, "Check Google Drive connection", "Sign out"; Esc closes it and returns the focus; a press outside closes it. The <img> (when one
//     is tried) has referrerpolicy="no-referrer".
//  B. phone 390 (touch) and phone landscape 844 x 390 (touch): the same avatar in the footer, a tap opens the menu inside the screen, rows 44 px high.
//  C. SketchStudio + Shaper in depth: Sign out in the menu runs the account's signOut (auth state: signedIn false, token gone; avatar = the neutral icon, tooltip "Sign in"); the signed-out
//     menu has the one line and "Sign in with Google"; it runs the account's signIn (state signedIn true again, the avatar shows the initials); the Drive connection check lists its steps in
//     the menu; a token that cannot be renewed (a lapse) shows "Reconnect" (and the amber dot), and it runs signIn again.
//  D. Shaper in Fusion mode (?host=fusion): no avatar, no menu.
// Screenshots (zoomed) to EVIDENCE_DIR (default .evidence/776).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { blockRemote } from './helpers/block-remote.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const EVID = path.resolve(process.env.EVIDENCE_DIR || '.evidence/776');
fs.mkdirSync(EVID, { recursive: true });
const APPS = [
  { id: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: 'svgCanvas' },
  { id: 'shaper', url: '/apps/shaper/index.html', canvas: 'design-canvas' },
  { id: 'penplotter', url: '/apps/penplotter/index.html', ready: `!!document.querySelector('.sk-doctab')` },
  { id: 'trace', url: '/apps/trace/index.html', ready: `!!document.querySelector('.sk-doctab')` },
];
const DESKTOP = { name: 'desktop-1440', w: 1440, h: 900, touch: false };
const PHONE = { name: 'phone-390', w: 390, h: 844, touch: true };
const LAND = { name: 'landscape-844x390', w: 844, h: 390, touch: true };
const STATE = `import('/packages/ui/cloud/google-account.js').then((m) => { const s = m.getGoogleAccount().state(); return { signedIn: s.signedIn, lapsed: s.lapsed, token: localStorage.getItem('sk_cloud_token') }; })`;

await (async () => {
  const cdp = await launchBrowser({ tag: '776a', width: 1440, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate, waitForApp } = cdp;
  const t0 = Date.now();
  const setSize = async (s) => {
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: s.touch, screenOrientation: s.w > s.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await send('Emulation.setTouchEmulationEnabled', { enabled: s.touch, maxTouchPoints: s.touch ? 5 : 0 });
    await sleep(200);
  };
  const shot = async (name, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } }); fs.writeFileSync(path.join(EVID, name), Buffer.from(r.data, 'base64')); };
  const centre = (sel) => evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const press = async (sel, touch = false) => {
    const c = await centre(sel);
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 0, radiusX: 2, radiusY: 2, force: 1 }] }); await sleep(40);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none', clickCount: 0 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(20);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
    }
  };
  const pressIn = async (sel) => { await evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`); await sleep(60); await press(sel); }; // a long menu (the check's steps) scrolls inside the screen
  const key = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); await sleep(120); };
  // a clip around the open menu and the avatar under it (the page may be taller / wider than the footer: SketchStudio's layout needs the tailwind CDN, which a test blocks)
  const menuClip = () => evalJs(`(() => { const m = document.querySelector('.sk-account-menu').getBoundingClientRect(), a = document.querySelector('.sk-account').getBoundingClientRect();
    const l = Math.max(0, Math.min(m.left, a.left) - 12), t = Math.max(0, m.top - 12), r = Math.min(innerWidth, Math.max(m.right, a.right) + 12), b = Math.min(innerHeight, a.bottom + 12); return { x: l, y: t, width: r - l, height: b - t }; })()`);
  const footerClip = () => evalJs(`(() => { const a = document.querySelector('.sk-account').getBoundingClientRect(), f = document.querySelector('.sk-account').closest('.sk-footer, .sk-statusbar').getBoundingClientRect();
    const r = Math.min(innerWidth, a.right + 8), l = Math.max(0, r - 460); return { x: l, y: Math.max(0, f.top - 4), width: r - l, height: Math.min(innerHeight - Math.max(0, f.top - 4), f.height + 8) }; })()`);
  const menuOpen = () => evalJs(`!document.querySelector('.sk-account-menu').hidden`);
  const menuBox = () => evalJs(`(() => { const m = document.querySelector('.sk-account-menu'), a = document.querySelector('.sk-account'), mr = m.getBoundingClientRect(), ar = a.getBoundingClientRect();
    const rows = [...m.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height));
    return { top: mr.top, bottom: mr.bottom, left: mr.left, right: mr.right, aTop: ar.top, vw: innerWidth, vh: innerHeight, rows, text: m.innerText }; })()`);
  const loadApp = async (app) => {
    await navigate(`http://127.0.0.1:${port}${app.url}`, 15000);
    if (app.canvas) await waitForApp(app.canvas); else await waitFor(app.ready, app.id + ' ready', 15000);
    await waitFor(`!!document.querySelector('.sk-footer-end > .sk-account')`, app.id + ': the avatar in the footer', 15000);
  };
  try {
    await blockRemote(cdp);
    const session = await installFakeDriveSession(cdp, { signedIn: true });
    await resetBufferLive(cdp);

    // ---- A. every app, desktop, signed in
    await setSize(DESKTOP);
    for (const app of APPS) {
      await loadApp(app);
      await waitFor(`document.querySelector('.sk-account .sk-account-circle').textContent.trim() === 'AL'`, app.id + ': the initials (the example.invalid picture cannot load)', 8000);
      const a = await evalJs(`(() => { const e = document.querySelector('.sk-account'), end = e.parentNode, f = end.closest('.sk-footer, .sk-statusbar');
        return { n: document.querySelectorAll('.sk-account').length, last: end.lastElementChild === e, afterSave: e.previousElementSibling.classList.contains('sk-save'), label: e.getAttribute('aria-label'), title: e.title,
          circle: e.querySelector('.sk-account-circle').getBoundingClientRect().width, footerText: f.textContent, header: document.querySelectorAll('header .sk-account, .sk-doctabs .sk-account').length,
          drawer: document.querySelectorAll('.sk-sidebar [data-section="account"], .sk-sidebar-account').length, imgs: [...document.querySelectorAll('.sk-account img')].map((i) => i.referrerPolicy) }; })()`);
      assert.deepStrictEqual([a.n, a.last, a.afterSave, a.label, a.title, a.header, a.drawer], [1, true, true, 'Account: Ada Lovelace', 'Ada Lovelace', 0, 0], app.id + ': ONE avatar, last in the footer after Save, the name as label, none in the header / the drawer ' + JSON.stringify(a));
      assert.ok(a.circle >= 24 && a.circle <= 36, app.id + ': circle size ' + a.circle);
      assert.ok(!/ada@example\.com/.test(a.footerText), app.id + ': the email is not in the footer itself');
      assert.ok(a.imgs.every((p) => p === 'no-referrer'), app.id + ': the picture <img> has referrerpolicy=no-referrer ' + JSON.stringify(a.imgs));
      assert.strictEqual(await menuOpen(), false, app.id + ': the menu is closed at first');
      await press('.sk-account');
      assert.strictEqual(await menuOpen(), true, app.id + ': a click opens the menu');
      const mb = await menuBox();
      assert.ok(mb.bottom <= mb.aTop + 0.5 && mb.top >= 0 && mb.left >= 0 && mb.right <= mb.vw + 0.5, app.id + ': the menu opens UPWARD from the footer, inside the screen ' + JSON.stringify(mb));
      for (const t of ['Ada Lovelace', 'ada@example.com', 'Saves your designs and settings to your Google Drive.', 'Connected to Google Drive', 'Check Google Drive connection', 'Sign out']) assert.ok(mb.text.includes(t), app.id + ': the menu says "' + t + '": ' + mb.text);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-account').getAttribute('aria-expanded')`), 'true');
      if (app.id === 'sketchstudio' || app.id === 'shaper') await shot(`menu-signed-in-${app.id}-desktop.png`, await menuClip());
      await key('Escape', 'Escape', 27);
      assert.strictEqual(await menuOpen(), false, app.id + ': Esc closes the menu');
      assert.strictEqual(await evalJs(`document.activeElement === document.querySelector('.sk-account')`), true, app.id + ': the focus returns to the avatar');
      await press('.sk-account'); assert.strictEqual(await menuOpen(), true);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1300, y: 22, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1300, y: 22, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150); // an empty place of the header
      assert.strictEqual(await menuOpen(), false, app.id + ': a press outside closes the menu');
      if (app.id === 'shaper') await shot('footer-desktop-shaper.png', await footerClip());
      console.log(`${app.id}: avatar + menu (desktop)`);
    }

    // ---- B. phone 390 and phone landscape, every app: a tap opens the menu inside the screen with 44 px rows
    for (const L of [PHONE, LAND]) {
      await setSize(L);
      for (const app of APPS) {
        await loadApp(app);
        await press('.sk-account', true);
        assert.strictEqual(await menuOpen(), true, `${app.id} ${L.name}: a tap opens the menu`);
        const mb = await menuBox();
        assert.ok(mb.bottom <= mb.aTop + 0.5 && mb.top >= 0 && mb.left >= 0 && mb.right <= mb.vw + 0.5, `${app.id} ${L.name}: the menu is inside the screen, above the footer ` + JSON.stringify(mb));
        assert.ok(mb.rows.every((h) => h >= 43.5), `${app.id} ${L.name}: 44 px rows ` + JSON.stringify(mb.rows));
        assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-account').length`), 1, `${app.id} ${L.name}: ONE account UI`);
        if (app.id === 'sketchstudio' || app.id === 'shaper') await shot(`menu-signed-in-${app.id}-${L.name}.png`, await menuClip());
        if (app.id === 'shaper') await shot(`footer-shaper-${L.name}.png`, await footerClip());
        await key('Escape', 'Escape', 27);
      }
      console.log(`all four apps: avatar + menu (${L.name})`);
    }

    // ---- C. SketchStudio and Shaper in depth (desktop): Sign out / Sign in / check / lapse run the account's own functions
    await setSize(DESKTOP);
    for (const app of [APPS[0], APPS[1]]) {
      await loadApp(app);
      assert.deepStrictEqual((await evalJs(STATE)).signedIn, true, app.id + ': signed in (fake session)');
      await press('.sk-account');
      // the Drive connection check: its steps are listed in the menu
      await pressIn('[data-account="check-drive"]');
      await waitFor(`document.querySelectorAll('[data-account="check-result"] li[data-state="ok"]').length === 5`, app.id + ': the check lists its 5 steps', 8000);
      // Sign out: the account's signOut ran
      await pressIn('[data-account="sign-out"]');
      await waitFor(`document.querySelector('.sk-account').dataset.state === 'signed-out'`, app.id + ': the avatar follows the sign-out', 5000);
      const out = await evalJs(STATE);
      assert.deepStrictEqual([out.signedIn, out.token], [false, null], app.id + ': Sign out ran the account signOut (the stored token is gone)');
      assert.strictEqual(await menuOpen(), false, app.id + ': the menu closes on Sign out');
      assert.deepStrictEqual(await evalJs(`(() => { const a = document.querySelector('.sk-account'); return [a.title, a.getAttribute('aria-label'), !!a.querySelector('svg'), a.querySelector('.sk-account-circle').textContent.trim()]; })()`), ['Sign in', 'Sign in', true, ''], app.id + ': signed out = the neutral icon, tooltip Sign in');
      await press('.sk-account');
      const so = await menuBox();
      assert.ok(so.text.includes('Sign in to save designs and settings to your Google Drive. Everything also works without an account.') && so.text.includes('Sign in with Google') && !so.text.includes('ada@example.com'), app.id + ': the signed-out menu ' + so.text);
      assert.strictEqual(await evalJs(`document.querySelectorAll('[data-account="sign-in"]').length`), 1, app.id + ': ONE sign-in button');
      if (app.id === 'sketchstudio') await shot('menu-signed-out-sketchstudio-desktop.png', await menuClip());
      // Sign in: the account's signIn ran (the fake Google grants a token)
      await pressIn('[data-account="sign-in"]');
      await waitFor(`document.querySelector('.sk-account').dataset.state === 'signed-in'`, app.id + ': the avatar follows the sign-in', 8000);
      assert.deepStrictEqual((await evalJs(STATE)).signedIn, true, app.id + ': Sign in ran the account signIn');
      await waitFor(`document.querySelector('.sk-account .sk-account-circle').textContent.trim() === 'AL'`, app.id + ': the name is back', 8000);
      // a lapse: the stored token is past its expiry and Google refuses the renewal (the fake GIS answers "popup closed"): "Reconnect", never "signed out"
      await evalJs(`localStorage.setItem('sk_cloud_token_expiry', String(Date.now() - 1000)); localStorage.setItem('__skFakeDriveCancelSignIn', '1')`);
      await navigate(`http://127.0.0.1:${port}${app.url}`, 15000);
      if (app.canvas) await waitForApp(app.canvas);
      await waitFor(`!!document.querySelector('.sk-account')`, 'the avatar after the reload', 10000);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1300, y: 22, button: 'left', buttons: 1, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1300, y: 22, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300); // any real press is the gesture the renewal waits for
      await waitFor(`document.querySelector('.sk-account').dataset.state === 'lapsed'`, app.id + ': a refused renewal shows the lapsed state', 8000);
      const lap = await evalJs(`(() => { const a = document.querySelector('.sk-account'); return [a.title, getComputedStyle(a.querySelector('.sk-account-dot')).display]; })()`);
      assert.deepStrictEqual(lap, ['Reconnect Google account', 'block'], app.id + ': the lapsed avatar: tooltip + the amber dot');
      if (!(await menuOpen())) await press('.sk-account');
      const lm = await menuBox();
      assert.ok(lm.text.includes('Reconnect') && lm.text.includes('Google Drive: reconnect needed') && !lm.text.includes('Sign out'), app.id + ': the lapsed menu: Reconnect + the Drive line ' + lm.text);
      if (app.id === 'shaper') await shot('menu-lapsed-shaper-desktop.png', await menuClip());
      await evalJs(`localStorage.removeItem('__skFakeDriveCancelSignIn')`);
      await pressIn('[data-account="reconnect"]');
      await waitFor(`document.querySelector('.sk-account').dataset.state === 'signed-in'`, app.id + ': Reconnect ran the account signIn', 8000);
      console.log(`${app.id}: sign out / sign in / check / lapse + reconnect through the menu`);
    }

    // ---- D. Shaper in Fusion mode: no project layer, no sign-in: no avatar
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.adsk = window.adsk || { fusionSendData() {} };` });
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`, 15000);
    await waitFor(`!!document.querySelector('.sk-header-tab')`, 'Shaper in Fusion mode', 15000); await sleep(600);
    assert.deepStrictEqual(await evalJs(`[document.querySelectorAll('.sk-account').length, document.querySelectorAll('.sk-account-menu').length, document.querySelectorAll('.sk-save').length]`), [0, 0, 0], 'Fusion mode: no avatar, no menu, no Save');
    await shot('footer-shaper-fusion-mode.png', { x: 900, y: 856, width: 540, height: 44 });
    console.log(`account-avatar-776-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } finally {
    await cdp.close();
  }
})();
