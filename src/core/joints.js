import { dbg } from './debug.js';
// ═══════════════════════════════════════════════════════════════════════════════
// JOINTS - Joint management and operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Remove joints that are not referenced by any shape or constraint in the state.
 * This helps keep the joint set clean after undo/restore or manual edits.
 * @param {object} state - Application state
 */
export function removeOrphanJoints(state) {
    if (!state || !state.joints) return;
    
    const referenced = new Set();
    
    // Collect joints from shapes
    for (const s of state.shapes) {
        if (s && s.joints) {
            s.joints.forEach(j => referenced.add(j));
        }
    }
    
    // Collect joints from constraints
    for (const c of state.constraints) {
        if (!c) continue;
        
        if (c.joints && Array.isArray(c.joints)) {
            c.joints.forEach(j => referenced.add(j));
        }
        
        if (c.joint) {
            referenced.add(c.joint);
        }
    }
    
    // Remove any joint not referenced
    for (const [id, joint] of Array.from(state.joints.entries())) {
        // Protect origin and explicitly allowed orphans (e.g. center points)
        if (id === 'j_origin' || joint.orphanAllowed) continue;

        if (!referenced.has(id)) {
            state.joints.delete(id);
            dbg.log('joints', '[cleanup] removed orphan joint', id);
        }
    }
}

/**
 * Find an existing joint close to the given point
 * @param {Map} jointsMap - Map of joints
 * @param {object} pt - Point to check {x, y}
 * @param {string} excludeId - Joint ID to exclude from search
 * @param {number} eps - Tolerance distance
 * @returns {string|null} Joint ID or null if not found
 */
export function findNearbyJoint(jointsMap, pt, excludeId, eps = 0.01) {
    if (!pt) return null;
    
    for (const [id, j] of jointsMap.entries()) {
        if (id === excludeId) continue;
        
        const dx = j.x - pt.x;
        const dy = j.y - pt.y;
        
        if (Math.hypot(dx, dy) < eps) {
            return id;
        }
    }
    
    return null;
}

/**
 * Create a new joint at the specified position
 * @param {Map} jointsMap - Map to add joint to
 * @param {Function} genJ - Function to generate joint ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {boolean} fixed - Whether joint is fixed
 * @returns {string} New joint ID
 */
export function createJoint(jointsMap, genJ, x, y, fixed = false) {
    const id = genJ();
    jointsMap.set(id, { x, y, fixed });
    return id;
}

/**
 * Get all joints that are coincident with the given joint (through constraints)
 * @param {string} jointId - Starting joint ID
 * @param {Array} constraints - Array of constraints
 * @returns {Set<string>} Set of all coincident joint IDs
 */
export function getCoincidentJoints(jointId, constraints) {
    const cluster = new Set([jointId]);
    let changed = true;
    
    while (changed) {
        changed = false;
        
        for (const c of constraints) {
            if (c.type === 'coincident' && c.joints) {
                const [j1, j2] = c.joints;
                
                if (cluster.has(j1) && !cluster.has(j2)) {
                    cluster.add(j2);
                    changed = true;
                }
                
                if (cluster.has(j2) && !cluster.has(j1)) {
                    cluster.add(j1);
                    changed = true;
                }
            }
        }
    }
    
    return cluster;
}

/**
 * Merge two joints (move all references from source to target)
 * @param {object} state - Application state
 * @param {string} sourceId - Source joint ID (will be removed)
 * @param {string} targetId - Target joint ID (will receive all references)
 */
export function mergeJoints(state, sourceId, targetId) {
    if (!state || !state.joints || sourceId === targetId) return;
    
    const sourceJoint = state.joints.get(sourceId);
    const targetJoint = state.joints.get(targetId);
    
    if (!sourceJoint || !targetJoint) return;
    
    // Update shapes to use target joint instead of source
    for (const shape of state.shapes) {
        if (shape.joints) {
            for (let i = 0; i < shape.joints.length; i++) {
                if (shape.joints[i] === sourceId) {
                    shape.joints[i] = targetId;
                }
            }
        }
    }
    
    // Update constraints to use target joint instead of source
    for (const constraint of state.constraints) {
        if (constraint.joints) {
            for (let i = 0; i < constraint.joints.length; i++) {
                if (constraint.joints[i] === sourceId) {
                    constraint.joints[i] = targetId;
                }
            }
        }
        
        if (constraint.joint === sourceId) {
            constraint.joint = targetId;
        }
    }
    
    // Remove source joint
    state.joints.delete(sourceId);
    
    dbg.log('joints', `[joints] Merged joint ${sourceId} into ${targetId}`);
}

// -----------------------------------------------------------------------------
// True-vertex / primitive-aware helpers (cached for runtime efficiency)
// -----------------------------------------------------------------------------
const _trueVertexCache = new WeakMap();

/**
 * Compute a set of joint IDs that are the "true" defining vertices of shapes.
 * For lines: both end joints; for circles: center joint; for arcs: start & end.
 * Uses a WeakMap cache keyed by the shapes array reference to avoid recomputing
 * inner results repeatedly during the renderer/solver loop.
 * @param {Array} shapes - state.shapes array
 * @returns {Set<string>} set of joint ids that are true vertices
 */
export function computeTrueVertexSet(shapes) {
    if (!Array.isArray(shapes)) return new Set();
    if (_trueVertexCache.has(shapes)) return _trueVertexCache.get(shapes);

    const s = new Set();
    for (const shape of shapes) {
        if (!shape || !Array.isArray(shape.joints)) continue;
        if (shape.type === 'line') {
            if (shape.joints[0]) s.add(shape.joints[0]);
            if (shape.joints[1]) s.add(shape.joints[1]);
        } else if (shape.type === 'circle') {
            if (shape.joints[0]) s.add(shape.joints[0]);
        } else if (shape.type === 'arc') {
            if (shape.joints[0]) s.add(shape.joints[0]);
            if (shape.joints[2]) s.add(shape.joints[2]);
        } else {
            // Fallback: treat first/last joint of multi-joint shapes as vertices
            if (shape.joints.length >= 2) {
                s.add(shape.joints[0]);
                s.add(shape.joints[shape.joints.length - 1]);
            }
        }
    }

    _trueVertexCache.set(shapes, s);
    return s;
}

/**
 * Convenience check: returns true when the given joint id is a defining vertex
 * according to the current set of shapes.
 * @param {Array} shapes
 * @param {string} jointId
 * @returns {boolean}
 */
export function isTrueVertex(shapes, jointId) {
    if (!jointId) return false;
    const set = computeTrueVertexSet(shapes || []);
    return set.has(jointId);
}