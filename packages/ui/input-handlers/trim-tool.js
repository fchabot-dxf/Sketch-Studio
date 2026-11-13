// packages/ui/input-handlers/trim-tool.js — TRACE-1
// Input handler for the Trim tool: hover highlights the trimmable segment;
// click removes it between its nearest two intersections.

import { screenToWorld } from '#ui/coords.js';
import { trimShape } from '#core/trim.js';
import { SNAP } from '#core/constants.js';
import { inertEntities, isShapeInert } from '#core/sketch-model.js'; // TASK 577: a locked / hidden sketch is not trimmed

let hover = null; // { shapeId, t, segStart, segEnd } current hover interval
const OVERLAY_ID = 'trim-tool-overlay';

function getSvgElement(ctx) {
  if (ctx && typeof ctx.getCanvasSvg === 'function') return ctx.getCanvasSvg();
  if (ctx && ctx.nodeName === 'svg') return ctx;
  return document.getElementById('svgCanvas') || document.querySelector('svg');
}

function getScale(svg, viewState) {
  if (viewState && typeof viewState.scale === 'number') return viewState.scale;
  if (svg && svg.getBoundingClientRect && svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width > 0) {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0) return rect.width / svg.viewBox.baseVal.width;
  }
  return 1;
}

function setCursor(c) {
  try {
    const el = document.querySelector('svg, canvas, .canvas');
    if (el) el.style.cursor = c;
  } catch (_) {}
}

export function setupTrimTool() {
  hover = null;
  setCursor('crosshair');
}

export function resetTrimState() {
  clearTrimOverlay();
  hover = null;
}

export function handleTrimPointerMove(e, ctx, state, viewState) {
  const svg = getSvgElement(ctx);
  if (!svg) return;
  const world = screenToWorld(svg, e.clientX, e.clientY);
  hover = findTrimInterval(world, state, svg, viewState);
  renderTrimHover(svg, hover, state, viewState);
}

export function handleTrimPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return false;
  const svg = getSvgElement(ctx);
  if (!svg) return false;
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const hit = findTrimInterval(world, state, svg, viewState);
  if (!hit) return false;

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

function findTrimInterval(worldPt, state, svg, viewState) {
  const scale = getScale(svg, viewState);
  const thresh = SNAP.LINE_PX / scale;
  let bestShape = null, bestDist = thresh, bestT = 0;

  const inert = inertEntities(state);
  for (const shape of (state.shapes || [])) {
    if (shape.type !== 'line' || isShapeInert(inert, shape.id)) continue;
    const [aId, bId] = shape.joints;
    const jA = state.joints.get(aId);
    const jB = state.joints.get(bId);
    if (!jA || !jB) continue;

    const t = lineParam(jA, jB, worldPt);
    const px = jA.x + t * (jB.x - jA.x);
    const py = jA.y + t * (jB.y - jA.y);
    const d = Math.hypot(worldPt.x - px, worldPt.y - py);
    if (d < bestDist) { bestDist = d; bestShape = shape; bestT = t; }
  }

  if (!bestShape) return null;

  const [aId, bId] = bestShape.joints;
  const jA = state.joints.get(aId);
  const jB = state.joints.get(bId);

  const tVals = [0, 1];
  for (const other of (state.shapes || [])) {
    if (other.id === bestShape.id || other.type !== 'line') continue;
    const [cId, dId] = other.joints;
    const jC = state.joints.get(cId);
    const jD = state.joints.get(dId);
    if (!jC || !jD) continue;
    const t = segSegParam(jA, jB, jC, jD);
    if (t !== null && t > 1e-6 && t < 1 - 1e-6) tVals.push(t);
  }
  tVals.sort((a, b) => a - b);

  let idx = 0;
  for (let i = 0; i < tVals.length - 1; i++) {
    if (bestT >= tVals[i] && bestT <= tVals[i + 1]) { idx = i; break; }
  }

  const t0 = tVals[idx], t1 = tVals[idx + 1];
  return {
    shapeId: bestShape.id,
    t: bestT,
    segStart: lerpPt(jA, jB, t0),
    segEnd: lerpPt(jA, jB, t1),
  };
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

  const { segStart: s, segEnd: e } = hit;
  el.innerHTML = `
    <line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}"
          stroke="#ef4444" stroke-width="${sw}"
          stroke-dasharray="${da} ${da / 2}" stroke-linecap="round"
          opacity="0.9"/>
  `;
}

function clearTrimOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

function lineParam(jA, jB, p) {
  const dx = jB.x - jA.x, dy = jB.y - jA.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return 0;
  return Math.max(0, Math.min(1, ((p.x - jA.x) * dx + (p.y - jA.y) * dy) / L2));
}

function segSegParam(jA, jB, jC, jD) {
  const dx1 = jB.x - jA.x, dy1 = jB.y - jA.y;
  const dx2 = jD.x - jC.x, dy2 = jD.y - jC.y;
  const den = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(den) < 1e-10) return null;
  const t = ((jC.x - jA.x) * dy2 - (jC.y - jA.y) * dx2) / den;
  const u = ((jC.x - jA.x) * dy1 - (jC.y - jA.y) * dx1) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return Math.max(0, Math.min(1, t));
}

function lerpPt(a, b, t) {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}
