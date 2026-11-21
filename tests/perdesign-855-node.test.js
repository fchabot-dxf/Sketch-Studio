// tests/perdesign-855-node.test.js — TASK 855 / SA-19: per-design Fusion workspace stored in Fusion Design attribute
// (no browser IndexedDB workspace writes, design_context swap, 2s debounced save_project, 795c regionSig remap
// on reopen keeping settings/tabs/order and emptying missing regions, realistic 10-op size, older add-in compat, web unchanged).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

import { importFusionSelection } from '../apps/shaper/src/fusion-import.js';
import { FUSION_ACTIONS, mountFusionPrepareBar, PROJECT_SAVE_DEBOUNCE_MS, captureFusionProject, applyFusionProject } from '../apps/shaper/src/fusion-bridge.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { storeOps, opById, regionOf, setOpSettings, setRefTabsAt, setOpsOn } from '../apps/shaper/src/operations-store.js';
import { createPrepareStage } from '../apps/shaper/src/prepare-stage.js';
import { getStock, setStock } from '../apps/shaper/src/stock.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const rectSegs = (x, y, w, h) => [
  { type: 'line', x1: x, y1: y, x2: x + w, y2: y },
  { type: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h },
  { type: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h },
  { type: 'line', x1: x, y1: y + h, x2: x, y2: y },
];

eq(FUSION_ACTIONS.DESIGN_CONTEXT, 'design_context', 'DESIGN_CONTEXT action declared');
eq(FUSION_ACTIONS.REQUEST_SELECTION, 'request_selection', 'REQUEST_SELECTION action declared');
eq(FUSION_ACTIONS.SAVE_PROJECT, 'save_project', 'SAVE_PROJECT action declared');
eq(FUSION_ACTIONS.PROJECT_SAVED, 'project_saved', 'PROJECT_SAVED action declared');
eq(PROJECT_SAVE_DEBOUNCE_MS, 2000, 'debounced save window is 2000 ms');

const DOC_A_SEL = {
  action: 'selection_data',
  version: 1,
  selectionId: 'sel-docA',
  units: 'mm',
  coordSystem: { yAxis: 'up', frame: 'plane-2d' },
  source: { kind: 'face', name: 'TrayA', documentName: 'TrayA v1' },
  stock: { thicknessMm: 12 },
  summary: { mode: 'Faces', items: [{ kind: 'face', count: 2, names: ['TrayA'] }], text: 'TrayA · 2 faces' },
  regions: [
    { id: 'reg_0', label: 'Outline', sources: ['tok-top'], cutType: 'outside', depthMm: 12, through: true, outer: { closed: true, segments: rectSegs(0, 0, 80, 50) }, holes: [] },
    { id: 'reg_1', label: 'Pocket 1 (8mm)', sources: ['tok-p1'], cutType: 'pocket', depthMm: 8, through: false, outer: { closed: true, segments: rectSegs(10, 10, 20, 15) }, holes: [] },
    { id: 'reg_2', label: 'Pocket 2 (4mm)', sources: ['tok-p2'], cutType: 'pocket', depthMm: 4, through: false, outer: { closed: true, segments: rectSegs(45, 10, 20, 15) }, holes: [] },
  ],
  chains: [],
  warnings: [],
};

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
});
st.hostSnapshot = prepare.hostSnapshot;

fusionUi = mountFusionPrepareBar({
  viewPrepareEl: view,
  noticeEl: notice,
  globalTarget,
  saveDebounceMs: 25,
  getController: () => app.controller,
  prepare,
  onSelectionData: (payload, meta) => importFusionSelection(payload, {
    controller: app.controller,
    prepare,
    clearGroup: meta && meta.clearGroup ? meta.clearGroup : null,
  }),
});

try {
  // 1. pong with projectBridge:true + initial empty design_context -> requests selection? No, hasSelection:false
  fusionUi.bridge.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0', documentName: 'DocA v1', lengthUnits: 'mm', projectBridge: true }));
  fusionUi.bridge.handle('design_context', JSON.stringify({
    action: 'design_context', docToken: 'tok-A', designKey: null, docName: 'DocA v1', hasSelection: false, project: null,
  }));
  eq(storeOps().length, 0, 'DocA starts empty');

  // Import selection on DocA, customize ops (depth, tabsAt, untick) and trigger change
  fusionUi.bridge.handle('selection_data', JSON.stringify(DOC_A_SEL));
  prepare.enter();
  const pocketOps = storeOps().filter((o) => o.type === 'pocket');
  eq(pocketOps.length, 2, 'imported 2 pocket ops');
  const p1 = pocketOps.find((o) => (regionOf(o.geometry[0].key)?.sources || []).includes('tok-p1'));
  const p2 = pocketOps.find((o) => (regionOf(o.geometry[0].key)?.sources || []).includes('tok-p2'));
  ok(p1 && p2, 'found Pocket 1 (tok-p1) and Pocket 2 (tok-p2)');
  setOpSettings(p1, { ...p1.settings, cutDepth: 6.2 });
  setRefTabsAt(p1.geometry[0], [0.25, 0.75]);
  setOpsOn([p2.id], false);
  setStock({ ...getStock(), thickness: 18 });
  fusionUi.notifyProjectChanged();

  // Wait for debounced save_project
  await new Promise((r) => setTimeout(r, 80));
  const saves1 = sent.filter(([a]) => a === 'save_project');
  eq(saves1.length, 1, 'debounced save_project emitted once after change');
  const savedMsg = saves1[0][1];
  eq(savedMsg.docToken, 'tok-A', 'save_project bound to docToken');
  ok(savedMsg.project && savedMsg.project.version === 1, 'versioned project payload');
  ok(!('slope' in (savedMsg.project.regions[p1.geometry[0].key] || {})), 'heavy slope/levels not stored in project attribute');
  ok(!(savedMsg.project.selections[0].payloadSig), 'heavy payloadSig omitted from stored selections');

  // Re-notify with NO further change -> no extra save_project sent
  sent.length = 0;
  fusionUi.notifyProjectChanged();
  await new Promise((r) => setTimeout(r, 80));
  eq(sent.filter(([a]) => a === 'save_project').length, 0, 'no save_project sent when nothing changed');

  // 2. Switch to empty DocB -> workspace completely wiped, undo history empty, no carryover!
  sent.length = 0;
  fusionUi.bridge.handle('design_context', JSON.stringify({
    action: 'design_context', docToken: 'tok-B', designKey: null, docName: 'DocB v1', hasSelection: false, project: null,
  }));
  eq(storeOps().length, 0, 'switching to empty DocB wipes operations');
  eq(getSelections().length, 0, 'switching to empty DocB wipes selection list');
  eq(st.shapes.length, 0, 'switching to empty DocB wipes sketch shapes');
  eq(st.history.length, 0, 'undo history cleared on switch');

  // 3. Switch back to DocA (reopen with saved project, AND Fusion model dropped Pocket 2 meanwhile)
  sent.length = 0;
  fusionUi.bridge.handle('design_context', JSON.stringify({
    action: 'design_context', docToken: 'tok-A2', designKey: 'key-A', docName: 'DocA v1', hasSelection: true, project: savedMsg.project,
  }));
  const reqs = sent.filter(([a]) => a === 'request_selection');
  eq(reqs.length, 1, 'switching to DocA with hasSelection requests selection_data');
  eq(reqs[0][1].docToken, 'tok-A2', 'request_selection passes docToken');

  // Add-in returns freshly extracted selection WITHOUT Pocket 2 (only Outline + Pocket 1, with fresh ids)
  fusionUi.bridge.handle('selection_data', JSON.stringify({
    ...DOC_A_SEL,
    regions: [
      { ...DOC_A_SEL.regions[0], id: 'reg_new_0', label: 'Outline renamed' },
      { ...DOC_A_SEL.regions[1], id: 'reg_new_1', label: 'Pocket 1 renamed' },
    ],
  }));

  // Initial selection_data after design_context must NOT emit a spurious save_project on open
  await new Promise((r) => setTimeout(r, 80));
  eq(sent.filter(([a]) => a === 'save_project').length, 0, 'opening a design with hasSelection does not emit save_project without user edit');

  const restoredP1 = opById(p1.id);
  const restoredP2 = opById(p2.id);
  ok(restoredP1 && restoredP1.geometry.length === 1, 'Pocket 1 mapped onto fresh region via regionSig');
  eq(restoredP1.settings.cutDepth, 6.2, 'Pocket 1 restored custom cutDepth');
  eq(restoredP1.geometry[0].tabsAt, [0.25, 0.75], 'Pocket 1 restored tabsAt');
  ok(restoredP2 && restoredP2.geometry.length === 0 && restoredP2.on === false, 'missing Pocket 2 kept as EMPTY op with tick state');
  eq(getStock().thickness, 18, 'restored stock thickness');

  // 4. project_saved updates currentDesignKey (e.g. Save-As duplicate design minted a new key) and pending save flushes on doc switch
  fusionUi.bridge.handle('project_saved', JSON.stringify({
    action: 'project_saved', docToken: 'tok-other', designKey: 'wrong-key',
  }));
  fusionUi.bridge.handle('project_saved', JSON.stringify({
    action: 'project_saved', docToken: 'tok-A2', designKey: 'key-A-minted',
  }));
  setOpSettings(restoredP1, { ...restoredP1.settings, cutDepth: 7.5 });
  sent.length = 0;
  fusionUi.notifyProjectChanged();
  // Switch to DocB BEFORE the debounce timer fires -> flushes DocA's pending save with tok-A2 & key-A-minted!
  fusionUi.bridge.handle('design_context', JSON.stringify({
    action: 'design_context', docToken: 'tok-B2', designKey: null, docName: 'DocB v1', hasSelection: false, project: null,
  }));
  const flushedSaves = sent.filter(([a]) => a === 'save_project');
  eq(flushedSaves.length, 1, 'switching design flushes pending debounced save for outgoing docToken');
  eq(flushedSaves[0][1].docToken, 'tok-A2', 'flushed save bound to outgoing docToken');
  eq(flushedSaves[0][1].designKey, 'key-A-minted', 'flushed save uses designKey confirmed by project_saved');

  // 5. Realistic 10-op size check
  const tenRegions = Array.from({ length: 10 }, (_, i) => ({
    id: `reg_${i}`,
    label: `Pocket ${i + 1}`,
    sources: [`tok-face-${i}`, `tok-wall-${i}-a`, `tok-wall-${i}-b`],
    cutType: i === 0 ? 'outside' : 'pocket',
    depthMm: i === 0 ? 18 : 3 + i,
    through: i === 0,
    outer: { closed: true, segments: rectSegs(i * 30, 0, 24, 18) },
    holes: [],
  }));
  fusionUi.bridge.handle('selection_data', JSON.stringify({
    ...DOC_A_SEL,
    selectionId: 'sel-10op',
    regions: tenRegions,
  }));
  for (const op of storeOps()) {
    if (op.geometry[0]) setRefTabsAt(op.geometry[0], [0.15, 0.45, 0.75]);
  }
  const tenOpProject = captureFusionProject({ reviewLook: { preset: 'walnut' }, reviewViewMode: '3d' });
  const tenOpBytes = Buffer.byteLength(JSON.stringify(tenOpProject), 'utf8');
  ok(tenOpBytes > 1000 && tenOpBytes < 32 * 1024, `10-op project JSON is compact (${tenOpBytes} bytes)`);

  // 5b. TASK 855b (advisor's Fusion check): a NEW design gets an empty workspace, and a selection extracted from ANOTHER
  // design (its docToken is not the current design_context's: Fusion executed A's still-open Add to Shaper dialog after B
  // was activated) is neither imported into it nor saved into it. The design's own selection (its docToken) is applied.
  fusionUi.bridge.handle('design_context', JSON.stringify({
    action: 'design_context', docToken: 'tok-new', designKey: null, docName: 'Untitled', hasSelection: false, project: null,
  }));
  eq(storeOps().length, 0, '855b: a new design starts with an empty workspace');
  const noticeBefore = notice.textContent;
  sent.length = 0;
  fusionUi.bridge.handle('selection_data', JSON.stringify({ ...DOC_A_SEL, docToken: 'tok-A2' }));
  eq(storeOps().length, 0, "855b: design A's late selection is not imported into the new design");
  eq(getSelections().length, 0, "855b: no chip of design A in the new design");
  eq(notice.textContent, noticeBefore, '855b: no "Added ..." notice for a selection of another design');
  await new Promise((r) => setTimeout(r, 80));
  eq(sent.filter(([a]) => a === 'save_project').length, 0, '855b: nothing is saved into the new design');
  fusionUi.bridge.handle('selection_data', JSON.stringify({ ...DOC_A_SEL, selectionId: 'sel-new', docToken: 'tok-new' }));
  ok(storeOps().length > 0 && getSelections().length === 1, "855b: the new design's own selection (its docToken) is applied");

  // 6. Older add-in compatibility: pong without projectBridge calls onLegacyAddin and does not activate projectBridge
  let legacyCalled = 0;
  const legacyUi = mountFusionPrepareBar({
    viewPrepareEl: app.document.createElement('div'),
    noticeEl: app.document.createElement('div'),
    globalTarget: {
      adsk: { fusionSendData: () => {} },
      location: { search: '?host=fusion' },
    },
    onLegacyAddin: () => { legacyCalled++; },
  });
  legacyUi.bridge.handle('pong', JSON.stringify({ action: 'pong', fusionVersion: '2.0', documentName: 'OldDoc', lengthUnits: 'mm' }));
  eq(legacyCalled, 1, 'pong without projectBridge invokes onLegacyAddin fallback');
  eq(legacyUi.isProjectBridgeActive(), false, 'projectBridge stays inactive for older add-in');
  legacyUi.destroy();
} finally {
  fusionUi.destroy();
  await app.close();
}
console.log(`perdesign-855-node: ${checks} checks passed`);
