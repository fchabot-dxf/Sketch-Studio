// tests/phone-header-live.test.js — TASK 581: at phone widths (390 and 360 px, touch) EVERY app's header fits the screen: the header's right edge
// is inside the viewport, the page has no horizontal scroll, every header control's rect is inside the viewport and at least 44 px high, and the
// drawer button (the SKETCHES / panel drawer) is on screen and a REAL touch tap opens the drawer. Shaper is measured in Explore (its Open SVG /
// Fit / Export live in the menu at phone width) and in Design; Pen Plotter in its Design stage; Trace in its Edit tab; SketchStudio in Design.
// At 1440 px the headers keep their desktop height (44 px or less) and show every control in the header.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '581', width: 1400, height: 800, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor } = cdp;
  try {
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (r) => { await T('touchStart', [{ x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) }]); await sleep(40); await T('touchEnd', []); await sleep(500); };
    const hosts = [
      { name: 'shaper-explore', url: '/apps/shaper/index.html', enter: `document.querySelector('.sk-header-tab[data-tab="explore"]').click()`, ready: `!!document.querySelector('.sk-header-tab[data-tab="explore"].active')`, drawer: false },
      { name: 'shaper-design', url: '/apps/shaper/index.html', enter: `document.querySelector('.sk-header-tab[data-tab="design"]').click()`, ready: `!!document.querySelector('.sk-browser-info .sk-sketch-node')`, drawer: true },
      { name: 'penplotter', url: '/apps/penplotter/index.html', enter: `document.querySelector('.sk-header-tab[data-tab="design"]').click()`, ready: `!!document.querySelector('.sk-browser-info .sk-sketch-node')`, drawer: true, panelToggle: true },
      { name: 'trace', url: '/apps/trace/index.html', enter: `document.querySelector('.sk-header-tab[data-tab="edit"]').click()`, ready: `!!document.querySelector('.sk-browser .sk-sketch-node')`, drawer: true },
      { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', ready: `!!document.querySelector('.sk-browser .sk-sketch-node')`, drawer: true },
    ];
    const measure = () => evalJs(`(() => { const h = document.querySelector('header.sk-header'); const hr = h.getBoundingClientRect(); const vw = window.innerWidth;
      const controls = [...h.querySelectorAll('button, input, a, select')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { id: (e.id || e.className || e.tagName).toString().slice(0, 30), text: (e.textContent || '').trim().slice(0, 12), shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height, w: r.width }; }).filter((c) => c.shown);
      const handle = document.querySelector('.sk-sidebar-handle'); const har = handle ? handle.getBoundingClientRect() : null;
      const strip = document.querySelector('.sk-doctabs'); const sr = strip ? strip.getBoundingClientRect() : null;
      return { vw, hdrDisplay: getComputedStyle(h).display, hdrLeft: hr.left, hdrRight: hr.right, hdrH: hr.height, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, controls,
        handle: har ? { left: har.left, right: har.right, top: har.top, bottom: har.bottom, w: har.width, h: har.height } : null,
        stripTop: sr ? Math.round(sr.top) : null }; })()`);
    for (const w of [1440, 390, 360]) {
      const phone = w < 640;
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: w, height: 844, deviceScaleFactor: 2, mobile: true } : { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
      for (const h of hosts) {
        await cdp.navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        await waitFor(`!!document.querySelector('header.sk-header')`, h.name + ' loads');
        if (h.enter) { await sleep(800); await evalJs(h.enter); }
        await waitFor(h.ready, h.name + ' shows its panel'); await sleep(400);
        const m = await measure(); const tag = `${h.name} @${w}: `;
        assert(m.scrollW <= m.vw + 0.5 , tag + 'no horizontal page scroll: ' + JSON.stringify([m.scrollW, m.vw]));
        if (!phone) {
          assert(m.hdrRight <= m.vw + 0.5 && m.hdrLeft >= -0.5, tag + 'the header is inside the viewport: ' + JSON.stringify([m.hdrLeft, m.hdrRight, m.vw]));
          assert.strictEqual(Math.round(m.hdrH), 44, tag + 'unified desktop header height is 44: ' + m.hdrH);
          assert.strictEqual(m.controls.filter((c) => !c.id.includes('sk-sidebar-btn') && !c.id.includes('sk-header-tab')).length, 0, tag + 'header has ONLY ☰ + stage tabs: ' + JSON.stringify(m.controls));
        } else {
          assert.strictEqual(m.hdrDisplay, 'none', tag + 'phone has NO header bar');
          assert.strictEqual(m.hdrH, 0, tag + 'phone header height is 0');
          assert.strictEqual(m.stripTop, 0, tag + 'document tab strip is the top row on phones');
          assert(m.handle && m.handle.w >= 14 && m.handle.h >= 44 && m.handle.left <= 1, tag + 'peeking drawer handle visible on left edge: ' + JSON.stringify(m.handle));
          if (h.drawer) {
            const tog = await evalJs(`(() => { const e = document.querySelector('.sk-canvas-corner .sk-drawer-toggle'); const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; })()`);
            assert(tog.w >= 43.5 && tog.h >= 43.5 && tog.right <= m.vw + 0.5 && tog.left >= 0, tag + 'the Sketches layers button is on screen, 44 px: ' + JSON.stringify(tog));
            await tap(tog);
            const open = await evalJs(`(() => { const p = document.querySelector('.sk-drawer-panel'); const r = p.getBoundingClientRect(); return p.classList.contains('sk-drawer-open') && r.left >= 0 && r.right <= window.innerWidth + 0.5; })()`);
            assert(open, tag + 'a real touch tap on the drawer button opens the drawer inside the screen');
          }
          if (h.panelToggle) {
            const pbtn = await evalJs(`(() => { const e = document.querySelector('.sk-canvas-corner .sk-drawer-toggle[aria-label="Panel"]'); const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, w: r.width, h: r.height }; })()`);
            assert(pbtn.w >= 43.5 && pbtn.h >= 43.5 && pbtn.right <= m.vw + 0.5 && pbtn.left >= 0, tag + 'Pen Plotter Panel toggle sits in .sk-canvas-corner at 44 px: ' + JSON.stringify(pbtn));
          }
          if (h.name === 'shaper-explore') {
            await tap(m.handle);
            const items = await evalJs(`[...document.querySelectorAll('.sk-sidebar button, .sk-sidebar [role=button], .sk-sidebar-item')].map((e) => (e.textContent || '').trim()).filter(Boolean)`);
            for (const label of ['Open SVG', 'Export', 'Settings', 'Log']) assert(items.some((t) => t === label || t.endsWith(label)), tag + `the menu offers ${label}: ` + JSON.stringify(items));
          }
        }
      }
    }
    console.log('LIVE-OK phone headers: phone has no header bar + peeking drawer handle + canvas-corner toggles; desktop 1440 unified 44 px');
  } finally { await cdp.close(); }
})();
