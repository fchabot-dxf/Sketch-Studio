// tests/pocket-loop-750-live.test.js — TASK 750: the Loop toggle on the rectangle pocket for Spiral, Raster and Morphed spiral, desktop 1280 x 800, mouse, mm:
// tests/helpers/pocket-live.js loopPhase (one closed line + its start / end marker, the note, the download = ONE closed on-line path and no inside element;
// Loop off again = the open line + the inside cut).
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import { openPocketPage, loopPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '750-loop' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await loopPhase(t, 'desktop (mm)');
  console.log('pocket-loop-750-live: ok');
} finally { await t.close(); }
