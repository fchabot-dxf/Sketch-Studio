// tests/display-precision-724-node.test.js -- TASK 724: adjustable DISPLAY precision (Length 0-6, Angle 0-4; null = Auto = each view's usual decimals).
//  1. the ONE decider (settings-manager lengthDecimals / angleDecimals): Auto returns the caller's usual decimals; a set value wins; junk is ignored
//  2. format() at every length precision 0..6 for mm / cm / in and angle precision 0..4 through the shared labels
//  3. defaults == today: the dimension label, quantityText, the parameter table value and the stepped note are unchanged while both settings are Auto
//  4. the exported Shaper file is byte-identical at precision Auto, 0 and 6 (display only), the preview list's depth text follows the setting
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import SettingsManager, { lengthDecimals, angleDecimals } from '#core/settings-manager.js';
import { format } from '#core/units.js';
import { quantityText } from '#core/parameters.js';
import { formatConstraintValue as constraintLabel } from '#ui/svg-renderer.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { CUT_PLAN, cutPlanEntries, steppedNoteItems } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems, previewRows, itemLabel, depthText } from '../apps/shaper/src/export-preview.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const setP = (len, ang) => { SettingsManager.set('LENGTH_PRECISION', len, { persist: false }); SettingsManager.set('ANGLE_PRECISION', ang, { persist: false }); };

// 1. the decider
setP(null, null);
eq([lengthDecimals(1), lengthDecimals(3), angleDecimals(1)], [1, 3, 1], 'Auto: the caller\'s usual decimals');
setP(2, 0);
eq([lengthDecimals(1), angleDecimals(1)], [2, 0], 'a set precision wins (0 is a real value)');
SettingsManager.set('LENGTH_PRECISION', 9, { persist: false }); SettingsManager.set('ANGLE_PRECISION', 'x', { persist: false });
eq([lengthDecimals(1), angleDecimals(1)], [1, 1], 'out of range / junk is ignored (Auto)');

// 2. format at every precision, labels through the shared label
const v = 25.4 * 1.23456789; // mm
for (const unit of ['mm', 'cm', 'in']) {
  for (let p = 0; p <= 6; p++) {
    setP(p, null);
    const want = (v / { mm: 1, cm: 10, in: 25.4 }[unit]).toFixed(p);
    eq(format(v, unit, { decimals: lengthDecimals(1) }), want, `format ${unit} @${p}`);
    eq(quantityText(v, unit), want, `quantityText ${unit} @${p}`);
  }
}
const angC = { type: 'angle', value: 37.65432 }, lenC = { type: 'distance', value: v };
for (let p = 0; p <= 4; p++) {
  setP(null, p);
  eq(constraintLabel(angC), 37.65432.toFixed(p) + '°', `angle label @${p}`);
  eq(quantityText(37.65432, 'deg'), 37.65432.toFixed(p), `angle quantityText @${p}`);
}
setP(3, null);
eq(constraintLabel(lenC), v.toFixed(3), 'length label @3 (mm)');
eq(constraintLabel({ type: 'angle', value: 10 }), '10.0°', 'the angle label keeps its usual decimals while Angle is Auto');

// 3. defaults == today
setP(null, null);
eq(constraintLabel(lenC), v.toFixed(1), 'Auto: length label is toFixed(1) as before');
eq(constraintLabel(angC), '37.7°', 'Auto: angle label is 1 decimal as before');
eq(quantityText(v, 'in'), (v / 25.4).toFixed(1), 'Auto: quantityText 1 decimal');
eq(depthText('0.100 in'), '0.100 in', 'Auto: the preview depth is the file\'s own text');

// 4. export byte-identical at any precision; preview list follows the setting
const plainExport = (st) => {
  const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {};
  for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by);
  return exportShaperSVG({ state: st, entries: cutPlanEntries(), encoding: exportEncoding(), docUnit: 'mm', options: { groupByCut: true }, loopPolys: lp });
};
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
const app = await open({ host: 'shaper' });
try {
  app.modes.showMode('prepare');
  CUT_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  const [pk, rec] = [...CUT_PLAN.entries()].find(([, r]) => r.cutType === 'pocket');
  CUT_PLAN.set(pk, { ...rec, cutType: 'stepped-pocket', stepDepth: 1, adaptiveSteps: true, stepDeviation: 0.5 });
  setP(null, null);
  const base = shaperSvgOf(app.state, cutPlanEntries()), basePv = shaperSvgOf(app.state, cutPlanEntries(), { preview: true });
  const note0 = steppedNoteItems(CUT_PLAN.get(pk)).map((i) => i.text);
  const label0 = previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel);
  eq(base, plainExport(app.state), 'Auto: the file equals the plain exporter output');
  for (const p of [0, 6]) {
    setP(p, p === 6 ? 4 : 0);
    eq(shaperSvgOf(app.state, cutPlanEntries()), base, `export byte-identical at precision ${p}`);
    eq(shaperSvgOf(app.state, cutPlanEntries(), { preview: true }), basePv, `preview file byte-identical at precision ${p}`);
    const labels = previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel);
    ok(p === 0 ? labels.every((l) => !/\./.test(l)) : labels.every((l) => /\d\.\d{6} mm/.test(l)), `preview labels show exactly ${p} decimals`);
  }
  setP(1, null);
  eq(previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel), ['outside · 19.0 mm', 'pocket · 6.7 mm · step 1 of 4', 'pocket · 7.3 mm · step 2 of 4', 'pocket · 7.8 mm · step 3 of 4', 'pocket · 8.0 mm · step 4 of 4'], 'preview labels at precision 1');
  eq(steppedNoteItems(CUT_PLAN.get(pk)).map((i) => i.text).join('|').includes('6.7 · 7.3 · 7.8 · 8 mm'), true, 'stepped note depths at precision 1');
  setP(null, null);
  eq(steppedNoteItems(CUT_PLAN.get(pk)).map((i) => i.text), note0, 'Auto again: the stepped note is back to what it was');
  eq(previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel), label0, 'Auto again: the preview labels are back');
} finally { CUT_PLAN.clear(); setP(null, null); app.close(); }
function ok(c, m) { assert.ok(c, m); checks++; }
console.log(`display-precision-724-node.test.js: ok (${checks} checks)`);
