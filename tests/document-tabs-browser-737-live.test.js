// tests/document-tabs-browser-737-live.test.js — TASK 737 (owner turn 2074: "make the file tab nicer or clearer", picked BROWSER-STYLE): the ONE shared document tab
// strip in the real pages of all four apps, with a mouse (1400 x 800) and under a finger (390 x 844), in EVERY stage of each app (Shaper: Design, Vcarve, Prepare,
// Export; Pen Plotter: Design, Prepare, Export; Trace: Trace, Design, Export; SketchStudio: Design and its menu's Export view):
//   - the ACTIVE tab JOINS the surface directly below the strip: its computed background == the computed background of the element under it (sampled at three
//     points across the tab, just below the strip; a tool button sitting there is skipped: the surface is what holds it). The colour is DECLARED per host / stage
//     (--sk-doctab-surface, html[data-sk-stage]), never measured by the page. The first tab is the active one: the side panels of Shaper Vcarve, Pen Plotter
//     Prepare / Export and Trace's Trace stage (244-260 px) sit under it; a tab further right sits over that stage's canvas (reported in WORK-LOG TURN 737);
//   - no 1 px line under the active tab (screenshot pixels: the strip's line row under it == the tab's own fill), while the line IS there under an inactive tab;
//   - a 3 px accent line on the active tab's top edge (pixels); the active tab's fill differs from the strip (>= 1.08:1, the lowest being SketchStudio's Export view; the accent line and the bold title mark it too);
//   - an inactive tab is flat (no border, no fill), its title >= 4.5:1 against the strip and dimmer than the active title; a separator between two inactive tabs,
//     hidden next to the active one; the "+" is flat (no border, no fill) and keeps its size (>= 44 px wide under a finger);
//   - the not-saved dot sits in the close x's place: with a mouse an inactive tab shows the dot, hovering it shows the x instead, and the active tab not hovered
//     shows its dot; under a finger (no hover) the active tab shows the x, an inactive one its dot (SketchStudio and Shaper, where the test draws a line).
// EVIDENCE_DIR=<dir> saves one strip screenshot per app / stage / mode.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '737', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  await installFakeDriveSession(cdp);
  const out = [];
  try {
    const move = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(150); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(250);
    };
    const center = (sel, i = 0) => evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const clickEl = async (sel, i = 0) => { const c = await center(sel, i); assert(c, sel + ' #' + i + ' not found'); await click(c.x, c.y); };
    const tabCount = () => evalJs(`document.querySelectorAll('.sk-doctab').length`);
    const newTab = async (tag) => {
      const n = await tabCount();
      await clickEl('.sk-doctab-new');
      await sleep(300);
      if (await evalJs(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`)) await clickEl('.sk-tp-card[data-template="blank"]');
      await waitFor(`document.querySelectorAll('.sk-doctab').length === ${n + 1}`, tag + ': a new tab');
      await sleep(400);
    };
    // screenshot pixels, decoded in the page (no PNG library in node): rows x cols of [r, g, b] over a CSS-px clip
    const pixels = async (clip) => {
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
      return evalJs(`new Promise((res, rej) => { const im = new Image(); im.onerror = () => rej(new Error('png decode')); im.onload = () => {
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
        res({ w: im.width, h: im.height, d: Array.from(g.getImageData(0, 0, im.width, im.height).data) }); }; im.src = 'data:image/png;base64,${s.data}'; })`);
    };
    const px = (img, fx, fy) => { const x = Math.min(img.w - 1, Math.floor(fx * img.w)), y = Math.min(img.h - 1, Math.floor(fy * img.h)); const i = (y * img.w + x) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2]]; };
    const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
    const MEASURE = `(() => {
      const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = (css) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const strip = document.querySelector('.sk-doctabs'); const sr = strip.getBoundingClientRect();
      const act = strip.querySelector('.sk-doctab.active'), ina = strip.querySelector('.sk-doctab:not(.active)');
      const ar = act.getBoundingClientRect(), ir = ina.getBoundingClientRect();
      const ac = getComputedStyle(act), ic = getComputedStyle(ina), nc = getComputedStyle(strip.querySelector('.sk-doctab-new'));
      const stripBg = rgb(getComputedStyle(strip).backgroundColor);
      const label = (e) => e.tagName + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
      const under = [0.3, 0.5, 0.7].map((f) => { // the surface just below the strip, under the active tab
        let e = document.elementFromPoint(ar.left + f * ar.width, sr.bottom + 1);
        if (e && e.closest('button, input, select')) e = e.closest('button, input, select').parentElement;
        while (e && rgb(getComputedStyle(e).backgroundColor)[3] === 0) e = e.parentElement;
        return e ? { el: label(e), bg: rgb(getComputedStyle(e).backgroundColor) } : null;
      });
      const before = (e) => getComputedStyle(e, '::before');
      const tabs = [...strip.querySelectorAll('.sk-doctab')];
      return {
        stage: document.documentElement.dataset.skStage, stripBottom: sr.bottom,
        active: { left: ar.left, width: ar.width, top: ar.top, bottom: ar.bottom, bg: rgb(ac.backgroundColor), weight: +ac.fontWeight, contrast: ratio(rgb(ac.color), rgb(ac.backgroundColor)), vsStrip: ratio(rgb(ac.backgroundColor), stripBg) },
        inactive: { left: ir.left, width: ir.width, bg: rgb(ic.backgroundColor), border: [ic.borderTopWidth, ic.borderLeftWidth, ic.borderRightWidth].map(parseFloat), weight: +ic.fontWeight, contrast: ratio(rgb(ic.color), stripBg), full: ratio(rgb(getComputedStyle(strip).color), stripBg) },
        under, accent: rgb(getComputedStyle(strip).getPropertyValue('--sk-doctab-acc')),
        plus: { border: parseFloat(nc.borderTopWidth), bg: rgb(nc.backgroundColor), w: Math.round(strip.querySelector('.sk-doctab-new').getBoundingClientRect().width), h: Math.round(strip.querySelector('.sk-doctab-new').getBoundingClientRect().height) },
        seps: tabs.map((t, i) => i === 0 ? null : { shown: before(t).content !== 'none' && before(t).visibility === 'visible', w: parseFloat(before(t).width), activeNext: t.classList.contains('active') || tabs[i - 1].classList.contains('active') }),
      };
    })()`;
    const DOTSTATE = `(() => { const t = [...document.querySelectorAll('.sk-doctab')].find((e) => e.querySelector('.sk-doctab-dot')); if (!t) return null;
      const d = t.querySelector('.sk-doctab-dot'), g = t.querySelector('.sk-doctab-xg'), x = t.querySelector('.sk-doctab-x');
      const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible';
      const dr = d.getBoundingClientRect(), xr = x.getBoundingClientRect();
      return { active: t.classList.contains('active'), index: [...t.parentElement.querySelectorAll('.sk-doctab')].indexOf(t), dot: vis(d), x: vis(g),
        dotInX: !vis(d) || (dr.left >= xr.left && dr.right <= xr.right && Math.abs((dr.top + dr.bottom) / 2 - (xr.top + xr.bottom) / 2) < 2), xSize: [Math.round(xr.width), Math.round(xr.height)] }; })()`;
    const shot = async (name, clip) => {
      if (!process.env.EVIDENCE_DIR) return;
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
    };

    for (const mode of ['desktop', 'phone']) {
      const phone = mode === 'phone';
      if (phone) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      const W = phone ? 390 : 1400;
      for (const host of ['sketchstudio', 'shaper', 'penplotter', 'trace']) {
        const tag0 = `${host} ${mode}`;
        const drawn = host === 'sketchstudio' || host === 'shaper'; // the not-saved dot needs a drawing in the Untitled tab: the shared Design canvas these two open "+" in
        await resetBufferLive(cdp);
        await navigate(`http://127.0.0.1:${port}/apps/${host}/index.html`, 10000);
        await evalJs(`localStorage.setItem('shaper-mode', 'design'); localStorage.setItem('penplotter-stage', 'design')`);
        await evalJs(CREATE_NAMED_DESIGN(host, 'Alpha'));
        await navigate(`http://127.0.0.1:${port}/apps/${host}/index.html`, 10000);
        await waitFor(`!!document.querySelector('.sk-doctab-name') && document.querySelector('.sk-doctab-name').textContent === 'Alpha'`, tag0 + ': the restored design');
        await sleep(500);
        await newTab(tag0);
        if (drawn) { // a line in the Untitled tab (real keys and pointer): its not-saved dot; then a third, empty tab (a separator between two inactive tabs)
          await sendRealKey(send, 'l', 'KeyL', 76, 0, 'l');
          await click(Math.round(W * 0.3), phone ? 450 : 400); await click(Math.round(W * 0.6), phone ? 450 : 400);
          await sendRealKey(send, 'Escape', 'Escape', 27); await sleep(300);
          await waitFor(`!!document.querySelector('.sk-doctab-dot:not(.saving)')`, tag0 + ': the not-saved dot');
          await newTab(tag0);
        }
        await clickEl('.sk-doctab-main', 0);
        await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Alpha'`, tag0 + ': the first tab active');
        await move(5, phone ? 800 : 780);

        if (drawn) { // ---- the dot / x swap
          let s = await evalJs(DOTSTATE);
          assert(s && !s.active && s.dot && !s.x && s.dotInX, tag0 + ': an inactive not-saved tab shows its dot, in the close x place, not the x: ' + JSON.stringify(s));
          assert(s.xSize[0] >= (phone ? 44 : 24) && s.xSize[1] >= 24, tag0 + ': the close x keeps its target size: ' + JSON.stringify(s.xSize));
          if (!phone) {
            const c = await center('.sk-doctab-name', s.index); await move(c.x, c.y);
            const h = await evalJs(DOTSTATE);
            assert(!h.dot && h.x, tag0 + ': hovering the inactive tab shows the x instead of the dot: ' + JSON.stringify(h));
            const dc = await evalJs(`(() => { const t = document.querySelectorAll('.sk-doctab')[${s.index}]; const r = t.querySelector('.sk-doctab-x').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
            await move(5, 780); await move(dc.x, dc.y); // over the dot itself
            assert.strictEqual((await evalJs(DOTSTATE)).x, true, tag0 + ': hovering the dot shows the x');
            await move(5, 780);
          }
          await clickEl('.sk-doctab-main', s.index); await waitFor(`document.querySelectorAll('.sk-doctab')[${s.index}].classList.contains('active')`, tag0 + ': the not-saved tab active');
          await move(5, phone ? 800 : 780);
          s = await evalJs(DOTSTATE);
          if (phone) assert(s.active && s.x && !s.dot, tag0 + ': under a finger the ACTIVE not-saved tab shows its x (no hover to reveal it): ' + JSON.stringify(s));
          else assert(s.active && s.dot && !s.x && s.dotInX, tag0 + ': with a mouse the active not-saved tab, not hovered, shows its dot: ' + JSON.stringify(s));
          await clickEl('.sk-doctab-main', 0); await waitFor(`document.querySelector('.sk-doctab.active .sk-doctab-name').textContent === 'Alpha'`, tag0 + ': Alpha active again');
          await move(5, phone ? 800 : 780);
          out.push(`${tag0}: dot/x swap ok`);
        }

        const stages = await evalJs(`[...document.querySelectorAll('.sk-header-tab')].map((t) => t.dataset.tab)`);
        if (host === 'sketchstudio') stages.push('export'); // its menu's Export view
        for (const st of stages) {
          const tag = `${tag0} ${st}`;
          if (host === 'sketchstudio' && st === 'export') {
            await evalJs(`document.querySelector('header button').click()`); await sleep(400);
            await evalJs(`document.querySelector('.sk-sidebar-item[data-action="export"]').click()`); await sleep(600);
          } else { await evalJs(`document.querySelector('.sk-header-tab[data-tab="${st}"]').click()`); await sleep(700); }
          await move(5, phone ? 800 : 780);
          const m = await evalJs(MEASURE);
          assert.strictEqual(m.stage, st, tag + ': html[data-sk-stage] names the shown stage');
          // 1. the join: the active tab's fill == the surface under it
          for (const u of m.under) {
            assert(u, tag + ': a surface under the active tab');
            assert.deepStrictEqual(m.active.bg.slice(0, 3), u.bg.slice(0, 3), `${tag}: the active tab's background is the surface's below it (${u.el})`);
          }
          // 2. no line under the active tab; the line IS under an inactive one (pixels: rows stripBottom-2 .. stripBottom+2)
          const y0 = Math.round(m.stripBottom) - 2;
          const a = await pixels({ x: Math.round(m.active.left + m.active.width * 0.3), y: y0, width: Math.round(m.active.width * 0.4), height: 4 });
          for (const fx of [0.1, 0.5, 0.9]) {
            const body = px(a, fx, 0.125), lineRow = px(a, fx, 0.375);
            assert(near(lineRow, body) && near(lineRow, m.active.bg), `${tag}: no line under the active tab (tab ${body}, line row ${lineRow}, fill ${m.active.bg.slice(0, 3)})`);
          }
          const iw = Math.max(4, Math.round(m.inactive.width * 0.3));
          const ib = await pixels({ x: Math.round(m.inactive.left + m.inactive.width * 0.35), y: y0, width: iw, height: 4 });
          assert(!near(px(ib, 0.5, 0.375), px(ib, 0.5, 0.125)), `${tag}: the strip's line runs under the inactive tab (${px(ib, 0.5, 0.125)} / ${px(ib, 0.5, 0.375)})`);
          // 3. the accent line on the active tab's top edge
          const top = await pixels({ x: Math.round(m.active.left + m.active.width / 2) - 2, y: Math.round(m.active.top), width: 4, height: 3 });
          assert(near(px(top, 0.5, 0.5), m.accent.slice(0, 3), 4), `${tag}: a 3 px accent line on the active tab's top (${px(top, 0.5, 0.5)} vs ${m.accent.slice(0, 3)})`);
          // 4. inactive tabs: flat, dimmer, readable; separators; the flat "+"
          assert(m.inactive.border.every((w) => w === 0) && m.inactive.bg[3] === 0, `${tag}: an inactive tab is flat (no border, no fill): ${JSON.stringify(m.inactive)}`);
          assert(m.inactive.contrast >= 4.5, `${tag}: inactive title >= 4.5:1 against the strip: ${m.inactive.contrast.toFixed(2)}`);
          assert(m.inactive.contrast < m.inactive.full && m.inactive.weight < m.active.weight && m.active.weight >= 700, `${tag}: the inactive title is dimmer than full strength and not bold: ${JSON.stringify([m.inactive.contrast, m.inactive.full, m.inactive.weight, m.active.weight])}`);
          assert(m.active.contrast >= 4.5, `${tag}: active title >= 4.5:1 on its fill: ${m.active.contrast.toFixed(2)}`);
          // the lowest is SketchStudio's Export view (its #F0F0F0 page under the light grey strip: 1.10:1); the accent line and the bold title mark the tab there too
          assert(m.active.vsStrip >= 1.08, `${tag}: the active tab's fill stands out from the strip: ${m.active.vsStrip.toFixed(3)}:1`);
          for (const [i, s] of m.seps.entries()) if (s) assert.strictEqual(s.shown, !s.activeNext, `${tag}: separator before tab ${i}: shown between two inactive tabs only: ${JSON.stringify(s)}`);
          if (m.seps.length >= 3) assert(m.seps[2].shown && m.seps[2].w === 1, `${tag}: a 1 px separator between the two inactive tabs`);
          assert(m.plus.border === 0 && m.plus.bg[3] === 0 && m.plus.w >= (phone ? 44 : 28) && m.plus.h >= 24, `${tag}: the "+" is a flat icon button of the same size: ${JSON.stringify(m.plus)}`);
          await shot(`${host}-${st}-${mode}.png`, { x: 0, y: Math.max(0, Math.round(m.stripBottom) - 40), width: Math.min(W, 620), height: 70 });
          out.push(`${tag}: active ${m.active.bg.slice(0, 3)} == surface ${m.under.map((u) => u.el).join(' / ')}, inactive text ${m.inactive.contrast.toFixed(2)}:1 (full ${m.inactive.full.toFixed(2)}:1), active text ${m.active.contrast.toFixed(2)}:1, active tab vs strip ${m.active.vsStrip.toFixed(2)}:1`);
        }
        if (host === 'sketchstudio') { await evalJs(`document.querySelector('.sk-header-tab[data-tab="design"]').click()`); await sleep(300); }
      }
      if (phone) { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }); }
    }
    console.log(out.join('\n'));
    console.log('document-tabs-browser-737-live: ok');
  } finally { await cdp.close(); }
})();
