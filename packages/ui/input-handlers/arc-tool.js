// Arc tool: Center Point Arc (centre, start, end) and TASK 1022 3-Point Arc (start, end, a point on the arc), with live value boxes
import { dbg } from '#core/debug.js';
import { TOOL_MODES, CONSTRAINT_TYPES, SNAP, ARC_MODES } from '#core/constants.js';
import { makeArc } from '#core/shapes.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { hideInput, setupNumericInput, boxValueText, SIZE_REFUSAL_HINT } from '#ui/numeric-input-manager.js';
import { showNotification } from '#ui/notification-manager.js';
import { angleBetween, circumcenter3Pt, arcSweepFor3Pt, arcSweepInfo } from '#core/geometry.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { checkDragThreshold, resetToolState, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, shownSnap, MIN_SHAPE_SIZE, tooSmall, liveExpression, liveName, liveAssign, applyLiveAssign } from '#ui/input-handlers/base-tool.js';

const localState = { isDragging: false, dragStartScreen: null };

// Helper to capture arc debug messages both to console and to a copyable buffer on window/global
function arcLog(msg, payload, level = 'debug') {
  try {
    const entry = { t: Date.now(), level, msg, payload };
    try {
      if (typeof window !== 'undefined') {
        window.__arcLog = window.__arcLog || [];
        window.__arcLog.push(entry);
        if (window.__arcLog.length > 1000) window.__arcLog.shift();
      } else if (typeof global !== 'undefined') {
        global.__arcLog = global.__arcLog || [];
        global.__arcLog.push(entry);
        if (global.__arcLog.length > 1000) global.__arcLog.shift();
      }
    } catch (_) { }
    if (level === 'error') console.error('[arc-tool]', msg, payload); else if (level === 'warn') console.warn('[arc-tool]', msg, payload); else console.debug('[arc-tool]', msg, payload);
  } catch (_) { }
}


// TASK 597: after the centre click the RADIUS box shows (a typed radius puts the start point at that distance along the cursor's direction; the
// arc gets the radius dimension it always got); after the start click the SWEEP box (degrees: a typed sweep is the arc's exact angle, the winding
// direction follows the cursor). Both through base-tool's shared creation-box path; a value not typed follows the cursor.
// lockedRadius / lockedSweep = what the user TYPED (null = the cursor sets it); `cursor` = the last world point, `screen` = the last pointer.
// TASK 1022: the 3-Point Arc's boxes are the 3-point arc slot's (slot-tool.js): after the start click the CHORD box (the distance start -> end; a typed chord
// puts the end at that distance along the cursor's direction and becomes a distance dimension between the two ends, as the slot's typed span does), after the
// end click the RADIUS box (the slot shows the radius there; here a typed radius also holds: the arc takes that radius on the cursor's side, and gets the radius
// dimension the Center Point Arc gives a typed radius). minRadius = half the chord while the radius box of a 3-point arc is open (a smaller radius cannot reach both ends).
let arcState = { lockedRadius: null, radiusExpression: null, radiusName: null, radiusAssign: null, lockedSweep: null, sweepAssign: null, lockedChord: null, chordExpression: null, chordName: null, chordAssign: null, minRadius: 0, field: null, cursor: null, screen: null };   // TASK 1028 (B-13): sweepAssign = `param = value` typed in the sweep box
/** TASK 1028 (B-07): THE value rule of a typed sweep: an arc turns more than 0 and less than a full turn (0 and -90 were ignored, 360 / 720 made an arc whose
 *  ends are one point). The sweep box refuses by it (numeric-input-manager boxRefusal) and only a sweep it takes locks the arc. */
export const SWEEP_REFUSAL = 'A sweep must be more than 0 and less than 360 degrees.';
const sweepRefusal = (v) => (v > 0 && v < 360 ? '' : SWEEP_REFUSAL);
const BOX_RADIUS = { single: { field: 'radius' } };
const BOX_SWEEP = { single: { field: 'sweep', quantity: 'angle', refuse: sweepRefusal } }; // TASK 769: degrees (the radius box is a length)
const BOX_CHORD = { single: { field: 'chord' } };   // TASK 1022: a length (refused at 0 or less by the length rule)
const MIN_R = MIN_SHAPE_SIZE;   // TASK 782: the one minimum size (base-tool.js)
/** TASK 1022: THE value rule of a 3-point arc's typed radius: a length (more than 0), and at least half the chord, the distance between the two ends. */
export const radiusTooSmallText = (minRadius) => `The radius must be at least half the distance between the arc's ends (${boxValueText(minRadius)}).`;
const threePointRadiusRefusal = (v) => (!(v > 0) ? SIZE_REFUSAL_HINT : (v < arcState.minRadius - 1e-9 ? radiusTooSmallText(arcState.minRadius) : ''));
/** TASK 1022: the hint when the third point of a 3-point arc is on the line through its two ends (no circle goes through the three). */
export const COLLINEAR_ARC_HINT = 'No arc passes through three points on one line: move the third point off the line through the two ends.';

const isThreePoint = (state) => !!(state.active && state.active.subMode === ARC_MODES.THREE_POINT);

function openArcBox(pos, field) {
  arcState.field = field; arcState.cursor = null;
  if (pos) arcState.screen = { x: pos.clientX, y: pos.clientY };
  const box = field === 'chord' ? BOX_CHORD
    : field === 'radius' ? (arcState.minRadius > 0 ? { single: { field: 'radius', refuse: threePointRadiusRefusal } } : BOX_RADIUS)
    : BOX_SWEEP;
  openCreationBoxes(pos || { clientX: 0, clientY: 0 }, box, [0]);
}
function closeArcBoxes() {
  arcState.lockedRadius = null; arcState.radiusExpression = null; arcState.radiusName = null; arcState.radiusAssign = null; arcState.lockedSweep = null; arcState.sweepAssign = null;
  arcState.lockedChord = null; arcState.chordExpression = null; arcState.chordName = null; arcState.chordAssign = null; arcState.minRadius = 0;
  if (arcState.field) hideInput();
  arcState.field = null; arcState.cursor = null; arcState.screen = null;
}
/** TASK 1022: the end of a 3-point arc: the cursor, or, with a typed chord, the point at that distance from the start along the cursor's direction (+x on the start). */
function chordEndFor(start, pt) {
  if (arcState.lockedChord === null) return pt;
  const d = Math.hypot(pt.x - start.x, pt.y - start.y);
  const ux = d > 0 ? (pt.x - start.x) / d : 1, uy = d > 0 ? (pt.y - start.y) / d : 0;
  return { x: start.x + ux * arcState.lockedChord, y: start.y + uy * arcState.lockedChord };
}
/**
 * TASK 1022: THE arc of the 3-Point mode from its start s, end e and the third point p: { center, radius, sweep } (sweep as an arc shape's: true = increasing
 * angle from s to e), or null when p is on the line through s and e. Untyped: the circle through the three points (#core/geometry.js circumcenter3Pt, the 3-point
 * arc slot's), the arc from s to e that passes through p. With a typed radius r (at least half the chord): the arc of radius r through s and e that bulges to p's
 * side, the short one or the long one as the arc through p would be (the circle through the three points has its centre on p's side of the chord: the long one).
 */
function threePointArcFor(s, e, p, radius = arcState.lockedRadius) {
  const cc = circumcenter3Pt(s, e, p);
  if (!cc) return null;
  if (radius === null) return { center: cc.center, radius: cc.radius, sweep: arcSweepFor3Pt(cc.center, s, e, p) };
  const c = Math.hypot(e.x - s.x, e.y - s.y);
  const m = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
  const n = { x: -(e.y - s.y) / c, y: (e.x - s.x) / c };   // the chord's unit normal
  const side = Math.sign((p.x - m.x) * n.x + (p.y - m.y) * n.y);   // p's side of the chord (+1 / -1; not 0: p is off the line, cc exists)
  const long = Math.sign((cc.center.x - m.x) * n.x + (cc.center.y - m.y) * n.y) === side;
  const h = Math.sqrt(Math.max(0, radius * radius - (c / 2) * (c / 2)));
  const k = (long ? side : -side) * h;
  const center = { x: m.x + n.x * k, y: m.y + n.y * k };
  const apex = { x: center.x + n.x * side * radius, y: center.y + n.y * side * radius };   // the arc's point farthest on p's side: on the arc
  return { center, radius, sweep: arcSweepFor3Pt(center, s, e, apex) };
}
/** TASK 1022: the preview of the 3-point arc's last phase (the arc, or the chord while the third point is on its line). Returns the arc (or null). */
function drawThreePointPreview(state, start, end, cursor) {
  const arc = threePointArcFor(start, end, cursor);
  if (!arc) { safeUpdatePreview(state, 'line', [state.active.start], end); return null; }
  const info = arcSweepInfo(arc.center, start, end, { sweep: arc.sweep });
  safeUpdatePreview(state, 'arc', [], cursor, {
    subMode: 'arc-cse',
    center: { x: arc.center.x, y: arc.center.y },
    radius: arc.radius, startAngle: angleBetween(arc.center, start), endAngle: angleBetween(arc.center, end),
    largeArc: info.span > Math.PI,
    sweep: arc.sweep
  });
  return arc;
}
/** The start point: the cursor, or, with a typed radius, the point at that radius from the centre along the cursor's direction (+x when the cursor is on the centre). */
function startPointFor(center, pt) {
  if (arcState.lockedRadius === null) return pt;
  const d = Math.hypot(pt.x - center.x, pt.y - center.y);
  const ux = d > 0 ? (pt.x - center.x) / d : 1, uy = d > 0 ? (pt.y - center.y) / d : 0;
  return { x: center.x + ux * arcState.lockedRadius, y: center.y + uy * arcState.lockedRadius };
}
/** The winding direction the cursor has so far: -1 clockwise, +1 counter-clockwise (counter-clockwise before it moved). */
const windingDir = (state) => ((state.active && state.active.totalSweep) || 0) < 0 ? -1 : 1;
/** The end angle: the cursor's, or, with a typed sweep, the start angle plus that sweep in the cursor's winding direction. */
function endAngleFor(state, startAngle, cursorAngle) {
  if (arcState.lockedSweep === null) return cursorAngle;
  return startAngle + windingDir(state) * arcState.lockedSweep * Math.PI / 180;
}
/** Only a TYPED field locks (the box otherwise shows the live value, rounded). */
function takeTyped(detail) {
  if (detail.reset && detail.reset[0]) {
    if (detail.field === 'radius') { arcState.lockedRadius = null; arcState.radiusExpression = null; arcState.radiusName = null; arcState.radiusAssign = null; }
    else if (detail.field === 'sweep') { arcState.lockedSweep = null; arcState.sweepAssign = null; }
    else if (detail.field === 'chord') { arcState.lockedChord = null; arcState.chordExpression = null; arcState.chordName = null; arcState.chordAssign = null; }
    return;
  }
  if (!detail.typed || !detail.typed[0]) return;
  if (detail.field === 'chord') {   // TASK 1022: the 3-point arc's chord (a length: more than 0)
    arcState.lockedChord = detail.value > MIN_R ? detail.value : null;
    arcState.chordExpression = arcState.lockedChord !== null ? liveExpression(detail, 0) : null;
    arcState.chordName = arcState.lockedChord !== null ? liveName(detail, 0) : null;
    arcState.chordAssign = arcState.lockedChord !== null ? liveAssign(detail, 0) : null;
  }
  if (detail.field === 'radius') {
    arcState.lockedRadius = detail.value > 0 && detail.value >= arcState.minRadius - 1e-9 ? detail.value : null;   // TASK 1022: a 3-point arc's radius reaches both ends
    arcState.radiusExpression = arcState.lockedRadius !== null ? liveExpression(detail, 0) : null;
    arcState.radiusName = arcState.lockedRadius !== null ? liveName(detail, 0) : null;
    arcState.radiusAssign = arcState.lockedRadius !== null ? liveAssign(detail, 0) : null;
  }
  else if (detail.field === 'sweep') { arcState.lockedSweep = sweepRefusal(detail.value) ? null : detail.value; arcState.sweepAssign = arcState.lockedSweep !== null ? liveAssign(detail, 0) : null; }
}
/** The preview of the arc phase: start -> the cursor's angle, or the typed sweep. Returns the end point. */
function drawSweepPreview(state, center, start, cursor) {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const startAngle = angleBetween(center, start);
  const endAngle = endAngleFor(state, startAngle, angleBetween(center, cursor));
  const total = state.active.totalSweep || 0;
  const span = arcState.lockedSweep !== null ? arcState.lockedSweep * Math.PI / 180 : Math.abs(total);
  const endPt = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
  safeUpdatePreview(state, 'arc', [], arcState.lockedSweep !== null ? endPt : cursor, {
    subMode: 'arc-cse',
    center: { x: center.x, y: center.y }, // TASK 470: the resolved point, not the joint id (the joint can vanish before the next frame)
    radius, startAngle, endAngle,
    largeArc: span > Math.PI,
    sweep: arcState.lockedSweep !== null ? windingDir(state) > 0 : total > 0
  });
  return endPt;
}
/** A typed value just changed: redraw from the last cursor point. */
function redrawArcPreview(state) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return;
  if (isThreePoint(state)) {   // TASK 1022
    const start = state.joints.get(state.active.start);
    if (!start) return;
    const cur = arcState.cursor || start;
    if (state.active.phase === 'chord') safeUpdatePreview(state, 'line', [state.active.start], chordEndFor(start, cur));
    else if (state.active.phase === 'bulge') { const end = state.joints.get(state.active.end); if (end) drawThreePointPreview(state, start, end, cur); }
    return;
  }
  const center = state.joints.get(state.active.center);
  if (!center) return;
  const cur = arcState.cursor || center;
  if (state.active.phase === 'center') {
    safeUpdatePreview(state, 'line', [state.active.center], startPointFor(center, cur));
  } else if (state.active.phase === 'start') {
    const start = state.joints.get(state.active.start);
    if (start) drawSweepPreview(state, center, start, cur);
  }
}

export function setupArcTool(svg, state) {
  arcLog('setupArcTool called', { svg: !!svg });
  setupNumericInput(svg, state);
  state.onDrawCancelled(() => closeArcBoxes());   // another tool picked / Undo mid-draw: the box goes with the draw

  setupDimensionListeners(state, TOOL_MODES.ARC, {
    guard: (detail) => {
      // Center Point Arc: radius, then sweep; TASK 1022 3-Point Arc: chord, then radius
      const fields = isThreePoint(state) ? ['chord', 'radius'] : ['radius', 'sweep'];
      return detail.mode === 'single' && fields.includes(detail.field);
    },
    onApply: (detail) => {
      arcLog('liveDimensionApplied', detail);
      if (detail.confirmedBy !== 'enter') return;
      takeTyped(detail);
      if (isThreePoint(state)) {   // TASK 1022: Enter places what a click at the cursor places (the typed value holding it)
        const start = state.joints.get(state.active.start);
        if (!start) return;
        const pos = arcState.screen && { clientX: arcState.screen.x, clientY: arcState.screen.y };
        if (detail.field === 'chord') {
          const endPt = chordEndFor(start, arcState.cursor || start);
          if (tooSmall(Math.hypot(endPt.x - start.x, endPt.y - start.y))) { detail.keepOpen = true; return; }   // no chord yet: the box stays open
          handleThreePointArc(state, shownSnap(state), endPt, pos);   // TASK 1033 (X-01): the snap the cursor shows, as the click (a typed chord drops it there)
          detail.keepOpen = true;   // the radius box is up now
        } else {
          handleThreePointArc(state, shownSnap(state), arcState.cursor || start, pos);
          if (state.active) detail.keepOpen = true;   // the third point on the ends' line: the hint, the box stays
        }
        return;
      }
      const center = state.joints.get(state.active.center);
      if (!center) return;
      if (detail.field === 'radius') {   // Enter in the radius box: the start point goes at the typed radius (else the cursor's), then the sweep box
        const startPt = startPointFor(center, arcState.cursor || center);
        if (!(Math.hypot(startPt.x - center.x, startPt.y - center.y) > MIN_R)) { detail.keepOpen = true; return; }   // no radius yet: the box stays open
        handleCenterArc(state, shownSnap(state), startPt, startPt, arcState.screen && { clientX: arcState.screen.x, clientY: arcState.screen.y });   // TASK 1033 (X-01): as the click (a typed radius drops the snap there)
        detail.keepOpen = true;   // the sweep box is up now
      } else {   // Enter in the sweep box: the arc is placed
        const start = state.joints.get(state.active.start);
        if (!start) return;
        if (arcState.lockedSweep === null && !(Math.abs(state.active.totalSweep || 0) > 1e-9)) { detail.keepOpen = true; return; }   // no sweep yet: the box stays open
        const endPt = drawSweepPreview(state, center, start, arcState.cursor || start);
        handleCenterArc(state, shownSnap(state), endPt, endPt, null);   // TASK 1033 (X-01): as the click (a typed sweep drops the snap there)
      }
    },
    onPreview: (detail) => {
      arcLog('liveDimensionPreview', detail);
      takeTyped(detail);
      redrawArcPreview(state);
    },
    onCancel: () => { arcState.lockedRadius = null; arcState.radiusExpression = null; arcState.radiusName = null; arcState.radiusAssign = null; arcState.lockedSweep = null; arcState.sweepAssign = null; arcState.lockedChord = null; arcState.chordExpression = null; arcState.chordName = null; arcState.chordAssign = null; } // Esc in the box also runs the canvas Esc (input-manager handleEscape)
  });

  if (!state.arcMode) state.arcMode = ARC_MODES.CENTER_START_END;
}


export function resetArcState(state) {
  closeArcBoxes();
  resetToolState(state, TOOL_MODES.ARC, localState);
}

// Test helper to set locked radius during unit tests
export function _test_setArcLockedRadius(v) { arcState.lockedRadius = v; }

export function handleArcPointerDown(e, svg, state, hitSnap, w) {
  arcLog('pointerDown', { x: e && e.clientX, y: e && e.clientY, arcMode: state && state.arcMode });
  if (state.active && state.active.mode === TOOL_MODES.ARC) return true;
  try { state.beginDrawStep(); } catch (_) { }
  const snap = state.activeSnap || hitSnap;
  const pt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
  const pointId = state.genJ();
  state.joints.set(pointId, { x: pt.x, y: pt.y, fixed: false });

  localState.dragStartScreen = { x: (e && e.clientX) || 0, y: (e && e.clientY) || 0 };
  localState.isDragging = false;

  if (!state.arcMode) { arcLog('fallback: setting missing state.arcMode -> CENTER_START_END'); state.arcMode = ARC_MODES.CENTER_START_END; }

  if (state.arcMode === ARC_MODES.THREE_POINT) {   // TASK 1022: the first click is the arc's start (the 3-point arc slot's order: start, end, then the curve)
    state.active = { mode: TOOL_MODES.ARC, subMode: ARC_MODES.THREE_POINT, phase: 'chord', start: pointId, startSnap: snap, _tempStart: true };
    arcLog('active-set', { phase: 'chord', id: pointId, subMode: state.active.subMode });
    return true;
  }
  state.active = {
    mode: TOOL_MODES.ARC,
    subMode: ARC_MODES.CENTER_START_END,
    phase: 'center',
    center: pointId,
    centerSnap: snap,
    _tempStart: true
  };
  arcLog('active-set', { phase: 'center', id: pointId, subMode: state.active.subMode });

  dbg.debug('app', '[arc-tool] pointerDown -> active', { active: state.active });
  return true;
}

export function handleArcPointerMove(e, svg, state, w) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return false;
  const previewPt = state.snapTarget ? state.snapTarget.pt : w;
  arcState.cursor = previewPt;
  arcState.screen = { x: e.clientX, y: e.clientY };

  if (checkDragThreshold(e, localState.dragStartScreen, SNAP.DRAG_THRESHOLD || 2)) localState.isDragging = true;

  dbg.debug('app', '[arc-tool] pointerMove', { phase: state.active && state.active.phase, isDragging: localState.isDragging, previewPt });

  if (isThreePoint(state)) {   // TASK 1022
    const start = state.joints.get(state.active.start);
    if (!start) return false;
    if (state.active.phase === 'chord') {
      safeUpdatePreview(state, 'line', [state.active.start], chordEndFor(start, previewPt));
      if (arcState.field === 'chord') followCreationBoxes(e, [Math.hypot(previewPt.x - start.x, previewPt.y - start.y)]);
    } else if (state.active.phase === 'bulge') {
      const end = state.joints.get(state.active.end);
      if (!end) return false;
      const arc = drawThreePointPreview(state, start, end, previewPt);
      if (arcState.field === 'radius' && arc) followCreationBoxes(e, [arc.radius]);
    }
    return true;
  }
  if (state.active.phase === 'center') {
    const center = state.joints.get(state.active.center);
    safeUpdatePreview(state, 'line', [state.active.center], center ? startPointFor(center, previewPt) : previewPt);
    if (arcState.field === 'radius' && center) followCreationBoxes(e, [Math.hypot(previewPt.x - center.x, previewPt.y - center.y)]);
  } else if (state.active.phase === 'start') {
    const center = state.joints.get(state.active.center);
    const start = state.joints.get(state.active.start);
    if (!center || !start) return false;
    const startAngle = angleBetween(center, start);
    const endAngle = angleBetween(center, previewPt);

    // Winding Tracking: Detect direction and >180 degree arcs
    // Initialize tracking state if missing
    if (state.active.lastAngle === undefined) {
        state.active.lastAngle = startAngle;
        state.active.totalSweep = 0;
    }

    // Calculate delta and accumulate sweep
    let delta = endAngle - state.active.lastAngle;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    state.active.totalSweep += delta;
    state.active.lastAngle = endAngle;

    // Avoid exact PI difference (SVG edge case)
    if (Math.abs(endAngle - startAngle) === Math.PI) previewPt.x += 0.0001;
    drawSweepPreview(state, center, start, previewPt);
    if (arcState.field === 'sweep') followCreationBoxes(e, [Math.min(Math.abs(state.active.totalSweep) * 180 / Math.PI, 360)]);
  }

  return true;
}

export function handleArcPointerUp(e, svg, state, hitSnap, w, wasDragging) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return false;
  dbg.debug('app', '[arc-tool] pointerUp', { phase: state.active && state.active.phase, wasDragging, isDragging: localState.isDragging });
  // TASK 1033 (A-1): `_tempStart` = the press placed the first point and its release is still to come. That release consumes it, a click's or a drag's
  // (a drag's release places the next point below): left set, the NEXT click was taken for the first release and swallowed.
  const firstRelease = state.active._tempStart;
  state.active._tempStart = false;
  if (firstRelease && !localState.isDragging) {
    arcLog('clickIgnored', { phase: state.active.phase, reason: '_tempStart_click' }); localState.dragStartScreen = null;
    openArcBox(e, isThreePoint(state) ? 'chord' : 'radius');   // TASK 597: the radius shows now, after the centre click (TASK 1022: a 3-point arc's chord, after its start click)
    return true;
  }

  const snap = state.activeSnap || hitSnap;
  let pt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
  if (isThreePoint(state)) {   // TASK 1022
    const res3 = handleThreePointArc(state, snap, pt, e);
    if (!state.active) clearPreview(state);   // placed: no preview left (mid-draw the preview stays on the point just placed)
    localState.isDragging = false; localState.dragStartScreen = null;
    return res3;
  }
  if (state.active.phase === 'start' && arcState.lockedSweep !== null) {   // a typed sweep holds the end: the click only places it
    const center = state.joints.get(state.active.center), start = state.joints.get(state.active.start);
    if (center && start) pt = drawSweepPreview(state, center, start, pt);
  }

  const res = handleCenterArc(state, snap, pt, w, e);
  try { clearPreview(state); } catch (_) { }
  localState.isDragging = false; localState.dragStartScreen = null;
  arcLog('pointerUp-result', { res, shapes: (state.shapes || []).length });
  dbg.debug('app', '[arc-tool] pointerUp -> result', { res, shapes: (state.shapes || []).length });
  return res;
}



/** `pos` = the pointer ({ clientX, clientY }) where the sweep box opens (null = where the cursor last was). */
function handleCenterArc(state, snap, pt, w, pos) {
  if (state.active.phase === 'center') {
    const center0 = state.joints.get(state.active.center);
    if (center0 && arcState.lockedRadius !== null) { pt = startPointFor(center0, pt); snap = null; }   // a typed radius holds the start point (a snap cannot move it)
    if (center0 && tooSmall(Math.hypot(pt.x - center0.x, pt.y - center0.y))) return true;   // TASK 782: a start click on the centre makes no arc (the draw keeps waiting for a real start point)
    const startId = state.genJ();
    state.joints.set(startId, { x: pt.x, y: pt.y, fixed: false });
    state.active.start = startId;
    state.active.startSnap = snap;
    state.active.phase = 'start';

    // Initialize winding tracking
    const startAngle = angleBetween(state.joints.get(state.active.center), state.joints.get(startId));
    state.active.lastAngle = startAngle;
    state.active.totalSweep = 0;

    arcLog('create-start-point', { id: startId, pt });
    const typedRadius = arcState.lockedRadius, typedRadiusExpression = arcState.radiusExpression, typedRadiusName = arcState.radiusName, typedRadiusAssign = arcState.radiusAssign;
    openArcBox(pos || (arcState.screen ? { clientX: arcState.screen.x, clientY: arcState.screen.y } : null), 'sweep');   // TASK 597: the sweep shows now, after the start click
    arcState.lockedRadius = typedRadius; arcState.radiusExpression = typedRadiusExpression; arcState.radiusName = typedRadiusName; arcState.radiusAssign = typedRadiusAssign;   // the radius typed in the first box still becomes the arc's radius dimension
    return true;
  } else if (state.active.phase === 'start') {
    const center = state.joints.get(state.active.center);
    const start = state.joints.get(state.active.start);
    if (!center || !start) return false;
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const startAngle = angleBetween(center, start);
    let endAngle;
    if (arcState.lockedSweep !== null) {   // a typed sweep: that exact angle, in the winding direction the cursor has
      endAngle = endAngleFor(state, startAngle, angleBetween(center, pt));
      state.active.totalSweep = windingDir(state) * arcState.lockedSweep * Math.PI / 180;
    } else {
      endAngle = angleBetween(center, pt);
      if (Math.abs(Math.abs(endAngle - startAngle) - Math.PI) < 1e-9) endAngle += 1e-6;
    }

    const endPt = {
      x: center.x + radius * Math.cos(endAngle),
      y: center.y + radius * Math.sin(endAngle)
    };

    const endId = state.genJ();
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    // If the final click was on a snap target, it is applied to the generated end joint (not when a typed sweep holds the end)
    return commitArc(state, endId, { sweep: (state.active.totalSweep || 0) > 0, endSnap: (snap && snap.isLocked && arcState.lockedSweep === null) ? snap : null, radius });
  }
}

/**
 * THE commit of an Arc tool arc, both modes (TASK 1022: the 3-Point Arc makes the arc the Center Point Arc makes, through this one path): the arc shape on the
 * draw's joints [state.active.center, state.active.start, endId] (makeArc: its structural constraints), its direction `sweep`, a typed radius's dimension
 * (value `radius`), `extra(shapeId)` (the 3-point arc's own: a typed chord's dimension, the point its third click was on), the snaps of the clicks
 * (coincident / point-on-line / midpoint, applySnapConstraint), all in the draw's ONE undo step. The tool stays; the draw ends.
 */
function commitArc(state, endId, { sweep, endSnap = null, radius, extra = null }) {
    try {
      state.saveState();
      if (arcState.lockedSweep !== null && arcState.sweepAssign) applyLiveAssign(state, arcState.sweepAssign);   // TASK 1028 (B-13): `param = 90` in the sweep box updates that parameter
      const res = makeArc(state.joints, state.active.center, state.active.start, endId, 'CENTER', state.isConstructionMode || false);
      if (res && res.shapes) res.shapes.forEach(s => state.shapes.push(s));
      if (res && res.constraints) res.constraints.forEach(c => ConstraintManager.createConstraint(state, c.type, c, { source: 'arc' }));

      // Apply the winding DIRECTION to the new shape (the large-arc choice is derived from the joints, geometry.arcSweepInfo, task 550)
      if (res && res.shapes && res.shapes.length > 0) {
          const s = res.shapes[0];
          s.sweep = sweep;
      }

      if (res && res.shapes && res.shapes.length > 0) {
        const shapeId = res.shapes[0].id;
        // Only add a radius distance constraint if the user explicitly entered a radius
        if (arcState.lockedRadius != null) {
          if (arcState.radiusAssign) applyLiveAssign(state, arcState.radiusAssign);
          ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            shape: shapeId,
            value: radius,
            isRadius: true,
            expression: arcState.radiusExpression,
            ...(arcState.radiusName ? { name: arcState.radiusName } : {})
          }, { source: 'arc' });
        }
        if (extra) extra(shapeId);
      }

      try {
        if (state.active.centerSnap && state.active.centerSnap.isLocked) applySnapConstraint(state, state.active.center, state.active.centerSnap);
        if (state.active.startSnap && state.active.startSnap.isLocked) applySnapConstraint(state, state.active.start, state.active.startSnap);
        if (endSnap) {
          try { applySnapConstraint(state, endId, endSnap, { excludeJoints: [state.active.start] }); } catch (_) { }
        }
      } catch (_) { }

      closeArcBoxes();
      state.endUndoGroup();
      state.active = null;
      return true;
    } catch (_) {
      closeArcBoxes();
      try { state.endUndoGroup(); } catch (_) { }
      state.active = null;
      return false;
    }
}

/**
 * TASK 1022: the 3-Point Arc's clicks after the first (the start, placed on the press). `pos` = the pointer where the next box opens.
 * phase 'chord': this click is the END (a typed chord holds it at that distance from the start; a click on the start places nothing); the radius box opens.
 * phase 'bulge': this click is the third point: the arc from the start to the end through it (a typed radius: that radius, bulging to its side). On the line
 *   through the two ends no arc passes: nothing is placed, a hint says why, the draw waits for another point. A click on an existing POINT puts that point on
 *   the arc (the 3-point arc slot's rule); a line / curve / axis only gives the position. The centre is a new joint at the circle's centre.
 */
function handleThreePointArc(state, snap, pt, pos) {
  const start = state.joints.get(state.active.start);
  if (!start) return false;
  if (state.active.phase === 'chord') {
    const locked = arcState.lockedChord !== null;
    const endPt = chordEndFor(start, pt);
    if (tooSmall(Math.hypot(endPt.x - start.x, endPt.y - start.y))) return true;   // TASK 782: an end click on the start makes no arc
    const endId = state.genJ();
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    state.active.end = endId;
    state.active.endSnap = (!locked && snap && snap.isLocked) ? snap : null;   // a typed chord holds the end: a snap cannot move it
    state.active.typedChord = locked ? { value: arcState.lockedChord, expression: arcState.chordExpression, name: arcState.chordName, assign: arcState.chordAssign } : null;
    arcState.lockedChord = null; arcState.chordExpression = null; arcState.chordName = null; arcState.chordAssign = null;
    state.active.phase = 'bulge';
    arcState.minRadius = Math.hypot(endPt.x - start.x, endPt.y - start.y) / 2;
    openArcBox(pos || (arcState.screen ? { clientX: arcState.screen.x, clientY: arcState.screen.y } : null), 'radius');
    arcLog('create-end-point', { id: endId, pt: endPt });
    return true;
  }
  if (state.active.phase !== 'bulge') return false;
  const end = state.joints.get(state.active.end);
  if (!end) return false;
  const arc = threePointArcFor(start, end, pt);
  if (!arc) { showNotification(COLLINEAR_ARC_HINT, 'warning'); return true; }
  const centerId = state.genJ();
  state.joints.set(centerId, { x: arc.center.x, y: arc.center.y, fixed: false });
  state.active.center = centerId;
  const typedChord = state.active.typedChord;
  const onPoint = arcState.lockedRadius === null && snap && snap.isLocked && snap.type === 'joint' ? (snap.id || snap.targetId) : null;   // with a typed radius the click only picks the side
  return commitArc(state, state.active.end, {
    sweep: arc.sweep, endSnap: state.active.endSnap, radius: arc.radius,
    extra: (shapeId) => {
      if (typedChord) {   // the 3-point arc slot's typed span: a distance between the two ends
        if (typedChord.assign) applyLiveAssign(state, typedChord.assign);
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
          joints: [state.active.start, state.active.end], value: typedChord.value, expression: typedChord.expression,
          ...(typedChord.name ? { name: typedChord.name } : {})
        }, { source: 'arc' });
      }
      if (onPoint && state.joints.has(onPoint)) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.POINT_ON_LINE, { joint: onPoint, shape: shapeId }, { source: 'arc' });
    }
  });
}

// Programmatic finalize (the arc at its preview point)
export function finalizeArcFromActive(svg, state) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return false;

  const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : null;
  if (!previewPt) return false;

  if (state.active.subMode === ARC_MODES.CENTER_START_END && state.active.phase === 'start') {
    return handleCenterArc(state, shownSnap(state), previewPt, previewPt);   // TASK 1033 (X-01): the snap the cursor shows
  }

  return false;
}
