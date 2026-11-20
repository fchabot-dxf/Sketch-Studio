// tests/opfirst-ui-s2-node.test.js — TASK S2 (docs/OPERATIONS-MODEL.md 4.2-4.4, section 6 S2; owner rulings turns 2710-2720): the OPERATION-FIRST Prepare on the Shaper node
// page (the page's own Prepare stage, cut card and Operations list: tests/helpers/node-app.js), driven by clicks on the canvas and presses on the card / list, a drawn design
// of three squares A, B, C and an open line L:
//  1. a click on a shape only SELECTS it: the card shows the quick flow's type menu ONLY (no rows, no header), every type offered (never greyed);
//  2. the QUICK FLOW: a type picked = a NEW operation holding the shape, created OPEN (header, Shapes, OK / Cancel); Cancel = nothing created, nothing in the undo stack;
//  3. an OPEN operation: a click on a shape puts it in / takes it out; an open line is refused with ONE plain line in the card's note area; empty canvas pans; Esc = Cancel;
//  4. edits PREVIEW live (the plan's entries) and OK makes the whole session ONE undo step (Undo: as before it; Redo: back);
//  5. a click on a shape in operations: the type menu only; the rows of its operations highlighted (Roughing + Contour: exactly those 2 rows);
//  6. the list: a row tap selects (its shapes); the SELECTED row alone shows Edit, Duplicate, X (in that order); a tap on another row moves them; a double-click opens;
//  7. Edit + changes + Cancel = the operation as it was, no undo entry; Duplicate + Cancel = no copy; Duplicate + OK = the copy right after (the user's order), one step;
//  8. in the open card: a shape row's X takes the shape out; a type change (refused with its line: the Stock and two shapes);
//  9. (owner ruling turn 2713) the CONTOUR is a plain operation: its own Depth and Wall side; editing a Roughing's depth does not move it; no allowance coupling;
// 10. the bin: of the open operation = Cancel + delete; of another operation while one is open = OK first; Undo while open = Cancel; leaving Prepare = OK;
// 11. an EMPTY operation is listed "no shapes yet: click shapes to add", saved (version 4) and read back; an edited operation keeps its place in the user's order;
// 12. (advisor turn 2722) a Fusion import while an operation is open: the open edit is confirmed first (its own undo step), the import is its own step.
import assert from 'node:assert/strict';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { findLoops } from '#core/loop-finder.js';
import { keyOf, planEntries } from '../apps/shaper/src/cut-plan.js';
import { storeOps, captureStore, reorderOps } from '../apps/shaper/src/operations-store.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';

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
  const nameOf = (key) => Object.keys(K).find((n) => K[n] === key);
  const shapes = () => (q('.cut-geo').hidden ? null : qa('.cut-geo-shape').map((r) => `${nameOf(r.dataset.key)}: ${r.querySelector('.cut-geo-name').textContent}`));
  const xOf = (n) => q(`.cut-geo-shape[data-key="${K[n]}"] .cut-geo-x`);
  const card = () => (q('.cut-card').hidden ? 'hidden' : !q('.cut-actions').hidden ? 'open' : q('.cut-rows').hidden && head() === null ? 'type menu' : 'other');
  const rowState = (name) => { const r = q(`.cut-row[data-row="${name}"], .cut-row[data-param="${name}"]`); return r.style.display === 'none' || 'offTab' in r.dataset ? 'none' : 'off' in r.dataset ? 'greyed' : 'live'; };
  const tab = (id) => { const b = q(`.cut-tab[data-tab="${id}"]`); if (!b.classList.contains('is-active')) app.press(b); };
  const note = () => qa('.cut-note div').map((d) => d.textContent);
  const items = () => app.prepare.opList.inspect().items.filter((i) => i.id);
  const rows = () => items().map((i) => `${i.text} | ${i.sub}${i.picked ? ' *' : ''}`);
  const rowBtn = (id, cls) => q(`#prepare-ops .ops-row[data-id="${id}"] .${cls}`);
  const ops = () => storeOps().map((o) => `${o.type}:${o.geometry.map((r) => nameOf(r.key) + r.seq).join(',')}`);
  const hist = () => st.history.length;
  const steps = (fn) => { const h = hist(); fn(); return hist() - h; };
  const recs = () => planEntries().map((e) => `${e.rec.cutType}:${nameOf(`${e.target.kind}:${e.target.id}`) || e.planKey}:${e.rec.cutDepth}`);
  const nOf = (id) => storeOps().findIndex((o) => o.id === id) + 1; // an operation's number in the list
  const openId = () => app.prepare.openId();

  // 1. a click only selects: the type menu only
  clickAt('A');
  eq([card(), q('.cut-type-cur').textContent], ['type menu', 'Select type'], '1: a click on A: the card is the quick flow\'s type menu only (no rows, no header)');
  eq(menu().filter(([, off]) => off).map(([id]) => id), [], '1: every type offered, the Contour too (never greyed)');

  // 2. the quick flow, and its Cancel
  const s0 = JSON.stringify(captureStore()), h0 = hist();
  pick('pocket');
  eq([ops(), openId(), card(), head(), shapes()], [['pocket:A1'], storeOps()[0].id, 'open', 'Pocket 1 · 1 shape', ['A: Shape 40 × 40 mm']], '2: a NEW Pocket holding A, created OPEN: its header, its Shapes, OK / Cancel');
  ok(q('#prepare-canvas').classList.contains('is-adding'), '2: the canvas shows the open operation (a click adds / takes out)');
  pressEl('.cut-cancel');
  eq([JSON.stringify(captureStore()), hist(), card()], [s0, h0, 'hidden'], '2: Cancel: nothing created, nothing in the undo stack, the card closes');

  // 3. an open operation: clicks add / take out; an open line refused with its line; Esc = Cancel
  clickAt('A'); pick('pocket');
  clickAt('B');
  eq([ops(), head()], [['pocket:A1,B2'], 'Pocket 1 · 2 shapes'], '3: a click on B puts it in (the next file place)');
  clickAt('B');
  eq(ops(), ['pocket:A1'], '3: a second click takes B out');
  clickAt('L');
  eq([ops(), note()[0]], [['pocket:A1'], 'This open line can’t be a Pocket: a pocket needs a closed shape'], '3: the open line is NOT added; the card\'s note area says why, in one line');
  clickAt('none');
  eq(openId(), storeOps()[0].id, '3: a press on empty canvas keeps it open (it pans)');
  app.esc();
  eq([JSON.stringify(captureStore()), hist(), card()], [s0, h0, 'hidden'], '3: Esc = Cancel');

  // 4. edits preview live; OK = ONE undo step
  clickAt('A'); pick('pocket'); clickAt('B');
  typed('.cut-depth', '6');
  eq(recs(), ['pocket:A:6', 'pocket:B:6'], '4: the edit previews live: both shapes cut at 6 mm');
  pressEl('.cut-ok');
  eq([hist() - h0, card(), openId()], [1, 'hidden', null], '4: OK: the whole session (create, add B, the depth) is ONE undo step; the card closes');
  const pocketId = storeOps()[0].id;
  app.undo();
  eq(JSON.stringify(captureStore()), s0, '4: Undo: as before the session');
  app.redo();
  eq([ops(), recs()], [['pocket:A1,B2'], ['pocket:A:6', 'pocket:B:6']], '4: Redo: the session again');

  // 5. a click on a shape in an operation: the type menu only, its row highlighted
  clickAt('A');
  eq([card(), rows()], ['type menu', ['Pocket · 6 mm | 2 regions *']], '5: a click on A (in the Pocket): the type menu only; the Pocket\'s row highlighted');
  eq(items()[0].actions, [], '5: (a shape click selects no row: no row actions)');

  // 6. the list: a row tap selects; the selected row alone shows Edit, Duplicate, X; a double-click opens
  clickAt('none'); clickAt('C'); pick('exterior'); pressEl('.cut-ok');
  const outId = storeOps().find((o) => o.type === 'exterior').id;
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  eq([pv().selectedTargets().length, openId(), card()], [2, null, 'type menu'], '6: a row tap selects its 2 shapes; nothing opens');
  eq(items().map((i) => [i.id, i.actions]), [[pocketId, ['ops-edit', 'ops-dup', 'ops-del']], [outId, []]].sort((a, b) => nOf(a[0]) - nOf(b[0])), '6: the selected row alone shows Edit, Duplicate, X (in that order)');
  pressEl(`#prepare-ops .ops-row[data-id="${outId}"] .ops-pick`);
  eq(items().map((i) => [i.id, i.actions.length]), [[pocketId, 0], [outId, 3]].sort((a, b) => nOf(a[0]) - nOf(b[0])), '6: a tap on another row moves them');
  const dbl = q(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  dbl.dispatchEvent(new app.window.MouseEvent('dblclick', { bubbles: true }));
  eq(openId(), pocketId, '6: a double-click on a row opens it');
  pressEl('.cut-cancel');

  // 7. Edit + Cancel; Duplicate + Cancel; Duplicate + OK
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  const s7 = JSON.stringify(captureStore()), h7 = hist();
  app.press(rowBtn(pocketId, 'ops-edit'));
  eq([openId(), head()], [pocketId, `Pocket ${nOf(pocketId)} · 2 shapes`], '7: Edit opens the operation');
  typed('.cut-depth', '9'); app.press(xOf('B'));
  eq(recs().filter((r) => r.startsWith('pocket')), ['pocket:A:9'], '7: (the changes preview)');
  pressEl('.cut-cancel');
  eq([JSON.stringify(captureStore()), hist()], [s7, h7], '7: Cancel: the operation exactly as it was when opened, nothing in the undo stack');
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  app.press(rowBtn(pocketId, 'ops-dup'));
  ok(openId() && openId() !== pocketId && storeOps().length === 3, '7: Duplicate: the copy is created OPEN');
  pressEl('.cut-cancel');
  eq([JSON.stringify(captureStore()), hist()], [s7, h7], '7: Duplicate + Cancel: no copy, nothing in the undo stack');
  reorderOps(storeOps().map((o) => o.id)); // the user's list order ('stored'): a copy goes right after its original
  const s7b = JSON.stringify(captureStore()), h7b = hist();
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`);
  app.press(rowBtn(pocketId, 'ops-dup'));
  const copyId = openId();
  typed('.cut-depth', '3');
  pressEl('.cut-ok');
  eq([storeOps()[storeOps().findIndex((o) => o.id === pocketId) + 1].id, hist() - h7b], [copyId, 1], '7: Duplicate + OK: the copy right after its original, ONE undo step');
  eq(recs().filter((r) => r.startsWith('pocket')), ['pocket:A:6', 'pocket:B:6', 'pocket:A:3', 'pocket:B:3'], '7: the copy changed separately: two identical paths per shape, each its own depth');
  app.undo();
  eq(JSON.stringify(captureStore()), s7b, '7: Undo: the copy gone');

  // 8. in the open card: a shape row's X; a type change and its refusal line
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`); app.press(rowBtn(pocketId, 'ops-edit'));
  pick('stock');
  eq([storeOps().find((o) => o.id === pocketId).type, note()[0]], ['pocket', 'The Stock is one shape, not 2'], '8: the Stock and two shapes: not changed, the line says why');
  pick('exterior');
  eq([storeOps().find((o) => o.id === pocketId).type, head()], ['exterior', `Outside ${nOf(pocketId)} · 2 shapes`], '8: Outside: changed (previewed)');
  app.press(xOf('B'));
  eq([shapes(), ops().find((o) => o.startsWith('exterior:A'))], [['A: Shape 40 × 40 mm'], 'exterior:A1'], '8: the X of B takes it out');
  pressEl('.cut-cancel');
  eq(JSON.stringify(captureStore()), s7b, '8: (Cancel: as it was)');

  // 9. the Contour, a plain operation (owner ruling turn 2713); C: Roughing + Contour; exactly those 2 rows highlighted
  pressEl(`#prepare-ops .ops-row[data-id="${outId}"] .ops-pick`); app.press(rowBtn(outId, 'ops-del')); // C free again
  clickAt('none'); clickAt('C'); pick('roughing');
  eq(storeOps().find((o) => o.type === 'roughing').settings.finishAllowance, 0, '9: a new Roughing\'s allowance starts at 0 (the Roughing default with no Contour)');
  tab('heights'); typed('.cut-depth', '8'); pressEl('.cut-ok');
  const roughId = storeOps().find((o) => o.type === 'roughing').id;
  clickAt('C'); pick('contour');
  const contourId = openId();
  tab('heights');
  eq(rowState('cutDepth'), 'live', '9: the Contour has its own Depth row');
  typed('.cut-depth', '5');
  tab('geometry');
  eq(rowState('wallSide'), 'live', '9: and its own Wall side (C is a drawn shape: its model does not say the side)');
  pressEl('.cut-row[data-row="wallSide"] .cut-preset[data-value="outside"]');
  pressEl('.cut-ok');
  eq([storeOps().find((o) => o.id === contourId).settings.wallSide, storeOps().find((o) => o.id === roughId).settings.finishAllowance], ['outside', 0], '9: Wall side stored on the Contour; the Roughing\'s allowance untouched');
  const cOf = () => planEntries().filter((e) => e.target.id === K.C.slice(5)).map((e) => [e.rec.cutType, e.rec.cutType === 'contour' ? e.rec.baseDepth : e.rec.cutDepth]);
  pressEl(`#prepare-ops .ops-row[data-id="${roughId}"] .ops-pick`); app.press(rowBtn(roughId, 'ops-edit'));
  tab('heights'); typed('.cut-depth', '12'); pressEl('.cut-ok');
  eq(cOf(), [['roughing', 12], ['contour', 5]], '9: editing the Roughing\'s depth does not move the Contour');
  clickAt('C');
  eq(items().filter((i) => i.picked).map((i) => i.id).sort(), [roughId, contourId].sort(), '9: a click on C (in Roughing + Contour): exactly those 2 rows highlighted');
  eq(card(), 'type menu', '9: and the card is the type menu only');
  pick('roughing');
  eq(storeOps().filter((o) => o.type === 'roughing').length, 2, '9: the quick flow on C again makes ANOTHER Roughing (never joins)');
  pressEl('.cut-cancel');

  // 10. the bin while open; Undo while open; leaving Prepare
  const s10 = JSON.stringify(captureStore()), h10 = hist();
  pressEl(`#prepare-ops .ops-row[data-id="${roughId}"] .ops-pick`); app.press(rowBtn(roughId, 'ops-edit'));
  tab('heights'); typed('.cut-depth', '2');
  app.press(rowBtn(roughId, 'ops-del'));
  eq([openId(), storeOps().some((o) => o.id === roughId), hist() - h10], [null, false, 1], '10: the bin of the open operation: Cancel, then the delete (one undo step)');
  eq(cOf(), [['contour', 5]], '10: C stays in its Contour, which still cuts at its own depth');
  app.undo();
  eq(JSON.stringify(captureStore()), s10, '10: Undo: the Roughing back, as it was before it was opened');
  pressEl(`#prepare-ops .ops-row[data-id="${roughId}"] .ops-pick`); app.press(rowBtn(roughId, 'ops-edit'));
  tab('heights'); typed('.cut-depth', '2');
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`); // a tap on another row: OK first
  eq([openId(), storeOps().find((o) => o.id === roughId).settings.cutDepth, hist() - h10], [null, 2, 1], '10: a tap on another row = OK on the open one (one undo step)');
  app.undo();
  pressEl(`#prepare-ops .ops-row[data-id="${roughId}"] .ops-pick`); app.press(rowBtn(roughId, 'ops-edit'));
  tab('heights'); typed('.cut-depth', '2');
  app.undo();
  eq([openId(), JSON.stringify(captureStore())], [null, s10], '10: Undo while open = Cancel');
  pressEl(`#prepare-ops .ops-row[data-id="${roughId}"] .ops-pick`); app.press(rowBtn(roughId, 'ops-edit'));
  tab('heights'); typed('.cut-depth', '2');
  app.modes.showMode('design');
  eq([openId(), storeOps().find((o) => o.id === roughId).settings.cutDepth, hist() - h10], [null, 2, 1], '10: leaving Prepare = OK');
  app.undo(); app.modes.showMode('prepare');

  // 11. an empty operation; an edited operation keeps its place
  pressEl(`#prepare-ops .ops-row[data-id="${pocketId}"] .ops-pick`); app.press(rowBtn(pocketId, 'ops-edit'));
  app.press(xOf('A')); app.press(xOf('B')); pressEl('.cut-ok');
  eq(storeOps().find((o) => o.id === pocketId).geometry.length, 0, '11: A and B taken out: the Pocket is EMPTY');
  ok(rows().some((r) => /^Pocket · 6 mm \| no shapes yet: click shapes to add$/.test(r)), '11: listed "no shapes yet: click shapes to add"');
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  ok(saved.version === 4 && saved.operations.some((o) => o.id === pocketId && o.geometry.length === 0), '11: saved (version 4) with no shapes');
  eq(saved.operations.find((o) => o.type === 'contour').settings.cutDepth, 5, '11: the Contour\'s own depth is saved');
  applyShaperDoc(JSON.parse(JSON.stringify(saved)), st);
  eq(JSON.parse(JSON.stringify(captureShaperDoc())), saved, '11: saved -> read -> saved: the same document (the empty operation kept)');
  app.prepare.mount();
  reorderOps(storeOps().map((o) => o.id).reverse());
  const place = storeOps().findIndex((o) => o.id === contourId);
  pressEl(`#prepare-ops .ops-row[data-id="${contourId}"] .ops-pick`); app.press(rowBtn(contourId, 'ops-edit'));
  tab('tool'); pressEl('.cut-row[data-param="toolDia"] .cut-preset[data-value="6.35"]'); pressEl('.cut-ok');
  eq([storeOps().findIndex((o) => o.id === contourId), storeOps()[place].settings.toolDia], [place, 6.35], '11: an edited operation keeps its place (the user\'s list order)');

  // 12. a Fusion import while an operation is open
  const h12 = hist(), n12 = storeOps().length;
  pressEl(`#prepare-ops .ops-row[data-id="${contourId}"] .ops-pick`); app.press(rowBtn(contourId, 'ops-edit'));
  tab('heights'); typed('.cut-depth', '7');
  const line = (x1, y1, x2, y2) => ({ type: 'line', x1, y1, x2, y2 });
  const sq = (x0, y0, x1, y1) => ({ closed: true, segments: [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)] });
  const res = importFusionSelection({ action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' }, source: { name: 'Body1' }, selectionId: 'sel-s2',
    regions: [{ id: 'r0', label: 'Plate', cutType: 'pocket', depthMm: 3, through: false, outer: sq(200, 0, 240, 40), holes: [] }], chains: [], warnings: [] }, { controller: app.controller, prepare: app.prepare });
  ok(res.ok, '12: the import went in');
  eq([openId(), hist() - h12, storeOps().find((o) => o.id === contourId).settings.cutDepth, storeOps().length > n12], [null, 2, 7, true], '12: the open edit confirmed first (one step), then the import (its own step)');
  app.undo();
  eq([storeOps().length, storeOps().find((o) => o.id === contourId).settings.cutDepth], [n12, 7], '12: Undo: the import gone, the confirmed edit kept');
  app.undo();
  eq(storeOps().find((o) => o.id === contourId).settings.cutDepth, 5, '12: Undo again: the edit gone');

  console.log(`opfirst-ui-s2-node: ${checks} checks passed`);
} finally {
  app.close();
}
