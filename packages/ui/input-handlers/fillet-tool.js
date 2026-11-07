// packages/ui/input-handlers/fillet-tool.js — Corner Fillet Tool
// Live corner hover preview and click-to-fillet application.
// Connects UI input with #core/fillet.js.

import { screenToWorld } from '#ui/coords.js';
import { findCornerAtPoint, calculateFilletGeometry, applyFillet, diagnoseNoFillet, defaultFilletRadius, parseFilletRadius } from '#core/fillet.js';
import { SNAP } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { format as formatUnit } from '#core/units.js';
import { showDimInput } from '#ui/input-handlers/dimension-input.js';
import { showNotification } from '#ui/notification-manager.js';

const OVERLAY_ID = 'fillet-tool-overlay';

let _ctx = null;
let _state = null;
let hoverCorner = null;
let currentRadius = null; // WORLD mm (1 unit = 1 mm); null until first setup. Survives tool switches.
let _radiusUnit = null;    // doc unit the default was seeded for; a unit change re-seeds it
let _lastDimCreated = null; // value the last fillet was created with (possibly geometry-clamped)
let _lastDim = null;     // radius dimension of the most recent fillet; its (edited) value is the next default

// Adopt the value the user typed into the last fillet's inline input as the new default.
function syncLastRadius(state) {
  const c = _lastDim;
  // Only a value the user actually typed counts; a geometry clamp (5 -> 2.8) is not a chosen value.
  if (c && typeof c.value === 'number' && c.value > 0 && Math.abs(c.value - _lastDimCreated) > 1e-9 && (state?.constraints || []).includes(c)) { currentRadius = c.value; _lastDim = null; }
}

const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';
// Radius for display: 2 decimals in mm (2.79), 3 in inches (0.25in / 0.4in), trailing zeros trimmed, unit suffix.
const fmtR = (mm, unit = getDocUnit()) => formatUnit(mm, unit, { unit: true, decimals: unit === 'in' ? 3 : 2 });

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

export function setupFilletTool(ctx, state) {
  _ctx = ctx;
  _state = state;
  hoverCorner = null;
  setCursor('crosshair');

  // Runs on EVERY activation: only seed the default the first time / when the doc unit changes, so the
  // "last value used" survives tool switches for the session.
  const unit = getDocUnit();
  if (currentRadius == null || _radiusUnit !== unit) {
    currentRadius = defaultFilletRadius(unit);
    _radiusUnit = unit;
    _lastDim = null;
    _lastDimCreated = null;
  }
}

export function resetFilletState() {
  hoverCorner = null;
  clearFilletOverlay();
}

export function setFilletRadius(val) {
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    currentRadius = num;
    _lastDim = null; // an explicit set outranks the last fillet's dimension
  }
}

export function getFilletRadius() {
  return currentRadius;
}

export function handleFilletPointerMove(e, ctx, state, viewState) {
  _ctx = ctx;
  _state = state;
  const svg = getSvgElement(ctx);
  if (!svg) return;
  const scale = getScale(svg, viewState);
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const thresh = SNAP.JOINT_PX / scale;

  syncLastRadius(state);
  hoverCorner = findCornerAtPoint(state, world, thresh);
  renderFilletOverlay(svg, hoverCorner, viewState);
}

export function handleFilletPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return false;
  const svg = getSvgElement(ctx);
  if (!svg) return false;
  const scale = getScale(svg, viewState);
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const thresh = SNAP.JOINT_PX / scale;

  syncLastRadius(state);
  if (currentRadius == null) { currentRadius = defaultFilletRadius(getDocUnit()); _radiusUnit = getDocUnit(); }
  const hit = findCornerAtPoint(state, world, thresh);
  if (!hit) {
    const why = diagnoseNoFillet(state, world, thresh);
    if (why) showNotification(why, 'warning');
    return false;
  }
  const pre = calculateFilletGeometry(hit.pA, hit.cornerPt, hit.pB, currentRadius);
  if (!pre.valid) { showNotification(`Can't fillet: ${pre.reason}`, 'warning'); return false; }

  // One history step per fillet, owned here in the tool layer like every other tool (core does not saveState).
  try { state.saveState?.(); } catch (_) {}

  const res = applyFillet(state, hit, currentRadius);
  if (res && res.success) {
    clearFilletOverlay();
    hoverCorner = null;

    if (typeof state.triggerDraw === 'function') state.triggerDraw();
    else if (typeof window.__requestDraw === 'function') window.__requestDraw();

    const unit = getDocUnit();
    const formatted = fmtR(res.radius, unit);
    showNotification(`Fillet applied (R = ${formatted})`, 'info');

    // Land on the radius dimension with the input open, pre-filled with the default / last value.
    // Enter commits (re-solves); Esc keeps the value. The committed value is remembered below.
    if (res.radiusConstraint) {
      try {
        _lastDim = res.radiusConstraint;
        _lastDimCreated = res.radiusConstraint.value;
        showDimInput(svg, state, res.radiusConstraint);
      } catch (_) {}
    }
    return true;
  }
  return false;
}

export function handleFilletPointerUp() {
  /* no drag op */
}

export function handleFilletKeyDown(e, svg, state) {
  if (e.key === 'r' || e.key === 'R') {
    const unit = getDocUnit();
    const input = prompt('Enter Fillet Radius (' + unit + '):', formatUnit(currentRadius, unit, { decimals: unit === 'in' ? 3 : 2 }));
    if (input !== null) {
      const val = parseFilletRadius(input, unit); // world mm; a typed unit suffix overrides the doc unit
      if (val != null) {
        setFilletRadius(val);
        showNotification(`Fillet radius set to ${fmtR(val, unit)}`, 'info');
        if (hoverCorner) {
          const sEl = getSvgElement(_ctx);
          renderFilletOverlay(sEl, hoverCorner, state.view);
        }
      }
    }
    return true;
  }
  return false;
}

function clearFilletOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
}

function renderFilletOverlay(svg, corner, viewState) {
  let g = document.getElementById(OVERLAY_ID);
  if (!corner) {
    if (g) g.remove();
    return;
  }

  if (!svg) return;

  const geom = calculateFilletGeometry(corner.pA, corner.cornerPt, corner.pB, currentRadius);
  if (!geom || !geom.valid) {
    if (g) g.remove();
    return;
  }

  const scale = getScale(svg, viewState);
  const rDot = 4 / scale;
  const strokeW = 2 / scale;

  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = OVERLAY_ID;
    g.style.pointerEvents = 'none';
    svg.appendChild(g);
  }

  // Determine arc path
  const { tA, tB, centerPt, radius } = geom;
  let startAngle = Math.atan2(tA.y - centerPt.y, tA.x - centerPt.x);
  let endAngle = Math.atan2(tB.y - centerPt.y, tB.x - centerPt.x);
  let diff = endAngle - startAngle;
  while (diff <= -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  const sweep = diff > 0 ? 1 : 0;

  const arcD = `M ${tA.x} ${tA.y} A ${radius} ${radius} 0 0 ${sweep} ${tB.x} ${tB.y}`;

  g.innerHTML = `
    <!-- Highlight corner -->
    <circle cx="${corner.cornerPt.x}" cy="${corner.cornerPt.y}" r="${rDot * 1.5}" fill="none" stroke="#38bdf8" stroke-width="${strokeW}" />
    <!-- Preview tangent points -->
    <circle cx="${tA.x}" cy="${tA.y}" r="${rDot}" fill="#38bdf8" />
    <circle cx="${tB.x}" cy="${tB.y}" r="${rDot}" fill="#38bdf8" />
    <!-- Fillet Arc Preview -->
    <path d="${arcD}" fill="none" stroke="#38bdf8" stroke-width="${strokeW * 1.25}" stroke-dasharray="${4 / scale} ${3 / scale}" />
    <!-- Corner tangent lead lines to cut-off corner -->
    <line x1="${tA.x}" y1="${tA.y}" x2="${corner.cornerPt.x}" y2="${corner.cornerPt.y}" stroke="#f43f5e" stroke-width="${strokeW * 0.75}" stroke-dasharray="${2 / scale} ${2 / scale}" opacity="0.7" />
    <line x1="${tB.x}" y1="${tB.y}" x2="${corner.cornerPt.x}" y2="${corner.cornerPt.y}" stroke="#f43f5e" stroke-width="${strokeW * 0.75}" stroke-dasharray="${2 / scale} ${2 / scale}" opacity="0.7" />
    <!-- Radius label -->
    <text x="${centerPt.x}" y="${centerPt.y}" fill="#38bdf8" font-size="${11 / scale}" font-family="system-ui, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle">R ${fmtR(radius)}</text>
  `;
}
