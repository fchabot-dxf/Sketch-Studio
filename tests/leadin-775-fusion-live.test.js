// tests/leadin-775-fusion-live.test.js — TASK 775, Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 drafted-pocket payload): the pocket with Spiral +
// Loop (no dot) + Lead-in, the outline switched to On line with a lead-in; the download = 2 open on-line paths. tests/helpers/leadin-live.js.
import { openLeadinPage, fusionPhase } from './helpers/leadin-live.js';

const t = await openLeadinPage({ tag: '775-fusion', fusion: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await fusionPhase(t);
  console.log('leadin-775-fusion-live: ok');
} finally { await t.close(); }
