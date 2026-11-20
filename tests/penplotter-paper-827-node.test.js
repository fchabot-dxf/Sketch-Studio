// tests/penplotter-paper-827-node.test.js — TASK 827: the Document dialog's paper standards (apps/penplotter/src/paper-sizes.js, declared once as data):
// every entry's own-unit size and conversion, match (either orientation) / custom, orientation; then the real dialog: pick A4 / Letter, swap, type a custom size, reopen (the #docInfo readout is in the live test: node has no layout).
import assert from 'node:assert';
import { PAPER_SIZES, paperOptionLabel, matchPaper, orientationOf, paperSizeIn, paperMm } from '../apps/penplotter/src/paper-sizes.js';
import { open } from './helpers/node-app.js';

// the table: every entry's label with its conversion in parentheses
const want = {
  a6: 'A6 · 105 × 148 mm (4.13 × 5.83 in)', a5: 'A5 · 148 × 210 mm (5.83 × 8.27 in)', a4: 'A4 · 210 × 297 mm (8.27 × 11.69 in)',
  a3: 'A3 · 297 × 420 mm (11.69 × 16.54 in)', a2: 'A2 · 420 × 594 mm (16.54 × 23.39 in)', a1: 'A1 · 594 × 841 mm (23.39 × 33.11 in)',
  letter: 'Letter · 8.5 × 11 in (215.9 × 279.4 mm)', legal: 'Legal · 8.5 × 14 in (215.9 × 355.6 mm)', tabloid: 'Tabloid / Ledger · 11 × 17 in (279.4 × 431.8 mm)',
  archA: 'ARCH A · 9 × 12 in (228.6 × 304.8 mm)', archB: 'ARCH B · 12 × 18 in (304.8 × 457.2 mm)', archC: 'ARCH C · 18 × 24 in (457.2 × 609.6 mm)',
};
assert.deepStrictEqual(PAPER_SIZES.map((p) => p.id), Object.keys(want), 'the declared standards');
for (const p of PAPER_SIZES) assert.strictEqual(paperOptionLabel(p), want[p.id], p.id);
assert.deepStrictEqual(paperMm(PAPER_SIZES.find((p) => p.id === 'letter')), { w: 215.9, h: 279.4 });

// match / custom / orientation
assert.strictEqual(matchPaper(210, 297).id, 'a4');
assert.strictEqual(matchPaper(297, 210).id, 'a4', 'either orientation');
assert.strictEqual(matchPaper(215.9, 279.4).id, 'letter');
assert.strictEqual(matchPaper(200, 200), null, 'custom');
assert.strictEqual(orientationOf(297, 210), 'landscape');
assert.strictEqual(orientationOf(210, 297), 'portrait');
assert.deepStrictEqual(paperSizeIn(PAPER_SIZES[2], 'landscape'), { w: 297, h: 210 });

// the dialog
const app = await open({ host: 'penplotter' });
try {
  const doc = app.document, q = (s) => doc.querySelector(s), P = app.plotter;
  const press = (s) => { const e = q(s); assert(e, s); app.press(e); };
  const choose = (s, v) => { const e = q(s); e.value = v; e.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true })); };
  const typeInto = (s, t) => { const e = q(s); app.press(e); e.focus(); app.key('a', { ctrl: true }); app.type(t); app.key('Tab'); };
  const shown = () => ({ paper: q('#docPaper').value, orient: q('#docOrient').value, unit: q('#docUnit').value, w: +q('#docW').value, h: +q('#docH').value });

  press('#designDocBtn');
  assert.strictEqual(shown().paper, 'custom', 'the default 200 x 200 is custom: ' + JSON.stringify(shown()));
  assert.strictEqual(q('#docPaper').options.length, 13, '12 standards + Custom');
  assert(q('#docPaper').querySelector('option[value="a4"]').textContent === want.a4);

  choose('#docPaper', 'a4');
  assert.deepStrictEqual(shown(), { paper: 'a4', orient: 'portrait', unit: 'mm', w: 210, h: 297 });
  assert.deepStrictEqual([P.doc.w, P.doc.h], [210, 297]);
  choose('#docPaper', 'letter');
  assert.deepStrictEqual(shown(), { paper: 'letter', orient: 'portrait', unit: 'in', w: 8.5, h: 11 }, 'the paper unit follows the standard');
  assert.deepStrictEqual([P.doc.w, P.doc.h], [215.9, 279.4]);

  choose('#docOrient', 'landscape');
  assert.deepStrictEqual(shown(), { paper: 'letter', orient: 'landscape', unit: 'in', w: 11, h: 8.5 });
  choose('#docPaper', 'a3');
  assert.deepStrictEqual(shown(), { paper: 'a3', orient: 'landscape', unit: 'mm', w: 420, h: 297 }, 'a pick keeps the orientation');

  typeInto('#docW', '300');
  assert.strictEqual(shown().paper, 'custom', 'a typed size that is no standard is Custom: ' + JSON.stringify(shown()));
  typeInto('#docW', '210'); typeInto('#docH', '297');
  assert.strictEqual(shown().paper, 'a4', 'typing a standard size shows it');
  press('#docDone');

  press('#designDocBtn'); // reopen
  assert.strictEqual(shown().paper, 'a4', 'reopened: the standard is shown');
  console.log('penplotter-paper-827-node: ok');
} finally { await app.close?.(); }
