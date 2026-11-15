// packages/ui/input-handlers/break-tool.js — TRACE-1
// Input handler for the Break tool: click on a line to split it at that point.

import { screenToWorld } from '#ui/coords.js';
import { breakShape, lineParamAtPoint } from '#core/break.js';
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
    return other ? warnOtherSketch(state, 'Break', state.shapes.find((s) => s.id === other.shapeId)) : false; // an active line wins; only with none in reach, another sketch's line warns (no undo step)
  }

  try { state.saveState?.('break'); } catch (_) {}

  const result = breakShape(state, hit.shapeId, hit.t);
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

function findClosestLine(worldPt, state, svg, viewState, include = (s, inert) => activeSketchPick(state, s, inert)) {
  const scale = getScale(svg, viewState);
  const thresh = SNAP.LINE_PX / scale;
  let best = null, bestDist = thresh;

  const inert = inertEntities(state);
  for (const shape of (state.shapes || [])) {
    if (shape.type !== 'line' || !include(shape, inert)) continue;
    const [aId, bId] = shape.joints;
    const jA = state.joints.get(aId);
    const jB = state.joints.get(bId);
    if (!jA || !jB) continue;

    const t = lineParamAtPoint(jA, jB, worldPt);
    const px = jA.x + t * (jB.x - jA.x);
    const py = jA.y + t * (jB.y - jA.y);
    const d = Math.hypot(worldPt.x - px, worldPt.y - py);

    if (d < bestDist) {
      bestDist = d;
      best = { shapeId: shape.id, t, pt: { x: px, y: py } };
    }
  }
  return best;
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

  el.innerHTML = `
    <circle cx="${hit.pt.x}" cy="${hit.pt.y}" r="${r}"
            fill="#fbbf24" stroke="#92400e" stroke-width="${1 / scale}" opacity="0.9"/>
    <line x1="${hit.pt.x - r * 1.4}" y1="${hit.pt.y}"
          x2="${hit.pt.x + r * 1.4}" y2="${hit.pt.y}"
          stroke="#92400e" stroke-width="${1.5 / scale}"/>
    <line x1="${hit.pt.x}" y1="${hit.pt.y - r * 1.4}"
          x2="${hit.pt.x}" y2="${hit.pt.y + r * 1.4}"
          stroke="#92400e" stroke-width="${1.5 / scale}"/>
  `;
}

function clearBreakOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}
