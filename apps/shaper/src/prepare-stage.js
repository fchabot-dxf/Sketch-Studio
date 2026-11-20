// apps/shaper/src/prepare-stage.js — Shaper's PREPARE stage wiring, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test
// kit (tests/helpers/node-app.js) both call createPrepareStage(): the Prepare view mounted on the shared Design sketch, the cut-settings card, the rule that every
// cut-plan edit is ONE step of the shared sketch history (TASK 463), the cut plan riding in the shared undo snapshots (`hostSnapshot`), the Ctrl+Z / Ctrl+Y keys
// while Prepare shows, and what the document buffer does with Prepare after a restore. Moved out of main.js unchanged; the page keeps its own views
// (Review, the info panel) and passes what only it has as options.
import { capturePrepare, applyPrepare, comparablePrepare } from './shaper-doc.js'; // TASK 460: the cut plan + stock ride in doc.hosts.shaper; TASK S1: the operations store
import { mountPrepareView } from './prepare-view.js'; // SP1a/c/d/e: Prepare render + loop/edge select + cut preview
import SettingsManager, { isPrecisionKey } from '#core/settings-manager.js';
import { createCutPanel } from './cut-panel.js';       // SP1f: the cut-settings card (cut-type control)
import { cutPlanNotice, stockKeyOf, keyOf, freshRecord, typeRefusal, newOperation, setStock, changeOpType, addShapeToOp, removeShapeFromOp, duplicateOperation, deleteOperation, setShapeLeadInAt } from './cut-plan.js'; // TASK 810: stockKeyOf (the Boundary's Stock choice); TASK 761: the reconciliation's notice; TASK S2: the operation writers
import { describeOperations } from './operations.js'; // TASK 743 / S1: the stored operations, described
import { reorderOps, setOpsOn, opById, regionOf, CONTOUR_TYPE } from './operations-store.js'; // TASK S1: the list order is the stored operations' order; TASK 798: the ticks
import { cutTypeById, STOCK_TYPE_ID } from './shaper.js'; // TASK S2: a type's name; the Stock
import { createOpList } from './op-list.js';                   // TASK 743: Prepare's operations list

/**
 * createPrepareStage({ getController, getMode, panelEl, canvasEl, noticeEl, opsEl, ensureSketch, onViewChange })
 *   getController(): the mounted Design sketch controller (null before it exists). getMode(): the showing mode ('prepare' while Prepare shows).
 *   history: the Undo / Redo router (modes.js createShaperHistory); its runKey serves Ctrl+Z / Ctrl+Y while Prepare shows.
 *   panelEl / canvasEl / noticeEl: the cut card's host, the Prepare svg, the one-line notice. opsEl: TASK 743, the operations list's host (op-list.js). ensureSketch(): mounts the sketch (the page mounts it lazily).
 *   onViewChange(view): told when the Prepare view is (re)mounted (the page's dev / test seam). (TASK 761: no `notify` any more: the cut plan's notice is the one-time Prepare notice.)
 * Returns { hostSnapshot, mount, enter, view, afterRestore, captureSession, restoreSession, cutPanel, opList, pickType (TASK S2: the card's type pick) }: hostSnapshot = state.hostSnapshot of the sketch (the cut plan in its undo snapshots);
 * mount() = (re)mount the Prepare view; enter(enteringMode) = the mode router's hook for entering Prepare (modes.js); view() = the mounted view or null;
 * afterRestore(restore) = what a document restore does with Prepare (restore = the document buffer's onRestored payload: TASK 741, its removedVcarves).
 */

/** TASK S2: the active operation's list sub-line in Add shapes mode (docs/OPERATIONS-MODEL.md 4.2). */
export const ADDING_WORDS = 'click shapes to add \u00b7 Done';
/** TASK 812: the one notice of a document a NEWER version of the app made (document-buffer.js hostVersion: it is opened, never written over). */
export const NEWER_VERSION_NOTICE = 'Made by a newer version of the app: reload to edit.';
/** TASK 741: the one-time notice Prepare shows after a document that had V-carve regions was opened (#core/document.js deserializeDocument drops them and
 *  counts them). Shown in Prepare's one-line notice (#prepare-notice, prepareNotice below: the TASK 472 mechanism), the next time Prepare mounts. */
export const removedVcarvesNotice = (n) => `This design had ${n === 1 ? 'a V-carve region' : `${n} V-carve regions`}; V-carve was removed. Pick a cut type for ${n === 1 ? 'it' : 'them'} (V-bit cutter shape for a V-groove).`;

export function createPrepareStage({ getController, getMode, history, panelEl, canvasEl, noticeEl, opsEl = null, ensureSketch = () => {}, onViewChange = () => {} }) {
  let prepareView = null;      // SP1c–f: Prepare-local view (edges + loop/edge select + cut preview); re-mounted per Prepare enter
  let boundaryPicking = false; // TASK 810: a Roughing boundary Pick is on (the next click on a closed shape in Prepare picks it)
  // SP1f: the cut-settings card reflects the Prepare selection + writes the picked cut type back onto it. TASK 743: the operations list follows the same
  // changes (every cut-plan edit, an undo / redo, a selection change, a re-mount), so it is refreshed here too.
  // TASK S2 (docs/OPERATIONS-MODEL.md 4.3): the card is the OPERATION card while an operation is active (its settings = every one of its shapes'), the SHAPE card while
  // shapes are picked with no operation active (a chip per operation the shapes are in, and the quick flow's type menu), else hidden. `ops` = the listed operations
  // (describeOperations, computed once per refresh and shared with the list: their numbers are the list's).
  let opsNow = null;
  const opsOf = () => opsNow || (getController() ? describeOperations(getController().state) : []);
  const numberOf = (ops, id) => ops.findIndex((o) => o.id === id) + 1;
  const typeName = (id) => (cutTypeById(id) || {}).menuLabel || id;
  const pickedKeys = () => (prepareView ? prepareView.selectedTargets().map((t) => keyOf(t.kind, t.id)) : []);
  // the shapes of `keys` a quick-flow pick of `type` makes an operation of (the open lines a region type cannot take are left out, as before; the Stock: the last closed one)
  const quickKeys = (type, keys) => (type === STOCK_TYPE_ID ? keys.filter((k) => !typeRefusal(type, [k])).slice(-1) : keys.filter((k) => !typeRefusal(type, [k])));
  function cardModel(ops) {
    const pv = prepareView;
    if (!pv) return null;
    const boundary = { hasStock: Boolean(stockKeyOf()), picking: boundaryPicking }; // TASK 810: the Boundary rows' context
    const op = pv.activeOp();
    if (op) {
      const keys = op.geometry.map((r) => r.key), n = keys.length;
      const f = pv.factsOf(op, keys[0] || null);
      const title = `${typeName(op.type)} ${numberOf(ops, op.id)} \u00b7 ${n === 0 ? 'no shapes yet' : n === 1 ? '1 shape' : `${n} shapes: a change applies to all ${n}`}`;
      // TASK S2 (owner turn 2713): a Contour's own Wall side matters on a shape whose model does not say it (no slope, no levels: a drawn shape)
      const wallSideFree = op.type === CONTOUR_TYPE && (!n || keys.some((k) => { const r = regionOf(k) || {}; return !r.slope && !(Array.isArray(r.levels) && r.levels.length); }));
      return { mode: 'op', ...f, boundary, opId: op.id, title, wallSideFree, typeWhy: (id) => typeRefusal(id, keys),
        geometry: { adding: pv.isAdding(), addWhy: op.type === STOCK_TYPE_ID && n ? 'The Stock is one shape' : null, shapes: keys.map((key) => ({ key, label: pv.shapeLabel(key) })) } };
    }
    const t = pv.selectedTarget();
    if (!t) return null;
    const keys = pickedKeys();
    const chips = ops.filter((o) => o.shapes && o.shapes.some((k) => keys.includes(k))).map((o) => ({ opId: o.id, label: `${numberOf(ops, o.id)} ${typeName(o.cutType)}` }));
    return { mode: 'shape', kind: t.kind, record: freshRecord(keyOf(t.kind, t.id)), note: [], boundary, chips,
      typeWhy: (id) => (quickKeys(id, keys).length ? null : typeRefusal(id, keys)) };
  }
  const refreshCutPanel = () => {
    opsNow = getController() ? describeOperations(getController().state) : [];
    cutPanel.update(cardModel(opsNow));
    opList.refresh();
    opsNow = null;
  };
  // TASK 724: the card's notes are text built through the one length formatter when the card is updated: a change of what that formatter reads (the display
  // precision, TASK 775: the DOCUMENT UNIT, and a key-less change: settings loaded / reset / arriving from another device) rebuilds the card with its notes and
  // the operations list (refreshCutPanel refreshes both), exactly when the card's fields re-label (the stage lives as long as the page)
  SettingsManager.subscribe((setting) => { if (setting === null || setting === 'DOC_UNIT' || isPrecisionKey(setting)) refreshCutPanel(); });
  // TASK 463: every cut-plan edit is ONE step of the SHARED sketch history (the ribbon's Undo/Redo, Ctrl+Z / Ctrl+Y): the shared
  // state snapshots carry the cut plan through its generic `hostSnapshot` hook (below), so there is no second
  // history stack. A pre-edit snapshot is taken, and dropped again if the edit changed nothing (e.g. re-picking the same preset). TASK S1: compared without the
  // regions (shaper-doc.js comparablePrepare: an edit never changes them; the rose's levels are ~1.6 MB of text).
  function cutEdit(apply) {
    const designController = getController();
    const st = designController && designController.state;
    const before = comparablePrepare(capturePrepare());
    if (st) st.saveState('cut plan edit');
    const n = st ? st.history.length : 0;
    apply();
    if (st && comparablePrepare(capturePrepare()) === before) st.discardSnapshotAt(n);
    refreshCutPanel();
  }
  const sketchState = () => (getController() ? getController().state : null);
  // TASK S2: a type picked in the card: on the OPERATION card it changes the operation's type (greyed when one of its shapes cannot take it); on the SHAPE card it is the
  // QUICK FLOW (4.4): ALWAYS a NEW operation holding the picked shapes, left active in Add shapes mode; the Stock keeps the one-Stock move (task 472)
  function pickType(id) {
    const pv = prepareView, st = sketchState();
    if (!pv) return;
    const op = pv.activeOp();
    const prevStock = stockKeyOf();
    const stockNotice = (key) => { if (prevStock && prevStock !== key) prepareNotice('Stock moved to this loop (there is one Stock per document)'); else if (!prevStock) prepareNotice('This closed loop is now the Stock: the board in Export'); };
    if (op) {
      if (typeRefusal(id, op.geometry.map((r) => r.key))) return;
      if (id === STOCK_TYPE_ID && op.geometry.length) stockNotice(op.geometry[0].key);
      changeOpType(op, id, st);
      pv.syncActive(); pv.refreshLook();
      return;
    }
    const keys = quickKeys(id, pickedKeys());
    if (!keys.length) return;
    if (id === STOCK_TYPE_ID) { stockNotice(keys[0]); const { op: stock } = setStock(keys[0], st); pv.activate(stock.id); }
    else pv.activate(newOperation(id, keys, st).id, { add: true });
    pv.refreshLook();
  }
  const cutPanel = createCutPanel(panelEl, {
    onPickType: (id) => cutEdit(() => pickType(id)),
    onSetField: (field, value) => cutEdit(() => { if (prepareView) { prepareView.setOpField(field, value); prepareView.syncActive(); } }), // TASK S2: the active operation, every one of its shapes
    onSetFields: (o) => cutEdit(() => { if (prepareView) { for (const [k, v] of Object.entries(o)) prepareView.setOpField(k, v); prepareView.syncActive(); } }),
    // TASK S2: the shape card's chips (a chip activates its operation) and the operation card's Shapes (owner turns 2710-2712): Add shapes (the mode; Done ends it), an X
    // per shape (that shape leaves the operation), Duplicate (a copy of the operation, made active): each store edit ONE undo step; a shape row under the pointer shows
    // its shape on the canvas
    onChip: (opId) => { if (prepareView) prepareView.activate(opId); },
    onAddShapes: () => { if (prepareView) prepareView.setAddMode(!prepareView.isAdding()); },
    onRemoveShape: (key) => cutEdit(() => { const pv = prepareView, op = pv && pv.activeOp(); if (op) { removeShapeFromOp(op, key, sketchState()); pv.syncActive(); pv.refreshLook(); } }),
    onDuplicate: () => cutEdit(() => { const pv = prepareView, op = pv && pv.activeOp(); if (op) { pv.activate(duplicateOperation(op, sketchState()).id); pv.refreshLook(); } }),
    onHoverShape: (key) => { if (prepareView) prepareView.hoverKey(key); },
    // TASK 810: Roughing's boundary Pick: the next click on a closed shape in Prepare sets the selected Roughing's `boundaryShape` (ONE undo step); pressed again, a
    // click on nothing / an open path, or Esc: cancelled, nothing changes
    onPickBoundary: () => {
      if (!prepareView) return;
      if (boundaryPicking) { prepareView.stopBoundaryPick(); return; }
      boundaryPicking = true;
      prepareView.startBoundaryPick({
        onPick: (key) => cutEdit(() => { prepareView.setOpField('boundaryShape', key); }), // TASK S2: the active Roughing
        onEnd: () => { boundaryPicking = false; refreshCutPanel(); },
      });
      refreshCutPanel();
    },
  });
  // TASK 743: the operations (TASK S1: stored, operations.js describeOperations) in the document's order; a reorder is ONE undo step (cutEdit: the snapshot carries
  // the store). TASK S2: a tap on an operation makes it the ACTIVE one (its shapes selected, its card open); the active operation's row is marked, and in Add shapes
  // mode its sub-line says so (docs/OPERATIONS-MODEL.md 4.2)
  const isPicked = (op) => Boolean(prepareView && prepareView.activeOp() && prepareView.activeOp().id === op.id);
  const opList = createOpList(opsEl, {
    getOps: () => opsOf().map((op) => (isPicked(op) && prepareView.isAdding() ? { ...op, regions: ADDING_WORDS } : op)),
    onMove: (keys) => cutEdit(() => reorderOps(keys)),
    onPick: (op) => { if (prepareView) prepareView.activate(op.id); },
    isPicked,
    // TASK S2: the bin DELETES the operation (its shapes stay in their other operations), ONE undo step (cutEdit: the snapshot carries the store, so Undo brings it
    // back in its place); the card closes when it was the active one. The sketch is never touched.
    onDelete: (op) => cutEdit(() => {
      const picked = isPicked(op), stored = opById(op.id);
      if (stored) deleteOperation(stored, sketchState());
      if (prepareView) { if (picked) prepareView.setSelection([]); prepareView.refreshLook(); }
    }),
    // TASK 798: a row's / a heading's checkbox ticks or unticks its operations: ONE undo step (the snapshot carries the store and its `on`); Prepare's look shows the
    // ticked operations only (prepare-view.js), the selection and the card stay as they are
    onTick: (ids, on) => cutEdit(() => { setOpsOn(ids, on); if (prepareView) prepareView.refreshLook(); }),
  });

  // The geometry signature the mounted Prepare view was built from: an undo that changed only the cut plan just repaints it
  // (keeps selection + card); one that changed the sketch (e.g. undoing an SVG import) re-mounts it from the restored state.
  let prepareSig = null;
  const geomSig = (st) => JSON.stringify([[...st.joints.entries()].map(([k, j]) => [k, j.x, j.y]), st.shapes.map((x) => [x.id, x.type, x.joints, x.radius])]);
  function restoreCutPlanFromHistory(snapshot) {
    applyPrepare(snapshot);
    const designController = getController();
    if (getMode() !== 'prepare' || !designController) return;
    if (prepareView && geomSig(designController.state) === prepareSig) { prepareView.syncActive(); prepareView.refreshLook(); refreshCutPanel(); } // TASK S2: the active operation as restored (gone: none)
    else mountPrepare();
  }

  // TASK 472: a transient one-line notice in Prepare (e.g. the Stock role moved to another loop)
  let prepareNoticeTimer = null;
  let pendingRemovedNotice = null; // TASK 741: removedVcarvesNotice(n) of the last restored document (TASK 761: + cutPlanNotice), until Prepare shows it
  function prepareNotice(msg, isError) { // TASK 790: isError (given) = the red error look, else the look stays as it is
    const el = noticeEl; if (!el) return;
    el.textContent = msg; el.hidden = false;
    if (isError !== undefined) el.classList.toggle('is-error', Boolean(isError));
    clearTimeout(prepareNoticeTimer); prepareNoticeTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  // TASK 605: what a document tab keeps of Prepare while another tab shows: the selected targets and the pan / zoom. Put back on the view's next mount
  // (a restore re-mounts Prepare when it shows, and destroys it otherwise), so a tab switch from ANY mode brings the tab's own Prepare back.
  let pendingSession = null;
  function applyPendingSession() {
    const s = pendingSession;
    if (!s || !prepareView) return;
    pendingSession = null;
    if (s.view) prepareView.setView(s.view);
    prepareView.setSelection(s.selection);
  }
  const captureSession = () => (prepareView
    ? { selection: prepareView.selectedTargets().map((t) => ({ kind: t.kind, id: t.id })), view: { ...prepareView.view } }
    : pendingSession); // not mounted (the tab was left before Prepare was entered again): what it already carries
  function restoreSession(s) {
    pendingSession = s && (s.selection.length || s.view) ? s : null;
    if (prepareView && getMode() === 'prepare') applyPendingSession();
  }

  // TASK 743: the first fit keeps the drawing out from under the operations list (the card's panel is the fit's avoidEl): a narrow list (the desktop
  // side panel) costs the canvas its width on that side, a wide one (the phone's bottom bar) its height
  function opsInset() {
    const c = canvasEl.getBoundingClientRect(), o = opsEl ? opsEl.getBoundingClientRect() : null;
    if (!o || !(o.width > 0 && o.height > 0 && c.width > 0 && c.height > 0)) return undefined;
    const gap = 12;
    if (o.width < c.width / 2) return o.left - c.left < c.right - o.right ? { left: o.right - c.left + gap } : { right: c.right - o.left + gap };
    return o.top - c.top < c.bottom - o.bottom ? { top: o.bottom - c.top + gap } : { bottom: c.bottom - o.top + gap };
  }

  // SP1a/SP1c: (re)mount the Prepare view on the shared Design sketch (no 2nd engine/RAF). TASK 460: also called after a document
  // restore so Prepare shows the restored geometry and cut plan.
  function mountPrepare() {
    ensureSketch();
    const designController = getController();
    try { designController.engine.solve(500); } catch (_) {}
    if (prepareView) prepareView.destroy();
    const st = designController.state; // TASK 761: the stored plan's legacy edge records are reconciled where the document is read (shaper-doc.js applyShaperDoc), not here
    prepareView = mountPrepareView(st, canvasEl, {
      onSelectionChange: refreshCutPanel, onNotice: prepareNotice, avoidEl: panelEl, inset: opsInset(),
      onCommitLeadIn: (opId, key, at) => cutEdit(() => { const op = opById(opId); if (op) setShapeLeadInAt(op, key, at, st); if (prepareView) prepareView.refreshLook(); }), // TASK 778: dragging the lead-in handle commits ONE undo step (TASK S2: that membership's)
      // TASK S2: Add shapes mode: a click on a shape puts it into the active operation, or takes it out when it is in it (ONE undo step); a shape the type cannot
      // take is refused with its reason (the notice)
      onToggleShape: (opId, t) => cutEdit(() => {
        const op = opById(opId), key = keyOf(t.kind, t.id);
        if (!op) return;
        if (op.geometry.some((r) => r.key === key)) removeShapeFromOp(op, key, st);
        else { const why = typeRefusal(op.type, [...op.geometry.map((r) => r.key), key]); if (why) prepareNotice(why); else addShapeToOp(op, key, st); }
        if (prepareView) { prepareView.syncActive(); prepareView.refreshLook(); }
      }),
    });
    if (pendingRemovedNotice) { prepareNotice(pendingRemovedNotice); pendingRemovedNotice = null; } // TASK 741: once, on the first mount after the restore
    prepareSig = geomSig(st);
    applyPendingSession();
    onViewChange(prepareView);
    refreshCutPanel(); // no selection yet → the card stays hidden
  }

  // TASK 463: Prepare has no sketcher input layer and the shared Ctrl+Z handler is gated to Design (isActive: mode === 'design'),
  // so Ctrl+Z / Ctrl+Y on Prepare would do nothing. This listener runs ONLY while Prepare is the mode (the two gates are mutually
  // exclusive, so a key never fires twice) and runs the SAME dispatch as the header's Undo / Redo buttons (`history`, modes.js
  // createShaperHistory, TASK 618; the key mapping is history-control undoRedoKeyAction).
  document.addEventListener('keydown', (e) => {
    const designController = getController();
    if (getMode() !== 'prepare' || !designController) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // let a text field undo its own text
    history.runKey(e);
  });

  return {
    hostSnapshot: { capture: capturePrepare, restore: restoreCutPlanFromHistory }, // TASK 463: the cut plan rides in the shared undo snapshots (TASK 743: + the operation order)
    mount: mountPrepare,
    enter: (enteringMode) => { if (enteringMode || !prepareView) mountPrepare(); }, // the mode router's hook: entering Prepare mounts it afresh
    view: () => prepareView,
    captureSession, restoreSession, // TASK 605: the tab's Prepare selection + view (shaper-session.js)
    // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts
    afterRestore: (restore) => {
      // TASK 741: a document that had V-carve regions; TASK 761: what reconciling its stored cut plan changed (cut-plan.js reconcileCutPlan, in shaper-doc.js
      // applyShaperDoc): the same one-time notice, the next time Prepare mounts (now, when Prepare shows)
      const notes = [restore && restore.newer ? NEWER_VERSION_NOTICE : null, restore && restore.removedVcarves > 0 ? removedVcarvesNotice(restore.removedVcarves) : null, cutPlanNotice(restore && restore.cutPlan)].filter(Boolean);
      pendingRemovedNotice = notes.length ? notes.join(' · ') : null;
      if (getMode() === 'prepare') mountPrepare();
      else if (prepareView) { prepareView.destroy(); prepareView = null; } // re-mounted from the restored state on next entry
    },
    cutPanel,
    opList,
    pickType: (id) => cutEdit(() => pickType(id)), // TASK S2: the card's type pick (the quick flow on the shape card, a type change on the operation card): ONE undo step
    notice: prepareNotice, // TASK 790: Open STL's notice (stl-import.js)
  };
}
