// tests/badge-780-live.test.js — TASK 780 (desktop 1280 x 800): the depth badge never covers the pocket start mark; a cut without one keeps its badge.
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { runBadge780 } from './helpers/badge-780.js';

const cdp = await launchBrowser({ tag: '780-desktop', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await resetBufferLive(cdp);
  await cdp.navigate(`http://127.0.0.1:${cdp.port}/apps/shaper/index.html?analytics=off`, 10000);
  await cdp.waitFor(`!!document.querySelector('.sk-header-tab[data-tab="design"]')`, 'shaper ready');
  console.log('outside badge at ' + JSON.stringify(await runBadge780(cdp, { phone: false, shotPrefix: 'desktop-', expectOutsideAt: 'translate(25 -1.5875)' })));
  console.log('badge-780-live: ok');
} finally { await cdp.close(); }
