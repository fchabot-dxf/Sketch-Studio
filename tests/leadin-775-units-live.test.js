// tests/leadin-775-units-live.test.js — TASK 775 (added item, found by 773): the Shaper cut card's NOTE follows a document-unit change at once, as its fields
// do. Desktop 1280 x 800, mouse: an INCH document, a pocket with Spiral (its note in inches: "stepover 0.1 in", "Drawn for a 0.25 in bit", "in/min"), then the
// Settings panel's Units tab -> Document Unit mm (the real <select>, its change event): the note reads mm WITHOUT reselecting the pocket; the operations list
// row too. Fail-first: on 5e79336 the note kept "in" (apps/shaper/src/prepare-stage.js rebuilt the card only on a precision key). Then a bulk settings change
// (SettingsManager reset: the key-less change a load / another device sends) back to the defaults: the note follows again. tests/helpers/leadin-live.js tools.
import assert from 'node:assert';
import { openLeadinPage, unitsPhase } from './helpers/leadin-live.js';

const t = await openLeadinPage({ tag: '775-units' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
try {
  await t.setUnit('in');
  await unitsPhase(t, 'desktop');
  console.log('leadin-775-units-live: ok');
} finally { await t.close(); }
