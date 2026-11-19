// tests/leadin-775-phone-pocket-live.test.js — TASK 775, phone 390 x 844, real touch, mm: a Spiral pocket with Loop (no dot) + Lead-in (its leg, its two ends, one
// open path, the note); an open line has no Lead-in row; the operations list. tests/helpers/leadin-live.js.
import { openLeadinPage, pocketPhase } from './helpers/leadin-live.js';

const t = await openLeadinPage({ tag: '775-phone-pocket', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('mm');
  await pocketPhase(t, 'phone (mm)', { patterns: ['linked'], island: false });
  console.log('leadin-775-phone-pocket-live: ok');
} finally { await t.close(); }
