// apps/shaper/src/prepare-stage.js — Shaper's PREPARE stage wiring, DECLARED in one importable place (TASK 583). The page script (main.js) and the node test
// kit (tests/helpers/node-app.js) both call createPrepareStage(): the Prepare view mounted on the shared Design sketch, the cut-settings card, the rule that every
// cut-plan edit is ONE step of the shared sketch history (TASK 463), the cut plan riding in the shared undo snapshots (`hostSnapshot`), the Ctrl+Z / Ctrl+Y keys
// while Prepare shows, and what the document buffer does with Prepare after a restore. Moved out of main.js unchanged; the page keeps its own views
// (Review, the info panel) and passes what only it has as options.
import { capturePrepare, applyPrepare, comparablePrepare } from './shaper-doc.js'; // TASK 460: the cut plan + stock ride in doc.hosts.shaper; TASK S1: the operations store
import { mountPrepareView } from './prepare-view.js'; // SP1a/c/d/e: Prepare render + loop/edge select + cut preview
import SettingsManager, { isPrecisionKey } from '#core/settings-manager.js';
import { createCutPanel } from './cut-panel.js';       // SP1f: the cut-settings card (cut-type control)
import { cutPlanNotice, stockKeyOf, keyOf, typeRefusal, newOperation, setStock, changeOpType, addShapeToOp, removeShapeFromOp, duplicateOperation, deleteOperation, setShapeTabsAt, followDesign, planMemberItems, pathsSigOf, pathsInputOf, settleWaiting, orderWaiting } from './cut-plan.js'; // TASK 810: stockKeyOf (the Boundary's Stock choice); TASK 761: the reconciliation's notice; TASK S2: the operation writers
import { describeOperations } from './operations.js'; // TASK 743 / S1: the stored operations, described
import { reorderOps, setOpsOn, opById, regionOf, CONTOUR_TYPE } from './operations-store.js'; // TASK S1: the list order is the stored operations' order; TASK 798: the ticks
import { cutTypeById, STOCK_TYPE_ID } from './shaper.js'; // TASK S2: a type's name; the Stock
import { createOpList } from './op-list.js';                   // TASK 743: Prepare's operations list
import { hold as holdPaths, retain as retainPaths, request as requestPaths, onChange as onPathsChange, isGenerating, hasResult } from './op-paths.js'; // TASK 817: the paths generated in the background
import { loadBits, TOOL_TABLE_KEY } from './tool-table.js'; // TASK 842: the user's tool table (the card's Bit menu)

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

/** TASK 812: the one notice of a document a NEWER version of the app made (document-buffer.js hostVersion: it is opened, never written over). */
export const NEWER_VERSION_NOTICE = 'Made by a newer version of the app: reload to edit.';
/** TASK 741: the one-time notice Prepare shows after a document that had V-carve regions was opened (#core/document.js deserializeDocument drops them and
 *  counts them). Shown in Prepare's one-line notice (#prepare-notice, prepareNotice below: the TASK 472 mechanism), the next time Prepare mounts. */
export const removedVcarvesNotice = (n) => `This design had ${n === 1 ? 'a V-carve region' : `${n} V-carve regions`}; V-carve was removed. Pick a cut type for ${n === 1 ? 'it' : 'them'} (V-bit cutter shape for a V-groove).`;

export function createPrepareStage({ getController, getMode, history, panelEl, canvasEl, noticeEl, opsEl = null, ensureSketch = () => {}, onViewChange = () => {}, openToolTable = () => {} }) { // TASK 842: openToolTable = the page's Tool table window
  let prepareView = null;      // SP1c–f: Prepare-local view (edges + loop/edge select + cut preview); re-mounted per Prepare enter
  let boundaryPicking = false; // TASK 810: a Roughing boundary Pick is on (the next click on a closed shape in Prepare picks it)
  // SP1f: the cut-settings card reflects the Prepare selection + writes the picked cut type back onto it. TASK 743: the operations list follows the same
  // changes (every cut-plan edit, an undo / redo, a selection change, a re-mount), so it is refreshed here too.
  // TASK S2 (docs/OPERATIONS-MODEL.md 4.2-4.4, owner rulings turns 2716-2718): EDITING IS DELIBERATE. An operation is OPENED (the Operations list's Edit button, the
  // quick flow, Duplicate), edited in its card while every change PREVIEWS live (Prepare, the 3D Review, the file), then CONFIRMED: OK = the whole session is ONE
  // undo step; Cancel / Esc = the operation exactly as it was when opened, nothing in the undo stack. One operation is open at a time; anything else in the list
  // (another row's Edit, a row tap, a tick, a reorder, another row's bin) and leaving Prepare = OK first; the open operation's bin = Cancel, then the delete; Undo
  // while it is open = Cancel (the session's undo point is undone). A click on a shape only SELECTS it: its operations' rows are highlighted in the list and the
  // card shows only the quick flow's type menu. An incompatible pick is TOLD in one plain line in the card's note area (cut-plan.js typeRefusal), never greyed.
  let opsNow = null;
  const opsOf = () => opsNow || (getController() ? describeOperations(getController().state) : []);
  const numberOf = (ops, id) => ops.findIndex((o) => o.id === id) + 1;
  const typeName = (id) => (cutTypeById(id) || {}).menuLabel || id;
  const pickedKeys = () => (prepareView ? prepareView.selectedTargets().map((t) => keyOf(t.kind, t.id)) : []);
  let line = null; // the card's one plain line (a refusal), shown at the top of its note area until the next action
  const say = (text) => { line = text; };
  function cardModel(ops) {
    const pv = prepareView;
    if (!pv) return null;
    const lineItems = line ? [{ text: line, warn: line }] : [];
    const op = pv.activeOp();
    if (op) {
      const keys = op.geometry.map((r) => r.key), n = keys.length;
      const f = pv.factsOf(op, keys[0] || null);
      // TASK S2 (owner turn 2713): a Contour's own Wall side matters on a shape whose model does not say it (no slope, no levels: a drawn shape)
      const wallSideFree = op.type === CONTOUR_TYPE && (!n || keys.some((k) => { const r = regionOf(k) || {}; return !r.slope && !(Array.isArray(r.levels) && r.levels.length); }));
      const depthFromModel = !(Number(op.settings.cutDepth) > 0); // TASK S2: the Depth from the model ('model' / unset) or a typed value (a Roughing's / Contour's Bottom)
      return { mode: 'op', ...f, note: [...lineItems, ...f.note], boundary: { hasStock: Boolean(stockKeyOf()), picking: boundaryPicking }, opId: op.id, wallSideFree, depthFromModel, preview: previewState(),
        title: `${typeName(op.type)} ${numberOf(ops, op.id)} \u00b7 ${n === 0 ? 'no shapes yet' : n === 1 ? '1 shape' : `${n} shapes`}`,
        shapes: keys.map((key) => ({ key, label: pv.shapeLabel(key) })) };
    }
    const t = pv.selectedTarget();
    return t ? { mode: 'shape', kind: t.kind, record: { cutType: null }, note: lineItems } : null; // the quick flow's type menu only (owner turn 2717)
  }
  const refreshCutPanel = () => {
    opsNow = getController() ? describeOperations(getController().state) : [];
    cutPanel.update(cardModel(opsNow));
    opList.refresh();
    opList.reveal(); // TASK S2 (owner turn 2718): the first highlighted row in view (the list open), never opened
    keepWanted();
    spinLater(opsNow);
    opsNow = null;
  };
  // TASK 817: the plan's paths now (every membership's signature, the open operation's as opened and its Preview's): any other job still queued is superseded (dropped)
  function keepWanted() {
    const pv = prepareView, st = sketchState();
    if (!pv || !st) return;
    const ctx = pv.pathsContext(), sigs = new Set();
    for (const it of planMemberItems()) { const s = pathsSigOf(it.planKey, it.rec, ctx); if (s) sigs.add(s); }
    for (const s of pv.openSignatures()) sigs.add(s);
    if (session && session.preview) for (const s of session.preview.sigs.values()) sigs.add(s);
    retainPaths(sigs);
  }
  // TASK 817 (brief item 6): a row spins only once its operation has been generating for SPIN_AFTER_MS (a quick derivation finishes before: no flicker). `pendingSince`:
  // operation id -> when it was first seen generating; the list is refreshed when the first of them reaches the delay
  const SPIN_AFTER_MS = 150;
  const pendingSince = new Map();
  let spinTimer = null;
  function spinLater(ops) {
    const now = Date.now(), seen = new Set();
    for (const op of ops) if (op.pending && !(session && session.opId === op.id)) { seen.add(op.id); if (!pendingSince.has(op.id)) pendingSince.set(op.id, now); }
    for (const id of [...pendingSince.keys()]) if (!seen.has(id)) pendingSince.delete(id);
    const waits = [...pendingSince.values()].map((t) => t + SPIN_AFTER_MS - now).filter((ms) => ms > 0);
    clearTimeout(spinTimer); spinTimer = null;
    if (waits.length) spinTimer = setTimeout(() => { spinTimer = null; opList.refresh(); }, Math.min(...waits) + 5);
  }
  const isSpinning = (op) => Boolean(op.pending) && pendingSince.has(op.id) && Date.now() - pendingSince.get(op.id) >= SPIN_AFTER_MS;
  // TASK 817: a result that arrived from the worker: what waited for it (the list order), then the views (one repaint for a burst of answers)
  let repaintQueued = false;
  onPathsChange(() => {
    if (repaintQueued) return;
    repaintQueued = true;
    setTimeout(() => {
      repaintQueued = false;
      const st = sketchState();
      if (st && orderWaiting()) settleWaiting(st);
      if (prepareView && getMode() === 'prepare') { prepareView.refreshLook(); refreshCutPanel(); }
    }, 0);
  });
  // TASK 724: the card's notes are text built through the one length formatter when the card is updated: a change of what that formatter reads (the display
  // precision, TASK 775: the DOCUMENT UNIT, and a key-less change: settings loaded / reset / arriving from another device) rebuilds the card with its notes and
  // the operations list (refreshCutPanel refreshes both), exactly when the card's fields re-label (the stage lives as long as the page)
  SettingsManager.subscribe((setting) => { if (setting === null || setting === 'DOC_UNIT' || isPrecisionKey(setting) || setting === TOOL_TABLE_KEY) refreshCutPanel(); }); // TASK 842: a changed tool table (the card's Bit row names its bit, or says it left the table)
  // TASK 463: every cut-plan edit is ONE step of the SHARED sketch history (the ribbon's Undo/Redo, Ctrl+Z / Ctrl+Y): the shared
  // state snapshots carry the cut plan through its generic `hostSnapshot` hook (below), so there is no second
  // history stack. A pre-edit snapshot is taken, and dropped again if the edit changed nothing (e.g. re-picking the same preset). TASK S1: compared without the
  // regions (shaper-doc.js comparablePrepare: an edit never changes them; the rose's levels are ~1.6 MB of text).
  // TASK S2: the instant edits (a tick, a reorder, the bin) go through cutEdit; an open operation's edits are a SESSION (below), ONE step when confirmed.
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
  // TASK S2: the EDIT SESSION of the open operation: the state before it is kept (`pre`); its first change takes the undo point of that state (the same pre-edit
  // snapshot as cutEdit: changed()), its changes then go to the store with no history (they preview live); OK keeps the undo point (dropped when nothing changed in
  // the end), Cancel puts the state back and drops it. Opening and cancelling with no change touch no history (Redo is kept).
  let session = null; // { opId, pre (capturePrepare), before (comparable), n (the history length after its undo point; null before its first change), preview (TASK 817) }
  // TASK 817 (owner turns 2745-2746): while an operation is OPEN its edits are not generated (no new paths until OK; the Preview asks for them): its requests are
  // held (op-paths.js hold: set when it opens, openSession); every other operation's paths are generated as ever
  const setSession = (s) => { session = s; if (!s) holdPaths(null); };
  function beginSession() {
    const pre = capturePrepare();
    setSession({ opId: null, pre, before: comparablePrepare(pre), n: null, preview: null });
  }
  function changed() { // before a change of the session: its undo point, once
    const st = sketchState();
    if (!session || session.n !== null || !st) return;
    st.saveState('cut plan edit');
    session.n = st.history.length;
  }
  let rowId = null; // TASK S2 (owner turn 2719): the SELECTED (tapped) row of the list: it alone shows Edit, Duplicate, X
  // Duplicate (the selected row's, the open card's): OK on the open operation first, then the copy is created OPEN (Cancel removes it)
  function duplicateAndOpen(opId) { commitSession(); const op = opById(opId); if (!op || !prepareView) return; beginSession(); changed(); const copy = duplicateOperation(op, sketchState()); rowId = copy.id; openSession(copy.id); }
  // the list's Edit: open the operation (OK on another open one first); nothing when it is the open one
  function openForEdit(opId) { if (!prepareView || (session && session.opId === opId)) return; commitSession(); if (!opById(opId)) return; beginSession(); openSession(opId); }
  function openSession(opId) { session.opId = opId; session.preview = null; holdPaths(opId); line = null; prepareView.openOp(opId); prepareView.refreshLook(); refreshCutPanel(); }
  function sessionEdit(apply) {
    if (!session || !prepareView) return;
    line = null;
    changed();
    apply();
    prepareView.syncActive(); prepareView.refreshLook();
    refreshCutPanel();
  }
  function endSession(keep) {
    if (!session) return;
    const st = sketchState(), s0 = session;
    setSession(null); // TASK 817: OK asks for its paths (the refresh below reads them: generated in the background); the order that waited on them is settled when they are there
    if (!keep) applyPrepare(s0.pre);
    else if (st && orderWaiting()) settleWaiting(st); // (the in-process port of the node tests answers at once: settled here, inside the session's undo step)
    if (st && s0.n !== null && (!keep || comparablePrepare(capturePrepare()) === s0.before)) st.discardSnapshotAt(s0.n);
    line = null;
    if (prepareView) { prepareView.closeOp(); prepareView.setSelection([]); prepareView.refreshLook(); } // the card closes
    refreshCutPanel();
  }
  const commitSession = () => endSession(true);
  const cancelSession = () => endSession(false);
  // TASK 817 addendum (owner turns 2747-2748): PREVIEW the open operation: its paths with the card's settings NOW, generated in the background like OK's (the same
  // job: what OK then makes is this very result), drawn on the canvas; a later change in the card fades them (stale, prepare-view.js openLookOf) and the button is
  // "Preview" again; Cancel / OK drop it. Never exported, never in Undo (it is only a generated result, filed by its signature).
  function previewSession() {
    const pv = prepareView, op = session && pv ? pv.activeOp() : null;
    if (!op) return;
    const items = planMemberItems().filter((it) => it.opId === op.id).map((it) => ({ it, input: pathsInputOf(it.planKey, it.rec) })).filter((x) => x.input);
    const sigs = requestPaths(pv.pathsContext(), items.map((x) => x.input));
    session.preview = { sigs: new Map(items.map((x, i) => [x.it.id, sigs[i]])) };
    pv.setPreview(session.preview);
    refreshCutPanel();
  }
  // the Preview button's state: idle (none), busy (generating), fresh (drawn: the card's settings now), stale (changed since: drawn faded)
  function previewState() {
    const p = session && session.preview, pv = prepareView;
    if (!p || !pv) return 'idle';
    const sigs = [...p.sigs.values()];
    if (sigs.some((s) => isGenerating(s))) return 'busy';
    const ctx = pv.pathsContext();
    const now = planMemberItems().filter((it) => it.opId === session.opId);
    const fresh = now.length === p.sigs.size && now.every((it) => p.sigs.get(it.id) === pathsSigOf(it.planKey, it.rec, ctx)) && sigs.every((s) => hasResult(s));
    return fresh ? 'fresh' : 'stale';
  }
  // a type picked in the card: on the OPEN operation it changes its type (refused with its line when one of its shapes cannot take it); with shapes selected it is the
  // QUICK FLOW (4.4): ALWAYS a NEW operation holding the picked shapes that can take the type, created OPEN (Cancel removes it); none can: nothing is created, the
  // line says why; some cannot: they are left out and the line says so. The Stock keeps the one-Stock move (task 472: the last closed shape picked).
  function pickType(id) {
    const pv = prepareView, st = sketchState();
    if (!pv) return;
    const prevStock = stockKeyOf();
    const stockNotice = (key) => { if (prevStock && prevStock !== key) prepareNotice('Stock moved to this loop (there is one Stock per document)'); else if (!prevStock) prepareNotice('This closed loop is now the Stock: the board in Export'); };
    const op = session && pv.activeOp();
    if (op) {
      const why = typeRefusal(id, op.geometry.map((r) => r.key));
      if (why) { say(why); refreshCutPanel(); return; }
      sessionEdit(() => { if (id === STOCK_TYPE_ID && op.geometry.length) stockNotice(op.geometry[0].key); changeOpType(op, id, st); });
      return;
    }
    const picked = pickedKeys();
    const fit = picked.filter((k) => !typeRefusal(id, [k])), out = picked.filter((k) => !fit.includes(k));
    const keys = id === STOCK_TYPE_ID ? fit.slice(-1) : fit;
    if (!keys.length) { say(typeRefusal(id, picked)); refreshCutPanel(); return; }
    beginSession(); changed();
    let made;
    if (id === STOCK_TYPE_ID) { stockNotice(keys[0]); made = setStock(keys[0], st).op; } else made = newOperation(id, keys, st);
    openSession(made.id);
    if (out.length) { say(`${typeRefusal(id, out)} (left out)`); refreshCutPanel(); }
  }
  const cutPanel = createCutPanel(panelEl, {
    onPickType: (id) => pickType(id),
    onSetField: (field, value) => sessionEdit(() => prepareView.setOpField(field, value)), // TASK S2: the open operation, every one of its shapes (previewed; OK confirms)
    onSetFields: (o) => sessionEdit(() => { for (const [k, v] of Object.entries(o)) prepareView.setOpField(k, v); }),
    // TASK S2: the open operation's card: an X per shape (that shape leaves it), Duplicate (OK on it, then its copy is opened: Cancel removes the copy), OK, Cancel; a
    // shape row under the pointer shows its shape on the canvas
    onRemoveShape: (key) => sessionEdit(() => removeShapeFromOp(prepareView.activeOp(), key, sketchState())),
    onDuplicate: () => { if (session) duplicateAndOpen(session.opId); },
    onOk: () => commitSession(),
    onCancel: () => cancelSession(),
    onPreview: () => { if (previewState() !== 'busy') previewSession(); }, // TASK 817
    getBits: () => loadBits(), // TASK 842: the Bit menu lists the user's tool table
    onOpenToolTable: () => openToolTable(), // TASK 842: the Bit menu's "Edit tool table..."
    onHoverShape: (key) => { if (prepareView) prepareView.hoverKey(key); },
    // TASK 810: Roughing's boundary Pick: the next click on a closed shape in Prepare sets the open Roughing's `boundaryShape` (TASK S2: an edit of its session); pressed
    // again, a click on nothing, or Esc: cancelled, nothing changes; a click on an open line: the line says why
    onPickBoundary: () => {
      if (!prepareView || !session) return;
      if (boundaryPicking) { prepareView.stopBoundaryPick(); return; }
      boundaryPicking = true;
      prepareView.startBoundaryPick({
        onPick: (key) => sessionEdit(() => prepareView.setOpField('boundaryShape', key)),
        onRefuse: () => say('This open line can\u2019t be a boundary: a boundary needs a closed shape'),
        onEnd: () => { boundaryPicking = false; refreshCutPanel(); },
      });
      refreshCutPanel();
    },
  });
  // TASK 743: the operations (TASK S1: stored, operations.js describeOperations) in the document's order; a reorder is ONE undo step (cutEdit: the snapshot carries
  // the store). TASK S2: a row tap SELECTS the operation's shapes (nothing opens); its Edit button OPENS it; the rows of every operation a selected shape is in are
  // highlighted (the list's selected row style, owner turn 2718)
  const isPicked = (op) => Boolean(prepareView) && Array.isArray(op.shapes) && op.shapes.some((k) => prepareView.selection.has(k));
  const opList = createOpList(opsEl, {
    getOps: opsOf,
    onMove: (keys) => { commitSession(); cutEdit(() => reorderOps(keys)); },
    onPick: (op) => { commitSession(); line = null; if (prepareView) prepareView.setSelection(op.shapes.map((k) => { const i = k.indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; })); rowId = op.id; opList.refresh(); },
    onEdit: (op) => { rowId = op.id; openForEdit(op.id); },
    onDuplicate: (op) => duplicateAndOpen(op.id),
    isPicked,
    isSelected: (op) => op.id === rowId,
    isOpen: (op) => Boolean(session && session.opId === op.id),
    isGenerating: (op) => isSpinning(op), // TASK 817: its paths are generating (shown after SPIN_AFTER_MS)
    // TASK S2: the bin DELETES the operation (its shapes stay in their other operations), ONE undo step (cutEdit: Undo brings it back in its place); the open operation's
    // bin = Cancel, then the delete (an operation the session created is gone with the Cancel). The sketch is never touched.
    onDelete: (op) => {
      if (session && session.opId === op.id) cancelSession(); else commitSession();
      const stored = opById(op.id);
      if (stored) cutEdit(() => { deleteOperation(stored, sketchState()); if (prepareView) { prepareView.setSelection([]); prepareView.refreshLook(); } });
    },
    // TASK 798: a row's / a heading's checkbox ticks or unticks its operations: ONE undo step (the snapshot carries the store and its `on`); Prepare's look shows the
    // ticked operations only (prepare-view.js), the selection and the card stay as they are
    onTick: (ids, on) => { commitSession(); cutEdit(() => { setOpsOn(ids, on); if (prepareView) prepareView.refreshLook(); }); },
  });

  // The geometry signature the mounted Prepare view was built from: an undo that changed only the cut plan just repaints it
  // (keeps selection + card); one that changed the sketch (e.g. undoing an SVG import) re-mounts it from the restored state.
  let prepareSig = null;
  const geomSig = (st) => JSON.stringify([[...st.joints.entries()].map(([k, j]) => [k, j.x, j.y]), st.shapes.map((x) => [x.id, x.type, x.joints, x.radius])]);
  function restoreCutPlanFromHistory(snapshot) {
    applyPrepare(snapshot);
    const restored = getController();
    if (restored) followDesign(restored.state); // TASK 832: the restored step's operations on its sketch (a step saved before they were followed)
    // TASK S2: Undo while an operation is open: with changes, it undoes the session's own undo point (= Cancel: the operation as opened, closed); with none, it is the
    // plain Undo of the step before, and the operation stays open (its card shows the restored values; gone: closed)
    if (session && session.n !== null) { setSession(null); line = null; if (prepareView) prepareView.closeOp(); }
    else if (session && !opById(session.opId)) { setSession(null); if (prepareView) prepareView.closeOp(); }
    const designController = getController();
    if (getMode() !== 'prepare' || !designController) return;
    if (prepareView && geomSig(designController.state) === prepareSig) { prepareView.syncActive(); prepareView.refreshLook(); refreshCutPanel(); }
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
    // TASK S2: the operation that was open is open again (its card, as 766 keeps the open card), with a session of its own (the restored document is the one
    // Cancel returns to); gone from the restored document: only the selection comes back
    if (s.open && opById(s.open)) { setSession(null); beginSession(); openSession(s.open); }
    else prepareView.setSelection(s.selection);
  }
  const captureSession = () => (prepareView
    ? { selection: prepareView.selectedTargets().map((t) => ({ kind: t.kind, id: t.id })), view: { ...prepareView.view }, open: session && session.opId ? session.opId : null }
    : pendingSession); // not mounted (the tab was left before Prepare was entered again): what it already carries
  function restoreSession(s) {
    pendingSession = s && (s.selection.length || s.view || s.open) ? s : null;
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
    followDesign(st); // TASK 832: the operations follow the Design edits made since (a shape filleted, snapped, split: its operations cut it as it is now)
    prepareView = mountPrepareView(st, canvasEl, {
      onSelectionChange: () => { line = null; rowId = null; refreshCutPanel(); }, onNotice: prepareNotice, avoidEl: panelEl, inset: opsInset(), // TASK S2: a canvas selection: no row is the selected one
      onCommitTabs: (opId, key, tabsAt) => sessionEdit(() => { const op = opById(opId); if (op) setShapeTabsAt(op, key, tabsAt, st); }), // TASK 822: dragging one of its tabs (that membership's tabsAt)
      // TASK S2: while an operation is open, a click on a shape puts it in, or takes it out when it is in it (an edit of its session); a shape the type cannot take is
      // not added: the card's line says why (cut-plan.js typeRefusal); Esc = Cancel
      onToggleShape: (opId, t) => {
        const op = opById(opId), key = keyOf(t.kind, t.id);
        if (!op) return;
        if (op.geometry.some((r) => r.key === key)) { sessionEdit(() => removeShapeFromOp(op, key, st)); return; }
        const why = typeRefusal(op.type, [key]) || typeRefusal(op.type, [...op.geometry.map((r) => r.key), key]);
        if (why) { say(why); refreshCutPanel(); } else sessionEdit(() => addShapeToOp(op, key, st));
      },
      onEscape: () => cancelSession(),
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
    enter: (enteringMode) => { if (enteringMode || !prepareView) { commitSession(); mountPrepare(); } }, // the mode router's hook: entering Prepare mounts it afresh
    leave: () => commitSession(), // TASK S2: leaving Prepare (the mode router's afterShow, another mode) = OK on the open operation
    view: () => prepareView,
    captureSession, restoreSession, // TASK 605: the tab's Prepare selection + view (shaper-session.js)
    // re-mount Prepare if it is the visible mode so it shows the restored geometry + cuts
    afterRestore: (restore) => {
      // TASK 741: a document that had V-carve regions; TASK 761: what reconciling its stored cut plan changed (cut-plan.js reconcileCutPlan, in shaper-doc.js
      // applyShaperDoc): the same one-time notice, the next time Prepare mounts (now, when Prepare shows)
      const notes = [restore && restore.newer ? NEWER_VERSION_NOTICE : null, restore && restore.removedVcarves > 0 ? removedVcarvesNotice(restore.removedVcarves) : null, cutPlanNotice(restore && restore.cutPlan)].filter(Boolean);
      pendingRemovedNotice = notes.length ? notes.join(' · ') : null;
      setSession(null); line = null; // TASK S2: another document: no operation stays open (its undo point went with the history of the document left)
      if (getMode() === 'prepare') mountPrepare();
      else if (prepareView) { prepareView.destroy(); prepareView = null; } // re-mounted from the restored state on next entry
    },
    cutPanel,
    opList,
    pickType, // TASK S2: the card's type pick (the quick flow with shapes selected: a new operation, OPEN; a type change of the open operation)
    // TASK S2: the edit session (the list's Edit, OK, Cancel; the test kit drives the same calls the buttons make)
    edit: openForEdit,
    ok: () => commitSession(), cancel: () => cancelSession(), openId: () => (session ? session.opId : null),
    preview: () => previewSession(), previewState, // TASK 817: the open operation's Preview (the test kit presses what the button presses)
    notice: prepareNotice, // TASK 790: Open STL's notice (stl-import.js)
  };
}
