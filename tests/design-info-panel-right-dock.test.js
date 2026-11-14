// tests/design-info-panel-right-dock.test.js — TASK 475 #6: the Design side panel (#design-panel) docks on the RIGHT of
// the canvas in every host that still has one: since task 586 only Pen Plotter (Document + Style controls); the SKETCHES tree left
// every side panel for the floating browser (tests/design-browser-live.test.js).
// Headless CDP. Per host: the panel's box is right of the canvas centre, does not overlap the canvas, the canvas keeps a
// real size, and the collapse arrow points right (open) / left (collapsed). EVIDENCE_DIR=<dir> saves a screenshot per host.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '475r' });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;

  try {
    const stable = (sel) => waitFor(`new Promise((res) => { const p = document.querySelector('${sel}'); const s = () => { const r = p.getBoundingClientRect(); return r.left + ',' + r.right + ',' + r.height; }; let last = s(), n = 0; const tick = () => { const c = s(); n = c === last ? n + 1 : 0; last = c; if (n >= 5) res(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })`, 'stable layout ' + sel);

    const hosts = [
      { name: 'penplotter', url: '/apps/penplotter/index.html', enter: `document.querySelector('.stage-btn[data-stage="design"]').click()` },
    ];
    for (const h of hosts) {
      await navigate(`http://127.0.0.1:${port}${h.url}`, 4000);
      await waitFor(`!!document.querySelector('#design-panel')`, h.name + ' app ready');
      await evalJs(h.enter);
      await waitFor(`document.querySelector('#design-panel').getClientRects().length > 0 && document.querySelector('#design-canvas').getClientRects().length > 0`, h.name + ' design visible');
      await stable('#design-panel');
      const m = await evalJs(`(() => {
        const p = document.querySelector('#design-panel').getBoundingClientRect();
        const c = document.querySelector('#design-canvas').getBoundingClientRect();
        const t = document.getElementById('design-panel-toggle');
        return { pl: p.left, pr: p.right, pw: p.width, cl: c.left, cr: c.right, cw: c.width, ch: c.height, arrow: t.textContent.trim(), vw: window.innerWidth };
      })()`);
      console.log(`${h.name}: panel ${Math.round(m.pl)}..${Math.round(m.pr)} canvas ${Math.round(m.cl)}..${Math.round(m.cr)} arrow=${m.arrow}`);
      assert(m.pl + m.pw / 2 > m.cl + m.cw / 2, `${h.name}: panel centre must be right of the canvas centre`);
      assert(m.pl >= m.cr - 1, `${h.name}: panel must not overlap the canvas (panel.left ${m.pl} < canvas.right ${m.cr})`);
      assert(m.cw > 300 && m.ch > 200, `${h.name}: canvas keeps a usable pan/zoom area (${m.cw}x${m.ch})`);
      assert.strictEqual(m.arrow, '\u25B6', `${h.name}: open panel arrow points right (toward its edge)`);
      await evalJs(`document.getElementById('design-panel-toggle').click()`);
      await waitFor(`document.querySelector('#design-panel').classList.contains('collapsed')`, h.name + ' collapsed');
      assert.strictEqual(await evalJs(`document.getElementById('design-panel-toggle').textContent.trim()`), '\u25C0', `${h.name}: collapsed arrow points left`);
      await evalJs(`document.getElementById('design-panel-toggle').click()`);
      await stable('#design-panel');
      if (process.env.EVIDENCE_DIR) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(process.env.EVIDENCE_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, `right-dock-${h.name}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    console.log('design-info-panel-right-dock: all passed');
  } finally {
    await cdp.close();
  }
})();
