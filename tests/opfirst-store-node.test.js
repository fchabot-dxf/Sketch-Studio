// tests/opfirst-store-node.test.js — TASK S1 (docs/OPERATIONS-MODEL.md section 6, S1), updated for TASK S2 (operation first: an operation is opened, edited and confirmed):
// the operations store behind Prepare, through the page's own Prepare stage (its type pick, the open operation's field edits, OK) on the Shaper node page
// (tests/helpers/node-app.js):
//  1. TASK S2: a field edit of an operation applies to EVERY one of its shapes; it stays one operation, its shapes keep their file places (seq), the file order is
//     the order the shapes were assigned;
//  2. the BIN deletes the operation (TASK S2): its shapes are in no operation; picked again (the quick flow: a NEW operation) a shape starts from the default settings
//     and goes to the END of the file order; the Stock move (one Stock per document): the previous Stock shape leaves the Stock;
//  3. TASK S2 (owner ruling turn 2713): a Contour has its OWN depth: editing the Roughing's depth does not move it (S1 read it live from its part);
//  4. every setting is the operation's: a Freehand pocket's stepover is shared by its shapes;
//  5. the LIST ORDER (advisor ruling, turn 2702: listOrder): while the user has never reordered ('default') the list is re-sorted by the default rule after every
//     change, as before S1 (¼ in Pocket 3 + ¼ in Pocket 6 + ⅛ in Inside, then the 6 mm pocket made an Outside: the ⅛ in Inside first, the Outside last); once
//     the user reorders ('stored') a new operation joins its tool's run (the 743 slot rule) and the rest keeps its place; saved, reloaded and undone with the store.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { planEntries, getPlanRecord, contourKeyOf, keyOf } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { storeOps, listOrder, reorderOps, membersOf } from '../apps/shaper/src/operations-store.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
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
// TASK S2: the page's own steps: shapes picked + a type = a NEW operation, open; the fields set in it; OK. editOp: the operation of a shape opened, changed, OK.
const flows = (app, K) => {
  const pv = () => app.prepare.view();
  const fields = (o) => { for (const [f, v] of Object.entries(o)) if (f === 'cutType') app.prepare.pickType(v); else pv().setOpField(f, v); };
  return {
    make: (keys, o) => { app.prepare.ok(); pv().setSelection(keys.map((k) => target(K[k]))); fields(o); app.prepare.ok(); },
    editOp: (k, o) => { app.prepare.ok(); app.prepare.edit(membersOf(K[k])[0].op.id); fields(o); app.prepare.ok(); },
  };
};

const app = await open({ host: 'shaper' });
try {
  const st = app.state;
  const K = drawSquares(st);
  app.modes.showMode('prepare');
  const { make, editOp } = flows(app, K);

  // 1. A B C pocketed in that order, depth 6: one operation; its depth edited: every shape, still one operation, the file order kept
  make(['A', 'B', 'C'], { cutType: 'pocket', cutDepth: 6 });
  eq(rows(st), ['Pocket · 6 mm | 3 regions'], '1: one operation of 3 pockets');
  const file0 = fileOrder(st, K);
  eq([...new Set(file0)], ['A', 'B', 'C'], '1: the file writes A, B, C in the order they were assigned');
  editOp('B', { cutDepth: 8 });
  eq(rows(st), ['Pocket · 8 mm | 3 regions'], '1 (TASK S2): the operation\'s depth edited: all 3 shapes at 8 mm, still one operation');
  eq(storeOps().map((o) => o.geometry.map((g) => g.seq)), [[1, 2, 3]], '1: the shapes keep their file places');
  eq(fileOrder(st, K), file0, '1: the file order is unchanged');
  editOp('B', { cutDepth: 6 });

  // 2. the bin deletes the operation; picked again, a shape starts from the defaults and is written last; the Stock move
  const opABC = storeOps()[0];
  app.prepare.opList.refresh();
  const rowOf = (id) => [...app.document.querySelectorAll('#prepare-ops .ops-row')].find((r) => r.dataset.id === id);
  app.press(rowOf(opABC.id).querySelector('.ops-pick')); // the row selected: its actions show
  app.press(rowOf(opABC.id).querySelector('.ops-del'));
  eq([getPlanRecord(K.A), getPlanRecord(K.B), getPlanRecord(K.C), rows(st)], [null, null, null, []], '2: the bin deletes the operation: its shapes are in no operation');
  make(['B', 'C'], { cutType: 'pocket', cutDepth: 6 });
  make(['A'], { cutType: 'pocket' });
  eq(getPlanRecord(K.A).cutDepth, 'unset', '2: A picked again starts from the default settings (a NEW operation: the quick flow)');
  editOp('A', { cutDepth: 6 });
  eq([...new Set(fileOrder(st, K))], ['B', 'C', 'A'], '2: A picked again is written LAST (the end of the file order)');
  make(['D'], { cutType: 'stock' });
  eq(getPlanRecord(K.D).cutType, 'stock', '2: D is the Stock');
  make(['B'], { cutType: 'stock' });
  eq([getPlanRecord(K.D), storeOps().filter((o) => o.type === 'stock').map((o) => o.geometry.map((g) => g.key))], [null, [[K.B]]], '2: the Stock moved to B: D is in no operation (B stays in its Pocket too)');

  // 4. every setting is the operation's: a Freehand pocket's stepover is shared by its shapes
  const pocketBC = storeOps().find((o) => o.type === 'pocket' && o.geometry.some((g) => g.key === K.C));
  editOp('C', { stepover: 25 });
  eq([pocketBC.settings.stepover, pocketBC.geometry.map((g) => g.key)], [25, [K.B, K.C]], '4: the stepover is its operation\'s: B and C share it');
} finally { await app.close(); }

// 3. TASK S2: a Contour has its OWN depth: the Roughing's depth edited, the Contour stays where it was set (owner ruling turn 2713)
{
  V2_PLAN.use(null).clear(); // the store is module state: the first page's plan is still in it (as CUT_PLAN was)
  const app2 = await open({ host: 'shaper' });
  try {
    const st = app2.state;
    const K = drawSquares(st);
    app2.modes.showMode('prepare');
    const { make, editOp } = flows(app2, K);
    make(['A'], { cutType: 'roughing', cutDepth: 8 });
    make(['A'], { cutType: 'contour', cutDepth: 8 });
    const contourDepth = () => planEntries().find((e) => e.planKey === contourKeyOf(K.A)).rec.baseDepth;
    eq(contourDepth(), 8, '3: the Contour runs to its own 8 mm');
    editOp('A', { cutDepth: 10 }); // A's first operation: the Roughing
    eq([getPlanRecord(K.A).cutDepth, contourDepth()], [10, 8], '3: the Roughing set to 10 mm: the Contour stays at its own 8 mm');
    eq(describeOperations(st).map((o) => o.cutType), ['roughing', 'contour'], '3: two operations: the Roughing and the Contour');
  } finally { await app2.close(); }
}
// 5. the list order
{
  V2_PLAN.use(null).clear();
  const app3 = await open({ host: 'shaper' });
  try {
    const st = app3.state;
    const K = drawSquares(st);
    app3.modes.showMode('prepare');
    const { make, editOp } = flows(app3, K);
    const edit = (k, o) => (membersOf(K[k]).length ? editOp(k, o) : make([k], o)); // TASK S2: a shape's operation edited (a type change: its type), or a new one made
    const labels = () => describeOperations(st).map((o) => o.label.split(' (')[0]);
    edit('A', { cutType: 'pocket', toolDia: 6.35, cutDepth: 3 }); edit('B', { cutType: 'pocket', toolDia: 6.35, cutDepth: 6 }); edit('C', { cutType: 'interior', toolDia: 3.175, cutDepth: 6 });
    eq([listOrder(), labels()], ['default', ['¼″ end mill · Pocket · 3 mm', '¼″ end mill · Pocket · 6 mm', '⅛″ end mill · Inside · 6 mm']], '5: the default order (no reorder yet)');
    const v3before = JSON.parse(JSON.stringify(captureShaperDoc()));
    eq(v3before.listOrder, 'default', '5: saved with listOrder default');
    edit('B', { cutType: 'exterior' });
    eq(labels(), ['⅛″ end mill · Inside · 6 mm', '¼″ end mill · Pocket · 3 mm', '¼″ end mill · Outside · 6 mm'], '5 (default): the 6 mm pocket made an Outside: the list is re-sorted as before S1 (the ⅛ in Inside first, the part-freeing Outside last)');
    // the same in 'stored' mode: the user reordered first (the list's own reorder: the same three rows, the ⅛ in Inside moved up)
    edit('B', { cutType: 'pocket' });
    eq(labels(), ['¼″ end mill · Pocket · 3 mm', '¼″ end mill · Pocket · 6 mm', '⅛″ end mill · Inside · 6 mm'], '5: back to the pocket: the default order again');
    const ids = storeOps().map((o) => o.id);
    reorderOps([ids[2], ids[0], ids[1]]);
    eq([listOrder(), labels()], ['stored', ['⅛″ end mill · Inside · 6 mm', '¼″ end mill · Pocket · 3 mm', '¼″ end mill · Pocket · 6 mm']], '5: the user reordered: the order is stored');
    edit('B', { cutType: 'exterior' });
    eq(labels(), ['⅛″ end mill · Inside · 6 mm', '¼″ end mill · Pocket · 3 mm', '¼″ end mill · Outside · 6 mm'], '5 (stored): the new Outside joins its tool\'s run, after its pocket (the 743 slot rule); nothing else moves');
    const v3 = JSON.parse(JSON.stringify(captureShaperDoc()));
    eq(v3.listOrder, 'stored', '5: saved with listOrder stored');
    applyShaperDoc(v3, st);
    eq([listOrder(), labels()], ['stored', ['⅛″ end mill · Inside · 6 mm', '¼″ end mill · Pocket · 3 mm', '¼″ end mill · Outside · 6 mm']], '5: reloaded: the stored order and the flag');
    applyShaperDoc(v3before, st);
    eq(listOrder(), 'default', '5: the earlier document: default again');
    // a version 2 document: stored only when its opOrder was not empty
    V2_PLAN.use(st).setOrder([]);
    eq(listOrder(), 'default', '5: a version 2 document without an opOrder migrates as default');
    V2_PLAN.setOrder([JSON.stringify(['endmill|3.175|', 'interior', { depth: 6, offset: 0 }])]);
    eq(listOrder(), 'stored', '5: a version 2 document with an opOrder migrates as stored');
    V2_PLAN.use(null).setOrder([]);
  } finally { await app3.close(); }
}
console.log(`opfirst-store-node: ${checks} checks passed`);
