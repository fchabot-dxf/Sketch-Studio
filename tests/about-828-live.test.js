// tests/about-828-live.test.js — TASK 828 (live): the About item in the menu of each of the four apps (desktop 1400 and phone 390), what it opens, Fusion's
// palette has none, and the built About page renders (desktop + phone screenshots to .evidence/828/).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startServer, sleep } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildSite } = require('../scripts/build-site.cjs');
const { APPS } = require('../packages/ui/app-registry.js');
const EVIDENCE = path.join(REPO_ROOT, '.evidence', '828');
fs.mkdirSync(EVIDENCE, { recursive: true });

const cdp = await launchBrowser({ tag: '828', width: 1400, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, waitFor, navigate, close } = cdp;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'about-828-live-'));
let site = null;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(EVIDENCE, name), Buffer.from(r.data, 'base64')); };
try {
  const PHASES = [['desktop', { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }]];
  for (const [phase, metrics] of PHASES) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    for (const app of APPS) {
      await resetBufferLive({ port, navigate, waitFor });
      await navigate(`http://127.0.0.1:${port}/apps/${app.id}/index.html`);
      await waitFor(`!!document.querySelector('.sk-sidebar-btn, .sk-sidebar-chevron')`, `${app.id}: the menu door`);
      // open the menu by its own door (desktop: the header button; phone: the chevron beside the tabs)
      await evalJs(`(() => { const d = [...document.querySelectorAll('.sk-sidebar-btn, .sk-sidebar-chevron')].find((e) => e.offsetParent !== null); d.click(); })()`);
      await waitFor(`!!document.querySelector('.sk-sidebar.open [data-action=about]')`, `${app.id} ${phase}: the About item in the open menu`);
      const item = await evalJs(`(() => { const b = document.querySelector('.sk-sidebar.open [data-action=about]'); const r = b.getBoundingClientRect(); const items = [...document.querySelectorAll('.sk-sidebar.open .sk-sidebar-actions .sk-sidebar-item')]; return { text: b.textContent.trim(), w: r.width, h: r.height, last: items[items.length - 1] === b, inView: r.bottom <= innerHeight && r.right <= innerWidth }; })()`);
      assert.strictEqual(item.text, 'About', `${app.id} ${phase}: label`);
      assert.ok(item.w > 0 && item.h >= 30, `${app.id} ${phase}: the item is shown (${item.w} x ${item.h})`);
      assert.ok(item.last, `${app.id} ${phase}: About is the last item (the site items sit at the end)`);
      // the click opens about.html at the site root in a new tab: the opener is recorded (the app's own click handler runs unchanged)
      await evalJs(`(() => { window.__opened = null; window.open = (...a) => { window.__opened = a; return null; }; document.querySelector('.sk-sidebar.open [data-action=about]').click(); })()`);
      const opened = await evalJs(`JSON.stringify(window.__opened)`);
      assert.deepStrictEqual(JSON.parse(opened), ['/about.html', '_blank', 'noopener'], `${app.id} ${phase}: opens /about.html in a new tab`);
    }
  }

  // Fusion's palette (Shaper ?host=fusion): no About item
  await send('Emulation.setDeviceMetricsOverride', PHASES[0][1]);
  await resetBufferLive({ port, navigate, waitFor });
  await navigate(`http://127.0.0.1:${port}/apps/shaper/index.html?host=fusion`);
  await waitFor(`!!document.querySelector('.sk-sidebar-btn')`, 'Fusion palette menu button');
  await evalJs(`document.querySelector('.sk-sidebar-btn').click()`);
  await waitFor(`!!document.querySelector('.sk-sidebar.open')`, 'the Fusion palette menu open');
  assert.strictEqual(await evalJs(`!!document.querySelector('[data-action=about]')`), false, 'Fusion palette: no About item');

  // the built page: shaper's site, desktop + phone
  buildSite('shaper', path.join(tmp, 'shaper'));
  site = await startServer(path.join(tmp, 'shaper'));
  for (const [phase, metrics] of PHASES) {
    await send('Emulation.setDeviceMetricsOverride', metrics);
    await navigate(`http://127.0.0.1:${site.port}/about.html`);
    const r = await evalJs(`JSON.stringify({ apps: [...document.querySelectorAll('.app')].map((e) => ({ id: e.dataset.app, imgOk: e.querySelector('img').naturalWidth > 0, h2: e.querySelector('h2').textContent })), overflow: document.documentElement.scrollWidth > innerWidth, stamp: document.querySelector('.stamp').textContent })`);
    const page = JSON.parse(r);
    assert.deepStrictEqual(page.apps.map((a) => a.id), APPS.filter((a) => a.about !== false).map((a) => a.id), `${phase}: the apps listed`);
    assert.ok(page.apps.every((a) => a.imgOk), `${phase}: every icon loads`);
    assert.ok(!page.overflow, `${phase}: no sideways scroll`);
    assert.ok(/^Build \d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(page.stamp), `${phase}: the build stamp (${page.stamp})`);
    await shot(`about-${phase}.png`);
  }
  console.log('about-828-live OK');
} finally {
  if (site) site.server.close();
  await close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
