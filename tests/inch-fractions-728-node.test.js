// tests/inch-fractions-728-node.test.js -- TASK 728: Fractional inch display (Settings > Units > Inch display: Decimal | Fractional, Length precision 1/8 .. 1/64).
//  1. formatFraction (#core/units.js): the nearest fraction, reduced, mixed, signed, at each denominator 8 / 16 / 32 / 64
//  2. the ONE length-format decider (lengthText, #core/settings-manager.js): Fractional only in an inch document; its forms (bare / unit / field / compact);
//     the views that read it (dimension label, quantityText, the parameter table value, the stepped note, the preview list); Decimal = what 724 showed
//  3. input: "1 1/2", 1 1/2", "3/8 in", "1.5", "1/8" parse (units.parse = the shared expression parser, one number literal); "1-1/2" is a subtraction (1/2)
//  4. display only: the exported Shaper file is byte-identical at Fractional 1/8 .. 1/64 and Decimal
//  5. the untouched-box rule at Fractional (SketchStudio, node kit): a rounded fraction prefill left untouched never commits
//  6. templates (Shaper, node kit + sidebar): the preview labels and the start-view length fields show fractions; Open on untouched fields builds the exact defaults
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { findLabel, labelEl } from './helpers/node-dom-read.js';
import SettingsManager, { lengthText, lengthFraction, areaText, LENGTH_FRACTIONS } from '#core/settings-manager.js';
import { formatFraction, parse } from '#core/units.js';
import { evaluateText, parseInput, print } from '#core/expression.js';
import { quantityText } from '#core/parameters.js';
import { formatConstraintValue as constraintLabel } from '#ui/svg-renderer.js';
import { buildParameterRows } from '#ui/parameter-table.js';
import { planEntries, steppedNoteItems } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { parseShaperSvg, previewItems, itemLabel, depthText } from '../apps/shaper/src/export-preview.js';
import { TEMPLATES, buildTemplate, defaultParams } from '#core/templates.js';
import { renderTemplatePreview } from '#ui/template-picker.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, m) => { assert.ok(typeof a === 'number' && Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`); checks++; };
const set = (k, v) => SettingsManager.set(k, v, { persist: false });
const mode = (unit, display, den = 16) => { set('DOC_UNIT', unit); set('INCH_DISPLAY', display); set('LENGTH_FRACTION', den); };
const IN = 25.4;

// 1. the fraction table
const TABLE = { // value (in) -> [at 1/8, 1/16, 1/32, 1/64]
  0.5: ['1/2', '1/2', '1/2', '1/2'],
  1.5: ['1 1/2', '1 1/2', '1 1/2', '1 1/2'],
  23.625: ['23 5/8', '23 5/8', '23 5/8', '23 5/8'],
  3: ['3', '3', '3', '3'],
  0: ['0', '0', '0', '0'],
  '-1.25': ['-1 1/4', '-1 1/4', '-1 1/4', '-1 1/4'],
  0.1: ['1/8', '1/8', '3/32', '3/32'],          // 0.8 / 1.6 / 3.2 / 6.4 ticks -> 1/8, 2/16, 3/32, 6/64
  0.75: ['3/4', '3/4', '3/4', '3/4'],              // 12/16 reduced
  0.0625: ['1/8', '1/16', '1/16', '1/16'],         // half a 1/8 tick rounds up (Math.round)
  0.984375: ['1', '1', '1', '63/64'],
  '-0.01': ['0', '0', '0', '-1/64'],               // never "-0"
  11.8125: ['11 7/8', '11 13/16', '11 13/16', '11 13/16'],
};
for (const [v, row] of Object.entries(TABLE)) {
  LENGTH_FRACTIONS.forEach((den, i) => eq(formatFraction(Number(v), den), row[i], `formatFraction(${v}, ${den})`));
}
eq(LENGTH_FRACTIONS, [8, 16, 32, 64], 'the Fractional precision choices');

// 2. the decider
mode('in', 'fractional', 16);
eq(lengthFraction(), 16, 'inch document + Fractional: denominator 16 (the default)');
eq([lengthText(1.5 * IN), lengthText(1.5 * IN, { show: 'unit' }), lengthText(1.5 * IN, { show: 'field' }), lengthText(1.5 * IN, { show: 'compact' })],
  ['1 1/2"', '1 1/2"', '1 1/2', '1 1/2"'], 'the forms: bare / unit / field / compact');
eq([0.5, 1.5, 23.625, 3, -1.25, 0, 0.1].map((x) => lengthText(x * IN)), ['1/2"', '1 1/2"', '23 5/8"', '3"', '-1 1/4"', '0"', '1/8"'], 'labels with the inch mark at 1/16');
eq(lengthText(0.004 * IN, { fractions: false, show: 'field' }), '0.004', 'a tolerance (fractions: false) keeps decimals');
eq(areaText(2.48 * IN * IN), '2.48 in²', 'an area stays decimal');
set('LENGTH_FRACTION', 64); eq(lengthText(0.1 * IN), '3/32"', '1/64: 6.4 ticks -> 6/64 = 3/32');
set('LENGTH_FRACTION', 7); eq(lengthFraction(), 16, 'a junk denominator falls back to 1/16');
set('LENGTH_FRACTION', 16);
eq(constraintLabel({ type: 'distance', value: 23.625 * IN }), '23 5/8"', 'the dimension label');
eq(constraintLabel({ type: 'distance', value: 0.5 * IN, isDriven: true }), '(1/2")', 'a reference (driven) label');
eq(constraintLabel({ type: 'radius', value: 0.25 * IN }), 'R 1/4"', 'a radius label');
eq(constraintLabel({ type: 'angle', value: 30 }), '30°', 'angles are untouched');
eq([quantityText(1.5 * IN, 'in'), quantityText(1.5 * IN, 'in', 'unit'), quantityText(1.5 * IN, 'in', 'bare'), quantityText(30, 'deg', 'unit')], ['1 1/2', '1 1/2"', '1 1/2"', '30 deg'], 'quantityText');
eq(depthText('0.100 in'), '1/8"', 'the preview list depth');
// the parameter table: a 1.53 in dimension and a user parameter
const st = { parameters: [{ name: 'width', unit: 'in', expression: '23.625 in' }], constraints: [{ id: 'c1', type: 'distance', name: 'd1', value: 1.53 * IN, joints: ['a', 'b'] }], shapes: [], joints: new Map() };
let rows = buildParameterRows(st, { unit: 'in' });
eq([rows.user[0].value, rows.dimensions[0].value, rows.dimensions[0].expression], ['23 5/8', '1 1/2', '1 1/2'], 'Parameters table Value cells (the Unit column says in)');
// mm / cm documents: never fractions
for (const u of ['mm', 'cm']) {
  mode(u, 'fractional', 16);
  eq(lengthFraction('in'), null, `${u} document: Fractional is not effective`);
  eq(lengthText(1.5 * IN), Number((1.5 * IN / (u === 'cm' ? 10 : 1)).toFixed(3)).toString(), `${u} document: the label stays decimal`);
  eq(quantityText(1.5 * IN, 'in'), '1.5', `${u} document: an inch parameter stays decimal`);
}
// Decimal inch: unified 3 decimals, trailing zeros dropped by default
mode('in', 'decimal', 16);
eq([lengthText(1.5 * IN), quantityText(1.5 * IN, 'in', 'unit'), depthText('0.100 in')], ['1.5', '1.5 in', '0.1 in'], 'Decimal: trailing zeros dropped');
rows = buildParameterRows(st, { unit: 'in' });
eq([rows.user[0].value, rows.dimensions[0].value], ['23.625', '1.53'], 'Decimal: Parameters table at 3 decimals');
set('TRAILING_ZEROS', true); set('LENGTH_PRECISION', 3); eq(lengthText(1.5 * IN), '1.500', 'Decimal + precision 3 + trailing zeros ON'); set('TRAILING_ZEROS', false); set('LENGTH_PRECISION', 3);

// 3. input
for (const [text, want] of [['1 1/2', 1.5], ['1 1/2"', 1.5], ['1 1/2 in', 1.5], ['3/8 in', 0.375], ['1.5', 1.5], ['1/8', 0.125], ['-1 1/4 in', -1.25], ['23 5/8"', 23.625], ['2"', 2]]) {
  near(parse(text, 'in'), want * IN, `units.parse ${JSON.stringify(text)}`);
  const r = evaluateText(text, () => null, { target: 'length', unit: 'in' });
  ok(r.ok, `expression ${JSON.stringify(text)}: ${r.message}`); near(r.v, want * IN, `expression ${JSON.stringify(text)}`);
}
near(parse('1 1/2', 'mm'), 1.5, 'a bare mixed number in a mm document is mm');
eq(parse('1-1/2', 'in'), null, 'units.parse: "1-1/2" is arithmetic, not one number: refused (a field takes a number)');
near(evaluateText('1-1/2', () => null, { target: 'length', unit: 'in' }).v, 0.5 * IN, 'the expression language: "1-1/2" is 1 - 1/2 (a subtraction, as before)');
eq(evaluateText('1 1/0 in', () => null, {}).code, 'DIV_ZERO', '1 1/0: division by zero');
eq(print(parseInput('w = 1 1/2"').ast), '1 1/2 in', 'the stored text of a mixed number keeps it ("1 1/2 in")');
eq(print(parseInput('-1 1/2 + 2 * 1 1/2').ast), '-1 1/2 + 2 * 1 1/2', 'printed and read back as typed');
near(evaluateText(print(parseInput('x / 1 1/2 in').ast), (n) => (n === 'x' ? { v: 3 * IN, L: 1, A: 0 } : null), {}).v, 2, 'x / 1 1/2 in round-trips');
eq(evaluateText('1 1.5/2', () => null, {}).ok, false, 'a decimal is no part of a mixed number');

// 4. display only: the export is byte-identical
const app = await open({ host: 'shaper', sidebar: true });
try {
  // 6. templates: the slot (40 x 10 mm authored; an inch document opens it at 1 9/16 x 3/8 in, task 722's 1/16 rounding)
  const slot = TEMPLATES.find((t) => t.id === 'slot');
  const previewTexts = () => [...renderTemplatePreview(buildTemplate(slot, defaultParams(slot, 'in'), 'in'), { unit: 'in' }).querySelectorAll('text')].map((t) => t.textContent).sort();
  mode('in', 'fractional', 16);
  eq(previewTexts(), ['1 3/16"', 'R3/8"'], 'the template preview labels in Fractional (the end-centre distance and the R label)');
  mode('in', 'decimal');
  eq(previewTexts(), ['1.188', 'R0.375'], 'the template preview labels in Decimal (unified 3 decimals, trailing zeros dropped)');
  mode('in', 'fractional', 16);
  const q = (sel) => app.document.querySelector(sel);
  app.press(q('.sk-sidebar-btn')); await app.pause(120); app.press(q('[data-action="templates"]')); await app.pause(120);
  app.press(q('.sk-tp-card[data-template="slot"]')); await app.pause(120);
  eq(['length', 'width'].map((k) => q(`.sk-tp-field[data-param="${k}"] input`).value), ['1 9/16', '3/8'], 'the start view\'s length fields (the unit is beside them)');
  app.press(q('.sk-tp-open')); await app.pause(400);
  eq(app.state.parameters.map((p) => [p.name, p.expression]), [['length', '1.5625 in'], ['width', '0.375 in']], 'Open on the untouched fields: the exact defaults (never re-read from the fraction text)');

  mode('in', 'decimal');
  app.modes.showMode('prepare');
  V2_PLAN.clear();
  importFusionSelection(fs.readFileSync(new URL('./fixtures/sa7-slope/03-pocket-floor-fillet.json', import.meta.url), 'utf8'), { controller: app.controller, prepare: app.prepare });
  const [pk, rec] = [...V2_PLAN.entries()].find(([, r]) => r.cutType === 'pocket');
  V2_PLAN.set(pk, { ...rec, cutType: 'roughing', stepDepth: 1, adaptiveSteps: false });
  const base = shaperSvgOf(app.state, planEntries()), basePv = shaperSvgOf(app.state, planEntries(), { preview: true });
  ok(/shaper:cutDepth="[0-9.]+ in"/.test(base), 'the file speaks inches');
  for (const den of LENGTH_FRACTIONS) {
    mode('in', 'fractional', den);
    eq(shaperSvgOf(app.state, planEntries()), base, `export byte-identical at Fractional 1/${den}`);
    eq(shaperSvgOf(app.state, planEntries(), { preview: true }), basePv, `preview file byte-identical at 1/${den}`);
  }
  mode('in', 'fractional', 16);
  const labels = previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel);
  ok(labels.length > 0 && labels.every((l) => /· (\d+ )?(\d+\/\d+|\d+)" ·?/.test(l + ' ')), 'the preview list shows fractions: ' + JSON.stringify(labels));
  const note = steppedNoteItems(V2_PLAN.get(pk)).map((i) => i.text).join('|');
  ok(/\d+\/\d+ to \d+(?: \d+\/\d+)? in|to \d+\/\d+ in/.test(note) && /outlines [0-9.]+(–[0-9.]+)? in apart/.test(note), 'the stepped note: fraction depths, decimal outline spacing: ' + note);
  mode('in', 'decimal');
  eq(previewItems(parseShaperSvg(basePv, app.document)).map(itemLabel).every((l) => /in\b/.test(l)), true, 'Decimal again: inches shown through lengthText');

} finally { V2_PLAN.clear(); await app.close(); }

// 5. the untouched-box rule at Fractional (SketchStudio): a 1.53 in dimension shows 1 1/2"; its box opens with 1 1/2"; Enter on it changes nothing
mode('in', 'fractional', 16);
const ss = await open({ host: 'sketchstudio' });
const errors = [];
ss.window.addEventListener('error', (e) => errors.push(String(e.error ? e.error.stack || e.error : e.message)));
try {
  const s = ss.state;
  const o = ss.toScreen(0, 0); const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const isRef = (c) => (c.shapes || []).some((id) => String(id).startsWith('ref_')) || (c.joints || []).some((j) => j === 'j_origin' || String(j).startsWith('j_ref'));
  const dim = () => s.constraints.find((c) => c.type === 'distance' && !isRef(c));
  const box = () => ss.document.getElementById('dimInput');
  const boxOpen = () => !box().classList.contains('hidden');
  const A = [P(150, 100), P(450, 100)];
  ss.tool('line'); ss.click(A[0].x, A[0].y); ss.click(A[1].x, A[1].y); ss.esc(); ss.tool('select');
  ss.click((A[0].x + A[1].x) / 2, A[0].y); ss.key('d');
  const E = P(300, 330); ss.move(E.x, E.y); ss.click(E.x, E.y);
  await ss.waitFor(boxOpen, 'the value box');
  ss.type('1.53'); ss.enter();
  near(dim().value, 1.53 * IN, 'typed 1.53 (decimal typing still works)');
  const reopen = async () => {
    ss.tool('select'); ss.esc();
    let text = null;
    const lab = findLabel(ss, (t) => (/"/.test(t) ? (text = t, true) : false)); ok(lab, 'the fraction label is on the canvas');
    await ss.pause(550);
    ss.dblclick(lab.x, lab.y, { target: () => labelEl(ss, lab.idx) });
    await ss.waitFor(boxOpen, 'the edit box');
    return text;
  };
  eq(await reopen(), '1 1/2"', 'the label: 1.53 in at 1/16 is 1 1/2"');
  eq(box().value, '1 1/2"', 'the box opens with the label\'s fraction');
  let h = s.history.length;
  ss.enter();
  near(dim().value, 1.53 * IN, 'untouched Enter: the exact value stays (no rounding to 1 1/2)');
  eq([s.history.length, boxOpen()], [h, false], 'untouched Enter: no undo step, the box closed');
  for (const [text, want] of [['1 1/2', 1.5], ['3/8 in', 0.375], ['2 1/4"', 2.25], ['1.5', 1.5]]) {
    await reopen(); h = s.history.length;
    box().select(); ss.type(text); ss.enter();
    near(dim().value, want * IN, `typed ${JSON.stringify(text)}`);
    eq([s.history.length, dim().expression || null], [h + 1, null], `typed ${JSON.stringify(text)}: one undo step, a plain value (no formula)`);
  }
  eq(errors, [], 'no page error');
} finally { await ss.close(); mode('mm', 'decimal', 16); }
console.log(`inch-fractions-728-node.test.js: ok (${checks} checks)`);
