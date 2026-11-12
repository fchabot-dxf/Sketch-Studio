// tests/diagnostic-log-copy-live.test.js — TASK 544 (live, headless CDP): ONE click on "Copy Report" puts the whole report on the clipboard as
// parseable, minified JSON, in SketchStudio and in Shaper (the shared panel, no per-host code); the status line says "Copied <size> report";
// and when the clipboard write is rejected the panel says so and offers "Download report (.json)", which saves the same JSON.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';

await (async () => {
  const cdp = await launchBrowser({ tag: '544', width: 900, height: 700 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  try {
    await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    const click = async (x, y) => {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(300);
    };
    const clickEl = async (sel) => {
      const c = await evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
      assert(c, sel + ' not found');
      await click(c.x, c.y);
    };
    const shot = async (name) => {
      if (!process.env.EVIDENCE_DIR) return;
      const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 900, height: 120, scale: 1 } });
      fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, name), Buffer.from(s.data, 'base64'));
    };
    const LOG_OPEN = `!!document.querySelector('.sk-diag-panel') && !document.querySelector('.sk-diag-panel').classList.contains('sk-hidden')`;
    const openLog = async () => { await evalJs(`document.querySelector('.sk-diag-toggle').click()`); await waitFor(LOG_OPEN, 'the log to open'); };

    for (const [app, url] of [['sketchstudio', '/apps/sketchstudio/index.html'], ['shaper', '/apps/shaper/index.html']]) {
      await navigate(`http://127.0.0.1:${port}${url}`, 10000);
      await waitFor(`!!document.querySelector('.sk-diag-toggle')`, `${app}: the log button`);
      await sleep(1200);
      await openLog();
      await clickEl('.sk-diag-btn-primary');
      await waitFor(`/^Copied .+ report$/.test(document.querySelector('.sk-diag-status').textContent)`, `${app}: the Copied confirmation`);
      const status = await evalJs(`document.querySelector('.sk-diag-status').textContent`);
      const text = await evalJs(`navigator.clipboard.readText()`);
      const report = JSON.parse(text);
      assert.strictEqual(report.app, app, `${app}: the clipboard holds that app's report`);
      for (const k of ['app', 'url', 'ua', 'viewport', 'touchTrace', 'log', 'document', 'journal', 'trimmed']) assert.ok(k in report, `${app}: report field ${k}`);
      assert.ok(!text.includes('\n'), `${app}: one line`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-diag-download').classList.contains('sk-hidden')`), true, `${app}: no download offer when the copy worked`);
      console.log(`${app}: ${status} (${text.length} chars)`);
      await shot(`copied-${app}.png`);

      // the clipboard write is rejected: the panel says so and offers the download, which saves the same kind of JSON
      await evalJs(`navigator.clipboard.writeText = () => Promise.reject(new Error('NotAllowedError: denied for the test')); window.__saved = null;
        window.showSaveFilePicker = async (o) => ({ name: o.suggestedName, createWritable: async () => ({ write: async (t) => { window.__saved = t; }, close: async () => {} }) });`);
      await clickEl('.sk-diag-btn-primary');
      await waitFor(`!document.querySelector('.sk-diag-download').classList.contains('sk-hidden')`, `${app}: the Download button after a rejected write`);
      const failStatus = await evalJs(`document.querySelector('.sk-diag-status').textContent`);
      assert.strictEqual(await evalJs(`document.querySelector('.sk-diag-btn-primary').textContent`), 'Copy Report', `${app}: the button no longer claims Copied`);
      assert.ok(/Copy failed \(NotAllowedError: denied for the test\)/.test(failStatus), `${app}: failure is visible: ${failStatus}`);
      await shot(`failed-${app}.png`);
      await clickEl('.sk-diag-download');
      await waitFor(`window.__saved !== null`, `${app}: the download to be written`);
      const saved = JSON.parse(await evalJs(`window.__saved`));
      assert.strictEqual(saved.app, app, `${app}: the downloaded file is the report`);
      assert.ok(/^Saved sketch-studio-report-.+\.json$/.test(await evalJs(`document.querySelector('.sk-diag-status').textContent`)), `${app}: saved status`);
    }
    console.log('diagnostic-log-copy-live: OK');
  } finally { await cdp.close(); }
})();
