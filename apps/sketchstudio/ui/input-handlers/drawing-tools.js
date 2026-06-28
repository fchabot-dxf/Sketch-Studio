// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING TOOLS - Handles line, circle, and rectangle drawing
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES, RECT_MODES, SNAP, CONSTRAINT_TYPES } from '#core/constants.js';
import { addConstraint } from '#core/constraints.js';
import { findNearbyJoint } from '#core/joints.js';
import { makeRectFromTwoJoints, makeRectFromCenter, makeRectFrom3Points } from '#core/shapes.js';
import { setupLineTool, handleLinePointerDown, handleLinePointerMove, handleLinePointerUp, resetLineState, finalizeLineFromActive } from './line-tool.js';
import { clearPreview } from '#ui/preview-manager.js';
import { setupRectTool, handleRectPointerDown, handleRectPointerMove, handleRectPointerUp, resetRectState } from './rect-tool.js';
import { setupCircleTool, handleCirclePointerDown, handleCirclePointerMove, handleCirclePointerUp, resetCircleState } from './circle-tool.js';
// Polygon tool removed: polygon-tool.js import removed
import { setupArcTool, handleArcPointerDown, handleArcPointerMove, handleArcPointerUp, resetArcState } from './arc-tool.js';
import { handleJointSelection } from './selection-tools.js';
import { setHoverFromSnap } from '../hover-manager.js';

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
    
    // Initialize rectangle mode if not set
    if (!state.rectMode) {
        state.rectMode = RECT_MODES.TWO_POINT;
    }
    // Initialize line, rect, circle, polygon and arc tools
    setupLineTool(svg, state);
    setupRectTool(svg, state);
    setupCircleTool(svg, state);
    setupArcTool(svg, state);
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
    if (![TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.POLYGON, TOOL_MODES.ARC].includes(state.currentTool)) {
        return false;
    }
    
    dbg.log('drawing', `[drawing-tools] Pointer down for ${state.currentTool}`, { hitSnap, activeSnap: state.activeSnap, w });
    
    // Right-click (button === 2) finalizes the current line segment (if active)
    if (state.currentTool === TOOL_MODES.LINE && e && typeof e.button === 'number' && e.button === 2 && state.active) {
        try { e.preventDefault(); finalizeLineFromActive(svg, state); } catch(_) {}
        return true;
    }
    
    // Reset drag tracking
    isDragging = false;
    dragStartScreen = { x: e.clientX, y: e.clientY };
    
    // Handle based on tool
    switch (state.currentTool) {
        case TOOL_MODES.LINE:
            return handleLinePointerDown(e, svg, state, hitSnap, w);
        case TOOL_MODES.RECT:
            return handleRectPointerDown(e, svg, state, hitSnap, w);
        case TOOL_MODES.CIRCLE:
            return handleCirclePointerDown(e, svg, state, hitSnap, w);
        case TOOL_MODES.ARC:
            // If user clicked on a JOINT that belongs to an existing arc, start a joint drag instead of creating a new arc
            try {
                if (hitSnap && hitSnap.type === 'joint' && state.shapes && state.shapes.some(s => s && s.type === 'arc' && s.joints && s.joints.includes(hitSnap.targetId))) {
                    return handleJointSelection(e, svg, state, { id: hitSnap.targetId, j: state.joints.get(hitSnap.targetId) });
                }
            } catch(_) {}
            return handleArcPointerDown(e, svg, state, hitSnap, w);
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
    if (![TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.POLYGON, TOOL_MODES.ARC].includes(state.currentTool)) return false; 

    // Helper to delegate to selection pointer move (avoid circular import at top level)
    function awaitSelectionMove(ev, svgEl, st) {
        // Import lazily to avoid cyclic deps
        const sel = require('./selection-tools.js');
        return sel.handleSelectionPointerMove(ev, svgEl, st);
    }

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

    // If a joint/cluster drag is active, delegate to selection pointer move so joints can be dragged
    if (state.drag && (state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER)) {
        try { return awaitSelectionMove(e, svg, state); } catch(_) { /* fall-through */ }
    }

    switch (state.currentTool) {
        case TOOL_MODES.LINE:
            return handleLinePointerMove(e, svg, state, w);
        case TOOL_MODES.RECT:
            return handleRectPointerMove(e, svg, state, w);
        case TOOL_MODES.CIRCLE:
            return handleCirclePointerMove(e, svg, state, w);
        case TOOL_MODES.ARC:
            return handleArcPointerMove(e, svg, state, w);
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
    if (![TOOL_MODES.LINE, TOOL_MODES.RECT, TOOL_MODES.CIRCLE, TOOL_MODES.POLYGON, TOOL_MODES.ARC].includes(state.currentTool)) {
        return false;
    }
    try{ dbg.log('drawing', '[drawing-tools] pointerUp', { tool: state.currentTool, hitSnap, activeSnap: state.activeSnap, w, wasDragging }); }catch(_){ }

    // If a joint drag is active, delegate to selection pointer up so drag finalizes correctly
    if (state.drag && (state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER)) {
        try { const sel = require('./selection-tools.js'); return sel.handleSelectionPointerUp(e, svg, state); } catch(_){ }
    }

    // Handle based on tool
    switch (state.currentTool) {
        case TOOL_MODES.LINE:
            return handleLinePointerUp(e, svg, state, hitSnap, w, wasDragging);
        case TOOL_MODES.RECT:
            return handleRectPointerUp(e, svg, state, hitSnap, w, wasDragging);
        case TOOL_MODES.CIRCLE:
            return handleCirclePointerUp(e, svg, state, hitSnap, w, wasDragging);
        case TOOL_MODES.ARC:
            return handleArcPointerUp(e, svg, state, hitSnap, w, wasDragging);
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
    try { resetCircleState(state); } catch(_) {}
    // Polygon tool removed; no reset needed
    try { resetArcState(state); } catch(_) {}
    try { clearPreview(state); } catch(_) {}
}

/**
 * Helper function to create a circle shape
 * Note: Circles are created with two joints - center and radius point
 * @param {Map} joints - Joints map
 * @param {string} centerId - Center joint ID
 * @param {string} radiusPtId - Radius point joint ID
 * @param {Function} genJ - Function to generate new joint IDs
 * @returns {object} Circle shape object
 */
export function makeCircle(joints, centerId, radiusPtId, genJ) {
    const center = joints.get(centerId);
    const radiusPt = joints.get(radiusPtId);
    
    if (!center || !radiusPt) {
        return null;
    }
    
    return {
        id: 'circle_' + Date.now(),
        type: 'circle',
        joints: [centerId, radiusPtId]
    };
}