// tests/helpers/rect-menu.js — TASK 607: the ribbon's Rect variants menu (two-point / centre / 3-point) works in EVERY layout of the shared Design tab and
// every host (SketchStudio, Shaper, Pen Plotter, Trace). The ribbon is a scroll box that clips its children, so the menu is a popover on document.body
// placed from the button's rect. Per layout (desktop mouse 1440 x 900, phone portrait touch 390 x 844, phone landscape rail touch 844 x 390) and host:
//  - a real click / tap on the Rect button opens the menu; each of the 3 items is visible, inside the viewport, is the element at its own centre
//    (elementFromPoint) and (touch) is >= 44 px tall;
//  - a real click / tap on each item picks that rect mode (the item is .active, the menu closes, rect is the active tool);
//  - Esc closes it; a click / tap outside closes it; scrolling the ribbon closes it; resizing the window closes it.
// RECT_MENU_EVIDENCE=<dir> saves a screenshot of the open menu per layout and host (before / after evidence).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './cdp-browser.js';
import { LANDSCAPE_HOSTS } from './phone-landscape.js';

export const RECT_MENU_LAYOUTS = {
  desktop: { w: 1440, h: 900, touch: false },
  portrait: { w: 390, h: 844, touch: true },
  landscape: { w: 844, h: 390, touch: true, orientation: { type: 'landscapePrimary', angle: 90 } },
};
const MODES = ['rect-2pt', 'rect-center', 'rect-3pt'];

export async function runRectMenu(layoutName) {
  const L = RECT_MENU_LAYOUTS[layoutName];
  if (!L) throw new Error('rect-menu: unknown layout ' + layoutName);
  const cdp = await launchBrowser({ tag: '607-' + layoutName, width: L.w, height: L.h });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const metrics = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: L.h, deviceScaleFactor: L.touch ? 2 : 1, mobile: L.touch, ...(L.orientation ? { screenOrientation: L.orientation } : {}) });
    await metrics(L.w);
    await send('Emulation.setTouchEmulationEnabled', { enabled: L.touch, maxTouchPoints: 5 });
    const press = async (p) => {
      if (L.touch) {
        const pt = [{ x: p.x, y: p.y, id: 0, radiusX: 1, radiusY: 1, force: 1 }];
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await sleep(40);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); await sleep(30);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      }
      await sleep(250);
    };
    const centre = (sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const isOpen = () => evalJs(`!!document.querySelector('.sk-ribbon-menu.show')`);
    const open = async (tag) => { await press(await centre('#tool-rect')); assert.strictEqual(await isOpen(), true, tag + ': a click on the Rect button opens the menu'); };

    for (const h of LANDSCAPE_HOSTS.filter((x) => !process.env.RECT_MENU_HOST || x.name === process.env.RECT_MENU_HOST)) { // RECT_MENU_HOST narrows a debugging run to one host
      const tag = `${layoutName} ${h.name} ${L.w}x${L.h}`;
      await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
      if (h.enter) { await sleep(800); await evalJs(h.enter); }
      await waitFor(`!!document.querySelector('#tool-rect')`, tag + ': the ribbon');
      await sleep(600);
      assert.strictEqual(await evalJs(`matchMedia('(pointer: coarse)').matches`), L.touch, tag + ': pointer kind');
      await evalJs(`document.querySelector('#tool-rect').scrollIntoView({ block: 'nearest', inline: 'nearest' })`); await sleep(150);

      await open(tag);
      const items = await evalJs(`[...document.querySelectorAll('.sk-ribbon-menu.show .sk-ribbon-menu-item')].map((e) => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { mode: e.dataset.mode, left: r.left, top: r.top, right: r.right, bottom: r.bottom, h: r.height, hit: !!hit && (hit === e || e.contains(hit)), hitTag: hit ? hit.tagName + '.' + hit.className : null }; })`);
      if (process.env.RECT_MENU_EVIDENCE) {
        fs.mkdirSync(process.env.RECT_MENU_EVIDENCE, { recursive: true });
        const clip = await evalJs(`(() => { const b = document.querySelector('#tool-rect').getBoundingClientRect(); const m = document.querySelector('.sk-ribbon-menu.show').getBoundingClientRect(); const l = Math.max(0, Math.min(b.left, m.left) - 20), t = Math.max(0, Math.min(b.top, m.top) - 20); return { x: l, y: t, width: Math.min(innerWidth - l, Math.max(b.right, m.right) + 20 - l), height: Math.min(innerHeight - t, Math.max(b.bottom, m.bottom) + 20 - t), scale: 2 }; })()`);
        const shot = await send('Page.captureScreenshot', { format: 'png', clip });
        fs.writeFileSync(path.join(process.env.RECT_MENU_EVIDENCE, `${layoutName}-${h.name}.png`), Buffer.from(shot.data, 'base64'));
      }
      assert.deepStrictEqual(items.map((i) => i.mode), MODES, tag + ': the three variants');
      for (const it of items) {
        assert(it.left >= 0 && it.top >= 0 && it.right <= L.w && it.bottom <= L.h, tag + ': variant inside the viewport: ' + JSON.stringify(it));
        assert(it.hit, tag + `: variant ${it.mode} is not the element at its centre (hit ${it.hitTag})`);
        if (L.touch) assert(it.h >= 44, tag + `: variant ${it.mode} is ${it.h} px tall (touch rows are >= 44)`);
      }

      // each variant is chosen by a real click / tap on it
      for (const mode of MODES) {
        if (!(await isOpen())) await open(tag);
        await press(await centre(`.sk-ribbon-menu.show [data-mode="${mode}"]`));
        const after = await evalJs(`({ open: !!document.querySelector('.sk-ribbon-menu.show'), active: document.querySelector('.sk-ribbon-menu .sk-ribbon-menu-item.active')?.dataset.mode, rectActive: document.querySelector('#tool-rect').classList.contains('active') })`);
        assert.deepStrictEqual(after, { open: false, active: mode, rectActive: true }, tag + `: choosing ${mode}`);
      }

      // Esc, an outside click, the ribbon scrolling, a resize
      await open(tag);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(150);
      assert.strictEqual(await isOpen(), false, tag + ': Esc closes the menu');
      await open(tag);
      const outside = await evalJs(`(() => { const r = document.querySelector('${h.canvas}').getBoundingClientRect(); const m = document.querySelector('.sk-ribbon-menu.show').getBoundingClientRect(); return { x: Math.round(Math.min(r.right - 20, Math.max(r.left + 20, m.right + 40))), y: Math.round(r.bottom - 20) }; })()`);
      await press(outside);
      assert.strictEqual(await isOpen(), false, tag + ': a click outside closes the menu');
      await open(tag);
      const canScroll = await evalJs(`(() => { const r = document.querySelector('.sk-ribbon'); return r.scrollWidth > r.clientWidth + 1 || r.scrollHeight > r.clientHeight + 1; })()`);
      await evalJs(`(() => { const r = document.querySelector('.sk-ribbon'); r.scrollBy(r.scrollWidth > r.clientWidth ? 40 : 0, r.scrollHeight > r.clientHeight ? 40 : 0); })()`); await sleep(250);
      if (canScroll) assert.strictEqual(await isOpen(), false, tag + ': scrolling the ribbon closes the menu');
      else console.log(tag + ': the ribbon does not scroll here (scroll-close not exercised)');
      if (!(await isOpen())) await open(tag);
      await metrics(L.w - 20); await sleep(300);
      assert.strictEqual(await isOpen(), false, tag + ': resizing the window closes the menu');
      await metrics(L.w);
      console.log('ok ' + tag);
    }
    console.log(`rect-menu ${layoutName}: all hosts pass`);
  } finally { await cdp.close(); }
}
