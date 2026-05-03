// ═══════════════════════════════════════════════════════════════════════════════
// BASE TOOL - Shared utilities for all drawing tools
// ═══════════════════════════════════════════════════════════════════════════════

import { updatePreview } from '../preview-manager.js';

/**
 * Check if pointer movement exceeds drag threshold.
 * @param {PointerEvent} e - Current pointer event
 * @param {{x:number, y:number}|null} dragStart - Screen position at pointer down
 * @param {number} threshold - Pixel threshold (default 3)
 * @returns {boolean} True if dragging
 */
export function checkDragThreshold(e, dragStart, threshold = 3) {
    if (!dragStart) return false;
    return Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > threshold;
}

/**
 * Common pointer-down initialization for drawing tools.
 * Creates a start joint, sets state.active, begins undo group.
 * @returns {{ startId, startPt, snap }}
 */
export function beginDrawing(state, hitSnap, worldPt, toolMode, extraProps = {}) {
    try { state.beginUndoGroup(); } catch (_) { }
    const snap = state.activeSnap || hitSnap;
    const startPt = (snap && snap.isLocked && snap.pt) ? snap.pt : worldPt;
    const startId = state.genJ();
    state.joints.set(startId, { x: startPt.x, y: startPt.y, fixed: false });
    state.active = {
        mode: toolMode,
        start: startId,
        startPt,
        preview: null,
        polylineOrigin: startId,
        _tempStart: true,
        startSnapTarget: snap,
        ...extraProps
    };
    return { startId, startPt, snap };
}

/**
 * Common reset for drawing tools. Clears active state, drag tracking, preview constraints.
 * @param {object} state - App state
 * @param {string} toolMode - TOOL_MODES constant to match
 * @param {object} localState - Mutable local state object with isDragging, dragStartScreen
 */
export function resetToolState(state, toolMode, localState) {
    if (state?.active?.mode === toolMode) state.active = null;
    localState.isDragging = false;
    localState.dragStartScreen = null;
    if (state?.previewConstraint) {
        const idx = state.constraints.indexOf(state.previewConstraint);
        if (idx >= 0) state.constraints.splice(idx, 1);
        state.previewConstraint = null;
    }
    if (state) state.inference = null;
}

/**
 * Safely update preview and set tempMousePos. Wraps updatePreview in try-catch.
 */
export function safeUpdatePreview(state, type, jointIds, pt, opts) {
    try { updatePreview(state, type, jointIds, pt, opts); } catch (_) { }
    state.tempMousePos = pt;
}

/**
 * Wire up liveDimensionApplied / liveDimensionPreview / liveDimensionCancelled listeners.
 * @param {object} state - App state
 * @param {string} toolMode - TOOL_MODES constant to guard on
 * @param {object} config - { onApply, onPreview, onCancel, guard? }
 */
export function setupDimensionListeners(state, toolMode, config) {
    // Guard for non-browser test environments where `window.addEventListener` may not exist
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    window.addEventListener('liveDimensionApplied', (e) => {
        if (state.currentTool !== toolMode || !state.active) return;
        if (config.guard && !config.guard(e.detail)) return;
        config.onApply(e.detail);
    });
    window.addEventListener('liveDimensionPreview', (e) => {
        if (state.currentTool !== toolMode || !state.active) return;
        if (config.guard && !config.guard(e.detail)) return;
        config.onPreview(e.detail);
    });
    window.addEventListener('liveDimensionCancelled', () => {
        if (state.currentTool !== toolMode) return;
        config.onCancel();
    });
}
