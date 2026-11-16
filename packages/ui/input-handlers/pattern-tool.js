// packages/ui/input-handlers/pattern-tool.js - task 658 + 662: the CIRCULAR PATTERN and RECTANGULAR PATTERN tools (Modify group of the
// shared ribbon, after Mirror; declared divergence: Fusion keeps them under Create). Geometry, rows and the regenerate are #core/pattern.js;
// this module is the picks, the Fusion-style pattern DIALOG, the inline on-canvas Distance + Quantity boxes, the canvas overlay and the drag
// arrows. ONE flow for both tools, the differences declared in KINDS below.
//
// FLOW (Fusion's): the OBJECTS (the selection; a pre-selection counts), then circular: the CENTER POINT (any joint, the origin) / rectangular:
// the directions are the X / Y axes until direction line(s) are picked via Direction/s. As soon as the objects and centre are known the pattern
// EXISTS, live, in the document (the preview is the real copies, made by #core/pattern.js's one copy path); every value change regenerates it
// (editPattern). OK, Enter or the green check applies it: ONE undo step (taken at the first live change, with the snapshot from before the tool
// started). Cancel, Esc, the dialog's close button, a tool switch: the step is undone and dropped (nothing changed, no redo entry).
// THE DIALOG (task 662, matched to Fusion's layout): built on the shared tabbed dock panel (#ui/tabbed-dock-panel.js; no second dialog system).
//   Rectangular: Objects (button + clear x), Direction/s (one Select button + clear x), Distribution (Extent [default] | Spacing; stored as
//     'total' | 'spacing' so saved files are unchanged), Suppression (checkbox), then per direction (1 and 2): Quantity (with +/- spinner),
//     Distance, Direction (One Direction | Symmetric), then hint / OK / Cancel.
//   Circular: Objects, Center Point, Distribution (Full | Angle | Symmetric; Full = 360, Angle row shown for Angle / Symmetric), Suppression,
//     Quantity (with +/- spinner), Angle, then hint / OK / Cancel.
// ON-CANVAS INLINE BOXES (task 662): beside the rectangular drag arrow (#ui/drag-arrow-handle.js) being dragged, focused, or last touched,
// a compact floating Distance + Quantity (spinner) pair bound to the SAME value state as the dialog.
// EDIT (afterwards): double-click / double-tap the pattern's label (svg-renderer draws it): the same dialog on the stored pattern.
// TASK 694 (Fusion: the values are model parameters d<n>): the value boxes (Quantity, Angle, Distance 1 / 2, the inline pair) take what a
// dimension box takes: a number, a formula, a parameter name, `name = value` (it names the value), through the dimension box's own path
// (#core/parameters.js previewDimensionInput on the pattern value, committed by #core/dimension-seams.js applyParameterChange); a box shows its
// formula when one drives it; the refusal (the parser's, the pattern rule's) is the box's message. Spinners, the drag arrows and the
// distribution switches set plain numbers (editPatternValues: the formula is replaced, readers of the name follow). Ctrl/Cmd+Z in a value box
// restores its opening text (task 675 C).
import { TOOL_MODES, CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from '#core/constants.js';
import {
  applyPattern, patternDefaults, patternObjectsOf, patternSlots, patternSlotGeometry, patternHandles,
  patternDistanceFor, patternInstanceOf, patternDirectionPick, patternSourceMiddle, isPatternConstraint,
  PATTERN_UNDO_LABEL,
} from '#core/pattern.js';
import { patternSlot, patternSlotValue, patternSlotChanges, patternValuesIn } from '#core/pattern-values.js';
import { previewDimensionInput, entryExpression, namePatternValues } from '#core/parameters.js';
import { applyParameterChange, dimensionInputLabel, editPatternValues, patternPlanRefusal, refusalReason } from '#core/dimension-seams.js';
import { handleBoxUndoKey } from '#ui/numeric-input-manager.js';
import { inertEntities, isJointInert, activeSketchPick, inActiveSketch } from '#core/sketch-model.js';
import { docUnit, lengthDecimals } from '#core/settings-manager.js';
import { format as formatUnit, parse as parseUnit } from '#core/units.js';
import { screenToWorld, worldToScreen, getZoomFactor } from '#ui/coords.js';
import { snapBoostFor } from '#ui/snap-detection.js';
import { dragArrowSvg, dragArrowHit } from '#ui/drag-arrow-handle.js';
import { createTabbedDockPanel } from '#ui/tabbed-dock-panel.js';
import { showNotification } from '#ui/notification-manager.js';
import { warnOtherSketch } from '#ui/input-handlers/active-sketch-warning.js'; // TASK 660: a press on another sketch's curve warns

const T = CONSTRAINT_TYPES;
const OVERLAY_ID = 'pattern-tool-overlay';
export const PATTERN_DIALOG_CLASS = 'sk-pattern-dialog';
export const PATTERN_INLINE_CLASS = 'sk-pat-inline';
const HINT_MS = 6000;
const GHOST_PICK_PX = 14;
const MIN_DISTANCE_MM = 0.01;
const PHONE_MAX_W = 640;

// The two tools, declared: the constraint type, the dialog title, the step after the objects.
export const PATTERN_KINDS = Object.freeze({
  [TOOL_MODES.CIRCULAR_PATTERN]: { type: T.CIRCULAR_PATTERN, title: 'Circular Pattern', after: 'centre' },
  [TOOL_MODES.RECTANGULAR_PATTERN]: { type: T.RECTANGULAR_PATTERN, title: 'Rectangular Pattern', after: 'values' },
});
const kindOfType = (type) => Object.values(PATTERN_KINDS).find((k) => k.type === type);
const HINTS = {
  objects: 'Select the objects, then press Enter or the check.',
  centre: 'Pick the center point (a point or the origin).',
  dir0: 'Pick a line (or an axis) for direction 1, or press Enter.',
  dir1: 'Pick a line for direction 2, or press Enter when done.',
  values: 'Set the values, then OK (Enter).',
};

const CURSOR_SVG = '<svg class="sk-pat-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2v11l2.8-2.8 2 4.2 1.7-.8-2-4.2H13z" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const INFO_SVG = '<svg class="sk-pat-info-ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="currentColor" fill-opacity="0.45"/><path d="M8 7.2v4.3M8 4.6v1" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>';
const SPIN_UP_SVG = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M2 5L5 1.5L8 5z" fill="currentColor"/></svg>';
const SPIN_DOWN_SVG = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M2 1L5 4.5L8 1z" fill="currentColor"/></svg>';

let _host = { exit: () => {}, canvas: () => null }; // injected by input-manager (setupPatternTool): leave the tool, the canvas svg
let _s = null; // open session: { kind, state, svg, mode, step, values, c, before, stepTaken, dock, els, inline, activeDir, unsubHistory, suppressOn, drag, hover }
let _committing = false;
let _viewListening = false;

/** input-manager wires the tool once: exit() = back to the Select tool (the create command ends on OK / Cancel), canvas() = the Design canvas svg. */
export function setupPatternTool({ exit, canvas }) { _host = { exit, canvas }; }

/** A pattern dialog is open (its canvas picks come first; the check shows). */
export function patternSessionOpen() { return !!_s; }
/** The check sits beside this world point: the centre (circular) or the objects' middle; before the pattern exists, the picked objects' middle. */
export function patternAnchorPoint() {
  if (!_s) return null;
  if (_s.c) return _s.c.type === T.CIRCULAR_PATTERN ? jointPoint(_s.state, _s.c.centre) : patternSourceMiddle(_s.state, _s.c);
  const o = selectionObjects(_s.state), ids = new Set(o.joints);
  for (const id of o.shapes) { const s = _s.state.shapes.find((x) => x.id === id); if (s) s.joints.forEach((j) => ids.add(j)); }
  const ps = [...ids].map((id) => _s.state.joints.get(id)).filter(Boolean);
  return ps.length ? { x: ps.reduce((m, p) => m + p.x, 0) / ps.length, y: ps.reduce((m, p) => m + p.y, 0) / ps.length } : null;
}
/** The check shows while the dialog is open and something is picked (with nothing picked it has nothing to do, and its canvas-corner slot is
 *  where a phone's docked dialog has its close button). */
export function patternDoneOpen() { return !!_s && (!!_s.c || patternAnchorPoint() !== null); }
const jointPoint = (state, id) => { const j = state.joints.get(id); return j ? { x: j.x, y: j.y } : null; };
const doneLabel = () => (_s && _s.step === 'values' ? 'Apply the pattern' : 'Pattern: next step');
export const patternDoneLabel = doneLabel;
// THE pick rule (task 659's shared rule, #core/sketch-model.js): only the ACTIVE sketch's curves and points (and the origin / the axes), never a
// locked / hidden one; anything else is not a pick at all (as empty canvas: no highlight, no message)
const pickRule = (state) => {
  const inert = inertEntities(state);
  return { shape: (shape) => activeSketchPick(state, shape, inert), joint: (hit) => hit.id === ORIGIN_JOINT_ID || (inActiveSketch(state, hit.j) && !isJointInert(inert, hit.id)) };
};

// ---- start / end ---------------------------------------------------------------------------------------------------------------

/** The ribbon's `begin` of each tool: a pre-selection is the objects. */
export const beginCircularPattern = (state) => beginPattern(state, TOOL_MODES.CIRCULAR_PATTERN);
export const beginRectangularPattern = (state) => beginPattern(state, TOOL_MODES.RECTANGULAR_PATTERN);

function beginPattern(state, tool) {
  cancelSession();
  const kind = PATTERN_KINDS[tool];
  // Task 662: Rectangular Pattern's Distribution defaults to Fusion's Extent ('total' in the stored record so saved files stay identical).
  const values = { ...patternDefaults(kind.type, docUnit()), ...(kind.type === T.RECTANGULAR_PATTERN ? { distanceType: 'total' } : {}) };
  _s = { kind, state, svg: _host.canvas(), mode: 'create', step: 'objects', values, c: null, before: state.captureUndoSnapshot(), stepTaken: false,
    suppressOn: false, drag: null, hover: null, activeDir: null, inline: null, pending: {} };
  state.pattern = { step: 'objects' };
  listenHistory();
  openDialog();
  const objects = selectionObjects(state);
  if (objects.shapes.length || objects.joints.length) objectsDone();
  refresh();
}

/** Edit a stored pattern (a double-click / double-tap on its label): the dialog on its values, first relevant value field focused. */
export function editPatternFromLabel(svg, state, c) {
  if (!isPatternConstraint(c)) return false;
  cancelSession();
  const kind = kindOfType(c.type);
  _s = { kind, state, svg, mode: 'edit', step: 'values', values: valuesOf(c), c, before: state.captureUndoSnapshot(), stepTaken: false,
    suppressOn: c.suppressed.length > 0, drag: null, hover: null, activeDir: null, inline: null, pending: {} };
  state.pattern = { step: 'values' };
  listenHistory();
  openDialog();
  refresh();
  const first = _s.els.focusFirst && !_s.els.focusFirst.closest('[hidden]') ? _s.els.focusFirst : _s.els.quantity[0];
  if (first) setTimeout(() => { if (_s && first.isConnected) { first.focus(); first.select(); } }, 0);
  return true;
}
const valuesOf = (c) => (c.type === T.CIRCULAR_PATTERN
  ? { quantity: c.quantity, angle: c.angle, symmetric: c.symmetric, suppressed: c.suppressed.slice(), centre: c.centre }
  : { quantity: c.quantity.slice(), distance: c.distance.slice(), distanceType: c.distanceType, symmetric: c.symmetric.slice(), directions: c.directions.slice(), suppressed: c.suppressed.slice() });

/** Leave the tool (a tool switch, Esc): Cancel. */
export function resetPatternState() { cancelSession(); }

function listenHistory() {
  const st = _s.state;
  // an Undo / Redo ends it (the step it took is what the Undo removed); the create command ends with it
  _s.unsubHistory = typeof st.addHistoryListener === 'function' ? st.addHistoryListener(() => { if (_committing) return; const create = _s && _s.mode === 'create'; endSession(); if (create) _host.exit(); }) : null;
}

// the session ends: the dialog, inline boxes and overlay go (the document is as the caller left it)
function endSession() {
  if (!_s) return;
  const s = _s;
  _s = null;
  if (s.unsubHistory) s.unsubHistory();
  if (s.dock) s.dock.destroy();
  if (s.inline && s.inline.root && s.inline.root.parentNode) s.inline.root.remove();
  if (s.state.pattern) s.state.pattern = null;
  const g = document.getElementById(OVERLAY_ID);
  if (g) g.remove();
}
// the user's Cancel (the button, the window's close, Esc in a field / on the canvas): as resetPatternState, and the create command ends
function userCancel() { const create = _s && _s.mode === 'create'; cancelSession(); if (create) _host.exit(); }
// Cancel: the live pattern goes (its step undone and dropped from the redo stack: nothing changed)
function cancelSession() {
  if (!_s) return;
  const s = _s;
  if (s.stepTaken) {
    _committing = true;
    try { s.state.undo(); if (s.state.redoStack && s.state.redoStack.length) { s.state.redoStack.pop(); s.state._notifyHistory(); } } finally { _committing = false; }
  }
  endSession();
}
/** OK / Enter / the check at the values step: the pattern stays (its one undo step is already taken); the create tool ends (Fusion's command). */
export function commitPattern() {
  if (!_s) return 'none';
  if (_s.step !== 'values') return stepDone();
  if (!_s.c) { showNotification(`${_s.kind.title}: ${_s.kind.type === T.CIRCULAR_PATTERN ? 'pick the center point' : 'select the objects'} first.`, 'warning', HINT_MS); return 'wait'; }
  const bad = _s.els && _s.els.invalid();
  if (bad) { showNotification(`${_s.kind.title}: ${bad}.`, 'warning', HINT_MS); return 'refused'; }
  const { state, mode } = _s;
  endSession();
  state.selectedShapes.clear(); state.selectedJoints.clear();
  if (mode === 'create') _host.exit(); // the command ends (Fusion's), like Mirror
  return mode === 'create' ? 'created' : 'edited';
}

// ---- the steps -----------------------------------------------------------------------------------------------------------------

const selectionObjects = (state) => patternObjectsOf([...state.selectedShapes].filter((id) => !patternInstanceOf(state, id)), [...state.selectedJoints]);

function setStep(step) {
  _s.step = step;
  _s.state.pattern = { step };
  refresh();
}
// Enter / the check before the values step: the objects are done -> the next step; a re-pick step -> back to values (or objects if not yet live)
function stepDone() {
  if (_s.step === 'objects') return objectsDone();
  if (_s.step === 'centre') { showNotification(`${_s.kind.title}: ${HINTS.centre}`, 'info', HINT_MS); return 'wait'; }
  setStep(_s.c ? 'values' : 'objects');
  return 'next';
}
function ensureValuesStep() {
  if (_s && _s.c && _s.step !== 'values') setStep('values');
}
function objectsDone() {
  const objects = selectionObjects(_s.state);
  if (!objects.shapes.length && !objects.joints.length) { showNotification(`${_s.kind.title}: ${HINTS.objects}`, 'info', HINT_MS); return 'wait'; }
  if (_s.c) { liveEdit({ objects }); setStep('values'); return 'next'; }
  if (_s.kind.type === T.CIRCULAR_PATTERN && !_s.values.centre) { setStep('centre'); return 'next'; }
  return create(objects) ? 'next' : 'refused';
}
// make the live pattern (the first change of the session: its undo step is taken here)
function create(objects) {
  const { state, kind } = _s;
  const res = applyPattern(state, kind.type, objects, _s.values);
  if (!res.ok) { showNotification(`${kind.title}: ${res.reason}.`, 'warning', HINT_MS); return false; }
  _s.c = res.constraint;
  takeStep();
  // TASK 694: a formula / name typed into a value box before the pattern existed is given to its value now (its number is already in)
  for (const [slot, text] of Object.entries(_s.pending)) {
    const pv = previewDimensionInput(state, _s.c, text, { unit: docUnit(), slot });
    const r = pv.ok ? applyParameterChange(state, pv.plan, dimensionInputLabel(_s.c, pv), { snapshot: false }) : pv;
    if (!r.ok) showNotification(`${kind.title}: ${pv.ok ? refusalReason(r) : pv.hint}.`, 'warning', HINT_MS);
  }
  _s.pending = {};
  state.selectedShapes.clear(); state.selectedJoints.clear();
  for (const id of res.constraint.sources.shapes) state.selectedShapes.add(id);
  for (const id of objects.joints) state.selectedJoints.add(id);
  setStep('values');
  return true;
}
function takeStep() {
  if (_s.stepTaken) return;
  _committing = true;
  try { _s.state.saveStateForce(PATTERN_UNDO_LABEL[_s.kind.type], _s.before); } finally { _committing = false; }
  _s.stepTaken = true;
}
// a live change of the pattern (a value, a re-pick, a suppression): through #core/dimension-seams.js editPatternValues (a changed value is set
// through the parameter model; #core/pattern.js editPattern is its ONE regenerate path)
function liveEdit(changes) {
  if (!_s.c) {
    for (const slot of Object.keys(patternValuesIn(currentRec(), changes).values)) delete _s.pending[slot]; // a number replaces a typed formula
    Object.assign(_s.values, changes); refresh(); return true;
  }
  const res = editPatternValues(_s.state, _s.c, changes, { unit: docUnit(), label: PATTERN_UNDO_LABEL[_s.kind.type] });
  if (!res.ok) { showNotification(`${_s.kind.title}: ${res.reason}.`, 'warning', HINT_MS); refresh(); return false; }
  Object.assign(_s.values, valuesOf(_s.c));
  takeStep();
  refresh();
  return true;
}

// ---- shared value setters (ONE value state for both dialog and inline boxes) ---------------------------------------------------

function currentRec() { return _s.c || { ..._s.values, type: _s.kind.type }; }

// a spinner step / an arrow key: a whole number (the box's formula, if any, is replaced)
function setQuantityValue(k, n) {
  const min = k == null ? 2 : 1;
  if (n == null || !Number.isInteger(n) || n < min) return false;
  let ok;
  if (k == null) ok = liveEdit({ quantity: n });
  else {
    const quantity = currentRec().quantity.slice();
    quantity[k] = n;
    ok = liveEdit({ quantity });
  }
  if (ok) syncInputs(null, [k == null ? 'quantity' : `quantity${k + 1}`]);
  return ok;
}

function stepQuantity(k, delta) {
  if (!_s) return;
  ensureValuesStep();
  const min = k == null ? 2 : 1;
  const rec = currentRec();
  const cur = k == null ? rec.quantity : rec.quantity[k];
  const next = Math.max(min, cur + delta);
  if (next === cur) return;
  const ok = setQuantityValue(k, next);
  const invalidEl = k == null ? _s.els.quantity[0] : _s.els.quantity[k];
  if (ok) {
    if (invalidEl) invalidEl.setAttribute('aria-invalid', 'false');
    if (_s.inline && _s.activeDir === k) _s.inline.qty.setAttribute('aria-invalid', 'false');
  }
}

// THE text of a value box (task 694): the dimension box's path, previewDimensionInput on the pattern value `slot`, committed by applyParameterChange
// (the session holds the one undo step). Before the pattern exists (a circular pattern's centre not picked yet) the text is planned on the
// pattern as it will be made (its values named as applyPattern will name them): its number goes into the values, a formula / name waits in
// `pending` for create(). The box gets aria-invalid and `_why` (its message) when refused. -> true when applied.
function setSlotText(slot, text, el) {
  const { state } = _s, unit = docUnit();
  let why = null;
  if (!_s.c) {
    const draft = { ...currentRec() };
    namePatternValues(state.constraints, draft, state.parameters);
    const pv = previewDimensionInput({ parameters: state.parameters, constraints: [...state.constraints, draft] }, draft, text, { unit, slot });
    const bad = pv.ok ? patternPlanRefusal(pv.plan) : null;
    why = !pv.ok ? (pv.hint || 'type a value') : bad ? bad.message : null;
    if (!why) {
      Object.assign(_s.values, patternSlotChanges(draft, { [slot]: pv.value }));
      const mine = pv.plan.edits.find((e) => e.c === draft && e.slot === slot);
      if (pv.kind !== 'value' || (mine && mine.expression)) _s.pending[slot] = text; else delete _s.pending[slot];
    }
  } else {
    const pv = previewDimensionInput(state, _s.c, text, { unit, slot });
    const res = pv.ok ? applyParameterChange(state, pv.plan, dimensionInputLabel(_s.c, pv), { snapshot: false }) : null;
    why = !pv.ok ? (pv.hint || 'type a value') : !res.ok ? refusalReason(res) : null;
    if (!why) { Object.assign(_s.values, valuesOf(_s.c)); takeStep(); }
  }
  if (el) { el._why = why; el.setAttribute('aria-invalid', why ? 'true' : 'false'); }
  if (why) return false;
  syncInputs(el, [slot]);
  refresh();
  return true;
}
// what a value box shows: the formula that drives the value (or the one typed before the pattern existed), else its number with its unit
function slotText(slot) {
  const rec = currentRec();
  const ex = _s.c ? entryExpression({ c: _s.c, slot }) : (_s.pending[slot] || null);
  if (ex) return ex;
  const kind = patternSlot(rec, slot).kind, v = patternSlotValue(rec, slot);
  return kind === 'count' ? fmtNum(v) : kind === 'angle' ? fmtAngle(v) : fmtLen(v);
}
// the inline pair's values are those of the active direction
const inlineSlot = (field) => (_s && _s.activeDir != null ? `${field}${_s.activeDir + 1}` : null);
// every value box (the dialog's and the inline pair) shows its value again, but `skipEl` (the box being typed in) and a refused box (its text and
// message stay until it is fixed) unless its value is one of `changed` (a spinner / an arrow drag set it)
function syncInputs(skipEl = null, changed = []) {
  if (!_s || !_s.els) return;
  const boxes = [...(_s.els.quantity || []), ...(_s.els.distance || []), _s.els.angle].filter(Boolean).map((el) => [el, el.dataset.slot]);
  if (_s.inline && _s.activeDir != null) boxes.push([_s.inline.dist, inlineSlot('distance')], [_s.inline.qty, inlineSlot('quantity')]);
  for (const [el, slot] of boxes) {
    if (!el || el === skipEl || !slot || (el.getAttribute('aria-invalid') === 'true' && !changed.includes(slot))) continue;
    el.value = slotText(slot); el._why = null; el.setAttribute('aria-invalid', 'false');
  }
}

// ---- canvas picks ------------------------------------------------------------------------------------------------------------

/**
 * A press on the canvas while a pattern dialog is open (input-manager asks this FIRST, whatever the tool). hitJoint / hitShape = the app's
 * pick under the pointer; otherShape = the curve of another visible, unlocked sketch the press reached when it found nothing in the active
 * sketch (input-manager's task 660 search). Returns true when the press is the dialog's (else the tool / a pan takes it).
 */
export function handlePatternPointerDown(e, svg, state, hitJoint, hitShape, otherShape = null) {
  if (!_s || (e.button !== undefined && e.button !== 0)) return false;
  _s.svg = svg;
  const rule = pickRule(state);
  const shape = !hitJoint && hitShape && hitShape.shape ? hitShape.shape : null;
  // TASK 660: a pick step's press that found no active-sketch pick warns when it reached another sketch's curve (the shared helper; it says
  // nothing for a locked / hidden sketch or an active curve). Under Select (a label edit) the app's pick itself may be that curve, or its point.
  const jointCurve = hitJoint && hitJoint.id !== ORIGIN_JOINT_ID && !rule.joint(hitJoint) ? state.shapes.find((s) => !s.reference && s.joints.includes(hitJoint.id)) : null;
  const other = otherShape || (shape && !shape.reference && !rule.shape(shape) ? shape : null) || jointCurve;
  const warn = (lineOnly = false) => (!!other && (!lineOnly || other.type === 'line') && warnOtherSketch(state, _s.kind.title, other));
  if (_s.step === 'objects') {
    if (hitJoint && hitJoint.id !== ORIGIN_JOINT_ID && rule.joint(hitJoint) && !patternInstanceOf(state, hitJoint.id)) toggle(state.selectedJoints, hitJoint.id);
    else if (shape && !shape.reference && rule.shape(shape) && !patternInstanceOf(state, shape.id)) toggle(state.selectedShapes, shape.id);
    else return warn();
    if (_s.c) { const objects = selectionObjects(state); if (objects.shapes.length || objects.joints.length) liveEdit({ objects }); }
    refresh();
    return true;
  }
  if (_s.step === 'centre') {
    if (!hitJoint || !rule.joint(hitJoint) || patternInstanceOf(state, hitJoint.id)) return warn();
    _s.values.centre = hitJoint.id;
    if (_s.c) { if (liveEdit({ centre: hitJoint.id })) setStep('values'); }
    else create(selectionObjects(state));
    return true;
  }
  if (_s.step === 'dir0' || _s.step === 'dir1') {
    if (!shape || shape.type !== 'line' || (!shape.reference && !rule.shape(shape))) return warn(true); // another sketch's LINE warns (it is not a direction)
    const k = _s.step === 'dir0' ? 0 : 1, dirs = currentRec().directions.slice();
    dirs[k] = patternDirectionPick(k, shape.id);
    if (liveEdit({ directions: dirs })) setStep(k === 0 ? 'dir1' : (_s.c ? 'values' : 'objects'));
    return true;
  }
  // values: an arrow starts a distance drag (and activates that direction's inline boxes); with Suppress on, a copy leaves its instance out and a ghost brings it back
  const arrow = arrowAt(svg, e);
  if (arrow) {
    _s.activeDir = arrow.k;
    _s.drag = { pointerId: e.pointerId, k: arrow.k, along: arrow.along, from: alongOf(svg, e, arrow) };
    renderOverlay();
    return true;
  }
  if (!_s.suppressOn || !_s.c) return false;
  const hit = (hitJoint && patternInstanceOf(state, hitJoint.id)) || (shape && patternInstanceOf(state, shape.id));
  if (hit && hit.c === _s.c) { liveEdit({ suppressed: [..._s.c.suppressed, hit.inst.at.join(',')] }); return true; }
  const ghost = ghostAt(svg, e);
  if (ghost) { liveEdit({ suppressed: _s.c.suppressed.filter((k) => k !== ghost) }); return true; }
  return false;
}
function toggle(set, id) { if (set.has(id)) set.delete(id); else set.add(id); }

export function handlePatternPointerMove(e, svg) {
  if (!_s) return false;
  if (_s.drag) { if (_s.drag.pointerId === e.pointerId) dragTo(svg, e); return true; }
  if (e.pointerType !== 'touch') { const a = arrowAt(svg, e), k = a ? a.k : null; if (k !== _s.hover) { _s.hover = k; renderOverlay(); } }
  return false;
}
export function handlePatternPointerUp(e) {
  if (!_s || !_s.drag || !e || _s.drag.pointerId !== e.pointerId) return false;
  _s.drag = null;
  renderOverlay();
  return true;
}
/** Enter / Esc with the canvas focused while the dialog is open. */
export function handlePatternKeyDown(e) {
  if (!_s) return false;
  if (e.key === 'Escape') { userCancel(); return true; }
  if (e.key === 'Enter') { commitPattern(); return true; }
  return false;
}

// THE place of a direction's arrow (world): past the last instance's objects along the direction, so it never sits on a copy
const ARROW_GAP_PX = 26;
const arrowPoint = (h, px) => ({ x: h.point.x + h.dir.x * (h.extent + ARROW_GAP_PX * px), y: h.point.y + h.dir.y * (h.extent + ARROW_GAP_PX * px) });
// the rectangular arrows (patternHandles): the one under the pointer, or null
function arrowAt(svg, e) {
  if (!_s || !_s.c || _s.c.type !== T.RECTANGULAR_PATTERN || _s.step !== 'values') return null;
  const touch = e.pointerType === 'touch', px = getZoomFactor(svg);
  return patternHandles(_s.state, _s.c).find((h) => dragArrowHit({ x: e.clientX, y: e.clientY }, worldToScreen(svg, arrowPoint(h, px)), touch, snapBoostFor(touch))) || null;
}
// the pointer's distance along a handle's direction (world, from the world origin: only differences are used)
const alongOf = (svg, e, h) => { const w = screenToWorld(svg, e.clientX, e.clientY); return w.x * h.dir.x + w.y * h.dir.y; };
// one drag step: the last instance moves with the pointer along the direction (the travel since the press), the distance follows it (Spacing:
// / (N - 1); Extent: the span)
function dragTo(svg, e) {
  const c = _s.c, k = _s.drag.k, h = patternHandles(_s.state, c).find((x) => x.k === k);
  if (!h) return;
  const along = Math.max(MIN_DISTANCE_MM, _s.drag.along + alongOf(svg, e, h) - _s.drag.from);
  const n = c.quantity[k], spacing = along / h.steps, sign = Math.sign(c.distance[k]) || 1;
  const value = c.distanceType === 'total' ? spacing * (n - 1) : spacing;
  const unit = docUnit(), text = fmtLen(value), v = parseUnit(text, unit);
  if (!(v > 0)) return;
  const dist = c.distance.slice(); dist[k] = sign * v;
  if (liveEdit({ distance: dist })) syncInputs(null, [`distance${k + 1}`]);
}
// the suppressed slot whose dashed ghost is under the pointer (its key), or null
function ghostAt(svg, e) {
  const w = screenToWorld(svg, e.clientX, e.clientY), px = getZoomFactor(svg), reach = GHOST_PICK_PX * px * (e.pointerType === 'touch' ? snapBoostFor(true) : 1);
  for (const slot of patternSlots(_s.c).filter((x) => x.suppressed)) {
    if (patternSlotGeometry(_s.state, _s.c, slot.at).some((g) => distTo(g, w) <= reach)) return slot.key;
  }
  return null;
}
function distTo(g, p) {
  if (g.kind === 'point') return Math.hypot(p.x - g.p.x, p.y - g.p.y);
  if (g.kind === 'line') {
    const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, l2 = dx * dx + dy * dy || 1e-24, t = Math.max(0, Math.min(1, ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / l2));
    return Math.hypot(p.x - g.a.x - t * dx, p.y - g.a.y - t * dy);
  }
  return Math.abs(Math.hypot(p.x - g.c.x, p.y - g.c.y) - g.r); // a circle / an arc's circle (a ghost pick does not need the sweep)
}

// ---- the dialog & inline boxes -----------------------------------------------------------------------------------------------

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.id = 'sk-pattern-dialog-styles';
  s.textContent = `
.${PATTERN_DIALOG_CLASS} { --sk-dock-bg: var(--sk-ribbon-bg, #fff); --sk-dock-text: var(--sk-ribbon-fg, #1f2937); --sk-dock-border: var(--sk-ribbon-sep, #cbd5e1);
  --sk-dock-hover: var(--sk-ribbon-hover, #f0f0f0); box-shadow: 0 10px 30px rgba(0,0,0,0.22); backdrop-filter: none; -webkit-backdrop-filter: none; }
.${PATTERN_DIALOG_CLASS} .sk-dock-tab { opacity: 1; font-weight: 700; cursor: default; }
.${PATTERN_DIALOG_CLASS} .sk-dock-body { padding: 8px 10px 6px; }
.sk-pat-rows { display: flex; flex-direction: column; gap: 5px; }
.sk-pat-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; align-items: center; }
.sk-pat-row[hidden] { display: none; }
.sk-pat-row label { font-size: 12px; white-space: nowrap; }
.sk-pat-ctrl { display: flex; align-items: center; gap: 4px; min-width: 0; }
.sk-pat-ctrl input[type=text], .sk-pat-ctrl select { width: 100%; min-width: 0; box-sizing: border-box; height: 26px; padding: 2px 6px; font: 12px system-ui, sans-serif;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 3px; background: var(--sk-ribbon-menu-bg, #fff); color: inherit; }
.sk-pat-ctrl input[aria-invalid=true] { border-color: #ef4444; outline: 1px solid #ef4444; }
.sk-pat-ctrl input[type=checkbox] { width: 15px; height: 15px; margin: 0; cursor: pointer; accent-color: var(--sk-selection, #3B82F6); }
.sk-pat-pick { display: inline-flex; align-items: center; gap: 5px; height: 26px; min-width: 0; padding: 0 8px; border: 1px solid var(--sk-ribbon-sep, #cbd5e1);
  border-radius: 3px; background: var(--sk-ribbon-menu-bg, #fff); color: inherit; font: 500 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-pat-pick[aria-pressed=true] { border-color: var(--sk-selection, #3B82F6); background: rgba(59, 130, 246, 0.16); }
.sk-pat-ic { width: 13px; height: 13px; flex: 0 0 auto; }
.sk-pat-clear { width: 22px; height: 26px; padding: 0; border: 0; border-radius: 3px; background: transparent; color: inherit; opacity: 0.65;
  font: 14px/1 system-ui, sans-serif; cursor: pointer; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }
.sk-pat-clear:hover { opacity: 1; background: var(--sk-ribbon-hover, rgba(0,0,0,0.06)); }
.sk-pat-clear[hidden] { display: none; }
.sk-pat-spin { display: flex; align-items: stretch; width: 100%; min-width: 0; height: 26px; box-sizing: border-box;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 3px; background: var(--sk-ribbon-menu-bg, #fff); overflow: hidden; }
.sk-pat-spin:has(input[aria-invalid=true]) { border-color: #ef4444; outline: 1px solid #ef4444; }
.sk-pat-spin input[type=text] { border: 0; outline: 0; height: 100%; border-radius: 0; flex: 1 1 auto; min-width: 0; background: transparent; }
.sk-pat-spin input[aria-invalid=true] { border: 0; outline: 0; }
.sk-pat-spin-btns { display: flex; flex-direction: column; width: 18px; flex: 0 0 auto; border-left: 1px solid var(--sk-ribbon-sep, #cbd5e1); }
.sk-pat-spin-up, .sk-pat-spin-down { flex: 1 1 0; padding: 0; margin: 0; border: 0; background: transparent; color: inherit; cursor: pointer;
  display: flex; align-items: center; justify-content: center; opacity: 0.72; }
.sk-pat-spin-up { border-bottom: 1px solid var(--sk-ribbon-sep, #cbd5e1); }
.sk-pat-spin-up:hover, .sk-pat-spin-down:hover { background: var(--sk-ribbon-hover, rgba(0,0,0,0.06)); opacity: 1; }
.sk-pat-spin-up svg, .sk-pat-spin-down svg { width: 8px; height: 5px; display: block; }
.sk-pat-hint { font-size: 11px; opacity: 0.75; min-height: 14px; margin-top: 6px; }
.sk-pat-foot { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.sk-pat-info { margin-right: auto; display: inline-flex; align-items: center; opacity: 0.75; }
.sk-pat-info-ic { width: 15px; height: 15px; display: block; }
.sk-pat-foot button { height: 26px; min-width: 64px; padding: 0 12px; border-radius: 3px; font: 600 12px system-ui, sans-serif; cursor: pointer;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); background: var(--sk-ribbon-menu-bg, #fff); color: inherit; }
.sk-pat-foot .sk-pat-ok { background: var(--sk-selection, #3B82F6); border-color: var(--sk-selection, #3B82F6); color: #fff; }
.${PATTERN_INLINE_CLASS} { position: fixed; z-index: 9000; display: flex; align-items: center; gap: 3px; padding: 3px;
  background: var(--sk-ribbon-menu-bg, #fff); color: var(--sk-ribbon-fg, #1f2937); border: 1px solid var(--sk-ribbon-sep, #cbd5e1);
  border-radius: 4px; box-shadow: 0 3px 10px rgba(0,0,0,0.18); font: 12px system-ui, sans-serif; }
.${PATTERN_INLINE_CLASS}[hidden] { display: none; }
.${PATTERN_INLINE_CLASS} .sk-pat-inline-dist { width: 78px; height: 24px; box-sizing: border-box; padding: 2px 5px; font: 12px system-ui, sans-serif;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 3px; background: transparent; color: inherit; text-align: center; }
.${PATTERN_INLINE_CLASS} .sk-pat-inline-dist[aria-invalid=true] { border-color: #ef4444; outline: 1px solid #ef4444; }
.${PATTERN_INLINE_CLASS} .sk-pat-inline-spin { width: 64px; height: 24px; }
.${PATTERN_INLINE_CLASS} .sk-pat-inline-spin input { padding: 2px 4px; text-align: center; }
@media (max-width: ${PHONE_MAX_W}px) { .sk-pat-hint { display: none; } }
@media (pointer: coarse) {
  .sk-pat-row { grid-template-columns: 96px minmax(0, 1fr); }
  .sk-pat-row label { font-size: 13px; }
  .sk-pat-ctrl input[type=text], .sk-pat-ctrl select, .sk-pat-pick, .sk-pat-spin, .sk-pat-foot button { height: 44px; font-size: 14px; }
  .sk-pat-clear { width: 38px; height: 44px; font-size: 18px; }
  .sk-pat-ctrl input[type=checkbox] { width: 24px; height: 24px; }
  .sk-pat-spin-btns { flex-direction: row; width: auto; }
  .sk-pat-spin-up, .sk-pat-spin-down { width: 34px; height: 100%; flex: 0 0 auto; }
  .sk-pat-spin-up { border-bottom: 0; border-right: 1px solid var(--sk-ribbon-sep, #cbd5e1); }
  .sk-pat-spin-up svg, .sk-pat-spin-down svg { width: 11px; height: 7px; }
  .${PATTERN_DIALOG_CLASS} .sk-dock-tab { min-height: 36px; }
  .${PATTERN_DIALOG_CLASS} .sk-dock-header .sk-dock-close { width: 44px; height: 36px; }
  .${PATTERN_INLINE_CLASS} .sk-pat-inline-dist { width: 92px; height: 44px; font-size: 14px; }
  .${PATTERN_INLINE_CLASS} .sk-pat-inline-spin { width: 114px; height: 44px; }
  .${PATTERN_INLINE_CLASS} .sk-pat-inline-spin input { font-size: 14px; }
}
`;
  document.head.appendChild(s);
}

const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX_W;
// the fields show their unit: a length in the document unit (#core/units.js format, the one unit source: "10mm", "0.5in"), an angle in deg
const fmtLen = (v) => { const u = docUnit(); return formatUnit(v, u, { unit: true, decimals: lengthDecimals(u === 'in' ? 3 : 2) }); };
const fmtAngle = (v) => `${fmtNum(v)} deg`;
const fmtNum = (v) => String(Number(Number(v).toFixed(4)));

function openDialog() {
  injectStyles();
  const { kind } = _s;
  const phone = isPhone();
  const box = (_s.svg && _s.svg.getBoundingClientRect) ? _s.svg.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
  const w = phone ? window.innerWidth : 300;
  const h = kind.type === T.CIRCULAR_PATTERN ? (phone ? 280 : 210) : (phone ? 400 : 340); // first guess: fitHeight measures the rows
  const initial = phone ? { left: 0, top: Math.max(0, Math.round(box.bottom - h)), w, h } : { left: Math.round(box.right - w - 12), top: Math.round(box.top + 12), w, h };
  const dock = createTabbedDockPanel({
    tabs: [{ label: kind.title, render: (body) => buildForm(body) }],
    persistKey: `sk-pattern-dialog-${phone ? 'phone' : 'desktop'}`, open: false, closable: true, title: kind.title, initial,
    onClose: () => userCancel(), // the close button / Esc in the window = Cancel
  });
  dock.el.classList.add(PATTERN_DIALOG_CLASS);
  dock.el.dataset.patternType = kind.type;
  dock.el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return; // the window's own Esc: Cancel
    e.stopPropagation(); // typing here is not a canvas shortcut
    // Enter on the window itself (it takes the focus when it opens; a field / button / list handles its own Enter) = OK / the next step
    if (e.key === 'Enter' && !e.defaultPrevented && !/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); commitPattern(); }
  });
  _s.dock = dock;
  dock.open();
  buildInlineBox();
  fitHeight();
}
// the window as tall as its rows (on desktop); on phones capped to 56% of canvas height (scrollable body) so the preview stays visible above it
function fitHeight() {
  if (!_s || !_s.dock) return;
  const el = _s.dock.el, head = el.querySelector('.sk-dock-header'), body = el.querySelector('.sk-dock-body');
  if (!head || !body) return;
  const raw = Math.ceil(head.offsetHeight + body.scrollHeight + 6);
  const phone = isPhone();
  const box = (_s.svg && _s.svg.getBoundingClientRect) ? _s.svg.getBoundingClientRect() : null;
  const maxH = phone && box && box.height > 0 ? Math.max(240, Math.min(424, Math.round(box.height * 0.56))) : raw;
  const need = Math.min(raw, maxH);
  el.style.height = need + 'px';
  if (phone && box) el.style.top = Math.max(0, Math.round(box.bottom - need)) + 'px';
}

// `reapply` (a value box, task 694): Ctrl/Cmd+Z restores the box's opening text (`_open`) in one step and applies it (task 675 C)
function wireFieldKeys(input, onEnterInvalid, onCommitFormat = null, reapply = null) {
  if (onCommitFormat) input.addEventListener('blur', () => {
    if (_s && input.getAttribute('aria-invalid') !== 'true') onCommitFormat();
  });
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (reapply && handleBoxUndoKey(ev, input, input._open, () => reapply(input.value))) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (input.getAttribute('aria-invalid') !== 'true') {
        if (onCommitFormat) onCommitFormat();
        commitPattern();
      } else showNotification(`${_s.kind.title}: ${onEnterInvalid()}.`, 'warning', HINT_MS);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      userCancel();
    }
  });
}

function createSpinner(fieldName, slot, k, onFocus) {
  const wrap = document.createElement('div');
  wrap.className = 'sk-pat-spin';
  const i = document.createElement('input');
  i.type = 'text'; i.value = slotText(slot); i._open = i.value;
  i.setAttribute('aria-label', fieldName); i.dataset.field = fieldName; i.dataset.slot = slot;
  i.addEventListener('focus', () => { ensureValuesStep(); if (onFocus) onFocus(); });
  i.addEventListener('input', () => setSlotText(slot, i.value, i));
  i.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowUp') { ev.preventDefault(); stepQuantity(k, 1); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); stepQuantity(k, -1); }
  });
  wireFieldKeys(i, () => invalidText(i), null, (text) => setSlotText(slot, text, i));
  const btns = document.createElement('div'); btns.className = 'sk-pat-spin-btns';
  const mkBtn = (dir, cls, svg, lbl) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.dataset.spin = dir; b.dataset.spinFor = fieldName;
    b.setAttribute('aria-label', lbl); b.innerHTML = svg;
    b.addEventListener('click', (ev) => { ev.preventDefault(); stepQuantity(k, dir === 'up' ? 1 : -1); });
    return b;
  };
  btns.append(mkBtn('up', 'sk-pat-spin-up', SPIN_UP_SVG, `Increase ${fieldName}`), mkBtn('down', 'sk-pat-spin-down', SPIN_DOWN_SVG, `Decrease ${fieldName}`));
  wrap.append(i, btns);
  return { wrap, input: i };
}

function buildForm(body) {
  const { kind } = _s;
  const els = { distance: null, quantity: [], focusFirst: null, root: null };
  const rows = document.createElement('div');
  rows.className = 'sk-pat-rows';
  els.root = rows;

  const addRow = (labelText, ...controls) => {
    const row = document.createElement('div');
    row.className = 'sk-pat-row';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    const ctrl = document.createElement('div');
    ctrl.className = 'sk-pat-ctrl';
    ctrl.append(...controls);
    const firstInput = ctrl.querySelector('input, select, button');
    if (firstInput) {
      firstInput.id = firstInput.id || `sk-pat-${Math.random().toString(36).slice(2, 8)}`;
      lbl.htmlFor = firstInput.id;
    }
    row.append(lbl, ctrl);
    rows.appendChild(row);
    return row;
  };
  const makePick = (name, step, onToggle) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sk-pat-pick'; b.dataset.pick = step; b.setAttribute('aria-label', name);
    b.innerHTML = `${CURSOR_SVG}<span class="sk-pat-pick-lbl"></span>`;
    b.addEventListener('click', () => { if (_s) onToggle(); });
    return b;
  };
  const makeClear = (name, onClear) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sk-pat-clear'; b.dataset.clear = name;
    b.setAttribute('aria-label', `Clear ${name}`); b.textContent = '×';
    b.addEventListener('click', () => { if (_s) onClear(); });
    return b;
  };
  const makeSelect = (name, options, value, onChange) => {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', name); sel.dataset.field = name;
    for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    sel.value = value;
    sel.addEventListener('focus', () => ensureValuesStep());
    sel.addEventListener('change', () => { ensureValuesStep(); onChange(sel.value); });
    return sel;
  };
  const makeCheck = (name, on, onChange) => {
    const i = document.createElement('input');
    i.type = 'checkbox'; i.checked = on; i.dataset.field = name; i.setAttribute('aria-label', name);
    i.addEventListener('change', () => onChange(i.checked));
    return i;
  };
  // a value box (task 694): its text goes through setSlotText; leaving it (or Enter) shows its stored text again (the canonical formula / number)
  const makeValueText = (name, slot, onFocus) => {
    const i = document.createElement('input');
    i.type = 'text'; i.value = slotText(slot); i._open = i.value; i.setAttribute('aria-label', name); i.dataset.field = name; i.dataset.slot = slot;
    i.addEventListener('focus', () => { ensureValuesStep(); if (onFocus) onFocus(); });
    i.addEventListener('input', () => setSlotText(slot, i.value, i));
    wireFieldKeys(i, () => invalidText(i), () => { if (_s) i.value = slotText(slot); }, (text) => setSlotText(slot, text, i));
    return i;
  };

  // Objects row (shared by both dialogs)
  els.objects = makePick('Objects', 'objects', () => { if (_s.step === 'objects') stepDone(); else setStep('objects'); });
  els.clearObjects = makeClear('objects', () => {
    _s.state.selectedShapes.clear();
    _s.state.selectedJoints.clear();
    setStep('objects');
  });
  addRow('Objects', els.objects, els.clearObjects);

  if (kind.type === T.CIRCULAR_PATTERN) {
    // Fusion Circular Pattern: Objects / Center Point / Distribution (Full | Angle | Symmetric) / Suppression / Quantity / Angle
    els.centre = makePick('Center Point', 'centre', () => { if (_s.step === 'centre') stepDone(); else setStep('centre'); });
    els.clearCentre = makeClear('centre', () => {
      if (!_s.c) _s.values.centre = null;
      setStep('centre');
    });
    addRow('Center Point', els.centre, els.clearCentre);

    const initDist = _s.values.symmetric ? 'symmetric' : (_s.values.angle > 360 - 1e-9 ? 'full' : 'angle');
    els.distribution = makeSelect('Distribution', [['full', 'Full'], ['angle', 'Angle'], ['symmetric', 'Symmetric']], initDist, (v) => {
      if (v === 'full') liveEdit({ angle: 360, symmetric: false });
      else if (v === 'angle') liveEdit({ symmetric: false });
      else liveEdit({ symmetric: true });
      if (els.angleRow) els.angleRow.hidden = v === 'full';
      if (v !== 'full' && els.angle) { els.angle.value = slotText('angle'); els.angle._why = null; els.angle.setAttribute('aria-invalid', 'false'); }
      fitHeight();
    });
    addRow('Distribution', els.distribution);

    els.suppress = makeCheck('Suppression', _s.suppressOn, (on) => { _s.suppressOn = on; renderOverlay(); refreshForm(); });
    addRow('Suppression', els.suppress);

    const qSpin = createSpinner('Quantity', 'quantity', null);
    els.quantity = [qSpin.input];
    addRow('Quantity', qSpin.wrap);

    const a = makeValueText('Angle', 'angle', null);
    els.angle = a;
    els.angleRow = addRow('Angle', a);
    els.angleRow.hidden = initDist === 'full';
    els.focusFirst = initDist === 'full' ? qSpin.input : a;
  } else {
    // Fusion Rectangular Pattern: Objects / Direction/s / Distribution (Extent | Spacing) / Suppression / Dir 1 (Quantity, Distance, Direction) / Dir 2 (Quantity, Distance, Direction)
    els.dirs = makePick('Direction/s', 'dirs', () => {
      if (_s.step === 'dir0' || _s.step === 'dir1') setStep(_s.c ? 'values' : 'objects');
      else setStep('dir0');
    });
    els.clearDirs = makeClear('directions', () => { liveEdit({ directions: [null, null] }); });
    addRow('Direction/s', els.dirs, els.clearDirs);

    els.distribution = makeSelect('Distribution', [['total', 'Extent'], ['spacing', 'Spacing']], _s.values.distanceType, (v) => {
      const rec = currentRec();
      // switching keeps the copies where they are; a distance a formula drives keeps its formula (task 694), so its copies move
      const distance = [0, 1].map((k) => (_s.c && entryExpression({ c: _s.c, slot: `distance${k + 1}` }) ? rec.distance[k] : patternDistanceFor(rec, k, v)));
      if (liveEdit({ distanceType: v, distance })) syncInputs(null, ['distance1', 'distance2']);
    });
    addRow('Distribution', els.distribution);

    els.suppress = makeCheck('Suppression', _s.suppressOn, (on) => { _s.suppressOn = on; renderOverlay(); refreshForm(); });
    addRow('Suppression', els.suppress);

    els.distance = [];
    els.directionMode = [];
    for (let k = 0; k < 2; k++) {
      const activateDir = () => {
        if (_s && _s.c && _s.c.quantity[k] >= 2) { _s.activeDir = k; renderOverlay(); }
      };
      const qSpin = createSpinner(`Quantity ${k + 1}`, `quantity${k + 1}`, k, activateDir);
      els.quantity.push(qSpin.input);
      addRow('Quantity', qSpin.wrap);

      const d = makeValueText(`Distance ${k + 1}`, `distance${k + 1}`, activateDir);
      els.distance.push(d);
      addRow('Distance', d);

      const dirMode = makeSelect(`Direction ${k + 1}`, [['one', 'One Direction'], ['symmetric', 'Symmetric']], _s.values.symmetric[k] ? 'symmetric' : 'one', (v) => {
        const symmetric = currentRec().symmetric.slice();
        symmetric[k] = v === 'symmetric';
        liveEdit({ symmetric });
      });
      els.directionMode.push(dirMode);
      addRow('Direction', dirMode);
    }
    els.focusFirst = els.distance[0];
  }

  els.hint = document.createElement('div'); els.hint.className = 'sk-pat-hint'; els.hint.setAttribute('aria-live', 'polite');

  const foot = document.createElement('div'); foot.className = 'sk-pat-foot';
  const info = document.createElement('span'); info.className = 'sk-pat-info'; info.innerHTML = INFO_SVG;
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'sk-pat-ok'; ok.textContent = 'OK';
  ok.addEventListener('click', () => commitPattern());
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'sk-pat-cancel'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => userCancel());
  foot.append(info, ok, cancel);
  els.ok = ok;
  els.info = info;
  els.invalid = () => {
    const bad = [...rows.querySelectorAll('input[aria-invalid=true]')].filter((el) => !el.closest('[hidden]'))[0];
    return bad ? invalidText(bad) : null;
  };
  body.append(rows, els.hint, foot);
  _s.els = els;
}

// why a value box is refused (task 694: the message of its last refusal: the parser's or the pattern rule's)
function invalidText(i) {
  return i._why || `${(i.dataset.field || 'the value').toLowerCase()} cannot be used`;
}

// ---- on-canvas inline Distance + Quantity boxes --------------------------------------------------------------------------------

function buildInlineBox() {
  if (!_s || _s.kind.type !== T.RECTANGULAR_PATTERN || typeof document === 'undefined' || !document.body) return;
  const root = document.createElement('div');
  root.className = PATTERN_INLINE_CLASS;
  root.hidden = true;

  const dist = document.createElement('input');
  dist.type = 'text'; dist.className = 'sk-pat-inline-dist';
  dist.setAttribute('aria-label', 'Inline distance'); dist.dataset.inlineField = 'distance';
  // the inline pair: the active direction's value boxes (the same setSlotText); a refusal marks the dialog's box of that value too
  const inlineInput = (el, field) => {
    if (!_s || _s.activeDir == null) return;
    const ok = setSlotText(inlineSlot(field), el.value, el);
    const twin = (_s.els[field] || [])[_s.activeDir];
    if (twin) { twin._why = el._why; twin.setAttribute('aria-invalid', ok ? 'false' : 'true'); }
  };
  dist.addEventListener('input', () => inlineInput(dist, 'distance'));
  wireFieldKeys(dist, () => invalidText(dist), () => { if (_s && _s.activeDir != null) dist.value = slotText(inlineSlot('distance')); },
    () => inlineInput(dist, 'distance'));

  const spinWrap = document.createElement('div');
  spinWrap.className = 'sk-pat-spin sk-pat-inline-spin';
  const qty = document.createElement('input');
  qty.type = 'text'; // no numeric keypad: the box takes a formula / a parameter name too (task 694)
  qty.setAttribute('aria-label', 'Inline quantity'); qty.dataset.inlineField = 'quantity';
  qty.addEventListener('input', () => inlineInput(qty, 'quantity'));
  qty.addEventListener('keydown', (ev) => {
    if (!_s || _s.activeDir == null) return;
    if (ev.key === 'ArrowUp') { ev.preventDefault(); stepQuantity(_s.activeDir, 1); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); stepQuantity(_s.activeDir, -1); }
  });
  wireFieldKeys(qty, () => invalidText(qty), null, () => inlineInput(qty, 'quantity'));

  const btns = document.createElement('div'); btns.className = 'sk-pat-spin-btns';
  const mkSpin = (dir, cls, svg, lbl) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.dataset.inlineSpin = dir; b.setAttribute('aria-label', lbl); b.innerHTML = svg;
    b.addEventListener('click', (ev) => { ev.preventDefault(); if (_s && _s.activeDir != null) stepQuantity(_s.activeDir, dir === 'up' ? 1 : -1); });
    return b;
  };
  btns.append(mkSpin('up', 'sk-pat-spin-up', SPIN_UP_SVG, 'Increase inline quantity'), mkSpin('down', 'sk-pat-spin-down', SPIN_DOWN_SVG, 'Decrease inline quantity'));
  spinWrap.append(qty, btns);

  root.append(dist, spinWrap);
  document.body.appendChild(root);
  _s.inline = { root, dist, qty };
}

function placeInline() {
  if (!_s || !_s.inline) return;
  const { root, dist, qty } = _s.inline;
  if (!_s.c || _s.c.type !== T.RECTANGULAR_PATTERN || _s.step !== 'values' || _s.activeDir == null) {
    root.hidden = true;
    return;
  }
  const k = _s.activeDir;
  const h = patternHandles(_s.state, _s.c).find((x) => x.k === k);
  if (!h) { root.hidden = true; return; }

  root.hidden = false;
  if (root.dataset.dir !== String(k)) { // another direction: the pair's opening texts (Ctrl/Cmd+Z) are this direction's
    root.dataset.dir = String(k);
    dist._open = slotText(inlineSlot('distance')); qty._open = slotText(inlineSlot('quantity'));
  }
  syncInputs(document.activeElement);

  const px = getZoomFactor(_s.svg);
  const ap = worldToScreen(_s.svg, arrowPoint(h, px));
  const r = _s.svg.getBoundingClientRect ? _s.svg.getBoundingClientRect() : null;
  const bw = root.offsetWidth || 160, bh = root.offsetHeight || 32;
  const gap = 18;
  const candidates = [
    [ap.x + gap, ap.y + gap],
    [ap.x + gap, ap.y - gap - bh],
    [ap.x - gap - bw, ap.y + gap],
    [ap.x - gap - bw, ap.y - gap - bh],
  ];
  let best = candidates[0];
  if (r && r.width > 0 && r.height > 0) {
    const pad = 6;
    const dr = _s.dock && _s.dock.el && !_s.dock.el.hidden && _s.dock.el.getBoundingClientRect ? _s.dock.el.getBoundingClientRect() : null;
    const inside = (x, y) => x >= r.left + pad && y >= r.top + pad && x + bw <= r.right - pad && y + bh <= r.bottom - pad;
    const ovArea = (x, y, o) => (!o || o.width <= 0 || o.height <= 0) ? 0 : Math.max(0, Math.min(x + bw, o.right) - Math.max(x, o.left)) * Math.max(0, Math.min(y + bh, o.bottom) - Math.max(y, o.top));
    const clamp = (x, y) => [Math.max(r.left + pad, Math.min(x, r.right - pad - bw)), Math.max(r.top + pad, Math.min(y, r.bottom - pad - bh))];
    const free = candidates.find(([x, y]) => inside(x, y) && ovArea(x, y, dr) === 0);
    if (free) best = free;
    else {
      const clamped = candidates.map(([x, y]) => clamp(x, y));
      best = clamped.reduce((a, b) => (ovArea(b[0], b[1], dr) < ovArea(a[0], a[1], dr) ? b : a));
    }
  }
  root.style.left = `${Math.round(best[0])}px`;
  root.style.top = `${Math.round(best[1])}px`;
}

// the dialog's live texts: the object count, the centre / directions, the pressed re-pick button, the hint
function refreshForm() {
  if (!_s || !_s.els) return;
  const { els, state, kind, step } = _s;
  const c = _s.c, objs = c ? { shapes: c.sources.shapes, joints: [] } : selectionObjects(state);
  const n = c ? c.sources.shapes.length + c.sources.points.filter((p) => !c.sources.shapes.some((id) => { const s = state.shapes.find((x) => x.id === id); return s && s.joints.includes(p); })).length
    : objs.shapes.length + objs.joints.length;
  els.objects.querySelector('.sk-pat-pick-lbl').textContent = n > 0 ? `${n} selected` : 'Select';
  els.objects.setAttribute('aria-pressed', step === 'objects' ? 'true' : 'false');
  els.clearObjects.hidden = n === 0;

  if (kind.type === T.CIRCULAR_PATTERN) {
    const cen = c ? c.centre : _s.values.centre;
    els.centre.querySelector('.sk-pat-pick-lbl').textContent = step === 'centre' ? 'Select' : cen ? (cen === ORIGIN_JOINT_ID ? 'Origin' : 'Point') : 'Select';
    els.centre.setAttribute('aria-pressed', step === 'centre' ? 'true' : 'false');
    els.clearCentre.hidden = !cen;
    if (els.angleRow && els.distribution) els.angleRow.hidden = els.distribution.value === 'full';
  } else {
    const rec = currentRec();
    const customCount = rec.directions.filter((d) => d != null).length;
    const pickingDir = step === 'dir0' || step === 'dir1';
    els.dirs.querySelector('.sk-pat-pick-lbl').textContent = pickingDir ? (step === 'dir0' ? 'Pick dir 1' : 'Pick dir 2') : (customCount > 0 ? `${customCount} selected` : 'Select');
    els.dirs.setAttribute('aria-pressed', pickingDir ? 'true' : 'false');
    els.clearDirs.hidden = customCount === 0;
  }
  const off = c ? c.suppressed.length : 0;
  const hintText = HINTS[step] + (step === 'values' && _s.suppressOn ? ` Tap a copy to leave it out${off ? `, its dashed outline to bring it back (${off} left out)` : ''}.` : '');
  els.hint.textContent = hintText;
  if (els.info) els.info.title = hintText;
}

function refresh() { refreshForm(); renderOverlay(); }

// ---- the overlay -------------------------------------------------------------------------------------------------------------

function ensureViewListener() {
  if (_viewListening) return;
  _viewListening = true;
  document.addEventListener('panzoom:viewportChanged', () => { if (_s) renderOverlay(); });
}

// The ONE overlay renderer: the picked centre (a ring), the suppressed instances' dashed ghosts (Suppress on), the rectangular drag arrows, inline boxes.
function renderOverlay() {
  if (!_s || !_s.svg) return;
  ensureViewListener();
  const { svg, state, c } = _s;
  let g = document.getElementById(OVERLAY_ID);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = OVERLAY_ID;
    g.style.pointerEvents = 'none';
    svg.appendChild(g);
  }
  const px = getZoomFactor(svg);
  let html = '';
  const cen = c ? (c.type === T.CIRCULAR_PATTERN ? c.centre : null) : _s.values.centre;
  const P = cen ? jointPoint(state, cen) : null;
  if (P) html += `<circle class="pattern-centre" cx="${P.x}" cy="${P.y}" r="${7 * px}" fill="none" stroke="#f59e0b" stroke-width="${2.5 * px}" />`;
  if (c && _s.suppressOn) {
    const ghost = `fill="none" stroke="#94a3b8" stroke-width="${1.5 * px}" stroke-dasharray="${4 * px} ${3 * px}"`;
    for (const slot of patternSlots(c).filter((x) => x.suppressed)) {
      for (const geo of patternSlotGeometry(state, c, slot.at)) {
        const a = `class="pattern-ghost" data-slot="${slot.key}" ${ghost}`;
        if (geo.kind === 'line') html += `<line ${a} x1="${geo.a.x}" y1="${geo.a.y}" x2="${geo.b.x}" y2="${geo.b.y}" />`;
        else if (geo.kind === 'circle') html += `<circle ${a} cx="${geo.c.x}" cy="${geo.c.y}" r="${geo.r}" />`;
        else if (geo.kind === 'point') html += `<circle ${a} cx="${geo.p.x}" cy="${geo.p.y}" r="${4 * px}" />`;
        else html += `<circle ${a} cx="${geo.c.x}" cy="${geo.c.y}" r="${geo.r}" stroke-opacity="0.5" />`;
      }
    }
  }
  if (c && c.type === T.RECTANGULAR_PATTERN && _s.step === 'values') {
    for (const h of patternHandles(state, c)) {
      const st = _s.drag && _s.drag.k === h.k ? 'drag' : (_s.hover === h.k ? 'hover' : 'idle');
      html += dragArrowSvg({ point: arrowPoint(h, px), dir: h.dir, scale: 1 / px, state: st, className: `pattern-handle pattern-handle-${h.k}` });
    }
  }
  g.innerHTML = html;
  placeInline();
}
