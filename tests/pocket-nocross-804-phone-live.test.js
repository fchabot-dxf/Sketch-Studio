// tests/pocket-nocross-804-phone-live.test.js — TASK 804: the owner's triangle bow-tie, phone (in): Spiral Loop off / on, Morphed spiral, Morphed + Loop (refused with its reason), the
// note, the Paths drawn with no crossing, the download (tests/helpers/pocket-nocross-804-live.js bowtiePhase). Screenshots to .evidence/804/.
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { bowtiePhase } from './helpers/pocket-nocross-804-live.js';

const t = await openPocketPage({ tag: '804-bowtie-phone', phone: true, evidenceDir: path.resolve('.evidence/804') });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await bowtiePhase(t, 'phone (in)');
  console.log('pocket-nocross-804-phone-live: ok');
} finally { await t.close(); }
