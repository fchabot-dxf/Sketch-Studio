import { SolverConfig } from '#core/solver-config.js';
// ═══════════════════════════════════════════════════════════════════════════════
// DIMENSION TOOL - Handles creation of distance and radius constraints
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES, CONSTRAINT_TYPES, DRAG_TYPES, DEFAULTS } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { screenToWorld, worldToScreen } from '#app/coords.js';
import { getDist, perpendicularDistance, projectPointOnLine, getLineIntersection } from '#core/geometry.js';
import { showEditInput, showSingleInput } from '../numeric-input-manager.js';
import { analyzeConstraintStatus } from '#core/constraint-status.js';
import { showNotification } from '../notification-manager.js';

function logDim() { /* logging disabled */ }

// Helper: check if a driving DISTANCE constraint exists for a pair of joints
function hasDrivingDistanceForJoints(state, aId, bId){
    if(!state || !Array.isArray(state.constraints)) return false;
    return state.constraints.some(c => c && c.type === CONSTRAINT_TYPES.DISTANCE && Array.isArray(c.joints) && c.joints.length>=2 && (
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
    try { if (state.beginUndoGroup) state.beginUndoGroup(); } catch(_) {}
    try { if (state.saveState) state.saveState(); } catch(_) {}
}
function endDimUndo(state){
    if (!state) return;
    try { if (state.endUndoGroup) state.endUndoGroup(); } catch(_) {}
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
    dimensionState.pendingDimension = null;
    dimensionState.placingConstraint = null;
    if (state && state.placingConstraint) state.placingConstraint = null;
    if (state && state.active && state.active.mode === TOOL_MODES.DIMENSION) {
        state.active = null;
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
        const shape = state.shapes.find(s => s && s.id === selectedShapes[0]);
        if (shape && shape.type === 'line' && shape.joints && shape.joints.length >= 2) {
            const j1 = state.joints.get(shape.joints[0]);
            const j2 = state.joints.get(shape.joints[1]);
            if (!j1 || !j2) return false;

            // If this line already has a driving distance dimension, don't auto-create another.
            // Instead enter a pending state so a second line-click can be used to measure angle/line-line distance.
            if (hasDrivingDistanceForShape(state, shape.id)) {
                dimensionState.pendingDimension = { type: 'line', firstShapeId: shape.id };
                showNotification(
                    'Line already dimensioned. Click another line to measure angle or click the label to edit existing dimension. [ERR-DIM-01] Reason: Line already has a driving dimension.\nArgs: ' +
                    JSON.stringify({ shape }),
                    'info'
                );
                return true;
            }

            // Otherwise create a DRIVEN (non-driving) dimension so activating the tool does not unexpectedly distort geometry.
            beginDimUndo(state);
            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                joints: [shape.joints[0], shape.joints[1]],
                value: getDist(j1, j2),
                dimMode: 'auto',
                // Mark as non-driving initially so solver won't 'crush' geometry on activation.
                isDriven: true
            });
            const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
            if (!c) { endDimUndo(state); return false; }

            const w = placePos || { x: (j1.x + j2.x) / 2, y: (j1.y + j2.y) / 2 };

            logDim('create-line-dim', { id: c.id || '(new)', keepPlacing, placePos: w, keyboardPlaced: !!opts.keyboardPlaced });

            try { c.__placing = true; } catch(_){ }
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
            endDimUndo(state);
            return true;
        }
    }

    // Case B: Two selected joints
    if (selectedJoints.length === 2) {
        const j1 = state.joints.get(selectedJoints[0]);
        const j2 = state.joints.get(selectedJoints[1]);
        if (!j1 || !j2) return false;

        beginDimUndo(state);
        const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            joints: [selectedJoints[0], selectedJoints[1]],
            value: getDist(j1, j2),
            dimMode: 'auto'
        });
        const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
        if (!c) { endDimUndo(state); return false; }

        const w = placePos || { x: (j1.x + j2.x) / 2, y: (j1.y + j2.y) / 2 };

        logDim('create-joints-dim', { id: c.id || '(new)', keepPlacing, placePos: w, keyboardPlaced: !!opts.keyboardPlaced });

        try { c.__placing = true; } catch(_){ }
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
        endDimUndo(state);
        return true;
    }

    return false;
}

/**
 * Handle pointer down for dimension creation
 */
export function handleDimensionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint) {
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
            if (constraint.isDriven || constraint.driven) return true; // Disable editing for driven dimensions
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
                const s1 = state.shapes.find(s => s.type === 'line' && s.joints.includes(pending.joints[0]) && s.joints.includes(pending.joints[1]));
                logDim('source-line', { source: s1 ? s1.id : null });
                
                // If we found the original line and it's different from the new one
                if (s1 && s1.id !== s2.id) {
                    logDim('upgrade-line-dim', { pendingId: pending.id || '(pending)', s1: s1.id, s2: s2.id });
                    // Remove the temporary length constraint
                    const idx = state.constraints.indexOf(pending);
                    if (idx !== -1) state.constraints.splice(idx, 1);

                    // Check Parallelism
                    const j1a = state.joints.get(s1.joints[0]);
                    const j1b = state.joints.get(s1.joints[1]);
                    const j2a = state.joints.get(s2.joints[0]);
                    const j2b = state.joints.get(s2.joints[1]);

                    const a1 = Math.atan2(j1b.y - j1a.y, j1b.x - j1a.x);
                    const a2 = Math.atan2(j2b.y - j2a.y, j2b.x - j2a.x);
                    
                    // Normalize angles to 0-PI for parallel check
                    const ang1 = (a1 + Math.PI * 2) % Math.PI;
                    const ang2 = (a2 + Math.PI * 2) % Math.PI;
                    const diff = Math.abs(ang1 - ang2);
                    const isParallel = diff < 0.01 || Math.abs(diff - Math.PI) < 0.01;
                    logDim('parallel-check', { ang1, ang2, diff, isParallel });

                    let success = false;
                    if (isParallel) {
                        logDim('create-line-line-distance', { s1: s1.id, s2: s2.id });
                        // Create Line-Line Distance
                        const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                            shapes: [s1.id, s2.id],
                            value: perpendicularDistance(j1a, j2a, j2b)
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
                    
                    // Clear the preview active state now that we are creating the real constraint
                    state.active = null;

                    logDim('upgrade-constraint-result', { success });

                    // If added successfully, use the new constraint. If duplicate (success=false), find the existing one.
                    let targetConstraint = success ? state.constraints[state.constraints.length - 1] : null;
                    if (!targetConstraint) {
                        const type = isParallel ? CONSTRAINT_TYPES.DISTANCE : CONSTRAINT_TYPES.ANGLE;
                        logDim('recover-existing-constraint', { type, s1: s1.id, s2: s2.id });
                        targetConstraint = state.constraints.find(c => c.type === type && c.shapes && 
                            ((c.shapes[0] === s1.id && c.shapes[1] === s2.id) || (c.shapes[0] === s2.id && c.shapes[1] === s1.id))
                        );
                        logDim('recover-existing-constraint-result', { found: !!targetConstraint });
                    }

                    if (targetConstraint) {
                        startPlacing(svg, state, targetConstraint, e, w);
                    }
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
                const savedPositions = new Map();
                for (const [id, j] of state.joints) savedPositions.set(id, { x: j.x, y: j.y });
                const testConstraint = { type: CONSTRAINT_TYPES.DISTANCE, joints: [j1, j2], value: pending.value, __temp: true, isDriven: false };
                state.constraints.push(testConstraint);
                try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.ITERATIONS || 500); } catch(_) {}
                const a = state.joints.get(j1);
                const b = state.joints.get(j2);
                const dist = (a && b) ? getDist(a, b) : null;
                // Remove temp constraint
                const idx = state.constraints.indexOf(testConstraint);
                if (idx !== -1) state.constraints.splice(idx, 1);
                // Restore geometry
                for (const [id, pos] of savedPositions) {
                    const j = state.joints.get(id);
                    if (j) { j.x = pos.x; j.y = pos.y; }
                }

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
             const j1 = state.joints.get(pending.joints[0]);
             const j2 = state.joints.get(pending.joints[1]);
             if (j1 && j2) pending.value = Math.abs(j2.x - j1.x);
        } else if (pending.dimMode === 'vertical' && pending.joints && pending.joints.length >= 2) {
             const j1 = state.joints.get(pending.joints[0]);
             const j2 = state.joints.get(pending.joints[1]);
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

            beginDimUndo(state);
            const a = state.joints.get(lineShape.joints[0]);
            const b = state.joints.get(lineShape.joints[1]);
            const firstJ = state.joints.get(firstId);
            
            if (a && b && firstJ) {
                // Project point onto line to find perpendicular distance
                const projPt = projectPointOnLine(firstJ, a, b);
                
                // Create internal helper joint at projection
                const projId = state.genJ();
                state.joints.set(projId, { x: projPt.x, y: projPt.y, fixed: false, isInternal: true });
                
                // Attach projection to line
                ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.POINT_ON_LINE, { joint: projId, shape: lineShape.id }, { source: 'dimension' });

                // Create distance constraint
                ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                    joints: [firstId, projId],
                    value: getDist(firstJ, projPt)
                }, { source: 'dimension' });
                
                const c = state.constraints[state.constraints.length - 1];
                try{ c.offset = perpendicularDistance(w, a, b); } catch(_){ c.offset = SolverConfig.DIMENSION_OFFSET || 30; }
                
                startPlacing(svg, state, c, e, w);
            }
            dimensionState.pendingDimension = null;
            endDimUndo(state);
            return true;
        }

        // Case B: Clicked another Joint -> Create Point-to-Point Dimension
        if (hitJoint) {
            logDim('create-point-to-point');
            if (dimensionState.pendingDimension.firstJoint === hitJoint.id) return false; // Ignore self-click

            beginDimUndo(state);
            const firstId = dimensionState.pendingDimension.firstJoint;
            const j1 = state.joints.get(firstId);
            
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
            endDimUndo(state);
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
            const j1 = state.joints.get(shape.joints[0]);
            const j2 = state.joints.get(shape.joints[1]);
            
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
            endDimUndo(state);
            return true;
        }
        else if (shape.type === 'circle' || shape.type === 'arc') {
            const centerId = shape.joints[0];
            const center = state.joints.get(centerId);
            let radius = (typeof shape.radius === 'number') ? shape.radius : 0;
            
            const alreadyHasDriving = hasDrivingDistanceForShape(state, shape.id);

            const res = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                shape: shape.id,
                value: radius,
                isRadius: true,
                isDriven: alreadyHasDriving
            });
            
            const c = (res && typeof res === 'object') ? res : state.constraints[state.constraints.length - 1];
            if (!c) { endDimUndo(state); return false; }

            const w = placePos || { x: center.x + radius, y: center.y };
            logDim('create-radius-dim', { id: c.id || '(new)', keepPlacing, placePos: w, keyboardPlaced: !!opts.keyboardPlaced, radius });
            try { c.__placing = true; } catch(_){ }
            try { c.glyphPos = w; } catch(_){ }
            try{ c.offset = getDist(center, w) - radius; }catch(_){ c.offset = SolverConfig.DIMENSION_OFFSET || 30; }

            if (keepPlacing) {
                try { state.placingConstraint = c; } catch(_) {}
                dimensionState.placingConstraint = c;
                try { if (opts.keyboardPlaced) c.__keyboardPlaced = true; } catch(_) {}
            } else {
                try { c.__placing = false; } catch(_){ }
                dimensionState.editingConstraint = c;
                showEditInput(svg, state, c);
            }
            endDimUndo(state);
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
             const sourceLine = state.shapes.find(s => s.type === 'line' && s.joints.includes(c.joints[0]) && s.joints.includes(c.joints[1]));
             
             if (sourceLine) {
                 let bestLine = null;
                 let minD = 20; // 20px hit tolerance
                 
                 for (const s of state.shapes) {
                     if (s.id === sourceLine.id) continue;
                     if (s.type !== 'line') continue;
                     
                     const j1 = state.joints.get(s.joints[0]);
                     const j2 = state.joints.get(s.joints[1]);
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
                     const j1a = state.joints.get(s1.joints[0]);
                     const j1b = state.joints.get(s1.joints[1]);
                     const j2a = state.joints.get(s2.joints[0]);
                     const j2b = state.joints.get(s2.joints[1]);

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
        updateConstraintOffset(state, constraint, w);
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

export function updateConstraintOffset(state, c, w) {
    if (c.isRadius) {
        const shape = state.shapes ? state.shapes.find(s => s.id === c.shape) : null;
        const center = (shape && shape.joints && shape.joints[0]) ? state.joints.get(shape.joints[0]) : null;
        if (center) {
            const radius = (typeof c.value === 'number') ? c.value : ((shape && typeof shape.radius === 'number') ? shape.radius : 0);
            try { c.offset = getDist(center, w) - radius; } catch(_) { c.offset = SolverConfig.DIMENSION_OFFSET || 30; }
        }
    } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
        // Angle Dimension: Offset is radius from intersection
        const s1 = state.shapes.find(s => s.id === c.shapes[0]);
        const s2 = state.shapes.find(s => s.id === c.shapes[1]);
        if (s1 && s2) {
            const j1 = state.joints.get(s1.joints[0]), j2 = state.joints.get(s1.joints[1]);
            const j3 = state.joints.get(s2.joints[0]), j4 = state.joints.get(s2.joints[1]);
            if (j1 && j2 && j3 && j4) {
                const int = getLineIntersection(j1, j2, j3, j4);
                if (int) {
                    c.offset = getDist(int, w);
                    // Also store explicit position for sector detection
                    c.glyphPos = w;
                }
            }
        }
    } else if (c.type === CONSTRAINT_TYPES.DISTANCE && c.shapes && c.shapes.length === 2) {
        // Line-Line Distance: Offset is distance from first line?
        // For simplicity, we can just store the mouse position as glyphPos and let renderer handle it,
        // or calculate offset relative to the first line.
        c.glyphPos = w;
    } else if (c.joints && c.joints.length >= 2) {
        const j1 = state.joints.get(c.joints[0]);
        const j2 = state.joints.get(c.joints[1]);
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
                c.isDriven = !!(c.isDriven || c.driven || hasConflict);
                c.driven = c.isDriven;

                const midX = (j1.x + j2.x) / 2;
                const midY = (j1.y + j2.y) / 2;
                
                if (mode === 'horizontal') {
                    c.offset = w.y - midY;
                } else if (mode === 'vertical') {
                    c.offset = w.x - midX;
                } else {
                    try { c.offset = perpendicularDistance(w, j1, j2); } catch(_) { c.offset = c.offset || SolverConfig.DIMENSION_OFFSET || 30; }
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
                             const j1 = state.joints.get(c.joints[0]);
                             const j2 = state.joints.get(c.joints[1]);
                             if (j1 && j2) c.value = Math.abs(j2.x - j1.x);
                        } else if (c.dimMode === 'vertical' && c.joints && c.joints.length >= 2) {
                             const j1 = state.joints.get(c.joints[0]);
                             const j2 = state.joints.get(c.joints[1]);
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