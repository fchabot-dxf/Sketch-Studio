// tests/display-precision-724-node.test.js -- TASK 724: adjustable DISPLAY precision (Length 0-6, Angle 0-4; null = Auto = each view's usual decimals).
//  1. the ONE decider (settings-manager lengthDecimals / angleDecimals): Auto returns the caller's usual decimals; a set value wins; junk is ignored
//  2. format() at every length precision 0..6 for mm / cm / in and angle precision 0..4 through the shared labels
//  3. defaults == today: the dimension label, quantityText, the parameter table value and the stepped note are unchanged while both settings are Auto
//  4. the exported Shaper file is byte-identical at precision Auto, 0 and 6 (display only), the preview list's depth text follows the setting
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import SettingsManager, { lengthDecimals, angleDecimals, lengthText, angleText, areaText } from '#core/settings-manager.js';
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
const setP = (len, ang, tz = false) => {
  SettingsManager.set('LENGTH_PRECISION', len, { persist: false });
  SettingsManager.set('ANGLE_PRECISION', ang, { persist: false });
  SettingsManager.set('TRAILING_ZEROS', tz, { persist: false });
};

// 1. the decider: defaults 3 / 1, Auto (null) / junk read as default, TRAILING_ZEROS toggles trailing zeros
eq([SettingsManager.get('LENGTH_PRECISION'), SettingsManager.get('ANGLE_PRECISION'), SettingsManager.get('TRAILING_ZEROS')], [3, 1, false], 'factory defaults: 3 length, 1 angle, trailing zeros off');
setP(null, null, false);
eq([lengthDecimals(1), lengthDecimals(3), angleDecimals(1), SettingsManager.getAll().LENGTH_PRECISION, SettingsManager.getAll().ANGLE_PRECISION], [3, 3, 1, 3, 1], 'stored null (old Auto) reads as default (3, 1) everywhere');
setP(2, 0, false);
eq([lengthDecimals(1), angleDecimals(1)], [2, 0], 'a set precision wins (0 is a real value)');
SettingsManager.set('LENGTH_PRECISION', 9, { persist: false }); SettingsManager.set('ANGLE_PRECISION', 'x', { persist: false });
eq([lengthDecimals(1), angleDecimals(1)], [3, 1], 'out of range / junk falls back to default (3, 1)');

// 2. format at every precision, labels and trailing zeros through the shared formatters
const v = 25.4 * 1.23456789; // mm
for (const unit of ['mm', 'cm', 'in']) {
  for (let p = 0; p <= 6; p++) {
    setP(p, 1, true);
    const wantFixed = (v / { mm: 1, cm: 10, in: 25.4 }[unit]).toFixed(p);
    eq(format(v, unit, { decimals: lengthDecimals() }), wantFixed, `format ${unit} @${p}`);
    eq(quantityText(v, unit), wantFixed, `quantityText ${unit} @${p} (trailing zeros ON)`);
    setP(p, 1, false);
    eq(quantityText(v, unit), String(Number(wantFixed)), `quantityText ${unit} @${p} (trailing zeros OFF)`);
  }
}
const IN = 25.4;
setP(3, 1, false);
for (const [mm, wantOff, wantOn] of [[0.25 * IN, '0.25', '0.250'], [0.5 * IN, '0.5', '0.500'], [0.1875 * IN, '0.188', '0.188'], [0.02 * IN, '0.02', '0.020'], [0, '0', '0.000'], [19 * IN, '19', '19.000']]) {
  setP(3, 1, false); eq(lengthText(mm, { unit: 'in' }), wantOff, `in ${mm}: trailing zeros OFF -> ${wantOff}`);
  setP(3, 1, true);  eq(lengthText(mm, { unit: 'in' }), wantOn, `in ${mm}: trailing zeros ON -> ${wantOn}`);
}
for (const [mm, wantOff, wantOn] of [[0.25, '0.25', '0.250'], [0.5, '0.5', '0.500'], [0, '0', '0.000'], [19, '19', '19.000'], [25.4, '25.4', '25.400']]) {
  setP(3, 1, false); eq(lengthText(mm, { unit: 'mm' }), wantOff, `mm ${mm}: trailing zeros OFF -> ${wantOff}`);
  setP(3, 1, true);  eq(lengthText(mm, { unit: 'mm' }), wantOn, `mm ${mm}: trailing zeros ON -> ${wantOn}`);
}
const angC = { type: 'angle', value: 37.65432 }, lenC = { type: 'distance', value: v };
for (let p = 0; p <= 4; p++) {
  setP(3, p, true);
  eq(constraintLabel(angC), 37.65432.toFixed(p) + '°', `angle label @${p} (tz ON)`);
  eq(quantityText(37.65432, 'deg'), 37.65432.toFixed(p), `angle quantityText @${p} (tz ON)`);
}
setP(3, 1, false);
eq([constraintLabel({ type: 'angle', value: 45 }), angleText(45, { show: 'deg' })], ['45°', '45°'], 'angle trailing zeros OFF: 45°');
setP(3, 1, true);
eq([constraintLabel({ type: 'angle', value: 45 }), angleText(45, { show: 'deg' })], ['45.0°', '45.0°'], 'angle trailing zeros ON: 45.0°');
setP(3, 1, false);
eq(constraintLabel(lenC), Number(v.toFixed(3)).toString(), 'length label @3 (mm)');
eq(areaText(2.5 * IN * IN, { unit: 'in' }), '2.5 in²', 'area trailing zeros OFF');

// 3. defaults across all views (ONE rule: 3 length decimals, 1 angle decimal, trailing zeros OFF)
setP(3, 1, false);
eq(constraintLabel(lenC), Number(v.toFixed(3)).toString(), 'default: length label @3, trailing zeros dropped');
eq(constraintLabel({ type: 'distance', value: 25.4 }), '25.4', 'default: 25.40 -> 25.4');
eq(constraintLabel(angC), '37.7°', 'default: angle label 1 decimal');
eq(quantityText(25.4, 'in'), '1', 'default: 1 in without .0');
eq(depthText('0.100 in'), '0.1 in', 'default: depth drops trailing zeros');
setP(3, 1, true);
eq(depthText('0.100 in'), '0.100 in', 'trailing zeros ON: depth shows 0.100 in');
setP(3, 1, false);

// 4. export byte-identical at any precision & TRAILING_ZEROS; preview list follows the setting
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
  setP(3, 1, false);
  const base = shaperSvgOf(app.state, cutPlanEntries()), basePv = shaperSvgOf(app.state, cutPlanEntries(), { preview: true });
  const note0 = steppedNoteItems(CUT_PLAN.get(pk)).map((i) => i.text);
  const label0 = previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel);
  eq(base, plainExport(app.state), 'default: the file equals the plain exporter output');
  for (const tz of [false, true]) for (const p of [0, 3, 6]) {
    setP(p, p === 6 ? 4 : 0, tz);
    eq(shaperSvgOf(app.state, cutPlanEntries()), base, `export byte-identical at precision ${p} tz=${tz}`);
    eq(shaperSvgOf(app.state, cutPlanEntries(), { preview: true }), basePv, `preview file byte-identical at precision ${p} tz=${tz}`);
    if (tz) {
      const labels = previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel);
      ok(p === 0 ? labels.every((l) => !/\./.test(l)) : labels.every((l) => new RegExp(`\\d\\.\\d{${p}} mm`).test(l)), `tz=true preview labels show ${p} decimals`);
    }
  }
  setP(1, 1, true);
  eq(previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel), ['outside · 19.0 mm', 'pocket · 6.7 mm · step 1 of 4', 'pocket · 7.3 mm · step 2 of 4', 'pocket · 7.8 mm · step 3 of 4', 'pocket · 8.0 mm · step 4 of 4'], 'preview labels at precision 1 (tz ON)');
  setP(1, 1, false);
  eq(previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel), ['outside · 19 mm', 'pocket · 6.7 mm · step 1 of 4', 'pocket · 7.3 mm · step 2 of 4', 'pocket · 7.8 mm · step 3 of 4', 'pocket · 8 mm · step 4 of 4'], 'preview labels at precision 1 (tz OFF)');
  eq(steppedNoteItems(CUT_PLAN.get(pk)).map((i) => i.text).join('|').includes('6.7 · 7.3 · 7.8 · 8 mm'), true, 'stepped note depths at precision 1');
  setP(3, 1, false);
  eq(steppedNoteItems(CUT_PLAN.get(pk)).map((i) => i.text), note0, 'defaults again: the stepped note is back to what it was');
  eq(previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel), label0, 'defaults again: the preview labels are back');
} finally { CUT_PLAN.clear(); setP(3, 1, false); app.close(); }
function ok(c, m) { assert.ok(c, m); checks++; }
console.log(`display-precision-724-node.test.js: ok (${checks} checks)`);
