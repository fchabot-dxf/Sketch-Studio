// tests/selection-list-795-node.test.js — TASK 795 (+ 794): the SELECTION LIST of the Shaper palette. A selection_data payload WITH a selectionId is ADDED to the design
// (apps/shaper/src/fusion-import.js importFusionSelection), listed (selection-list.js), removable one by one or all at once (selection-edit.js), updated in place when
// the same selectionId arrives again; a payload without one (Open STL, an old add-in) REPLACES the design as before. Stock thickness and operation order of a fresh start
// (794). Undo / Redo, save / reload, and the rows of the Prepare bar with the add-in's highlight_selection / clear_selection (a fake window.adsk.fusionSendData).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { CUT_PLAN } from '../apps/shaper/src/cut-plan.js';
import { importFusionSelection, mapFusionCutType } from '../apps/shaper/src/fusion-import.js';
import { mountFusionPrepareBar } from '../apps/shaper/src/fusion-bridge.js';
import { getSelections, setSelections } from '../apps/shaper/src/selection-list.js';
import { removeSelection, clearSelections } from '../apps/shaper/src/selection-edit.js';
import { getStock, setStock } from '../apps/shaper/src/stock.js';
import { opOrder, setOpOrder } from '../apps/shaper/src/operations.js';
import { captureShaperDoc, applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { DEFAULT_STOCK } from '#core/relief-model.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];
const msg = (name, regions, { kind = 'sketch', stock = null, selectionId, summary, chains = [] } = {}) => ({
  action: 'selection_data', version: 1, units: 'mm', coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind, name }, stock, regions, chains, warnings: [],
  ...(selectionId ? { selectionId } : {}), ...(summary ? { summary } : {}),
});
// A: a body, plate 30 x 10 with a d6 hole (2 regions), 12 mm thick. B: a sketch, a 20 x 20 square (no cut type), no stock. C: a 25 mm body.
const A = (extra = {}) => msg('Tray', [
  { id: 'o', label: 'Outline', cutType: 'outside', depthMm: 12, outer: { closed: true, segments: rectSegs(100, 0, 30, 10) }, holes: [{ closed: true, segments: [{ type: 'circle', cx: 115, cy: 5, r: 3 }] }] },
  { id: 'h', label: 'Hole', cutType: 'inside', depthMm: 12, outer: { closed: true, segments: [{ type: 'circle', cx: 115, cy: 5, r: 3 }] }, holes: [] },
], { kind: 'body', stock: { thicknessMm: 12 }, selectionId: 'sel-A', summary: { mode: 'Single Solid Body', items: [{ kind: 'body', count: 1, names: ['Tray'] }], text: 'Tray · body' }, ...extra });
const B = (extra = {}) => msg('Sketch2', [{ id: 'r1', cutType: null, depthMm: null, outer: { closed: true, segments: rectSegs(0, 0, 20, 20) }, holes: [] }],
  { selectionId: 'sel-B', summary: { mode: 'Entire Sketch', items: [{ kind: 'sketch', count: 1, names: ['Sketch2'] }], text: 'Sketch2 · 4 lines' }, ...extra });
const C = () => msg('Big', [{ id: 'r', cutType: 'outside', depthMm: 25, outer: { closed: true, segments: rectSegs(300, 0, 40, 40) }, holes: [] }],
  { kind: 'body', stock: { thicknessMm: 25 }, selectionId: 'sel-C', summary: { mode: 'Single Solid Body', items: [], text: 'Big · body' } });

const app = await open({ host: 'shaper' });
const st = app.state;
const imp = (p) => importFusionSelection(p, { controller: app.controller, prepare: app.prepare });
const ids = () => getSelections().map((e) => e.id);
const texts = () => getSelections().map((e) => e.text);
const plan = () => [...CUT_PLAN.keys()].sort();
const snap = () => ({ list: ids(), shapes: st.shapes.map((s) => s.id).sort(), plan: plan(), thickness: getStock().thickness, sketches: st.sketches.map((s) => s.name) });

try {
  // ── 1. Add two selections: a body, then a sketch; the list, the sketches, the records ──
  CUT_PLAN.clear(); setSelections([]);
  setOpOrder(['stale-order-key']); setStock({ ...getStock(), thickness: 7 });
  let h0 = st.history.length;
  const r1 = imp(A());
  ok(r1.ok && r1.imported === 5, 'A imported');
  eq(r1.message, 'Added Tray: 2 regions, 0 chains', 'an add says Added');
  eq(st.history.length, h0 + 1, 'an add is ONE undo step');
  eq(texts(), ['Tray · body'], 'the list: A, its summary text');
  eq(getStock().thickness, 12, '794: a fresh start takes the part\'s stock thickness');
  eq(opOrder(), [], '794: a fresh start takes the part\'s own operation order (the stale one is gone)');
  const afterA = snap();
  const recA = new Map([...CUT_PLAN.entries()].map(([k, r]) => [k, { ...r }]));
  eq(CUT_PLAN.size, 2, 'A: 2 records');

  // the user sets Prepare settings on A's first record
  const [aKey] = getSelections()[0].cutKeys;
  CUT_PLAN.get(aKey).toolDia = 6.35;
  setOpOrder(['user-order']);
  h0 = st.history.length;
  const r2 = imp(B());
  ok(r2.ok && r2.imported === 4, 'B imported');
  eq(st.history.length, h0 + 1, 'the second add is ONE undo step');
  eq(texts(), ['Tray · body', 'Sketch2 · 4 lines'], 'the list: A then B');
  eq(st.sketches.map((s) => s.name), ['Sketch 1', 'Tray', 'Sketch2'], 'each selection has its own sketch');
  eq(st.shapes.length, 9, 'A\'s shapes stay, B\'s are added');
  eq(CUT_PLAN.get(aKey).toolDia, 6.35, 'A\'s Prepare settings are kept');
  eq(opOrder(), ['user-order'], '794: adding to a design that has parts keeps the operation order');
  eq(getStock().thickness, 12, 'B has no stock: the thickness stays');
  const afterB = snap();
  const bKey = getSelections()[1].cutKeys[0];

  // a thicker third: the thickest wins
  const r3 = imp(C());
  ok(r3.ok, 'C imported');
  eq(getStock().thickness, 25, 'adding a thicker part: the stock takes the thickest of them');
  const afterC = snap();
  st.undo();
  eq(snap(), afterB, 'Undo of the third add: list, shapes, plan, sketches AND the stock thickness are back');
  st.redo();
  eq(snap(), afterC, 'Redo of it');
  st.undo();

  // ── 2. Remove A (the X): its regions gone, B's untouched; one undo step; Undo / Redo ──
  CUT_PLAN.get(bKey).cutType = 'pocket'; // B's setting
  h0 = st.history.length;
  const rm = removeSelection(app.controller, 'sel-A', { prepare: app.prepare });
  ok(rm.ok, 'removeSelection ok');
  eq(st.history.length, h0 + 1, 'the X is ONE undo step');
  eq(ids(), ['sel-B'], 'the list: only B');
  eq(st.shapes.length, 4, 'A\'s shapes are gone');
  ok(!CUT_PLAN.has(aKey) && CUT_PLAN.size === 1, 'A\'s cut records are gone');
  eq(CUT_PLAN.get(bKey).cutType, 'pocket', 'B\'s settings are intact');
  eq(st.sketches.map((s) => s.name), ['Sketch 1', 'Sketch2'], 'A\'s sketch is gone');
  eq([...st.joints.keys()].length, 5, 'A\'s points are gone (4 corners + the origin)');
  const afterRm = snap();
  st.undo();
  eq(ids(), ['sel-A', 'sel-B'], 'Undo of the X: the list has A back');
  eq(st.shapes.length, 9, 'Undo: A\'s shapes are back');
  eq(CUT_PLAN.get(aKey) && CUT_PLAN.get(aKey).toolDia, 6.35, 'Undo: A\'s record with the user\'s setting');
  st.redo();
  eq(snap(), afterRm, 'Redo of the X');
  st.undo();

  // ── 3. Clear all ──
  h0 = st.history.length;
  const cl = clearSelections(app.controller, { prepare: app.prepare });
  ok(cl.ok, 'clearSelections ok');
  eq(st.history.length, h0 + 1, 'Clear all is ONE undo step');
  eq([ids(), st.shapes.length, CUT_PLAN.size], [[], 0, 0], 'Clear all: no selection, no shape, no record');
  const cleared = snap();
  st.undo();
  eq(ids(), ['sel-A', 'sel-B'], 'Undo of Clear all gives both back');
  eq(st.shapes.length, 9, 'Undo of Clear all: the shapes');
  st.redo();
  eq(snap(), cleared, 'Redo of Clear all');

  // ── 4. A fresh start after Clear all (794): thickness = the part's, default when it has none; the order is the part's own ──
  setOpOrder(['left-over']);
  imp(B());
  eq(getStock().thickness, DEFAULT_STOCK.thickness, '794: no stock in the payload: the app\'s default thickness');
  eq(opOrder(), [], '794: after Clear all the order starts over');
  clearSelections(app.controller, { prepare: app.prepare });
  imp(A());
  eq(getStock().thickness, 12, '794: after Clear all the next part\'s thickness');

  // ── 5. The same selectionId again updates in place ──
  CUT_PLAN.get(getSelections()[0].cutKeys[0]).toolDia = 9;
  const before = snap();
  h0 = st.history.length;
  const upd = A({ stock: { thicknessMm: 12 } });
  upd.regions[0].depthMm = 15; // Fusion changed the outline's depth; the hole is the same
  const r4 = imp(upd);
  eq(r4.message, 'Updated Tray: 2 regions, 0 chains', 'the same id again says Updated');
  eq(st.history.length, h0 + 1, 'an update is ONE undo step');
  eq(ids(), ['sel-A'], 'still one row');
  eq(st.shapes.length, 5, 'the old regions are replaced, not piled up');
  const outline = [...CUT_PLAN.values()].find((r) => r.cutType === 'exterior');
  eq([outline.toolDia, outline.cutDepth], [9, 15], 'the same region keeps the user\'s settings; what Fusion changed (the depth) follows Fusion');
  st.undo();
  eq(snap().list, before.list, 'Undo of the update: the list');
  eq(snap().shapes, before.shapes, 'Undo of the update: the old shapes');
  st.redo(); st.undo();

  // ── 6. An old payload (no selectionId, no summary) REPLACES the design as before; its row is "<name> · N regions" ──
  imp(B());
  const old = msg('Body1', [{ id: 'o', cutType: 'outside', depthMm: 8, outer: { closed: true, segments: rectSegs(0, 0, 10, 10) }, holes: [] }, { id: 'p', cutType: 'pocket', depthMm: 4, outer: { closed: true, segments: rectSegs(20, 0, 10, 10) }, holes: [] }]);
  const r5 = imp(old);
  eq(r5.message, 'Replaced with Body1: 2 regions, 0 chains', 'an old payload replaces');
  eq(texts(), ['Body1 · 2 regions'], 'the fallback row text');
  ok(!getSelections()[0].fusion && getSelections()[0].id.startsWith('local-'), 'a local id; the add-in has no overlay for it');
  eq(st.shapes.length, 8, 'only the replacing selection\'s shapes');
  eq(getStock().thickness, DEFAULT_STOCK.thickness, '794: a replace with no stock: the default thickness');
  const stl = msg('part.stl', [{ id: 'o', cutType: 'outside', depthMm: 8, outer: { closed: true, segments: rectSegs(0, 0, 10, 10) }, holes: [] }], { kind: 'stl', stock: { thicknessMm: 8 } });
  imp(stl);
  eq(texts(), ['part.stl'], 'an STL\'s row is its file name');
  eq(getStock().thickness, 8, 'an STL: the thickness is the part\'s height');

  // ── 7. Save / reload keeps the list ──
  setSelections([]);
  imp(A()); imp(B());
  const saved = JSON.parse(JSON.stringify(captureShaperDoc()));
  ok(Array.isArray(saved.selections) && saved.selections.length === 2, 'the document carries the list');
  const keep = getSelections();
  setSelections([]);
  applyShaperDoc(saved, st);
  eq(getSelections(), keep, 'a reloaded document has the list again (ids, summary text, regions)');
  setSelections([]);
  ok(!('selections' in captureShaperDoc()), 'a design without selections writes no list (the same bytes as before)');

  // ── 8. The cut type mapping is unchanged by the list (TASK 792: there is no stepped type any more: an unknown type is left unset) ──
  eq([mapFusionCutType('stepped-pocket'), mapFusionCutType('pocket'), mapFusionCutType('outside')], [null, 'pocket', 'exterior'], 'cutType mapping');

  // ── 9. The rows of the Prepare bar: fake window.adsk.fusionSendData records what goes to Fusion ──
  setSelections([]); CUT_PLAN.clear();
  const sent = [];
  const view = app.document.createElement('div'); app.document.body.append(view);
  const notice = app.document.createElement('div'); view.append(notice);
  const globalTarget = { adsk: { fusionSendData: (a, b) => { sent.push([a, JSON.parse(b)]); } }, location: { search: '?host=fusion' } };
  const bar = mountFusionPrepareBar({
    viewPrepareEl: view, noticeEl: notice, globalTarget,
    onRemoveSelection: (id) => removeSelection(app.controller, id, { prepare: app.prepare }),
    onClearSelections: () => clearSelections(app.controller, { prepare: app.prepare }),
  });
  sent.length = 0;
  const rows = () => [...bar.listEl.querySelectorAll('.shaper-fusion-sel')];
  eq(rows().length, 0, 'no selection: no rows');
  ok(bar.listEl.hidden, 'the list is hidden while empty');
  imp(A()); imp(B());
  eq(rows().map((r) => r.querySelector('.shaper-fusion-sel-text').textContent), ['Tray · body', 'Sketch2 · 4 lines'], 'one row per selection, its words');
  ok(bar.listEl.querySelector('#btn-fusion-clear-selections'), 'Clear all shows from two selections');
  rows()[0].dispatchEvent(new app.window.Event('mouseenter'));
  rows()[0].dispatchEvent(new app.window.Event('mouseleave'));
  rows()[1].dispatchEvent(new app.window.Event('focusin'));
  rows()[1].dispatchEvent(new app.window.Event('focusout'));
  eq(sent, [['highlight_selection', { selectionId: 'sel-A', action: 'highlight_selection' }], ['highlight_selection', { selectionId: null, action: 'highlight_selection' }],
    ['highlight_selection', { selectionId: 'sel-B', action: 'highlight_selection' }], ['highlight_selection', { selectionId: null, action: 'highlight_selection' }]],
  'hover / focus a row: highlight_selection(id); leaving: highlight_selection(null)');
  sent.length = 0;
  rows()[0].querySelector('.shaper-fusion-sel-x').dispatchEvent(new app.window.Event('click', { bubbles: true }));
  eq(sent, [['clear_selection', { selectionId: 'sel-A', action: 'clear_selection' }]], 'the X sends clear_selection(id)');
  eq(rows().length, 1, 'the row is gone');
  ok(!bar.listEl.querySelector('#btn-fusion-clear-selections'), 'Clear all is hidden with one selection');
  sent.length = 0;
  st.undo();
  eq(sent, [], 'Undo of the X re-sends nothing to Fusion');
  eq(rows().length, 2, 'Undo: the row is back');
  bar.listEl.querySelector('#btn-fusion-clear-selections').dispatchEvent(new app.window.Event('click', { bubbles: true }));
  eq(sent, [['clear_selection', { selectionId: 'all', action: 'clear_selection' }]], 'Clear all sends clear_selection(all)');
  eq(rows().length, 0, 'no rows after Clear all');
  sent.length = 0;
  imp(msg('Body1', [{ id: 'o', cutType: 'outside', depthMm: 8, outer: { closed: true, segments: rectSegs(0, 0, 10, 10) }, holes: [] }]));
  eq(rows().length, 1, 'an old-add-in payload also shows its one row');
  rows()[0].querySelector('.shaper-fusion-sel-x').dispatchEvent(new app.window.Event('click', { bubbles: true }));
  eq(sent, [], 'a row the add-in never sent (no selectionId) sends nothing to Fusion when removed');
  bar.destroy();
} finally {
  await app.close();
}
console.log(`selection-list-795-node: ${checks} checks passed`);
