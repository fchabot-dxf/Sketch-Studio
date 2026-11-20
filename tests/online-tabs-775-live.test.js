// tests/online-tabs-775-live.test.js — TASK 775, desktop 1280 x 800, mouse, INCHES: a plain On line outline (the Hold part row, no Lead-in row: TASK 836) and On
// line TABS (no thickness row, 3 strokes, the note) on two 1 in squares; Generate = the page's derivation (the outline ONE closed path, the tabs 3 open strokes);
// Export 2D labels / rows == the file; Export 3D info. tests/helpers/online-pocket-live.js. (Renamed from tests/leadin-775-live.test.js in TASK 836.)
import { openOnlinePocketPage, linePhase } from './helpers/online-pocket-live.js';

const t = await openOnlinePocketPage({ tag: '775-line' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('in');
  await linePhase(t, 'desktop (in)');
  console.log('online-tabs-775-live: ok');
} finally { await t.close(); }
