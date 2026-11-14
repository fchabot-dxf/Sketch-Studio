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
      { name: 'shaper-explore', url: '/apps/shaper/index.html', enter: `document.querySelector('[data-mode="explore"]').click()`, ready: `!!document.querySelector('[data-mode="explore"].active')`, drawer: false },
      { name: 'shaper-design', url: '/apps/shaper/index.html', enter: `document.querySelector('[data-mode="design"]').click()`, ready: `!!document.querySelector('.sk-browser-info .sk-sketch-node')`, drawer: true },
      { name: 'penplotter', url: '/apps/penplotter/index.html', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()`, ready: `!!document.querySelector('.sk-browser-info .sk-sketch-node')`, drawer: true },
      { name: 'trace', url: '/apps/trace/index.html', enter: `document.querySelector('.tr-tab[data-tab="edit"]').click()`, ready: `!!document.querySelector('.sk-browser .sk-sketch-node')`, drawer: true },
      { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', ready: `!!document.querySelector('.sk-browser .sk-sketch-node')`, drawer: true },
    ];
    const measure = () => evalJs(`(() => { const h = document.querySelector('header'); const hr = h.getBoundingClientRect(); const vw = window.innerWidth;
      const controls = [...h.querySelectorAll('button, input, a, select')].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { id: (e.id || e.className || e.tagName).toString().slice(0, 30), text: (e.textContent || '').trim().slice(0, 10), shown: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden', left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height, w: r.width }; }).filter((c) => c.shown);
      return { vw, hdrLeft: hr.left, hdrRight: hr.right, hdrH: hr.height, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, controls }; })()`);
    for (const w of [1440, 390, 360]) {
      const phone = w < 640;
      await send('Emulation.setDeviceMetricsOverride', phone ? { width: w, height: 844, deviceScaleFactor: 2, mobile: true } : { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
      for (const h of hosts) {
        await cdp.navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        await waitFor(`!!document.querySelector('header')`, h.name + ' loads');
        if (h.enter) { await sleep(800); await evalJs(h.enter); }
        await waitFor(h.ready, h.name + ' shows its panel'); await sleep(400);
        const m = await measure(); const tag = `${h.name} @${w}: `;
        assert(m.hdrRight <= m.vw + 0.5 && m.hdrLeft >= -0.5, tag + 'the header is inside the viewport: ' + JSON.stringify([m.hdrLeft, m.hdrRight, m.vw]));
        assert(m.scrollW <= m.vw + 0.5 , tag + 'no horizontal page scroll: ' + JSON.stringify([m.scrollW, m.vw]));
        for (const c of m.controls) {
          assert(c.left >= -0.5 && c.right <= m.vw + 0.5 && c.top >= -0.5, tag + `control ${c.id} "${c.text}" is inside the viewport: ${Math.round(c.left)}..${Math.round(c.right)}`);
          if (phone) assert(c.h >= 43.5 && c.w >= 43.5, tag + `control ${c.id} "${c.text}" is a 44 px target: ${Math.round(c.w)}x${Math.round(c.h)}`);
        }
        if (!phone) {
          assert(m.hdrH <= 44.5, tag + 'desktop header height unchanged: ' + m.hdrH);
          if (h.name === 'shaper-explore') for (const id of ['open', 'fit', 'export']) assert(m.controls.some((c) => c.id === id), tag + `#${id} is in the header`);
        } else if (h.drawer) {
          // TASK 618 / 623: the Sketches button is the layers icon in the canvas's top-right corner, no longer in the header
          assert(!m.controls.some((c) => (c.id.includes('sk-drawer-toggle') || c.id.includes('sk-browser-corner-btn')) && c.text.includes('Sketches')), tag + 'no Sketches button in the header');
          const tog = await evalJs(`(() => { const e = document.querySelector('.sk-canvas-corner .sk-browser-corner-btn'); const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; })()`);
          assert(tog.w >= 43.5 && tog.h >= 43.5 && tog.right <= m.vw + 0.5 && tog.left >= 0, tag + 'the Sketches layers button is on screen, 44 px: ' + JSON.stringify(tog));
          await tap(tog);
          const open = await evalJs(`(() => { const p = document.querySelector('.sk-browser'); const r = p.getBoundingClientRect(); return p.classList.contains('sk-browser-open') && r.left >= 0 && r.right <= window.innerWidth + 0.5; })()`);
          assert(open, tag + 'a real touch tap on the layers button shows the floating card inside the screen');
        }
        if (phone && h.name === 'shaper-explore') {
          // Open SVG / Fit / Export left the header: they are in the menu (the same buttons' handlers run)
          assert(!m.controls.some((c) => ['open', 'fit', 'export'].includes(c.id)), tag + 'Explore actions are out of the header');
          await tap(m.controls.find((c) => c.id.includes('sk-sidebar-btn')));
          const items = await evalJs(`[...document.querySelectorAll('.sk-sidebar button, .sk-sidebar [role=button], .sk-sidebar-item')].map((e) => (e.textContent || '').trim()).filter(Boolean)`);
          for (const label of ['Open SVG', 'Fit', 'Export']) assert(items.some((t) => t === label || t.endsWith(label)), tag + `the menu offers ${label}: ` + JSON.stringify(items));
        }
      }
    }
    console.log('LIVE-OK phone headers: shaper (explore + design), penplotter, trace, sketchstudio fit 390 and 360 px (no page scroll, controls on screen at 44 px, touch tap opens the drawer); desktop 1440 unchanged');
  } finally { await cdp.close(); }
})();
