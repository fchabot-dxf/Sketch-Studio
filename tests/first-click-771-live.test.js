// tests/first-click-771-live.test.js — TASK 771: deterministic fail-first regression for first-click drops:
//   1) picking a drawing tool in the ribbon while initial restore is still in flight (data-doc-ready="0")
//      and clicking/starting on the canvas must NOT silently drop the clicks when restore settles;
//   2) passive notification toasts (info / success / warning) overlapping the canvas must NOT swallow canvas clicks,
//      while interactive action buttons on toasts remain clickable.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, sleep } from './helpers/cdp-browser.js';
import { pressRibbonTool } from './helpers/ribbon-tool.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_TAG = '<script type="module" src="src/main.js"></script>';
const html = fs.readFileSync(path.join(REPO_ROOT, 'apps/shaper/index.html'), 'utf8');
assert(html.includes(MAIN_TAG), 'shaper index.html loads src/main.js');
const slowHtml = html.replace(MAIN_TAG, `<script type="module">
  import { getProjectStore } from '#ui/project-store.js';
  const store = getProjectStore();
  const real = store.loadCurrent.bind(store);
  let release; const gate = new Promise((r) => { release = r; });
  window.releaseRestore = () => release();
  store.loadCurrent = async (...a) => { await gate; return real(...a); };
  await import('./src/main.js');
</script>`);

await (async () => {
  const cdp = await launchBrowser({ tag: '771-first-click', width: 1280, height: 800, fixtures: { '/apps/shaper/slow.html': slowHtml } });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, evalJs, waitFor, navigate } = cdp;
  const ST = 'window.__designController.state';
  const click = async (p) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(p.x), y: Math.round(p.y), button: 'none', clickCount: 0 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 1, clickCount: 1 });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(p.x), y: Math.round(p.y), button: 'left', buttons: 0, clickCount: 1 });
    await sleep(120);
  };

  try {
    // 1. Both clicks of a line arrive while initial restore is held back (docReady === '0') after picking Line
    await navigate(`http://127.0.0.1:${port}/apps/shaper/slow.html`, 8000);
    await waitFor(`document.getElementById('design-canvas')?.getBoundingClientRect().width > 0 && !!document.getElementById('tool-line') && !!window.__designController`, 'Shaper canvas + ribbon shown');
    assert.strictEqual(await evalJs(`document.getElementById('design-canvas').dataset.docReady`), '0', 'initial restore still pending');
    await pressRibbonTool(evalJs, click, 'tool-line');
    const c = await evalJs(`(() => { const r = document.getElementById('design-canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const A = { x: c.x - 100, y: c.y }, B = { x: c.x + 100, y: c.y };
    await click(A);
    await click(B);
    await evalJs(`window.releaseRestore()`);
    await waitFor(`document.getElementById('design-canvas').dataset.docReady === '1'`, 'restore settled');
    await waitFor(`${ST}.shapes.length === 1`, 'line queued before docReady is drawn once restore settles');
    assert.deepStrictEqual(await evalJs(`${ST}.shapes.map((s) => s.type)`), ['line'], '1: early clicks after tool pick drew the line');

    // 2. First click before docReady (bezier), second click after docReady -> draws 1 bezier
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/slow.html`, 8000);
    await waitFor(`document.getElementById('design-canvas')?.getBoundingClientRect().width > 0 && !!document.getElementById('tool-bezier') && !!window.__designController`, 'Shaper canvas + ribbon shown (run 2)');
    await pressRibbonTool(evalJs, click, 'tool-bezier');
    await click(A);
    await evalJs(`window.releaseRestore()`);
    await waitFor(`document.getElementById('design-canvas').dataset.docReady === '1'`, 'restore settled (run 2)');
    await click(B);
    await waitFor(`${ST}.shapes.length === 1`, 'bezier started before docReady and finished after');
    assert.deepStrictEqual(await evalJs(`${ST}.shapes.map((s) => s.type)`), ['bezier'], '2: split first/second click across docReady drew the bezier');

    // 3. Passive info toast over the canvas must not block first click; toast action button remains clickable
    await resetBufferLive(cdp);
    await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html`, 8000);
    await waitFor(`document.getElementById('design-canvas')?.dataset.docReady === '1' && !!document.getElementById('tool-line')`, 'Shaper ready (run 3)');
    await pressRibbonTool(evalJs, click, 'tool-line');
    await evalJs(`window.ug.notify('Close path: click an open outline to close it.', 'info')`);
    await waitFor(`!!document.querySelector('#notification-container [data-level="info"]')`, 'info toast shown');
    await sleep(350); // let the 0.3s slide-in transition settle
    const toastCentre = await evalJs(`(() => { const r = document.querySelector('#notification-container [data-level="info"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(toastCentre);
    await waitFor(`!!${ST}.active`, '3: clicking over passive info toast still starts the Line tool on the canvas');

    await evalJs(`(() => { window.__t771Action = 0; window.ug.notify('Open outlines found', 'info', 10000, { action: { label: 'Close them', onClick: () => { window.__t771Action++; } } }); })()`);
    await waitFor(`!!document.querySelector('#notification-container .notif-action-btn')`, 'action button rendered');
    const actBtn = await evalJs(`(() => { const r = document.querySelector('#notification-container .notif-action-btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(actBtn);
    await waitFor(`window.__t771Action === 1`, '4: clicking interactive toast action button still fires onClick');

    console.log('first-click-771-live: ok');
  } finally {
    await cdp.close();
  }
})();
