import { SolverConfig } from '#core/solver-config.js';
// ═══════════════════════════════════════════════════════════════════════════════
// DIMENSION TOOL - Handles creation of distance and radius constraints
// ═══════════════════════════════════════════════════════════════════════════════
// Shared UI (#ui/input-handlers/). Relocated VERBATIM from apps/sketchstudio in slice S4d.
// TODO(shaper): parameterize the DOM reaches before Shaper adopts this — relocation only for now.

import { dbg } from '#core/debug.js';
import { TOOL_MODES, CONSTRAINT_TYPES, DRAG_TYPES, DEFAULTS } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { screenToWorld, worldToScreen } from '#ui/coords.js';
import { getDist, perpendicularDistance, projectPointOnLine, getLineIntersection, isPointLineDistance } from '#core/geometry.js';
import { showEditInput, showSingleInput } from '#ui/numeric-input-manager.js';
import { dragDimensionLabel } from '#ui/dimension-seams.js';
import { angleDimensionChoice } from '#ui/angle-dimension.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { snapshotSolverState, restoreSolverState } from '#core/solver/engine.js';
import { showNotification } from '#ui/notification-manager.js';
// Constraint / dimension operands resolve through the scene (task 539): the real containers + the two built-in reference lines.
import { sceneJoints, sceneShapes } from '#core/reference-lines.js';

function logDim() { /* logging disabled */ }

// Helper: check if a driving DISTANCE constraint exists for a pair of joints
function hasDrivingDistanceForJoints(state, aId, bId){
    if(!state || !Array.isArray(state.constraints)) return false;
    return state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE && Array.isArray(c.joints) && c.joints.length===2 && (
        (c.joints[0] === aId && c.joints[1] === bId) || (c.joints[0] === bId && c.joints[1] === aId)
    ) && (typeof c.value === 'number'));
}

// Helper: check if a driving DISTANCE constraint exists for a shape (radius)
function hasDrivingDistanceForShape(state, shapeId){
    if(!state || !Array.isArray(state.constraints)) return false;
    return state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE && c.shape === shapeId && (typeof c.value === 'number'));
}

// Local state for the dimension tool workflow
let dimensionState = {
    pendingDimension: null,      // Stores { type, firstJoint, firstPoint } for multi-click
    placingConstraint: null,     // Currently-placed constraint (click-move-click)
    pendingPointer: null,        // Tracks pointer that began placement (for distinguishing tap vs drag)
    lastClickTime: 0,            // For double-click detection on dim labels
    lastClickedIndex: -1,        // FIX: Track Index, not Element
    editingConstraint: null      // Track which constraint is being edited by the live input
};

// Undo helpers to avoid leaving intermediate/distorted states on the stack
function beginDimUndo(state){
    if (!state) return;
    try { if (state.beginUndoGroup) state.beginUndoGroup('dimension'); } catch(_) {}
    try { if (state.saveState) state.saveState(); } catch(_) {}
}
function endDimUndo(state){
    if (!state) return;
    try { if (state.endUndoGroup) state.endUndoGroup(); } catch(_) {}
}
function finalizeDimBirth(c, state){
    endDimUndo(state);
    if (!c) return;
    try { c.__newlyPlaced = true; } catch(_) {}
    c.__birthHistoryLength = state && state.history ? state.history.length : null;
}

export function setupDimensionTool(svg, appState) {
    dimensionState.pendingDimension = null;
    
    // Listen for live input changes (Enter key from showSingleInput)
    window.addEventListener('liveDimensionApplied', (e) => {
        if (appState.currentTool === TOOL_MODES.DIMENSION && dimensionState.editingConstraint) {
            if (e.detail.mode === 'single') {
                const val = parseFloat(e.detail.value);
                if (!isNaN(val)) {
                    dimensionState.editingConstraint.value = val;
                    
                    // Respect the isDriven flag from validation logic
                    if (e.detail.isDriven) {
                        dimensionState.editingConstraint.isDriven = true;
                    } else {
                        // Default to driving if valid
                        dimensionState.editingConstraint.isDriven = false;
                    }
                    
                    // Trigger a solve to apply the new value immediately
                    if (appState.engine && typeof appState.engine.solve === 'function') {
                        try { appState.engine.solve(SolverConfig.ITERATIONS || 500); } catch(err) { console.error(err); }
                    }
                }
                // Clear editing state
                dimensionState.editingConstraint = null;
            }
        }
    });
}

export function resetDimensionState(state) {
    const pc = (state && state.placingConstraint) || dimensionState.placingConstraint;
    if (pc && pc.__placing) {
        if (pc.__newlyPlaced === true && typeof pc.__birthHistoryLength === 'number' && state && state.discardSnapshotAt) state.discardSnapshotAt(pc.__birthHistoryLength);
        if (state && Array.isArray(state.constraints)) {
            const idx = state.constraints.indexOf(pc);
            if (idx !== -1) state.constraints.splice(idx, 1);
        }
        pc.__placing = false;
        pc.__newlyPlaced = false;
    }
    dimensionState.pendingDimension = null;
    dimensionState.placingConstraint = null;
    dimensionState.editingConstraint = null;
    if (state) {
        state.placingConstraint = null;
        if (state.active && state.active.mode === TOOL_MODES.DIMENSION) {
            state.active = null;
        }
    }
}

export function startDimensionFromSelection(svg, state, wOverride, opts = {}) {
    if (!state || !svg) return false;

    const selectedShapes = state.selectedShapes ? Array.from(state.selectedShapes) : [];
    const selectedJoints = state.selectedJoints ? Array.from(state.selectedJoints) : [];
    const hasPreselection = (selectedShapes.length + selectedJoints.length) > 0;
    // Always keep placing so the user can position the label before editing
    const keepPlacing = (typeof opts.keepPlacing === 'boolean') ? opts.keepPlacing : true;
    const placePos = wOverride || ((state.lastMouse && typeof state.lastMouse.x === 'number') ? screenToWorld(svg, state.lastMouse.x, state.lastMouse.y) : null);

    logDim('start-from-selection', {
        selectedShapes: selectedShapes.length,
        selectedJoints: selectedJoints.length,
        hasPreselection,
        keepPlacing,
        placePos,
        keyboardPlaced: !!opts.keyboardPlaced,
        wOverride: !!wOverride
    });

    // Case A: One selected line shape
    if (selectedShapes.length === 1) {
        const shape = sceneShapes(state.shapes).find(s => s && s.id === selectedShapes[0]);
        if (shape && shape.type === 'line' && shape.joints && shape.joints.length >= 2) {
            const j1 = sceneJoints(state.joints).get(shape.joints[0]);
            const j2 = sceneJoints(state.joints).get(shape.joints[1]);
            if (!j1 || !j2) return false;

            // If this line already has a driving distance dimension, don't auto-create another.
            if (hasDrivingDistanceForShape(state, shape.id) || hasDrivingDistanceForJoints(state, shape.joints[0], shape.joints[1])) {
                dimensionState.pendingDimension = { type: 'line', firstShapeId: shape.id };
                showNotification(
                    'Line already dimensioned. Click another line to measure angle or click the label to edit existing dimension.',
                    'info'
                );
                return true;
            }

            beginDimUndo(state);
            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                joints: [shape.joints[0], shape.joints[1]],
                value: getDist(j1, j2),
                dimMode: 'auto',
                isDriven: false
            }, { autoSolve: false });
            const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
            if (!c) { endDimUndo(state); return false; }

            const w = placePos || { x: (j1.x + j2.x) / 2, y: (j1.y + j2.y) / 2 };

            logDim('create-line-dim', { id: c.id || '(new)', keepPlacing, placePos: w, keyboardPlaced: !!opts.keyboardPlaced });

            try { c.__placing = true; } catch(_){ }
            try { c.__newlyPlaced = true; } catch(_){ }
            updateConstraintOffset(state, c, w);
            try { c.glyphPos = w; } catch(_){ }

            if (keepPlacing) {
                try { state.placingConstraint = c; } catch(_) {}
                dimensionState.placingConstraint = c;
                try { if (opts.keyboardPlaced) c.__keyboardPlaced = true; } catch(_) {}
            } else {
                try { c.__placing = false; } catch(_){ }
                dimensionState.editingConstraint = c;
                showEditInput(svg, state, c);
            }
            if (state.selectedShapes) state.selectedShapes.clear();
            if (state.selectedJoints) state.selectedJoints.clear();
            if (state.currentTool !== TOOL_MODES.DIMENSION) state.currentTool = TOOL_MODES.DIMENSION;
            finalizeDimBirth(c, state);
            return true;
        }
    }

    // Case B: Two selected joints
    if (selectedJoints.length === 2) {
        const j1 = sceneJoints(state.joints).get(selectedJoints[0]);
        const j2 = sceneJoints(state.joints).get(selectedJoints[1]);
        if (!j1 || !j2) return false;

        if (hasDrivingDistanceForJoints(state, selectedJoints[0], selectedJoints[1])) {
            showNotification(
                'Joints already dimensioned. Click the label to edit existing dimension.',
                'info'
            );
            return true;
        }

        beginDimUndo(state);
        const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            joints: [selectedJoints[0], selectedJoints[1]],
            value: getDist(j1, j2),
            dimMode: 'auto',
            isDriven: false
        }, { autoSolve: false });
        const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
        if (!c) { endDimUndo(state); return false; }

        const w = placePos || { x: (j1.x + j2.x) / 2, y: (j1.y + j2.y) / 2 };

        logDim('create-joints-dim', { id: c.id || '(new)', keepPlacing, placePos: w, keyboardPlaced: !!opts.keyboardPlaced });

        try { c.__placing = true; } catch(_){ }
        try { c.__newlyPlaced = true; } catch(_){ }
        updateConstraintOffset(state, c, w);
        try { c.glyphPos = w; } catch(_){ }

        if (keepPlacing) {
            try { state.placingConstraint = c; } catch(_) {}
            dimensionState.placingConstraint = c;
            try { if (opts.keyboardPlaced) c.__keyboardPlaced = true; } catch(_) {}
        } else {
            try { c.__placing = false; } catch(_){ }
            dimensionState.editingConstraint = c;
            showEditInput(svg, state, c);
        }
        if (state.selectedShapes) state.selectedShapes.clear();
        if (state.selectedJoints) state.selectedJoints.clear();
        if (state.currentTool !== TOOL_MODES.DIMENSION) state.currentTool = TOOL_MODES.DIMENSION;
        finalizeDimBirth(c, state);
        return true;
    }

    return false;
}

/**
 * Handle pointer down for dimension creation
 */

export function isDimensionPlacing(state) {
    const pc = (state && state.placingConstraint) || dimensionState.placingConstraint;
    return !!(pc && pc.__placing);
}

export function getPlacingConstraint(state) {
    return (state && state.placingConstraint) || dimensionState.placingConstraint;
}

export function anchorPlacingDimension(svg, state) {
    const pending = (state && state.placingConstraint) || dimensionState.placingConstraint;
    if (!pending || !pending.__placing) return false;

    // Check if geometry is already fully defined (Fixed/Constrained)
    if (pending.joints && pending.joints.length === 2 && state) {
        const [j1, j2] = pending.joints;
        const status = analyzeConstraintStatus(state);
        if (status.fixedJoints.has(j1) && status.fixedJoints.has(j2)) {
            const savedPositions = snapshotSolverState(state.joints, state.shapes);
            const testConstraint = { type: CONSTRAINT_TYPES.DISTANCE, joints: [j1, j2], value: pending.value, __temp: true, isDriven: false };
            state.constraints.push(testConstraint);
            try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.ITERATIONS || 500); } catch(_) {}
            const a = sceneJoints(state.joints).get(j1);
            const b = sceneJoints(state.joints).get(j2);
            const dist = (a && b) ? getDist(a, b) : null;
            const idx = state.constraints.indexOf(testConstraint);
            if (idx !== -1) state.constraints.splice(idx, 1);
            restoreSolverState(state.joints, state.shapes, savedPositions);

            if (dist === null || Math.abs(dist - (pending.value || 0)) > 0.1) {
                pending.isDriven = true;
                pending.driven = true;
                pending.__placing = false;
                if (state && state.placingConstraint === pending) state.placingConstraint = null;
                dimensionState.placingConstraint = null;
                showNotification(
                    'Geometry already defined. Dimension added as Driven. [ERR-DIM-02]',
                    'info'
                );
                return true;
            }
        }
    }

    // Finalize value for H/V/aligned
    if (pending.dimMode === 'horizontal' && pending.joints && pending.joints.length >= 2 && state) {
        const j1 = sceneJoints(state.joints).get(pending.joints[0]);
        const j2 = sceneJoints(state.joints).get(pending.joints[1]);
        if (j1 && j2) pending.value = Math.abs(j2.x - j1.x);
    } else if (pending.dimMode === 'vertical' && pending.joints && pending.joints.length >= 2 && state) {
        const j1 = sceneJoints(state.joints).get(pending.joints[0]);
        const j2 = sceneJoints(state.joints).get(pending.joints[1]);
        if (j1 && j2) pending.value = Math.abs(j2.y - j1.y);
    } else if (isPointLineDistance(pending)) {
        // a point-to-line dimension keeps the value it was born with (the perpendicular distance); nothing to re-measure
    } else if (pending.joints && pending.joints.length >= 2 && state) {
        const j1 = sceneJoints(state.joints).get(pending.joints[0]);
        const j2 = sceneJoints(state.joints).get(pending.joints[1]);
        if (j1 && j2) pending.value = getDist(j1, j2);
    }

    pending.__placing = false;
    if (state && state.placingConstraint === pending) state.placingConstraint = null;
    dimensionState.placingConstraint = null;

    if (pending.isDriven || pending.driven) {
        return true;
    }

    dimensionState.editingConstraint = pending;
    try {
        const svgEl = svg || (typeof document !== 'undefined' ? (document.getElementById('svgCanvas') || document.querySelector('svg')) : null);
        showEditInput(svgEl, state, pending);
    } catch(err) {
        console.error(err);
    }
    return true;
}

// The undo group of a dimension gesture is owned HERE: whatever way a click leaves handleDimensionPointerDown (a
// normal return on any path, or a throw), a group this click opened is closed. Nothing is caught: a throw still
// propagates after the group is closed.
export function handleDimensionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint) {
    const groupWasOpen = !!(state && state._undoGroupActive);
    try {
        return dimensionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint);
    } finally {
        if (!groupWasOpen && state && state._undoGroupActive) endDimUndo(state);
    }
}

function dimensionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint) {
    logDim('pointer-down', {
        tool: state.currentTool,
        hitShape: hitShape ? hitShape.shape.id : null,
        hitJoint: hitJoint ? hitJoint.id : null,
        placingId: dimensionState.placingConstraint && (dimensionState.placingConstraint.id || '(pending)'),
        pointerType: e.pointerType,
        pointerId: e.pointerId
    });
    if (state.currentTool !== TOOL_MODES.DIMENSION) return false;

    // 1. EXISTING LABEL: Double-click to Edit (Priority)
    const dimLabel = e.target.closest('.dim-label');
    if (dimLabel) {
        const cIdx = parseInt(dimLabel.dataset.constraintIdx);
        const constraint = state.constraints && state.constraints[cIdx];
        if (!constraint) return false;
        const now = Date.now();
        // Compare INDICES to handle DOM replacement
        const isDoubleClick = (now - (dimensionState.lastClickTime || 0) < 400) && (dimensionState.lastClickedIndex === cIdx);
        dimensionState.lastClickTime = now;
        dimensionState.lastClickedIndex = cIdx;
        if (isDoubleClick) {
            dimensionState.editingConstraint = constraint; // Track for event listener
            showEditInput(svg, state, constraint);
            return true;
        }
        // If single click on label, return false to let selection tool handle dragging if needed, 
        // or return true if you want to swallow it. Usually selection tool handles label drags.
    }

    const w = screenToWorld(svg, e.clientX, e.clientY);

    // 2. FINALIZE PLACEMENT (Drop -> Auto Edit)
    // If we are currently placing a constraint (click-move-click), this click drops it.
    if (dimensionState.placingConstraint && dimensionState.placingConstraint.__placing) {
        const pending = dimensionState.placingConstraint;
        logDim('finalize-placement', {
            type: pending.type,
            id: pending.id || '(pending)',
            keyboardPlaced: !!pending.__keyboardPlaced,
            dimMode: pending.dimMode,
            offset: pending.offset
        });

        // 2a. UPGRADE TO LINE-LINE or ANGLE (If clicking a second line while placing a line dim)
        if (hitShape && hitShape.shape && hitShape.shape.type === 'line') {
            logDim('hit-second-line', { lineId: hitShape.shape.id });
            const s2 = hitShape.shape;
            // Check if pending is a simple Distance constraint on a line (2 joints)
            if (pending.type === CONSTRAINT_TYPES.DISTANCE && pending.joints && pending.joints.length === 2) {                
                logDim('check-upgrade', { pendingId: pending.id || '(pending)' });
                // Find if these joints belong to a line shape
                const s1 = sceneShapes(state.shapes).find(s => s.type === 'line' && s.joints.includes(pending.joints[0]) && s.joints.includes(pending.joints[1]));
                logDim('source-line', { source: s1 ? s1.id : null });
                
                // If we found the original line and it's different from the new one
                if (s1 && s1.id !== s2.id) {
                    logDim('upgrade-line-dim', { pendingId: pending.id || '(pending)', s1: s1.id, s2: s2.id });
                    // Remove the temporary length constraint and discard its birth snapshot
                    if (pending.__newlyPlaced && typeof pending.__birthHistoryLength === 'number' && state && state.discardSnapshotAt) {
                        state.discardSnapshotAt(pending.__birthHistoryLength);
                    }
                    const idx = state.constraints.indexOf(pending);
                    if (idx !== -1) state.constraints.splice(idx, 1);
                    pending.__placing = false;
                    pending.__newlyPlaced = false;
                    if (state && state.placingConstraint === pending) state.placingConstraint = null;
                    dimensionState.placingConstraint = null;

                    // Check Parallelism
                    const j1a = sceneJoints(state.joints).get(s1.joints[0]);
                    const j1b = sceneJoints(state.joints).get(s1.joints[1]);
                    const j2a = sceneJoints(state.joints).get(s2.joints[0]);
                    const j2b = sceneJoints(state.joints).get(s2.joints[1]);

                    const a1 = Math.atan2(j1b.y - j1a.y, j1b.x - j1a.x);
                    const a2 = Math.atan2(j2b.y - j2a.y, j2b.x - j2a.x);
                    
                    // Normalize angles to 0-PI for parallel check
                    const ang1 = (a1 + Math.PI * 2) % Math.PI;
                    const ang2 = (a2 + Math.PI * 2) % Math.PI;
                    const diff = Math.abs(ang1 - ang2);
                    const isParallel = diff < 0.01 || Math.abs(diff - Math.PI) < 0.01;
                    logDim('parallel-check', { ang1, ang2, diff, isParallel });

                    const type = isParallel ? CONSTRAINT_TYPES.DISTANCE : CONSTRAINT_TYPES.ANGLE;

                    // Clear the preview active state now that we are creating or recovering the real constraint
                    state.active = null;

                    // Check if an existing constraint already exists between these two lines
                    let existing = state.constraints.find(c => c && c.type === type && c.shapes && 
                        ((c.shapes[0] === s1.id && c.shapes[1] === s2.id) || (c.shapes[0] === s2.id && c.shapes[1] === s1.id))
                    );

                    if (existing) {
                        logDim('recover-existing-constraint', { type, s1: s1.id, s2: s2.id });
                        startPlacing(svg, state, existing, e, w);
                        // An existing constraint must never get the birth stamp, and must never open or close a birth
                        return true;
                    }

                    beginDimUndo(state);
                    let success = false;
                    if (isParallel) {
                        logDim('create-line-line-distance', { s1: s1.id, s2: s2.id });
                        // Create Line-Line Distance
                        const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                            shapes: [s1.id, s2.id],
                            // the stored value is a distance (positive); which side line 2 lies on is not part of it (the solver row is |signed|)
                            value: Math.abs(perpendicularDistance(j1a, j2a, j2b))
                        });
                        success = !!res;
                    } else {
                        // Create Angle
                        let angleVal = Math.abs((a1 - a2) * 180 / Math.PI);
                        if (angleVal > 180) angleVal = 360 - angleVal;
                        logDim('create-angle', { s1: s1.id, s2: s2.id, angleVal });
                        
                        const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.ANGLE, {
                            shapes: [s1.id, s2.id],
                            value: angleVal
                        });
                        success = !!res;
                    }
                    
                    logDim('upgrade-constraint-result', { success });

                    let targetConstraint = success ? state.constraints[state.constraints.length - 1] : null;
                    if (!targetConstraint) {
                        endDimUndo(state);
                        if (state.history && state.history.length > 0 && state.discardSnapshotAt) {
                            state.discardSnapshotAt(state.history.length);
                        }
                        // Fallback: if it was a duplicate rejected by createConstraint, recover without birth stamp
                        existing = state.constraints.find(c => c && c.type === type && c.shapes && 
                            ((c.shapes[0] === s1.id && c.shapes[1] === s2.id) || (c.shapes[0] === s2.id && c.shapes[1] === s1.id))
                        );
                        if (existing) {
                            startPlacing(svg, state, existing, e, w);
                            return true;
                        }
                        return false;
                    }

                    startPlacing(svg, state, targetConstraint, e, w);
                    finalizeDimBirth(targetConstraint, state);
                    return true;
                }
 else {
                    logDim('no-upgrade');
                }
            } else {
                logDim('skip-upgrade-non-distance');
            }
        }
        
        logDim('finalize-continue');

        // If it's a driven (reference) dimension, just drop it.
        if (pending.isDriven || pending.driven) {
            logDim('drop-driven', { id: pending.id || '(pending)' });
            try { pending.__placing = false; } catch(_){ }
            try { if (state && state.placingConstraint === pending) state.placingConstraint = null; } catch(_){ }
            dimensionState.placingConstraint = null;
            return true;
        }
        
        // If it's a driving dimension, open the edit box.
        logDim('open-edit-driving', { id: pending.id || '(pending)', dimMode: pending.dimMode, offset: pending.offset });

        // Check if geometry is already fully defined (Fixed/Constrained)
        // Use a solver sandbox to determine whether adding a driving dimension would distort geometry.
        if (pending.joints && pending.joints.length === 2) {
            const [j1, j2] = pending.joints;
            // Quick optimistic check: if both joints are marked constrained, run a sandbox solve to confirm.
            const status = analyzeConstraintStatus(state);
            // Only treat as immovable when both endpoints are actually fixed (zero DOF), not merely constrained.
            // Only set as driven if BOTH joints are fixed (not just one)
            if (status.fixedJoints.has(j1) && status.fixedJoints.has(j2)) {
                // Sandbox test: temporarily add a distance constraint and run the solver
                const savedPositions = snapshotSolverState(state.joints, state.shapes);
                const testConstraint = { type: CONSTRAINT_TYPES.DISTANCE, joints: [j1, j2], value: pending.value, __temp: true, isDriven: false };
                state.constraints.push(testConstraint);
                try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.ITERATIONS || 500); } catch(_) {}
                const a = sceneJoints(state.joints).get(j1);
                const b = sceneJoints(state.joints).get(j2);
                const dist = (a && b) ? getDist(a, b) : null;
                // Remove temp constraint
                const idx = state.constraints.indexOf(testConstraint);
                if (idx !== -1) state.constraints.splice(idx, 1);
                // Restore geometry
                restoreSolverState(state.joints, state.shapes, savedPositions);

                // If the solver couldn't satisfy the constraint, mark as driven; otherwise allow driving
                if (dist === null || Math.abs(dist - (pending.value || 0)) > 0.1) {
                    // Adding as driving would distort => force driven
                    pending.isDriven = true;
                    pending.driven = true;
                    pending.__placing = false;
                    state.placingConstraint = null;
                    dimensionState.placingConstraint = null;
                    // Add joint status details for debugging
                    const jointStatus = {
                        j1,
                        j2,
                        fixedJoints: Array.from(status.fixedJoints),
                        constrainedJoints: Array.from(status.constrainedJoints),
                        jointDOFs: Object.fromEntries(status.jointDOFs)
                    };
                    showNotification(
                        'Geometry already defined. Dimension added as Driven. [ERR-DIM-02] Reason: Geometry is already fully defined.\nArgs: ' +
                        JSON.stringify({ pending, jointStatus }),
                        'info'
                    );
                    return true;
                }
                // Else it's safe to be driving and we continue to open the edit input
            }
        }

        // FIX: Update value for H/V modes to projected distance so solver doesn't jump
        if (pending.dimMode === 'horizontal' && pending.joints && pending.joints.length >= 2) {
             const j1 = sceneJoints(state.joints).get(pending.joints[0]);
             const j2 = sceneJoints(state.joints).get(pending.joints[1]);
             if (j1 && j2) pending.value = Math.abs(j2.x - j1.x);
        } else if (pending.dimMode === 'vertical' && pending.joints && pending.joints.length >= 2) {
             const j1 = sceneJoints(state.joints).get(pending.joints[0]);
             const j2 = sceneJoints(state.joints).get(pending.joints[1]);
             if (j1 && j2) pending.value = Math.abs(j2.y - j1.y);
        }

        try {
            if (!pending.glyphPos) {
               pending.glyphPos = w;
            }
            dimensionState.editingConstraint = pending; // Track for live input event
            showEditInput(svg, state, pending);
        } catch(err){ console.error(err); }
        
        try { pending.__placing = false; } catch(_){ }
        try { if (state && state.placingConstraint === pending) state.placingConstraint = null; } catch(_){ }
        dimensionState.placingConstraint = null;
        return true;
    }

    // 3. HANDLE PENDING DIMENSION (Second Click of a multi-click sequence)
    if (dimensionState.pendingDimension) {
        // Case A: Clicked a Shape (Line) -> Create Point-to-Line Dimension
        if (hitShape && hitShape.shape && hitShape.shape.type === 'line') {
            logDim('create-point-to-line');
            const firstId = dimensionState.pendingDimension.firstJoint;
            const lineShape = hitShape.shape;

            // Prevent creating dimension to own line
            if (lineShape.joints.includes(firstId)) {
                dbg.warn('app', '[dimension-tool] Cannot dimension a joint against its own line.');
                resetDimensionState(state);
                return true; 
            }

            const a = sceneJoints(state.joints).get(lineShape.joints[0]);
            const b = sceneJoints(state.joints).get(lineShape.joints[1]);
            const firstJ = sceneJoints(state.joints).get(firstId);
            if (!a || !b || !firstJ) {
                resetDimensionState(state);
                return true;
            }

            // Point-to-line = the PERPENDICULAR distance from the point to the line: one distance constraint stored with
            // the three joints [P, A, B] (solver row distance.__lineLine, the same one a line-line distance uses). No helper joint.
            beginDimUndo(state);
            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                joints: [firstId, lineShape.joints[0], lineShape.joints[1]],
                value: Math.abs(perpendicularDistance(firstJ, a, b))
            }, { source: 'dimension' });
            const c = (res && typeof res === 'object') ? res : null;
            if (!c) { endDimUndo(state); resetDimensionState(state); return true; }

            startPlacing(svg, state, c, e, w);
            updateConstraintOffset(state, c, w);
            dimensionState.pendingDimension = null;
            finalizeDimBirth(c, state);
            return true;
        }

        // Case B: Clicked another Joint -> Create Point-to-Point Dimension
        if (hitJoint) {
            logDim('create-point-to-point');
            if (dimensionState.pendingDimension.firstJoint === hitJoint.id) return false; // Ignore self-click

            beginDimUndo(state);
            const firstId = dimensionState.pendingDimension.firstJoint;
            const j1 = sceneJoints(state.joints).get(firstId);
            
            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                joints: [firstId, hitJoint.id],
                value: getDist(j1, hitJoint.j),
                dimMode: 'auto' // Bypass duplicate check to allow multiple dim types
            });
            
            const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
            if (!c) { endDimUndo(state); return false; }
            
            startPlacing(svg, state, c, e, w);
            updateConstraintOffset(state, c, w); // Initialize dimMode and isDriven status
            dimensionState.pendingDimension = null;
            finalizeDimBirth(c, state);
            return true;
        }

        // Case C: Clicked Empty Space -> Cancel Pending
        if (!hitJoint && !hitShape) {
            resetDimensionState(state);
            return true;
        }
    }

    // 4. START NEW DIMENSION (First Click)
    
    // Case A: Hit a Joint -> Start Point-to-Point sequence
    if (hitJoint) {
        logDim('start-point-seq', { joint: hitJoint.id });
        dimensionState.pendingDimension = {
            type: 'distance',
            firstJoint: hitJoint.id,
            firstPoint: hitJoint.j
        };
        state.active = {
            mode: TOOL_MODES.DIMENSION,
            joints: [hitJoint.id],
            startPt: hitJoint.j
        };
        return true;
    }

    // Case B: Hit a Shape (Line or Circle) -> Create Object Dimension
    if (hitShape) {
        logDim('start-object-dim', { shape: hitShape.shape && hitShape.shape.id, type: hitShape.shape && hitShape.shape.type });
        const shape = hitShape.shape;
        beginDimUndo(state);

        if (shape.type === 'line') {
            const j1 = sceneJoints(state.joints).get(shape.joints[0]);
            const j2 = sceneJoints(state.joints).get(shape.joints[1]);
            
            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                joints: [shape.joints[0], shape.joints[1]],
                value: getDist(j1, j2),
                dimMode: 'auto' // Bypass duplicate check to allow multiple dim types
            });
            const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
            if (!c) { endDimUndo(state); return false; }
            
            
            // Initialize placement state (Inline logic)
            try { c.__placing = true; } catch(_){ }
            state.placingConstraint = c;
            dimensionState.placingConstraint = c;
            
            try { dimensionState.pendingPointer = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, constraint: c }; } catch(_){ }
            try { svg.setPointerCapture(e.pointerId); } catch(_){ }
            
            if (e.pointerType !== 'touch') {
                state.drag = { 
                    type: DRAG_TYPES.DIMENSION, 
                    constraint: c, 
                    initialOffset: c.offset || SolverConfig.DIMENSION_OFFSET || 30, 
                    startWorld: w, 
                    pointerId: e.pointerId,
                    startTime: Date.now() 
                };
            } else { 
                state.drag = null; 
            }
            updateConstraintOffset(state, c, w); // Initialize dimMode and isDriven status
            finalizeDimBirth(c, state);
            return true;
        }
        else if (shape.type === 'circle' || shape.type === 'arc') {
            const centerId = shape.joints[0];
            const center = sceneJoints(state.joints).get(centerId);
            // A circle carries `.radius` (circle-tool.js sets it); an ARC never does (makeArc doesn't
            // set it) -- falling back to a hardcoded 0 here created a radius dimension worth 0 on
            // every arc (live-confirmed). Mirror engine.js's own fallback: compute the real center→rim
            // distance from the arc's own joints (joints[1] is a real rim point, per makeArc(center,
            // start, end)) instead of the shape's absent scalar field.
            let radius = (typeof shape.radius === 'number') ? shape.radius
                : (center && shape.joints && shape.joints.length >= 2 ? getDist(center, sceneJoints(state.joints).get(shape.joints[1])) : 0);
            
            const alreadyHasDriving = hasDrivingDistanceForShape(state, shape.id);

            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                shape: shape.id,
                value: radius,
                isRadius: true,
                isDriven: alreadyHasDriving
            });
            
            const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
            if (!c) { endDimUndo(state); return false; }

            // NOTE: this is handleDimensionPointerDown (the click-driven Case B path), not
            // startDimensionFromSelection -- `placePos`/`keepPlacing`/`opts` belong to that sibling
            // function and don't exist here (were throwing ReferenceError on every radius-dim click,
            // live-confirmed). `w` is this function's own screenToWorld(e.clientX, e.clientY) from
            // above; mirror the `line` branch just above (same function) for placing/drag wiring.
            try { c.__placing = true; } catch(_){ }
            try { c.glyphPos = w; } catch(_){ }
            placeRadiusLabel(c, center, w);
            state.placingConstraint = c;
            dimensionState.placingConstraint = c;

            try { dimensionState.pendingPointer = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, constraint: c }; } catch(_){ }
            try { svg.setPointerCapture(e.pointerId); } catch(_){ }

            if (e.pointerType !== 'touch') {
                state.drag = {
                    type: DRAG_TYPES.DIMENSION,
                    constraint: c,
                    initialOffset: c.offset || SolverConfig.DIMENSION_OFFSET || 30,
                    startWorld: w,
                    pointerId: e.pointerId,
                    startTime: Date.now()
                };
            } else {
                state.drag = null;
            }
            finalizeDimBirth(c, state);
            return true;
        }
    }

    return false;
}

// Helper to initialize placement state for a new constraint
function startPlacing(svg, state, constraint, e, w) {
    try { constraint.__placing = true; } catch(_){ }
    
    // UNIFIED STATE NAME: placingConstraint (fixed typo)
    state.placingConstraint = constraint;
    dimensionState.placingConstraint = constraint;
    
    try { dimensionState.pendingPointer = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, constraint: constraint }; } catch(_){ }
    try { svg.setPointerCapture(e.pointerId); } catch(_){ }
    
    if (e.pointerType !== 'touch') {
        state.drag = { 
            type: DRAG_TYPES.DIMENSION, 
            constraint: constraint, 
            initialOffset: constraint.offset || SolverConfig.DIMENSION_OFFSET || 30, 
            startWorld: w, 
            pointerId: e.pointerId,
            startTime: Date.now() 
        };
    } else { 
        state.drag = null; 
    }
}

// Helper for screen distance to segment
function getScreenDistToLine(svg, mx, my, j1, j2) {
    const p1 = worldToScreen(svg, j1);
    const p2 = worldToScreen(svg, j2);
    if (!p1 || !p2) return Infinity;
    
    const l2 = (p1.x - p2.x)**2 + (p1.y - p2.y)**2;
    if (l2 === 0) return Math.hypot(mx - p1.x, my - p1.y);
    
    let t = ((mx - p1.x) * (p2.x - p1.x) + (my - p1.y) * (p2.y - p1.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    
    const projX = p1.x + t * (p2.x - p1.x);
    const projY = p1.y + t * (p2.y - p1.y);
    
    return Math.hypot(mx - projX, my - projY);
}

export function handleDimensionPointerMove(e, svg, state, w) {
    if (state.currentTool !== TOOL_MODES.DIMENSION) return false;

    // Check if we need to start a drag from a pending pointer (Touch behavior)
    if (dimensionState.pendingPointer && dimensionState.pendingPointer.pointerId === e.pointerId) {
        const dx = e.clientX - dimensionState.pendingPointer.startX;
        const dy = e.clientY - dimensionState.pendingPointer.startY;
        if (Math.hypot(dx, dy) > 6) {
            const c = dimensionState.pendingPointer.constraint;
            state.drag = { 
                type: DRAG_TYPES.DIMENSION, 
                constraint: c, 
                initialOffset: c.offset || SolverConfig.DIMENSION_OFFSET || 30, 
                startWorld: w, 
                pointerId: e.pointerId, 
                startTime: Date.now() 
            };
            try { svg.setPointerCapture(e.pointerId); } catch(_){ }
            dimensionState.pendingPointer = null;
            return true;
        }
    }

    // Live placement update (Move label before clicking to drop)
    if (dimensionState.placingConstraint && dimensionState.placingConstraint.__placing) {
        const c = dimensionState.placingConstraint;
        updateConstraintOffset(state, c, w);

        // Hover feedback for second line selection (Angle/Line-Line Distance)
        if (c.type === CONSTRAINT_TYPES.DISTANCE && c.joints && c.joints.length === 2) {
             // Identify the source line
             const sourceLine = sceneShapes(state.shapes).find(s => s.type === 'line' && s.joints.includes(c.joints[0]) && s.joints.includes(c.joints[1]));
             
             if (sourceLine) {
                 let bestLine = null;
                 let minD = 20; // 20px hit tolerance
                 
                 for (const s of state.shapes) {
                     if (s.id === sourceLine.id) continue;
                     if (s.type !== 'line') continue;
                     
                     const j1 = sceneJoints(state.joints).get(s.joints[0]);
                     const j2 = sceneJoints(state.joints).get(s.joints[1]);
                     if (j1 && j2) {
                         const d = getScreenDistToLine(svg, e.clientX, e.clientY, j1, j2);
                         if (d < minD) {
                             minD = d;
                             bestLine = s;
                         }
                     }
                 }
                 
                 const prevHover = state.hoveredShape;
                 // Force update hoveredShape so renderer highlights it
                 state.hoveredShape = bestLine ? bestLine.id : null;
                 if (state.hoveredShape !== prevHover) {
                     logDim('hover-line-candidate', { hoveredShape: state.hoveredShape });
                 }
                 
                 // Clear conflicting hovers to ensure shape highlight renders (renderer priority: joint > constraint > shape)
                 if (state.hoveredShape) {
                     state.hoveredJoint = null;
                     state.hoveredConstraint = null;
                 }

                 // ANGLE PREVIEW: If we found a valid second line, show the arc preview
                 if (bestLine) {
                     const s1 = sourceLine;
                     const s2 = bestLine;
                     const j1a = sceneJoints(state.joints).get(s1.joints[0]);
                     const j1b = sceneJoints(state.joints).get(s1.joints[1]);
                     const j2a = sceneJoints(state.joints).get(s2.joints[0]);
                     const j2b = sceneJoints(state.joints).get(s2.joints[1]);

                     if (j1a && j1b && j2a && j2b) {
                        const a1 = Math.atan2(j1b.y - j1a.y, j1b.x - j1a.x);
                        const a2 = Math.atan2(j2b.y - j2a.y, j2b.x - j2a.x);
                        
                        // Check parallelism to decide if we show angle preview
                        const ang1 = (a1 + Math.PI * 2) % Math.PI;
                        const ang2 = (a2 + Math.PI * 2) % Math.PI;
                        const diff = Math.abs(ang1 - ang2);
                        const isParallel = diff < 0.01 || Math.abs(diff - Math.PI) < 0.01;

                        if (!isParallel) {
                            state.active = {
                                mode: 'dim-angle',
                                shapes: [s1.id, s2.id],
                                preview: { pt: w }
                            };
                        }
                     }
                 } else if (state.active && state.active.mode === 'dim-angle') {
                     state.active = null;
                 }
             }
        }

        return true;
    }

    // Dragging an existing dimension label
    if (state.drag && state.drag.type === DRAG_TYPES.DIMENSION) {
        const constraint = state.drag.constraint;
        if (state.drag.mode === 'label') dragDimensionLabel(state, state.drag, e, w);
        else updateConstraintOffset(state, constraint, w);
        return true;
    }

    // Preview for Point-to-Point mode
    if (dimensionState.pendingDimension) {
        const previewPt = state.snapTarget ? state.snapTarget.pt : w;
        state.active = {
            mode: TOOL_MODES.DIMENSION,
            joints: [dimensionState.pendingDimension.firstJoint],
            startPt: dimensionState.pendingDimension.firstPoint,
            preview: { type: 'line', pt: previewPt }
        };
        return true;
    }

    return false;
}

/**
 * Detect dimension mode based on mouse position relative to segment.
 * Returns 'aligned', 'horizontal', or 'vertical'.
 */
function detectDimMode(j1, j2, w) {
    const dx = j2.x - j1.x, dy = j2.y - j1.y;
    const lenSq = dx*dx + dy*dy;
    if (lenSq < 0.0001) return 'aligned';
    
    // If line is nearly horizontal or vertical (~5°), stay aligned — H/V would be redundant
    const lineAngle = Math.abs(Math.atan2(dy, dx));
    const isNearlyH = lineAngle < 0.087 || lineAngle > Math.PI - 0.087;
    const isNearlyV = Math.abs(lineAngle - Math.PI / 2) < 0.087;
    if (isNearlyH || isNearlyV) return 'aligned';
    
    // Project w onto line segment
    const t = ((w.x - j1.x) * dx + (w.y - j1.y) * dy) / lenSq;
    
    // 1. Inside perpendicular band
    if (t >= 0 && t <= 1) return 'aligned';
    
    // 2. Past endpoints
    const ex = (t < 0) ? j1.x : j2.x;
    const ey = (t < 0) ? j1.y : j2.y;
    
    const vx = w.x - ex;
    const vy = w.y - ey;
    
    // Flipped: Pulling horizontally (side) creates a VERTICAL dimension
    if (Math.abs(vx) > Math.abs(vy)) return 'vertical';
    return 'horizontal';
}

// TASK 448: THE one place a radius/diameter dimension's label placement is written (birth, drag while placing, and
// dragging an existing dimension all call it): the label's DISTANCE from the centre (offset) and its ANGLE around the
// centre (labelAngle), so the leader can sit at any angle and the label lands where it is dropped.
export function placeRadiusLabel(c, center, w) {
    c.offset = getDist(center, w);
    c.labelAngle = Math.atan2(w.y - center.y, w.x - center.x);
}

export function updateConstraintOffset(state, c, w) {
    if (c.isRadius) {
        const shape = state.shapes ? sceneShapes(state.shapes).find(s => s.id === c.shape) : null;
        const center = (shape && shape.joints && shape.joints[0]) ? sceneJoints(state.joints).get(shape.joints[0]) : null;
        if (center) {
            placeRadiusLabel(c, center, w);
        }
    } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
        // Angle Dimension: Offset is radius from intersection
        const s1 = sceneShapes(state.shapes).find(s => s.id === c.shapes[0]);
        const s2 = sceneShapes(state.shapes).find(s => s.id === c.shapes[1]);
        if (s1 && s2) {
            const j1 = sceneJoints(state.joints).get(s1.joints[0]), j2 = sceneJoints(state.joints).get(s1.joints[1]);
            const j3 = sceneJoints(state.joints).get(s2.joints[0]), j4 = sceneJoints(state.joints).get(s2.joints[1]);
            if (j1 && j2 && j3 && j4) {
                const int = getLineIntersection(j1, j2, j3, j4);
                if (int) {
                    c.offset = getDist(int, w);
                    // Also store explicit position for sector detection
                    c.glyphPos = w;
                    // TASK 543: while a NEW angle dimension is being placed, the sector under the label decides what it measures
                    // (value + supplement). Geometry is untouched: both choices hold the lines where they are.
                    if (c.__placing && c.__newlyPlaced && !(c.isDriven || c.driven)) {
                        const choice = angleDimensionChoice(j1, j2, j3, j4, Math.atan2(w.y - int.y, w.x - int.x));
                        c.value = choice.value;
                        if (choice.supplement) c.supplement = true; else delete c.supplement;
                    }
                }
            }
        }
    } else if (c.type === CONSTRAINT_TYPES.DISTANCE && c.shapes && c.shapes.length === 2) {
        // Line-Line Distance: Offset is distance from first line?
        // For simplicity, we can just store the mouse position as glyphPos and let renderer handle it,
        // or calculate offset relative to the first line.
        c.glyphPos = w;
    } else if (isPointLineDistance(c)) {
        // Point-to-line: the dimension line runs from P to the foot of the perpendicular; the label sits `offset` to its side.
        const pt = sceneJoints(state.joints).get(c.joints[0]), la = sceneJoints(state.joints).get(c.joints[1]), lb = sceneJoints(state.joints).get(c.joints[2]);
        if (pt && la && lb) {
            const foot = projectPointOnLine(pt, la, lb);
            try { c.offset = perpendicularDistance(w, pt, foot); } catch(_) { c.offset = c.offset || SolverConfig.DIMENSION_OFFSET || 30; }
            const dx = foot.x - pt.x, dy = foot.y - pt.y, len = Math.hypot(dx, dy);
            const nx = len > 0.01 ? -dy / len : 0, ny = len > 0.01 ? dx / len : -1;
            c.glyphPos = { x: (pt.x + foot.x) / 2 + nx * c.offset, y: (pt.y + foot.y) / 2 + ny * c.offset };
        }
    } else if (c.joints && c.joints.length >= 2) {
        const j1 = sceneJoints(state.joints).get(c.joints[0]);
        const j2 = sceneJoints(state.joints).get(c.joints[1]);
        if (j1 && j2) {
            // Detect and store dimension mode ONLY during placement
            if (c.__placing) {
                const mode = detectDimMode(j1, j2, w);
                if (c.dimMode !== mode) {
                    logDim('dim-mode-change', { id: c.id || '(pending)', mode });
                }
                c.dimMode = mode;
                
                // Check for an existing same-mode DRIVING dim on THIS edge (same joint-pair).
                const hasConflict = state.constraints.some(oc =>
                    oc !== c &&
                    oc.type === CONSTRAINT_TYPES.DISTANCE &&
                    !oc.isDriven && !oc.driven &&
                    oc.joints && oc.joints.length >= 2 &&
                    ((oc.joints[0] === c.joints[0] && oc.joints[1] === c.joints[1]) || (oc.joints[0] === c.joints[1] && oc.joints[1] === c.joints[0])) &&
                    (oc.dimMode || 'aligned') === mode
                );
                // Promote to reference on a same-edge conflict, but NEVER DEMOTE an upstream driven decision
                // (e.g. a rank-redundant CROSS-edge dim already marked driven by ConstraintManager) back to a
                // driver — that's the "renders as driver despite the reference notice" bug. Keep both flags in sync.
                const isReference = !!(c.isDriven || c.driven || c._forcedDriven || hasConflict);
                c.isDriven = isReference;
                c.driven = isReference;

                const midX = (j1.x + j2.x) / 2;
                const midY = (j1.y + j2.y) / 2;
                
                if (mode === 'horizontal') {
                    c.offset = w.y - midY;
                    c.value = Math.abs(j2.x - j1.x);
                    c.glyphPos = { x: midX, y: w.y };
                } else if (mode === 'vertical') {
                    c.offset = w.x - midX;
                    c.value = Math.abs(j2.y - j1.y);
                    c.glyphPos = { x: w.x, y: midY };
                } else {
                    try { c.offset = perpendicularDistance(w, j1, j2); } catch(_) { c.offset = c.offset || SolverConfig.DIMENSION_OFFSET || 30; }
                    c.value = getDist(j1, j2);
                    const dx = j2.x - j1.x, dy = j2.y - j1.y;
                    const len = Math.hypot(dx, dy);
                    const nx = len > 0.01 ? -dy / len : 0;
                    const ny = len > 0.01 ? dx / len : -1;
                    c.glyphPos = { x: midX + nx * c.offset, y: midY + ny * c.offset };
                }
            } else {
                // After placement, just update offset (mode is locked)
                try { c.offset = perpendicularDistance(w, j1, j2); } catch(_) { c.offset = c.offset || SolverConfig.DIMENSION_OFFSET || 30; }
            }
        }
    }
}

export function handleDimensionPointerUp(e, svg, state) {
    if (state.currentTool !== TOOL_MODES.DIMENSION) return false;

    if (dimensionState.pendingPointer && dimensionState.pendingPointer.pointerId === e.pointerId) {
        dimensionState.pendingPointer = null;
    }

    // End drag
    if (state.drag && state.drag.type === DRAG_TYPES.DIMENSION) {
        if (state.drag.pointerId === e.pointerId) {
            const duration = Date.now() - (state.drag.startTime || 0);
            // If dragging for a while, drop on release
            if (duration > 250) {
                try { 
                    if (dimensionState.placingConstraint) { 
                        const c = dimensionState.placingConstraint;
                        // FIX: Update value for H/V modes on drag-release
                        if (c.dimMode === 'horizontal' && c.joints && c.joints.length >= 2) {
                             const j1 = sceneJoints(state.joints).get(c.joints[0]);
                             const j2 = sceneJoints(state.joints).get(c.joints[1]);
                             if (j1 && j2) c.value = Math.abs(j2.x - j1.x);
                        } else if (c.dimMode === 'vertical' && c.joints && c.joints.length >= 2) {
                             const j1 = sceneJoints(state.joints).get(c.joints[0]);
                             const j2 = sceneJoints(state.joints).get(c.joints[1]);
                             if (j1 && j2) c.value = Math.abs(j2.y - j1.y);
                        }
                        dimensionState.placingConstraint.__placing = false; 
                        dimensionState.placingConstraint = null; 
                    } 
                } catch(_){ }
                try { state.placingConstraint = null; } catch(_){ }
            }
            try { svg.releasePointerCapture(e.pointerId); } catch (_){ }
            state.drag = null;
        }
        return true;
    }

    return true;
}