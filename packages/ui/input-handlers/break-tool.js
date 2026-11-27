// packages/ui/input-handlers/break-tool.js — TRACE-1
// Input handler for the Break tool: click on a line or an arc to split it at that point (or at a point already held on it, TASK 1018 R2-05),
// on a circle to split it between the two points around the click (TASK 1018). The split is #core/break.js breakAt's: the hover shows it.

import { screenToWorld } from '#ui/coords.js';
import { breakAt, applyBreak } from '#core/break.js';
import { curveGeom, curveDistance } from '#core/curve-cuts.js';
import { showNotification } from '#ui/notification-manager.js';
import { SNAP, TOOL_MODES } from '#core/constants.js';
import { resolveCanvasSvg, setCanvasCursor } from '#ui/cursor-manager.js';
import { warnOtherSketch } from '#ui/input-handlers/active-sketch-warning.js'; // TASK 660: a press on another sketch's line warns
import { inertEntities, activeSketchPick, otherSketchPick } from '#core/sketch-model.js'; // TASK 577: a locked / hidden sketch is not broken; TASK 659: only the active sketch is

let hover = null;
let _ctx = null;
let _state = null;
const OVERLAY_ID = 'break-tool-overlay';

function getScale(svg, viewState) {
  if (viewState && typeof viewState.scale === 'number') return viewState.scale;
  if (svg && svg.getBoundingClientRect && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0) return rect.width / svg.viewBox.baseVal.width;
  }
  return 1;
}

export function setupBreakTool(ctx, state) {
  _ctx = ctx || _ctx;
  _state = state || _state;
  hover = null;
  if (!_state || _state.currentTool === TOOL_MODES.BREAK) setCanvasCursor(_ctx, 'crosshair');
}

export function resetBreakState() {
  hover = null;
  clearBreakOverlay();
  setCanvasCursor(_ctx, '');
}

export function handleBreakPointerMove(e, ctx, state, viewState) {
  _ctx = ctx || _ctx;
  _state = state || _state;
  const svg = resolveCanvasSvg(ctx);
  if (!svg) return;
  const world = screenToWorld(svg, e.clientX, e.clientY);
  hover = findClosestLine(world, state, svg, viewState);
  renderBreakHover(svg, hover, viewState);
}

export function handleBreakPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return false;
  _ctx = ctx || _ctx;
  _state = state || _state;
  const svg = resolveCanvasSvg(ctx);
  if (!svg) return false;
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const hit = findClosestLine(world, state, svg, viewState);
  if (!hit) {
    const other = findClosestLine(world, state, svg, viewState, (s, inert) => otherSketchPick(state, s, inert));
    return other ? warnOtherSketch(state, 'Break', state.shapes.find((s) => s.id === other.shapeId)) : false; // an active curve wins; only with none in reach, another sketch's curve warns (no undo step)
  }
  if (hit.refusal) { showNotification(hit.refusal, 'warning'); return true; } // a circle with fewer than two points to split at: nothing written, the tool stays

  try { state.saveState?.('break'); } catch (_) {}

  const result = applyBreak(state, hit);
  if (result) {
    clearBreakOverlay();
    hover = null;
    if (typeof state.triggerDraw === 'function') state.triggerDraw();
    else if (typeof window.__requestDraw === 'function') window.__requestDraw();
    return true;
  }
  return false;
}

export function handleBreakPointerUp() {
  /* no drag op */
}

// the break at the nearest line, arc or circle within the pick radius that `include` accepts (#core/break.js breakAt: a held point within the
// joint pick radius is split at), or null
function findClosestLine(worldPt, state, svg, viewState, include = (s, inert) => activeSketchPick(state, s, inert)) {
  const scale = getScale(svg, viewState);
  const thresh = SNAP.LINE_PX / scale;
  let best = null, bestDist = thresh;

  const inert = inertEntities(state);
  for (const shape of (state.shapes || [])) {
    if (!include(shape, inert)) continue;
    const g = curveGeom(state, shape);
    if (!g) continue;
    const d = curveDistance(g, worldPt);
    if (d < bestDist) { bestDist = d; best = shape; }
  }
  return best ? breakAt(state, best.id, worldPt, SNAP.JOINT_PX / scale) : null;
}

function renderBreakHover(svg, hit, viewState) {
  let el = document.getElementById(OVERLAY_ID);
  if (!hit) { el?.remove(); return; }
  if (!svg) return;

  const scale = getScale(svg, viewState);
  const r = 5 / scale;

  if (!el) {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    el.id = OVERLAY_ID;
    el.style.pointerEvents = 'none';
    svg.appendChild(el);
  }

  el.innerHTML = hit.points.map((pt) => `
    <circle cx="${pt.x}" cy="${pt.y}" r="${r}"
            fill="#fbbf24" stroke="#92400e" stroke-width="${1 / scale}" opacity="0.9"/>
    <line x1="${pt.x - r * 1.4}" y1="${pt.y}"
          x2="${pt.x + r * 1.4}" y2="${pt.y}"
          stroke="#92400e" stroke-width="${1.5 / scale}"/>
    <line x1="${pt.x}" y1="${pt.y - r * 1.4}"
          x2="${pt.x}" y2="${pt.y + r * 1.4}"
          stroke="#92400e" stroke-width="${1.5 / scale}"/>
  `).join('');
}

function clearBreakOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}
