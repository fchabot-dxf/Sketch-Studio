// tests/opselect-806-node.test.js — TASK 806 / SA-16: per-operation Select in Fusion
// (request payload opKey/label/tokens/keepTokens, assign application, empty op kept EMPTY,
//  regionSig ignoring sources, Undo/Redo restore_selection sync, and hidden outside Fusion/STL/Stock).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { FUSION_ACTIONS, mountFusionPrepareBar } from '../apps/shaper/src/fusion-bridge.js';
import { regionSig } from '../apps/shaper/src/selection-edit.js';
import { getSelections, setSelections, formatSummaryItem } from '../apps/shaper/src/selection-list.js';
import { storeOps, opById, setOpSettings, regionOf, insertOp, setRegion } from '../apps/shaper/src/operations-store.js';
import { createPrepareStage } from '../apps/shaper/src/prepare-stage.js';
import { CUT_TYPES } from '../apps/shaper/src/shaper.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];

eq(FUSION_ACTIONS.SELECT_FOR_OPERATION, 'select_for_operation', 'declared select_for_operation action');
eq(formatSummaryItem({ kind: 'face', count: 6, names: ['CLAUDE_TEST_tray'], detail: '2 faces, 4 walls' }), 'CLAUDE_TEST_tray · 2 faces, 4 walls', 'formatSummaryItem prefers detail when present');
eq(formatSummaryItem({ kind: 'sloped-face', count: 4, names: ['Tray'] }), 'Tray · 4 sloped faces', 'formatSummaryItem falls back to count+kind when detail absent');

// regionSig ignores `sources` alongside `id` and `label`
const regA = { id: 'reg_0', label: 'Pocket 1 (8mm)', sources: ['tok-floor'], cutType: 'pocket', depthMm: 8, through: false, outer: { closed: true, segments: rectSegs(10, 10, 20, 15) }, holes: [] };
const regB = { ...regA, id: 'reg_1', label: 'Pocket A', sources: ['tok-floor', 'tok-wall-1'] };
eq(regionSig(regA), regionSig(regB), 'regionSig ignores sources');

const BASE_PAYLOAD = {
  action: 'selection_data',
  version: 1,
  selectionId: 'sel-806',
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'face', name: 'Tray', documentName: 'Tray v1' },
  stock: { thicknessMm: 12 },
  summary: {
    mode: 'Faces',
    items: [
      { kind: 'face', count: 2, names: ['Tray'] },
      { kind: 'sloped-face', count: 1, names: ['Tray'] },
    ],
    text: 'Tray · 2 faces, 1 wall',
  },
  regions: [
    {
      id: 'reg_0',
      label: 'Outline',
      sources: ['tok-top', 'tok-outer-wall'],
      cutType: 'outside',
      depthMm: 12,
      through: true,
      outer: { closed: true, segments: rectSegs(0, 0, 80, 50) },
      holes: [],
    },
    {
      id: 'reg_1',
      label: 'Pocket 1 (8mm)',
      sources: ['tok-p1', 'tok-shared'],
      cutType: 'pocket',
      depthMm: 8,
      through: false,
      outer: { closed: true, segments: rectSegs(10, 10, 20, 15) },
      holes: [],
    },
  ],
  chains: [
    {
      id: 'chain_0',
      label: 'Slot 1',
      sources: ['tok-slot', 'tok-shared'],
      cutType: 'online',
      depthMm: 3,
      closed: false,
      segments: [{ type: 'line', x1: 45, y1: 15, x2: 65, y2: 15 }],
    },
  ],
  warnings: [],
};

// 1. Fusion mode prepare stage + opList shows Select in Fusion on non-Stock non-STL ops; hidden in web mode & STL & Stock
const app = await open({ host: 'shaper' });
const st = app.state;
const sent = [];
const view = app.document.createElement('div');
const notice = app.document.createElement('div');
const panelEl = app.document.createElement('div');
const canvasEl = app.document.createElement('div');
const opsEl = app.document.createElement('div');
const ribbonEl = app.document.createElement('div');
app.document.body.append(view, panelEl, canvasEl, opsEl, ribbonEl);
view.append(notice);

const globalTarget = {
  adsk: { fusionSendData: (a, b) => { sent.push([a, JSON.parse(b)]); } },
  location: { search: '?host=fusion' },
};

let fusionUi = null;
const prepare = createPrepareStage({
  getController: () => app.controller,
  getMode: () => 'prepare',
  history: { refresh() {} },
  panelEl, canvasEl, noticeEl: notice, opsEl, ribbonEl,
  ensureSketch: () => {},
  onSelectInFusion: (op) => fusionUi && fusionUi.selectForOperation(op),
  showSelectInFusion: (op) => Boolean(fusionUi && fusionUi.canSelectForOperation(op)),
});
st.hostSnapshot = prepare.hostSnapshot;

fusionUi = mountFusionPrepareBar({
  viewPrepareEl: view,
  noticeEl: notice,
  globalTarget,
  onSelectionData: (payload, meta) => importFusionSelection(payload, {
    controller: app.controller,
    prepare,
    file: true, // TASK 882: set-up only: the payload's own types filed as operations (what the import did before; a Fusion selection now makes none)
    clearGroup: meta && meta.clearGroup ? meta.clearGroup : null,
  }),
});

try {
// Import base selection into Prepare
fusionUi.bridge.handle('selection_data', JSON.stringify(BASE_PAYLOAD));
prepare.enter();

const pocketOp = storeOps().find((o) => o.type === 'pocket');
const outlineOp = storeOps().find((o) => o.type === 'exterior');
const onlineOp = storeOps().find((o) => o.type === 'online');
ok(pocketOp && outlineOp && onlineOp, 'imported 3 operations (exterior, pocket, online)');

// Customize Pocket op depth so we can verify settings survive assign
setOpSettings(pocketOp, { ...pocketOp.settings, cutDepth: 5.5 });

// Verify sources stored per region
const pocketKey = pocketOp.geometry[0].key;
eq(regionOf(pocketKey).sources, ['tok-p1', 'tok-shared'], 'region stores sources');

// Trigger Select in Fusion for Pocket op -> sends select_for_operation with tokens & keepTokens
const selectRow = (id) => {
  const row = opsEl.querySelector(`.ops-row[data-id="${id}"]`);
  if (!row) return null;
  const pick = row.querySelector('.ops-pick');
  (pick || row).click();
  return opsEl.querySelector(`.ops-row[data-id="${id}"]`);
};

const pocketRow = selectRow(pocketOp.id);
const selBtn = pocketRow && pocketRow.querySelector('.ops-fusion-sel');
ok(selBtn, 'Select in Fusion button rendered on selected op row in Fusion mode');
selBtn.click();

const req = sent.find(([, b]) => b.action === 'select_for_operation');
ok(req, 'select_for_operation sent over fusion bridge');
eq(req[1].opKey, pocketOp.id, 'opKey matches pocket op id');
eq(req[1].tokens, ['tok-p1', 'tok-shared'], 'tokens matches pocket op sources');
ok(req[1].keepTokens.includes('tok-top') && req[1].keepTokens.includes('tok-slot'), 'keepTokens preserves other ops tokens');
ok(req[1].keepTokens.includes('tok-shared'), 'keepTokens preserves shared tokens still used by other ops');

// Check Stock row (if present) or Empty op: insert an empty op and verify Select in Fusion button appears on it too
const emptyOp = insertOp(0, { type: CUT_TYPES[0].id, settings: { cutDepth: 3 }, geometry: [] });
prepare.afterRestore();
const emptyRow = selectRow(emptyOp.id);
ok(emptyRow && emptyRow.querySelector('.ops-fusion-sel'), 'EMPTY op also exposes Select in Fusion in Fusion mode');

// Check Stock row does NOT show .ops-fusion-sel
const stockRow = opsEl.querySelector('.ops-row .ops-tick input:disabled')?.closest('.ops-row');
if (stockRow) {
  stockRow.querySelector('.ops-pick').click();
  ok(!opsEl.querySelector(`.ops-row[data-id="${stockRow.dataset.id}"] .ops-fusion-sel`), 'Stock row hides Select in Fusion');
}

// 2. Return selection_data with assign targeting pocketOp (replacing Pocket 1 with Pocket 2 + same Outline/Online)
sent.length = 0;
const WITH_POCKET_2 = {
  ...BASE_PAYLOAD,
  regions: [
    BASE_PAYLOAD.regions[0],
    {
      id: 'reg_p2',
      label: 'Pocket 2 (6mm)',
      sources: ['tok-p2'],
      cutType: 'pocket',
      depthMm: 6,
      through: false,
      outer: { closed: true, segments: rectSegs(12, 12, 18, 12) },
      holes: [],
    },
  ],
  assign: {
    opKey: pocketOp.id,
    tokens: ['tok-p2'],
  },
};
fusionUi.bridge.handle('selection_data', JSON.stringify(WITH_POCKET_2));

const updatedPocket = opById(pocketOp.id);
ok(updatedPocket, 'pocket op still exists after assign');
eq(updatedPocket.geometry.length, 1, 'pocket op got 1 new ref from assign');
eq(updatedPocket.settings.cutDepth, 5.5, 'pocket op kept custom settings');
eq(regionOf(updatedPocket.geometry[0].key).sources, ['tok-p2'], 'new region carries sources');
eq(opById(outlineOp.id).geometry.length, 1, 'outline op untouched');
eq(opById(onlineOp.id).geometry.length, 1, 'online op untouched');

// 3. Assigning empty tokens drops Pocket 2 from Fusion selection and leaves op EMPTY (never deleted)
const EMPTY_ASSIGN = {
  ...WITH_POCKET_2,
  regions: [BASE_PAYLOAD.regions[0]],
  assign: { opKey: pocketOp.id, tokens: [] },
};
fusionUi.bridge.handle('selection_data', JSON.stringify(EMPTY_ASSIGN));
const emptiedPocket = opById(pocketOp.id);
ok(emptiedPocket, 'emptied op remains in store');
eq(emptiedPocket.geometry.length, 0, 'emptied op has 0 geometry refs (EMPTY)');

// 4. Undo restores previous geometry AND sends restore_selection { selectionId }
sent.length = 0;
st.undo();
eq(opById(pocketOp.id).geometry.length, 1, 'Undo restored pocket ref');
const undoRestores = sent.filter(([, b]) => b.action === 'restore_selection');
ok(undoRestores.length >= 1, 'Undo sends restore_selection to Fusion');
eq(undoRestores[0][1].selectionId, 'sel-806', 'Undo restore_selection targets selectionId');

// Redo re-empties op AND sends restore_selection with tokens
sent.length = 0;
st.redo();
eq(opById(pocketOp.id).geometry.length, 0, 'Redo re-applied empty assign');
const redoRestores = sent.filter(([, b]) => b.action === 'restore_selection');
ok(redoRestores.length >= 1, 'Redo sends restore_selection to Fusion');

// 4b. STL selection entries hide Select in Fusion on their operations even in Fusion mode
const stlOp = insertOp(0, { type: 'roughing', settings: { cutDepth: 5 }, geometry: [{ key: 'loop:stl-mock', seq: 99 }] });
setSelections([...getSelections(), { id: 'stl-1', fusion: false, kind: 'stl', text: 'part.stl', cutKeys: ['loop:stl-mock'] }], { sync: false });
prepare.afterRestore();
const stlRow = selectRow(stlOp.id);
ok(stlRow, 'STL op row exists');
ok(!stlRow.querySelector('.ops-fusion-sel'), 'STL op hides Select in Fusion');

// 4c. TASK 864: Stock row hides Select in Fusion, yet keepTokens preserves Stock's source tokens when updating another op
setRegion('loop:stock-864', { sources: ['tok-stock'] });
const stockOp = insertOp(0, { type: 'stock', settings: { cutDepth: 12 }, geometry: [{ key: 'loop:stock-864', seq: 100 }] });
prepare.afterRestore();
const realStockRow = selectRow(stockOp.id);
ok(realStockRow, 'Stock op row exists');
ok(!realStockRow.querySelector('.ops-fusion-sel'), 'Stock op hides Select in Fusion');
sent.length = 0;
selectRow(onlineOp.id).querySelector('.ops-fusion-sel').click();
const reqWithStock = sent.find(([, b]) => b.action === 'select_for_operation');
ok(reqWithStock && reqWithStock[1].keepTokens.includes('tok-stock'), 'keepTokens preserves Stock source token');

// 5. Web mode (without onSelectInFusion) hides Select in Fusion
const opsElWeb = app.document.createElement('div');
app.document.body.append(opsElWeb);
const webPrepare = createPrepareStage({
  getController: () => app.controller,
  getMode: () => 'prepare',
  history: { refresh() {} },
  panelEl: app.document.createElement('div'),
  canvasEl: app.document.createElement('div'),
  noticeEl: app.document.createElement('div'),
  opsEl: opsElWeb,
  ribbonEl: app.document.createElement('div'),
  ensureSketch: () => {},
});
webPrepare.enter();
const firstWebRow = opsElWeb.querySelector(`.ops-row[data-id="${outlineOp.id}"]`);
ok(firstWebRow, 'web op row exists');
firstWebRow.querySelector('.ops-pick').click();
ok(!opsElWeb.querySelector('.ops-fusion-sel'), 'web mode never renders Select in Fusion');
} finally {
  fusionUi.destroy();
  await app.close();
}
console.log(`opselect-806-node: ${checks} checks passed`);
