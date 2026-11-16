// tests/reset-buffer-start-up-713-live.test.js -- TASK 713: resetBufferLive (tests/helpers/reset-buffer.js) called on an app page that is still
// STARTING UP. Each app, in a fresh profile, is left right at its load event, while its Design canvas still says data-doc-ready="0" (the page is
// creating the store's IndexedDB database): the condition behind the merge-gate flake "timed out waiting for the reset page to clear the working
// buffers" (a page left mid-upgrade is parked in the back/forward cache and every later open of the database waits for it). The reset must finish
// ('buffers reset') and the app must then start on its own (data-doc-ready="1") with one Untitled tab.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const APPS = { sketchstudio: 'svgCanvas', shaper: 'design-canvas', penplotter: 'design-canvas', trace: 'design-canvas' };

for (const [app, canvasId] of Object.entries(APPS)) {
  const cdp = await launchBrowser({ tag: '713-' + app, width: 1280, height: 800 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); break; }
  try {
    const url = `http://127.0.0.1:${cdp.port}/apps/${app}/index.html`;
    // the forced condition: the app page has loaded but is still starting up (its database is being created in this fresh profile)
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await loaded;
    const atLoad = await cdp.evalJs(`document.getElementById('${canvasId}').dataset.docReady`);
    assert.strictEqual(atLoad, '0', `${app}: the page is still starting up at its load event (data-doc-ready="0")`);
    const t0 = Date.now();
    await resetBufferLive(cdp); // throws 'timed out waiting for the reset page ...' when the database is held by the parked page
    console.log(`${app}: reset from a page left mid-start-up finished in ${Date.now() - t0} ms`);
    await cdp.navigate(url, 10000);
    await cdp.waitForApp(canvasId);
    assert.strictEqual(await cdp.evalJs(`document.querySelectorAll('.sk-doctab').length`), 1, `${app}: the app starts on one Untitled tab after the reset`);
  } finally {
    await cdp.close();
  }
}
console.log('reset-buffer-start-up-713-live: ok');
