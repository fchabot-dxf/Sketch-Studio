// tests/pocket-clearing-745-phone-lists-live.test.js — TASKS 745 / 749 / 750 on a phone, 390 x 844, real touch, inches: tests/helpers/pocket-live.js listsPhase,
// then no sideways scroll.
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import assert from 'node:assert';
import { openPocketPage, listsPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '745-pocket-phone-lists', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await listsPhase(t, 'phone (in)');
  const side = await t.evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  console.log('pocket-clearing-745-phone-lists-live: ok');
} finally { await t.close(); }
