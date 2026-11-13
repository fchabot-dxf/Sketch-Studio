// tests/recentre-on-reload-live.test.js — TASK 494: a restored drawing is framed (fitToDrawing) after a reload and after Open recent.
// Live headless CDP, SketchStudio (#svgCanvas) and Shaper (#design-canvas). Designs are seeded straight into the shared project store.
//  - a small drawing far off-centre: after a reload its box is inside the canvas, centred, with the 10% margin
//  - an empty design keeps the default view
//  - after the user zooms, an autosave tick does not re-fit
//  - Open recent of another design fits THAT design; a huge and a tiny drawing both end up visible (tiny capped at FIT_MIN_WIDTH)

import assert from 'node:assert';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

const line = (id, a, b) => ({ id, type: 'line', joints: [a, b] });
const doc = (pts, shapes) => ({
  version: 1,
  geometry: { joints: [['j_origin', { x: 0, y: 0, fixed: true }], ...pts.map(([id, x, y]) => [id, { x, y }])], shapes, constraints: [] },
  hosts: {},
});
const SMALL = { name: 'small', bbox: { minX: 5000, minY: 3000, maxX: 5040, maxY: 3020 }, document: doc([['a', 5000, 3000], ['b', 5040, 3020]], [line('L1', 'a', 'b')]) };
const HUGE = { name: 'huge', bbox: { minX: -90000, minY: -40000, maxX: 30000, maxY: 25000 }, document: doc([['a', -90000, -40000], ['b', 30000, 25000]], [line('L1', 'a', 'b')]) };
const TINY = { name: 'tiny', bbox: { minX: -900, minY: 700, maxX: -899.5, maxY: 700 }, document: doc([['a', -900, 700], ['b', -899.5, 700]], [line('L1', 'a', 'b')]) };

await (async () => {
  const cdp = await launchBrowser({ tag: '494' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const viewBoxOf = (sel) => evalJs(`(() => { const c = document.querySelector('${sel}'); const r = c.getBoundingClientRect(); return { vb: c.getAttribute('viewBox').split(' ').map(Number), w: r.width, h: r.height }; })()`);
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel, text) => {
      const c = await evalJs(`(() => { const e = [...document.querySelectorAll('${sel}')].find(x => !${JSON.stringify(text || '')} || x.textContent.includes(${JSON.stringify(text || '')})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      assert(c, sel + ' ' + (text || '') + ' not found');
      await click(c.x, c.y);
    };
    // The drawing's box must lie inside the viewBox, centred, with the 10% margin (or the capped width for a tiny drawing).
    const assertFramed = (v, bbox, label) => {
      const [vx, vy, vw, vh] = v.vb; // viewBox = x - w/2, y - h/2, w, h
      const bw = bbox.maxX - bbox.minX, bh = bbox.maxY - bbox.minY;
      const cx = vx + vw / 2, cy = vy + vh / 2, tol = Math.max(vw, vh) * 1e-3;
      assert(Math.abs(cx - (bbox.minX + bbox.maxX) / 2) < tol && Math.abs(cy - (bbox.minY + bbox.maxY) / 2) < tol, `${label}: centred (view centre ${cx},${cy})`);
      assert(bbox.minX >= vx && bbox.maxX <= vx + vw && bbox.minY >= vy && bbox.maxY <= vy + vh, `${label}: box inside the canvas`);
      assert(Math.abs(vw / vh - v.w / v.h) < 1e-3, `${label}: viewBox aspect follows the canvas`);
      if (Math.max(bw, bh) * 1.2 < 10) assert(Math.abs(vw - 10) < 1e-6, `${label}: tiny drawing capped at 10 units across (got ${vw})`);
      else assert(Math.max(bw / vw, bh / vh) > 0.8 && Math.max(bw / vw, bh / vh) < 0.84, `${label}: 10% margin (fill ${Math.max(bw / vw, bh / vh)})`);
      console.log(label, 'ok: viewBox', v.vb.map((n) => +n.toFixed(3)).join(' '));
    };
    const hosts = [
      { app: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', ready: `!!document.getElementById('tool-line')` },
      { app: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', ready: `!!document.querySelector('.mode-btn')`, enter: `[...document.querySelectorAll('.mode-btn')].find(b => b.dataset.mode === 'design').click()` },
      // Pen Plotter: its Design tab is this same shared canvas; a restored sketch is framed instead of the paper (an empty one keeps the paper fit)
      { app: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', ready: `!!window.__sketch` },
    ];
    for (const h of hosts) {
      SMALL.bbox.maxY = 3020;
      const goto = async () => {
        await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        await waitFor(h.ready, h.app + ' page to load');
        // Shaper opens on another mode: its Design canvas has no size until the user enters Design (the fit is armed until then).
        if (h.enter) { await sleep(1200); await evalJs(h.enter); }
        await waitFor(`document.querySelector('${h.canvas}').getBoundingClientRect().width > 0`, h.app + ' canvas to have a size');
      };
      // Seeds a NEW current design in the shared store (the app is loaded so the store module is the page's own).
      const seed = (d) => evalJs(`(async () => { const { getProjectStore } = await import('/packages/ui/project-store.js'); const s = getProjectStore();
        const p = await s.newDesign(${JSON.stringify(d.name)}, { app: ${JSON.stringify(h.app)} }); await s.save(${JSON.stringify(d.document)}, { app: ${JSON.stringify(h.app)}, id: p.id }); return p.id; })()`);
      const settle = () => sleep(1200); // the RAF/restore chain + the first layout

      await goto();
      // an EMPTY design keeps the default view (the host's own initial view), and a second empty reload gives the identical view
      await seed({ name: 'empty', document: doc([], []) });
      await goto(); await settle();
      const e1 = await viewBoxOf(h.canvas);
      await goto(); await settle();
      assert.deepStrictEqual((await viewBoxOf(h.canvas)).vb, e1.vb, h.app + ': empty design view is stable across reloads');
      console.log(h.app, 'empty ok: viewBox', e1.vb.join(' '));

      // a small drawing far off-centre: framed after a reload
      const smallId = await seed(SMALL);
      await goto(); await settle();
      assertFramed(await viewBoxOf(h.canvas), SMALL.bbox, h.app + ' small off-centre after reload');

      const framedW = (await viewBoxOf(h.canvas)).vb[2];
      // the user zooms: an autosave tick (the buffer polls every 1.5 s) must not re-fit
      const r = await evalJs(`(() => { const r = document.querySelector('${h.canvas}').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.3), y: Math.round(r.top + r.height * 0.4) }; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: r.x, y: r.y, deltaX: 0, deltaY: -400 });
      await sleep(300);
      const zoomed = await viewBoxOf(h.canvas);
      assert(zoomed.vb[2] < framedW, h.app + ': wheel zoomed in (' + zoomed.vb + ')');
      await evalJs(`(async () => { const { getProjectStore } = await import('/packages/ui/project-store.js'); await getProjectStore().save(${JSON.stringify(doc([['a', 5000, 3000], ['b', 5040, 3020], ['c', 5040, 3050]], [line('L1', 'a', 'b'), line('L2', 'b', 'c')]))}, { app: ${JSON.stringify(h.app)}, id: ${JSON.stringify(smallId)} }); })()`);
      await sleep(3200); // two autosave ticks
      assert.deepStrictEqual((await viewBoxOf(h.canvas)).vb, zoomed.vb, h.app + ': an autosave tick after a zoom does not re-fit');
      console.log(h.app, 'no re-fit after a user zoom ok');
      SMALL.bbox.maxY = 3050; // the autosave step above added a line to this design

      // a huge and a tiny drawing both end up visible after a reload
      await seed(HUGE); await goto(); await settle();
      assertFramed(await viewBoxOf(h.canvas), HUGE.bbox, h.app + ' huge after reload');
      await seed(TINY); await goto(); await settle();
      assertFramed(await viewBoxOf(h.canvas), TINY.bbox, h.app + ' tiny after reload');

      // Open recent of another design fits THAT design (current = tiny; open "small" and then "huge" from the sidebar)
      for (const d of [SMALL, HUGE]) {
        await clickEl('.sk-sidebar-btn');
        await clickEl('.sk-sidebar-item[data-action="open-recent"]');
        await waitFor(`[...document.querySelectorAll('.sk-pm .sk-pm-tile')].some(e => e.textContent.includes('${d.name}'))`, 'Recent pane to show ' + d.name);
        await clickEl('.sk-pm .sk-pm-tile', d.name);
        await sleep(800);
        assertFramed(await viewBoxOf(h.canvas), d.bbox, h.app + ' Open recent -> ' + d.name);
      }
    }
    console.log('recentre-on-reload live test passed');
  } finally {
    await cdp.close();
  }
})();
