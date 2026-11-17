// tests/pocket-clearing-745-phone-export-live.test.js — TASKS 745 / 749 / 750, a phone, 390 x 844, real touch, inches: tests/helpers/pocket-live.js exportPhase (the
// three pockets: Export 2D == the downloaded SVG element by element, only the rectangle's open line + inside cut and closed loops; Export 3D), then no sideways scroll.
// TASK 750b: split from one pocket-clearing-745-live file (scripts/gate.cjs's per-file limit); the files: tests/helpers/pocket-live.js's header.
import assert from 'node:assert';
import { openPocketPage, exportPhase } from './helpers/pocket-live.js';

const t = await openPocketPage({ tag: '745-pocket-phone-export', phone: true });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await exportPhase(t, 'phone (in)');
  const side = await t.evalJs(`({ doc: document.documentElement.scrollWidth, vw: innerWidth })`);
  assert.ok(side.doc <= side.vw, 'phone: no sideways scroll ' + JSON.stringify(side));
  console.log('pocket-clearing-745-phone-export-live: ok');
} finally { await t.close(); }
