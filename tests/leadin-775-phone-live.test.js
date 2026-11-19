// tests/leadin-775-phone-live.test.js — TASK 775, phone 390 x 844, real touch, mm: the On line lead-in and tabs (the Lead-in / Side choices 44 px), Export 2D /
// 3D. (The phone's pocket: tests/leadin-775-phone-pocket-live.test.js.) tests/helpers/leadin-live.js.
import { openLeadinPage, linePhase } from './helpers/leadin-live.js';

const t = await openLeadinPage({ tag: '775-phone', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('mm');
  await linePhase(t, 'phone (mm)');
  console.log('leadin-775-phone-live: ok');
} finally { await t.close(); }
