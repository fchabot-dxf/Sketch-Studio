// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINT TOOLS - Handles constraint creation and manipulation
// ═══════════════════════════════════════════════════════════════════════════════

import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { dbg } from '#core/debug.js';

export function setupConstraintTools(svg, appState) {
    dbg.log('constraints', '[constraint-tools] Setting up constraint tools...');
}

export function handleConstraintPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint) {
    if (![
        TOOL_MODES.COINCIDENT,
        TOOL_MODES.HORIZONTAL_VERTICAL,
        TOOL_MODES.MIDPOINT,
        TOOL_MODES.PARALLEL,
        TOOL_MODES.PERPENDICULAR,
        TOOL_MODES.COLLINEAR,
        TOOL_MODES.TANGENT,
        TOOL_MODES.EQUAL
    ].includes(state.currentTool)) {
        return false;
    }
    
    switch (state.currentTool) {
        case TOOL_MODES.HORIZONTAL_VERTICAL:
            return handleHorizontalVerticalPointerDown(e, svg, state, hitJoint, hitShape);
        case TOOL_MODES.PARALLEL:
        case TOOL_MODES.PERPENDICULAR:
            return handleShapeConstraintPointerDown(e, svg, state, hitShape);
        case TOOL_MODES.COINCIDENT:
            return handleCoincidentPointerDown(e, svg, state, hitJoint, hitShape);
        case TOOL_MODES.COLLINEAR:
            // FIX: Pass hitShape instead of hitJoint
            return handleCollinearPointerDown(e, svg, state, hitShape);
        case TOOL_MODES.TANGENT:
            return handleTangentPointerDown(e, svg, state, hitShape);
        case TOOL_MODES.EQUAL:
            return handleEqualPointerDown(e, svg, state, hitShape);
        case TOOL_MODES.MIDPOINT:
            return handleMidpointPointerDown(e, svg, state, hitJoint, hitShape);
    }
    
    return false;
}

function handleHorizontalVerticalPointerDown(e, svg, state, hitJoint, hitShape) {
    // Case 1: Line (Immediate)
    if (hitShape && hitShape.shape && hitShape.shape.type === 'line') {
        const s = hitShape.shape;
        const j1 = state.joints.get(s.joints[0]);
        const j2 = state.joints.get(s.joints[1]);
        if (!j1 || !j2) return false;

        // If we were pending a joint, this is a mismatch (Joint + Line invalid for H/V) -> Exit
        if (state.pendingConstraint) return false;

        const dx = Math.abs(j2.x - j1.x);
        const dy = Math.abs(j2.y - j1.y);
        const constraintType = dx > dy ? CONSTRAINT_TYPES.HORIZONTAL : CONSTRAINT_TYPES.VERTICAL;
        ConstraintManager.createConstraint(state, constraintType, { joints: [s.joints[0], s.joints[1]] }, { source: 'toolbar' });
        return true;
    }

    // Case 2: Joint (Multi-step)
    if (hitJoint) {
        if (!state.pendingConstraint || !state.pendingConstraint.firstElement) {
            state.pendingConstraint = { type: state.currentTool, firstElement: { type: 'joint', id: hitJoint.id } };
            state.selectedJoints.add(hitJoint.id);
            return true;
        } else {
            const first = state.pendingConstraint.firstElement;
            if (first.type !== 'joint') return false; // Mismatch (Line + Joint invalid)
            if (first.id === hitJoint.id) return false; // Self-click

            const constraintType = state.currentTool === TOOL_MODES.HORIZONTAL_VERTICAL ? CONSTRAINT_TYPES.HORIZONTAL : state.currentTool; // Default to Horiz for 2-points if generic H/V tool, or specific if split
            // Note: The generic H/V tool usually infers from lines. For 2 points, we default to Horizontal or Vertical based on alignment? 
            // For now, let's assume the tool mode maps to specific constraints or we auto-detect.
            // Since TOOL_MODES.HORIZONTAL_VERTICAL is a single button, we need auto-detect logic similar to lines.
            const j1 = state.joints.get(first.id);
            const j2 = hitJoint.j;
            const dx = Math.abs(j2.x - j1.x);
            const dy = Math.abs(j2.y - j1.y);
            const type = (state.currentTool === TOOL_MODES.HORIZONTAL_VERTICAL) ? (dx > dy ? CONSTRAINT_TYPES.HORIZONTAL : CONSTRAINT_TYPES.VERTICAL) : state.currentTool;

            ConstraintManager.createConstraint(state, type, { joints: [first.id, hitJoint.id] }, { source: 'toolbar' });
            
            state.selectedJoints.delete(first.id);
            resetConstraintState(state);
            return true;
        }
    }

    return false;
}

function handleShapeConstraintPointerDown(e, svg, state, hitShape) {
    if (!hitShape) return false;
    // ENFORCE LINE TYPE
    if (hitShape.shape.type !== 'line') { console.warn('Parallel/Perpendicular requires a Line'); return false; }
    
    if (!state.pendingConstraint || !state.pendingConstraint.firstElement) {
        state.pendingConstraint = { type: state.currentTool, firstElement: { type: 'shape', id: hitShape.shape.id } };
        state.selectedShapes.add(hitShape.shape.id);
        return true;
    } else {
        const firstId = state.pendingConstraint.firstElement.id;
        if (firstId === hitShape.shape.id) return false;
        const constraintType = state.currentTool === TOOL_MODES.PARALLEL ? CONSTRAINT_TYPES.PARALLEL : CONSTRAINT_TYPES.PERPENDICULAR;
        ConstraintManager.createConstraint(state, constraintType, { shapes: [firstId, hitShape.shape.id] }, { source: 'toolbar' });
        state.selectedShapes.delete(firstId);
        resetConstraintState(state);
        return true;
    }
}

function handleCoincidentPointerDown(e, svg, state, hitJoint, hitShape) {
    // COINCIDENT tool operates on joints only in the UI (Point-on-Line is handled by other flows)
    if (!hitJoint) return false;

    if (!state.pendingConstraint || !state.pendingConstraint.firstElement) {
        state.pendingConstraint = { type: TOOL_MODES.COINCIDENT, firstElement: { type: 'joint', id: hitJoint.id } };
        state.selectedJoints.add(hitJoint.id);
        return true;
    } else {
        const first = state.pendingConstraint.firstElement;
        // Case: Joint + Joint -> Coincident
        if (first.type === 'joint' && hitJoint) {
            if (first.id !== hitJoint.id) {
                ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [first.id, hitJoint.id] }, { source: 'toolbar' });
            }
        }

        // Cleanup selection highlights
        if (first.type === 'joint') state.selectedJoints.delete(first.id);

        resetConstraintState(state);
        return true;
    }
}

/**
 * Handle collinear constraint (Select 2 Lines)
 */
function handleCollinearPointerDown(e, svg, state, hitShape) {
    // FIX: Require Lines, not Joints
    if (!hitShape) return false;
    const shape = hitShape.shape;
    if (shape.type !== 'line') return false;

    // Initialize pending constraint if needed
    if (!state.pendingConstraint) state.pendingConstraint = { type: TOOL_MODES.COLLINEAR, selectionBuffer: [] };
    // If firstElement was set by UI manager, move it to buffer
    if (state.pendingConstraint.firstElement && state.pendingConstraint.firstElement.type === 'shape') {
        const s = state.shapes.find(x => x.id === state.pendingConstraint.firstElement.id);
        if (s) state.pendingConstraint.selectionBuffer = [s];
        delete state.pendingConstraint.firstElement;
    }
    if (!state.pendingConstraint.selectionBuffer) state.pendingConstraint.selectionBuffer = [];

    if (state.pendingConstraint.selectionBuffer.some(s => s.id === shape.id)) return false;

    state.pendingConstraint.selectionBuffer.push(shape);
    state.selectedShapes.add(shape.id);

    // If we have 2 lines, extract their 4 endpoints and apply constraint
    if (state.pendingConstraint.selectionBuffer.length === 2) {
        const l1 = state.pendingConstraint.selectionBuffer[0];
        const l2 = state.pendingConstraint.selectionBuffer[1];
        
        // Apply Collinear to the LINES (Shapes), not the joints.
        // The solver will handle the 4 distinct joints (2 per line).
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COLLINEAR, { 
            shapes: [l1.id, l2.id]
        }, { source: 'toolbar' });
        
        state.selectedShapes.delete(l1.id);
        state.selectedShapes.delete(l2.id);
        resetConstraintState(state);
    }
    return true;
}

/**
 * Handle tangent constraint (Line + Circle)
 */
function handleTangentPointerDown(e, svg, state, hitShape) {
    if (!hitShape) return false;
    const shape = hitShape.shape;

    if (!state.pendingConstraint) state.pendingConstraint = { type: TOOL_MODES.TANGENT, selectionBuffer: [] };
    // If firstElement was set by UI manager, move it to buffer
    if (state.pendingConstraint.firstElement && state.pendingConstraint.firstElement.type === 'shape') {
        const s = state.shapes.find(x => x.id === state.pendingConstraint.firstElement.id);
        if (s) state.pendingConstraint.selectionBuffer = [s];
        delete state.pendingConstraint.firstElement;
    }
    if (!state.pendingConstraint.selectionBuffer) state.pendingConstraint.selectionBuffer = [];

    if (state.pendingConstraint.selectionBuffer.some(s => s.id === shape.id)) return false;

    state.pendingConstraint.selectionBuffer.push(shape);
    state.selectedShapes.add(shape.id);

    if (state.pendingConstraint.selectionBuffer.length === 2) {
        const s1 = state.pendingConstraint.selectionBuffer[0];
        const s2 = state.pendingConstraint.selectionBuffer[1];

        // Allow Line + (Circle|Arc) and (Circle|Arc) + (Circle|Arc)
        const circleLike = (s) => s.type === 'circle' || s.type === 'arc';

        // Line + Circle/Arc
        if ((s1.type === 'line' && circleLike(s2)) || (s2.type === 'line' && circleLike(s1))) {
            const line = s1.type === 'line' ? s1 : s2;
            const circle = s1.type === 'line' ? s2 : s1;
            ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: line.id, circle: circle.id }, { source: 'toolbar' });
        }
        // Circle/Arc + Circle/Arc
        else if (circleLike(s1) && circleLike(s2)) {
            ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { shapes: [s1.id, s2.id] }, { source: 'toolbar' });
        } else {
            console.warn('[constraint-tools] TANGENT requires a Line+Circle/Arc or Circle/Arc+Circle/Arc');
        }
        
        state.selectedShapes.delete(s1.id);
        state.selectedShapes.delete(s2.id);
        resetConstraintState(state);
    }
    return true;
}

/**
 * Handle midpoint constraint (3 Joints or 1 Line + 1 Joint)
 */
function handleMidpointPointerDown(e, svg, state, hitJoint, hitShape) {
    // Initialize pending
    if (!state.pendingConstraint) state.pendingConstraint = { type: TOOL_MODES.MIDPOINT, selectionBuffer: [] };

    // Ensure selectionBuffer exists (ui-manager may create pendingConstraint without it)
    if (!state.pendingConstraint.selectionBuffer) state.pendingConstraint.selectionBuffer = [];
    
    // Handle pre-selection from UI manager
    if (state.pendingConstraint.firstElement) {
         if (state.pendingConstraint.firstElement.type === 'joint') {
             state.pendingConstraint.selectionBuffer.push({ type: 'joint', id: state.pendingConstraint.firstElement.id });
         } else if (state.pendingConstraint.firstElement.type === 'shape') {
             const s = state.shapes.find(x => x.id === state.pendingConstraint.firstElement.id);
             if (s) state.pendingConstraint.selectionBuffer.push({ type: 'shape', id: s.id, shape: s });
         }
         delete state.pendingConstraint.firstElement;
    }
    
    const buffer = state.pendingConstraint.selectionBuffer;

    // Add current hit
    if (hitJoint) {
        if (!buffer.some(x => x.type === 'joint' && x.id === hitJoint.id)) {
            buffer.push({ type: 'joint', id: hitJoint.id });
            state.selectedJoints.add(hitJoint.id);
        }
    } else if (hitShape && hitShape.shape.type === 'line') {
        if (!buffer.some(x => x.type === 'shape' && x.id === hitShape.shape.id)) {
            buffer.push({ type: 'shape', id: hitShape.shape.id, shape: hitShape.shape });
            state.selectedShapes.add(hitShape.shape.id);
        }
    } else {
        return false;
    }

    // Check for valid combinations
    let endpoints = [], midpoint = null;
    const lineItem = buffer.find(x => x.type === 'shape');
    const jointItems = buffer.filter(x => x.type === 'joint');

    if (lineItem && jointItems.length === 1) {
        endpoints = lineItem.shape.joints;
        midpoint = jointItems[0].id;
    } else if (jointItems.length === 3) {
        endpoints = [jointItems[0].id, jointItems[1].id];
        midpoint = jointItems[2].id;
    }

        if (endpoints.length === 2 && midpoint && !endpoints.includes(midpoint)) {
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [endpoints[0], endpoints[1], midpoint] }, { source: 'toolbar' });
        state.selectedJoints.clear(); state.selectedShapes.clear();
        resetConstraintState(state);
    }
    return true;
}

/**
 * Handle equal constraint (Line-Line or Circle-Circle)
 */
function handleEqualPointerDown(e, svg, state, hitShape) {
    if (!hitShape) return false;
    const shape = hitShape.shape;

    if (!state.pendingConstraint) state.pendingConstraint = { type: TOOL_MODES.EQUAL, selectionBuffer: [] };
    // If firstElement was set by UI manager, move it to buffer
    if (state.pendingConstraint.firstElement && state.pendingConstraint.firstElement.type === 'shape') {
        const s = state.shapes.find(x => x.id === state.pendingConstraint.firstElement.id);
        if (s) state.pendingConstraint.selectionBuffer = [s];
        delete state.pendingConstraint.firstElement;
    }
    if (!state.pendingConstraint.selectionBuffer) state.pendingConstraint.selectionBuffer = [];

    if (state.pendingConstraint.selectionBuffer.some(s => s.id === shape.id)) return false;

    state.pendingConstraint.selectionBuffer.push(shape);
    state.selectedShapes.add(shape.id);

    if (state.pendingConstraint.selectionBuffer.length === 2) {
        const s1 = state.pendingConstraint.selectionBuffer[0];
        const s2 = state.pendingConstraint.selectionBuffer[1];

            // Only allow equal between two lines or two circles/arcs
        const isCircleLike = (s) => s.type === 'circle' || s.type === 'arc';
        if ((s1.type === 'line' && s2.type === 'line') || (isCircleLike(s1) && isCircleLike(s2))) {
            ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.EQUAL, { shapes: [s1.id, s2.id] }, { source: 'toolbar' });
        } else {
            console.warn('[constraint-tools] EQUAL requires two lines or two circles/arcs');
        }

        state.selectedShapes.delete(s1.id);
        state.selectedShapes.delete(s2.id);
        resetConstraintState(state);
    }
    return true;
}

export function handleConstraintPointerMove(e, svg, state) { return false; }
export function handleConstraintPointerUp(e, svg, state) { return false; }

export function resetConstraintState(state) {
    if (state) {
        state.pendingConstraint = null;
    }
}