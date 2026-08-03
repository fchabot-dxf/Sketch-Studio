// packages/ui/input-handlers/break-tool.js — TRACE-1
// Input handler for the Break tool: click on a line to split it at that point.
// Follows the handler pattern of line-tool.js / bezier-tool.js.
//
// Active cursor: crosshair + snap ring on hover over a line.
// Click: find closest line → compute t → call #core/break.breakShape().

import { screenToWorld }               from '#ui/coords.js';
import { breakShape, lineParamAtPoint } from '#core/break.js';
import { SNAP }                         from '#core/constants.js';

// ── State ──────────────────────────────────────────────────────────────────────
let _ctx   = null;  // input context (canvas svg ref etc.)
let _state = null;  // sketch state

// Current hover: { shapeId, t, pt }
let hover = null;

// ── Setup / teardown ───────────────────────────────────────────────────────────
export function setupBreakTool(ctx, state) {
  _ctx   = ctx;
  _state = state;
  hover  = null;
  setCursor('crosshair');
}

export function resetBreakState() {
  hover = null;
}

// ── Pointer events ─────────────────────────────────────────────────────────────
export function handleBreakPointerMove(e, ctx, state, viewState) {
  const world = screenToWorld(e, viewState);
  hover = findClosestLine(world, state, viewState);
  renderBreakHover(ctx, hover, viewState);
}

export function handleBreakPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return;
  const world = screenToWorld(e, viewState);
  const hit   = findClosestLine(world, state, viewState);
  if (!hit) return;

  try { state.saveState?.(); } catch (_) {}

  const result = breakShape(state, hit.shapeId, hit.t);
  if (result) {
    // Trigger re-draw
    if (typeof state.triggerDraw === 'function') state.triggerDraw();
    else if (typeof window.__requestDraw === 'function') window.__requestDraw();
  }
}

export function handleBreakPointerUp() { /* nothing */ }

// ── Hit detection ──────────────────────────────────────────────────────────────
function findClosestLine(worldPt, state, viewState) {
  const scale  = viewState?.scale ?? 1;
  const thresh = SNAP.LINE_PX / scale;   // world-space proximity threshold
  let best = null, bestDist = thresh;

  for (const shape of (state.shapes || [])) {
    if (shape.type !== 'line') continue;
    const [aId, bId] = shape.joints;
    const jA = state.joints.get(aId);
    const jB = state.joints.get(bId);
    if (!jA || !jB) continue;

    const t   = lineParamAtPoint(jA, jB, worldPt);
    const px  = jA.x + t * (jB.x - jA.x);
    const py  = jA.y + t * (jB.y - jA.y);
    const d   = Math.hypot(worldPt.x - px, worldPt.y - py);

    if (d < bestDist) {
      bestDist = d;
      best = { shapeId: shape.id, t, pt: { x: px, y: py } };
    }
  }
  return best;
}

// ── Visual feedback ────────────────────────────────────────────────────────────
const OVERLAY_ID = 'break-tool-overlay';

function renderBreakHover(ctx, hit, viewState) {
  let el = document.getElementById(OVERLAY_ID);
  if (!hit) { el?.remove(); return; }

  const svg = ctx?.getCanvasSvg?.();
  if (!svg) return;

  const scale = viewState?.scale ?? 1;
  const r     = 5 / scale;

  if (!el) {
    el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    el.id = OVERLAY_ID;
    svg.appendChild(el);
  }

  el.innerHTML = `
    <circle cx="${hit.pt.x}" cy="${hit.pt.y}" r="${r}"
            fill="#fbbf24" stroke="#92400e" stroke-width="${1/scale}" opacity="0.9"/>
    <line x1="${hit.pt.x - r*1.4}" y1="${hit.pt.y}"
          x2="${hit.pt.x + r*1.4}" y2="${hit.pt.y}"
          stroke="#92400e" stroke-width="${1.5/scale}"/>
    <line x1="${hit.pt.x}" y1="${hit.pt.y - r*1.4}"
          x2="${hit.pt.x}" y2="${hit.pt.y + r*1.4}"
          stroke="#92400e" stroke-width="${1.5/scale}"/>
  `;
}

function setCursor(c) {
  try {
    const el = document.querySelector('svg, canvas, .canvas');
    if (el) el.style.cursor = c;
  } catch (_) {}
}
