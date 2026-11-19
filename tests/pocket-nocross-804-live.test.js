// tests/pocket-nocross-804-live.test.js — TASK 804: the owner's triangle bow-tie, desktop (mm): Spiral Loop off / on, Morphed spiral, Morphed + Loop (refused with its reason), the
// note, the Paths drawn with no crossing, the download (tests/helpers/pocket-nocross-804-live.js bowtiePhase). Screenshots to .evidence/804/.
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { bowtiePhase } from './helpers/pocket-nocross-804-live.js';

const t = await openPocketPage({ tag: '804-bowtie', evidenceDir: path.resolve('.evidence/804') });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await bowtiePhase(t, 'desktop (mm)');
  console.log('pocket-nocross-804-live: ok');
} finally { await t.close(); }
