// tests/param-hints-770-fusion-live.test.js — TASK 770: the parameter hints in Fusion mode (?host=fusion, window.adsk stubbed, the SA-7 drafted pocket through
// fusionJavaScriptHandler: its stepped types are in the menu, each with its hint), desktop 1280 x 800, mm, a real mouse and keyboard: tests/helpers/hints-live.js
// hintsPhase. Screenshots to EVIDENCE_DIR (or .evidence/805/).
import path from 'node:path';
import { openPocketPage } from './helpers/pocket-live.js';
import { hintsPhase } from './helpers/hints-live.js';

process.env.EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve('.evidence/805');
const t = await openPocketPage({ tag: '770-hints-fusion', fusion: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try { await hintsPhase(t, { fusion: true }); } finally { await t.close(); }
console.log('param-hints-770-fusion-live: ok');
