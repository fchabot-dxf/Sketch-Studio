// tests/pocket-loop-750-fusion-live.test.js — TASK 750: Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 payload of the drafted pocket through
// fusionJavaScriptHandler, as 714's live test): the imported pocket with Loop on for Spiral, Raster and Morphed spiral: tests/helpers/pocket-live.js
// fusionPhase (each one closed on-line path in the export, no inside element).
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import { openPocketPage, fusionPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '750-loop-fusion', fusion: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await fusionPhase(t);
  console.log('pocket-loop-750-fusion-live: ok');
} finally { await t.close(); }
