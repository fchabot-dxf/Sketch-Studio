// tests/opfirst-ui-s2-node.test.js — TASK S2 (docs/OPERATIONS-MODEL.md 4.2-4.4, section 6 S2): the OPERATION-FIRST Prepare on the Shaper node page (the page's own Prepare
// stage, cut card and Operations list: tests/helpers/node-app.js), driven by clicks on the canvas and presses on the card / list, a drawn design of three squares A, B, C:
//  1. the shape card of a shape in no operation: today's card (type menu first), its rows greyed ("pick a type first"), no chips;
//  2. the QUICK FLOW: a type picked = a NEW operation holding the shape, left ACTIVE in Add shapes mode (Done, the canvas's mode, the list row says so); ONE undo step;
//  3. Add shapes mode: a click puts a shape in, a second click takes it out, each ONE undo step; Esc = Done; a press on empty canvas keeps the mode;
//  4. the OPERATION card: "Pocket 1 · 2 shapes: a change applies to all 2"; a change applies to EVERY shape; the shape in hand (a click on one of its shapes);
//  5. Make its own operation: the shape in hand leaves into a NEW operation with the same settings and its file place (seq), made active; Remove; one undo step each;
//  6. changing the type: allowed when every shape can take it, greyed with the reason otherwise (an open line and a region type; a Contour on a shape with no part);
//  7. a shape in Roughing + Contour (MULTI-MEMBERSHIP), the Contour in the type menu, its part line, no allowance coupling; the shape card's 2 chips; a chip opens
//     its operation; the quick flow on a shape already in a Roughing makes ANOTHER Roughing (never joins);
//  8. the bin deletes the OPERATION (its shapes stay in their other operations); Undo puts it back in its place;
//  9. an EMPTY operation (its last shape taken out) is listed "no shapes yet: click shapes to add", saved and read back; an edited operation keeps its place while
//     the list order is the user's ('stored'); Undo / Redo of every step.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf, planEntries, CONTOUR_NEEDS_PART } from '../apps/shaper/src/cut-plan.js';
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
  const head = () => (q('.cut-op-head').hidden ? null : q('.cut-op-head').textContent);
  const chips = () => (q('.cut-chips').hidden ? [] : qa('.cut-chip').map((b) => b.textContent));
  const geo = () => (q('.cut-geo').hidden ? null : Object.fromEntries([['add', '.cut-geo-add'], ['remove', '.cut-geo-remove'], ['own', '.cut-geo-own']].map(([k, s]) => [k, `${q(s).textContent}${q(s).getAttribute('aria-disabled') === 'true' ? ' (off)' : ''}`])));
  const rows = () => app.prepare.opList.inspect().items.filter((i) => i.id).map((i) => `${i.text} | ${i.sub}${i.picked ? ' *' : ''}`);
  const ops = () => storeOps().map((o) => `${o.type}:${o.geometry.map((r) => Object.keys(K).find((n) => K[n] === r.key) + r.seq).join(',')}`);
  const hist = () => st.history.length;
  const steps = (fn) => { const h = hist(); fn(); return hist() - h; };
  const recs = () => planEntries().map((e) => `${e.rec.cutType}:${Object.keys(K).find((n) => K[n] === e.target.kind + ':' + e.target.id) || e.planKey}:${e.rec.cutDepth}`);

  // 1. the shape card of a shape in no operation
  clickAt('A');
  ok(!q('.cut-card').hidden, '1: a click on A opens the card');
  eq([head(), chips(), geo(), q('.cut-type-cur').textContent], [null, [], null, 'Select type'], '1: the shape card: no header, no chips, no Geometry row, the type menu first');
  ok(qa('.cut-rows .cut-row').filter((r) => r.style.display !== 'none').every((r) => 'off' in r.dataset), '1: its rows are shown greyed (they belong to an operation)');
  eq(menu().filter(([, off]) => off).map(([id]) => id), ['contour'], '1: the type menu: every type, the Contour greyed (A is in no operation that takes one)');

  // 2. the quick flow
  eq(steps(() => pick('pocket')), 1, '2: the type pick is ONE undo step');
  eq(ops(), ['pocket:A1'], '2: a NEW Pocket holding A');
  eq([head(), geo()], ['Pocket 1 · 1 shape', { add: 'Done', remove: 'Remove (off)', own: 'Make its own operation (off)' }], '2: the operation card, active, in Add shapes mode (Done); no shape in hand yet: Remove / Make its own greyed');
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

  // 4. the operation card: a change applies to every shape; the shape in hand
  eq(steps(() => typed('.cut-depth', '6')), 1, '4: a depth typed: one undo step');
  eq(recs(), ['pocket:A:6', 'pocket:B:6'], '4: both shapes cut at 6 mm (the operation\'s setting)');
  clickAt('B');
  eq([pv().activeOp().id, pv().shapeInHand() === K.B, geo()], [storeOps()[0].id, true, { add: 'Add shapes', remove: 'Remove', own: 'Make its own operation' }], '4: a click on one of its shapes (outside Add mode): in hand, the operation stays active');

  // 5. Make its own operation / Remove
  const before5 = JSON.stringify(captureStore());
  eq(steps(() => pressEl('.cut-geo-own')), 1, '5: Make its own operation: one undo step');
  eq(ops(), ['pocket:A1', 'pocket:B3'], '5: B leaves into a NEW Pocket, keeping its file place (seq 3)');
  eq(storeOps()[1].settings, storeOps()[0].settings, '5: with the same settings');
  eq([pv().activeOp().id, pv().shapeInHand() === K.B, head()], [storeOps()[1].id, true, 'Pocket 2 · 1 shape'], '5: the new operation is active, B in hand');
  app.undo();
  eq(JSON.stringify(captureStore()), before5, '5: Undo: as before');
  app.redo();
  eq(ops(), ['pocket:A1', 'pocket:B3'], '5: Redo');
  app.undo();
  // 6. changing the type (A + B in one Pocket; B in hand)
  pressEl(`#prepare-ops .ops-row[data-id="${storeOps()[0].id}"] .ops-pick`);
  eq([head(), pv().shapeInHand(), geo().remove, geo().own], ['Pocket 1 · 2 shapes: a change applies to all 2', null, 'Remove (off)', 'Make its own operation (off)'], '6: a row tap: active, no shape in hand: Remove / Make its own greyed ("click one of its shapes first")');
  eq(menu().filter(([, off]) => off).map(([id]) => id), ['contour', 'stock'], '6: the type menu: Contour greyed (no part), the Stock greyed (two shapes)');
  eq(steps(() => pick('exterior')), 1, '6: the type changed: one undo step');
  eq([ops(), recs()], [['exterior:A1,B3'], ['exterior:A:6', 'exterior:B:6']], '6: the operation is an Outside now, its shapes and settings kept');
  eq(head(), 'Outside 1 · 2 shapes: a change applies to all 2', '6: its header');
  app.undo();
  eq(ops(), ['pocket:A1,B3'], '6: Undo: a Pocket again');

  // 7. Roughing + Contour on C (multi-membership)
  clickAt('none'); clickAt('C');
  eq(steps(() => pick('roughing')), 1, '7: C: a Roughing (the quick flow)');
  const rough = storeOps().find((o) => o.type === 'roughing');
  eq(rough.settings.finishAllowance, 0, '7: a new Roughing\'s allowance starts at 0 (the Roughing default with no Contour)');
  app.esc(); clickAt('none'); clickAt('C');
  const nOf = (id) => storeOps().findIndex((o) => o.id === id) + 1; // its number in the list
  eq(chips(), [`${nOf(rough.id)} Roughing`], '7: the shape card of C: one chip (its list number and type)');
  eq(menu().filter(([, off]) => off).map(([id]) => id), [], '7: the Contour is offered (C is in a Roughing)');
  eq(steps(() => pick('contour')), 1, '7: Contour picked: one undo step');
  const contour = storeOps().find((o) => o.type === 'contour');
  eq([pv().activeOp().id, q('.cut-geo-part').textContent], [contour.id, `Depth and walls: from part (${nOf(rough.id)} Roughing)`], '7: the Contour operation is active; its card names its part');
  eq(storeOps().find((o) => o.type === 'roughing').settings.finishAllowance, 0, '7: adding the Contour leaves the Roughing\'s allowance alone');
  ok(planEntries().filter((e) => e.target.id === K.C.slice(5)).length === 2, '7: C has two entries (Roughing + Contour)');
  app.esc(); clickAt('none'); clickAt('C');
  const chipList = chips();
  eq(chipList.length, 2, '7: the shape card of C: two chips');
  ok(chipList.some((c) => /Roughing$/.test(c)) && chipList.some((c) => /Contour$/.test(c)), '7: … "n Roughing" and "n Contour"');
  pressEl(`.cut-chip[data-op="${rough.id}"]`);
  eq([pv().activeOp().id, pv().shapeInHand() === K.C, pv().isAdding()], [rough.id, true, false], '7: a chip opens its operation, C in hand, not in Add mode');
  clickAt('none'); clickAt('C');
  pick('roughing');
  eq(storeOps().filter((o) => o.type === 'roughing').length, 2, '7: the quick flow on C again makes ANOTHER Roughing (never joins)');
  app.undo();
  eq(storeOps().filter((o) => o.type === 'roughing').length, 1, '7: Undo');

  // 8. the bin
  const order8 = storeOps().map((o) => o.id);
  const roughRow = () => q(`#prepare-ops .ops-row[data-id="${rough.id}"] .ops-del`);
  eq(steps(() => app.press(roughRow())), 1, '8: the bin: one undo step');
  ok(!storeOps().some((o) => o.id === rough.id), '8: the Roughing operation is deleted');
  ok(storeOps().some((o) => o.type === 'contour' && o.geometry.some((r) => r.key === K.C)), '8: C stays in its Contour (which now has no part: nothing cut)');
  app.undo();
  eq(storeOps().map((o) => o.id), order8, '8: Undo puts it back in its place');

  // 9. an empty operation; an edited operation keeps its place
  pressEl(`#prepare-ops .ops-row[data-id="${storeOps().find((o) => o.type === 'pocket').id}"] .ops-pick`);
  pressEl('.cut-geo-add'); clickAt('A'); clickAt('B'); app.esc();
  const pocket = storeOps().find((o) => o.type === 'pocket');
  eq(pocket.geometry.length, 0, '9: A and B taken out: the Pocket is EMPTY');
  ok(rows().some((r) => /^Pocket · 6 mm \| no shapes yet: click shapes to add \*$/.test(r)), '9: listed "no shapes yet: click shapes to add"');
  eq(head(), 'Pocket 1 · no shapes yet'.replace('1', String(storeOps().indexOf(pocket) + 1)), '9: its card');
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  ok(saved.operations.some((o) => o.type === 'pocket' && o.geometry.length === 0), '9: saved with no shapes');
  applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
  ok(storeOps().some((o) => o.id === pocket.id && o.geometry.length === 0), '9: read back: still there, empty');
  app.prepare.mount();
  reorderOps(storeOps().map((o) => o.id).reverse());
  const place = storeOps().findIndex((o) => o.type === 'contour');
  pressEl(`#prepare-ops .ops-row[data-id="${storeOps()[place].id}"] .ops-pick`);
  pressEl('.cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]');
  eq(storeOps().findIndex((o) => o.type === 'contour'), place, '9: an edited operation keeps its place (the user\'s list order)');
  eq(storeOps()[place].settings.toolDia, 6.35, '9: (edited)');

  console.log(`opfirst-ui-s2-node: ${checks} checks passed`);
} finally {
  app.close();
}
