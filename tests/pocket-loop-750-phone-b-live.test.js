// tests/pocket-loop-750-phone-b-live.test.js — TASK 750: the Loop toggle on the rectangle pocket on a phone, 390 x 844, touch, inches, for the Morphed spiral,
// then Spiral with Loop off again: tests/helpers/pocket-live.js loopPhase, then no sideways scroll (Spiral and Raster: pocket-loop-750-phone-live).
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import assert from 'node:assert';
import { openPocketPage, loopPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '750-loop-phone-b', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await loopPhase(t, 'phone (in)', { patterns: ['morphed'], off: true });
  const side = await t.evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  console.log('pocket-loop-750-phone-b-live: ok');
} finally { await t.close(); }
