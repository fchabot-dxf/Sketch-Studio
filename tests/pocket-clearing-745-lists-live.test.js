// tests/pocket-clearing-745-lists-live.test.js — TASKS 745 / 749 / 750, desktop 1280 x 800, mouse, mm: tests/helpers/pocket-live.js listsPhase (the L with Loop
// on, the island pocket, the operations list; their export: the -export-live file).
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import { openPocketPage, listsPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '745-pocket-lists' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await listsPhase(t, 'desktop (mm)');
  console.log('pocket-clearing-745-lists-live: ok');
} finally { await t.close(); }
