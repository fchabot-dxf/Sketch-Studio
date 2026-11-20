// tests/pocket-startmark-775-live.test.js — TASK 775 / 778, desktop 1280 x 800, mouse, mm: a programmed pocket with Loop on has NO dot (a closed loop has no
// start point on the Origin) and 1 start mark target (Spiral, Raster, Morphed spiral): ONE closed on-line loop + 1 guide start mark in the file; an island
// pocket: 1 start mark on the selected pocket; an open line: the Hold part row. tests/helpers/online-pocket-live.js. (Renamed from
// tests/leadin-775-pocket-live.test.js in TASK 836.)
import { openOnlinePocketPage, pocketPhase } from './helpers/online-pocket-live.js';

const t = await openOnlinePocketPage({ tag: '775-pocket' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await pocketPhase(t, 'desktop (mm)');
  console.log('pocket-startmark-775-live: ok');
} finally { await t.close(); }
