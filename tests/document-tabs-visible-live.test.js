// tests/document-tabs-visible-live.test.js — TASK 681 (owner turn 1749: "would be great if tabs were better visible"): the ONE shared tab strip is clearly visible in all four
// hosts (SketchStudio light, Shaper dark, Pen Plotter paper, Trace dark), with a mouse (1400 x 800) and under a finger (390 x 844). Measured from the real page:
//   - the ACTIVE tab: a >= 3 px top line in the host's accent colour, its background is the work area's below it (--sk-ribbon-bg), a bold title;
//   - an INACTIVE tab: title contrast >= 4.5:1 against the strip, a visible outline, hover changes its background (mouse);
//   - tab height: 32 px with a mouse, 30 px under a finger (TASK 608's thin phone strip kept, owner ruling), titles 13 px;
//   - the "+" is an outlined button; the close x and the unsaved dot are inside their tab and vertically centred.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { installFakeDriveSession } from './helpers/fake-drive-session.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '681', width: 1400, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  await installFakeDriveSession(cdp);
  const out = [];
  try {
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
    };
    const center = (sel, i = 0) => evalJs(`(() => { const e = document.querySelectorAll('${sel}')[${i}]; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const MEASURE = `(() => {
      const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = (css) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = css; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const probe = (decl) => { const p = document.createElement('div'); p.style.cssText = 'position:fixed;visibility:hidden;' + decl; document.body.appendChild(p); const cs = getComputedStyle(p); const v = [cs.color, cs.backgroundColor]; p.remove(); return v; };
      const strip = document.querySelector('.sk-doctabs');
      const act = strip.querySelector('.sk-doctab.active'), ina = strip.querySelector('.sk-doctab:not(.active)');
      const sc = getComputedStyle(strip), ac = getComputedStyle(act), ic = getComputedStyle(ina), nc = getComputedStyle(strip.querySelector('.sk-doctab-new'));
      const stripBg = rgb(sc.backgroundColor);
      const accent = rgb(probe('color: var(--sk-doctab-accent, var(--sk-selection, #3B82F6));')[0]);
      const work = rgb(probe('background-color: var(--sk-ribbon-bg, #ffffff);')[1]);
      const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
      const tabR = ina.getBoundingClientRect();
      const dot = document.querySelector('.sk-doctab-dot'); const dotTab = dot && dot.closest('.sk-doctab');
      const x = ina.querySelector('.sk-doctab-x');
      return {
        activeTop: { w: parseFloat(ac.borderTopWidth), colour: rgb(ac.borderTopColor), accent, same: rgb(ac.borderTopColor).join() === accent.join() },
        activeBg: rgb(ac.backgroundColor), work, stripBg, activeWeight: +ac.fontWeight, inactiveWeight: +ic.fontWeight,
        activeVsStrip: ratio(rgb(ac.backgroundColor), stripBg),
        inactiveContrast: ratio(rgb(ic.color), stripBg), activeContrast: ratio(rgb(ac.color), rgb(ac.backgroundColor)),
        outline: { w: parseFloat(ic.borderLeftWidth), vsStrip: ratio(rgb(ic.borderLeftColor), stripBg), topAlpha: (cv.clearRect(0, 0, 1, 1), cv.fillStyle = ic.borderTopColor, cv.fillRect(0, 0, 1, 1), cv.getImageData(0, 0, 1, 1).data[3]), topW: parseFloat(ic.borderTopWidth), topStyle: ic.borderTopStyle, topVsStrip: ratio(rgb(ic.borderTopColor), stripBg), rightW: parseFloat(ic.borderRightWidth), rightVsStrip: ratio(rgb(ic.borderRightColor), stripBg) },
        h: Math.round(ina.getBoundingClientRect().height), font: parseFloat(getComputedStyle(act.querySelector('.sk-doctab-name')).fontSize),
        plus: { border: parseFloat(nc.borderTopWidth), vsStrip: ratio(rgb(nc.borderTopColor), stripBg), w: Math.round(strip.querySelector('.sk-doctab-new').getBoundingClientRect().width) },
        xInside: x.getBoundingClientRect().right <= tabR.right + 0.5 && Math.abs(mid(x) - mid(ina)) < 4 && x.getBoundingClientRect().width >= 18,
        dot: dot ? { inside: dot.getBoundingClientRect().right <= dotTab.getBoundingClientRect().right && dot.getBoundingClientRect().left >= dotTab.getBoundingClientRect().left, centred: Math.abs(mid(dot) - mid(dotTab)) < 4, w: Math.round(dot.getBoundingClientRect().width) } : null,
      };
    })()`;
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
      for (const host of ['sketchstudio', 'shaper', 'penplotter', 'trace']) {
        const tag = `${host} ${mode}`;
        await navigate(`http://127.0.0.1:${port}/apps/${host}/index.html`, 10000);
        await waitFor(`!!document.querySelector('.sk-doctab-name')`, tag + ': the strip');
        // a second tab (a real click on "+", then the Blank card when the template modal opens): one active, one inactive
        if (await evalJs(`document.querySelectorAll('.sk-doctab').length < 2`)) {
          const c = await center('.sk-doctab-new'); await click(c.x, c.y);
          if (await evalJs(`!!document.querySelector('.sk-tp-card[data-template="blank"]')`)) { const b = await center('.sk-tp-card[data-template="blank"]'); await click(b.x, b.y); }
          await waitFor(`document.querySelectorAll('.sk-doctab').length >= 2`, tag + ': two tabs');
        }
        await sleep(400);
        const m = await evalJs(MEASURE);
        const r = await evalJs(`(() => { const s = document.querySelector('.sk-doctabs').getBoundingClientRect(); return { x: 0, y: Math.max(0, s.top - 4), width: Math.min(window.innerWidth, 560), height: s.height + 8 }; })()`);
        await shot(`${host}-${mode}.png`, r);
        out.push(`${tag}: inactive text ${m.inactiveContrast.toFixed(2)}:1, active text ${m.activeContrast.toFixed(2)}:1, active tab vs strip ${m.activeVsStrip.toFixed(2)}:1, outline ${m.outline.vsStrip.toFixed(2)}:1, tab ${m.h}px, ${m.font}px, accent line ${m.activeTop.w}px rgb(${m.activeTop.colour})`);
        assert(m.activeTop.w >= 3 && m.activeTop.same, tag + ': the active tab has a >= 3 px top line in the host accent: ' + JSON.stringify(m.activeTop));
        assert.deepStrictEqual(m.activeBg, m.work, tag + ': the active tab has the work area background (--sk-ribbon-bg)');
        assert(m.activeVsStrip >= 1.15 && m.activeWeight >= 700 && m.inactiveWeight < m.activeWeight, tag + ': the active tab stands out from the strip and its title is bolder: ' + JSON.stringify([m.activeVsStrip, m.activeWeight, m.inactiveWeight]));
        assert(m.inactiveContrast >= 4.5 && m.activeContrast >= 4.5, tag + ': title contrast >= 4.5:1: ' + JSON.stringify([m.inactiveContrast, m.activeContrast]));
        assert(m.outline.w >= 1 && m.outline.vsStrip >= 1.5 && m.outline.rightW >= 1 && m.outline.rightVsStrip >= 1.5 && m.outline.topW >= 1 && m.outline.topAlpha > 100 && m.outline.topStyle === 'solid' && m.outline.topVsStrip >= 1.5, tag + ': an inactive tab has a complete visible outline (top, left, right) against the strip: ' + JSON.stringify(m.outline));
        assert.strictEqual(m.h, phone ? 30 : 32, tag + ': tab height (32 px mouse, 30 px finger: the TASK 608 thin phone strip kept)');
        assert.strictEqual(m.font, 13, tag + ': 13 px titles');
        assert(m.plus.border >= 1 && m.plus.vsStrip >= 1.5 && m.plus.w >= (phone ? 44 : 28), tag + ': "+" is an outlined button: ' + JSON.stringify(m.plus));
        assert(m.xInside, tag + ': the close x is inside its tab and centred');
        if (m.dot) assert(m.dot.inside && m.dot.centred && m.dot.w >= 6, tag + ': the unsaved dot is inside its tab and centred: ' + JSON.stringify(m.dot));
        if (!phone) { // hover: a real mouse over the inactive tab changes its background
          const before = await evalJs(`getComputedStyle(document.querySelector('.sk-doctab:not(.active)')).backgroundColor`);
          const c = await center('.sk-doctab:not(.active) .sk-doctab-name');
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' }); await sleep(200);
          const after = await evalJs(`getComputedStyle(document.querySelector('.sk-doctab:not(.active)')).backgroundColor`);
          assert.notStrictEqual(after, before, tag + ': hover changes the inactive tab background');
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 700, button: 'none' }); await sleep(100);
        }
      }
      if (phone) { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }); }
    }
    console.log(out.join('\n'));
    console.log('document-tabs-visible-live: ok');
  } finally { await cdp.close(); }
})();
