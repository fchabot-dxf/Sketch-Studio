// tests/selection-mirror-795c-node.test.js — TASK 795c: SA-15 §5.5 mirror rules (rows mirror summary.items, canonical region identity,
// empty ops kept, unassigned new regions, byte-identical export, Undo restore_selection / Redo clear_selection, and stock-card own undo step).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { FUSION_ACTIONS, mountFusionPrepareBar } from '../apps/shaper/src/fusion-bridge.js';
import { getSelections, setSelections } from '../apps/shaper/src/selection-list.js';
import { clearSelections, regionSig, payloadSig } from '../apps/shaper/src/selection-edit.js';
import { getStock, setStock } from '../apps/shaper/src/stock.js';
import { storeOps, setOpSettings, opById, memberOf, CONTOUR_TYPE } from '../apps/shaper/src/operations-store.js';
import { getCutRecord, planEntries } from '../apps/shaper/src/cut-plan.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { createStockCard } from '../apps/shaper/src/stock-card.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];

const mkPayload = ({
  id = 'reg_0',
  label = 'Outline',
  pocketId = 'reg_1',
  pocketLabel = 'Pocket 1 (8mm)',
  includePocket = true,
  extraNew = false,
  items = [
    { kind: 'face', count: 2, names: ['Tray'] },
    ...(includePocket ? [{ kind: 'sloped-face', count: 4, names: ['Tray'] }] : []),
  ],
  text = includePocket ? 'Tray · 2 faces, 4 sloped faces' : 'Tray · 2 faces',
} = {}) => ({
  action: 'selection_data',
  version: 1,
  selectionId: 'sel-sa15',
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'face', name: 'Tray', documentName: 'Tray v1' },
  stock: { thicknessMm: 12 },
  summary: { mode: 'Faces', items, text },
  regions: [
    {
      id,
      label,
      cutType: 'outside',
      depthMm: 12,
      through: true,
      outer: { closed: true, segments: rectSegs(0, 0, 60, 40) },
      holes: [],
    },
    ...(includePocket ? [{
      id: pocketId,
      label: pocketLabel,
      cutType: 'pocket',
      depthMm: 8,
      through: false,
      outer: { closed: true, segments: rectSegs(10, 10, 20, 15) },
      holes: [],
    }] : []),
    ...(extraNew ? [{
      id: 'reg_new',
      label: 'Face 3',
      cutType: 'outside',
      depthMm: null,
      through: false,
      outer: { closed: true, segments: rectSegs(35, 10, 15, 15) },
      holes: [],
    }] : []),
  ],
  chains: [],
  warnings: [],
});

const app = await open({ host: 'shaper' });
const st = app.state;
const sent = [];
const view = app.document.createElement('div');
const notice = app.document.createElement('div');
app.document.body.append(view);
view.append(notice);

const globalTarget = {
  adsk: { fusionSendData: (a, b) => { sent.push([a, JSON.parse(b)]); } },
  location: { search: '?host=fusion' },
};
const imp = (p, meta) => importFusionSelection(p, {
  controller: app.controller,
  prepare: app.prepare,
  file: true, // TASK 882: set-up only: the payload's own types filed as operations (a Fusion selection now makes none)
  clearGroup: meta && meta.clearGroup ? meta.clearGroup : null,
});

const bar = mountFusionPrepareBar({
  viewPrepareEl: view,
  noticeEl: notice,
  globalTarget,
  onSelectionData: (p, meta) => imp(p, meta),
  onRemoveSelection: (id, group) => {
    if (group) return bar.bridge.send(FUSION_ACTIONS.CLEAR_SELECTION, { selectionId: id, group });
    return undefined;
  },
  onClearSelections: () => clearSelections(app.controller, { prepare: app.prepare }),
});

try {
  // ── 0. FUSION_ACTIONS declares RESTORE_SELECTION ──
  eq(FUSION_ACTIONS.RESTORE_SELECTION, 'restore_selection', 'RESTORE_SELECTION declared');

  // ── 1. Rule 1: Two rows mirror summary.items in exact order from ONE selection ──
  setSelections([]);
  sent.length = 0;
  const pInit = mkPayload();
  bar.bridge.handle('selection_data', JSON.stringify(pInit));
  const rowEls = () => [...bar.listEl.querySelectorAll('.shaper-fusion-sel')];
  eq(rowEls().length, 2, 'two rows from one payload with 2 summary.items');
  eq(rowEls().map((el) => el.dataset.group), ['face', 'sloped-face'], 'rows preserve summary.items order and data-group');
  eq(rowEls().map((el) => el.querySelector('.shaper-fusion-sel-text').textContent), ['Tray · 2 faces', 'Tray · 4 sloped faces'], 'row labels match names + count + kind');
  ok(bar.listEl.querySelector('#btn-fusion-clear-selections'), 'Clear all visible with 2 summary.items rows from one selection');

  // Customize ops: put custom settings on pocket op, untick it, and keep initial export bytes.
  const pocketOpBefore = storeOps().find((o) => o.type === 'pocket');
  const outsideOpBefore = storeOps().find((o) => o.type === 'exterior');
  ok(pocketOpBefore && outsideOpBefore, 'initial import created outside and pocket ops');
  setOpSettings(outsideOpBefore, { ...outsideOpBefore.settings, toolDia: 6.35 });
  setOpSettings(pocketOpBefore, { ...pocketOpBefore.settings, toolDia: 3.175, cutDepth: 5 });
  const pocketOpId = pocketOpBefore.id;
  const outsideOpId = outsideOpBefore.id;

  // Byte-identical re-send: plan, operations, history, and exported SVG remain byte-identical.
  const exportSvg = () => exportShaperSVG(st, planEntries({ ticked: true }), { unit: 'mm', stock: getStock() });
  const svgBefore = exportSvg();
  const opsBefore = JSON.stringify(storeOps());
  const hLenBefore = st.history.length;
  bar.bridge.handle('selection_data', JSON.stringify(mkPayload()));
  eq(JSON.stringify(storeOps()), opsBefore, 'byte-identical payload leaves operations identical');
  eq(exportSvg(), svgBefore, 'byte-identical payload leaves exported SVG byte-identical');
  eq(st.history.length, hLenBefore, 'byte-identical payload adds no history step');

  // ── 2. Rule 1 + Rule 2: Row X sends clear_selection { selectionId, group } and waits for add-in ──
  sent.length = 0;
  const shapeCountBeforeX = st.shapes.length;
  rowEls()[1].querySelector('.shaper-fusion-sel-x').dispatchEvent(new app.window.Event('click', { bubbles: true }));
  eq(sent, [['clear_selection', { action: 'clear_selection', selectionId: 'sel-sa15', group: 'sloped-face' }]], 'Row X sends clear_selection with group');
  eq(rowEls().length, 2, 'Row X does NOT remove the row before add-in responds');
  eq(st.shapes.length, shapeCountBeforeX, 'Row X does NOT edit palette geometry itself');

  // Simulate add-in response: sloped-face removed (id/label shifted on Outline, Pocket gone, plus a new Face 3 region!).
  const pAfterX = mkPayload({
    id: 'reg_9',
    label: 'Outline renamed',
    includePocket: false,
    extraNew: true,
    items: [{ kind: 'face', count: 3, names: ['Tray'] }],
    text: 'Tray · 3 faces',
  });
  bar.bridge.handle('selection_data', JSON.stringify(pAfterX));

  eq(rowEls().length, 1, 'updated payload shrinks list to 1 row');
  eq(rowEls()[0].querySelector('.shaper-fusion-sel-text').textContent, 'Tray · 3 faces', 'row text updates');
  ok(!bar.listEl.querySelector('#btn-fusion-clear-selections'), 'Clear all hidden when 1 row remains');

  const outsideAfter = opById(outsideOpId);
  const pocketAfter = opById(pocketOpId);
  ok(outsideAfter && outsideAfter.geometry.length === 1, 'unchanged Outline (new id/label) keeps its exact operation');
  eq(outsideAfter.settings.toolDia, 6.35, 'kept region preserves Prepare settings');
  ok(pocketAfter, 'operation whose region disappeared is KEPT (never deleted)');
  eq(pocketAfter.geometry.length, 0, 'emptied operation has 0 regions (EMPTY)');
  eq(pocketAfter.settings.cutDepth, 5, 'emptied operation preserves its settings');

  const selEntry = getSelections()[0];
  const assignedKeys = new Set(storeOps().flatMap((o) => o.geometry.map((r) => r.key)));
  const unassignedKeys = selEntry.cutKeys.filter((k) => !assignedKeys.has(k));
  eq(unassignedKeys.length, 1, 'brand-new region arrives in NO operation');
  eq(getCutRecord(unassignedKeys[0]).cutType, null, 'brand-new region has default unassigned cutType');
  ok(memberOf(unassignedKeys[0]) === null, 'brand-new region has no op membership');

  // ── 3. Rule 3: Undo restores state AND sends restore_selection; Redo re-sends clear_selection ──
  sent.length = 0;
  st.undo();
  eq(sent, [['restore_selection', { action: 'restore_selection', selectionId: 'sel-sa15' }]], 'Undo after Row X sends restore_selection');
  eq(rowEls().length, 2, 'Undo restores both rows');
  eq(opById(pocketOpId).geometry.length, 1, 'Undo restores pocket operation geometry');
  const hAfterUndo = st.history.length;
  const rAfterUndo = st.redoStack.length;
  // Add-in re-sends byte-identical pre-clear payload: must NOT change ops or clear redo stack!
  bar.bridge.handle('selection_data', JSON.stringify(mkPayload()));
  eq(opById(pocketOpId).geometry.length, 1, 'byte-identical add-in re-send after Undo leaves pocket op intact');
  eq([st.history.length, st.redoStack.length], [hAfterUndo, rAfterUndo], 'byte-identical re-send preserves redoStack');

  sent.length = 0;
  st.redo();
  eq(sent, [['clear_selection', { action: 'clear_selection', selectionId: 'sel-sa15', group: 'sloped-face' }]], 'Redo re-sends same clear_selection { selectionId, group }');
  eq(opById(pocketOpId).geometry.length, 0, 'Redo restores cleared state');
  st.undo();
  // Consume any restore sent, reset for Clear all check.
  bar.bridge.handle('selection_data', JSON.stringify(mkPayload()));

  // Clear all + Undo (sends restore_selection) + Redo (sends clear_selection all).
  sent.length = 0;
  bar.listEl.querySelector('#btn-fusion-clear-selections').dispatchEvent(new app.window.Event('click', { bubbles: true }));
  eq(sent, [['clear_selection', { action: 'clear_selection', selectionId: 'all' }]], 'Clear all sends clear_selection all');
  eq(rowEls().length, 0, 'Clear all empties rows');
  sent.length = 0;
  st.undo();
  eq(sent, [['restore_selection', { action: 'restore_selection', selectionId: 'sel-sa15' }]], 'Undo after Clear all sends restore_selection');
  eq(rowEls().length, 2, 'Undo after Clear all restores rows');
  sent.length = 0;
  st.redo();
  eq(sent, [['clear_selection', { action: 'clear_selection', selectionId: 'all' }]], 'Redo after Clear all sends clear_selection all');
  st.undo();
  bar.bridge.handle('selection_data', JSON.stringify(mkPayload()));

  // ── 4. Item 4: Stock-card edit is its own undo step ──
  const stockWrap = app.document.createElement('div');
  const thickInput = app.document.createElement('input');
  thickInput.type = 'text';
  const thickNote = app.document.createElement('div');
  stockWrap.append(thickInput, thickNote);
  view.append(stockWrap);
  createStockCard({ input: thickInput, noteEl: thickNote, getController: () => app.controller });

  // Edit an operation AFTER import, then edit Stock thickness in Review.
  const outsideBeforeStock = opById(outsideOpId);
  st.saveState('before cut edit', { host: true });
  setOpSettings(outsideBeforeStock, { ...outsideBeforeStock.settings, toolDia: 9.525 });
  eq(getStock().thickness, 12, 'stock starts at 12 mm');

  const hBeforeStock = st.history.length;
  thickInput.value = '25';
  thickInput.dispatchEvent(new app.window.Event('change'));
  eq(getStock().thickness, 25, 'stock thickness updated to 25 mm');
  eq(st.history.length, hBeforeStock + 1, 'stock-card edit pushes its OWN undo step');

  st.undo();
  eq(getStock().thickness, 12, '1st Undo reverts ONLY the stock-card edit');
  eq(opById(outsideOpId).settings.toolDia, 9.525, '1st Undo does NOT revert the earlier cut-plan edit');
  st.redo();
  eq(getStock().thickness, 25, 'Redo puts the stock edit back');
  st.undo();
  setStock({ ...getStock(), thickness: 12 });

  // Empty selection_data for existing selectionId clears prior cleanly.
  sent.length = 0;
  bar.bridge.handle('selection_data', JSON.stringify({
    action: 'selection_data',
    version: 1,
    selectionId: 'sel-sa15',
    units: 'mm',
    coordSystem: { yAxis: 'up', frame: 'plane-2d' },
    source: { kind: 'unsupported', name: '' },
    stock: null,
    summary: { mode: 'Faces', items: [], text: '' },
    regions: [],
    chains: [],
    warnings: [],
  }));
  eq(getSelections().length, 0, 'empty same-id selection_data removes selection entry');
  eq(st.shapes.length, 0, 'empty same-id selection_data clears geometry');
  ok(opById(outsideOpId) && opById(outsideOpId).geometry.length === 0, 'empty selection_data keeps empty operations');
  eq(sent, [], 'empty selection_data from add-in does not echo clear_selection back');
  // TASK 795d: a selection entry keeps a FIXED-SIZE identity of each region and of the payload (the 795c rule, canonical JSON minus
  // id / label, compared as a digest), never the geometry itself: an STL relief's entry was 11.8 MB (sigs 5.9 MB + payloadSig 4.9 MB),
  // JSON-cloned by every getSelections() (the document buffer's poll, the undo snapshots) = main-thread long tasks during op-path generation.
  const ring = Array.from({ length: 4000 }, (_, k) => {
    const t0 = (2 * Math.PI * k) / 4000, t1 = (2 * Math.PI * (k + 1)) / 4000;
    return { type: 'line', x1: 50 + 40 * Math.cos(t0), y1: 50 + 40 * Math.sin(t0), x2: 50 + 40 * Math.cos(t1), y2: 50 + 40 * Math.sin(t1) };
  });
  const bigRegion = { id: 'reg_big', label: 'Disc', cutType: 'pocket', depthMm: 5, through: false, outer: { closed: true, segments: ring }, holes: [] };
  const bigPayload = { ...mkPayload(), selectionId: 'sel-795d-big', regions: [bigRegion] };
  imp(bigPayload);
  const bigEntry = getSelections().find((e) => e.id === 'sel-795d-big');
  const idBytes = Object.values(bigEntry.sigs).join('').length + bigEntry.payloadSig.length, payloadBytes = JSON.stringify(bigPayload).length;
  ok(idBytes < 200, `795d: the identities (sigs + payloadSig) of a ${payloadBytes}-byte payload take ${idBytes} characters in its entry (fixed size, not its geometry)`);
  eq(regionSig({ ...bigRegion, id: 'other', label: 'Renamed' }), regionSig(bigRegion), "795d: id / label are not part of a region's identity");
  ok(regionSig({ ...bigRegion, depthMm: 6 }) !== regionSig(bigRegion), '795d: any other difference is (a depth)');
  ok(regionSig({ ...bigRegion, outer: { closed: true, segments: ring.map((sg, k) => (k === 1234 ? { ...sg, x2: sg.x2 + 0.001 } : sg)) } }) !== regionSig(bigRegion), '795d: any other difference is (one coordinate)');
  eq(payloadSig({ ...bigPayload, action: 'x' }), payloadSig(bigPayload), '795d: the payload identity ignores action');
  ok(payloadSig({ ...bigPayload, warnings: ['w'] }) !== payloadSig(bigPayload), '795d: and sees any other difference');
  sent.length = 0;
  const shapesBefore = st.shapes.length;
  imp(bigPayload);
  eq(st.shapes.length, shapesBefore, '795d: the same payload again is still a no-op');
} finally {
  bar.destroy();
  await app.close();
}
console.log(`selection-mirror-795c-node: ${checks} checks passed`);
