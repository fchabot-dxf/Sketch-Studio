// ═══════════════════════════════════════════════════════════════════════════════
// SNAP CONSTRAINTS - Automatic constraint creation on snap
// ═══════════════════════════════════════════════════════════════════════════════

import { CONSTRAINT_TYPES, AXIS_SNAP_TARGETS, ORIGIN_JOINT_ID } from './constants.js';
import { dbg } from './debug.js';
import { ConstraintManager } from './constraint-manager.js';
import { SolverConfig } from './solver-config.js';
import { curveEnds } from './loop-finder.js';
import { mergeJoints } from './joints.js';
import { inActiveSketch } from './sketch-model.js';

/**
 * TASK 1045: WHAT KIND OF JOIN a snap on an existing point makes, the caller's intent (passed explicitly by every caller of applySnapConstraint):
 *   DRAW  a drawing tool places a NEW point of a new curve (Line, Rectangle, Arc, Circle, Polygon, Slot, Bezier): on an existing curve END POINT
 *         the new point is that point, SHARED (Fusion, MEASURED by the advisor 2026-11-27 with real clicks: "every DRAWING tool joins meeting
 *         ends with ONE shared point"; a 2-point rectangle's first corner clicked on a line's end -> 1 point used by 3 curves). On any other point
 *         (a circle's or an arc's centre, a lone point, the origin) it is GLUED, a separate point + Coincident (Fusion measured the same day: a
 *         line end on a circle centre, a line end on a lone point, a line start at the origin: separate point + Coincident).
 *   GLUE  an edit joins an EXISTING point (the drag-snap of a point onto another, Trim / Break's cut on its cutter, a text's anchor): always a
 *         Coincident constraint (the Coincident tool's kind of join: Fusion's Coincident tool never merges).
 */
export const SNAP_JOIN = Object.freeze({ DRAW: 'draw', GLUE: 'glue' });

/**
 * TASK 1045: may the new point `jointId` (a drawing tool's, SNAP_JOIN.DRAW) be SHARED with the existing point `targetId`? Yes when the target is an END
 * POINT of a curve (#core/loop-finder.js curveEnds: a line's ends, an arc's start / end, a bezier's first / last; never a centre, a lone point or the
 * origin) of the ACTIVE sketch, and no shape already uses both points (sharing them would collapse it).
 */
function sharesEndPoint(state, jointId, targetId) {
    if (targetId === ORIGIN_JOINT_ID || !state.joints || !state.joints.has(jointId)) return false;
    const target = state.joints.get(targetId);
    if (!target || !inActiveSketch(state, target)) return false;
    const shapes = state.shapes || [];
    if (shapes.some((s) => Array.isArray(s.joints) && s.joints.includes(jointId) && s.joints.includes(targetId))) return false;
    return shapes.some((s) => (curveEnds(s) || []).includes(targetId));
}

// the joints of the shape a 'line' / 'shape' snap names (its own `shape` object's, else the state's shape of that id)
function snapShapeJoints(state, snapTarget) {
    if (snapTarget.shape && Array.isArray(snapTarget.shape.joints)) return snapTarget.shape.joints;
    const shapeId = (snapTarget.shape && snapTarget.shape.id) ? snapTarget.shape.id : (snapTarget.targetId || snapTarget.id || null);
    const s = shapeId && state && state.shapes ? state.shapes.find((xx) => xx.id === shapeId) : null;
    return (s && s.joints) || [];
}

/**
 * THE existing POINT a snap puts the point `jointId` on, or null: a 'joint' / 'point' snap's joint (not `jointId` itself, not one of
 * options.excludeJoints); a 'line' / 'shape' snap whose point is within SolverConfig.SNAP_WORLD_EPS of one of that shape's joints (the snap was
 * effectively on its end; not when `jointId` is already one of them). applySnapConstraint joins the point there (shared or glued, SNAP_JOIN).
 */
export function pointUnderSnap(state, jointId, snapTarget, options = {}) {
    if (!snapTarget || !jointId) return null;
    if (snapTarget.type === 'joint' || snapTarget.type === 'point') {
        const t = snapTarget.id || snapTarget.targetId || (snapTarget.target && snapTarget.target.id);
        return t && t !== jointId && !(options.excludeJoints || []).includes(t) ? t : null;
    }
    if (snapTarget.type !== 'line' && snapTarget.type !== 'shape') return null;
    if (options.allowPointOnLine === false) return null;
    const lineJoints = snapShapeJoints(state, snapTarget);
    if (lineJoints.includes(jointId)) return null;
    const snapPt = snapTarget.pt || (snapTarget.shape && snapTarget.shape.pt) || null;
    if (!snapPt || !state || !state.joints) return null;
    const EPS = SolverConfig.SNAP_WORLD_EPS || 0.1; // world-space proximity threshold (configurable via SolverConfig)
    for (const lid of lineJoints) {
        const lj = state.joints.get(lid);
        if (lj && Math.hypot(lj.x - snapPt.x, lj.y - snapPt.y) < EPS) return lid;
    }
    return null;
}

/**
 * TASK 1045: the existing curve end point that applySnapConstraint (same arguments) will SHARE the new point `jointId` with, or null (it glues it, binds it
 * otherwise, or nothing). A caller that keeps using the point's id after its snap reads its id here first: a shared point's new joint is gone.
 */
export function sharedEndTarget(state, jointId, snapTarget, options = {}) {
    if (options.join !== SNAP_JOIN.DRAW) return null;
    const t = pointUnderSnap(state, jointId, snapTarget, options);
    return t && sharesEndPoint(state, jointId, t) ? t : null;
}

/**
 * The snap target that says "this point lies on the shape `shapeId`, at `pt`": the one applySnapConstraint's 'shape' case reads. For a caller whose shape
 * is made AFTER the point it holds (a circle's rim passing through an existing point), so the point is the subject and the new shape the target.
 */
export const onShapeSnap = (shapeId, pt) => ({ type: 'shape', isLocked: true, targetId: shapeId, pt });

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
 * @param {string} options.join - SNAP_JOIN.DRAW (a drawing tool's new point: an existing curve end point is SHARED, the new joint merged into it
 *                                and gone) or SNAP_JOIN.GLUE (a Coincident); the caller's intent, see SNAP_JOIN
 * @returns {boolean} True if constraint was created (or the point shared)
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
        // A point the sketch ALREADY holds on the target adds nothing (task 537's rule; TASK 575: the owner's drag added
        // pointOnLine(line end, construction line) beside the collinear that already implies it). The engine's rank test decides:
        // the snap's rows raise no rank over the existing driving constraints = already determined.
        // TASK 762: a point-on-curve the curve's kind cannot hold (a Bezier) skips the probe (the solver has no rows for it): the manager refuses it with the reason.
        if (!ConstraintManager.pointOnCurveRefusal(state, type, params) && state.engine && typeof state.engine.isDistanceRedundant === 'function' && state.engine.isDistanceRedundant({ type, ...params })) {
            dbg.debug('app', '[snap-constraints] snap already held by the sketch: nothing added', { type, params });
            return false;
        }
        const created = ConstraintManager.createConstraint(state, type, params, { source: 'snap' });
        return !!created;
    };
    // a snap ON an existing point: shared (a drawing tool's new point on a curve end point, TASK 1045) or glued by a Coincident
    const joinPoint = (targetId) => {
        if (sharedEndTarget(state, jointId, snapTarget, opts) === targetId) {
            mergeJoints(state, jointId, targetId);
            dbg.debug('app', '[snap-constraints] new point shared with the end point it was placed on', { jointId, targetId });
            return true;
        }
        return addViaManager(CONSTRAINT_TYPES.COINCIDENT, { joints: [jointId, targetId] });
    };

    switch (snapTarget.type) {
        case 'joint':
        case 'point': { // Handle 'point' type if it refers to a joint ID
            // Joint-to-Joint → the joined point (shared, or a COINCIDENT constraint)
            // Support multiple snap target shapes: {id} or {targetId}
            const targetJointId = pointUnderSnap(state, jointId, snapTarget, opts); // not self, not excluded
            if (!targetJointId) { return false; }

            try{
                return joinPoint(targetJointId);
            }catch(e){ return false; }
        }

        case 'line':
        case 'shape': {
            // Joint-to-Line → POINT_ON_LINE constraint (or the joined point if snapping to an endpoint)
            if (!opts.allowPointOnLine) return false;
            // Accept either full shape object or a targetId reference
            const shapeId = (snapTarget.shape && snapTarget.shape.id) ? snapTarget.shape.id : (snapTarget.targetId || snapTarget.id || null);
            if (!shapeId) return false;

            // Don't create point-on-line if joint is already an endpoint of the line
            if (snapShapeJoints(state, snapTarget).includes(jointId)) return false;

            try{
                // If the snap point is very close to an endpoint joint, join the point there
                const endpoint = pointUnderSnap(state, jointId, snapTarget, opts);
                if (endpoint) return joinPoint(endpoint);

                // Otherwise, add a POINT_ON_LINE constraint
                return addViaManager(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: jointId, shape: shapeId });
            }catch(e){ return false; }
        }

        case 'midpoint':
            // Joint-to-Line midpoint -> MIDPOINT constraint on the line's own endpoints
            let anchorJoints = null;
            const midShapeId = (snapTarget.shape && snapTarget.shape.id) ? snapTarget.shape.id : (snapTarget.targetId || snapTarget.id || null);
            if (!midShapeId) return false;
            // an ARC's midpoint (task 875, UX-27): the arc form { joint, shape }, not its first two joints (centre, start)
            if (snapTarget.shape && snapTarget.shape.type === 'arc') {
                if (snapTarget.shape.joints.includes(jointId)) return false;
                try{ return addViaManager(CONSTRAINT_TYPES.MIDPOINT, { joint: jointId, shape: midShapeId }); }catch(e){ return false; }
            }
            if (snapTarget.shape && Array.isArray(snapTarget.shape.joints)) anchorJoints = snapTarget.shape.joints.slice(0,2);
            else if (state && state.shapes) {
                const s = state.shapes.find(xx => xx.id === midShapeId);
                if (s && s.joints) anchorJoints = s.joints.slice(0,2);
            }
            if (!anchorJoints || anchorJoints.length < 2) return false;
            if (anchorJoints.includes(jointId)) return false;
            try{
                return addViaManager(CONSTRAINT_TYPES.MIDPOINT, { joints: [anchorJoints[0], anchorJoints[1], jointId] });
            }catch(e){ return false; }

        case 'axis-x':
        case 'axis-y': {
            // Point on the X / Y axis (task 537, switched by task 539): a POINT-ON-LINE with the built-in reference line (AXIS_SNAP_TARGETS shapeId),
            // not a horizontal / vertical with the origin joint (those stay valid in saved files). The normal ConstraintManager path decides:
            // a refusal leaves the point where it is. The origin is on both axes already.
            if (jointId === ORIGIN_JOINT_ID) return false;
            if (!state.joints || !state.joints.has(ORIGIN_JOINT_ID)) return false;
            return addViaManager(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: jointId, shape: AXIS_SNAP_TARGETS[snapTarget.type].shapeId });
        }

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
            // Preview for midpoint constraint (an arc's: the arc form { joint, shape })
            if (snapTarget.shape && snapTarget.shape.type === 'arc') {
                if (snapTarget.shape.joints.includes(jointId)) return null;
                return { type: CONSTRAINT_TYPES.MIDPOINT, joint: jointId, shape: snapTarget.shape.id, __isPreview: true };
            }
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