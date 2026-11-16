// tests/toast-footer-695-live.test.js — TASK 695: live CDP verification that stacked toasts never cover footer buttons or ribbon/dropdowns across desktop, phone portrait, and phone landscape in SketchStudio & Pen Plotter.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.resolve('.evidence/695');
fs.mkdirSync(EVID, { recursive: true });
const PREFIX = process.env.EVID_PREFIX || 'after';

const VIEWPORTS = [
  { name: 'phone-390x844', w: 390, h: 844, touch: true },
  { name: 'landscape-844x390', w: 844, h: 390, touch: true },
  { name: 'desktop-1280x800', w: 1280, h: 800, touch: false },
];

const HOSTS = [
  { id: 'sketchstudio', canvas: 'svgCanvas', url: (p) => `http://127.0.0.1:${p}/apps/sketchstudio/index.html`, enterDesign: async () => {} },
  {
    id: 'penplotter',
    canvas: 'design-canvas',
    url: (p) => `http://127.0.0.1:${p}/apps/penplotter/index.html`,
    enterDesign: async ({ evalJs, waitFor }) => {
      await waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'Pen Plotter design stage tab');
      await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`);
    },
  },
];

const cdp = await launchBrowser({ tag: '695-toast-footer', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }

const { port, send, evalJs, waitFor, waitForApp, navigate, close } = cdp;
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

try {
  for (const host of HOSTS) {
    for (const vp of VIEWPORTS) {
      await resetBufferLive(cdp);
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: vp.touch ? 2 : 1,
        mobile: vp.touch,
        ...(vp.touch ? { screenOrientation: vp.w > vp.h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } } : {}),
      });
      await send('Emulation.setTouchEmulationEnabled', { enabled: vp.touch, maxTouchPoints: vp.touch ? 5 : 1 });
      await navigate(host.url(port), 10000);
      await host.enterDesign({ evalJs, waitFor });
      await waitForApp(host.canvas);
      await waitFor(`!!document.querySelector('.sk-footer, .sk-statusbar')`, `${host.id} footer present`);
      await sleep(300);

      // Clear any pre-existing toasts and trigger 1, 2, 3 toasts
      await evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; })()`);
      for (const n of [1, 2, 3]) {
        await evalJs(`window.ug.notify('Fillet notice #${n}: could not apply R 5.0 mm to selected corner', 'warning', 12000)`);
        await sleep(80);
      }
      await sleep(350); // allow animation frame / transition settle

      const m = await evalJs(`(() => {
        const footer = document.querySelector('.sk-footer, .sk-statusbar');
        const fr = footer.getBoundingClientRect();
        const btns = [...footer.querySelectorAll('button')].filter((b) => !b.hidden && b.getBoundingClientRect().width > 0).map((b) => {
          const r = b.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
          const hit = document.elementFromPoint(cx, cy);
          return {
            id: b.id || b.getAttribute('aria-label'),
            rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) },
            hitTag: hit ? hit.tagName + (hit.id ? '#' + hit.id : '') : null,
            reachesBtn: !!(hit && (hit === b || b.contains(hit))),
          };
        });
        const toasts = [...document.querySelectorAll('#notification-container > div')].map((t, i) => {
          const r = t.getBoundingClientRect();
          return { idx: i, text: t.textContent.trim(), rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } };
        });
        const rib = document.querySelector('.sk-ribbon');
        const rr = rib ? rib.getBoundingClientRect() : null;
        return {
          footerRect: { left: Math.round(fr.left), top: Math.round(fr.top), right: Math.round(fr.right), bottom: Math.round(fr.bottom) },
          ribbonRect: rr ? { left: Math.round(rr.left), top: Math.round(rr.top), right: Math.round(rr.right), bottom: Math.round(rr.bottom) } : null,
          btns,
          toasts,
        };
      })()`);

      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(EVID, `${PREFIX}-${host.id}-${vp.name}.png`), Buffer.from(data, 'base64'));

      console.log(`[${PREFIX}] ${host.id} ${vp.name}: footer=${JSON.stringify(m.footerRect)} toasts=${JSON.stringify(m.toasts)} btns=${JSON.stringify(m.btns.map((b) => ({ id: b.id, top: b.rect.top, reaches: b.reachesBtn, hit: b.hitTag })))}`);

      // Assert no toast overlaps footer rect or any footer button, and every footer button's center hits the button
      assert(m.toasts.length >= 1, `${host.id} ${vp.name}: at least 1 toast shown`);
      for (const t of m.toasts) {
        assert(!overlaps(t.rect, m.footerRect), `${host.id} ${vp.name}: toast #${t.idx} (${JSON.stringify(t.rect)}) overlaps footer (${JSON.stringify(m.footerRect)})`);
        for (const b of m.btns) {
          assert(!overlaps(t.rect, b.rect), `${host.id} ${vp.name}: toast #${t.idx} overlaps button ${b.id} (${JSON.stringify(b.rect)})`);
        }
        if (m.ribbonRect && m.ribbonRect.bottom <= vp.h * 0.5) {
          assert(!overlaps(t.rect, m.ribbonRect), `${host.id} ${vp.name}: toast #${t.idx} overlaps top ribbon (${JSON.stringify(m.ribbonRect)})`);
        }
      }
      for (const b of m.btns) {
        assert.strictEqual(b.reachesBtn, true, `${host.id} ${vp.name}: center of ${b.id} blocked by ${b.hitTag}`);
      }

      // Real pointer tap / click on visible Parameters or Recenter footer button while 3 toasts are visible
      const targetBtn = m.btns.find((b) => b.id === 'btn-parameters') || m.btns.find((b) => b.id === 'btn-recenter-view') || m.btns[0];
      const bx = (targetBtn.rect.left + targetBtn.rect.right) / 2;
      const by = (targetBtn.rect.top + targetBtn.rect.bottom) / 2;
      if (targetBtn.id === 'btn-parameters') {
        if (vp.touch) {
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx, y: by, id: 1, radiusX: 1, radiusY: 1, force: 1 }] });
          await sleep(50);
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bx, y: by, button: 'left', buttons: 1, clickCount: 1 });
          await sleep(40);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bx, y: by, button: 'left', buttons: 0, clickCount: 1 });
        }
        await waitFor(`document.getElementById('btn-parameters')?.getAttribute('aria-expanded') === 'true'`, `${host.id} ${vp.name}: tap on Parameters footer button reaches it`);
      }

      // Extra check on phone portrait: open Modify ribbon dropdown and trigger 4 toasts -> none overlap open dropdown
      if (vp.name === 'phone-390x844') {
        if (targetBtn.id === 'btn-parameters') await evalJs(`document.getElementById('btn-parameters').click()`);
        await evalJs(`document.querySelector('.sk-ribbon-group[data-section="modify"] .sk-ribbon-group-label')?.click()`);
        await waitFor(`!!document.querySelector('.sk-ribbon-menu.show, .sk-ribbon-sect-menu.show')`, `${host.id} dropdown opened`);
        await evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; })()`);
        for (const n of [1, 2, 3, 4]) {
          await evalJs(`window.ug.notify('Drop check #${n}: stack should stay below open dropdown', 'info', 12000)`);
        }
        await sleep(300);
        const dropCheck = await evalJs(`(() => {
          const drop = document.querySelector('.sk-ribbon-menu.show, .sk-ribbon-sect-menu.show');
          const dr = drop ? drop.getBoundingClientRect() : null;
          const toasts = [...document.querySelectorAll('#notification-container > div')].map((t) => {
            const r = t.getBoundingClientRect();
            return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
          });
          return { dropRect: dr ? { left: Math.round(dr.left), top: Math.round(dr.top), right: Math.round(dr.right), bottom: Math.round(dr.bottom) } : null, toasts };
        })()`);
        if (dropCheck.dropRect) {
          for (const t of dropCheck.toasts) {
            assert(!overlaps(t, dropCheck.dropRect), `${host.id} ${vp.name}: toast (${JSON.stringify(t)}) overlaps open dropdown (${JSON.stringify(dropCheck.dropRect)})`);
          }
        }
      }

      // Flood 8 toasts on short landscape viewport -> oldest trimmed so stack stays below header/tabs and above footer
      if (vp.name === 'landscape-844x390') {
        await evalJs(`(() => { const c = document.getElementById('notification-container'); if (c) c.innerHTML = ''; })()`);
        for (let n = 1; n <= 8; n++) {
          await evalJs(`window.ug.notify('Flood #${n}: stack overflow check', 'info', 12000)`);
        }
        await sleep(300);
        const flood = await evalJs(`(() => {
          const ts = [...document.querySelectorAll('#notification-container > div')];
          const hdr = [...document.querySelectorAll('.sk-header, .sk-doctabs')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0);
          const minY = hdr.length ? Math.max(...hdr.map((r) => r.bottom)) : 0;
          const fr = document.querySelector('.sk-footer, .sk-statusbar').getBoundingClientRect();
          return {
            count: ts.length,
            texts: ts.map((t) => t.textContent.trim()),
            top: Math.min(...ts.map((t) => Math.round(t.getBoundingClientRect().top))),
            bottom: Math.max(...ts.map((t) => Math.round(t.getBoundingClientRect().bottom))),
            minY: Math.round(minY),
            footerTop: Math.round(fr.top),
          };
        })()`);
        assert(flood.count >= 1 && flood.count < 8, `${host.id} landscape: oldest toasts dropped (count=${flood.count})`);
        assert(flood.texts.some((t) => t.includes('Flood #8')), `${host.id} landscape: newest toast (#8) kept (${JSON.stringify(flood.texts)})`);
        assert(flood.top >= flood.minY && flood.bottom <= flood.footerTop, `${host.id} landscape: trimmed stack [${flood.top}, ${flood.bottom}] inside [${flood.minY}, ${flood.footerTop}]`);
      }
    }
  }
  console.log('toast-footer-695-live: ALL CHECKS PASSED');
} finally {
  await close();
}
