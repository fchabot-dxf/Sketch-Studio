// tests/helpers/phone-landscape.js — TASK 602 (one file per host runs it: tests/phone-landscape-<host>-live.test.js, so no file runs long): a phone held in LANDSCAPE (the short viewport, #ui/short-viewport.js) is usable in every host of the
// shared Design tab (SketchStudio, Shaper, Pen Plotter, Trace), at 844 x 390 and 780 x 360, real touch emulation (coarse pointer, mobile viewport):
//  - the canvas gets at least 60 % of the viewport height;
//  - the tool ribbon is a vertical icon RAIL on the left (column, <= 64 px wide, from under the header to the bottom), the canvas right of it; a real
//    finger swipe scrolls the rail;
//  - EVERY rail button is reachable (scrolled into the rail, inside the viewport, 44 x 44 px or more, nothing covers it) and every TOOL button
//    activates with a real tap (it becomes the one active button); the rect variants menu opens beside the rail and a tapped variant is chosen; the
//    Parameters window opens inside the viewport and closes;
//  - every other control on the screen (header, tab strip, canvas overlays, the SKETCHES box) is inside the viewport, 44 px or more, and not covered
//    (the point at its centre is the control). Pen Plotter's own Design panel (Document, colours, checkboxes) is checked too (TASK 608);
//  - the page does not scroll; the SKETCHES box starts collapsed, a tap expands it inside the canvas, a tap collapses it;
//  - SketchStudio: the status bar (Log, Tune, the VIEW readout) is folded away; Log is in the menu and opens the log; Export is in the menu, opens the
//    Export view, and the header's Design button comes back.
import assert from 'node:assert';
import { launchBrowser, sleep } from './cdp-browser.js';

export const LANDSCAPE_HOSTS = [
  { name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas' },
  { name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', enter: `document.querySelector('[data-mode="design"]').click()` },
  { name: 'penplotter', url: '/apps/penplotter/index.html', canvas: '#design-canvas', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()` },
  { name: 'trace', url: '/apps/trace/index.html', canvas: '#design-canvas', enter: `document.querySelector('.tr-tab[data-tab="edit"]').click()` },
];
const SIZES = [{ w: 844, h: 390 }, { w: 780, h: 360 }];

/** Runs every landscape check for ONE host at both sizes (its own browser). */
export async function runPhoneLandscape(hostName) {
  const HOSTS = LANDSCAPE_HOSTS.filter((h) => h.name === hostName);
  if (HOSTS.length !== 1) throw new Error('phone-landscape: unknown host ' + hostName);
  const cdp = await launchBrowser({ tag: '602l-' + hostName, width: 844, height: 390 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const T = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 1, radiusY: 1, force: 1 })) });
    const tap = async (p) => { await T('touchStart', [p]); await sleep(40); await T('touchEnd', []); await sleep(250); };
    const rectOf = (expr) => evalJs(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    // the element at a point is `expr` or inside it
    const hits = (expr, p) => evalJs(`(() => { const e = ${expr}; const h = document.elementFromPoint(${p.x}, ${p.y}); return !!e && !!h && (e === h || e.contains(h)); })()`);
    const btn = (i) => `document.querySelectorAll('.sk-ribbon .sk-ribbon-btn')[${i}]`;

    for (const size of SIZES) {
      // no storage clearing between sizes (TASK 608): a window position remembered at the wider size is clamped whole inside the narrower screen
      await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      for (const h of HOSTS) {
        const tag = `${h.name} @${size.w}x${size.h}: `;
        await navigate(`http://127.0.0.1:${port}${h.url}`, 8000);
        if (h.enter) { await sleep(800); await evalJs(h.enter); }
        await waitFor(`!!document.querySelector('.sk-ribbon .sk-ribbon-btn') && !!document.querySelector('.sk-browser .sk-sketch-node')`, tag + 'the Design view');
        await sleep(600);
        assert.strictEqual(await evalJs(`matchMedia('(pointer: coarse)').matches && matchMedia('(orientation: landscape)').matches`), true, tag + 'a coarse pointer, landscape');

        // canvas share, the rail, no page scroll
        const cv = await rectOf(`document.querySelector('${h.canvas}')`);
        const rail = await rectOf(`document.querySelector('.sk-ribbon')`);
        const hdr = await rectOf(`document.querySelector('header')`);
        const share = cv.h / size.h;
        assert(share >= 0.6, tag + `the canvas is ${Math.round(share * 100)} % of the height (>= 60 %): ${JSON.stringify(cv)}`);
        assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('.sk-ribbon')).flexDirection`), 'column', tag + 'the ribbon is a column (a rail)');
        assert(rail.left <= 1 && rail.w <= 64 && rail.bottom >= size.h - 1 && rail.top >= hdr.bottom - 1, tag + 'the rail runs down the left edge from under the header: ' + JSON.stringify(rail));
        assert(cv.left >= rail.right - 1, tag + `the canvas is right of the rail (canvas ${cv.left}, rail ${rail.right})`);
        assert.strictEqual(await evalJs(`document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1`), true, tag + 'the page does not scroll');
        assert.strictEqual(await evalJs(`[...document.querySelectorAll('.sk-ribbon-group-label')].every((g) => getComputedStyle(g).display === 'none')`), true, tag + 'no group labels in the rail');

        // a real swipe scrolls the rail
        await evalJs(`document.querySelector('.sk-ribbon').scrollTop = 0`);
        const sx = Math.round(rail.left + rail.w / 2), y0 = Math.round(rail.bottom - 30), y1 = Math.round(rail.top + 30);
        await T('touchStart', [{ x: sx, y: y0 }]);
        for (let i = 1; i <= 10; i++) { await T('touchMove', [{ x: sx, y: Math.round(y0 + (y1 - y0) * i / 10) }]); await sleep(16); }
        await T('touchEnd', []); await sleep(500);
        const scrolled = await evalJs(`document.querySelector('.sk-ribbon').scrollTop`);
        assert(scrolled > 20, tag + 'a finger swipe scrolls the rail: scrollTop ' + scrolled);

        // every rail button: reachable, 44 px, not covered; a tool button activates with a real tap
        const n = await evalJs(`document.querySelectorAll('.sk-ribbon .sk-ribbon-btn').length`);
        const tapped = [];
        for (let i = 0; i < n; i++) {
          await evalJs(`${btn(i)}.scrollIntoView({ block: 'nearest' })`); await sleep(120);
          const b = await rectOf(btn(i));
          const info = await evalJs(`(() => { const b = ${btn(i)}; return { id: b.id, tool: b.dataset.tool || null, disabled: b.disabled, name: b.textContent.trim(), title: b.title }; })()`);
          const t = tag + `rail button ${info.id} "${info.name}"`;
          assert(info.name && info.title, t + ': keeps its label as the accessible name and the title');
          assert(b.w >= 44 && b.h >= 44, t + `: 44 px target (${b.w} x ${b.h})`);
          assert(b.top >= rail.top - 0.5 && b.bottom <= rail.bottom + 0.5 && b.left >= 0 && b.right <= rail.right + 0.5, t + ': inside the rail once scrolled to: ' + JSON.stringify(b));
          assert(await hits(btn(i), b), t + ': nothing covers it');
          if (info.tool && !info.disabled) {
            await tap(b);
            assert.strictEqual(await evalJs(`${btn(i)}.classList.contains('active') && document.querySelectorAll('.sk-ribbon .sk-ribbon-btn.active').length === 1`), true, t + ': a real tap makes it the active tool');
            tapped.push(info.tool);
            if (info.tool === 'rect') {
              // the variants menu opens beside the rail, inside the viewport; a tapped variant is chosen
              await waitFor(`!!document.querySelector('.sk-ribbon-menu.show')`, t + ' variants menu');
              const items = await evalJs(`[...document.querySelectorAll('.sk-ribbon-menu.show .sk-ribbon-menu-item')].map((e) => { const r = e.getBoundingClientRect(); return { mode: e.dataset.mode, left: r.left, top: r.top, right: r.right, bottom: r.bottom, h: r.height, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })`);
              assert.strictEqual(items.length, 3, t + ': three variants');
              for (const it of items) {
                assert(it.left >= rail.right - 1 && it.right <= size.w && it.top >= 0 && it.bottom <= size.h + 0.5 && it.h >= 44, t + ': variant inside the viewport, beside the rail, 44 px: ' + JSON.stringify(it));
                assert(await hits(`document.querySelector('.sk-ribbon-menu.show [data-mode="${it.mode}"]')`, it), t + `: variant ${it.mode} is not covered`);
              }
              const centre = items[1];
              await tap(centre);
              assert.strictEqual(await evalJs(`!document.querySelector('.sk-ribbon-menu.show') && document.querySelector('.sk-ribbon-menu [data-mode="${centre.mode}"]').classList.contains('active') && ${btn(i)}.classList.contains('active')`), true, t + ': the tapped variant is chosen, rect stays active');
            }
          } else if (info.id === 'btn-parameters') {
            await tap(b);
            const win = await rectOf(`document.querySelector('.sk-pwin')`);
            assert.strictEqual(await evalJs(`${btn(i)}.getAttribute('aria-pressed')`), 'true', t + ': a tap opens the Parameters window');
            assert(win && win.left >= 0 && win.top >= 0 && win.right <= size.w + 0.5 && win.bottom <= size.h + 0.5, t + ': the window is inside the viewport: ' + JSON.stringify(win));
            const x = await rectOf(`document.querySelector('.sk-pwin [aria-label="Close"]')`);
            await tap(x);
            assert.strictEqual(await evalJs(`${btn(i)}.getAttribute('aria-pressed')`), 'false', t + ': its close button closes it');
          }
        }
        assert(tapped.includes('select') && tapped.includes('line') && tapped.includes('dim') && tapped.includes('coincident'), tag + 'tools tapped: ' + tapped.join(','));
        await evalJs(`document.getElementById('tool-select').scrollIntoView({ block: 'nearest' })`); await sleep(100);
        await tap(await rectOf(`document.getElementById('tool-select')`));

        // the SKETCHES box: collapsed in landscape; a tap expands it inside the canvas; a tap collapses it
        assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').classList.contains('collapsed')`), true, tag + 'the SKETCHES box starts collapsed');
        const holder = await rectOf(`document.querySelector('.sk-browser').parentElement`);
        await tap(await rectOf(`document.querySelector('.sk-browser-toggle')`));
        const open = await rectOf(`document.querySelector('.sk-browser')`);
        assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').classList.contains('collapsed')`), false, tag + 'a tap expands it');
        assert(open.top >= holder.top && open.bottom <= holder.bottom + 0.5 && open.left >= holder.left && open.right <= holder.right + 0.5, tag + 'expanded, it stays inside the canvas: ' + JSON.stringify({ open, holder }));
        await tap(await rectOf(`document.querySelector('.sk-browser-toggle')`));
        assert.strictEqual(await evalJs(`document.querySelector('.sk-browser').classList.contains('collapsed')`), true, tag + 'a tap collapses it');

        // every other control on the screen: inside the viewport, 44 px, not covered
        const others = await evalJs(`(() => { const out = []; 
          for (const e of document.querySelectorAll('button, input, select, a[href], [role=tab]')) {
            if (e.closest('.sk-ribbon') || e.closest('.sk-sidebar') ) continue;
            if (e.closest('#design-panel-actions')) e.scrollIntoView({ block: 'nearest' }); // TASK 608: Pen Plotter's panel scrolls; a control is checked where a finger reaches it
            const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
            let hidden = false; for (let p = e; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden') { hidden = true; break; } } if (hidden) continue;
            const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
            out.push({ id: (e.id || e.className || e.tagName).toString().slice(0, 40), text: (e.textContent || '').trim().slice(0, 14), left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height, free: !!hit && (hit === e || e.contains(hit)) });
          } return out; })()`);
        assert(others.length >= 3, tag + 'header / canvas controls found: ' + others.length);
        for (const c of others) {
          const t = tag + `control ${c.id} "${c.text}"`;
          assert(c.left >= -0.5 && c.top >= -0.5 && c.right <= size.w + 0.5 && c.bottom <= size.h + 0.5, t + ' is inside the viewport: ' + JSON.stringify(c));
          const strip = /sk-doctab/.test(c.id); // TASK 608 (owner ruling, relaxes 562): the tab strip is a thin 31 px row: every tab / x / + is at least 24 x 24 (WCAG 2.2 AA) and fills the row
          const min = strip ? 24 : 43.5;
          assert(c.w >= min && c.h >= min, t + ` is a ${strip ? '24' : '44'} px target (${Math.round(c.w)} x ${Math.round(c.h)})`);
          assert(c.free, t + ' is not covered by anything');
        }

        if (h.name === 'sketchstudio') {
          // the status bar folds away; Log and Export are in the menu
          assert.strictEqual(await evalJs(`getComputedStyle(document.querySelector('footer')).display`), 'none', tag + 'the status bar is folded away (Log, Tune, VIEW readout)');
          assert.deepStrictEqual(await evalJs(`[...document.querySelectorAll('header .sk-header-tab')].map((t) => t.dataset.tab)`), ['design'], tag + 'the header has one mode button: Design');
          assert.strictEqual(await evalJs(`!!document.getElementById('save-status')`), false, tag + 'no "Saved" text');
          await tap(await rectOf(`document.querySelector('.sk-sidebar-btn')`)); await sleep(300);
          await evalJs(`document.querySelector('.sk-sidebar-item[data-action="phone-log"]').scrollIntoView({ block: 'nearest' })`); await sleep(100); // the menu scrolls
          const log = await rectOf(`document.querySelector('.sk-sidebar-item[data-action="phone-log"]')`);
          assert(log && log.h >= 44 && log.bottom <= size.h + 0.5, tag + 'the menu has Log: ' + JSON.stringify(log));
          await tap(log);
          assert.strictEqual(await evalJs(`!document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`), true, tag + 'Log from the menu opens the log');
          await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
          await tap(await rectOf(`document.querySelector('.sk-sidebar-btn')`)); await sleep(300);
          await evalJs(`document.querySelector('.sk-sidebar-item[data-action="export"]').scrollIntoView({ block: 'nearest' })`); await sleep(100);
          await tap(await rectOf(`document.querySelector('.sk-sidebar-item[data-action="export"]')`));
          assert.strictEqual(await evalJs(`!document.getElementById('export-panel').classList.contains('hidden') && getComputedStyle(document.getElementById('toolsRibbon')).display === 'none'`), true, tag + 'Export from the menu shows the Export view');
          await tap(await rectOf(`document.querySelector('header .sk-header-tab[data-tab="design"]')`));
          assert.strictEqual(await evalJs(`document.getElementById('export-panel').classList.contains('hidden') && getComputedStyle(document.getElementById('toolsRibbon')).display !== 'none'`), true, tag + 'the header Design button brings the Design view back');
        }
        console.log(`phone-landscape ${tag}canvas ${Math.round(share * 100)} % (${Math.round(cv.h)} px), rail ${Math.round(rail.w)} px wide, ${n} rail buttons reachable, ${tapped.length} tools tapped, ${others.length} other controls ok`);
      }
    }
    console.log(`LIVE-OK phone-landscape ${hostName}: 844x390 and 780x360: canvas >= 60 %, rail, every tool reachable + tapped, controls 44 px and uncovered`);
  } finally { await cdp.close(); }
}
