// ═══════════════════════════════════════════════════════════════════════════════
// LINE TOOL - Handles line and polyline behavior with Auto-Coincident snapping
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES, SNAP, CONSTRAINT_TYPES, INFERENCE_TYPES } from '#core/constants.js';
import { addConstraint } from '#core/constraints.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { findNearbyJoint } from '#core/joints.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { findInference } from '#core/inference-engine.js';
import { screenToWorld, worldToScreen } from '#core/geometry.js';
import { hideInput, resetLockedDimensions, isInputActive, updateInputPosition } from '../numeric-input-manager.js';
import { updatePreview, clearPreview } from '../preview-manager.js';
import { checkDragThreshold, resetToolState, safeUpdatePreview, setupDimensionListeners } from './base-tool.js';
import { clearHover } from '../hover-manager.js';
import { handleLiveLineKeyDown, updateLiveLinePreview, hideLiveInputs } from './live-dimension-input.js';

let lineState = { lockedLength: null, lockedAngle: null, isDriven: false };

const SNAP_DEBUG = false;
const localState = { isDragging: false, dragStartScreen: null };
let justCreatedActive = false;
let lastLineCommitTime = 0;
const LINE_POINTERUP_DEBOUNCE_MS = 500;

function canPreviewLineInference(state, startId, endId, newShapeId, activeInf) {
    if (!activeInf) return false;
    if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [startId, endId] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints: [startId, endId] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PERPENDICULAR, { shapes: [newShapeId, target] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.TANGENT) {
        const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        const targetShape = state.shapes.find(s => s && s.id === target);
        if (!targetShape || !targetShape.joints || targetShape.joints.length < 2) return false;
        const [j0, j1] = targetShape.joints;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { full: false }).ok;
    }
    return true;
}

function canApplyLineInference(state, startId, endId, newShapeId, activeInf) {
    if (!activeInf) return false;
    if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [startId, endId] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints: [startId, endId] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PERPENDICULAR, { shapes: [newShapeId, target] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.TANGENT) {
        const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        const targetShape = state.shapes.find(s => s && s.id === target);
        if (!targetShape || !targetShape.joints || targetShape.joints.length < 2) return false;
        const [j0, j1] = targetShape.joints;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { full: true }).ok;
    }
    return true;
}

export function setupLineTool(svg, state) {
    // Listen for live dimension commit from the unified input system (guarded for test envs)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('live-line-commit', (e) => {
            dbg.log('line-tool', '[DEBUG LINE] live-line-commit event:', e.detail);
            if (state.currentTool === TOOL_MODES.LINE && state.active) {
                lineState.lockedLength = e.detail.length;
                lineState.lockedAngle = e.detail.angle;
                lineState.isDriven = !!e.detail.isDriven;
                dbg.log('line-tool', '[DEBUG LINE] Locked state updated:', lineState);
                try { finalizeLineFromActive(svg, state); } catch (err) { console.error('[DEBUG LINE] Finalize error:', err); }
            }
        });
    }
}

export function handleLineKeyDown(e, svg, state) {
    dbg.log('line-tool', '[DEBUG LINE] KeyDown:', e.key);
    if (state.currentTool !== TOOL_MODES.LINE) return false;
    if (!state.active || !state.active.start) return false;

    // Use unified live dimension input first — if a length is being typed,
    // Enter belongs to that input.
    if (handleLiveLineKeyDown(e, svg, state)) {
        dbg.log('line-tool', '[DEBUG LINE] Handled by live input');
        return true;
    }

    // Enter: end the polyline chain, keeping only segments that were already
    // committed by clicks. The current preview segment (the rubber-band from
    // the last click to the cursor) is DISCARDED — same as Escape but more
    // ergonomic to reach for. deactivateLineTool removes the in-flight start
    // joint and any pending coincident constraint that the polyline auto-added.
    if (e.key === 'Enter') {
        try { deactivateLineTool(state); } catch (err) { console.error('[line-tool] Enter deactivate error:', err); }
        return true;
    }

    return false;
}

export function resetLineState(state) {
    if(state){ state.continueFrom = null; state.polylineOrigin = null; }
    justCreatedActive = false;
    lastLineCommitTime = 0;
    lineState.lockedLength = null;
    lineState.lockedAngle = null;
    lineState.isDriven = false;
    hideLiveInputs();
    resetToolState(state, TOOL_MODES.LINE, localState);
}

export function handleLinePointerDown(e, svg, state, hitSnap, w) {
    console.log('[DEBUG line-tool] handleLinePointerDown', { 
        hitSnap: hitSnap ? { type: hitSnap.type, targetId: hitSnap.targetId, pt: hitSnap.pt, isLocked: hitSnap.isLocked } : null,
        hasActive: !!state.active,
        activeStart: state.active?.start,
        w 
    });
    if (state.active && state.active.start) return true;

    if (state.continueFrom) {
        const prevId = state.continueFrom;
        const prevPt = state.joints.get(prevId) || { x: 0, y: 0 };
        const newStartId = state.genJ();
        state.joints.set(newStartId, { x: prevPt.x, y: prevPt.y, fixed: false });
        try{ addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [prevId, newStartId] }); }catch(_){ }

        state.active = {
            mode: TOOL_MODES.LINE,
            start: newStartId,
            startPt: { x: prevPt.x, y: prevPt.y },
            preview: null,
            polylineOrigin: state.polylineOrigin
        };
        state.continueFrom = null;
        justCreatedActive = true;
        return true;
    }
    try{ state.beginUndoGroup(); }catch(_){ }
    const startPt = hitSnap ? hitSnap.pt : w;

    if (hitSnap && hitSnap.type === 'joint'){
        const resolvedId = hitSnap.targetId;
        const anchorIds = new Set(['j_origin']);
        if (anchorIds.has(resolvedId)) {
            // If the hit is the anchored origin, use it directly as the start (do not create a synthetic coincident joint)
            state.active = { mode: TOOL_MODES.LINE, start: resolvedId, startPt: startPt, preview: null, polylineOrigin: resolvedId, startSnapTarget: hitSnap };
            state.polylineOrigin = resolvedId;
        } else {
            state.active = { mode: TOOL_MODES.LINE, start: resolvedId, startPt: startPt, preview: null, polylineOrigin: resolvedId, startSnapTarget: hitSnap };
            state.polylineOrigin = resolvedId;
        }
    } else {
        state.active = { mode: TOOL_MODES.LINE, start: null, startPt: startPt, preview: null, polylineOrigin: null, _tempStart: true, startSnapTarget: hitSnap };
    }

    justCreatedActive = true;
    // Reset per-call drag flag so `justCreatedActive` semantics are deterministic
    // (prevents leakage from other tests that may modify module-level localState).
    localState.isDragging = false;
    localState.dragStartScreen = { x: e.clientX, y: e.clientY };
    return true;
}

export function handleLinePointerMove(e, svg, state, w) {
    if (isInputActive()) {
        updateInputPosition(e.clientX, e.clientY);
    }

    if (localState.dragStartScreen && state.active) {
        if (checkDragThreshold(e, localState.dragStartScreen, SNAP.DRAG_THRESHOLD || 2)) localState.isDragging = true;
    }
    if (state.active && state.active.mode === TOOL_MODES.LINE) {
        if (SNAP_DEBUG && state.snapTarget) {
            dbg.log('snap', '[SNAP CHECK]', {
                type: state.snapTarget.type,
                targetId: state.snapTarget.targetId,
                hasPt: !!state.snapTarget.pt,
                pt: state.snapTarget.pt
            });
        }
        const rawPreviewPt = state.snapTarget 
            ? (state.snapTarget.pt || { x: state.snapTarget.x, y: state.snapTarget.y })
            : w;

        let previewPt = rawPreviewPt;
        
        // If using live dimensions, let the input handler calculate the preview point
        // This handles both length and angle locking
        if (typeof document !== 'undefined' && document.getElementById('live-dim-length') && !document.getElementById('live-dim-length').classList.contains('hidden')) {
            updateLiveLinePreview(svg, state);
            // The preview point is updated in state.active.preview by updateLiveLinePreview
            return true;
        }
        
        if (lineState.lockedLength !== null) {
            const spt = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
            if (spt) {
                const dx = rawPreviewPt.x - spt.x;
                const dy = rawPreviewPt.y - spt.y;
                const angle = Math.atan2(dy, dx);
                previewPt = {
                    x: spt.x + Math.cos(angle) * (lineState.lockedLength || 0),
                    y: spt.y + Math.sin(angle) * (lineState.lockedLength || 0)
                };
            }
        } else {
            try {
                const spt = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
                const inf = findInference(spt, rawPreviewPt, state.shapes, state.joints, state.snapTarget);
                if (inf) {
                    const startId = state.active.start || 'temp_start';
                    const previewEndId = 'temp_end';
                    const previewShapeId = 'temp_line';
                    const infState = { type: inf.type, pos: inf.pos || inf.pt || null, targetId: inf.targetId || (inf.refLine && inf.refLine.id) || null, refCircle: inf.refCircle };
                    if (canPreviewLineInference(state, startId, previewEndId, previewShapeId, infState)) {
                        state.activeInference = infState;
                        state.inference = state.activeInference;
                    } else {
                        state.activeInference = null;
                        state.inference = null;
                    }
                } else { state.activeInference = null; state.inference = null; }
                if (state.activeInference && state.activeInference.pos) previewPt = state.activeInference.pos;
            } catch (_) { state.activeInference = null; state.inference = null; }
        }

        safeUpdatePreview(state, 'line', [state.active.start], previewPt, { lockedLength: lineState.lockedLength || undefined });
    }
    return true;
}

export function handleLinePointerUp(e, svg, state, hitSnap, w, wasDragging) {
    console.log('[DEBUG line-tool] handleLinePointerUp', { 
        hasActive: !!state.active, 
        activeMode: state.active?.mode,
        activeStart: state.active?.start,
        tempStart: state.active?._tempStart,
        justCreatedActive,
        isDragging: localState.isDragging,
        timeSinceLastCommit: Date.now() - lastLineCommitTime
    });
    if (!state.active || state.active.mode !== TOOL_MODES.LINE) return false;

    const now = Date.now();
    // Allow immediate pointerUp when we just created an active start (click -> temp start)
    // or when the active is a temporary start. This prevents the module-level debounce
    // from blocking the test/UX case that confirms a click should create the start joint.
    if (now - lastLineCommitTime < LINE_POINTERUP_DEBOUNCE_MS && !(justCreatedActive || (state.active && state.active._tempStart))) {
        dbg.log('line-tool', '[line-tool] pointerUp debounced', { delta: now - lastLineCommitTime });
        return true;
    }

    if ((justCreatedActive || (state.active && state.active._tempStart)) && !localState.isDragging) {
        // Determine if the pointerUp occurred at the same location as the start.
        const startPt = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
        const movedSinceStart = startPt ? (Math.hypot((w.x - startPt.x), (w.y - startPt.y)) > 0.5) : false;

        // Clear the module-level flag — we began a new active but the user didn't drag far
        // enough to be considered a "drag". Accept either the module-level `justCreatedActive`
        // or the per-state `_tempStart` marker to make the logic deterministic across tests.
        justCreatedActive = false;

        if (state.active && state.active._tempStart) {
            const startId = state.genJ();
            const sp = state.active.startPt || { x: 0, y: 0 };
            state.joints.set(startId, { x: sp.x, y: sp.y, fixed: false });
            state.active.start = startId;
            state.active.polylineOrigin = startId;
            state.polylineOrigin = startId;
            // This pointerup was the click that created the start joint; do not finalize a line now.
            return true;
        }

        // If the pointerUp is essentially at the same point as the start, treat it as a click (no end created).
        if (!movedSinceStart) return true;
        // Otherwise fall through and allow the normal pointerUp logic to create the end joint
        // (this covers the UX case: click to start on an existing joint, then release elsewhere to create a line).
    }

    dbg.log('line-tool', '[line-tool] pointerUp entry', { hitSnap, activeSnap: state.activeSnap, wasDragging });
    // Ensure the start joint exists before creating the end joint. On drag releases
    // where the user started on an empty canvas, creating the end first could lead
    // to two distinct joints at the same coordinates. Create the start now so the
    // end joint's 'nearby' check can coalesce to it when appropriate.
    let startId = state.active.start;
    if (!startId) {
        startId = state.genJ();
        const sp = state.active.startPt || (state.active.preview && state.active.preview.pt) || w;
        state.joints.set(startId, { x: sp.x, y: sp.y, fixed: false });
        state.active.start = startId;
        state.active.polylineOrigin = startId;
        state.polylineOrigin = startId;
    }

    const snap = state.activeSnap || hitSnap;
    const endPt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
    const endId = state.genJ();
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    dbg.log('line-tool', '[line-tool] created end joint', { endId, endPt });

    // Abort zero-length segments (prevents tiny stub at start when click jitter occurs)
    const startPt = state.active.startPt || state.joints.get(startId) || { x: 0, y: 0 };
    const segLen = Math.hypot((endPt.x - startPt.x), (endPt.y - startPt.y));
    if (segLen < 1e-4) {
        state.joints.delete(endId);
        state.active = null;
        justCreatedActive = false;
        localState.dragStartScreen = null;
        return true;
    }

    try {
        const nearby = findNearbyJoint(state.joints, endPt, state.active.start, 0.01);
        if (nearby && nearby !== endId) {
            addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [endId, nearby] });
            dbg.log('line-tool', '[line-tool] auto coincident to nearby', { endId, nearby });
        }
    } catch (_) { }

    state.saveState();
    // startId has already been created above if missing — reuse the variable
    // (avoids creating duplicate joints when dragging the start on empty canvas).

    const newShapeId = 's' + Date.now();
    state.shapes.push({ id: newShapeId, type: 'line', joints: [startId, endId], isConstruction: !!state.isConstructionMode });
    lastLineCommitTime = Date.now();

    if (lineState.lockedLength !== null) {
        addConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            joints: [startId, endId],
            value: lineState.lockedLength,
            isDriven: !!lineState.isDriven
        });
    }
    
    if (lineState.lockedAngle !== null) {
        // Angle locking logic (placeholder)
    }
    
    lineState.lockedLength = null;
    lineState.lockedAngle = null;
    lineState.isDriven = false;
    try{ hideLiveInputs(); }catch(_){ }

    try{
        if (state.active && state.active.startSnapTarget && state.active.startSnapTarget.isLocked) {
            const sst = state.active.startSnapTarget;
            dbg.log('line-tool', '[line-tool] applying recorded startSnapTarget', { startId, snap: sst });
            if (sst.type !== 'grid') {
                applySnapConstraint(state, startId, sst, { excludeJoints: [endId] });
            } else {
                dbg.log('line-tool', '[line-tool] start snap is grid - visual only (no constraint)');
            }
        }
    }catch(_){ }
    try{
        if (hitSnap && hitSnap.isLocked) {
            dbg.log('line-tool', '[line-tool] applying end snap', { endId, snap: hitSnap });
            if (hitSnap.type !== 'grid') {
                applySnapConstraint(state, endId, hitSnap, { excludeJoints: [startId] });
            } else {
                dbg.log('line-tool', '[line-tool] end snap is grid - visual only (no constraint)');
            }
        } else {
            dbg.log('line-tool', '[line-tool] end snap not applied (missing or not locked)', { hitSnap });
        }
    }catch(_){ }

    try{
        const activeInf = state.activeInference || state.inference || null;
        if (activeInf && canApplyLineInference(state, startId, endId, newShapeId, activeInf)) {
            if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
                ConstraintManager.addHorizontal(state, [startId, endId], { source: 'inference', autoSolve: true });
            } else if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
                ConstraintManager.addVertical(state, [startId, endId], { source: 'inference', autoSolve: true });
            } else if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
                const target = activeInf.targetId || null;
                if (target) {
                    ConstraintManager.addPerpendicular(state, newShapeId, target, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
                const target = activeInf.targetId || null;
                if (target) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.TANGENT) {
                const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
                if (target) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
                const target = activeInf.targetId || null;
                if (target) {
                    const targetShape = state.shapes.find(s => s && s.id === target);
                    if (targetShape && targetShape.joints && targetShape.joints.length >= 2) {
                        const [j0, j1] = targetShape.joints;
                        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { source: 'inference', autoSolve: true });
                    }
                }
            }
        }
    }catch(_){ }

    if(state.previewConstraint){
        const idx = state.constraints.indexOf(state.previewConstraint);
        if(idx >= 0) state.constraints.splice(idx,1);
        state.previewConstraint = null;
    }
    state.inference = null;
    try{ state.endUndoGroup(); }catch(_){ }

    try{
        const ep = state.joints.get(endId);
        const newStart = state.genJ();
        if(ep) state.joints.set(newStart, { x: ep.x, y: ep.y, fixed: false });
        try{ addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [endId, newStart] }); }catch(_){ }

        state.active = {
            mode: TOOL_MODES.LINE,
            start: newStart,
            startPt: ep ? { x: ep.x, y: ep.y } : (state.active.startPt || { x: 0, y: 0 }),
            preview: { type: 'line', pt: ep ? { x: ep.x, y: ep.y } : w },
            polylineOrigin: state.polylineOrigin || newStart
        };
        justCreatedActive = false;
        localState.dragStartScreen = null;
    }catch(_){ }

    return true;
}

/**
 * Finalize the currently active line segment programmatically.
 * Used by live-dimension `Enter` confirmation to create the segment and start the next one.
 */
export function finalizeLineFromActive(svg, state) {
    dbg.log('line-tool', '[DEBUG LINE] Finalizing line. Locked:', lineState);
    if (!state || !state.active || state.active.mode !== TOOL_MODES.LINE) return false;
    try{ state.beginUndoGroup(); }catch(_){ }

    const endPt = (state.active.preview && state.active.preview.pt) ? state.active.preview.pt : (state.tempMousePos || state.active.startPt || { x: 0, y: 0 });
    let endId = null;

    const nearbyId = findNearbyJoint(state.joints, endPt, state.active.start, 0.5);
    if (nearbyId) {
        endId = nearbyId;
    } else {
        endId = state.genJ();
        state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    }

    let startId = state.active.start;
    if(!startId){
        startId = state.genJ();
        const sp = state.active.startPt || state.active.preview.pt || endPt;
        state.joints.set(startId, { x: sp.x, y: sp.y, fixed: false });
        state.active.start = startId; state.active.polylineOrigin = startId; state.polylineOrigin = startId;
    }

    // Abort zero-length segments (prevents tiny stub when finalize is triggered without movement)
    const spt = state.joints.get(startId) || { x: 0, y: 0 };
    const segLen = Math.hypot((endPt.x - spt.x), (endPt.y - spt.y));
    if (segLen < 1e-4) {
        if (!nearbyId && endId) state.joints.delete(endId);
        state.active = null;
        justCreatedActive = false;
        localState.dragStartScreen = null;
        try{ state.endUndoGroup(); }catch(_){ }
        return true;
    }

    const newShapeId = 's' + Date.now();
    state.shapes.push({ id: newShapeId, type: 'line', joints: [startId, endId], isConstruction: !!state.isConstructionMode });

    if (lineState.lockedLength !== null) {
        dbg.log('line-tool', '[DEBUG LINE] Adding distance constraint:', lineState.lockedLength);
        addConstraint(state, CONSTRAINT_TYPES.DISTANCE, { 
            joints: [startId, endId], 
            value: lineState.lockedLength,
            isDriven: !!lineState.isDriven // Use it
        });
    }
    
    lineState.lockedLength = null;
    lineState.lockedAngle = null;
    lineState.isDriven = false;
    try{ hideLiveInputs(); }catch(_){ }
    
    try{
        const activeInf = state.activeInference || state.inference || null;
        if (activeInf && canApplyLineInference(state, startId, endId, newShapeId, activeInf)) {
            if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
                ConstraintManager.addHorizontal(state, [startId, endId], { source: 'inference', autoSolve: true });
            } else if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
                ConstraintManager.addVertical(state, [startId, endId], { source: 'inference', autoSolve: true });
            } else if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
                const target = activeInf.targetId || null;
                if (target) {
                    ConstraintManager.addPerpendicular(state, newShapeId, target, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
                const target = activeInf.targetId || null;
                if (target) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.TANGENT) {
                const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
                if (target) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
                const target = activeInf.targetId || null;
                if (target) {
                    const targetShape = state.shapes.find(s => s && s.id === target);
                    if (targetShape && targetShape.joints && targetShape.joints.length >= 2) {
                        const [j0, j1] = targetShape.joints;
                        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { source: 'inference', autoSolve: true });
                    }
                }
            }
        }
    }catch(_){ }

    try{ if (state.active && state.active.startSnapTarget && state.active.startSnapTarget.isLocked) applySnapConstraint(state, startId, state.active.startSnapTarget, { excludeJoints: [endId] }); }catch(_){ }
    try{ if (state.active && state.active.preview && state.active.preview.snapTarget && state.active.preview.snapTarget.isLocked) applySnapConstraint(state, endId, state.active.preview.snapTarget, { excludeJoints: [startId] }); }catch(_){ }

    try{
        const ep = state.joints.get(endId);
        const newStart = state.genJ();
        if(ep) state.joints.set(newStart, { x: ep.x, y: ep.y, fixed: false });
        try{ addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [endId, newStart] }); }catch(_){ }

        state.active = {
            mode: TOOL_MODES.LINE,
            start: newStart,
            startPt: ep ? { x: ep.x, y: ep.y } : (state.active.startPt || { x: 0, y: 0 }),
            preview: { type: 'line', pt: ep ? { x: ep.x, y: ep.y } : endPt },
            polylineOrigin: state.polylineOrigin || newStart
        };
        justCreatedActive = false;
        localState.dragStartScreen = null;
    }catch(_){ }

    try{ state.endUndoGroup(); }catch(_){ }
    return true;
}

// Deactivate/Cleanup the line tool: remove floating start joint and any coincident constraints
export function deactivateLineTool(state) {
    try{
        if(!state) return;
        if(!state.active || state.active.mode !== TOOL_MODES.LINE){
            state.active = null; state.continueFrom = null; state.polylineOrigin = null; return;
        }

        const curStart = state.active.start;
        if(state.constraints && curStart){
            for(let i = state.constraints.length - 1; i >= 0; i--) {
                const c = state.constraints[i];
                if(!c) continue;
                if(c.joints && c.joints.includes(curStart)){
                    state.constraints.splice(i,1);
                }
            }
        }

        if(curStart && state.joints && state.joints.has(curStart)){
            const used = state.shapes && state.shapes.some(s => s.joints && s.joints.includes(curStart));
            if(!used) state.joints.delete(curStart);
        }

        state.active = null;
        state.continueFrom = null;
        state.polylineOrigin = null;

        try{ clearHover(state); }catch(_){ }
    }catch(_){ }
}