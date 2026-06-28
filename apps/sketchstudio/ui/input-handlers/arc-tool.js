// Multi-mode Arc tool (3-Point + Center Start/End) with live radius input
import { dbg } from '#core/debug.js';
import { TOOL_MODES, CONSTRAINT_TYPES, SNAP } from '#core/constants.js';
import { makeArc } from '#core/shapes.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { showSingleInput, isInputActive, hideInput, resetLockedDimensions, updateInputPosition, setupNumericInput } from '../numeric-input-manager.js';
import { worldToScreen } from '#ui/coords.js';
import { angleBetween } from '#core/geometry.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { checkDragThreshold, resetToolState, safeUpdatePreview, setupDimensionListeners } from './base-tool.js';

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

let arcState = { lockedRadius: null };

export function setupArcTool(svg, state) {
  arcLog('setupArcTool called', { svg: !!svg });
  try { setupUnifiedInput(svg, state); } catch (_) { }

  setupDimensionListeners(state, TOOL_MODES.ARC, {
    guard: (detail) => {
      // Only Center-Start-End mode supports radius input
      if (state.active && state.active.subMode !== ARC_MODES.CENTER_START_END) return false;
      return true;
    },
    onApply: (detail) => {
      arcLog('liveDimensionApplied', detail);
      if (detail.mode === 'single' && detail.field === 'radius') {
        arcState.lockedRadius = detail.value;
        if (detail.confirmedBy === 'enter') {
          try { finalizeArcFromActive(svg, state); } catch (_) { }
        }
      }
    },
    onPreview: (detail) => {
      arcLog('liveDimensionPreview', detail);
      if (detail.mode !== 'single' || detail.field !== 'radius') return;
      const v = detail.value;
      const center = state.joints.get(state.active.center) || state.active.centerPt;
      if (center && state.active.preview) {
        state.active.preview.radius = v;
        try { state.tempMousePos = state.active.preview.pt; } catch (_) { }
      }
    },
    onCancel: () => { arcState.lockedRadius = null; }
  });

  if (!state.arcMode) state.arcMode = ARC_MODES.CENTER_START_END;
}


export function resetArcState(state) {
  resetToolState(state, TOOL_MODES.ARC, localState);
}

// Test helper to set locked radius during unit tests
export function _test_setArcLockedRadius(v) { arcState.lockedRadius = v; }

export function handleArcPointerDown(e, svg, state, hitSnap, w) {
  arcLog('pointerDown', { x: e && e.clientX, y: e && e.clientY, arcMode: state && state.arcMode });
  if (state.active && state.active.mode === TOOL_MODES.ARC) return true;
  try { state.beginUndoGroup(); } catch (_) { }
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

  if (checkDragThreshold(e, localState.dragStartScreen, SNAP.DRAG_THRESHOLD || 2)) localState.isDragging = true;

  dbg.debug('app', '[arc-tool] pointerMove', { phase: state.active && state.active.phase, isDragging: localState.isDragging, previewPt });

  // Only center-start-end mode supported
  if (state.active.phase === 'center') {
    safeUpdatePreview(state, 'line', [state.active.center], previewPt);
  } else if (state.active.phase === 'start') {
    const center = state.joints.get(state.active.center);
    const start = state.joints.get(state.active.start);
    if (!center || !start) return false;
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const startAngle = angleBetween(center, start);
    let endAngle = angleBetween(center, previewPt);

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

    // Determine flags based on total accumulated sweep
    const largeArc = Math.abs(state.active.totalSweep) > Math.PI;
    const sweep = state.active.totalSweep > 0; // true = CCW, false = CW

    // Avoid exact PI difference (SVG edge case)
    if (Math.abs(endAngle - startAngle) === Math.PI) {
      previewPt.x += 0.0001;
      endAngle = angleBetween(center, previewPt);
    }

    safeUpdatePreview(state, 'arc', [], previewPt, { 
        subMode: 'arc-cse', 
        center: state.active.center, 
        radius, 
        startAngle, 
        endAngle,
        largeArc,
        sweep
    });

    if (isInputActive()) updateInputPosition(e.clientX, e.clientY);
  }

  return true;
}

export function handleArcPointerUp(e, svg, state, hitSnap, w, wasDragging) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return false;
  dbg.debug('app', '[arc-tool] pointerUp', { phase: state.active && state.active.phase, wasDragging, isDragging: localState.isDragging });
  if (state.active._tempStart && !localState.isDragging) { arcLog('clickIgnored', { phase: state.active.phase, reason: '_tempStart_click' }); state.active._tempStart = false; localState.dragStartScreen = null; return true; }

  const snap = state.activeSnap || hitSnap;
  const pt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;

  const res = handleCenterArc(state, snap, pt, w);
  try { clearPreview(state); } catch (_) { }
  localState.isDragging = false; localState.dragStartScreen = null;
  arcLog('pointerUp-result', { res, shapes: (state.shapes || []).length });
  dbg.debug('app', '[arc-tool] pointerUp -> result', { res, shapes: (state.shapes || []).length });
  return res;
}



function handleCenterArc(state, snap, pt, w) {
  if (state.active.phase === 'center') {
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
    return true;
  } else if (state.active.phase === 'start') {
    const center = state.joints.get(state.active.center);
    const start = state.joints.get(state.active.start);
    if (!center || !start) return false;
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    let endAngle = angleBetween(center, pt);

    const startAngle = angleBetween(center, start);
    if (Math.abs(Math.abs(endAngle - startAngle) - Math.PI) < 1e-9) endAngle += 1e-6;

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

      // Apply winding flags to the new shape
      if (res && res.shapes && res.shapes.length > 0) {
          const s = res.shapes[0];
          s.largeArc = Math.abs(state.active.totalSweep || 0) > Math.PI;
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
          arcState.lockedRadius = null;
          try{ resetLockedDimensions(); }catch(_){ }
          try{ hideInput(); }catch(_){ }
        }
      }

      try {
        if (state.active.centerSnap && state.active.centerSnap.isLocked) applySnapConstraint(state, state.active.center, state.active.centerSnap);
        if (state.active.startSnap && state.active.startSnap.isLocked) applySnapConstraint(state, state.active.start, state.active.startSnap);
        // If the final click was on a snap target, attempt to apply it to the generated end joint
        if (snap && snap.isLocked) {
          try { applySnapConstraint(state, endId, snap, { excludeJoints: [state.active.start] }); } catch (_) { }
        }
      } catch (_) { }

      state.endUndoGroup();
      state.active = null;
      return true;
    } catch (_) {
      try { state.endUndoGroup(); } catch (_) { }
      state.active = null;
      return false;
    }
  }
}

export function handleArcKeyDown(e, svg, state) {
  if (state.currentTool !== TOOL_MODES.ARC) return false;

  if (e.key === 'Escape') {
    if (state.active && state.active.mode === TOOL_MODES.ARC) {
      try {
        if (state.active.center) state.joints.delete(state.active.center);
        if (state.active.start) state.joints.delete(state.active.start);
        state.endUndoGroup();
      } catch (_) { }
      state.active = null;
      resetArcState(state);
      return true;
    }
    return false;
  }

  if (/^[0-9.]$/.test(e.key) && !isInputActive() && state.active && state.active.subMode === ARC_MODES.CENTER_START_END) {
    const center = state.joints.get(state.active.center) || state.active.centerPt;
    const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : center;
    const currentRadius = Math.hypot((previewPt.x - center.x), (previewPt.y - center.y));
    const midWorld = { x: (center.x + previewPt.x) / 2, y: (center.y + previewPt.y) / 2 };
    const midScreen = worldToScreen(svg, midWorld);
    showSingleInput(midScreen.x, midScreen.y, currentRadius, 'radius', e.key);
    return true;
  }

  return false;
}

// Programmatic finalize (used by live input enter confirmation)
export function finalizeArcFromActive(svg, state) {
  if (!state.active || state.active.mode !== TOOL_MODES.ARC) return false;

  const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : null;
  if (!previewPt) return false;

  if (state.active.subMode === ARC_MODES.CENTER_START_END && state.active.phase === 'start') {
    // Use preview snapTarget when programmatically finalizing (e.g., from live input)
    const snap = (state.active.preview && state.active.preview.snapTarget) ? state.active.preview.snapTarget : state.active.startSnap;
    return handleCenterArc(state, snap, previewPt, previewPt);
  }
  
  return false;
}
