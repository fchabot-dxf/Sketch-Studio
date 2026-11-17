// packages/ui/input-handlers/offset-tool.js - task 650: the OFFSET tool (Modify group of the shared ribbon), like Fusion's Create > Offset
// (owner ruling: Offset belongs in Modify). Geometry and constraints are #core/offset.js; this module is the pick, the box and the preview.
// Flow: a click / tap on a line, an arc or a circle picks its CONNECTED CHAIN (#core/offset.js offsetChainOf: the curves joined to it end to end;
// a circle alone); the chain lights up and the distance box opens beside it, pre-filled with the remembered distance (document unit), with a
// LIVE preview of the offset on the side of the cursor (a mouse move) or of the last click / tap on the canvas; the other side flips it. Enter
// or the green check (done-button.js, declared in input-manager DONE_ACTIONS) applies it: ONE undo step (recordConstraintStep). Esc cancels:
// no change, no undo step. The tool stays on for the next chain (as Fillet, Trim and Break do; Fusion's Offset command ends after OK).
// A press on another curve picks its chain instead; a press that pans / pinches (the view moved) keeps everything; an Undo / Redo cancels.
// The preview goes through ONE renderer (renderOffsetOverlay). TASK 652: while the box is open the shared drag ARROW (#ui/drag-arrow-handle.js,
// as the fillet's) sits at #core/offset.js offsetHandleAnchor, pointing the way the distance grows; dragging it (mouse or finger, ONE path)
// sets the distance live through the SAME state as typing (_open.d, written into the box). Dragging it across the source FLIPS the side (the
// offset follows the pointer to the other side of the curve); a distance too small to show in the box (< 0.01 mm) is held at 0.01 mm.
// TASK 690: the box takes a SIGNED distance (#core/offset.js parseOffsetDistance): a negative one puts the offset on the OTHER side of the source
// at |value| (offsetSideAndDistance, the core's one negative rule), the same flip the arrow drag makes; 0 is refused. _open.side is the side the
// pointer / the last press picked, _open.d the signed distance in the box: the offset shown and applied is offsetSideAndDistance(side, d), and
// applyOffset gets the pointer's side and the SIGNED value (task 710): the new offset dimension holds the value as typed (-5 shows -5), exactly what editing a dimension to -5 gives.
import { screenToWorld, worldToScreen, getZoomFactor } from '#ui/coords.js';
import { snapBoostFor } from '#ui/snap-detection.js';
import { dragArrowSvg, dragArrowHit } from '#ui/drag-arrow-handle.js';
import {
  offsetChainOf, offsetChainGeometry, offsetSideAt, offsetHandleAnchor, offsetArcSpan, applyOffset, defaultOffsetDistance, parseOffsetDistance,
  offsetSideAndDistance, OFFSET_ZERO_REASON, OFFSET_UNDO_LABEL
} from '#core/offset.js';
import { arcSweepInfo } from '#core/geometry.js';
import { inertEntities, activeSketchPick } from '#core/sketch-model.js';
import { docUnit, lengthDecimals } from '#core/settings-manager.js';
import { format as formatUnit } from '#core/units.js';
import { showNotification } from '#ui/notification-manager.js';
import { warnOtherSketch } from '#ui/input-handlers/active-sketch-warning.js'; // TASK 660
import { ensureNumericInputStyles, handleBoxUndoKey, placeAnchoredBox } from '#ui/numeric-input-manager.js';
import { recordConstraintStep } from '#ui/input-handlers/constraint-tools.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there

const OVERLAY_ID = 'offset-tool-overlay';
export const OFFSET_INPUT_ID = 'offset-distance-input';
const PRESS_SLOP_PX = 6;
const HINT_MS = 6000;
const MIN_DRAG_MM = 0.01;

let currentDistance = null; // WORLD mm; the last distance used (survives tool switches for the session)
let _exit = null;

/** Host callback (task 667): ends the Offset tool (back to Select) after OK. */
export function setupOffsetTool({ exit } = {}) {
  _exit = typeof exit === 'function' ? exit : null;
}
let _distanceUnit = null;   // the document unit the default was seeded for; a unit change re-seeds it
let _open = null;           // { chain, pickId, side, d (signed, task 690), el, svg, state, unsubHistory } while the distance box is open
let _hover = false;         // the pointer is over the arrow (it draws darker)
let _drag = null;           // { pointerId, grab } while the arrow is dragged (grab = arrow point minus pointer, world)
let _press = null;          // a press on the canvas while the box is open: a click / tap sets the side on release, a pan / pinch does not
let _viewListening = false;
let _committing = false;

const decimalsFor = (unit) => lengthDecimals(unit === 'in' ? 3 : 2);
function ensureDistance() {
  const unit = docUnit();
  if (currentDistance == null || _distanceUnit !== unit) { currentDistance = defaultOffsetDistance(unit); _distanceUnit = unit; }
}
const pickRule = (state) => { const inert = inertEntities(state); return (s) => activeSketchPick(state, s, inert); }; // task 577: a locked / hidden sketch is out; task 659: so is every sketch but the active one

/** The distance box is open (the check of the Done layer shows). */
export function offsetInputOpen() { return !!_open; }
/** Where the check sits beside: the anchor of the preview (#core/offset.js offsetHandleAnchor), null when no box is open / no offset. */
export function offsetAnchorPoint() { const a = anchor(); return a ? a.point : null; }
// the offset the box describes: the picked side and the signed distance through the ONE negative rule -> { side, d > 0 }
const shown = () => offsetSideAndDistance(_open.side, _open.d);
const anchor = () => { if (!_open) return null; const o = shown(); return offsetHandleAnchor(_open.state, _open.chain, o.side, o.d); };

/** Leave the tool (a tool switch, Esc): nothing is made. */
export function resetOffsetState() { cancelAll(); }

// ---- pick ----------------------------------------------------------------------------------------------------------------------

/**
 * A press in the Offset tool. hitShape = the app's pick under the pointer in the ACTIVE sketch ({ shape, pt } or null); otherShape = with none, the
 * curve of another visible, unlocked sketch within reach (task 660): the one warning, nothing starts. A press on a curve picks its chain (or, with
 * the box open, another chain); a press elsewhere with the box open is a click that sets the side on release unless the view moves (a pan /
 * pinch). Returns true when the press is the tool's (a pan may still start from a press on empty canvas: false).
 */
export function handleOffsetPointerDown(e, svg, state, hitShape, otherShape = null) {
  if (e.button !== undefined && e.button !== 0) return false;
  ensureDistance();
  if (_open && overArrow(svg, e)) { // the arrow starts a drag, before any pick under it
    const a = anchor(), w = screenToWorld(svg, e.clientX, e.clientY);
    _drag = { pointerId: e.pointerId, grab: { x: a.point.x - w.x, y: a.point.y - w.y } };
    renderOffsetOverlay(); // the arrow draws darker while dragged
    return true;
  }
  const shape = hitShape && hitShape.shape && !hitShape.shape.reference && pickRule(state)(hitShape.shape) ? hitShape.shape : null;
  // a press on the picked chain itself is a side press like one on empty canvas (a finger beside a line reaches the line: its side is the press point's)
  const inChain = shape && _open && _open.chain.pieces.some((p) => p.id === shape.id);
  if (shape && !inChain) return pick(svg, state, shape, screenToWorld(svg, e.clientX, e.clientY));
  if (!shape && warnOtherSketch(state, 'Offset', otherShape)) { if (_open) _press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false }; return true; }
  if (_open) _press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  return false;
}

export function handleOffsetPointerMove(e, svg) {
  if (!_open) return false;
  if (_drag) { if (_drag.pointerId === e.pointerId) dragArrowTo(svg, e); return false; }
  if (_press && _press.pointerId === e.pointerId && Math.hypot(e.clientX - _press.x, e.clientY - _press.y) > PRESS_SLOP_PX) _press.moved = true;
  if (e.pointerType === 'touch') return false; // a finger has no hover: the side follows its taps
  const over = overArrow(svg, e);
  if (over !== _hover) { _hover = over; renderOffsetOverlay(); }
  if (over) return false; // on the arrow the side stays as it is
  setSide(screenToWorld(svg, e.clientX, e.clientY));
  return false;
}

export function handleOffsetPointerUp(e, svg) {
  if (_drag && e && _drag.pointerId === e.pointerId) { // releasing the arrow keeps the box open; Enter (or the check) applies
    _drag = null;
    if (_open) { renderOffsetOverlay(); _open.el.focus(); _open.el.select(); }
    return false;
  }
  if (!_press || !e || _press.pointerId !== e.pointerId) return false;
  const p = _press; _press = null;
  if (!p.moved && _open) setSide(screenToWorld(svg, e.clientX, e.clientY));
  return false;
}

export function handleOffsetKeyDown(e) {
  if (matchesShortcut(e, 'edit.cancel') && _open) { cancelAll(); return true; }
  return false;
}

function pick(svg, state, shape, world) {
  const res = offsetChainOf(state, shape.id, pickRule(state));
  if (!res.ok) { showNotification('Offset: ' + res.reason + '.', 'warning', HINT_MS); return true; }
  openInput(svg, state, res.chain, shape.id, offsetSideAt(state, res.chain, world), world);
  return true;
}

// ---- the drag arrow ------------------------------------------------------------------------------------------------------------

// the arrow is picked within its reach (a 44 px target, x the touch boost for a finger)
function overArrow(svg, e) {
  const a = anchor();
  return !!a && dragArrowHit({ x: e.clientX, y: e.clientY }, worldToScreen(svg, a.point), e.pointerType === 'touch', snapBoostFor(e.pointerType === 'touch'));
}

// one drag step: the signed distance of the grabbed point along the arrow's normal becomes the distance (the arrow's own point is on the
// offset at d, so the new distance is d + the pointer's travel along the normal). Negative = the pointer crossed the source: the side flips.
// The ONE distance state takes it, written into the box in the box's own formatting; no offset at that distance (a collapse): nothing changes.
function dragArrowTo(svg, e) {
  const a = anchor();
  if (!a) return;
  const o = shown(); // the drag starts from the offset shown (a negative box value is already on the other side); it writes a positive distance
  const w = screenToWorld(svg, e.clientX, e.clientY);
  const s = o.d + (w.x + _drag.grab.x - a.point.x) * a.normal.x + (w.y + _drag.grab.y - a.point.y) * a.normal.y;
  const side = s <= -MIN_DRAG_MM ? -o.side : o.side;
  const unit = docUnit();
  const text = formatUnit(Math.max(Math.abs(s), MIN_DRAG_MM), unit, { decimals: decimalsFor(unit) });
  const v = parseOffsetDistance(text, unit);
  if (v == null || !offsetChainGeometry(_open.state, _open.chain, v, side).ok) return;
  _open.el.value = text;
  _open.text = text;
  _open.d = v;
  _open.side = side;
  refresh();
}

function setSide(world) {
  const side = offsetSideAt(_open.state, _open.chain, world);
  if (side === _open.side) return;
  _open.side = side;
  refresh();
}

// ---- the distance box (input BEFORE apply) -----------------------------------------------------------------------------------------

function openInput(svg, state, chain, pickId, side, pickPt) {
  ensureNumericInputStyles();
  removeInput();
  const unit = docUnit();
  const el = document.createElement('input');
  el.id = OFFSET_INPUT_ID;
  el.type = 'text';
  el.className = 'dim-input';
  el.setAttribute('aria-label', 'Offset distance');
  const defaultValue = formatUnit(currentDistance, unit, { decimals: decimalsFor(unit) });
  el.value = defaultValue;
  el.style.position = 'fixed';
  el.style.width = '90px';
  document.body.appendChild(el);
  // an Undo / Redo ends the offset in progress: the chain it was on may be gone
  const unsubHistory = typeof state.addHistoryListener === 'function' ? state.addHistoryListener(() => { if (!_committing) cancelAll(); }) : null;
  _open = { chain, pickId, side, d: currentDistance, text: defaultValue, el, svg, state, pickPt, unsubHistory }; // text: what the box shows as WE wrote it (rounded to the precision); while it is unchanged the box holds _open.d exactly (TASK 724)
  ensureViewListener();
  const applyInputValue = () => {
    if (el.value === _open.text) return refresh(); // not an edit: the exact _open.d stays
    const v = parseOffsetDistance(el.value, docUnit());
    if (v != null) _open.d = v;
    refresh();
  };
  el.addEventListener('input', applyInputValue);
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // typing never reaches the canvas shortcuts (Delete, F, ...)
    if (handleBoxUndoKey(ev, el, defaultValue, applyInputValue)) return;
    if (ev.key === 'Enter') { ev.preventDefault(); commitOffsetInput(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelAll(); }
  });
  refresh();
  // the press that opened the box is still in flight: its pointerup / click would take the focus back to the canvas. Focus now and after it.
  const focusIt = () => { if (_open && _open.el === el) { el.focus(); el.select(); } };
  focusIt();
  window.addEventListener('pointerup', () => setTimeout(focusIt, 0), { once: true, capture: true });
  setTimeout(focusIt, 60);
}

function refresh() {
  renderOffsetOverlay(); // draw the drag arrow first so placeAnchoredBox keeps the box clear of it
  if (!_open) return;
  const { el, svg, state, pickId, pickPt } = _open;
  const a = anchor();
  let world = a && a.point;
  if (!world) {
    const s = state.shapes.find((x) => x.id === pickId);
    const j = s && state.joints.get(s.joints[s.type === 'arc' ? 1 : 0]);
    world = j ? { x: j.x, y: j.y } : null;
  }
  placeAnchoredBox({
    el, svg, world, panAnchor: pickPt || world,
    obstacles: document.querySelector(`#${OVERLAY_ID} .offset-handle`),
  });
}

function ensureViewListener() {
  if (_viewListening) return;
  _viewListening = true;
  document.addEventListener('panzoom:viewportChanged', () => {
    if (_press) _press.moved = true; // a pan / pinch is not a click
    if (_open) refresh();
  });
}

/** Enter / the check: apply the offset with the distance in the box (ONE undo step). The box stays open, with a warning, when it cannot apply. */
export function commitOffsetInput() {
  if (!_open) return;
  const { el, chain, state } = _open;
  const v = el.value === _open.text ? _open.d : parseOffsetDistance(el.value, docUnit()); // an unedited box applies its exact distance, not the rounded text
  if (v == null) { showNotification(`Offset: enter a distance; ${OFFSET_ZERO_REASON}.`, 'warning'); return; }
  const { side, d } = offsetSideAndDistance(_open.side, v);
  const pre = offsetChainGeometry(state, chain, d, side);
  if (!pre.ok) { showNotification('Offset: ' + pre.reason + '.', 'warning', HINT_MS); return; }
  _committing = true;
  let res;
  try { res = recordConstraintStep(state, OFFSET_UNDO_LABEL, () => applyOffset(state, chain, v, _open.side)); } finally { _committing = false; }
  if (!res.ok) { showNotification('Offset: ' + res.reason + '.', 'warning', HINT_MS); return; }
  currentDistance = d; // |v|: the distance USED is the remembered one
  cancelAll();
  showNotification(`Offset applied (${formatUnit(d, docUnit(), { unit: true, decimals: decimalsFor(docUnit()) })})`, 'info');
  if (_exit) _exit();
}

function removeInput() {
  if (_open && _open.unsubHistory) _open.unsubHistory();
  if (_open && _open.el && _open.el.parentNode) _open.el.parentNode.removeChild(_open.el);
  _open = null;
  _press = null;
  _drag = null;
  _hover = false;
}
function cancelAll() { removeInput(); const g = document.getElementById(OVERLAY_ID); if (g) g.remove(); }

// ---- the ONE preview renderer ------------------------------------------------------------------------------------------------------

// The picked chain lit (amber, as the Fillet's picked line), the offset at the box's distance on the current side (dashed blue), or the reason
// there is none (red, at the picked curve).
function renderOffsetOverlay() {
  const { svg, state, chain, pickId } = _open;
  const { side, d } = shown();
  let g = document.getElementById(OVERLAY_ID);
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = OVERLAY_ID;
    g.style.pointerEvents = 'none';
    svg.appendChild(g);
  }
  const px = getZoomFactor(svg); // world units per screen pixel
  const J = (id) => state.joints.get(id);
  const lit = `fill="none" stroke="#f59e0b" stroke-width="${5 * px}" stroke-linecap="round" opacity="0.75"`;
  const ghost = `fill="none" stroke="#38bdf8" stroke-width="${2.5 * px}" stroke-dasharray="${4 * px} ${3 * px}" stroke-linecap="round"`;
  let html = '';
  for (const piece of chain.pieces) {
    const s = state.shapes.find((x) => x.id === piece.id);
    if (!s) continue;
    if (s.type === 'line') { const a = J(s.joints[0]), b = J(s.joints[1]); html += `<line class="offset-chain" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${lit} />`; }
    else if (s.type === 'circle') { const c = J(s.joints[0]); html += `<circle class="offset-chain" cx="${c.x}" cy="${c.y}" r="${s.radius}" ${lit} />`; }
    else {
      const c = J(s.joints[0]), a = J(s.joints[1]), b = J(s.joints[2]), R = Math.hypot(a.x - c.x, a.y - c.y), info = arcSweepInfo(c, a, b, { sweep: s.sweep });
      html += `<path class="offset-chain" d="M ${a.x} ${a.y} A ${R} ${R} 0 ${info.large ? 1 : 0} ${info.dir > 0 ? 1 : 0} ${b.x} ${b.y}" ${lit} />`;
    }
  }
  const geom = offsetChainGeometry(state, chain, d, side);
  if (geom.ok) {
    for (const p of geom.pieces) {
      if (p.kind === 'line') html += `<line class="offset-preview" x1="${p.a.x}" y1="${p.a.y}" x2="${p.b.x}" y2="${p.b.y}" ${ghost} />`;
      else if (p.kind === 'circle') html += `<circle class="offset-preview" cx="${p.c.x}" cy="${p.c.y}" r="${p.r}" ${ghost} />`;
      else html += `<path class="offset-preview" d="M ${p.a.x} ${p.a.y} A ${p.r} ${p.r} 0 ${offsetArcSpan(p) > Math.PI ? 1 : 0} ${p.dir > 0 ? 1 : 0} ${p.b.x} ${p.b.y}" ${ghost} />`;
    }
  } else {
    const s = state.shapes.find((x) => x.id === pickId), j = s && J(s.joints[s.type === 'arc' ? 1 : 0]);
    if (j) html += `<text class="offset-refusal" x="${j.x}" y="${j.y - 12 * px}" fill="#f43f5e" font-size="${11 * px}" font-family="system-ui, sans-serif" text-anchor="middle">${geom.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
  }
  const arrow = anchor();
  if (geom.ok && arrow) html += dragArrowSvg({ point: arrow.point, dir: arrow.normal, scale: 1 / px, state: _drag ? 'drag' : (_hover ? 'hover' : 'idle'), className: 'offset-handle' });
  g.innerHTML = html;
}
