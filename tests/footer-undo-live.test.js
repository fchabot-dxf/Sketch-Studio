// tests/footer-undo-live.test.js: TASK 618 (live headless, REAL mouse / touch): Undo and Redo are ONE shared control in every host's FOOTER (history-control.js,
// mounted by app-footer.js), not in the ribbon or the header; Recenter (and Construction in SketchStudio) are at the footer's right; the VIEW readout is gone. In SketchStudio, Shaper, Pen Plotter and Trace (Edit): draw a line, the footer Undo enables, a real click removes the line, Redo is then
// enabled and a real click brings it back; both disabled when there is nothing to do; titles / aria-labels; the ribbon has no Undo / Redo. Layouts: desktop
// (30 px buttons), phone portrait 390 and 360 (44 px, inside the screen, the header scrolls sideways when too long, a real swipe moves it, every control can be
// brought on screen, the app menu opens fully inside the screen), phone landscape 844x390 (header one row, buttons 44 px). Header screenshots: .evidence/618.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EVID = path.join(process.cwd(), '.evidence', '618');

await (async () => {
  const cdp = await launchBrowser({ tag: '618', width: 1600, height: 900 });
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
    const goto = async (url, readyExpr) => { const loaded = once('Page.loadEventFired'); await send('Page.navigate', { url: `http://127.0.0.1:${port}${url}` }); await Promise.race([loaded, sleep(8000)]); await waitFor(readyExpr, url + ' ready'); await sleep(600); };
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
    const shapeCount = () => evalJs(`document.querySelectorAll('.shape-elem').length`);
    const btn = (id) => evalJs(`(() => { const b = document.getElementById('${id}'); return b ? { disabled: b.disabled, title: b.title, aria: b.getAttribute('aria-label'), inHeader: !!b.closest('header'), inFooter: !!b.closest('footer'), left: b.getBoundingClientRect().left } : null; })()`);
    const esc = async () => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(200); };

    // ---- 1. desktop: Design undo / redo with real clicks, in all four hosts
    for (const name of Object.keys(HOSTS)) {
      const h = await open(name);
      const u0 = await btn('btn-undo'), r0 = await btn('btn-redo');
      assert(u0 && r0, name + ': footer Undo and Redo exist');
      assert(u0.inFooter && r0.inFooter, name + ': both are in the footer'); assert(!u0.inHeader && !r0.inHeader, name + ': neither is in the header');
      assert.strictEqual(u0.title, 'Undo (Ctrl+Z)'); assert.strictEqual(u0.aria, 'Undo (Ctrl+Z)'); assert.strictEqual(r0.title, 'Redo (Ctrl+Y)'); assert.strictEqual(r0.aria, 'Redo (Ctrl+Y)');
      assert.strictEqual(await evalJs(`!!document.querySelector('.sk-ribbon #btn-undo, .sk-ribbon #btn-redo')`), false, name + ': the ribbon has no Undo / Redo');
      assert.strictEqual(u0.disabled, true, name + ': nothing to undo at the start'); assert.strictEqual(r0.disabled, true, name + ': nothing to redo');
      const n0 = await shapeCount();
      await clickEl('#tool-line');
      const c = await centerOf(h.canvas);
      await click(c.x - 120, c.y); await click(c.x + 120, c.y + 10);
      await esc();
      const n1 = await shapeCount();
      assert(n1 > n0, name + ': the line was drawn ' + [n0, n1]);
      assert.strictEqual((await btn('btn-undo')).disabled, false, name + ': Undo enabled after the change');
      assert.strictEqual((await btn('btn-redo')).disabled, true, name + ': Redo still disabled');
      await clickEl('#btn-undo');
      assert.strictEqual(await shapeCount(), n0, name + ': a real click on footer Undo removes the line');
      assert.strictEqual((await btn('btn-undo')).disabled, true, name + ': Undo disabled again'); assert.strictEqual((await btn('btn-redo')).disabled, false, name + ': Redo enabled');
      await clickEl('#btn-redo');
      assert.strictEqual(await shapeCount(), n1, name + ': a real click on footer Redo brings it back');
      assert.strictEqual((await btn('btn-redo')).disabled, true, name + ': Redo disabled again');
      const fb = await evalJs(`(() => { const f = document.querySelector('footer'); const r = f.getBoundingClientRect(); const q = (id) => { const e = document.getElementById(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height }; };
        return { vw: innerWidth, vh: innerHeight, fr: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, undo: q('btn-undo'), redo: q('btn-redo'), del: q('btn-delete-selection'), clr: q('btn-clear-sketch'), recenter: q('btn-recenter-view'), construct: q('btn-construct-toggle'), view: !!document.getElementById('viewport-size'), text: f.textContent }; })()`);
      assert(fb.undo.w === 32 && fb.undo.h === 32 && fb.redo.w === 32 && fb.del && fb.del.w === 32 && fb.clr && fb.clr.w === 32, name + ': a mouse footer button is 32 px: ' + JSON.stringify(fb));
      assert(fb.undo.l < fb.redo.l && fb.redo.r <= fb.del.l && fb.del.r < fb.clr.l && fb.clr.l < fb.vw / 2, name + ': Undo, Redo, Delete, gap, Clear sketch at the left of the footer: ' + JSON.stringify([fb.redo, fb.del, fb.clr]));
      assert(fb.recenter && fb.recenter.r > fb.vw - 40 && fb.recenter.w === 32, name + ': Recenter at the right of the footer: ' + JSON.stringify(fb.recenter));
      assert(fb.fr.bottom <= fb.vh + 0.5 && fb.fr.bottom >= fb.vh - 1, name + ': the footer sits at the bottom of the screen: ' + JSON.stringify([fb.fr.bottom, fb.vh]));
      assert.strictEqual(fb.view, false, name + ': no VIEW readout'); assert(!/VIEW/i.test(fb.text), name + ': no VIEW text in the footer');
      assert.strictEqual(!!fb.construct, name === 'studio', name + ': Construction is in the footer of SketchStudio only (the one host with a construction toggle)');
      await shot(`desktop-${name}.png`, { x: 0, y: fb.fr.top - 2, width: fb.vw, height: fb.vh - fb.fr.top + 2 });
      console.log('desktop', name, 'ok');
    }

    // ---- 2. phone portrait 390 / 360 (touch) and landscape 844x390 / 780x360: no header bar, 44 px footer row, 56 x 44 wide buttons, peeking handle opens the menu fully
    const layouts = [{ w: 390, h: 844, tag: 'portrait390' }, { w: 360, h: 780, tag: 'portrait360' }, { w: 844, h: 390, tag: 'landscape844' }, { w: 780, h: 360, tag: 'landscape780' }];
    for (const L of layouts) {
      await send('Emulation.setDeviceMetricsOverride', { width: L.w, height: L.h, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      for (const name of Object.keys(HOSTS)) {
        await open(name);
        const tag = `${name} ${L.tag}: `;
        const m = await evalJs(`(() => { const h = document.querySelector('header'); const hr = h.getBoundingClientRect();
          return { vw: innerWidth, hr: { left: hr.left, right: hr.right, top: hr.top, bottom: hr.bottom }, hdrDisplay: getComputedStyle(h).display, pageSW: document.documentElement.scrollWidth }; })()`);
        assert.strictEqual(m.hdrDisplay, 'none', tag + 'phone has no header bar (TASK 619)');
        assert(m.pageSW <= m.vw + 0.5, tag + 'no page overflow ' + JSON.stringify([m.vw, m.pageSW]));
        assert(!(await evalJs(`!!document.querySelector('header [aria-label="Sketches"]')`)), tag + 'no Sketches button in the header');
        const ft = await evalJs(`(() => { const f = document.querySelector('footer'); const r = f.getBoundingClientRect(); const q = (id) => { const e = document.getElementById(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height }; };
          const cv = document.querySelector(${JSON.stringify(HOSTS[name].canvas)}).getBoundingClientRect(); const corner = document.querySelector('.sk-canvas-corner .sk-browser-corner-btn'); const cb = corner && corner.getBoundingClientRect();
          return { vw: innerWidth, vh: innerHeight, fr: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, undo: q('btn-undo'), redo: q('btn-redo'), del: q('btn-delete-selection'), clr: q('btn-clear-sketch'), recenter: q('btn-recenter-view'), construct: q('btn-construct-toggle'), canvasH: cv.height,
            sk: cb ? { w: cb.width, h: cb.height, l: cb.left, r: cb.right, t: cb.top, vis: getComputedStyle(corner).display !== 'none', aria: corner.getAttribute('aria-label') } : null }; })()`);
        for (const k of ['undo', 'redo', 'del', 'clr', 'recenter']) assert(ft[k] && ft[k].w >= 55 && ft[k].h >= 43.5 && ft[k].w > ft[k].h, tag + k + ' is a wide 56x44 touch target in the footer: ' + JSON.stringify(ft[k]));
        if (ft.construct) assert(ft.construct.w >= 55 && ft.construct.h >= 43.5 && ft.construct.w > ft.construct.h, tag + 'Construction is 56x44: ' + JSON.stringify(ft.construct));
        assert(ft.fr.left >= -0.5 && ft.fr.right <= ft.vw + 0.5 && ft.fr.bottom <= ft.vh + 0.5, tag + 'the footer is inside the screen: ' + JSON.stringify(ft.fr));
        assert.strictEqual(Math.round(ft.fr.bottom - ft.fr.top), 44, tag + 'footer bar is 44 px tall (no extra vertical padding)');
        assert(ft.undo.r <= ft.redo.l + 0.5 && ft.redo.r <= ft.del.l + 0.5 && ft.del.r < ft.clr.l && ft.recenter.r <= ft.vw + 0.5, tag + 'Undo, Redo, Delete, gap, Clear sketch then Recenter fit the footer width: ' + JSON.stringify({ redo: ft.redo, del: ft.del, clr: ft.clr, recenter: ft.recenter }));
        const share = ft.canvasH / ft.vh;
        console.log(tag + 'canvas share ' + Math.round(share * 100) + ' %, footer ' + Math.round(ft.fr.bottom - ft.fr.top) + ' px');
        if (L.tag === 'landscape844' || L.tag === 'landscape780') assert(share >= 0.6, tag + 'the canvas keeps >= 60 % of the height: ' + share);
        if (L.tag.startsWith('portrait')) {
          assert(ft.sk && ft.sk.vis && ft.sk.w >= 43.5 && ft.sk.h >= 43.5 && ft.sk.aria === 'Sketches' && ft.sk.r <= ft.vw && ft.sk.t >= 0, tag + 'the Sketches layers button is in the canvas corner, 44 px, on screen: ' + JSON.stringify(ft.sk));
          const c = await centerOf('.sk-canvas-corner .sk-browser-corner-btn'); await tap(c.x, c.y);
          assert(await evalJs(`document.querySelector('.sk-browser').classList.contains('sk-browser-open')`), tag + 'a real tap on the Sketches button shows the floating card');
          await tap(c.x, c.y);
        } else assert(!ft.sk || !ft.sk.vis, tag + 'landscape: the SKETCHES box floats on the canvas, no drawer button');
        await shot(`${L.tag}-${name}-footer.png`, { x: 0, y: ft.fr.top - 2, width: L.w, height: L.h - ft.fr.top + 2 });
        // the app menu (a real tap on the peeking handle) opens fully inside the screen
        const handleC = await centerOf('.sk-sidebar-handle');
        assert(handleC, tag + 'peeking drawer handle exists');
        await tap(handleC.x, handleC.y);
        const menu = await evalJs(`(() => { const d = document.querySelector('.sk-sidebar.open'); if (!d) return null; const r = d.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; })()`);
        assert(menu, tag + 'the app menu did not open from the handle');
        assert(menu.left >= -0.5 && menu.right <= menu.vw + 0.5 && menu.top >= -0.5 && menu.bottom <= menu.vh + 0.5 && menu.right - menu.left > 200, tag + 'the app menu is fully inside the screen: ' + JSON.stringify(menu));
        await shot(`${L.tag}-${name}-menu.png`);
        console.log(L.tag, name, 'ok');
      }
    }
    console.log('footer-undo-live: ok');
  } finally { await cdp.close(); }
})();
