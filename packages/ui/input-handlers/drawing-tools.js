// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING TOOLS - Handles line, rectangle, slot and polygon drawing (TASK 1034 / 1039: Circle and Arc run in the tool session, #ui/tool-session.js)
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES, RECT_MODES, SLOT_MODES, ARC_MODES, SNAP, CONSTRAINT_TYPES } from '#core/constants.js';
import { addConstraint } from '#core/constraints.js';
import { findNearbyJoint } from '#core/joints.js';
import { makeRectFromTwoJoints, makeRectFromCenter, makeRectFrom3Points } from '#core/shapes.js';
import { setupLineTool, handleLinePointerDown, handleLinePointerMove, handleLinePointerUp, resetLineState } from '#ui/input-handlers/line-tool.js';
import { clearPreview } from '#ui/preview-manager.js';
import { setupRectTool, handleRectPointerDown, handleRectPointerMove, handleRectPointerUp, resetRectState } from '#ui/input-handlers/rect-tool.js';
import { setupSlotTool, handleSlotPointerDown, handleSlotPointerMove, handleSlotPointerUp, resetSlotState } from '#ui/input-handlers/slot-tool.js';
import { setupPolygonTool, handlePolygonPointerDown, handlePolygonPointerMove, handlePolygonPointerUp, resetPolygonState } from '#ui/input-handlers/polygon-tool.js'; // TASK 483
import { setHoverFromSnap } from '#ui/hover-manager.js';
import { refuseLiveInputClick } from '#ui/numeric-input-manager.js';

// Local state for drawing tools
let continueFrom = null;
let polylineOrigin = null;
let isDragging = false;
let dragStartScreen = null;
let justCreatedActive = false;

/**
 * Setup drawing tools event handlers
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 */
export function setupDrawingTools(svg, state) {
    dbg.log('drawing', '[drawing-tools] Setting up drawing tools...');
    
    // Initialize rectangle and slot modes if not set
    if (!state.rectMode) {
        state.rectMode = RECT_MODES.TWO_POINT;
    }
    if (!state.slotMode) {
        state.slotMode = SLOT_MODES.CENTER_TO_CENTER;
    }
    if (!state.arcMode) {
        state.arcMode = ARC_MODES.CENTER_START_END;   // TASK 1039: the Arc tool's variant (its session reads it: #ui/input-handlers/arc-tool.js ARC)
    }
    // Initialize line, rect, slot and polygon tools
    setupLineTool(svg, state);
    setupRectTool(svg, state);
    setupSlotTool(svg, state);
    setupPolygonTool(svg, state);
}

/**
 * Handle pointer down for drawing tools
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @param {object} hitSnap - Snap target if any
 * @param {object} w - World coordinates
 * @returns {boolean} True if event was handled
 */
export function handleDrawingPointerDown(e, svg, state, hitSnap, w) {
    if (![TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.SLOT, TOOL_MODES.POLYGON].includes(state.currentTool)) {
        return false;
    }
    
    dbg.log('drawing', `[drawing-tools] Pointer down for ${state.currentTool}`, { hitSnap, activeSnap: state.activeSnap, w });
    
    // TASK 1030 (I-17): a right press never reaches a drawing tool (input-manager handlePointerDown; Line's right-click: line-tool.js rightClickLine).

    // Reset drag tracking
    isDragging = false;
    dragStartScreen = { x: e.clientX, y: e.clientY };
    
    // Handle based on tool
    switch (state.currentTool) {
        case TOOL_MODES.LINE:
            return handleLinePointerDown(e, svg, state, hitSnap, w);
        case TOOL_MODES.RECT:
            return handleRectPointerDown(e, svg, state, hitSnap, w);
        case TOOL_MODES.SLOT:
            return handleSlotPointerDown(e, svg, state, hitSnap, w);
        case TOOL_MODES.POLYGON:
            return handlePolygonPointerDown(e, svg, state, hitSnap, w);
    }
    
    return false;
}

// Inline per-tool pointer-down handlers removed; delegating to tool modules

/**
 * Handle pointer move for drawing tools
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @param {object} w - World coordinates
 * @returns {boolean} True if event was handled
 */
export function handleDrawingPointerMove(e, svg, state, w) {
    if (![TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.SLOT, TOOL_MODES.POLYGON].includes(state.currentTool)) return false;

    // Debug: show active snap while moving (guarded; enable with `window.ug.debug.verboseDrawingLogs = true`)
    try{
        const drawVerbose = (typeof window !== 'undefined' && window.ug && window.ug.debug && window.ug.debug.verboseDrawingLogs) ? true : false;
        const snapKey = state.snapTarget ? `${state.currentTool}:${state.snapTarget.type}:${state.snapTarget.targetId}:${state.snapTarget.isLocked}` : `${state.currentTool}:null`;
        if (drawVerbose || snapKey !== handleDrawingPointerMove._lastSnapKey) {
            dbg.debug('drawing', '[drawing-tools] pointerMove', { tool: state.currentTool, snapTarget: state.snapTarget, w });
            handleDrawingPointerMove._lastSnapKey = snapKey;
        }
    }catch(_){ }

    // Populate unified hover state from snapTarget ONLY when actively drawing
    // When idle (no state.active), hover is managed by updateHover in hover-manager
    if (state.active) {
        setHoverFromSnap(state);
    }

    switch (state.currentTool) {
        case TOOL_MODES.LINE:
            return handleLinePointerMove(e, svg, state, w);
        case TOOL_MODES.RECT:
            return handleRectPointerMove(e, svg, state, w);
        case TOOL_MODES.SLOT:
            return handleSlotPointerMove(e, svg, state, w);
        case TOOL_MODES.POLYGON:
            return handlePolygonPointerMove(e, svg, state, w);
        default:
            return false;
    }
}

/**
 * Handle pointer up for drawing tools
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @param {object} hitSnap - Snap target if any
 * @param {object} w - World coordinates
 * @param {boolean} wasDragging - Whether this was a drag operation
 * @returns {boolean} True if event was handled
 */
export function handleDrawingPointerUp(e, svg, state, hitSnap, w, wasDragging) {
    if (![TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.SLOT, TOOL_MODES.POLYGON].includes(state.currentTool)) {
        return false;
    }
    try{ dbg.log('drawing', '[drawing-tools] pointerUp', { tool: state.currentTool, hitSnap, activeSnap: state.activeSnap, w, wasDragging }); }catch(_){ }
    if (refuseLiveInputClick()) return true;   // TASK 782: a typed size the box refuses (0 or less) is fixed or cleared first: no click places anything meanwhile

    // Handle based on tool
    switch (state.currentTool) {
        case TOOL_MODES.LINE:
            return handleLinePointerUp(e, svg, state, hitSnap, w, wasDragging);
        case TOOL_MODES.RECT:
            return handleRectPointerUp(e, svg, state, hitSnap, w, wasDragging);
        case TOOL_MODES.SLOT:
            return handleSlotPointerUp(e, svg, state, hitSnap, w, wasDragging);
        case TOOL_MODES.POLYGON:
            return handlePolygonPointerUp(e, svg, state, hitSnap, w);
    }
    
    return false;
}

// Inline per-tool pointer-up handlers removed; delegating to tool modules

/**
 * Reset drawing state (called when switching tools)
 * Accepts state so sub-tool reset functions can properly clear their state.
 */
export function resetDrawingState(state) {
    continueFrom = null;
    polylineOrigin = null;
    isDragging = false;
    dragStartScreen = null;
    justCreatedActive = false;
    try { resetLineState(state); } catch(_) {}
    try { resetRectState(state); } catch(_) {}
    try { resetSlotState(state); } catch(_) {}
    try { resetPolygonState(state); } catch(_) {}
    try { clearPreview(state); } catch(_) {}
}
