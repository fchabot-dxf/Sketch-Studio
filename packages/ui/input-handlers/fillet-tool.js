// packages/ui/input-handlers/fillet-tool.js — Corner Fillet Tool (Fusion-style pick)
// Flow: click line 1 (it highlights) -> click line 2 -> an inline radius input opens, pre-filled with the
// remembered radius, with a LIVE PREVIEW of the arc as you type. Enter applies (with the driving radius
// dimension); Esc cancels and leaves no change and no undo step. Clicking directly on a corner is a shortcut
// into the SAME input-first flow (one behaviour, not two).
// Preview at every step goes through ONE renderer, renderFilletOverlay: corner hover, line-2 hover, typing.
// Connects UI input with #core/fillet.js.

import { screenToWorld } from '#ui/coords.js';
import {
  findCornerAtPoint, findLineAtPoint, findCornerBetweenLines, calculateFilletGeometry, applyFillet,
  diagnoseNoFillet, defaultFilletRadius, parseFilletRadius
} from '#core/fillet.js';
import { SNAP } from '#core/constants.js';
import SettingsManager from '#core/settings-manager.js';
import { format as formatUnit } from '#core/units.js';
import { showNotification } from '#ui/notification-manager.js';

const OVERLAY_ID = 'fillet-tool-overlay';
const INPUT_ID = 'fillet-radius-input';

let _ctx = null;
let _state = null;
let hoverCorner = null;
let currentRadius = null; // WORLD mm (1 unit = 1 mm); null until first setup. Survives tool switches.
let _radiusUnit = null;   // doc unit the default was seeded for; a unit change re-seeds it
let _pick = null;         // { line1 } once the first line is picked
let _input = null;        // { el, corner, radius } while the radius input is open

const getDocUnit = () => SettingsManager.get('DOC_UNIT') || 'mm';
const decimalsFor = (unit) => (unit === 'in' ? 3 : 2);
// Radius for display: 2 decimals in mm (2.79), 3 in inches (0.25in / 0.4in), trailing zeros trimmed, unit suffix.
const fmtR = (mm, unit = getDocUnit()) => formatUnit(mm, unit, { unit: true, decimals: decimalsFor(unit) });

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

function ensureRadius() {
  if (currentRadius == null) { currentRadius = defaultFilletRadius(getDocUnit()); _radiusUnit = getDocUnit(); }
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
  }
}

export function resetFilletState() {
  hoverCorner = null;
  cancelAll();
}

export function setFilletRadius(val) {
  const num = Number(val);
  if (!isNaN(num) && num > 0) currentRadius = num;
}

export function getFilletRadius() {
  return currentRadius;
}

// ---- pick / hover -------------------------------------------------------------------------------------------

export function handleFilletPointerMove(e, ctx, state, viewState) {
  _ctx = ctx;
  _state = state;
  if (_input) return; // the overlay follows the typed value while the input is open
  const svg = getSvgElement(ctx);
  if (!svg) return;
  ensureRadius();
  const scale = getScale(svg, viewState);
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const thresh = SNAP.JOINT_PX / scale;

  if (_pick) {
    // line 1 is picked: preview the arc for the candidate line 2 under the cursor
    const line2 = findLineAtPoint(state, world, thresh);
    hoverCorner = line2 ? findCornerBetweenLines(state, _pick.line1, line2) : null;
    renderFilletOverlay(svg, hoverCorner, viewState, { highlight: [_pick.line1] });
    return;
  }
  hoverCorner = findCornerAtPoint(state, world, thresh);
  renderFilletOverlay(svg, hoverCorner, viewState);
}

export function handleFilletPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return false;
  const svg = getSvgElement(ctx);
  if (!svg) return false;
  _ctx = ctx;
  _state = state;
  ensureRadius();
  if (_input) cancelInput(); // a canvas click while the input is open abandons it, then acts as a fresh click
  const scale = getScale(svg, viewState);
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const thresh = SNAP.JOINT_PX / scale;

  if (_pick) {
    const line2 = findLineAtPoint(state, world, thresh);
    if (!line2) return true; // clicked empty space: keep waiting for line 2 (Esc cancels)
    if (line2.id === _pick.line1.id) { cancelAll(); return true; } // click line 1 again: un-pick
    const corner = findCornerBetweenLines(state, _pick.line1, line2);
    if (!corner) { showNotification('Lines must meet at a corner to fillet', 'warning'); return true; }
    openInput(svg, state, viewState, corner);
    return true;
  }

  // shortcut: a click on a corner opens the same input-first flow directly
  const hit = findCornerAtPoint(state, world, thresh);
  if (hit) { openInput(svg, state, viewState, hit); return true; }

  const line1 = findLineAtPoint(state, world, thresh);
  if (line1) {
    _pick = { line1 };
    renderFilletOverlay(svg, null, viewState, { highlight: [line1] });
    return true;
  }
  const why = diagnoseNoFillet(state, world, thresh);
  if (why) showNotification(why, 'warning');
  return false;
}

export function handleFilletPointerUp() {
  /* no drag op */
}

export function handleFilletKeyDown(e, svg, state) {
  if (e.key === 'Escape' && (_pick || _input)) { cancelAll(); return true; }
  if (e.key === 'r' || e.key === 'R') {
    const unit = getDocUnit();
    const input = prompt('Enter Fillet Radius (' + unit + '):', formatUnit(currentRadius, unit, { decimals: decimalsFor(unit) }));
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

// ---- radius input (input BEFORE apply) ------------------------------------------------------------------------

function openInput(svg, state, viewState, corner) {
  cancelInput();
  _pick = null;
  hoverCorner = null;
  const unit = getDocUnit();
  const el = document.createElement('input');
  el.id = INPUT_ID;
  el.type = 'text';
  el.className = 'dim-input';
  el.setAttribute('aria-label', 'Fillet radius');
  el.value = formatUnit(currentRadius, unit, { decimals: decimalsFor(unit) });
  el.style.position = 'fixed';
  try {
    const ctm = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    pt.x = corner.cornerPt.x; pt.y = corner.cornerPt.y;
    const q = pt.matrixTransform(ctm);
    el.style.left = `${Math.round(q.x + 14)}px`;
    el.style.top = `${Math.round(q.y + 14)}px`;
  } catch (_) { el.style.left = '40%'; el.style.top = '40%'; }
  el.style.width = '90px';
  document.body.appendChild(el);
  _input = { el, corner, radius: currentRadius, svg, state, viewState };

  const preview = () => {
    const v = parseFilletRadius(el.value, getDocUnit());
    if (v != null) _input.radius = v;
    renderFilletOverlay(svg, corner, viewState, { radius: _input.radius });
  };
  el.addEventListener('input', preview);
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // typing must never reach the canvas shortcuts (Delete, F, R, ...)
    if (ev.key === 'Enter') { ev.preventDefault(); commitInput(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelAll(); }
  });
  preview();
  // The click that opened the input is still in flight: its pointerup/click would take focus back to the canvas.
  // Focus now AND again once that gesture has finished.
  const focusIt = () => { if (_input && _input.el === el) { try { el.focus(); el.select(); } catch (_) {} } };
  focusIt();
  window.addEventListener('pointerup', () => setTimeout(focusIt, 0), { once: true, capture: true });
  setTimeout(focusIt, 60);
}

function commitInput() {
  if (!_input) return;
  const { el, corner, state, svg } = _input;
  const unit = getDocUnit();
  const val = parseFilletRadius(el.value, unit);
  if (val == null) { showNotification('Enter a radius greater than zero', 'warning'); return; }
  const pre = calculateFilletGeometry(corner.pA, corner.cornerPt, corner.pB, val);
  if (!pre.valid) { showNotification(`Can't fillet: ${pre.reason}`, 'warning'); return; } // input stays open

  // One history step per fillet, owned here in the tool layer like every other tool (core does not saveState).
  try { state.saveState?.(); } catch (_) {}
  const res = applyFillet(state, corner, val);
  if (!res || !res.success) { showNotification(`Can't fillet: ${(res && res.reason) || 'unknown'}`, 'warning'); return; }

  currentRadius = val; // the value USED becomes the remembered default
  removeInput();
  clearFilletOverlay();
  if (typeof state.triggerDraw === 'function') state.triggerDraw();
  else if (typeof window.__requestDraw === 'function') window.__requestDraw();
  showNotification(`Fillet applied (R = ${fmtR(res.radius, unit)})`, 'info');
}

function removeInput() {
  if (_input && _input.el && _input.el.parentNode) _input.el.parentNode.removeChild(_input.el);
  _input = null;
}

function cancelInput() { removeInput(); clearFilletOverlay(); }

function cancelAll() {
  removeInput();
  _pick = null;
  clearFilletOverlay();
}

// ---- the ONE preview renderer ---------------------------------------------------------------------------------

function clearFilletOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
}

/**
 * Draw the fillet preview. opts.radius overrides the remembered radius (live typing); opts.highlight is a list of
 * line shapes to highlight (the picked first line). With no corner and nothing to highlight, clears the overlay.
 */
function renderFilletOverlay(svg, corner, viewState, opts = {}) {
  let g = document.getElementById(OVERLAY_ID);
  const highlight = opts.highlight || [];
  if (!corner && highlight.length === 0) {
    if (g) g.remove();
    return;
  }
  if (!svg) return;

  const scale = getScale(svg, viewState);
  const rDot = 4 / scale;
  const strokeW = 2 / scale;

  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = OVERLAY_ID;
    g.style.pointerEvents = 'none';
    svg.appendChild(g);
  }

  let html = '';
  const joints = (_state && _state.joints) || null;
  for (const ln of highlight) {
    const a = joints && joints.get(ln.joints[0]), b = joints && joints.get(ln.joints[1]);
    if (a && b) html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#f59e0b" stroke-width="${strokeW * 2.5}" stroke-linecap="round" opacity="0.75" />`;
  }

  if (corner) {
    const radiusReq = (typeof opts.radius === 'number') ? opts.radius : currentRadius;
    const geom = calculateFilletGeometry(corner.pA, corner.cornerPt, corner.pB, radiusReq);
    if (geom && geom.valid) {
      const { tA, tB, centerPt, radius } = geom;
      let diff = Math.atan2(tB.y - centerPt.y, tB.x - centerPt.x) - Math.atan2(tA.y - centerPt.y, tA.x - centerPt.x);
      while (diff <= -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      const sweep = diff > 0 ? 1 : 0;
      const arcD = `M ${tA.x} ${tA.y} A ${radius} ${radius} 0 0 ${sweep} ${tB.x} ${tB.y}`;
      html += `
    <circle cx="${corner.cornerPt.x}" cy="${corner.cornerPt.y}" r="${rDot * 1.5}" fill="none" stroke="#38bdf8" stroke-width="${strokeW}" />
    <circle cx="${tA.x}" cy="${tA.y}" r="${rDot}" fill="#38bdf8" />
    <circle cx="${tB.x}" cy="${tB.y}" r="${rDot}" fill="#38bdf8" />
    <path d="${arcD}" fill="none" stroke="#38bdf8" stroke-width="${strokeW * 1.25}" stroke-dasharray="${4 / scale} ${3 / scale}" />
    <line x1="${tA.x}" y1="${tA.y}" x2="${corner.cornerPt.x}" y2="${corner.cornerPt.y}" stroke="#f43f5e" stroke-width="${strokeW * 0.75}" stroke-dasharray="${2 / scale} ${2 / scale}" opacity="0.7" />
    <line x1="${tB.x}" y1="${tB.y}" x2="${corner.cornerPt.x}" y2="${corner.cornerPt.y}" stroke="#f43f5e" stroke-width="${strokeW * 0.75}" stroke-dasharray="${2 / scale} ${2 / scale}" opacity="0.7" />
    <text x="${centerPt.x}" y="${centerPt.y}" fill="#38bdf8" font-size="${11 / scale}" font-family="system-ui, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle">R ${fmtR(radius)}</text>`;
    } else if (geom && geom.reason) {
      // singular radius (a line would collapse) / collinear: say so right at the corner instead of an arc
      html += `
    <circle cx="${corner.cornerPt.x}" cy="${corner.cornerPt.y}" r="${rDot * 1.5}" fill="none" stroke="#f43f5e" stroke-width="${strokeW}" />
    <text x="${corner.cornerPt.x}" y="${corner.cornerPt.y - 10 / scale}" fill="#f43f5e" font-size="${10 / scale}" font-family="system-ui, sans-serif" text-anchor="middle">${geom.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
    }
  }
  g.innerHTML = html;
}
