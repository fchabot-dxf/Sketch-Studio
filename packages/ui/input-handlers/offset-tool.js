// packages/ui/input-handlers/offset-tool.js - task 650: the OFFSET tool (Modify group of the shared ribbon), like Fusion's Create > Offset
// (owner ruling: Offset belongs in Modify). Geometry and constraints are #core/offset.js; this module is the pick, the box and the preview.
// Flow: a click / tap on a line, an arc or a circle picks its CONNECTED CHAIN (#core/offset.js offsetChainOf: the curves joined to it end to end;
// a circle alone); the chain lights up and the distance box opens beside it, pre-filled with the remembered distance (document unit), with a
// LIVE preview of the offset on the side of the cursor (a mouse move) or of the last click / tap on the canvas; the other side flips it. Enter
// or the green check (done-button.js, declared in input-manager DONE_ACTIONS) applies it: ONE undo step (recordConstraintStep). Esc cancels:
// no change, no undo step. The tool stays on for the next chain (as Fillet, Trim and Break do; Fusion's Offset command ends after OK).
// A press on another curve picks its chain instead; a press that pans / pinches (the view moved) keeps everything; an Undo / Redo cancels.
// The preview goes through ONE renderer (renderOffsetOverlay). The drag handle of a later task anchors at #core/offset.js offsetHandleAnchor
// (the box sits beside that anchor already).
import { screenToWorld, worldToScreen, getZoomFactor } from '#ui/coords.js';
import {
  offsetChainOf, offsetChainGeometry, offsetSideAt, offsetHandleAnchor, offsetArcSpan, applyOffset, defaultOffsetDistance, parseOffsetDistance,
  OFFSET_UNDO_LABEL
} from '#core/offset.js';
import { arcSweepInfo } from '#core/geometry.js';
import { inertEntities, isShapeInert } from '#core/sketch-model.js';
import { docUnit } from '#core/settings-manager.js';
import { format as formatUnit } from '#core/units.js';
import { showNotification } from '#ui/notification-manager.js';
import { ensureNumericInputStyles } from '#ui/numeric-input-manager.js';
import { recordConstraintStep } from '#ui/input-handlers/constraint-tools.js';

const OVERLAY_ID = 'offset-tool-overlay';
export const OFFSET_INPUT_ID = 'offset-distance-input';
const PRESS_SLOP_PX = 6;
const HINT_MS = 6000;
export const OFFSET_HINT = 'Offset: click a line, an arc or a circle (its connected chain is taken), choose the side, type the distance, then Enter (the check on touch).';

let currentDistance = null; // WORLD mm; the last distance used (survives tool switches for the session)
let _distanceUnit = null;   // the document unit the default was seeded for; a unit change re-seeds it
let _open = null;           // { chain, pickId, side, d, el, svg, state, unsubHistory } while the distance box is open
let _press = null;          // a press on the canvas while the box is open: a click / tap sets the side on release, a pan / pinch does not
let _viewListening = false;
let _committing = false;

const decimalsFor = (unit) => (unit === 'in' ? 3 : 2);
function ensureDistance() {
  const unit = docUnit();
  if (currentDistance == null || _distanceUnit !== unit) { currentDistance = defaultOffsetDistance(unit); _distanceUnit = unit; }
}
const pickRule = (state) => { const inert = inertEntities(state); return (s) => !isShapeInert(inert, s.id); }; // task 577: a locked / hidden sketch is out

/** The ribbon's Offset button (begin): the step is announced. */
export function beginOffset() { ensureDistance(); showNotification(OFFSET_HINT, 'info', HINT_MS); }

/** The distance box is open (the check of the Done layer shows). */
export function offsetInputOpen() { return !!_open; }
/** Where the check sits beside: the anchor of the preview (#core/offset.js offsetHandleAnchor), null when no box is open / no offset. */
export function offsetAnchorPoint() { const a = anchor(); return a ? a.point : null; }
const anchor = () => (_open ? offsetHandleAnchor(_open.state, _open.chain, _open.side, _open.d) : null);

/** Leave the tool (a tool switch, Esc): nothing is made. */
export function resetOffsetState() { cancelAll(); }

// ---- pick ----------------------------------------------------------------------------------------------------------------------

/**
 * A press in the Offset tool. hitShape = the app's pick under the pointer ({ shape, pt } or null). A press on a curve picks its chain (or, with
 * the box open, another chain); a press elsewhere with the box open is a click that sets the side on release unless the view moves (a pan /
 * pinch). Returns true when the press is the tool's (a pan may still start from a press on empty canvas: false).
 */
export function handleOffsetPointerDown(e, svg, state, hitShape) {
  if (e.button !== undefined && e.button !== 0) return false;
  ensureDistance();
  const shape = hitShape && hitShape.shape && !hitShape.shape.reference && pickRule(state)(hitShape.shape) ? hitShape.shape : null;
  if (shape && _open && _open.chain.pieces.some((p) => p.id === shape.id)) return true; // the picked chain itself: no side there, nothing changes
  if (shape) return pick(svg, state, shape, screenToWorld(svg, e.clientX, e.clientY));
  if (_open) _press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  return false;
}

export function handleOffsetPointerMove(e, svg) {
  if (!_open) return false;
  if (_press && _press.pointerId === e.pointerId && Math.hypot(e.clientX - _press.x, e.clientY - _press.y) > PRESS_SLOP_PX) _press.moved = true;
  if (e.pointerType === 'touch') return false; // a finger has no hover: the side follows its taps
  setSide(screenToWorld(svg, e.clientX, e.clientY));
  return false;
}

export function handleOffsetPointerUp(e, svg) {
  if (!_press || !e || _press.pointerId !== e.pointerId) return false;
  const p = _press; _press = null;
  if (!p.moved && _open) setSide(screenToWorld(svg, e.clientX, e.clientY));
  return false;
}

export function handleOffsetKeyDown(e) {
  if (e.key === 'Escape' && _open) { cancelAll(); return true; }
  return false;
}

function pick(svg, state, shape, world) {
  const res = offsetChainOf(state, shape.id, pickRule(state));
  if (!res.ok) { showNotification('Offset: ' + res.reason + '.', 'warning', HINT_MS); return true; }
  openInput(svg, state, res.chain, shape.id, offsetSideAt(state, res.chain, world));
  return true;
}

function setSide(world) {
  const side = offsetSideAt(_open.state, _open.chain, world);
  if (side === _open.side) return;
  _open.side = side;
  refresh();
}

// ---- the distance box (input BEFORE apply) -----------------------------------------------------------------------------------------

function openInput(svg, state, chain, pickId, side) {
  ensureNumericInputStyles();
  removeInput();
  const unit = docUnit();
  const el = document.createElement('input');
  el.id = OFFSET_INPUT_ID;
  el.type = 'text';
  el.className = 'dim-input';
  el.setAttribute('aria-label', 'Offset distance');
  el.value = formatUnit(currentDistance, unit, { decimals: decimalsFor(unit) });
  el.style.position = 'fixed';
  el.style.width = '90px';
  document.body.appendChild(el);
  // an Undo / Redo ends the offset in progress: the chain it was on may be gone
  const unsubHistory = typeof state.addHistoryListener === 'function' ? state.addHistoryListener(() => { if (!_committing) cancelAll(); }) : null;
  _open = { chain, pickId, side, d: currentDistance, el, svg, state, unsubHistory };
  ensureViewListener();
  el.addEventListener('input', () => {
    const v = parseOffsetDistance(el.value, docUnit());
    if (v != null) _open.d = v;
    refresh();
  });
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // typing never reaches the canvas shortcuts (Delete, F, ...)
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

// the box sits beside the preview's anchor (below-right), wherever the view has moved it; beside the picked curve while there is no offset
function placeInput() {
  const { el, svg, state, pickId } = _open;
  const a = anchor();
  let w = a && a.point;
  if (!w) { const s = state.shapes.find((x) => x.id === pickId); const j = s && state.joints.get(s.joints[s.type === 'arc' ? 1 : 0]); w = j ? { x: j.x, y: j.y } : null; }
  if (!w) return;
  const q = worldToScreen(svg, w);
  el.style.left = `${Math.round(q.x + 14)}px`;
  el.style.top = `${Math.round(q.y + 14)}px`;
}

function refresh() { placeInput(); renderOffsetOverlay(); }

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
  const { el, chain, side, state } = _open;
  const d = parseOffsetDistance(el.value, docUnit());
  if (d == null) { showNotification('Offset: enter a distance greater than zero.', 'warning'); return; }
  const pre = offsetChainGeometry(state, chain, d, side);
  if (!pre.ok) { showNotification('Offset: ' + pre.reason + '.', 'warning', HINT_MS); return; }
  _committing = true;
  let res;
  try { res = recordConstraintStep(state, OFFSET_UNDO_LABEL, () => applyOffset(state, chain, d, side)); } finally { _committing = false; }
  if (!res.ok) { showNotification('Offset: ' + res.reason + '.', 'warning', HINT_MS); return; }
  currentDistance = d; // the distance USED is the remembered one
  cancelAll();
  showNotification(`Offset applied (${formatUnit(d, docUnit(), { unit: true, decimals: decimalsFor(docUnit()) })})`, 'info');
}

function removeInput() {
  if (_open && _open.unsubHistory) _open.unsubHistory();
  if (_open && _open.el && _open.el.parentNode) _open.el.parentNode.removeChild(_open.el);
  _open = null;
  _press = null;
}
function cancelAll() { removeInput(); const g = document.getElementById(OVERLAY_ID); if (g) g.remove(); }

// ---- the ONE preview renderer ------------------------------------------------------------------------------------------------------

// The picked chain lit (amber, as the Fillet's picked line), the offset at the box's distance on the current side (dashed blue), or the reason
// there is none (red, at the picked curve).
function renderOffsetOverlay() {
  const { svg, state, chain, side, d, pickId } = _open;
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
  g.innerHTML = html;
}
