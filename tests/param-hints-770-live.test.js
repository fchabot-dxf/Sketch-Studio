// tests/param-hints-770-live.test.js — TASK 770 / 805 (the tooltip at the cursor): the parameter hints in the real page, desktop 1280 x 800 (mm, a real mouse and keyboard):
// tests/helpers/hints-live.js hintsPhase (what is checked: that file's header). Fusion mode: tests/param-hints-770-fusion-live.test.js; the phone (touch):
// tests/param-hints-770-phone-live.test.js. Screenshots to EVIDENCE_DIR (or .evidence/805/).
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { hintsPhase } from './helpers/hints-live.js';

process.env.EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/805');
const t = await openPocketPage({ tag: '770-hints' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try { await hintsPhase(t); } finally { await t.close(); }
console.log('param-hints-770-live: ok');
