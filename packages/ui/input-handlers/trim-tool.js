// packages/ui/input-handlers/trim-tool.js — TRACE-1
// Input handler for the Trim tool: hover highlights the trimmable piece of a line, an arc or a circle (TASK 1018);
// click removes it between its nearest two cuts. The piece is #core/trim.js trimPreview's: the same one the click removes.

import { screenToWorld } from '#ui/coords.js';
import { trimShape, trimPreview } from '#core/trim.js';
import { curveGeom, curveDistance } from '#core/curve-cuts.js';
import { SNAP, TOOL_MODES } from '#core/constants.js';
import { resolveCanvasSvg, setCanvasCursor } from '#ui/cursor-manager.js';
import { warnOtherSketch } from '#ui/input-handlers/active-sketch-warning.js'; // TASK 660: a press on another sketch's line warns
import { inertEntities, activeSketchPick, otherSketchPick } from '#core/sketch-model.js'; // TASK 577: a locked / hidden sketch is not trimmed; TASK 659: only the active sketch is (the shared pick rule), its curves alone cut

let hover = null; // { shapeId, piece } current hover piece (#core/curve-cuts.js curvePiece)
let _ctx = null;
let _state = null;
const OVERLAY_ID = 'trim-tool-overlay';

function getScale(svg, viewState) {
  if (viewState && typeof viewState.scale === 'number') return viewState.scale;
  if (svg && svg.getBoundingClientRect && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0) return rect.width / svg.viewBox.baseVal.width;
  }
  return 1;
}

export function setupTrimTool(ctx, state) {
  _ctx = ctx || _ctx;
  _state = state || _state;
  hover = null;
  if (!_state || _state.currentTool === TOOL_MODES.TRIM) setCanvasCursor(_ctx, 'crosshair');
}

export function resetTrimState() {
  clearTrimOverlay();
  hover = null;
  setCanvasCursor(_ctx, '');
}

export function handleTrimPointerMove(e, ctx, state, viewState) {
  _ctx = ctx || _ctx;
  _state = state || _state;
  const svg = resolveCanvasSvg(ctx);
  if (!svg) return;
  const world = screenToWorld(svg, e.clientX, e.clientY);
  hover = findTrimInterval(world, state, svg, viewState);
  renderTrimHover(svg, hover, state, viewState);
}

export function handleTrimPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return false;
  _ctx = ctx || _ctx;
  _state = state || _state;
  const svg = resolveCanvasSvg(ctx);
  if (!svg) return false;
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const hit = findTrimInterval(world, state, svg, viewState);
  if (!hit) {
    const scale = getScale(svg, viewState);
    const other = nearestCurve(world, state, SNAP.LINE_PX / scale, (s, inert) => otherSketchPick(state, s, inert));
    return other ? warnOtherSketch(state, 'Trim', other) : false; // an active curve wins; only with none in reach, another sketch's curve warns (no undo step)
  }

  try { state.saveState?.('trim'); } catch (_) {}

  const result = trimShape(state, hit.shapeId, world);
  if (result) {
    clearTrimOverlay();
    hover = null;
    if (typeof state.triggerDraw === 'function') state.triggerDraw();
    else if (typeof window.__requestDraw === 'function') window.__requestDraw();
    return true;
  }
  return false;
}

export function handleTrimPointerUp() {
  /* no drag op */
}

// the nearest line, arc or circle within `thresh` that `include(shape, inert)` accepts, or null (the pick rule is searched, never applied after)
function nearestCurve(worldPt, state, thresh, include) {
  let best = null, bestDist = thresh;
  const inert = inertEntities(state);
  for (const shape of (state.shapes || [])) {
    if (!include(shape, inert)) continue;
    const g = curveGeom(state, shape);
    if (!g) continue;
    const d = curveDistance(g, worldPt);
    if (d < bestDist) { bestDist = d; best = shape; }
  }
  return best;
}

function findTrimInterval(worldPt, state, svg, viewState) {
  const scale = getScale(svg, viewState);
  const near = nearestCurve(worldPt, state, SNAP.LINE_PX / scale, (s, inert) => activeSketchPick(state, s, inert));
  if (!near) return null;
  const piece = trimPreview(state, near.id, worldPt);
  return piece ? { shapeId: near.id, piece } : null;
}

// the SVG markup of a piece (a line, an arc from `from` to `to` turning `dir`, a whole circle)
function pieceMarkup(p, attrs) {
  if (p.kind === 'line') return `<line x1="${p.a.x}" y1="${p.a.y}" x2="${p.b.x}" y2="${p.b.y}" ${attrs}/>`;
  if (p.kind === 'circle') return `<circle cx="${p.c.x}" cy="${p.c.y}" r="${p.r}" fill="none" ${attrs}/>`;
  return `<path d="M ${p.from.x} ${p.from.y} A ${p.r} ${p.r} 0 ${p.large ? 1 : 0} ${p.dir > 0 ? 1 : 0} ${p.to.x} ${p.to.y}" fill="none" ${attrs}/>`;
}

function renderTrimHover(svg, hit, state, viewState) {
  let el = document.getElementById(OVERLAY_ID);
  if (!hit) { el?.remove(); return; }
  if (!svg) return;

  const scale = getScale(svg, viewState);
  const sw = 3 / scale;
  const da = 8 / scale;

  if (!el) {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    el.id = OVERLAY_ID;
    el.style.pointerEvents = 'none';
    svg.appendChild(el);
  }

  el.innerHTML = pieceMarkup(hit.piece, `stroke="#ef4444" stroke-width="${sw}" stroke-dasharray="${da} ${da / 2}" stroke-linecap="round" opacity="0.9"`);
}

function clearTrimOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}
