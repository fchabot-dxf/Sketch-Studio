// tests/pocket-startmark-775-fusion-live.test.js — TASK 775 / 778, Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 drafted-pocket payload): the pocket
// with Spiral + Loop (no dot, 1 start mark), the outline switched to On line (a plain closed loop); the download = 2 closed on-line paths + 1 guide start mark.
// tests/helpers/online-pocket-live.js. (Renamed from tests/leadin-775-fusion-live.test.js in TASK 836.)
import { openOnlinePocketPage, fusionPhase } from './helpers/online-pocket-live.js';

const t = await openOnlinePocketPage({ tag: '775-fusion', fusion: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await fusionPhase(t);
  console.log('pocket-startmark-775-fusion-live: ok');
} finally { await t.close(); }
