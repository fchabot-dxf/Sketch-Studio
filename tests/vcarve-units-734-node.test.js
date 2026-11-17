// tests/vcarve-units-734-node.test.js — TASK 734: the Vcarve panel follows the DOCUMENT unit (apps/shaper/src/vcarve-view.js; its texts are #core lengthText / areaText, task 728).
//  shown: Depth step, Max depth, the readout's max depth and the region list's area in the doc unit (the Length precision applies); typed: parsed in the doc unit by
//  the cut card's parse, stored in BASE mm (the record stays mm); the steppers: doc-unit steps (mm 0.5 / 0.5, in 1/64 / 1/32), no minimum but > 0;
//  an untouched box commits nothing; switching the unit re-shows the fields; the derived contours are the same for an mm and an inch doc with the same mm values.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import SettingsManager, { lengthText as coreLengthText, areaText as coreAreaText } from '#core/settings-manager.js';
import { deriveVcarveContours } from '#core/vcarve.js';
import { mountVcarveView } from '../apps/shaper/src/vcarve-view.js';
// TASK 728: the panel's own formatters (doc-length.js) are gone; the panel calls the core decider with its usual decimals (mm 3, cm 4, in 4, trimmed while Auto; areas mm 0, in 2)
const lengthText = (mm) => coreLengthText(mm, { auto: { mm: 3, cm: 4, in: 4 }[SettingsManager.get('DOC_UNIT')], trim: 'auto', show: 'unit' });
const areaText = (mm2) => coreAreaText(mm2, { auto: { mm: 0, cm: 2, in: 2 }[SettingsManager.get('DOC_UNIT')] });

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); checks++; };

// the formatters
SettingsManager.set('DOC_UNIT', 'mm');
eq([lengthText(0.5), lengthText(6), lengthText(6.35)], ['0.5 mm', '6 mm', '6.35 mm'], 'mm text is as the panel always read');
eq(areaText(1600), '1600 mm²', 'mm area: 0 decimals as before');
SettingsManager.set('DOC_UNIT', 'in');
eq([lengthText(25.4), lengthText(3.175), lengthText(0.396875)], ['1 in', '0.125 in', '0.0156 in'], 'inch text');
eq(areaText(645.16), '1.00 in²', 'inch area');
SettingsManager.set('LENGTH_PRECISION', 2);
eq(lengthText(3.175), '0.13 in', 'the Length precision applies');
SettingsManager.set('LENGTH_PRECISION', null);
SettingsManager.set('DOC_UNIT', 'mm');

const app = await open({ host: 'shaper' });
try {
  const doc = app.document, q = (s) => doc.querySelector(s), st = app.state;
  // a pointer press on the button (the stepper's own path). Not button.click(): happy-dom forwards a click inside the panel's <label> to the label's first button (a browser does not)
  const press = (s) => { const e = q(s); assert(e, s + ' not found'); const W = app.window; e.dispatchEvent(new W.Event('pointerdown', { bubbles: true })); doc.dispatchEvent(new W.Event('pointerup')); e.dispatchEvent(new W.Event('keydown')); };
  const typed = (s, v) => { const i = q(s); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const changeUnit = (u) => SettingsManager.set('DOC_UNIT', u);
  const minus = '.vcarve-stepbox:has(#vcarve-dstep) .cut-step[data-d="-1"]';
  app.modes.showMode('vcarve');
  const view = mountVcarveView(app.state);   // the node app does not mount the page's Vcarve view; the panel DOM is the page's own
  const rec = () => st.vcarves[0];
  const hist = () => st.history.length;
  const val = (s) => q(s).value;

  eq([val('#vcarve-dstep'), val('#vcarve-maxdepth')], ['0.5 mm', '6 mm'], 'mm doc: the defaults read as before');
  eq(st.vcarves.length, 0, 'entering the tab writes no record');

  // mm: type, step, refuse
  typed('#vcarve-dstep', '1.5');
  near(rec().dStep, 1.5, 'mm doc: a bare number is mm'); eq(val('#vcarve-dstep'), '1.5 mm', 'shown');
  typed('#vcarve-dstep', '0.25 in');
  near(rec().dStep, 6.35, 'a unit suffix overrides the doc unit'); eq(val('#vcarve-dstep'), '6.35 mm', 'shown in the doc unit');
  typed('#vcarve-dstep', '0'); near(rec().dStep, 6.35, 'typed 0 is refused'); eq(val('#vcarve-dstep'), '6.35 mm', 'and the field shows the value again');
  typed('#vcarve-dstep', '-2'); near(rec().dStep, 6.35, 'typed negative is refused');
  typed('#vcarve-dstep', 'abc'); near(rec().dStep, 6.35, 'typed text is refused');
  typed('#vcarve-dstep', '0.5');
  press('#vcarve-dstep ~ .cut-step[data-d="1"]'); near(rec().dStep, 1, 'mm + 0.5 -> 1');
  press(minus); near(rec().dStep, 0.5, '- -> 0.5');
  press(minus); near(rec().dStep, 0.5, 'no app minimum, but > 0: - stops at the smallest positive multiple 0.5');
  typed('#vcarve-dstep', '0.3'); press(minus); near(rec().dStep, 0.3, 'a value below one step: - stays');
  typed('#vcarve-dstep', '0.05'); near(rec().dStep, 0.05, 'no 0.1 floor: 0.05 mm is taken');
  typed('#vcarve-maxdepth', '0.2'); near(rec().maxDepth, 0.2, 'no 0.5 floor on max depth either');

  // inch doc: the same record shows in inches, steps are 1/64 and 1/32
  typed('#vcarve-dstep', '0.5'); typed('#vcarve-maxdepth', '6');
  changeUnit('in');
  eq([val('#vcarve-dstep'), val('#vcarve-maxdepth')], ['0.0197 in', '0.2362 in'], 'switching to inches re-shows both fields');
  near(rec().dStep, 0.5, 'the stored value is unchanged'); near(rec().maxDepth, 6, 'both stay mm');
  typed('#vcarve-dstep', '0.125'); near(rec().dStep, 3.175, 'a bare number is inches'); eq(val('#vcarve-dstep'), '0.125 in', 'shown');
  typed('#vcarve-dstep', '3 mm'); near(rec().dStep, 3, 'a mm suffix is mm'); eq(val('#vcarve-dstep'), '0.1181 in', 'shown in inches');
  typed('#vcarve-dstep', '0.125 in');
  press('#vcarve-dstep ~ .cut-step[data-d="1"]'); near(rec().dStep, 25.4 * 9 / 64, 'in + 1/64');
  press(minus); near(rec().dStep, 25.4 * 8 / 64, 'in - 1/64 back on 1/8');
  typed('#vcarve-maxdepth', '0.25'); press('#vcarve-maxdepth ~ .cut-step[data-d="1"]'); near(rec().maxDepth, 25.4 * 9 / 32, 'max depth + 1/32');
  typed('#vcarve-dstep', '0.015625');
  press(minus); near(rec().dStep, 25.4 / 64, 'at 1/64: - stays (smallest positive multiple)');

  // untouched: a prefilled box left alone never commits (no rounding drift)
  typed('#vcarve-dstep', '0.396875 mm'); near(rec().dStep, 0.396875, 'exact 1/64 in kept');
  const h0 = hist(); const before = JSON.stringify(rec());
  q('#vcarve-dstep').dispatchEvent(new app.window.Event('change'));   // the field text is the rounded "0.0156 in": the same as the prefill
  eq([JSON.stringify(rec()), hist()], [before, h0], 'an untouched box commits nothing (the record keeps 0.396875, not 0.0156 in)');

  // the derived contours are identical for an mm and an inch doc holding the same mm values
  const sq = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  changeUnit('mm'); typed('#vcarve-dstep', '3.175 mm'); typed('#vcarve-maxdepth', '6.35');
  const mmRec = JSON.stringify(rec()); const mmC = JSON.stringify(deriveVcarveContours(sq, rec(), { holes: [] }));
  changeUnit('in'); typed('#vcarve-dstep', '0.125 in'); typed('#vcarve-maxdepth', '0.25');
  eq(JSON.stringify(rec()), mmRec, 'the record is identical (mm doc vs inch doc, same values)');
  eq(JSON.stringify(deriveVcarveContours(sq, rec(), { holes: [] })), mmC, 'and so are the derived contours');
  changeUnit('mm');
  view.destroy();
} finally {
  SettingsManager.set('DOC_UNIT', 'mm');
  SettingsManager.set('LENGTH_PRECISION', null);
  await app.close();
}
console.log(`vcarve-units-734-node: ${checks} checks OK`);
