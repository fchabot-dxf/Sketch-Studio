// tests/leadin-775-live.test.js — TASK 775, desktop 1280 x 800, mouse, INCHES: the On line LEAD-IN (Off | On, Length, Side, the note, Prepare's leg and two dots)
// and On line TABS (no thickness row, 3 strokes, the note) on two 1 in squares; Generate = the owner's machine test file (.evidence/775/owner-origin-test-775.svg:
// a 1 in square with a 0.25 in lead-in + a 1 in square On line with 3 tabs); Export 2D labels / rows == the file; Export 3D info. tests/helpers/leadin-live.js.
import path from 'node:path';
import { openLeadinPage, linePhase } from './helpers/leadin-live.js';

const t = await openLeadinPage({ tag: '775-line' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('in');
  await linePhase(t, 'desktop (in)', { ownerFile: path.resolve('.evidence/775/owner-origin-test-775.svg') });
  console.log('leadin-775-live: ok');
} finally { await t.close(); }
