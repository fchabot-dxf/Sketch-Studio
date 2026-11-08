// tests/penplotter-panel-overflow.test.js — TASK 446: the Toolpath stage's side panel keeps every row inside the panel,
// so the pen row's delete "x" is reachable by a REAL mouse click at every window width. Headless CDP, real mouse events.
// At 1280 / 1600 / 1920 px: (a) no element in #toolpathPanel extends past the panel's right edge, (b) elementFromPoint at the
// x centre IS the x, (c) a real click on it deletes the pen. EVIDENCE_DIR=<dir> also saves a panel screenshot per width.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sendRealKey, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '446' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;

  try {
    const penCount = () => evalJs('window.__draw.state.plotColors.length');
    const addPen = async () => { const n = await penCount(); await clickEl('#addPlotColor'); await waitFor('window.__draw.state.plotColors.length === ' + (n + 1), 'pen added'); };
    const key = async (k, code, vk, modifiers = 0, text = '') => { await sendRealKey(send, k, code, vk, modifiers, text); await sleep(200); };
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(150);
    };
    const clickEl = async (sel) => {
      await waitFor(`(() => { const e = document.querySelector('${sel}'); return !!e && e.getClientRects().length > 0; })()`, sel + ' visible');
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const stageTab = (name) => clickEl(`.stage-btn[data-stage="${name}"]`);
    const clickAt = click;
    await navigate(`http://127.0.0.1:${port}/apps/penplotter/index.html`);
    await waitFor('!!(window.__draw && window.__draw.state && window.__draw.state.plotColors)', 'penplotter app ready');
    await stageTab('toolpath');
    await waitFor("!!document.getElementById('toolpathPanel') && document.getElementById('toolpathPanel').getClientRects().length > 0", 'toolpath panel visible');
    await addPen();
    await addPen();
    await clickEl('#addFillTp'); // more operation rows (fill + outline) so their rows are measured too
    await key('Escape', 'Escape', 27);
    // a long pen name must not widen the row either (test setup through the state, then the shared panel render)
    await evalJs(`(async () => { window.__draw.state.plotColors[1].name = 'A very long pen name that should be truncated not overflow'; (await import('/apps/penplotter/src/plot-colors-panel.js')).renderPlotColorsPanel(); })()`);

    for (const width of [1280, 1600, 1920]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await waitFor(`window.innerWidth === ${width}`, 'viewport resized');
      await waitFor(`new Promise((res) => { const p = document.getElementById('toolpathPanel'); const s = () => { const r = p.getBoundingClientRect(); return r.left + ',' + r.right + ',' + r.height; }; let last = s(), n = 0; const tick = () => { const c = s(); n = c === last ? n + 1 : 0; last = c; if (n >= 5) res(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`, 'stable panel layout');
      const m = await evalJs(`(() => {
        const panel = document.getElementById('toolpathPanel');
        const pr = panel.getBoundingClientRect();
        // every visible side panel of the stage (pens, operations rows, settings fields, the fill/outline editor)
        const over = [];
        for (const root of [panel, document.getElementById('activeLayerPanel')].filter(r => r && r.getClientRects().length)) {
          const rr = root.getBoundingClientRect();
          for (const e of root.querySelectorAll('*')) {
            const r = e.getBoundingClientRect();
            if (r.width > 0 && r.right > rr.right + 1 && getComputedStyle(e).position !== 'fixed') over.push(root.id + ' > ' + e.tagName + '.' + e.className + ' right=' + Math.round(r.right));
          }
        }
        const del = document.querySelector('.pc-row:last-child .pc-del');
        const r = del.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { panelRight: Math.round(pr.right), over, delRight: Math.round(r.right), topIsDel: top === del, top: top.tagName + '.' + top.className,
                 cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), pens: window.__draw.state.plotColors.length };
      })()`);
      console.log(`${width}px: panelRight=${m.panelRight} x.right=${m.delRight} topIsDel=${m.topIsDel} (${m.top}) overflow=${JSON.stringify(m.over)}`);
      if (process.env.EVIDENCE_DIR) {
        const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 420, height: 420, scale: 2 } });
        fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `pens-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      assert.deepStrictEqual(m.over, [], `${width}px: nothing in the panel may extend past its right edge`);
      assert.strictEqual(m.topIsDel, true, `${width}px: elementFromPoint at the x centre must be the x itself, got ${m.top}`);
      await clickAt(m.cx, m.cy);
      await waitFor(`window.__draw.state.plotColors.length === ${m.pens - 1}`, 'pen deleted');
      const after = await penCount();
      assert.strictEqual(after, m.pens - 1, `${width}px: a real click on the x deletes the pen`);
      await addPen(); // restore the pen count for the next width
    }
    console.log('penplotter-panel-overflow: ok');
  } finally {
    await cdp.close();
  }
})();
