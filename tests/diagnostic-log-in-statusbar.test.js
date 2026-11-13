// tests/diagnostic-log-in-statusbar.test.js — TASK 509: SketchStudio's Diagnostic log button lives in the bottom status bar (the spot the old
// "MODE: ..." label held), the SAME layout at phone (390) and desktop (1440) width: no #modeText, no header copy of the toggle, the button is fully
// on screen, the status bar does not overflow sideways, and a real click opens the log with Copy Report visible and enabled.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '509', width: 390, height: 844 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(200);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const shot = async (name) => {
      if (!process.env.EVIDENCE_DIR) return;
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
    };
    const LOG_OPEN = `!!document.querySelector('.sk-diag-panel') && !document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`;

    for (const [width, height] of [[390, 844], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 10000);
      await waitFor(`!!document.querySelector('footer .sk-diag-toggle')`, `@${width}: the log button in the status bar`);
      const label = `@${width}`;
      assert.strictEqual(await evalJs(`!!document.getElementById('modeText') || /MODE:/.test(document.querySelector('footer').textContent)`), false, `${label}: the MODE label is gone`);
      assert.strictEqual(await evalJs(`document.querySelectorAll('.sk-diag-toggle').length`), 1, `${label}: one log button only`);
      assert.strictEqual(await evalJs(`!!document.querySelector('header .sk-diag-toggle, #app-header-host .sk-diag-toggle')`), false, `${label}: none in the header`);
      const r = await evalJs(`(() => { const b = document.querySelector('footer .sk-diag-toggle').getBoundingClientRect(); const f = document.querySelector('footer'); return { l: b.left, r: b.right, w: b.width, fOver: f.scrollWidth - f.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, shown: getComputedStyle(document.querySelector('footer .sk-diag-toggle')).display !== 'none' }; })()`);
      const phone = width <= 640; // TASK 562: at phone width the footer's Log button lives in the menu (header menu > Log) instead
      if (phone) assert.ok(r.w === 0, `${label}: the footer Log button is hidden on a phone (it is in the menu)`);
      else assert.ok(r.shown && r.w > 0 && r.l >= 0 && r.r <= width, `${label}: the button is fully on screen ${JSON.stringify(r)}`);
      assert.ok(r.fOver <= 0 && r.doc <= 0, `${label}: the status bar and page do not overflow sideways ${JSON.stringify(r)}`);
      await shot(`statusbar-${width}.png`);
      if (phone) { await clickEl('.sk-sidebar-btn'); await sleep(400); await clickEl('.sk-sidebar [data-action="phone-log"]'); }
      else await clickEl('footer .sk-diag-toggle');
      await waitFor(LOG_OPEN, `${label}: the log to open`);
      assert.strictEqual(await evalJs(`(() => { const b = document.querySelector('.sk-diag-panel .sk-diag-btn-primary'); const q = b.getBoundingClientRect(); return b.textContent === 'Copy Report' && !b.disabled && q.width > 0 && q.right <= innerWidth; })()`), true, `${label}: Copy Report is visible and enabled`);
      await shot(`statuslog-${width}.png`);
      await clickEl('.sk-diag-panel .sk-diag-close');
      await waitFor(`!(${LOG_OPEN})`, `${label}: the log to close`);
    }
    console.log('diagnostic-log-in-statusbar: OK');
  } finally {
    await cdp.close();
  }
})();
