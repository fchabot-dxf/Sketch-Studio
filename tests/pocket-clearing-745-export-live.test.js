// tests/pocket-clearing-745-export-live.test.js — TASKS 745 / 749 / 750, desktop 1280 x 800, mouse, mm: tests/helpers/pocket-live.js exportPhase (the
// three pockets: Export 2D == the downloaded SVG element by element, only the rectangle's open line + inside cut and closed loops; Export 3D).
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import { openPocketPage, exportPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '745-pocket-export' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await exportPhase(t, 'desktop (mm)');
  console.log('pocket-clearing-745-export-live: ok');
} finally { await t.close(); }
