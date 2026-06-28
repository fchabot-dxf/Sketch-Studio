// Circle tool - preview and creation
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { addConstraint } from '#core/constraints.js';
import { setupNumericInput, showSingleInput, hideInput, resetLockedDimensions, isInputActive, updateInputPosition } from '../numeric-input-manager.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { findSnap } from '#ui/snap-detection.js';
import { worldToScreen } from '#ui/coords.js';
import { checkDragThreshold, beginDrawing, resetToolState, safeUpdatePreview, setupDimensionListeners } from './base-tool.js';

let circleState = { lockedRadius: null };
const localState = { isDragging: false, dragStartScreen: null };

export function setupCircleTool(svg, state){
    setupNumericInput(svg, state);
    setupDimensionListeners(state, TOOL_MODES.CIRCLE, {
        onApply: (detail) => {
            if (detail.mode === 'single' && detail.field === 'radius') {
                circleState.lockedRadius = detail.value;
                if (detail.confirmedBy === 'enter') {
                    try { finalizeCircleFromActive(svg, state); } catch (_) { }
                }
            }
        },
        onPreview: (detail) => {
            if (detail.mode !== 'single' || detail.field !== 'radius') return;
            const v = detail.value;
            const center = state.joints.get(state.active.start) || state.active.startPt;
            if (center && state.active.preview) {
                const pt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : center;
                try { updatePreview(state, 'circle', [state.active.start], pt, { radius: v }); } catch (_) { }
                try { state.tempMousePos = pt; } catch (_) { }
            }
        },
        onCancel: () => { circleState.lockedRadius = null; }
    });
}

export function resetCircleState(state){ 
    resetToolState(state, TOOL_MODES.CIRCLE, localState);
}

export function handleCirclePointerDown(e, svg, state, hitSnap, w){
    // FIX: If we are waiting for the second click (radius definition), consume the event 
    // so we don't start a new circle inside the current one. Let PointerUp handle finalization.
    if (state.active && state.active.mode === TOOL_MODES.CIRCLE && state.active.waitingForSecondClick) {
        return true;
    }

    const { startId, startPt, snap } = beginDrawing(state, hitSnap, w, TOOL_MODES.CIRCLE, {
        centerSnapTarget: null,
        waitingForSecondClick: false
    });
    // Override centerSnapTarget with the resolved snap
    state.active.centerSnapTarget = snap;
    localState.dragStartScreen = { x: e.clientX, y: e.clientY };
    localState.isDragging = false;
    return true;
}

export function handleCirclePointerMove(e, svg, state, w){
    if(!state.active || state.active.mode!==TOOL_MODES.CIRCLE) return false;
    // Check drag distance to distinguish intentional drag from a shaky click
    if (checkDragThreshold(e, localState.dragStartScreen)) localState.isDragging = true;
    const previewPt = state.snapTarget ? state.snapTarget.pt : w;
    const center = state.joints.get(state.active.start);
    if(!center) return false;
    if (isInputActive()) { updateInputPosition(e.clientX, e.clientY); }
    const dx = previewPt.x - center.x, dy = previewPt.y - center.y;
    let r = Math.hypot(dx, dy);
    if (circleState.lockedRadius) r = circleState.lockedRadius;
    safeUpdatePreview(state, 'circle', [state.active.start], previewPt, { radius: r });
    return true;
}

export function handleCirclePointerUp(e, svg, state, hitSnap, w, wasDraggingGlobal){
    if(!state.active || state.active.mode!==TOOL_MODES.CIRCLE) return false;

    // FIX: Hybrid Workflow Logic
    // If user clicked (did not drag) and we aren't already waiting, switch to "Waiting for Second Click" mode.
    if (!localState.isDragging && !state.active.waitingForSecondClick) {
        state.active.waitingForSecondClick = true;
        localState.dragStartScreen = null; 
        return true;
    }

    // Otherwise (if we Dragged OR if this is the Second Click), finalize the circle.
    let snapForEnd = hitSnap;
    if (state.active.waitingForSecondClick) {
        try {
            snapForEnd = findSnap(state.joints, state.shapes, svg, { x: e.clientX, y: e.clientY }, [state.active.start]);
        } catch (_) { snapForEnd = null; }
    }
    const endPt = (snapForEnd && snapForEnd.isLocked && snapForEnd.pt) ? snapForEnd.pt : w;
    const center = state.joints.get(state.active.start);
    if(!center) return false;
    const dx = endPt.x - center.x, dy = endPt.y - center.y;
    let r = Math.hypot(dx, dy);
    if (circleState.lockedRadius) r = circleState.lockedRadius;

    state.saveState();
    const shapeId = 's' + Date.now();

    state.shapes.push({ id: shapeId, type: 'circle', joints: [state.active.start], radius: r, isConstruction: !!state.isConstructionMode });
    
    // Only add a radius distance constraint if the user explicitly entered a radius
    if (circleState.lockedRadius != null) {
        addConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shape: shapeId, value: r, isRadius: true });
    }

    try{ 
        if(state.active && state.active.centerSnapTarget && state.active.centerSnapTarget.isLocked){ 
            applySnapConstraint(state, state.active.start, state.active.centerSnapTarget); 
        } 
    }catch(_){ }

    circleState.lockedRadius = null;
    localState.isDragging = false;
    localState.dragStartScreen = null;
    try{ resetLockedDimensions(); }catch(_){ }
    try{ hideInput(); }catch(_){ }
    state.endUndoGroup(); state.active=null; return true;
}

/**
 * Finalize circle creation immediately (used when Enter confirms radius)
 */
export function finalizeCircleFromActive(svg, state){
    if(!state.active || state.active.mode !== TOOL_MODES.CIRCLE) return false;
    try{
        const center = state.joints.get(state.active.start);
        if(!center) return false;
        const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : null;
        if(!previewPt) return false;
        let r = Math.hypot(previewPt.x - center.x, previewPt.y - center.y);
        if (circleState.lockedRadius) r = circleState.lockedRadius;
        state.saveState();
        const shapeId = 's' + Date.now();
        state.shapes.push({ id: shapeId, type: 'circle', joints: [state.active.start], radius: r, isConstruction: !!state.isConstructionMode });
        // Only add a radius distance constraint if the user explicitly entered a radius
        if (circleState.lockedRadius != null) {
            addConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shape: shapeId, value: r, isRadius: true });
        }
        circleState.lockedRadius = null; try{ resetLockedDimensions(); }catch(_){ }
        try{ hideInput(); }catch(_){ }
        state.endUndoGroup(); state.active = null; return true;
    }catch(_){ try{ state.endUndoGroup(); }catch(_){ } state.active = null; return false; }
}

export function handleCircleKeyDown(e, svg, state) {
    if (state.currentTool !== TOOL_MODES.CIRCLE) return false;
    if (!state.active || !state.active.start) return false;
    if (/^[0-9.]$/.test(e.key) && !isInputActive()) {
        const center = state.joints.get(state.active.start) || state.active.startPt;
        const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : center;
        const currentRadius = Math.hypot((previewPt.x - center.x), (previewPt.y - center.y));
        const midWorld = { x: (center.x + previewPt.x) / 2, y: (center.y + previewPt.y) / 2 };
        const midScreen = worldToScreen(svg, midWorld);
        showSingleInput(midScreen.x, midScreen.y, currentRadius, 'radius');
        return true;
    }
    return false;
}

// Test helper to set locked radius during unit tests
export function _test_setCircleLockedRadius(v) { circleState.lockedRadius = v; }
