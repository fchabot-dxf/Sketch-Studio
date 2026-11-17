// tests/pocket-clearing-745-live.test.js — TASK 745: the PROGRAMMED POCKET in the real Shaper page (TASK 749: the Spiral; TASK 750: the Loop toggle, no Depth per
// pass), desktop 1280 x 800, real mouse, mm: tests/helpers/pocket-live.js cardPhase (the dropdown, Spiral with Loop off, the stepover, the Raster row).
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import { openPocketPage, cardPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '745-pocket' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await cardPhase(t, 'desktop (mm)');
  console.log('pocket-clearing-745-live: ok');
} finally { await t.close(); }
