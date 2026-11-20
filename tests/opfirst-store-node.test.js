// tests/opfirst-store-node.test.js — TASK S1 (docs/OPERATIONS-MODEL.md section 6, S1): the operations store behind today's Prepare, through the page's own Prepare
// view (prepare-view.js: the card's type pick and field edits) on the Shaper node page (tests/helpers/node-app.js):
//  1. a field edit on selected shapes MOVES them into the operation of the resulting settings (found or new) and they keep their file place (seq): the list and
//     the download are what they were before S1 (one row per settings set, the file in the order the shapes were assigned);
//  2. the BIN (and the Stock move) take the shapes OUT of their operation (advisor ruling 2, task S1: no parked membership): assigned again, a shape takes the
//     settings of the operation it joins and goes to the END of the file order (before S1 its record kept its settings and its place);
//  3. a part's Contour reads its part LIVE (advisor ruling 3): editing the part's depth moves the Contour's depth with it;
//  4. a value that is not part of the operation key is the operation's (advisor ruling 4): a Freehand pocket's stored stepover is shared by its operation.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { planEntries, getPlanRecord, contourKeyOf, keyOf } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { shaperSvgOf } from '../apps/shaper/src/export-payload.js';
import { V2_PLAN } from './helpers/plan-v2.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

// four squares A B C D (apart), drawn into the page's sketch
function drawSquares(st) {
  for (const [n, x] of [['A', 0], ['B', 40], ['C', 80], ['D', 120]]) {
    [[x, 0], [x + 20, 0], [x + 20, 20], [x, 20]].forEach(([px, py], i) => st.joints.set(`${n}j${i}`, { x: px, y: py, sketchId: 'sketch-1' }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
  }
  const loops = findLoops(st);
  return Object.fromEntries(['A', 'B', 'C', 'D'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
}
const target = (key) => { const i = key.indexOf(':'); return { kind: key.slice(0, i), id: key.slice(i + 1) }; };
// the file order: which square each exported element is (by its x)
const fileOrder = (st, K) => [...shaperSvgOf(st, planEntries()).matchAll(/<path [^>]*d="M\s*([-\d.]+)/g)].map((m) => { const x = Number(m[1]); return x < 30 ? 'A' : x < 70 ? 'B' : x < 110 ? 'C' : 'D'; });
const rows = (st) => describeOperations(st).map((o) => `${o.rowText} | ${o.regions}`);

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  const K = drawSquares(st);
  app.modes.showMode('prepare');
  const pv = app.prepare.view();
  const pick = (keys, type) => { pv.setSelection(keys.map((k) => target(K[k]))); pv.applyCutTypeToSelected(type); };
  const set = (keys, field, value) => { pv.setSelection(keys.map((k) => target(K[k]))); pv.setFieldOnSelected(field, value); };

  // 1. A B C pocketed in that order, depth 6: one operation, the file A B C
  pick(['A', 'B', 'C'], 'pocket'); set(['A', 'B', 'C'], 'cutDepth', 6);
  eq(rows(st), ['Pocket · 6 mm | 3 regions'], '1: one operation of 3 pockets');
  const file0 = fileOrder(st, K);
  eq([...new Set(file0)], ['A', 'B', 'C'], '1: the file writes A, B, C in the order they were assigned');
  set(['B'], 'cutDepth', 8);
  eq(rows(st), ['Pocket · 6 mm | 2 regions', 'Pocket · 8 mm | 1 region'], '1: B edited to 8 mm: it moves into a NEW operation (shallow before deep, the default rule)');
  eq(storeOps().map((o) => o.geometry.map((g) => g.seq)), [[1, 3], [2]], '1: B keeps its file place (seq 2)');
  eq([...new Set(fileOrder(st, K))], ['A', 'B', 'C'], '1: the file order is unchanged');
  set(['B'], 'cutDepth', 6);
  eq(rows(st), ['Pocket · 6 mm | 3 regions'], '1: B back to 6 mm: it joins the existing operation (found), the 8 mm one goes');
  eq(fileOrder(st, K), file0, '1: and the file is the one before, byte for byte in order');

  // 2. the bin: C's operation (A B C) -> unassigned; C assigned again (Pocket 6 mm): it joins A, B's operation... first bin only C via a type of its own
  set(['C'], 'cutDepth', 4); // C alone in a 4 mm operation
  const binOp = describeOperations(st).find((o) => o.rowText === 'Pocket · 4 mm');
  app.prepare.opList.refresh();
  const binBtn = [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === binOp.id).querySelector('.ops-del');
  app.press(binBtn);
  eq(getPlanRecord(K.C), null, '2: the bin takes C out of every operation (no parked record)');
  eq(rows(st), ['Pocket · 6 mm | 2 regions'], '2: its operation is gone');
  pick(['C'], 'pocket'); set(['C'], 'cutDepth', 6);
  eq(rows(st), ['Pocket · 6 mm | 3 regions'], '2: assigned again with the same settings, C joins the operation');
  eq([...new Set(fileOrder(st, K))], ['A', 'B', 'C'], '2: (C was last already)');
  // A binned and assigned again: it goes to the END of the file order (advisor ruling 2)
  set(['A'], 'cutDepth', 3);
  const opA = describeOperations(st).find((o) => o.rowText === 'Pocket · 3 mm');
  app.prepare.opList.refresh();
  app.press([...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === opA.id).querySelector('.ops-del'));
  pick(['A'], 'pocket');
  eq(getPlanRecord(K.A).cutDepth, 'unset', '2: A assigned again starts from the default settings (its old 3 mm is not kept)');
  set(['A'], 'cutDepth', 6);
  eq([...new Set(fileOrder(st, K))], ['B', 'C', 'A'], '2: A assigned again is written LAST (the end of the file order)');
  // the Stock move: D is the Stock, then A becomes the Stock: D leaves its operation
  pick(['D'], 'stock');
  eq(getPlanRecord(K.D).cutType, 'stock', '2: D is the Stock');
  pick(['B'], 'stock');
  eq([getPlanRecord(K.D), getPlanRecord(K.B).cutType], [null, 'stock'], '2: the Stock moved to B: D is in no operation');

  // 4. a value that is not part of the key is the operation's: C's stored stepover (Freehand) is the operation's (A and C share it)
  set(['C'], 'stepover', 25);
  eq([getPlanRecord(K.A).stepover, getPlanRecord(K.C).stepover], [25, 25], '4: a Freehand pocket\'s stepover (not in its key) is its operation\'s: A and C share it');
  eq(rows(st).filter((r) => r.startsWith('Pocket')), ['Pocket · 6 mm | 2 regions'], '4: still one operation');
} finally { await app.close(); }

// 3. a part's Contour reads its part live: a drawn Roughing 8 mm + its Contour; the part's depth set to 10 mm: the Contour runs to 10 mm
{
  V2_PLAN.use(null).clear(); // the store is module state: the first page's plan is still in it (as CUT_PLAN was)
  const app2 = await open({ host: 'shaper' });
  try {
    const st = app2.state;
    const K = drawSquares(st);
    app2.modes.showMode('prepare');
    const pv = app2.prepare.view();
    pv.setSelection([target(K.A)]); pv.applyCutTypeToSelected('roughing'); pv.setFieldOnSelected('cutDepth', 8); pv.setFieldOnSelected('contour', true);
    const contourDepth = () => planEntries().find((e) => e.planKey === contourKeyOf(K.A)).rec.baseDepth;
    eq(contourDepth(), 8, '3: the Contour runs to its part\'s 8 mm');
    pv.setSelection([target(K.A)]); pv.setFieldOnSelected('cutDepth', 10);
    eq(contourDepth(), 10, '3: the part set to 10 mm: its Contour runs to 10 mm (read live, advisor ruling 3)');
    eq(describeOperations(st).map((o) => o.cutType), ['roughing', 'contour'], '3: two operations: the Roughing and its Contour');
  } finally { await app2.close(); }
}
console.log(`opfirst-store-node: ${checks} checks passed`);
