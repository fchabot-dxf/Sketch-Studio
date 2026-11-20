// tests/param-hints-770-phone-export-live.test.js — TASK 770: the parameter hints on a phone, 390 x 844, real touch, an inch document: a TAP on a row's label opens
// its hint under the field, a second tap closes it, one at a time, inside the card (tests/helpers/hints-live.js hintsPhase; the desktop and Fusion mode:
// tests/param-hints-770-live.test.js). Screenshots to EVIDENCE_DIR (or .evidence/805/).
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { hintsPhase } from './helpers/hints-live.js';

process.env.EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/805');
const t = await openPocketPage({ tag: '770-hints-phone-export', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try { await hintsPhase(t, { part: 'export' }); } finally { await t.close(); }
console.log('param-hints-770-phone-export-live: ok');
