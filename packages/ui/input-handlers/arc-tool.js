// Multi-mode Arc tool (3-Point + Center Start/End) with live radius input
import { dbg } from '#core/debug.js';
import { TOOL_MODES, CONSTRAINT_TYPES, SNAP } from '#core/constants.js';
import { makeArc } from '#core/shapes.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { hideInput, setupNumericInput } from '#ui/numeric-input-manager.js';
import { angleBetween } from '#core/geometry.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { checkDragThreshold, resetToolState, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes } from '#ui/input-handlers/base-tool.js';

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


export const ARC_MODES = {
  CENTER_START_END: 'arc-cse'
};

// TASK 597: after the centre click the RADIUS box shows (a typed radius puts the start point at that distance along the cursor's direction; the
// arc gets the radius dimension it always got); after the start click the SWEEP box (degrees: a typed sweep is the arc's exact angle, the winding
// direction follows the cursor). Both through base-tool's shared creation-box path; a value not typed follows the cursor.
// lockedRadius / lockedSweep = what the user TYPED (null = the cursor sets it); `cursor` = the last world point, `screen` = the last pointer.
let arcState = { lockedRadius: null, lockedSweep: null, field: null, cursor: null, screen: null };
const BOX_RADIUS = { single: { field: 'radius' } };
const BOX_SWEEP = { single: { field: 'sweep' } };
const MIN_R = 1e-6;

function openArcBox(pos, field) {
  arcState.field = field; arcState.cursor = null;
  if (pos) arcState.screen = { x: pos.clientX, y: pos.clientY };
  openCreationBoxes(pos || { clientX: 0, clientY: 0 }, field === 'radius' ? BOX_RADIUS : BOX_SWEEP, [0]);
}
function closeArcBoxes() {
  arcState.lockedRadius = null; arcState.lockedSweep = null;
  if (arcState.field) hideInput();
  arcState.field = null; arcState.cursor = null; arcState.screen = null;
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
  if (!detail.typed || !detail.typed[0]) return;
  if (detail.field === 'radius') arcState.lockedRadius = detail.value > 0 ? detail.value : null;
  else if (detail.field === 'sweep') arcState.lockedSweep = detail.value > 0 ? Math.min(detail.value, 359.999) : null;
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
      // Only Center-Start-End mode (the only one there is) has these boxes
      if (state.active && state.active.subMode !== ARC_MODES.CENTER_START_END) return false;
      return detail.mode === 'single' && (detail.field === 'radius' || detail.field === 'sweep');
    },
    onApply: (detail) => {
      arcLog('liveDimensionApplied', detail);
      if (detail.confirmedBy !== 'enter') return;
      takeTyped(detail);
      const center = state.joints.get(state.active.center);
      if (!center) return;
      if (detail.field === 'radius') {   // Enter in the radius box: the start point goes at the typed radius (else the cursor's), then the sweep box
        const startPt = startPointFor(center, arcState.cursor || center);
        if (!(Math.hypot(startPt.x - center.x, startPt.y - center.y) > MIN_R)) { detail.keepOpen = true; return; }   // no radius yet: the box stays open
        handleCenterArc(state, null, startPt, startPt, arcState.screen && { clientX: arcState.screen.x, clientY: arcState.screen.y });
        detail.keepOpen = true;   // the sweep box is up now
      } else {   // Enter in the sweep box: the arc is placed
        const start = state.joints.get(state.active.start);
        if (!start) return;
        if (arcState.lockedSweep === null && !(Math.abs(state.active.totalSweep || 0) > 1e-9)) { detail.keepOpen = true; return; }   // no sweep yet: the box stays open
        const endPt = drawSweepPreview(state, center, start, arcState.cursor || start);
        handleCenterArc(state, null, endPt, endPt, null);
      }
    },
    onPreview: (detail) => {
      arcLog('liveDimensionPreview', detail);
      takeTyped(detail);
      redrawArcPreview(state);
    },
    onCancel: () => { arcState.lockedRadius = null; arcState.lockedSweep = null; } // Esc in the box also runs the canvas Esc (input-manager handleEscape)
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

  // Only center-start-end mode supported now
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

  // Only center-start-end mode supported
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
  if (state.active._tempStart && !localState.isDragging) {
    arcLog('clickIgnored', { phase: state.active.phase, reason: '_tempStart_click' }); state.active._tempStart = false; localState.dragStartScreen = null;
    openArcBox(e, 'radius');   // TASK 597: the radius shows now, after the centre click
    return true;
  }

  const snap = state.activeSnap || hitSnap;
  let pt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
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
    const typedRadius = arcState.lockedRadius;
    openArcBox(pos || (arcState.screen ? { clientX: arcState.screen.x, clientY: arcState.screen.y } : null), 'sweep');   // TASK 597: the sweep shows now, after the start click
    arcState.lockedRadius = typedRadius;   // the radius typed in the first box still becomes the arc's radius dimension
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

    try {
      state.saveState();
      const res = makeArc(state.joints, state.active.center, state.active.start, endId, 'CENTER', state.isConstructionMode || false);
      if (res && res.shapes) res.shapes.forEach(s => state.shapes.push(s));
      if (res && res.constraints) res.constraints.forEach(c => ConstraintManager.createConstraint(state, c.type, c, { source: 'arc' }));

      // Apply the winding DIRECTION to the new shape (the large-arc choice is derived from the joints, geometry.arcSweepInfo, task 550)
      if (res && res.shapes && res.shapes.length > 0) {
          const s = res.shapes[0];
          s.sweep = (state.active.totalSweep || 0) > 0;
      }

      if (res && res.shapes && res.shapes.length > 0) {
        const shapeId = res.shapes[0].id;
        // Only add a radius distance constraint if the user explicitly entered a radius
        if (arcState.lockedRadius != null) {
          ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            shape: shapeId,
            value: radius,
            isRadius: true
          }, { source: 'arc' });
        }
      }

      try {
        if (state.active.centerSnap && state.active.centerSnap.isLocked) applySnapConstraint(state, state.active.center, state.active.centerSnap);
        if (state.active.startSnap && state.active.startSnap.isLocked) applySnapConstraint(state, state.active.start, state.active.startSnap);
        // If the final click was on a snap target, attempt to apply it to the generated end joint (not when a typed sweep holds the end)
        if (snap && snap.isLocked && arcState.lockedSweep === null) {
          try { applySnapConstraint(state, endId, snap, { excludeJoints: [state.active.start] }); } catch (_) { }
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
}

// Programmatic finalize (the arc at its preview point)
export function finalizeArcFromActive(svg, state) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return false;

  const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : null;
  if (!previewPt) return false;

  if (state.active.subMode === ARC_MODES.CENTER_START_END && state.active.phase === 'start') {
    // Use preview snapTarget when programmatically finalizing
    const snap = (state.active.preview && state.active.preview.snapTarget) ? state.active.preview.snapTarget : state.active.startSnap;
    return handleCenterArc(state, snap, previewPt, previewPt);
  }

  return false;
}
