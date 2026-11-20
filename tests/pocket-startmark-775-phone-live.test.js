// tests/pocket-startmark-775-phone-live.test.js — TASK 775 / 778, phone 390 x 844, real touch, mm: a Spiral pocket with Loop (no dot, 1 start mark, one closed
// path + 1 guide start mark, the note); an open line has the Hold part row. tests/helpers/online-pocket-live.js. (Renamed from
// tests/leadin-775-phone-pocket-live.test.js in TASK 836.)
import { openOnlinePocketPage, pocketPhase } from './helpers/online-pocket-live.js';

const t = await openOnlinePocketPage({ tag: '775-phone-pocket', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('mm');
  await pocketPhase(t, 'phone (mm)', { patterns: ['linked'], island: false });
  console.log('pocket-startmark-775-phone-live: ok');
} finally { await t.close(); }
