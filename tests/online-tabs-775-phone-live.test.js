// tests/online-tabs-775-phone-live.test.js — TASK 775, phone 390 x 844, real touch, mm: a plain On line outline and On line tabs, Export 2D / 3D. (The phone's
// pocket: tests/pocket-startmark-775-phone-live.test.js.) tests/helpers/online-pocket-live.js. (Renamed from tests/leadin-775-phone-live.test.js in TASK 836.)
import { openOnlinePocketPage, linePhase } from './helpers/online-pocket-live.js';

const t = await openOnlinePocketPage({ tag: '775-phone', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('mm');
  await linePhase(t, 'phone (mm)');
  console.log('online-tabs-775-phone-live: ok');
} finally { await t.close(); }
