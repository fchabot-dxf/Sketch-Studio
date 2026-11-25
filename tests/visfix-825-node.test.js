// tests/visfix-825-node.test.js — TASK 825: the visual-only bugs proven by the hunt of task 824 (docs/VISUAL-BUGS-824.md), each asserted on the Shaper node page
// (tests/helpers/node-app.js). A Stock board, two Guides whose values differ (depth 0; depth 1.5 + offset 1), a plain Pocket and a Spiral Pocket (both 6 mm, ¼ in bit):
//  V7: a point-to-line / midpoint / diagonal dimension lights exactly the geometry it binds (constraintTargets, no any-joint fallback for them);
//  V8: the "Not cut" heading's box is computed from ALL the rows under it (the Stock counts, ticked and untickable) like every other heading;
//  V2: the Export step's "unticked:" line names an operation by its row's words and number in the list (a Spiral pocket is told from a plain one);
//  V3: after Settings > Reset (a unit change sent as key null) Prepare's depth chip is redrawn in the new unit;
//  V4: two Guides that differ show what makes them different on their row (depth, offset), as the other types show their depth.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { constraintTargets } from '../packages/ui/geometry-labels.js';
import { exportTickLine } from '../apps/shaper/src/export-payload.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

function rect(st, n, x0, y0, x1, y1) {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
}
const target = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  rect(st, 'SB', 0, 0, 200, 120); rect(st, 'G1', 10, 10, 40, 40); rect(st, 'G2', 50, 10, 80, 40); rect(st, 'P1', 10, 60, 60, 100); rect(st, 'P2', 80, 60, 130, 100); rect(st, 'G3', 90, 10, 120, 40);
  const loops = findLoops(st);
  const K = Object.fromEntries(['SB', 'G1', 'G2', 'G3', 'P1', 'P2'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
  app.modes.showMode('prepare');
  const pv = app.prepare.view();
  const edit = (k, o) => { app.prepare.ok(); pv.setSelection([target(K[k])]); for (const [f, v] of Object.entries(o)) (f === 'cutType' ? (app.prepare.openId() ? app.prepare.pickType(v) : app.prepare.addOperation(v)) : pv.setOpField(f, v)); app.prepare.ok(); }; // TASK S3: a type with no operation open = the operations toolbar's button (addOperation)
  edit('SB', { cutType: 'stock' });
  edit('G1', { cutType: 'guide', cutDepth: 0 });
  edit('G2', { cutType: 'guide', cutDepth: 1.5, cutOffset: 1 });
  edit('G3', { cutType: 'guide', cutDepth: 1.5, cutOffset: 1, toolDia: 6.35 });
  edit('P1', { cutType: 'pocket', toolDia: 6.35, cutDepth: 6 });
  edit('P2', { cutType: 'pocket', toolDia: 6.35, cutDepth: 6, clearing: 'linked', stepover: 40, loop: false });
  pv.setSelection([]);
  const list = app.prepare.opList;
  list.refresh();
  const ops = () => describeOperations(st);
  const rowBox = (id) => [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === id).querySelector('.ops-tick input');
  const headBox = (h) => [...app.document.querySelectorAll('#prepare-ops .ops-tool')].find((e) => e.textContent === h).querySelector('.ops-tick input');
  const idOf = (type, at = 0) => storeOps().filter((o) => o.type === type)[at].id;
  eq(ops().map((o) => o.rowText), ['Stock', 'Guide · 0 mm', 'Guide · 1.5 mm', 'Guide · 1.5 mm', 'Pocket · 6 mm', 'Pocket (spiral) · 6 mm'], 'setup: the list rows (V4: the two Guides tell their depths)');

  // V8: the Not cut heading
  eq(list.inspectTicks().groups[0], { heading: 'Not cut', state: 'all', disabled: false }, 'V8: Stock + 2 Guides ticked: the heading is all');
  app.press(headBox('Not cut'));
  eq(storeOps().filter((o) => o.type === 'guide').map((o) => o.on), [false, false, false], 'V8: the heading unticks its Guides');
  eq(list.inspectTicks().groups[0].state, 'some', 'V8: the Stock under it is still ticked: the heading is mixed, not none');
  app.press(headBox('Not cut'));
  eq(list.inspectTicks().groups[0].state, 'all', 'V8: a tap on the mixed heading ticks them again: all');

  // V4: the Guides' rows
  const guides = ops().filter((o) => o.typeLabel === 'Guide');
  eq(guides.map((o) => o.rowText), ['Guide · 0 mm', 'Guide · 1.5 mm', 'Guide · 1.5 mm'], 'V4: the Guides\' rows show their depths');
  eq(guides.map((o) => o.detail), [null, 'offset 1 mm', 'offset 1 mm, bit 6.35 mm'], 'V4: and the offset, and a bit that is not the default, when there is one');
  eq(new Set(guides.map((o) => o.label)).size, 3, 'V4: the three Guides are told apart (their row words and labels)');
  eq(ops()[0].rowText, 'Stock', 'V4: the Stock keeps its plain row');
  eq(storeOps().filter((o) => o.type === 'guide').length, 3, 'setup: three Guides');
  // V2: the Export line
  app.press(rowBox(idOf('guide', 2))); app.press(rowBox(idOf('pocket', 1)));
  eq(exportTickLine(ops()), 'Exporting 3 of 5 operations (unticked: 3. Guide · 1.5 mm, 5. Pocket (spiral) · 6 mm (¼″ end mill)). Place it with the same anchor as the earlier file.', 'V2: the unticked ones are named as the list names them, with their numbers (TASK 898: the Stock unnumbered): the Spiral pocket is not "Pocket 6 mm"');
  void idOf; void rowBox;

  // V7: constraintTargets: a rectangle A-B-C-D (L1..L4) and a separate line P-Q (L5)
  const shapes7 = [{ id: 'L1', type: 'line', joints: ['A', 'B'] }, { id: 'L2', type: 'line', joints: ['B', 'C'] }, { id: 'L3', type: 'line', joints: ['C', 'D'] }, { id: 'L4', type: 'line', joints: ['D', 'A'] }, { id: 'L5', type: 'line', joints: ['P', 'Q'] }];
  const lit = (c) => { const t = constraintTargets(c, shapes7); return { shapes: [...t.shapes].sort(), joints: [...t.joints].sort() }; };
  eq(lit({ type: 'distance', joints: ['A', 'B'] }), { shapes: ['L1'], joints: ['A', 'B'] }, 'V7: a width (both ends of one line): that line');
  eq(lit({ type: 'distance', joints: ['A', 'C'] }), { shapes: [], joints: ['A', 'C'] }, 'V7: a diagonal (two corners of no one line): the two points only, no line');
  eq(lit({ type: 'distance', joints: ['P', 'C', 'D'] }), { shapes: ['L3'], joints: ['C', 'D', 'P'] }, 'V7: a point-to-line dimension: the line C-D and the point P (no other line)');
  eq(lit({ type: 'midpoint', joints: ['C', 'D', 'P'] }), { shapes: ['L3'], joints: ['C', 'D', 'P'] }, 'V7: a midpoint: the line C-D and the point P');
  eq(lit({ type: 'coincident', joints: ['B', 'D'] }), { shapes: ['L1', 'L2', 'L3', 'L4'], joints: ['B', 'D'] }, 'V7: (a coincident keeps the any-joint rule: every line at either corner)');

  // V3: Settings > Reset (key null) while Prepare shows a depth chip in inches
  SettingsManager.set('DOC_UNIT', 'in', { persist: false });
  pv.setSelection([target(K.P1)]); pv.refreshLook();
  const chips = () => [...app.document.querySelectorAll('#prepare-canvas .sk-chip-text')].map((t) => t.textContent);
  eq(chips(), ['↓ 0.236 in'], 'V3: setup: the depth chip of the selected Pocket in inches');
  SettingsManager.resetToDefaults();
  eq(SettingsManager.get('DOC_UNIT'), 'mm', 'V3: the reset puts the document unit back to mm');
  eq(chips(), ['↓ 6 mm'], 'V3: the chip follows the reset: it says mm, as the card and the list do');
} finally { await app.close(); }
console.log(`visfix-825-node: ${checks} checks passed`);
