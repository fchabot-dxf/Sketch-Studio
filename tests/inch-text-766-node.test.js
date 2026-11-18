// tests/inch-text-766-node.test.js — TASK 766 (owner turn 2307, second finding): the same 3/16 in showed "0.187 in" on the cut card and "0.188 in" in the
// Operations list. Both go through the ONE length formatter (#core/settings-manager.js lengthText -> #core/units.js format); the difference was the float error
// of the mm -> in conversion: 3/16 in reached by the stepper is stored as 4.762499999999999 mm (0.18749999999999997 in, toFixed(3) "0.187"), typed or picked
// as 4.7625 mm (0.1875 in, "0.188"). format() now converts without the float error, so one value has one text. The steppers themselves were right: every
// press lands on an exact multiple of the field's step in the document unit (number-stepper.js nextValue), checked here for 8 presses up and down.
import assert from 'node:assert';
import SettingsManager, { lengthText } from '../packages/core/settings-manager.js';
import { format } from '../packages/core/units.js';
import { nextValue } from '../apps/shaper/src/number-stepper.js';

SettingsManager.set('DOC_UNIT', 'in', { persist: false });
SettingsManager.set('TRAILING_ZEROS', false, { persist: false });
const card = (mm) => lengthText(mm, { show: 'field' });                               // cut-panel.js fieldText
const ops = (mm) => lengthText(mm, { show: 'field' });                                // operations.js lenWords (one rule everywhere)
for (const [inch, text] of [[3 / 16, '0.188'], [5 / 16, '0.313'], [7 / 16, '0.438'], [1 / 8, '0.125'], [1 / 4, '0.25']]) {
  const stepped = (inch * 32 / 32) * 25.4, typed = Number((inch * 25.4).toFixed(6));
  for (const mm of [stepped, typed, 4.762499999999999 * (inch / (3 / 16))]) {
    assert.strictEqual(card(mm), text, `${inch} in (${mm} mm): the card shows ${text}`);
    assert.strictEqual(ops(mm), text, `${inch} in (${mm} mm): the Operations list agrees: ${text}`);
  }
}
SettingsManager.set('TRAILING_ZEROS', true, { persist: false });
assert.strictEqual(card(0.25 * 25.4), '0.250', 'Show trailing zeros ON: 1/4 in shows 0.250');
SettingsManager.set('TRAILING_ZEROS', false, { persist: false });
assert.strictEqual(card(4.762499999999999), card(4.7625), 'the stepped and the typed 3/16 in read the same');
assert.strictEqual(format(4.762499999999999, 'in', { decimals: 3 }), '0.188');
assert.strictEqual(format(4.762499999999999, 'in', { unit: true, decimals: 4 }), '0.1875in', 'the export form is unchanged');
assert.strictEqual(format(1.05, 'mm', { decimals: 1 }), '1.1', 'mm: 1.05 rounds up (its float error removed too)');
// the stepper: 8 presses of + then 8 of - from 1/8 in by 1/32 (depth / bit), each lands on an exact multiple of the step, through the mm round trip
let mm = 3.175;
for (const dir of [1, -1]) for (let i = 0; i < 8; i++) {
  const cur = mm / 25.4, next = nextValue(cur, dir, 1 / 32, 0, Infinity);
  assert.ok(Math.abs(next * 32 - Math.round(next * 32)) < 1e-9 && Math.abs(next - cur - dir / 32) < 1e-9, `press ${dir > 0 ? '+' : '-'} ${i + 1}: ${cur} -> ${next}, one 1/32 step`);
  mm = next * 25.4;
}
assert.strictEqual(nextValue(0.3, 1, 1 / 16), 0.3125, 'from a typed 0.3 in, + lands on the next multiple of 1/16 (0.3125)');
console.log('inch-text-766-node: ok');
