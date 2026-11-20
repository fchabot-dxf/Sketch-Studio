// tests/footer-settings-726-live.test.js: TASK 726 (live headless, REAL mouse / touch): the footer's Settings (gear) button in all four hosts, desktop 1280 and phone 390.
// It is the footer's far-right button (after Recenter), fits inside the screen with the other footer buttons (44 px high on touch), a real click / tap opens the shared
// Style panel (.sk-style-panel), aria-pressed follows it, a second press closes it. The header gets no extra button (TASK 619). SketchStudio / Shaper: the drawer's
// Style / Settings item toggles the very same panel element. Screenshots: .evidence/726.
import { FOOTER_PHONE_MIN_W } from '../packages/ui/footer-slot.js'; // TASK 776: THE phone footer width floor
import assert from 'node:assert';
import { resetBufferLive } from './helpers/reset-buffer.js';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '726');

await (async () => {
  const cdp = await launchBrowser({ tag: '726', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor } = cdp;
  try {
    fs.mkdirSync(EVID, { recursive: true });
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1); await sleep(30); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (x, y) => { await T('touchStart', [{ x, y }]); await sleep(40); await T('touchEnd', []); await sleep(400); };
    const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
    let lastApp = null; // TASK 684: the open tabs are ONE list for all apps: a new host starts from an empty Untitled, not the previous host's drawing
    const goto = async (url, readyExpr) => { const app = url.split('/')[2]; if (lastApp && lastApp !== app) await resetBufferLive(cdp); lastApp = app; const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([loaded, sleep(8000)]); await waitFor(readyExpr, url + ' ready'); await sleep(600); };
    const shot = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); fs.writeFileSync(path.join(EVID, file), Buffer.from(r.data, 'base64')); };
    const HOSTS = {
      studio:     { url: '/apps/sketchstudio/index.html', enter: null, ready: `!!document.querySelector('#svgCanvas')`, canvas: '#svgCanvas' },
      shaper:     { url: '/apps/shaper/index.html', enter: '.sk-header-tab[data-tab="design"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: '#design-canvas' },
      penplotter: { url: '/apps/penplotter/index.html', enter: '.sk-header-tab[data-tab="design"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="design"]')`, canvas: '#design-canvas' },
      trace:      { url: '/apps/trace/index.html', enter: '.sk-header-tab[data-tab="edit"]', ready: `!!document.querySelector('.sk-header-tab[data-tab="edit"]')`, canvas: '#design-canvas' },
    };
    const open = async (name) => {
      const h = HOSTS[name]; await goto(h.url, h.ready);
      if (h.enter) { await evalJs(`document.querySelector(${JSON.stringify(h.enter)}).click()`); await sleep(800); }
      await waitFor(`!!document.querySelector('${h.canvas}') && document.querySelector('${h.canvas}').getBoundingClientRect().width > 100`, name + ' canvas'); await sleep(300);
      return h;
    };

    const panelOpen = () => evalJs(`(() => { const p = document.querySelector('.sk-style-panel'); return !!p && !p.classList.contains('sk-hidden'); })()`);
    const gear = () => evalJs(`(() => { const b = document.getElementById('btn-settings'); if (!b) return null; const r = b.getBoundingClientRect(), f = b.closest('footer').getBoundingClientRect(), rc = document.getElementById('btn-recenter-view').getBoundingClientRect();
      const all = [...b.closest('footer').querySelectorAll('button')].filter((x) => !x.hidden && x.getBoundingClientRect().width > 0).map((x) => x.getBoundingClientRect());
      return { inFooter: true, pressed: b.getAttribute('aria-pressed'), title: b.title, aria: b.getAttribute('aria-label'), w: r.width, h: r.height, left: r.left, right: r.right, recRight: rc.right, vw: innerWidth, fRight: f.right, pageSW: document.documentElement.scrollWidth, maxRight: Math.max(...all.map((x) => x.right)), minLeft: Math.min(...all.map((x) => x.left)), overlap: all.some((a, i) => all.some((c, j) => j > i && a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom && c.top < a.bottom)), headerBtn: !!document.querySelector('header #btn-settings') }; })()`);
    const drawerItem = (name) => name === 'studio' ? 'style' : name === 'shaper' ? 'settings' : null;
    const run = async (tag, press, shotTag) => {
      for (const name of Object.keys(HOSTS)) {
        await open(name);
        const g = await gear();
        assert(g, name + ': the Settings button exists');
        assert.strictEqual(g.title, 'Settings'); assert.strictEqual(g.aria, 'Settings'); assert(!g.headerBtn, name + ': not in the header');
        assert(g.left > g.recRight - 0.5, name + ': after Recenter ' + JSON.stringify([g.left, g.recRight]));
        assert(g.right <= g.vw + 0.5 && g.minLeft >= -0.5 && g.pageSW <= g.vw + 0.5, `${tag} ${name}: fits on screen ` + JSON.stringify(g));
        // TASK 776: the gear is no longer the very last button: THE Save button and the account avatar follow it, the avatar at the footer's far right
        const tail = await evalJs(`(() => { const b = document.getElementById('btn-settings'), f = b.closest('footer').getBoundingClientRect(), s = b.nextElementSibling, a = s && s.nextElementSibling; return { save: !!s && s.classList.contains('sk-save'), avatar: !!a && a.classList.contains('sk-account') && a.nextElementSibling === null, aRight: a ? a.getBoundingClientRect().right : 0, fRight: f.right }; })()`);
        assert(tail.save && tail.avatar && tail.aRight >= tail.fRight - 20, `${tag} ${name}: the gear is followed by Save and the account avatar, at the footer's right end ` + JSON.stringify(tail));
        assert(!g.overlap, `${tag} ${name}: no footer buttons overlap`);
        assert(g.h >= (tag === 'phone390' ? 44 : 30) - 0.5 && g.w >= (tag === 'phone390' ? FOOTER_PHONE_MIN_W : 30) - 0.5, `${tag} ${name}: target size ` + [g.w, g.h]);
        assert.strictEqual(await panelOpen(), false); assert.strictEqual(g.pressed, 'false');
        await press('#btn-settings'); assert.strictEqual(await panelOpen(), true, `${tag} ${name}: press opens the Style panel`);
        assert.strictEqual((await gear()).pressed, 'true', 'pressed while open');
        await shot(`${tag}-${name}-open.png`);
        await press('#btn-settings'); assert.strictEqual(await panelOpen(), false, `${tag} ${name}: second press closes it`);
        assert.strictEqual((await gear()).pressed, 'false');
        await press('#btn-settings'); assert.strictEqual(await panelOpen(), true, 'reopens');
        await press('#btn-settings'); assert.strictEqual(await panelOpen(), false);
        // the drawer's own item toggles the same single panel element
        const act = drawerItem(name);
        if (act) {
          await evalJs(`document.querySelector('.sk-sidebar-btn') ? document.querySelector('.sk-sidebar-btn').click() : document.querySelector('.sk-sidebar-chevron').click()`); await sleep(300);
          assert.strictEqual(await evalJs(`document.querySelector('.sk-sidebar-item[data-action="${act}"]').textContent.trim()`), 'Settings', 'the drawer item reads Settings (TASK 726)'); await shot(`${tag}-${name}-drawer.png`);
          await evalJs(`document.querySelector('.sk-sidebar-item[data-action="${act}"]').click()`); await sleep(300);
          assert.strictEqual(await panelOpen(), true, `${tag} ${name}: the drawer item still opens the panel`);
          assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-style-panel').length`), 1, 'one panel element');
          assert.strictEqual((await gear()).pressed, 'true', 'gear pressed when the drawer opened it');
          assert.strictEqual(await evalJs(`document.querySelector('.sk-style-title').textContent`), 'Settings', 'the panel title reads Settings (TASK 726)'); await shot(`${tag}-${name}-drawer-opened.png`);
          await press('#btn-settings'); assert.strictEqual(await panelOpen(), false, 'gear closes the drawer-opened panel');
        }
        console.log(tag, name, 'ok', JSON.stringify([g.w, g.h, Math.round(g.right), g.vw]));
      }
    };
    await run('desktop', clickEl);
    const L = { w: 390, h: 844 };
    await send('Emulation.setDeviceMetricsOverride', { width: L.w, height: L.h, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await run('phone390', async (sel) => { const c = await centerOf(sel); await tap(c.x, c.y); });
    // Shaper Fusion mode keeps the footer: the gear is there too
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await goto('/apps/shaper/index.html?host=fusion', `!!document.querySelector('.sk-header-tab')`);
    assert(await gear(), 'fusion mode: the footer gear exists');
    await clickEl('#btn-settings'); assert.strictEqual(await panelOpen(), true, 'fusion: opens'); await clickEl('#btn-settings'); assert.strictEqual(await panelOpen(), false);
    console.log('footer-settings-726-live: ok');
  } finally { await cdp.close(); }
})();
