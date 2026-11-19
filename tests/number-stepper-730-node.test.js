// tests/number-stepper-730-node.test.js — TASK 730: the − / + stepper of Shaper's numeric fields (apps/shaper/src/number-stepper.js, ONE widget).
//  1. the step rule (nextValue): a clean multiple of the step in the pressed direction, clamped to min / max, an unset field lands on one step.
//  2. the real cut card (Stepped pocket on the R3 floor fillet, so every stepped row exists): Depth / Offset / Bit diameter / Step depth / Resolution each change by
//     their declared step per press (mm and inches), clamp at their min, ONE undo step per applied press, press-and-hold repeats, a press at the min adds no step,
//     typing still works, and a press steps the record's exact value (not the rounded text).
import assert from 'node:assert';
import fs from 'node:fs';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { CUT_PLAN } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { nextValue, stepIn, HOLD_DELAY_MS, HOLD_REPEAT_MS } from '../apps/shaper/src/number-stepper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`); checks++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1. the rule ──
eq(nextValue(6.3, 1, 0.5), 6.5, '6.3 + 0.5 lands on 6.5 (the next multiple)');
eq(nextValue(6.3, -1, 0.5), 6, '6.3 - 0.5 lands on 6.0');
eq(nextValue(6.5, 1, 0.5), 7, 'on a multiple: one step');
eq(nextValue(6.5, -1, 0.5), 6, 'on a multiple: one step down');
eq(nextValue(0.1 + 0.2, 1, 0.1), 0.4, 'float noise (0.30000000000000004) is a multiple');
eq(nextValue(0.5, -1, 0.5, 0), 0, 'down to the min');
eq(nextValue(0.2, -1, 0.5, 0.1), 0.1, 'below the min clamps to the min');
eq(nextValue(null, 1, 0.5, 0), 0.5, 'unset + lands on one step');
eq(nextValue(null, -1, 0.5, 0), 0.5, 'unset - lands on one step too');
eq(nextValue(-0.1, -1, 0.25), -0.25, 'a field without a min goes negative (the offset)');
eq(nextValue(9, 1, 0.5, 0, 9.2), 9.2, 'a max clamps');
eq([stepIn({ step: { mm: 0.5, in: 1 / 32 } }, 'mm'), stepIn({ step: { mm: 0.5, in: 1 / 32 } }, 'in'), stepIn({ step: { mm: 0.5, in: 1 / 32 } }, 'cm')], [0.5, 1 / 32, 0.05], 'step per unit family; cm = mm / 10');

// ── 2. the card ──
SettingsManager.set('DOC_UNIT', 'mm');
CUT_PLAN.clear();
const FIX = new URL('./fixtures/sa7-slope/', import.meta.url);
const app = await open({ host: 'shaper' });
try {
  app.modes.showMode('prepare');
  const doc = app.document, q = (s) => doc.querySelector(s), st = app.state;
  const pc = doc.getElementById('prepare-canvas');
  const pressEl = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  importFusionSelection(JSON.parse(fs.readFileSync(new URL('03-pocket-floor-fillet.json', FIX), 'utf8')), { controller: app.controller, prepare: app.prepare });
  const p = worldToScreen(pc, { x: 60, y: -40 }); app.click(Math.round(p.x), Math.round(p.y), { target: pc });
  pressEl('.cut-type-trigger'); pressEl('.cut-type-opt[data-id="roughing"]');
  const rec = () => [...CUT_PLAN.values()].find((r) => r.cutType === 'roughing');
  const hist = () => st.history.length;
  const row = (name) => `.cut-row[data-${name.startsWith('cut') || name === 'toolDia' ? 'param' : 'row'}="${name}"]`;
  const step = (name, d) => pressEl(`${row(name)} .cut-step[data-d="${d}"]`);
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  eq([...doc.querySelectorAll('.cut-card .cut-step')].map((b) => b.getAttribute('aria-label')),
    ['Decrease depth', 'Increase depth', 'Decrease stepover', 'Increase stepover', 'Decrease finish allowance', 'Increase finish allowance', 'Decrease min terrace width', 'Increase min terrace width', 'Decrease lead-in radius', 'Increase lead-in radius', 'Decrease lead-in sweep', 'Increase lead-in sweep', 'Decrease lead-in length', 'Increase lead-in length', 'Decrease raster angle', 'Increase raster angle', // TASK 745: the programmed pocket's rows (hidden for a stepped type); TASK 775 / 778: the lead-in radius / sweep / length
      'Decrease step depth', 'Increase step depth', 'Decrease resolution', 'Increase resolution',
      'Decrease tab count', 'Increase tab count', 'Decrease tab width', 'Increase tab width', 'Decrease thickness', 'Increase thickness', // TASK 742: the Hold part rows (hidden for a stepped type)
      'Decrease offset', 'Increase offset', 'Decrease bit diameter', 'Increase bit diameter'],
    'a − / + pair on depth, step depth, resolution, the Hold part rows, offset and bit diameter');

  // depth: unset -> 0.5; ONE undo step per press; - at 0 clamps
  typed('.cut-depth', ''); // a stepped pocket arrives with its slope's depth: clear it to unset
  eq(rec().cutDepth, 'unset', 'depth cleared');
  let h0 = hist();
  step('cutDepth', 1);
  eq([rec().cutDepth, hist()], [0.5, h0 + 1], 'depth: unset + -> 0.5 mm, ONE undo step');
  step('cutDepth', 1); step('cutDepth', 1);
  near(rec().cutDepth, 1.5, 'depth + twice -> 1.5');
  app.undo(); near(rec().cutDepth, 1, 'one undo = one press');
  eq(q('.cut-depth').value, '1', 'the field shows it (trailing zeros dropped by default)');
  step('cutDepth', -1); step('cutDepth', -1);
  eq(rec().cutDepth, 0, 'depth - clamps at 0');
  h0 = hist(); step('cutDepth', -1);
  eq(hist(), h0, 'a press at the min changes nothing and adds no undo step');
  typed('.cut-depth', '6.3'); step('cutDepth', 1);
  near(rec().cutDepth, 6.5, 'typed 6.3 then + -> 6.5');
  typed('.cut-depth', '6.3'); step('cutDepth', -1);
  near(rec().cutDepth, 6, 'typed 6.3 then - -> 6.0');

  step('cutOffset', 1); near(rec().cutOffset, 0.25, 'offset + -> 0.25');
  step('cutOffset', -1); step('cutOffset', -1); near(rec().cutOffset, -0.25, 'offset goes negative (as typing does)');
  step('toolDia', 1); near(rec().toolDia, 3.5, 'bit 3.175 + 0.5 -> 3.5');
  typed('.cut-bit', '0.3'); step('toolDia', -1); near(rec().toolDia, 0.3, 'bit 0.3 - 0.5 would be 0: a size stays where it is (TASK 736: no minimum)');
  step('stepDepth', 1); near(rec().stepDepth, 1.5, 'step depth 1 + -> 1.5');
  typed('.cut-step-depth', '0.3'); step('stepDepth', -1); near(rec().stepDepth, 0.3, 'step depth 0.3 - 0.5 would be 0: stays (no minimum)');
  const cb = q('.cut-adaptive'); cb.checked = true; cb.dispatchEvent(new app.window.Event('change'));
  step('stepDeviation', 1); near(rec().stepDeviation, 0.3, 'resolution 0.25 + -> 0.3');
  typed('.cut-step-deviation', '0.02'); step('stepDeviation', -1); near(rec().stepDeviation, 0.02, 'resolution 0.02 - 0.05 would be 0: stays (no minimum)');

  // press-and-hold: pointerdown (no pointerup) steps once, then repeats after the delay, one step each
  typed('.cut-depth', '1');
  const down = q(`${row('cutDepth')} .cut-step[data-d="1"]`);
  const before = rec().cutDepth; h0 = hist();
  down.dispatchEvent(new app.window.PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true, pointerType: 'mouse' }));
  near(rec().cutDepth, before + 0.5, 'hold: the press steps at once');
  await sleep(HOLD_DELAY_MS + 4 * HOLD_REPEAT_MS + 40);
  doc.dispatchEvent(new app.window.PointerEvent('pointerup', { bubbles: true, button: 0 }));
  const after = rec().cutDepth, n = hist() - h0;
  assert.ok(n >= 4 && n <= 8, 'hold repeated: ' + n + ' steps'); checks++;
  near(after, before + 0.5 * n, 'each repeat is one step of 0.5 (one undo step each)');
  await sleep(3 * HOLD_REPEAT_MS);
  eq(rec().cutDepth, after, 'releasing stops the repeat');

  // inches: depth 1/32, offset 1/64, bit 1/32, resolution 0.002 (the display follows the document unit)
  SettingsManager.set('DOC_UNIT', 'in');
  typed('.cut-depth', '0.25');
  step('cutDepth', 1); near(rec().cutDepth, (0.25 + 1 / 32) * 25.4, 'inches: depth + 1/32 in');
  typed('.cut-offset', '0'); step('cutOffset', 1); near(rec().cutOffset, 25.4 / 64, 'inches: offset + 1/64 in');
  typed('.cut-bit', '0.125'); step('toolDia', 1); near(rec().toolDia, (0.125 + 1 / 32) * 25.4, 'inches: bit + 1/32 in');
  typed('.cut-step-deviation', '0.01'); step('stepDeviation', 1); near(rec().stepDeviation, 0.012 * 25.4, 'inches: resolution + 0.002 in');
  SettingsManager.set('DOC_UNIT', 'mm');
} finally { await app.close(); }
console.log(`number-stepper-730-node: ok (${checks} checks)`);
