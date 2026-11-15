// packages/ui/input-handlers/fillet-tool.js — Corner Fillet Tool (Fusion-style pick)
// Flow: click line 1 (it highlights) -> click line 2 -> an inline radius input opens, pre-filled with the
// remembered radius, with a LIVE PREVIEW of the arc as you type. Enter applies (with the driving radius
// dimension); Esc cancels and leaves no change and no undo step. Clicking directly on a corner is a shortcut
// into the SAME input-first flow (one behaviour, not two).
// Preview at every step goes through ONE renderer, renderFilletOverlay: corner hover, line-2 hover, typing, dragging.
// TASK 646: while the radius input is open a round HANDLE sits on the preview arc's midpoint; dragging it (mouse or finger) sets the
// radius live through the SAME state as typing (_input.radius, written into the box). The preview also shows the two curves as they WILL
// BE: the trimmed part ghosted, and a line the fillet must EXTEND past its far end dashed in the --sk-warning colour. The green check
// button (done-button.js, declared in input-manager DONE_ACTIONS) applies the fillet through commitFilletInput, the function Enter runs.
// The view (wheel, middle drag, two fingers) may move while a fillet is in progress: the box, the preview and the handle follow the corner
// (ONE panzoom:viewportChanged listener); a press on empty canvas abandons the open input only when it is a CLICK (released in place,
// view unmoved), so a pan or pinch that starts on empty canvas keeps the fillet and the typed / dragged radius.
// Connects UI input with #core/fillet.js.

import { screenToWorld, worldToScreen } from '#ui/coords.js';
import { snapBoostFor } from '#ui/snap-detection.js';
import {
  findCornerAtPoint, findFilletShapeAtPoint, findCornerBetweenLines, cornerFilletGeometry, applyFillet,
  diagnoseNoFillet, defaultFilletRadius, parseFilletRadius
} from '#core/fillet.js';
import { SNAP } from '#core/constants.js';
import { dragArrowSvg, dragArrowHit, dragArrowDirection } from '#ui/drag-arrow-handle.js';
import { arcSweepInfo } from '#core/geometry.js';
import { inertEntities, isShapeInert } from '#core/sketch-model.js'; // TASK 577: a locked / hidden sketch is not filleted
import { docUnit } from '#core/settings-manager.js';
import { format as formatUnit } from '#core/units.js';
import { showNotification } from '#ui/notification-manager.js';
import { ensureNumericInputStyles } from '#ui/numeric-input-manager.js';

const OVERLAY_ID = 'fillet-tool-overlay';
const INPUT_ID = 'fillet-radius-input';

let _ctx = null;
let _state = null;
let hoverCorner = null;
let currentRadius = null; // WORLD mm (1 unit = 1 mm); null until first setup. Survives tool switches.
let _radiusUnit = null;   // doc unit the default was seeded for; a unit change re-seeds it
let _pick = null;         // { line1 } once the first line is picked
let _input = null;        // { el, corner, radius, ... } while the radius input is open; radius = the ONE radius, typed or dragged
let _hover = false;       // the pointer is over the handle (it draws darker)
let _drag = null;         // { pointerId, grab } while the handle is dragged
let _press = null;        // a press on empty canvas while the input is open: a click abandons it on release, a pan / pinch does not
let _viewListening = false;
let _committing = false;  // commitFilletInput is saving its own history step
const PRESS_SLOP_PX = 6;

const decimalsFor = (unit) => (unit === 'in' ? 3 : 2);
// Radius for display: 2 decimals in mm (2.79), 3 in inches (0.25in / 0.4in), trailing zeros trimmed, unit suffix.
const fmtR = (mm, unit = docUnit()) => formatUnit(mm, unit, { unit: true, decimals: decimalsFor(unit) });

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
  if (currentRadius == null) { currentRadius = defaultFilletRadius(docUnit()); _radiusUnit = docUnit(); }
}

export function setupFilletTool(ctx, state) {
  _ctx = ctx;
  _state = state;
  hoverCorner = null;
  setCursor('crosshair');

  // Runs on EVERY activation: only seed the default the first time / when the doc unit changes, so the
  // "last value used" survives tool switches for the session.
  const unit = docUnit();
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

// TASK 577: a line / corner of a locked or hidden sketch is not a fillet pick (the picks above search every shape; this drops theirs).
function lineOf(line, state) { return line && !isShapeInert(inertEntities(state), line.id) ? line : null; }
function cornerOf(corner, state) { return corner && lineOf(corner.lineA.shape, state) && lineOf(corner.lineB.shape, state) ? corner : null; }

export function handleFilletPointerMove(e, ctx, state, viewState) {
  _ctx = ctx;
  _state = state;
  const svg = getSvgElement(ctx);
  if (!svg) return;
  if (_input) { // the overlay follows the typed / dragged value while the input is open
    if (_drag && _drag.pointerId === e.pointerId) dragHandleTo(svg, e);
    else if (_press && _press.pointerId === e.pointerId && Math.hypot(e.clientX - _press.x, e.clientY - _press.y) > PRESS_SLOP_PX) _press.moved = true;
    else if (e.pointerType !== 'touch') {
      const over = overHandle(svg, e);
      setCursor(over ? 'pointer' : 'crosshair');
      if (over !== _hover) { _hover = over; refreshPreview(); }
    }
    return;
  }
  ensureRadius();
  const scale = getScale(svg, viewState);
  const world = screenToWorld(svg, e.clientX, e.clientY);
  const thresh = SNAP.JOINT_PX / scale;

  if (_pick) {
    // line 1 is picked: preview the arc for the candidate line 2 under the cursor
    const line2 = lineOf(findFilletShapeAtPoint(state, world, thresh), state);
    hoverCorner = line2 ? cornerOf(findCornerBetweenLines(state, _pick.line1, line2), state) : null;
    renderFilletOverlay(svg, hoverCorner, viewState, { highlight: [_pick.line1] });
    return;
  }
  hoverCorner = cornerOf(findCornerAtPoint(state, world, thresh), state);
  renderFilletOverlay(svg, hoverCorner, viewState);
}

export function handleFilletPointerDown(e, ctx, state, viewState) {
  if (e.button !== 0) return false;
  const svg = getSvgElement(ctx);
  if (!svg) return false;
  _ctx = ctx;
  _state = state;
  ensureRadius();
  if (_input) {
    // the handle starts a drag; anything else is a press whose meaning (click = abandon, pan / pinch = keep) is known on release
    if (overHandle(svg, e)) {
      const grab = handleWorld(); const w = screenToWorld(svg, e.clientX, e.clientY);
      _drag = { pointerId: e.pointerId, grab: grab ? { x: grab.x - w.x, y: grab.y - w.y } : { x: 0, y: 0 } };
      refreshPreview(); // the arrow draws darker while dragged
    } else _press = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, svg, state, viewState };
    return true;
  }
  return pressAt(svg, state, viewState, e.clientX, e.clientY);
}

// A fresh click at a client point: pick line 1 / line 2, or a corner (opens the radius input).
function pressAt(svg, state, viewState, clientX, clientY) {
  const scale = getScale(svg, viewState);
  const world = screenToWorld(svg, clientX, clientY);
  const thresh = SNAP.JOINT_PX / scale;

  if (_pick) {
    const line2 = lineOf(findFilletShapeAtPoint(state, world, thresh), state);
    if (!line2) return true; // clicked empty space: keep waiting for line 2 (Esc cancels)
    if (line2.id === _pick.line1.id) { cancelAll(); return true; } // click line 1 again: un-pick
    const corner = cornerOf(findCornerBetweenLines(state, _pick.line1, line2), state);
    if (!corner) { showNotification('Curves must meet at a corner to fillet', 'warning'); return true; }
    openInput(svg, state, viewState, corner);
    return true;
  }

  // shortcut: a click on a corner opens the same input-first flow directly
  const hit = cornerOf(findCornerAtPoint(state, world, thresh), state);
  if (hit) { openInput(svg, state, viewState, hit); return true; }

  const line1 = lineOf(findFilletShapeAtPoint(state, world, thresh), state);
  if (line1) {
    _pick = { line1 };
    ensureViewListener();
    renderFilletOverlay(svg, null, viewState, { highlight: [line1] });
    return true;
  }
  const why = diagnoseNoFillet(state, world, thresh);
  if (why) showNotification(why, 'warning');
  return false;
}

export function handleFilletPointerUp(e) {
  if (_drag && e && _drag.pointerId === e.pointerId) { // releasing the handle keeps the input open; Enter (or the check) applies
    _drag = null;
    if (_input) refreshPreview();
    if (_input) { try { _input.el.focus(); _input.el.select(); } catch (_) {} }
    return;
  }
  if (_press && e && _press.pointerId === e.pointerId) {
    const p = _press; _press = null;
    if (!p.moved && _input) { cancelInput(); pressAt(p.svg, p.state, p.viewState, e.clientX, e.clientY); } // a click on the canvas abandons the input, then acts as a fresh click
  }
}

export function handleFilletKeyDown(e, svg, state) {
  if (e.key === 'Escape' && (_pick || _input)) { cancelAll(); return true; }
  if (e.key === 'r' || e.key === 'R') {
    const unit = docUnit();
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
  ensureNumericInputStyles();
  cancelInput();
  _pick = null;
  hoverCorner = null;
  const unit = docUnit();
  const el = document.createElement('input');
  el.id = INPUT_ID;
  el.type = 'text';
  el.className = 'dim-input';
  el.setAttribute('aria-label', 'Fillet radius');
  el.value = formatUnit(currentRadius, unit, { decimals: decimalsFor(unit) });
  el.style.position = 'fixed';
  el.style.width = '90px';
  document.body.appendChild(el);
  // a history change (Undo / Redo) ends the fillet in progress; the corner it was on may be gone
  const unsubHistory = typeof state.addHistoryListener === 'function' ? state.addHistoryListener(() => { if (!_committing) cancelAll(); }) : null;
  _input = { el, corner, radius: currentRadius, svg, state, viewState, unsubHistory };
  placeInput();
  ensureViewListener();

  el.addEventListener('input', () => {
    const v = parseFilletRadius(el.value, docUnit());
    if (v != null) _input.radius = v;
    refreshPreview();
  });
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // typing must never reach the canvas shortcuts (Delete, F, R, ...)
    if (ev.key === 'Enter') { ev.preventDefault(); commitFilletInput(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); cancelAll(); }
  });
  refreshPreview();
  // The click that opened the input is still in flight: its pointerup/click would take focus back to the canvas.
  // Focus now AND again once that gesture has finished.
  const focusIt = () => { if (_input && _input.el === el) { try { el.focus(); el.select(); } catch (_) {} } };
  focusIt();
  window.addEventListener('pointerup', () => setTimeout(focusIt, 0), { once: true, capture: true });
  setTimeout(focusIt, 60);
}

// the radius box sits beside the corner (below-right), wherever the view has moved it
function placeInput() {
  const { el, corner, svg } = _input;
  try {
    const q = worldToScreen(svg, corner.cornerPt);
    el.style.left = `${Math.round(q.x + 14)}px`;
    el.style.top = `${Math.round(q.y + 14)}px`;
  } catch (_) { el.style.left = '40%'; el.style.top = '40%'; }
}

function refreshPreview() {
  renderFilletOverlay(_input.svg, _input.corner, _input.viewState, { radius: _input.radius, handle: true });
}

// ---- the radius handle ------------------------------------------------------------------------------------------

// the point the handle sits on: the midpoint of the preview arc at the current radius (null while that radius has no fillet)
function arcMidpoint(geom) {
  if (!geom || !geom.valid) return null;
  const { tA, tB, centerPt: O, radius } = geom;
  let mx = (tA.x - O.x) + (tB.x - O.x), my = (tA.y - O.y) + (tB.y - O.y);
  let m = Math.hypot(mx, my);
  if (m < 1e-9) { mx = -(tA.y - O.y); my = tA.x - O.x; m = Math.hypot(mx, my); } // a half circle: the normal of its chord
  return { x: O.x + radius * mx / m, y: O.y + radius * my / m };
}

function handleWorld() {
  return _input ? arcMidpoint(cornerFilletGeometry(_input.corner, _input.radius)) : null;
}

// the handle is the shared drag arrow: it is picked within the arrow's reach (a 44 px target, x the touch boost for a finger)
function overHandle(svg, e) {
  const h = handleWorld();
  if (!h) return false;
  return dragArrowHit({ x: e.clientX, y: e.clientY }, worldToScreen(svg, h), e.pointerType === 'touch', snapBoostFor(e.pointerType === 'touch'));
}

// The radius whose preview arc midpoint lies nearest the world point q. The midpoints of the fillets of all radii form the corner's
// locus (the bisector for two lines, a curve for a line and an arc): the radii are sampled on a log scale, then the best bracket
// is refined by golden section; a radius with no fillet is skipped. No grid or snap: radius drags have none in this app.
function radiusNearest(corner, q) {
  const dist = (r) => { const m = arcMidpoint(cornerFilletGeometry(corner, r)); return m ? Math.hypot(m.x - q.x, m.y - q.y) : Infinity; };
  const LO = 0.1, HI = 1e5, N = 120, k = Math.log(HI / LO) / N;
  let best = 0, bestD = Infinity;
  for (let i = 0; i <= N; i++) { const d = dist(LO * Math.exp(k * i)); if (d < bestD) { bestD = d; best = i; } }
  if (!isFinite(bestD)) return null;
  let a = LO * Math.exp(k * Math.max(0, best - 1)), b = LO * Math.exp(k * Math.min(N, best + 1));
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const c = b - g * (b - a), d = a + g * (b - a);
    if (dist(c) < dist(d)) b = d; else a = c;
  }
  return (a + b) / 2;
}

// one drag step: the ONE radius state takes the new value (written into the box, in the box's own formatting), the preview follows
function dragHandleTo(svg, e) {
  const w = screenToWorld(svg, e.clientX, e.clientY);
  const r = radiusNearest(_input.corner, { x: w.x + _drag.grab.x, y: w.y + _drag.grab.y });
  if (r == null) return;
  const unit = docUnit();
  const text = formatUnit(r, unit, { decimals: decimalsFor(unit) });
  const v = parseFilletRadius(text, unit);
  if (v == null) return;
  _input.el.value = text;
  _input.radius = v;
  refreshPreview();
}

// ---- the view moves (wheel, middle drag, two fingers): everything in progress follows ---------------------------------

function ensureViewListener() {
  if (_viewListening) return;
  _viewListening = true;
  document.addEventListener('panzoom:viewportChanged', () => {
    if (_press) _press.moved = true; // a pan / pinch that began on empty canvas is not a click
    if (_input) { placeInput(); refreshPreview(); }
    else if (_pick) renderFilletOverlay(_ctx && getSvgElement(_ctx), null, _state && _state.view, { highlight: [_pick.line1] });
  });
}

/** The radius input is open (the check button of the Done layer shows). */
export function filletInputOpen() { return !!_input; }

/** The open corner's world point: where the check button sits beside; null when no input is open. */
export function filletCornerPoint() { return _input ? _input.corner.cornerPt : null; }

/** Enter / the check button: apply the fillet with the radius in the box. The input stays open (with a warning) when it cannot be applied. */
export function commitFilletInput() {
  if (!_input) return;
  const { el, corner, state } = _input;
  const unit = docUnit();
  const val = parseFilletRadius(el.value, unit);
  if (val == null) { showNotification('Enter a radius greater than zero', 'warning'); return; }
  const pre = cornerFilletGeometry(corner, val);
  if (!pre.valid) { showNotification(`Can't fillet: ${pre.reason}`, 'warning'); return; } // input stays open

  // One history step per fillet, owned here in the tool layer like every other tool (core does not saveState).
  // The step is this fillet's own: it must not end the fillet through the history listener.
  _committing = true;
  let res;
  try { try { state.saveState?.('fillet'); } catch (_) {} res = applyFillet(state, corner, val); } finally { _committing = false; }
  if (!res || !res.success) { showNotification(`Can't fillet: ${(res && res.reason) || 'unknown'}`, 'warning'); return; }

  currentRadius = val; // the value USED becomes the remembered default
  removeInput();
  clearFilletOverlay();
  if (typeof state.triggerDraw === 'function') state.triggerDraw();
  else if (typeof window.__requestDraw === 'function') window.__requestDraw();
  showNotification(`Fillet applied (R = ${fmtR(res.radius, unit)})`, 'info');
}

function removeInput() {
  if (_input && _input.unsubHistory) _input.unsubHistory();
  if (_input && _input.el && _input.el.parentNode) _input.el.parentNode.removeChild(_input.el);
  _input = null;
  _drag = null;
  _hover = false;
  _press = null;
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
    const stroke = `stroke="#f59e0b" stroke-width="${strokeW * 2.5}" stroke-linecap="round" opacity="0.75"`;
    if (ln.type === 'arc') {
      const c = joints && joints.get(ln.joints[0]), a = joints && joints.get(ln.joints[1]), b = joints && joints.get(ln.joints[2]);
      if (c && a && b) {
        const info = arcSweepInfo(c, a, b, { sweep: ln.sweep });
        html += `<path d="M ${a.x} ${a.y} A ${Math.hypot(a.x - c.x, a.y - c.y)} ${Math.hypot(a.x - c.x, a.y - c.y)} 0 ${info.large ? 1 : 0} ${info.dir > 0 ? 1 : 0} ${b.x} ${b.y}" fill="none" ${stroke} />`;
      }
      continue;
    }
    const a = joints && joints.get(ln.joints[0]), b = joints && joints.get(ln.joints[1]);
    if (a && b) html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${stroke} />`;
  }

  // The curves as they WILL BE: the part the fillet removes is drawn ghosted (dashed) from the tangent point back to the corner:
  // straight along a line, along the circle for an arc. A LINE whose tangent point lies past its far end is removed whole and
  // EXTENDED: the part beyond that end is drawn dashed in the --sk-warning colour (Fusion extends the line the same way).
  const GHOST = `fill="none" stroke="#f43f5e" stroke-width="${strokeW * 0.75}" stroke-dasharray="${2 / scale} ${2 / scale}" opacity="0.7"`;
  const EXTEND = `fill="none" style="stroke:var(--sk-warning, #f59e0b)" stroke-width="${strokeW * 1.5}" stroke-dasharray="${5 / scale} ${3 / scale}" stroke-linecap="round"`;
  const trimSvg = (curve, t, P) => {
    if (curve && curve.kind === 'arc') {
      const delta = (((Math.atan2(t.y - curve.c.y, t.x - curve.c.x) - curve.aP) * curve.bodyDir) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      return `<path d="M ${t.x} ${t.y} A ${curve.R} ${curve.R} 0 ${delta > Math.PI ? 1 : 0} ${curve.bodyDir > 0 ? 0 : 1} ${P.x} ${P.y}" ${GHOST} />`;
    }
    const far = curve && curve.far;
    if (far && (t.x - P.x) * curve.u.x + (t.y - P.y) * curve.u.y > curve.len) {
      return `<path d="M ${far.x} ${far.y} L ${P.x} ${P.y}" ${GHOST} /><path d="M ${far.x} ${far.y} L ${t.x} ${t.y}" ${EXTEND} />`;
    }
    return `<path d="M ${t.x} ${t.y} L ${P.x} ${P.y}" ${GHOST} />`;
  };

  if (corner) {
    const radiusReq = (typeof opts.radius === 'number') ? opts.radius : currentRadius;
    const geom = cornerFilletGeometry(corner, radiusReq);
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
    ${trimSvg(corner.curveA, tA, corner.cornerPt)}
    ${trimSvg(corner.curveB, tB, corner.cornerPt)}
    <text x="${centerPt.x}" y="${centerPt.y}" fill="#38bdf8" font-size="${11 / scale}" font-family="system-ui, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="middle">R ${fmtR(radius)}</text>`;
      const hp = opts.handle ? arcMidpoint(geom) : null;
      if (hp) {
        // the drag handle: the shared drag ARROW on the preview arc's midpoint, pointing the way the radius grows (away from the corner);
        // .fillet-handle is what the Done button keeps clear of
        const dir = dragArrowDirection((r) => arcMidpoint(cornerFilletGeometry(corner, r)), radiusReq, radiusReq * 0.02);
        html += dragArrowSvg({ point: hp, dir, scale, state: _drag ? 'drag' : (_hover ? 'hover' : 'idle'), className: 'fillet-handle' });
      }
    } else if (geom && geom.reason) {
      // singular radius (a line would collapse) / collinear: say so right at the corner instead of an arc
      html += `
    <circle cx="${corner.cornerPt.x}" cy="${corner.cornerPt.y}" r="${rDot * 1.5}" fill="none" stroke="#f43f5e" stroke-width="${strokeW}" />
    <text x="${corner.cornerPt.x}" y="${corner.cornerPt.y - 10 / scale}" fill="#f43f5e" font-size="${10 / scale}" font-family="system-ui, sans-serif" text-anchor="middle">${geom.reason.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`;
    }
  }
  g.innerHTML = html;
}
