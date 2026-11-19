// tests/leadin-775-pocket-live.test.js — TASK 775, desktop 1280 x 800, mouse, mm: a programmed pocket with Loop on has NO dot (a closed loop has no start
// point on the Origin) and says nothing about where it starts; Lead-in On (Spiral, Raster, Morphed spiral): the leg, its tip and its junction, ONE open on-line
// path, the note with the trade-off; an island pocket: one leg per loop; an open line has no Lead-in row; the operations list. tests/helpers/leadin-live.js.
import { openLeadinPage, pocketPhase } from './helpers/leadin-live.js';

const t = await openLeadinPage({ tag: '775-pocket' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await pocketPhase(t, 'desktop (mm)');
  console.log('leadin-775-pocket-live: ok');
} finally { await t.close(); }
