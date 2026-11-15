// packages/ui/input-handlers/pattern-tool.js - task 658: the CIRCULAR PATTERN and RECTANGULAR PATTERN tools (Modify group of the shared ribbon,
// after Mirror; owner ruling: Fusion keeps them under Create). Geometry, rows and the regenerate are #core/pattern.js; this module is the picks,
// the pattern DIALOG, the canvas overlay and the drag arrows. ONE flow for both tools, the differences declared in KINDS below.
//
// FLOW (Fusion's): the OBJECTS (the selection; a pre-selection counts), then circular: the CENTRE point (any joint, the origin) / rectangular: the
// directions are the X / Y axes until a line is picked. As soon as the objects and the centre are known the pattern EXISTS, live, in the
// document (the preview is the real copies, made by #core/pattern.js's one copy path); every value change regenerates it (editPattern). The
// dialog's OK, Enter or the green check applies it: ONE undo step (the step is taken at the first live change, with the snapshot from before
// the tool started). Cancel, Esc, the dialog's close button, a tool switch: the step is undone and dropped (nothing changed, no redo entry).
// THE DIALOG (owner, task 658: "Prob needs a small modal"): the shared tabbed dock panel (#ui/tabbed-dock-panel.js, the Parameters window's
// component) as a small NON-BLOCKING floating window: the canvas stays live (picks, pan, zoom). Desktop: at the canvas's top-right; a phone
// (<= 640 px wide): docked to the BOTTOM of the canvas, full width, as short as its rows. Rows: Objects (count, re-pick), Centre / Direction
// 1 / 2 (re-pick), Quantity / Total angle, or Quantity 1 / Distance 1 / Quantity 2 / Distance 2 + the Distance type (Spacing / Total, Fusion's
// Extent) + Symmetric, Suppress (on: a tap on a copy leaves that instance out, a tap on its dashed ghost brings it back), OK, Cancel.
// RECTANGULAR: the shared drag ARROW (#ui/drag-arrow-handle.js) at the end of each direction drags the distance shown (Spacing or Total).
// EDIT (afterwards): double-click / double-tap the pattern's label (svg-renderer draws it): the same dialog on the stored pattern, its value
// field focused; type, Enter -> applied (one undo step). While the dialog is open the canvas picks of this tool come first (whatever the tool).
import { TOOL_MODES, CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from '#core/constants.js';
import {
  applyPattern, editPattern, patternDefaults, patternObjectsOf, patternSlots, patternSlotGeometry, patternHandles,
  patternDistanceFor, patternInstanceOf, patternDirectionName, patternDirectionPick, patternSourceMiddle, isPatternConstraint, PATTERN_UNDO_LABEL
} from '#core/pattern.js';
import { inertEntities, isJointInert, activeSketchPick, inActiveSketch } from '#core/sketch-model.js';
import { docUnit } from '#core/settings-manager.js';
import { format as formatUnit, parse as parseUnit } from '#core/units.js';
import { screenToWorld, worldToScreen, getZoomFactor } from '#ui/coords.js';
import { snapBoostFor } from '#ui/snap-detection.js';
import { dragArrowSvg, dragArrowHit } from '#ui/drag-arrow-handle.js';
import { createTabbedDockPanel } from '#ui/tabbed-dock-panel.js';
import { showNotification } from '#ui/notification-manager.js';

const T = CONSTRAINT_TYPES;
const OVERLAY_ID = 'pattern-tool-overlay';
export const PATTERN_DIALOG_CLASS = 'sk-pattern-dialog';
const HINT_MS = 6000;
const GHOST_PICK_PX = 14;
const MIN_DISTANCE_MM = 0.01;
const PHONE_MAX_W = 640;

// The two tools, declared: the constraint type, the dialog title, the step after the objects, the value fields.
export const PATTERN_KINDS = Object.freeze({
  [TOOL_MODES.CIRCULAR_PATTERN]: { type: T.CIRCULAR_PATTERN, title: 'Circular Pattern', after: 'centre' },
  [TOOL_MODES.RECTANGULAR_PATTERN]: { type: T.RECTANGULAR_PATTERN, title: 'Rectangular Pattern', after: 'values' },
});
const kindOfType = (type) => Object.values(PATTERN_KINDS).find((k) => k.type === type);
const HINTS = {
  objects: 'Select the objects, then press Enter or the check.',
  centre: 'Pick the centre point (a point or the origin).',
  dir0: 'Pick a line (or an axis) for direction 1.',
  dir1: 'Pick a line (or an axis) for direction 2.',
  values: 'Set the values, then OK (Enter).',
};

let _host = { exit: () => {}, canvas: () => null }; // injected by input-manager (setupPatternTool): leave the tool, the canvas svg
let _s = null; // the open session: { kind, state, svg, mode: 'create' | 'edit', step, values, c, before, stepTaken, dock, els, unsubHistory, suppressOn, drag, hover }
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
  const values = patternDefaults(kind.type, docUnit());
  _s = { kind, state, svg: _host.canvas(), mode: 'create', step: 'objects', values, c: null, before: state.captureUndoSnapshot(), stepTaken: false,
    suppressOn: false, drag: null, hover: null };
  state.pattern = { step: 'objects' };
  listenHistory();
  openDialog();
  const objects = selectionObjects(state);
  if (objects.shapes.length || objects.joints.length) objectsDone();
  refresh();
}

/** Edit a stored pattern (a double-click / double-tap on its label): the dialog on its values, `field` focused (default the first value). */
export function editPatternFromLabel(svg, state, c) {
  if (!isPatternConstraint(c)) return false;
  cancelSession();
  const kind = kindOfType(c.type);
  _s = { kind, state, svg, mode: 'edit', step: 'values', values: valuesOf(c), c, before: state.captureUndoSnapshot(), stepTaken: false,
    suppressOn: c.suppressed.length > 0, drag: null, hover: null };
  state.pattern = { step: 'values' };
  listenHistory();
  openDialog();
  refresh();
  const first = _s.els.focusFirst;
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

// the session ends: the dialog and the overlay go (the document is as the caller left it)
function endSession() {
  if (!_s) return;
  const s = _s;
  _s = null;
  if (s.unsubHistory) s.unsubHistory();
  if (s.dock) s.dock.destroy();
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
  if (!_s.c) { showNotification(`${_s.kind.title}: ${_s.kind.type === T.CIRCULAR_PATTERN ? 'pick the centre point' : 'select the objects'} first.`, 'warning', HINT_MS); return 'wait'; }
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
// Enter / the check before the values step: the objects are done -> the next step; a re-pick step -> back to the values
function stepDone() {
  if (_s.step === 'objects') return objectsDone();
  if (_s.step === 'centre') { showNotification(`${_s.kind.title}: ${HINTS.centre}`, 'info', HINT_MS); return 'wait'; }
  setStep('values');
  return 'next';
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
// a live change of the pattern (a value, a re-pick, a suppression): through #core/pattern.js editPattern (its ONE regenerate path)
function liveEdit(changes) {
  if (!_s.c) { Object.assign(_s.values, changes); refresh(); return true; }
  const res = editPattern(_s.state, _s.c, changes);
  if (!res.ok) { showNotification(`${_s.kind.title}: ${res.reason}.`, 'warning', HINT_MS); refresh(); return false; }
  Object.assign(_s.values, valuesOf(_s.c));
  takeStep();
  refresh();
  return true;
}

// ---- canvas picks ------------------------------------------------------------------------------------------------------------

/**
 * A press on the canvas while a pattern dialog is open (input-manager asks this FIRST, whatever the tool). hitJoint / hitShape = the app's
 * pick under the pointer. Returns true when the press is the dialog's (else the tool / a pan takes it).
 */
export function handlePatternPointerDown(e, svg, state, hitJoint, hitShape) {
  if (!_s || (e.button !== undefined && e.button !== 0)) return false;
  _s.svg = svg;
  const rule = pickRule(state);
  const shape = !hitJoint && hitShape && hitShape.shape ? hitShape.shape : null;
  if (_s.step === 'objects') {
    if (hitJoint && hitJoint.id !== ORIGIN_JOINT_ID && rule.joint(hitJoint) && !patternInstanceOf(state, hitJoint.id)) toggle(state.selectedJoints, hitJoint.id);
    else if (shape && !shape.reference && rule.shape(shape) && !patternInstanceOf(state, shape.id)) toggle(state.selectedShapes, shape.id);
    else return false;
    if (_s.c) { const objects = selectionObjects(state); if (objects.shapes.length || objects.joints.length) liveEdit({ objects }); }
    refresh();
    return true;
  }
  if (_s.step === 'centre') {
    if (!hitJoint || !rule.joint(hitJoint) || patternInstanceOf(state, hitJoint.id)) return false;
    _s.values.centre = hitJoint.id;
    if (_s.c) { if (liveEdit({ centre: hitJoint.id })) setStep('values'); }
    else create(selectionObjects(state));
    return true;
  }
  if (_s.step === 'dir0' || _s.step === 'dir1') {
    if (!shape || shape.type !== 'line' || (!shape.reference && !rule.shape(shape))) return false;
    const k = _s.step === 'dir0' ? 0 : 1, dirs = _s.values.directions.slice();
    dirs[k] = patternDirectionPick(k, shape.id);
    if (liveEdit({ directions: dirs })) setStep('values');
    return true;
  }
  // values: an arrow starts a distance drag; with Suppress on, a copy leaves its instance out and a ghost brings it back
  const arrow = arrowAt(svg, e);
  if (arrow) { _s.drag = { pointerId: e.pointerId, k: arrow.k, along: arrow.along, from: alongOf(svg, e, arrow) }; renderOverlay(); return true; }
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
// / (N - 1); Total: the span)
function dragTo(svg, e) {
  const c = _s.c, k = _s.drag.k, h = patternHandles(_s.state, c).find((x) => x.k === k);
  if (!h) return;
  const along = Math.max(MIN_DISTANCE_MM, _s.drag.along + alongOf(svg, e, h) - _s.drag.from);
  const n = c.quantity[k], spacing = along / (n - 1), sign = Math.sign(c.distance[k]) || 1;
  const value = c.distanceType === 'total' ? spacing * (n - 1) * (c.symmetric[k] ? 2 : 1) : spacing;
  const unit = docUnit(), text = formatUnit(value, unit, { decimals: unit === 'in' ? 3 : 2 }), v = parseUnit(text, unit);
  if (!(v > 0)) return;
  const dist = c.distance.slice(); dist[k] = sign * v;
  if (liveEdit({ distance: dist }) && _s.els.distance) _s.els.distance[k].value = text;
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

// ---- the dialog --------------------------------------------------------------------------------------------------------------

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
.${PATTERN_DIALOG_CLASS} .sk-dock-body { padding: 6px 8px; }
.sk-pat-grid { display: grid; gap: 4px 6px; align-items: center; }
.sk-pat-grid.sk-pat-circular { grid-template-columns: auto 1fr auto 1fr; }
.sk-pat-grid.sk-pat-rect { grid-template-columns: minmax(0, 1.3fr) 1fr 1fr auto; }
.sk-pat-grid.sk-pat-rect .sk-pat-type { grid-column: 2 / 4; }
.sk-pat-head { font-size: 10px; opacity: 0.7; text-align: left; }
.sk-pat-grid label { font-size: 11px; white-space: nowrap; }
.sk-pat-grid input[type=text], .sk-pat-grid select { width: 100%; min-width: 0; box-sizing: border-box; height: 26px; padding: 2px 6px; font: 12px system-ui, sans-serif;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 4px; background: var(--sk-ribbon-menu-bg, #fff); color: inherit; }
.sk-pat-grid input[aria-invalid=true] { border-color: #ef4444; outline: 1px solid #ef4444; }
.sk-pat-pick { height: 26px; min-width: 0; padding: 0 8px; border: 1px solid var(--sk-ribbon-sep, #cbd5e1); border-radius: 4px; background: transparent; color: inherit;
  font: 600 11px system-ui, sans-serif; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-pat-pick[aria-pressed=true] { background: var(--sk-selection, #3B82F6); border-color: var(--sk-selection, #3B82F6); color: #fff; }
.sk-pat-check { display: flex; align-items: center; gap: 4px; font-size: 11px; white-space: nowrap; }
.sk-pat-hint { font-size: 11px; opacity: 0.75; min-height: 14px; margin-top: 4px; }
.sk-pat-foot { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 4px; }
.sk-pat-foot-checks { display: flex; gap: 10px; margin-right: auto; }
.sk-pat-foot button { height: 28px; min-width: 64px; padding: 0 12px; border-radius: 4px; font: 700 12px system-ui, sans-serif; cursor: pointer;
  border: 1px solid var(--sk-ribbon-sep, #cbd5e1); background: transparent; color: inherit; }
.sk-pat-foot .sk-pat-ok { background: var(--sk-selection, #3B82F6); border-color: var(--sk-selection, #3B82F6); color: #fff; }
@media (max-width: ${PHONE_MAX_W}px) { .sk-pat-hint { display: none; } }
@media (pointer: coarse) {
  .sk-pat-grid input[type=text], .sk-pat-grid select, .sk-pat-pick, .sk-pat-foot button { height: 44px; font-size: 14px; }
  .sk-pat-check input { width: 22px; height: 22px; }
  .sk-pat-grid label, .sk-pat-check { font-size: 13px; }
  .sk-pat-head { font-size: 12px; }
  .${PATTERN_DIALOG_CLASS} .sk-dock-tab { min-height: 36px; }
  .${PATTERN_DIALOG_CLASS} .sk-dock-header .sk-dock-close { width: 44px; height: 36px; }
}
`;
  document.head.appendChild(s);
}

const isPhone = () => typeof window !== 'undefined' && window.innerWidth <= PHONE_MAX_W;
const fmtLen = (v) => { const u = docUnit(); return formatUnit(v, u, { decimals: u === 'in' ? 3 : 2 }); };
const fmtNum = (v) => String(Number(Number(v).toFixed(4)));
function parseAngle(text) { const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(deg|°)?\s*$/i.exec(String(text)); return m ? parseFloat(m[1]) : null; }
function parseCount(text) { const m = /^\s*(\d+)\s*$/.exec(String(text)); return m ? parseInt(m[1], 10) : null; }

function openDialog() {
  injectStyles();
  const { kind } = _s;
  const phone = isPhone();
  const box = (_s.svg && _s.svg.getBoundingClientRect) ? _s.svg.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth };
  const w = phone ? window.innerWidth : 300;
  const h = kind.type === T.CIRCULAR_PATTERN ? (phone ? 210 : 150) : (phone ? 280 : 190); // a first guess: fitHeight measures the rows
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
  fitHeight();
}
// the window as tall as its rows (the dock keeps a fixed height): measured once it is on screen
function fitHeight() {
  const el = _s.dock.el, head = el.querySelector('.sk-dock-header'), body = el.querySelector('.sk-dock-body');
  if (!head || !body) return;
  const need = Math.ceil(head.offsetHeight + body.scrollHeight + 2);
  el.style.height = need + 'px';
  if (isPhone() && _s.svg && _s.svg.getBoundingClientRect) el.style.top = Math.max(0, Math.round(_s.svg.getBoundingClientRect().bottom - need)) + 'px';
}

function buildForm(body) {
  const { kind } = _s;
  const els = { distance: null, quantity: [], focusFirst: null };
  const grid = document.createElement('div');
  grid.className = 'sk-pat-grid';
  const label = (text, forEl) => { const l = document.createElement('label'); l.textContent = text; if (forEl) { forEl.id = forEl.id || `sk-pat-${Math.random().toString(36).slice(2, 8)}`; l.htmlFor = forEl.id; } return l; };
  const pick = (name, step) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sk-pat-pick'; b.dataset.pick = step; b.setAttribute('aria-label', name);
    b.addEventListener('click', () => { if (!_s) return; if (_s.step === step) stepDone(); else setStep(step); });
    return b;
  };
  const text = (name, value, onValue) => {
    const i = document.createElement('input');
    i.type = 'text'; i.value = value; i.setAttribute('aria-label', name); i.dataset.field = name;
    i.addEventListener('input', () => { const ok = onValue(i.value); i.setAttribute('aria-invalid', ok ? 'false' : 'true'); });
    i.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); if (i.getAttribute('aria-invalid') !== 'true') commitPattern(); else showNotification(`${kind.title}: ${invalidText(i)}.`, 'warning', HINT_MS); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); userCancel(); }
    });
    return i;
  };
  const check = (name, on, onChange, visible = true) => {
    const l = document.createElement('label'); l.className = 'sk-pat-check';
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = on; i.dataset.field = name;
    if (!visible) i.setAttribute('aria-label', name);
    i.addEventListener('change', () => onChange(i.checked));
    l.append(i);
    if (visible) l.append(document.createTextNode(name));
    return l;
  };
  const foot = document.createElement('div'); foot.className = 'sk-pat-foot';
  const footChecks = document.createElement('div'); footChecks.className = 'sk-pat-foot-checks';
  foot.append(footChecks);
  els.objects = pick('Objects', 'objects');
  if (kind.type === T.CIRCULAR_PATTERN) {
    // [Objects] [Centre] / Quantity, Total angle / footer: Symmetric, Suppress, OK, Cancel
    grid.classList.add('sk-pat-circular');
    els.centre = pick('Centre point', 'centre');
    const q = text('Quantity', fmtNum(_s.values.quantity), (v) => { const n = parseCount(v); return n != null && n >= 2 && liveEdit({ quantity: n }); });
    const a = text('Total angle', fmtNum(_s.values.angle), (v) => { const n = parseAngle(v); return n != null && n > 0 && n <= 360 && liveEdit({ angle: n }); });
    els.quantity = [q]; els.angle = a; els.focusFirst = a;
    grid.append(label('Objects'), els.objects, label('Centre'), els.centre, label('Quantity', q), q, label('Total angle', a), a);
    els.symmetric = check('Symmetric', _s.values.symmetric, (on) => liveEdit({ symmetric: on }));
    footChecks.append(els.symmetric);
  } else {
    // a table: [Direction] Quantity | Distance | Sym. per direction; [Objects] [Spacing / Total]; footer: Suppress, OK, Cancel
    grid.classList.add('sk-pat-rect');
    const head = (t) => { const h = document.createElement('span'); h.className = 'sk-pat-head'; h.textContent = t; return h; };
    grid.append(document.createElement('span'), head('Quantity'), head('Distance'), head('Sym.'));
    els.dirs = []; els.distance = []; els.sym = [];
    for (let k = 0; k < 2; k++) {
      const dir = pick(`Direction ${k + 1}`, `dir${k}`);
      els.dirs.push(dir);
      const q = text(`Quantity ${k + 1}`, fmtNum(_s.values.quantity[k]), (v) => {
        const n = parseCount(v); if (n == null || n < 1) return false;
        const quantity = (_s.c ? _s.c.quantity : _s.values.quantity).slice(); quantity[k] = n; return liveEdit({ quantity });
      });
      const d = text(`Distance ${k + 1}`, fmtLen(Math.abs(_s.values.distance[k])), (v) => {
        const n = parseUnit(v, docUnit()); if (!(n > 0)) return false;
        const cur = _s.c ? _s.c.distance : _s.values.distance, distance = cur.slice(); distance[k] = (Math.sign(cur[k]) || 1) * n; return liveEdit({ distance });
      });
      els.quantity.push(q); els.distance.push(d);
      const sym = check(`Symmetric ${k + 1}`, _s.values.symmetric[k], (on) => { const symmetric = (_s.c ? _s.c.symmetric : _s.values.symmetric).slice(); symmetric[k] = on; liveEdit({ symmetric }); }, false);
      els.sym.push(sym);
      grid.append(dir, q, d, sym);
    }
    const type = document.createElement('select');
    type.setAttribute('aria-label', 'Distance type'); type.dataset.field = 'Distance type';
    for (const [v, t] of [['spacing', 'Spacing'], ['total', 'Total']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; type.appendChild(o); }
    type.value = _s.values.distanceType;
    type.addEventListener('change', () => {
      const c = _s.c || { ..._s.values, type: kind.type };
      const distance = [0, 1].map((k) => patternDistanceFor(c, k, type.value)); // switching keeps the copies where they are
      if (liveEdit({ distanceType: type.value, distance })) distance.forEach((dd, k) => { els.distance[k].value = fmtLen(Math.abs(dd)); });
    });
    type.className = 'sk-pat-type';
    els.type = type;
    grid.append(els.objects, type);
    els.focusFirst = els.distance[0];
  }
  els.suppress = check('Suppress', _s.suppressOn, (on) => { _s.suppressOn = on; renderOverlay(); refreshForm(); });
  footChecks.append(els.suppress);
  els.hint = document.createElement('div'); els.hint.className = 'sk-pat-hint'; els.hint.setAttribute('aria-live', 'polite');
  const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'sk-pat-ok'; ok.textContent = 'OK';
  ok.addEventListener('click', () => commitPattern());
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'sk-pat-cancel'; cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => userCancel());
  foot.append(ok, cancel);
  els.ok = ok;
  els.invalid = () => { const bad = [...grid.querySelectorAll('input[aria-invalid=true]')][0]; return bad ? invalidText(bad) : null; };
  body.append(grid, els.hint, foot);
  _s.els = els;
}
function invalidText(i) {
  const f = i.dataset.field || 'the value';
  if (/^Quantity/.test(f)) return `${f.toLowerCase()} must be a whole number of ${f === 'Quantity' ? 2 : 1} or more`;
  if (f === 'Total angle') return 'the total angle must be more than 0 and at most 360 degrees';
  return `${f.toLowerCase()} must be a number greater than 0`;
}

// the dialog's live texts: the object count, the centre / directions, the pressed re-pick button, the hint
function refreshForm() {
  if (!_s || !_s.els) return;
  const { els, state, kind, step } = _s;
  const c = _s.c, objs = c ? { shapes: c.sources.shapes, joints: [] } : selectionObjects(state);
  const n = c ? c.sources.shapes.length + c.sources.points.filter((p) => !c.sources.shapes.some((id) => { const s = state.shapes.find((x) => x.id === id); return s && s.joints.includes(p); })).length
    : objs.shapes.length + objs.joints.length;
  els.objects.textContent = step === 'objects' ? `${n} selected - done` : `${n} selected`;
  els.objects.setAttribute('aria-pressed', step === 'objects' ? 'true' : 'false');
  if (kind.type === T.CIRCULAR_PATTERN) {
    const cen = c ? c.centre : _s.values.centre;
    els.centre.textContent = step === 'centre' ? 'Pick a point' : cen ? (cen === ORIGIN_JOINT_ID ? 'Origin' : 'Point') : 'Pick';
    els.centre.setAttribute('aria-pressed', step === 'centre' ? 'true' : 'false');
  } else {
    const rec = c || { ..._s.values };
    els.dirs.forEach((b, k) => { b.textContent = step === `dir${k}` ? 'Pick a line' : `${k + 1}: ${patternDirectionName(rec, k)}`; b.setAttribute('aria-pressed', step === `dir${k}` ? 'true' : 'false'); });
  }
  const off = c ? c.suppressed.length : 0;
  els.hint.textContent = HINTS[step] + (step === 'values' && _s.suppressOn ? ` Tap a copy to leave it out${off ? `, its dashed outline to bring it back (${off} left out)` : ''}.` : '');
}

function refresh() { refreshForm(); renderOverlay(); }

// ---- the overlay -------------------------------------------------------------------------------------------------------------

function ensureViewListener() {
  if (_viewListening) return;
  _viewListening = true;
  document.addEventListener('panzoom:viewportChanged', () => { if (_s) renderOverlay(); });
}

// The ONE overlay renderer: the picked centre (a ring), the suppressed instances' dashed ghosts (Suppress on), the rectangular drag arrows.
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
}
