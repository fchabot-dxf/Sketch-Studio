// ═══════════════════════════════════════════════════════════════════════════════
// SNAP CONSTRAINTS - Automatic constraint creation on snap
// ═══════════════════════════════════════════════════════════════════════════════

import { CONSTRAINT_TYPES } from './constants.js';
import { dbg } from './debug.js';
import { ConstraintManager } from './constraint-manager.js';
import { SolverConfig } from './solver-config.js';

/**
 * Apply appropriate constraint when a joint snaps to something
 * This is the SINGLE SOURCE OF TRUTH for snap-based constraints
 *
 * @param {object} state - Application state
 * @param {string} jointId - The joint that is snapping
 * @param {object} snapTarget - Snap target from findSnap()
 * @param {object} options - Optional settings
 * @param {boolean} options.allowPointOnLine - Allow point-on-line constraints (default: true)
 * @param {string[]} options.excludeJoints - Joint IDs to exclude from snapping
 * @returns {boolean} True if constraint was created
 */
export function applySnapConstraint(state, jointId, snapTarget, options = {}) {
    try{ dbg.debug('app', '[snap-constraints] applySnapConstraint called', { jointId, snapTarget: snapTarget && snapTarget.type ? { type: snapTarget.type, targetId: snapTarget.targetId || snapTarget.id, isLocked: snapTarget.isLocked } : snapTarget, options }); }catch(_){ }
    if (!snapTarget || !jointId || !state) return false;
    if (!state.constraints) state.constraints = []; // Ensure constraints array exists

    const opts = {
        allowPointOnLine: true,
        excludeJoints: [],
        ...options
    };

    // Note: excludeJoints filters potential TARGET joints/shapes to avoid snapping TO them.
    // The subject joint (the one being dragged, `jointId`) may be included in excludeJoints
    // to prevent self-search; do NOT abort when the subject is present. Target checks occur
    // later in each case (e.g., verifying targetJointId isn't in excludeJoints).

    const addViaManager = (type, params) => {
        const created = ConstraintManager.createConstraint(state, type, params, { source: 'snap' });
        return !!created;
    };

    switch (snapTarget.type) {
        case 'joint':
        case 'point': // Handle 'point' type if it refers to a joint ID
            // Joint-to-Joint → COINCIDENT constraint
            // Support multiple snap target shapes: {id} or {targetId}
            const targetJointId = snapTarget.id || snapTarget.targetId || (snapTarget.target && snapTarget.target.id);
            if (!targetJointId) { return false; }
            if (targetJointId === jointId) { return false; } // Can't snap to self
            if (opts.excludeJoints.includes(targetJointId)) { return false; }

            try{
                return addViaManager(CONSTRAINT_TYPES.COINCIDENT, { joints: [jointId, targetJointId] });
            }catch(e){ return false; }

        case 'line':
        case 'shape':
            // Joint-to-Line → POINT_ON_LINE constraint (or COINCIDENT if snapping to an endpoint)
            if (!opts.allowPointOnLine) return false;
            // Accept either full shape object or a targetId reference
            const shapeId = (snapTarget.shape && snapTarget.shape.id) ? snapTarget.shape.id : (snapTarget.targetId || snapTarget.id || null);
            if (!shapeId) {
                // Try to resolve by searching state.shapes if available
                if (snapTarget.shape && typeof snapTarget.shape === 'string') {
                    // Already a string id
                } else if (state && state.shapes && snapTarget && snapTarget.shape && snapTarget.shape.id) {
                    // already handled above
                } else {
                    return false;
                }
            }

            // Retrieve shape joints if needed
            let lineJoints = [];
            if (snapTarget.shape && Array.isArray(snapTarget.shape.joints)) lineJoints = snapTarget.shape.joints;
            else if (state && state.shapes) {
                const s = state.shapes.find(xx => xx.id === shapeId);
                if (s && s.joints) lineJoints = s.joints;
            }

            // Don't create point-on-line if joint is already an endpoint of the line
            if (lineJoints.includes(jointId)) return false;

            // If the snap point is very close to an endpoint joint, create a COINCIDENT with that endpoint
            try{
                const snapPt = snapTarget.pt || (snapTarget.shape && snapTarget.shape.pt) || null;
                if (snapPt && state && state.joints && Array.isArray(lineJoints) && lineJoints.length > 0) {
                    // world-space proximity threshold (configurable via SolverConfig)
                    const EPS = SolverConfig.SNAP_WORLD_EPS || 0.1;
                    for (const lid of lineJoints) {
                        const lj = state.joints.get(lid);
                        if (!lj) continue;
                        const dx = lj.x - snapPt.x; const dy = lj.y - snapPt.y;
                        if (Math.hypot(dx, dy) < EPS) {
                            // Snap was effectively on an endpoint — create COINCIDENT to endpoint
                            try{ return addViaManager(CONSTRAINT_TYPES.COINCIDENT, { joints: [jointId, lid] }); }catch(_){ return false; }
                        }
                    }
                }

                // Otherwise, add a POINT_ON_LINE constraint
                return addViaManager(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: jointId, shape: shapeId });
            }catch(e){ return false; }

        case 'midpoint':
            // Joint-to-Line or joint-to-joints midpoint -> MIDPOINT constraint referencing anchor joints
            // If the snapTarget provides explicit anchor joint ids, prefer them (supports line→line midpoints)
            let anchorJoints = null;
            if (Array.isArray(snapTarget.joints) && snapTarget.joints.length >= 2) {
                anchorJoints = snapTarget.joints.slice(0,2);
            } else {
                const midShapeId = (snapTarget.shape && snapTarget.shape.id) ? snapTarget.shape.id : (snapTarget.targetId || snapTarget.id || null);
                if (!midShapeId) return false;
                if (snapTarget.shape && Array.isArray(snapTarget.shape.joints)) anchorJoints = snapTarget.shape.joints.slice(0,2);
                else if (state && state.shapes) {
                    const s = state.shapes.find(xx => xx.id === midShapeId);
                    if (s && s.joints) anchorJoints = s.joints.slice(0,2);
                }
            }
            if (!anchorJoints || anchorJoints.length < 2) return false;
            if (anchorJoints.includes(jointId)) return false;
            try{
                return addViaManager(CONSTRAINT_TYPES.MIDPOINT, { joints: [anchorJoints[0], anchorJoints[1], jointId] });
            }catch(e){ return false; }

        case 'grid':
            // Grid snaps are visual-only and should not create constraints. Return false so
            // callers can treat the grid snap as a location only.
            return false;

        default:
            return false;
    }
}

/**
 * Check if a joint would snap, and return what constraint would be created
 * (Preview mode - doesn't actually create the constraint)
 *
 * @param {object} snapTarget - Snap target from findSnap()
 * @param {string} jointId - The joint that would snap
 * @param {object} options - Optional settings
 * @returns {object|null} Preview of constraint that would be created
 */
export function previewSnapConstraint(snapTarget, jointId, options = {}) {
    if (!snapTarget || !jointId) return null;

    const opts = {
        allowPointOnLine: true,
        excludeJoints: [],
        ...options
    };

    switch (snapTarget.type) {
        case 'joint':
        case 'point':
            if (snapTarget.id === jointId) return null;
            if (opts.excludeJoints.includes(snapTarget.id)) return null;

            return {
                type: CONSTRAINT_TYPES.COINCIDENT,
                joints: [jointId, snapTarget.id],
                __isPreview: true
            };

        case 'line':
        case 'shape':
            if (!opts.allowPointOnLine) return null;

            const lineJoints = snapTarget.shape?.joints || [];
            if (lineJoints.includes(jointId)) return null;

            return {
                type: CONSTRAINT_TYPES.POINT_ON_LINE,
                joint: jointId,
                shape: snapTarget.shape.id,
                __isPreview: true
            };
        case 'midpoint':
            // Preview for midpoint constraint
            const midLineJoints = Array.isArray(snapTarget.joints) && snapTarget.joints.length >= 2 ? snapTarget.joints : (snapTarget.shape?.joints || []);
            if (!midLineJoints || midLineJoints.length < 2) return null;
            if (midLineJoints.includes(jointId)) return null;
            return {
                type: CONSTRAINT_TYPES.MIDPOINT,
                joints: [midLineJoints[0], midLineJoints[1], jointId],
                __isPreview: true
            };
        default:
            return null;
    }
}