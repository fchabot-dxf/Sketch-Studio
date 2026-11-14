// apps/shaper/src/prepare-stage.js — Shaper's PREPARE stage wiring, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test
// kit (tests/helpers/node-app.js) both call createPrepareStage(): the Prepare view mounted on the shared Design sketch, the cut-settings card, the rule that every
// cut-plan edit is ONE step of the shared sketch history (TASK 463), the cut plan riding in the shared undo snapshots (`hostSnapshot`), the Ctrl+Z / Ctrl+Y keys
// while Prepare shows, and what the document buffer does with Prepare after a restore. Moved out of main.js unchanged; the page keeps its own views (Explore,
// Vcarve, Review, the info panel) and passes what only it has as options.
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { undoRedoKeyAction } from '#ui/input-manager.js'; // TASK 463: the shared history key mapping
import { captureCutPlan, applyCutPlan } from './shaper-doc.js'; // TASK 460: the cut plan + stock ride in doc.hosts.shaper
import { mountPrepareView } from './prepare-view.js'; // SP1a/c/d/e: Prepare render + loop/edge select + cut preview
import { createCutPanel } from './cut-panel.js';       // SP1f: the cut-settings card (cut-type control)
import { CUT_PLAN, migrateEdgeRecords } from './cut-plan.js'; // SP1j-4: the shared cut-plan store

/**
 * createPrepareStage({ getController, getMode, panelEl, canvasEl, noticeEl, ensureSketch, notify, onViewChange })
 *   getController(): the mounted Design sketch controller (null before it exists). getMode(): the showing mode ('prepare' while Prepare shows).
 *   panelEl / canvasEl / noticeEl: the cut card's host, the Prepare svg, the one-line notice. ensureSketch(): mounts the sketch (the page mounts it lazily).
 *   notify(msg): the page's status line. onViewChange(view): told when the Prepare view is (re)mounted (the page's dev / test seam).
 * Returns { hostSnapshot, mount, enter, view, afterRestore, cutPanel }: hostSnapshot = state.hostSnapshot of the sketch (the cut plan in its undo snapshots);
 * mount() = (re)mount the Prepare view; enter(enteringMode) = the mode router's hook for entering Prepare (modes.js); view() = the mounted view or null;
 * afterRestore() = what a document restore does with Prepare.
 */
export function createPrepareStage({ getController, getMode, panelEl, canvasEl, noticeEl, ensureSketch = () => {}, notify = () => {}, onViewChange = () => {} }) {
  let prepareView = null;      // SP1c–f: Prepare-local view (edges + loop/edge select + cut preview); re-mounted per Prepare enter
  // SP1f: the cut-settings card reflects the Prepare selection + writes the picked cut type back onto it.
  const refreshCutPanel = () => {
    const t = prepareView && prepareView.selectedTarget && prepareView.selectedTarget();
    cutPanel.update(t ? { kind: t.kind, record: prepareView.recordFor(t) } : null);
  };
  // TASK 463: every cut-plan edit is ONE step of the SHARED sketch history (the ribbon's Undo/Redo, Ctrl+Z / Ctrl+Y): the shared
  // state snapshots carry the cut plan through its generic `hostSnapshot` hook (below), so there is no second
  // history stack. A pre-edit snapshot is taken, and dropped again if the edit changed nothing (e.g. re-picking the same preset).
  function cutEdit(apply) {
    const designController = getController();
    const st = designController && designController.state;
    const before = JSON.stringify(captureCutPlan());
    if (st) st.saveState('cut plan edit');
    const n = st ? st.history.length : 0;
    apply();
    if (st && JSON.stringify(captureCutPlan()) === before) st.discardSnapshotAt(n);
    refreshCutPanel();
  }
  const cutPanel = createCutPanel(panelEl, {
    onPickType: (id) => cutEdit(() => { if (prepareView) prepareView.applyCutTypeToSelected(id); }),
    onSetField: (field, value) => cutEdit(() => { if (prepareView) prepareView.setFieldOnSelected(field, value); }),
    onSetFields: (o) => cutEdit(() => { if (prepareView) for (const [k, v] of Object.entries(o)) prepareView.setFieldOnSelected(k, v); }),
  });

  // The geometry signature the mounted Prepare view was built from: an undo that changed only the cut plan just repaints it
  // (keeps selection + card); one that changed the sketch (e.g. undoing an SVG import) re-mounts it from the restored state.
  let prepareSig = null;
  const geomSig = (st) => JSON.stringify([[...st.joints.entries()].map(([k, j]) => [k, j.x, j.y]), st.shapes.map((x) => [x.id, x.type, x.joints, x.radius])]);
  function restoreCutPlanFromHistory(entries) {
    applyCutPlan(entries);
    const designController = getController();
    if (getMode() !== 'prepare' || !designController) return;
    if (prepareView && geomSig(designController.state) === prepareSig) { prepareView.refreshLook(); refreshCutPanel(); }
    else mountPrepare();
  }

  // TASK 472: a transient one-line notice in Prepare (e.g. the Stock role moved to another loop)
  let prepareNoticeTimer = null;
  function prepareNotice(msg) {
    const el = noticeEl; if (!el) return;
    el.textContent = msg; el.hidden = false;
    clearTimeout(prepareNoticeTimer); prepareNoticeTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  // SP1a/SP1c: (re)mount the Prepare view on the shared Design sketch (no 2nd engine/RAF). TASK 460: also called after a document
  // restore so Prepare shows the restored geometry and cut plan.
  function mountPrepare() {
    ensureSketch();
    const designController = getController();
    try { designController.engine.solve(500); } catch (_) {}
    if (prepareView) prepareView.destroy();
    const st = designController.state;
    const loops = findLoops(st);
    const chains = findOpenChains(st, loops);
    const { dropped, moved, vcarveUpdated } = migrateEdgeRecords(loops, chains, CUT_PLAN, st.vcarves);
    if (dropped + moved + (vcarveUpdated || 0) > 0) {
      const parts = [];
      if (moved > 0) parts.push(`${moved} edge cut${moved === 1 ? '' : 's'} moved to chain`);
      if (dropped > 0) parts.push(`${dropped} dropped from closed loop${dropped === 1 ? '' : 's'}`);
      if (vcarveUpdated > 0) parts.push(`${vcarveUpdated} vcarve region${vcarveUpdated === 1 ? '' : 's'} updated`);
      notify(`Cut plan updated: ${parts.join(', ')}`);
    }
    prepareView = mountPrepareView(st, canvasEl, { onSelectionChange: refreshCutPanel, onNotice: prepareNotice });
    prepareSig = geomSig(st);
    onViewChange(prepareView);
    refreshCutPanel(); // no selection yet → the card stays hidden
  }

  // TASK 463: Prepare has no sketcher input layer and the shared Ctrl+Z handler is gated to Design (isActive: mode === 'design'),
  // so Ctrl+Z / Ctrl+Y on Prepare would do nothing. This listener runs ONLY while Prepare is the mode (the two gates are mutually
  // exclusive, so a key never fires twice), uses the SAME key mapping as the shared handler (input-manager undoRedoKeyAction), and
  // drives the same state.undo()/redo().
  document.addEventListener('keydown', (e) => {
    const designController = getController();
    if (getMode() !== 'prepare' || !designController) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // let a text field undo its own text
    const action = undoRedoKeyAction(e);
    if (!action) return;
    designController.state[action]();
    e.preventDefault();
  });

  return {
    hostSnapshot: { capture: captureCutPlan, restore: restoreCutPlanFromHistory }, // TASK 463: the cut plan rides in the shared undo snapshots
    mount: mountPrepare,
    enter: (enteringMode) => { if (enteringMode || !prepareView) mountPrepare(); }, // the mode router's hook: entering Prepare mounts it afresh
    view: () => prepareView,
    // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts
    afterRestore: () => {
      if (getMode() === 'prepare') mountPrepare();
      else if (prepareView) { prepareView.destroy(); prepareView = null; } // re-mounted from the restored state on next entry
    },
    cutPanel,
  };
}
