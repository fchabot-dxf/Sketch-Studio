// tests/opfirst-ui-s2-node.test.js — TASK S2 (docs/OPERATIONS-MODEL.md 4.2-4.4, section 6 S2): the OPERATION-FIRST Prepare on the Shaper node page (the page's own Prepare
// stage, cut card and Operations list: tests/helpers/node-app.js), driven by clicks on the canvas and presses on the card / list, a drawn design of three squares A, B, C
// and an open line L:
//  1. the shape card of a shape in no operation: today's card (type menu first), its rows greyed ("pick a type first"), no chips; every type offered;
//  2. the QUICK FLOW: a type picked = a NEW operation holding the shape, left ACTIVE in Add shapes mode (Done, the canvas's mode, the list row says so); ONE undo step;
//  3. Add shapes mode: a click puts a shape in, a second click takes it out, each ONE undo step; Esc = Done; a press on empty canvas keeps the mode;
//  4. the OPERATION card: "Pocket 1 · 2 shapes: a change applies to all 2" and its SHAPES, one row each (its words); a change applies to EVERY shape; a click on a
//     shape outside Add mode leaves the operation (the shape card);
//  5. (owner turns 2710-2712) a shape row's X takes that shape out; DUPLICATE: a new operation with the same type, settings, tick and shapes (new file places), right
//     after the original while the list order is the user's, made active; one undo step each;
//  6. changing the type: allowed when every shape can take it, greyed with the reason otherwise (the Stock and two shapes);
//  7. (owner ruling turn 2713) the CONTOUR is a plain operation, never greyed, linked to nothing: its own Depth and Wall side (a drawn shape), no allowance coupling; a
//     shape in Roughing + Contour (MULTI-MEMBERSHIP); editing the Roughing's depth does not move the Contour; the shape card's 2 chips; a chip opens its operation;
//     the quick flow on a shape already in a Roughing makes ANOTHER Roughing (never joins);
//  8. the bin deletes the OPERATION (its shapes stay in their other operations, the Contour still cuts); Undo puts it back in its place;
//  9. an EMPTY operation (its last shape taken out) is listed "no shapes yet: click shapes to add", saved (version 4) and read back; an edited operation keeps its
//     place while the list order is the user's ('stored').
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf, planEntries } from '../apps/shaper/src/cut-plan.js';
import { storeOps, captureStore, reorderOps } from '../apps/shaper/src/operations-store.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
SettingsManager.set('LENGTH_PRECISION', null);

function rect(st, n, x0, y0, x1, y1) {
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${n}j${i}`, { x, y, sketchId: 'sketch-1' }));
  for (let i = 0; i < 4; i++) st.shapes.push({ id: `${n}s${i}`, type: 'line', joints: [`${n}j${i}`, `${n}j${(i + 1) % 4}`], sketchId: 'sketch-1' });
}

const app = await open({ host: 'shaper' });
try {
  const st = app.state, doc = app.document, q = (s) => doc.querySelector(s), qa = (s) => [...doc.querySelectorAll(s)];
  rect(st, 'A', 0, 0, 40, 40); rect(st, 'B', 60, 0, 100, 40); rect(st, 'C', 120, 0, 160, 40);
  st.joints.set('Lj0', { x: 0, y: 70, sketchId: 'sketch-1' }); st.joints.set('Lj1', { x: 160, y: 70, sketchId: 'sketch-1' }); // an open line L
  st.shapes.push({ id: 'Ls0', type: 'line', joints: ['Lj0', 'Lj1'], sketchId: 'sketch-1' });
  const loops = findLoops(st);
  const K = Object.fromEntries(['A', 'B', 'C'].map((n) => [n, keyOf('loop', loops.find((l) => l.edges.includes(`${n}s0`)).id)]));
  app.modes.showMode('prepare');
  const pv = () => app.prepare.view();
  const AT = { A: [0, 20], B: [60, 20], C: [120, 20], L: [80, 70], none: [50, 120] }; // on an edge of each (the ink pick), and empty canvas
  const clickAt = (n, o) => { const pc = doc.getElementById('prepare-canvas'); const p = worldToScreen(pc, { x: AT[n][0], y: AT[n][1] }); app.click(Math.round(p.x), Math.round(p.y), { target: pc, ...o }); };
  const pressEl = (s) => { const e = q(s); assert.ok(e, s + ' not found'); app.press(e); };
  const menu = () => { pressEl('.cut-type-trigger'); const out = qa('.cut-type-opt').map((o) => [o.dataset.id, o.getAttribute('aria-disabled') === 'true']); pressEl('.cut-type-trigger'); return out; };
  const pick = (id) => { pressEl('.cut-type-trigger'); pressEl(`.cut-type-opt[data-id="${id}"]`); };
  const typed = (cls, v) => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); };
  const head = () => (q('.cut-op-headrow').hidden ? null : q('.cut-op-head').textContent);
  const chips = () => (q('.cut-chips').hidden ? [] : qa('.cut-chip').map((b) => b.textContent));
  const nameOf = (key) => Object.keys(K).find((n) => K[n] === key);
  const geo = () => (q('.cut-geo').hidden ? null : { add: `${q('.cut-geo-add').textContent}${q('.cut-geo-add').getAttribute('aria-disabled') === 'true' ? ' (off)' : ''}`, shapes: qa('.cut-geo-shape').map((r) => `${nameOf(r.dataset.key)}: ${r.querySelector('.cut-geo-name').textContent}`) });
  const xOf = (n) => q(`.cut-geo-shape[data-key="${K[n]}"] .cut-geo-x`);
  const rowState = (name) => { const r = q(`.cut-row[data-row="${name}"], .cut-row[data-param="${name}"]`); return r.style.display === 'none' || 'offTab' in r.dataset ? 'none' : 'off' in r.dataset ? 'greyed' : 'live'; };
  const tab = (id) => { const b = q(`.cut-tab[data-tab="${id}"]`); if (!b.classList.contains('is-active')) app.press(b); };
  const rows = () => app.prepare.opList.inspect().items.filter((i) => i.id).map((i) => `${i.text} | ${i.sub}${i.picked ? ' *' : ''}`);
  const ops = () => storeOps().map((o) => `${o.type}:${o.geometry.map((r) => nameOf(r.key) + r.seq).join(',')}`);
  const hist = () => st.history.length;
  const steps = (fn) => { const h = hist(); fn(); return hist() - h; };
  const recs = () => planEntries().map((e) => `${e.rec.cutType}:${nameOf(`${e.target.kind}:${e.target.id}`) || e.planKey}:${e.rec.cutDepth}`);
  const nOf = (id) => storeOps().findIndex((o) => o.id === id) + 1; // an operation's number in the list

  // 1. the shape card of a shape in no operation
  clickAt('A');
  ok(!q('.cut-card').hidden, '1: a click on A opens the card');
  eq([head(), chips(), geo(), q('.cut-type-cur').textContent], [null, [], null, 'Select type'], '1: the shape card: no header, no chips, no Shapes, the type menu first');
  ok(qa('.cut-rows .cut-row').filter((r) => r.style.display !== 'none').every((r) => 'off' in r.dataset), '1: its rows are shown greyed (they belong to an operation)');
  eq(menu().filter(([, off]) => off).map(([id]) => id), [], '1: the type menu: every type offered, the Contour too (never greyed)');

  // 2. the quick flow
  eq(steps(() => pick('pocket')), 1, '2: the type pick is ONE undo step');
  eq(ops(), ['pocket:A1'], '2: a NEW Pocket holding A');
  eq([head(), geo()], ['Pocket 1 · 1 shape', { add: 'Done', shapes: ['A: Shape 40 × 40 mm'] }], '2: the operation card, active, in Add shapes mode (Done); its shape listed');
  ok(q('#prepare-canvas').classList.contains('is-adding'), '2: the canvas shows the mode');
  eq(rows(), ['Pocket · depth unset | click shapes to add · Done *'], '2: its list row is marked and says the mode');

  // 3. Add shapes mode
  eq(steps(() => clickAt('B')), 1, '3: a click on B adds it: ONE undo step');
  eq([ops(), head()], [['pocket:A1,B2'], 'Pocket 1 · 2 shapes: a change applies to all 2'], '3: B is in (the next file place)');
  clickAt('B');
  eq(ops(), ['pocket:A1'], '3: a second click takes B out');
  clickAt('B');
  eq(ops(), ['pocket:A1,B3'], '3: and in again (a new membership: the next file place)');
  clickAt('L');
  eq(ops(), ['pocket:A1,B3'], '3: the open line is refused');
  eq(q('#prepare-notice').textContent, 'Pocket needs a closed shape: 1 of the shapes is an open line', '3: its reason is the notice');
  clickAt('none');
  ok(pv().isAdding(), '3: a press on empty canvas keeps the mode (it pans)');
  app.esc();
  eq([pv().isAdding(), geo().add, q('#prepare-canvas').classList.contains('is-adding')], [false, 'Add shapes', false], '3: Esc = Done');
  eq(rows(), ['Pocket · depth unset | 2 regions *'], '3: the row back to its words');

  // 4. the operation card: a change applies to every shape
  eq(geo().shapes, ['A: Shape 40 × 40 mm', 'B: Shape 40 × 40 mm'], '4: its shapes, one row each');
  eq(steps(() => typed('.cut-depth', '6')), 1, '4: a depth typed: one undo step');
  eq(recs(), ['pocket:A:6', 'pocket:B:6'], '4: both shapes cut at 6 mm (the operation\'s setting)');
  const pocketId = storeOps()[0].id;
  clickAt('B');
  eq([pv().activeOp(), head(), chips()], [null, null, ['1 Pocket']], '4: a click on one of its shapes outside Add mode leaves the operation: the shape card (its chip)');
  pressEl(`.cut-chip[data-op="${pocketId}"]`);
  eq(pv().activeOp().id, pocketId, '4: the chip opens it again');

  // 5. the X of a shape row; Duplicate
  const before5 = JSON.stringify(captureStore());
  eq(steps(() => app.press(xOf('B'))), 1, '5: the X of B: one undo step');
  eq([ops(), geo().shapes], [['pocket:A1'], ['A: Shape 40 × 40 mm']], '5: B is out of the operation');
  app.undo();
  eq(JSON.stringify(captureStore()), before5, '5: Undo: B back in its file place');
  reorderOps(storeOps().map((o) => o.id)); // the user's list order ('stored'): a copy goes right after its original
  eq(steps(() => pressEl('.cut-op-dup')), 1, '5: Duplicate: one undo step');
  eq(ops(), ['pocket:A1,B3', 'pocket:A4,B5'], '5: a NEW Pocket with the same shapes (new file places), right after the original');
  eq(storeOps()[1].settings, storeOps()[0].settings, '5: with the same settings');
  eq([pv().activeOp().id, head()], [storeOps()[1].id, 'Pocket 2 · 2 shapes: a change applies to all 2'], '5: the copy is the active operation');
  typed('.cut-depth', '9');
  eq(recs(), ['pocket:A:6', 'pocket:B:6', 'pocket:A:9', 'pocket:B:9'], '5: changed separately: two identical paths per shape, each with its own depth (file order)');
  app.undo(); app.undo();
  eq(JSON.stringify(captureStore()), JSON.stringify({ ...JSON.parse(before5), listOrder: 'stored' }), '5: Undo twice: the copy gone');

  // 6. changing the type (A + B in one Pocket)
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  eq(head(), 'Pocket 1 · 2 shapes: a change applies to all 2', '6: a row tap: the operation is active');
  eq(menu().filter(([, off]) => off).map(([id]) => id), ['stock'], '6: the type menu: the Stock greyed (two shapes); every other type offered');
  eq(steps(() => pick('exterior')), 1, '6: the type changed: one undo step');
  eq([ops(), recs()], [['exterior:A1,B3'], ['exterior:A:6', 'exterior:B:6']], '6: the operation is an Outside now, its shapes and settings kept');
  eq(head(), 'Outside 1 · 2 shapes: a change applies to all 2', '6: its header');
  app.undo();
  eq(ops(), ['pocket:A1,B3'], '6: Undo: a Pocket again');

  // 7. Roughing + Contour on C (multi-membership); the Contour a plain operation
  clickAt('none'); clickAt('C');
  eq(steps(() => pick('roughing')), 1, '7: C: a Roughing (the quick flow)');
  const rough = storeOps().find((o) => o.type === 'roughing');
  eq(rough.settings.finishAllowance, 0, '7: a new Roughing\'s allowance starts at 0 (the Roughing default with no Contour)');
  tab('heights'); typed('.cut-depth', '8');
  app.esc(); clickAt('none'); clickAt('C');
  eq(chips(), [`${nOf(rough.id)} Roughing`], '7: the shape card of C: one chip (its list number and type)');
  eq(steps(() => pick('contour')), 1, '7: Contour picked: one undo step');
  const contour = storeOps().find((o) => o.type === 'contour');
  eq(pv().activeOp().id, contour.id, '7: the Contour operation is active');
  eq(storeOps().find((o) => o.type === 'roughing').settings.finishAllowance, 0, '7: adding the Contour leaves the Roughing\'s allowance alone');
  tab('heights');
  eq(rowState('cutDepth'), 'live', '7: the Contour has its own Depth row');
  typed('.cut-depth', '5');
  tab('geometry');
  eq(rowState('wallSide'), 'live', '7: and its own Wall side (C is a drawn shape: its model does not say the side)');
  const cOf = () => planEntries().filter((e) => e.target.id === K.C.slice(5)).map((e) => [e.rec.cutType, e.rec.cutType === 'contour' ? e.rec.baseDepth : e.rec.cutDepth]);
  eq(cOf(), [['roughing', 8], ['contour', 5]], '7: C has two entries: the Roughing at 8, the Contour at its own 5');
  pressEl('.cut-row[data-row="wallSide"] .cut-preset[data-value="outside"]');
  eq(storeOps().find((o) => o.type === 'contour').settings.wallSide, 'outside', '7: Wall side Outside (stored on the Contour)');
  app.undo();
  pressEl(`#prepare-ops .ops-row[data-id="${rough.id}"] .ops-pick`);
  tab('heights'); typed('.cut-depth', '12');
  eq(cOf(), [['roughing', 12], ['contour', 5]], '7: editing the Roughing\'s depth does not move the Contour (owner ruling turn 2713)');
  clickAt('none'); clickAt('C');
  eq(chips(), [[rough.id, 'Roughing'], [contour.id, 'Contour']].sort((a, b) => nOf(a[0]) - nOf(b[0])).map(([id, t]) => `${nOf(id)} ${t}`), '7: the shape card of C: two chips, in list order');
  pressEl(`.cut-chip[data-op="${rough.id}"]`);
  eq([pv().activeOp().id, pv().isAdding()], [rough.id, false], '7: a chip opens its operation, not in Add mode');
  clickAt('none'); clickAt('C');
  pick('roughing');
  eq(storeOps().filter((o) => o.type === 'roughing').length, 2, '7: the quick flow on C again makes ANOTHER Roughing (never joins)');
  app.undo();
  eq(storeOps().filter((o) => o.type === 'roughing').length, 1, '7: Undo');

  // 8. the bin
  const order8 = storeOps().map((o) => o.id);
  eq(steps(() => app.press(q(`#prepare-ops .ops-row[data-id="${rough.id}"] .ops-del`))), 1, '8: the bin: one undo step');
  ok(!storeOps().some((o) => o.id === rough.id), '8: the Roughing operation is deleted');
  eq(cOf(), [['contour', 5]], '8: C stays in its Contour, which still cuts at its own depth');
  app.undo();
  eq(storeOps().map((o) => o.id), order8, '8: Undo puts it back in its place');
  app.redo();
  ok(!storeOps().some((o) => o.id === rough.id), '8: Redo deletes it again');
  app.undo();

  // 9. an empty operation; an edited operation keeps its place
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  app.press(xOf('A')); app.press(xOf('B'));
  const pocket = storeOps().find((o) => o.id === pocketId);
  eq(pocket.geometry.length, 0, '9: A and B taken out: the Pocket is EMPTY');
  ok(rows().some((r) => /^Pocket · 6 mm \| no shapes yet: click shapes to add \*$/.test(r)), '9: listed "no shapes yet: click shapes to add"');
  eq([head(), geo().shapes], [`Pocket ${nOf(pocketId)} · no shapes yet`, []], '9: its card');
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  ok(saved.version === 4 && saved.operations.some((o) => o.id === pocketId && o.geometry.length === 0), '9: saved (version 4) with no shapes');
  eq(saved.operations.find((o) => o.type === 'contour').settings.cutDepth, 5, '9: the Contour\'s own depth is saved');
  applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
  ok(storeOps().some((o) => o.id === pocketId && o.geometry.length === 0), '9: read back: still there, empty');
  eq(JSON.parse(JSON.stringify(captureShaperDoc())), saved, '9: saved -> read -> saved: the same document');
  app.prepare.mount();
  reorderOps(storeOps().map((o) => o.id).reverse());
  const place = storeOps().findIndex((o) => o.type === 'contour');
  pressEl(`#prepare-ops .ops-row[data-id="${storeOps()[place].id}"] .ops-pick`);
  tab('tool');
  pressEl('.cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]');
  eq(storeOps().findIndex((o) => o.type === 'contour'), place, '9: an edited operation keeps its place (the user\'s list order)');
  eq(storeOps()[place].settings.toolDia, 6.35, '9: (edited)');

  console.log(`opfirst-ui-s2-node: ${checks} checks passed`);
} finally {
  app.close();
}
