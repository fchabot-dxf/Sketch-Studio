// tests/badge-780-phone-live.test.js — TASK 780 (phone 390 x 844, real touch): the depth badge never covers the pocket start mark.
import { launchBrowser } from './helpers/cdp-browser.js';
import { resetBufferLive } from './helpers/reset-buffer.js';
import { runBadge780 } from './helpers/badge-780.js';

const cdp = await launchBrowser({ tag: '780-phone', width: 1280, height: 800 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await resetBufferLive(cdp);
  await cdp.navigate(`http://127.0.0.1:${cdp.port}/apps/shaper/index.html?analytics=off`, 10000);
  await cdp.waitFor(`!!document.querySelector('.sk-sidebar-chevron')`, 'shaper phone ready');
  console.log('outside badge at ' + JSON.stringify(await runBadge780(cdp, { phone: true, shotPrefix: 'phone-', expectOutsideAt: 'translate(-2.9161901904696346e-16 -1.5875)' })));
  console.log('badge-780-phone-live: ok');
} finally { await cdp.close(); }
