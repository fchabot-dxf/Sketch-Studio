// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRAINTS - Constraint creation, validation, and management
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from './debug.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { ConstraintManager } from './constraint-manager.js';
import { SolverConfig } from './solver-config.js';

/**
 * Given a constraint and the list of shapes, returns the joints and shapes affected by the constraint.
 * @param {object} constraint - The constraint object
 * @param {Array} shapes - The array of shape objects
 * @returns {{joints: Set<string>, shapes: Set<string>}}
 */
export function getConstrainedGeometry(constraint, shapes) {
    const constraintJoints = new Set();
    const constraintShapes = new Set();
    
    if (!constraint) return { joints: constraintJoints, shapes: constraintShapes };
    
    // Debug: log constraint type and ids
    if (typeof window !== 'undefined' && window.console) {
        dbg.log('constraints', '[getConstrainedGeometry] type:', constraint.type, 'joints:', constraint.joints, 'shapes:', constraint.shapes, 'constraint:', constraint);
    }
    
    switch (constraint.type) {
        case CONSTRAINT_TYPES.COINCIDENT:
        case CONSTRAINT_TYPES.HORIZONTAL:
        case CONSTRAINT_TYPES.VERTICAL:
            if (constraint.joints) {
                for (const jid of constraint.joints) constraintJoints.add(jid);
                for (const s of shapes) {
                    if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
                        constraintShapes.add(s.id);
                    }
                }
            }
            break;
            
        case CONSTRAINT_TYPES.PARALLEL:
        case CONSTRAINT_TYPES.PERPENDICULAR:
            if (constraint.shapes) {
                for (const sid of constraint.shapes) constraintShapes.add(sid);
            }
            break;
            
        case CONSTRAINT_TYPES.COLLINEAR:
            if (constraint.shapes) for (const sid of constraint.shapes) constraintShapes.add(sid);
            if (constraint.joints) {
                for (const jid of constraint.joints) constraintJoints.add(jid);
                for (const s of shapes) {
                    if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
                        constraintShapes.add(s.id);
                    }
                }
            }
            break;
            
        case CONSTRAINT_TYPES.TANGENT:
            if (constraint.line) constraintShapes.add(constraint.line);
            if (constraint.circle) constraintShapes.add(constraint.circle);
            if (constraint.shapes) for (const sid of constraint.shapes) constraintShapes.add(sid);
            break;
            
        case CONSTRAINT_TYPES.POINT_ON_LINE:
            if (constraint.joint) constraintJoints.add(constraint.joint);
            if (constraint.shape) constraintShapes.add(constraint.shape);
            break;
            
        case CONSTRAINT_TYPES.DISTANCE:
                if (constraint.joints) {
                    for (const jid of constraint.joints) constraintJoints.add(jid);
                    for (const s of shapes) {
                        if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) {
                            constraintShapes.add(s.id);
                        }
                    }
                }
                // Radius-style distance constraints may reference a shape
                if (constraint.shape) {
                    constraintShapes.add(constraint.shape);
                }
                // Line-Line distance
                if (constraint.shapes) {
                    for (const sid of constraint.shapes) constraintShapes.add(sid);
                }
            break;

        case CONSTRAINT_TYPES.MIDPOINT:
            if (constraint.joints) {
                for (const jid of constraint.joints) constraintJoints.add(jid);
                for (const s of shapes) {
                    if (s.joints && s.joints.some(jid => constraintJoints.has(jid))) constraintShapes.add(s.id);
                }
            }
            break;

        case CONSTRAINT_TYPES.EQUAL:
        case CONSTRAINT_TYPES.ANGLE:
            if (constraint.shapes) {
                for (const sid of constraint.shapes) constraintShapes.add(sid);
            }
            break;
    }
    
    return { joints: constraintJoints, shapes: constraintShapes };
}

/**
 * Create a constraint object with validation
 * @param {string} type - Constraint type
 * @param {object} params - Constraint parameters
 * @returns {object|null} Constraint object or null if invalid
 */
export function createConstraint(type, params) {
    switch (type) {
        case CONSTRAINT_TYPES.COINCIDENT:
            {
                if (!params.joints) return null;
                // Coerce joint references to primitive ids when possible
                let ids = [];
                try{
                    ids = Array.isArray(params.joints) ? params.joints.map(j => (j && j.id) ? j.id : j) : Array.from(params.joints);
                }catch(_){ ids = params.joints; }
                // Filter out falsy entries
                ids = ids.filter(Boolean);
                if (ids.length < 2) {
                    dbg.warn('app', '[createConstraint] coincident rejected - insufficient joint ids', ids);
                    return null;
                }
                if (ids[0] === ids[1]) {
                    dbg.warn('app', '[createConstraint] coincident rejected - identical joint ids', ids);
                    return null;
                }
                return { type: CONSTRAINT_TYPES.COINCIDENT, joints: ids };
            }
            
        case CONSTRAINT_TYPES.POINT_ON_LINE:
            if (!params.joint || !params.shape) return null;
            return { type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: params.joint, shape: params.shape };
            
        case CONSTRAINT_TYPES.HORIZONTAL:
        case CONSTRAINT_TYPES.VERTICAL:
            if (!params.joints || params.joints.length < 2) return null;
            return { type, joints: params.joints.slice() };
            
        case CONSTRAINT_TYPES.PARALLEL:
        case CONSTRAINT_TYPES.PERPENDICULAR: {
            if (!params.shapes || params.shapes.length < 2) return null;
            const out = { type, shapes: params.shapes };
            // Branch lock: preserve handedness sign (+1 or -1) for perpendicular.
            if (type === CONSTRAINT_TYPES.PERPENDICULAR && (params.branch === 1 || params.branch === -1)) {
                out.branch = params.branch;
            }
            return out;
        }
            
        case CONSTRAINT_TYPES.COLLINEAR:
            if (params.shapes && params.shapes.length >= 2) {
                return { type: CONSTRAINT_TYPES.COLLINEAR, shapes: params.shapes.slice() };
            }
            if (!params.joints) return null;
            // Deduplicate joints to prevent solver singularities (zero-length segments)
            const uniqueJoints = [...new Set(params.joints)];
            if (uniqueJoints.length < 3) return null;
            return { type: CONSTRAINT_TYPES.COLLINEAR, joints: uniqueJoints };
            
        case CONSTRAINT_TYPES.TANGENT: {
            // Support multiple parameterizations:
            // - { line: '<id>', circle: '<id>' }
            // - { shapes: ['id1','id2'] } where each shape is a circle or arc or one is a line and the other is a circle/arc
            // Branch lock: preserve 'external' (default) vs 'internal' for circle-circle tangent.
            if (params.line && params.circle) {
                const out = { type: CONSTRAINT_TYPES.TANGENT, line: params.line, circle: params.circle };
                if (params.branch === 'external' || params.branch === 'internal') out.branch = params.branch;
                return out;
            }
            if (params.shapes && params.shapes.length === 2) {
                const out = { type: CONSTRAINT_TYPES.TANGENT, shapes: params.shapes.slice() };
                if (params.branch === 'external' || params.branch === 'internal') out.branch = params.branch;
                return out;
            }
            return null;
        }
            
        case CONSTRAINT_TYPES.DISTANCE:
            // Support both legacy joint-to-joint distance and radius-style distance (shape-based)
            // Preserve 'isDriven' and optional visual placement fields so import/export round-trips keep
            // reference dimensions and label placement intact.
            if (params.isRadius) {
                if (!params.shape) return null;
                const radiusObj = {
                    type: CONSTRAINT_TYPES.DISTANCE,
                    shape: params.shape,
                    value: params.value,
                    offset: params.offset || SolverConfig.DIMENSION_OFFSET || 30,
                    isRadius: true,
                    isDriven: !!(params.isDriven || params.driven)
                };
                if (params.__pos) radiusObj.__pos = params.__pos;
                if (params.glyphPos) radiusObj.glyphPos = params.glyphPos;
                return radiusObj;
            }
            // Line-Line Distance (Parallel)
            if (params.shapes && params.shapes.length === 2) {
                return {
                    type: CONSTRAINT_TYPES.DISTANCE,
                    shapes: params.shapes.slice(),
                    value: params.value,
                    offset: params.offset || SolverConfig.DIMENSION_OFFSET || 30,
                    glyphPos: params.glyphPos
                };
            }
            if (!params.joints || params.joints.length < 2) return null;
            const distObj = {
                type: CONSTRAINT_TYPES.DISTANCE,
                joints: params.joints,
                value: params.value,
                offset: params.offset || SolverConfig.DIMENSION_OFFSET || 30,
                isRadius: params.isRadius || false,
                isDriven: !!(params.isDriven || params.driven),
                dimMode: params.dimMode
            };
            if (params.__pos) distObj.__pos = params.__pos;
            if (params.glyphPos) distObj.glyphPos = params.glyphPos;
            return distObj;
        case CONSTRAINT_TYPES.EQUAL:
            // Equality operates on two shapes (lines or circles)
            if (!params.shapes || params.shapes.length < 2) return null;
            return { type: CONSTRAINT_TYPES.EQUAL, shapes: params.shapes.slice() };

        case CONSTRAINT_TYPES.ANGLE:
            if (!params.shapes || params.shapes.length !== 2) return null;
            return { 
                type: CONSTRAINT_TYPES.ANGLE, 
                shapes: params.shapes.slice(), 
                value: params.value,
                offset: params.offset || SolverConfig.ANGLE_OFFSET || 40,
                glyphPos: params.glyphPos
            };
            
        case CONSTRAINT_TYPES.MIDPOINT:
            if (!params.joints || params.joints.length !== 3) return null;
            return { type: CONSTRAINT_TYPES.MIDPOINT, joints: params.joints.slice() };

        default:
            dbg.warn('app', 'Unknown constraint type:', type);
            return null;
    }
}

/**
 * Check if a constraint already exists (duplicate detection)
 * @param {array} constraints - Existing constraints array
 * @param {string} type - Constraint type to check
 * @param {object} params - Constraint parameters
 * @returns {boolean} True if duplicate exists
 */
export function hasConstraint(constraints, type, params) {
    for (const c of constraints) {
        if (c.type !== type) continue;
        
        switch (type) {
            case CONSTRAINT_TYPES.COINCIDENT:
                // Check both orderings
                if (c.joints && params.joints) {
                    const [a, b] = c.joints;
                    const [x, y] = params.joints;
                    if ((a === x && b === y) || (a === y && b === x)) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (coincident):', c);
                        return true;
                    }
                }
                break;
                
            case CONSTRAINT_TYPES.POINT_ON_LINE:
                if (c.joint === params.joint && c.shape === params.shape) return true;
                break;
                
            case CONSTRAINT_TYPES.HORIZONTAL:
            case CONSTRAINT_TYPES.VERTICAL:
                // Same joints in any order
                if (c.joints && params.joints) {
                    const cSet = new Set(c.joints);
                    if (params.joints.every(j => cSet.has(j)) && params.joints.length === c.joints.length) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (H/V):', c);
                        return true;
                    }
                }
                break;
                
            case CONSTRAINT_TYPES.PARALLEL:
            case CONSTRAINT_TYPES.PERPENDICULAR:
                if (c.shapes && params.shapes) {
                    const [a, b] = c.shapes;
                    const [x, y] = params.shapes;
                    if ((a === x && b === y) || (a === y && b === x)) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (parallel/perp):', c);
                        return true;
                    }
                }
                break;
                
            case CONSTRAINT_TYPES.COLLINEAR:
                if (c.shapes && params.shapes) {
                    const [a, b] = c.shapes; const [x, y] = params.shapes;
                    if ((a === x && b === y) || (a === y && b === x)) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (collinear shapes):', c);
                        return true;
                    }
                }
                // Fallthrough to check joints if mixed (legacy)
                break;

            case CONSTRAINT_TYPES.TANGENT:
                // Line+Circle form
                if (c.line && c.circle && params.line && params.circle) {
                    if (c.line === params.line && c.circle === params.circle) return true;
                }
                // Shapes form
                if (c.shapes && params.shapes) {
                    const [a, b] = c.shapes; const [x, y] = params.shapes;
                    if ((a === x && b === y) || (a === y && b === x)) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (tangent):', c);
                        return true;
                    }
                }
                break;
            case CONSTRAINT_TYPES.DISTANCE:
                if (params.isRadius && c.isRadius) {
                    if (c.shape && params.shape && c.shape === params.shape) return true;
                } else if (c.shapes && params.shapes) {
                    // Line-Line distance check
                    const [a, b] = c.shapes; const [x, y] = params.shapes;
                    if ((a === x && b === y) || (a === y && b === x)) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (distance shapes):', c);
                        return true;
                    }
                } else if (c.joints && params.joints) {
                    // legacy joint-based distance duplicate check
                    const cSet = new Set(c.joints);
                    if (params.joints.every(j => cSet.has(j)) && params.joints.length === c.joints.length) {
                        // Check dimMode to allow multiple dimensions (Aligned/Horizontal/Vertical) on same joints
                        const m1 = c.dimMode || 'aligned';
                        const m2 = params.dimMode || 'aligned';
                        if (m1 !== m2) return false;

                        dbg.log('constraints', '[hasConstraint] Duplicate found (distance joints):', c);
                        return true;
                    }
                }
                break;
            case CONSTRAINT_TYPES.EQUAL:
            case CONSTRAINT_TYPES.ANGLE:
                if (c.shapes && params.shapes) {
                    const [a,b] = c.shapes; const [x,y] = params.shapes;
                    if ((a===x && b===y) || (a===y && b===x)) {
                        dbg.log('constraints', '[hasConstraint] Duplicate found (angle/equal):', c, 'vs params:', params);
                        return true;
                    }
                }
                break;
            
            case CONSTRAINT_TYPES.MIDPOINT:
                if (c.joints && params.joints && c.joints.length === 3 && params.joints.length === 3) {
                    // joints[2] is the midpoint joint — must match exactly
                    if (c.joints[2] !== params.joints[2]) break;
                    // Endpoints (joints[0], joints[1]) can be in either order
                    const cEnds = new Set([c.joints[0], c.joints[1]]);
                    if (cEnds.has(params.joints[0]) && cEnds.has(params.joints[1])) {
                        return true;
                    }
                }
                break;
        }
    }
    
    return false;
}

/**
 * Add a constraint to the state if it doesn't already exist
 * @param {object} state - App state with constraints array
 * @param {string} type - Constraint type
 * @param {object} params - Constraint parameters
 * @returns {boolean} True if constraint was added
 */
export function addConstraint(state, type, params) {
    // Ignore preview constraints (synthetic previews should never be persisted)
    if (params && params.__isPreview) {
        dbg.log('constraints', '[addConstraint] Ignoring preview constraint:', type, params);
        return false;
    }
    
    // Check for duplicates
    if (hasConstraint(state.constraints, type, params)) {
        dbg.log('constraints', '[addConstraint] Duplicate constraint rejected:', type, params);
        return false;
    }
    
    // Normalize params for robustness (accept Sets or joint objects)
    const normalized = Object.assign({}, params || {});
    try{
        if (normalized.joints && !Array.isArray(normalized.joints)) {
            if (normalized.joints instanceof Set) normalized.joints = Array.from(normalized.joints);
            else if (normalized.joints instanceof Map) normalized.joints = Array.from(normalized.joints.keys());
            else normalized.joints = Array.from(normalized.joints);
        }
        if (Array.isArray(normalized.joints) && normalized.joints.length > 0 && typeof normalized.joints[0] === 'object') {
            // Support joint objects {id: 'j1'} => convert to ids
            normalized.joints = normalized.joints.map(j => (j && j.id) ? j.id : j);
        }
    }catch(_){ }

    // Create validated constraint
    const constraint = createConstraint(type, normalized);
    if (!constraint) {
        // Provide extra diagnostic information to make debugging easier
        try{
            dbg.warn('constraints', '[addConstraint] Invalid constraint:', type, params, 'normalized:', normalized);
        }catch(_){
            dbg.warn('constraints', '[addConstraint] Invalid constraint:', type);
        }
        return false;
    }
    
    dbg.log('constraints', '[addConstraint] Adding constraint:', constraint);
    state.constraints.push(constraint);
    return true;
}

/**
 * Safely add a ready-made constraint object into the state.
 * This validates, performs duplicate-checking and delegates to `addConstraint`.
 * @param {object} state
 * @param {object} constraintObj
 * @returns {boolean} True if added
 */
export function addConstraintObject(state, constraintObj) {
    if (!constraintObj || typeof constraintObj !== 'object') return false;
    if (constraintObj.__isPreview) {
        dbg.log('constraints', '[addConstraintObject] Ignoring preview constraint object', constraintObj);
        return false;
    }
    
    if (!constraintObj.type) {
        dbg.warn('constraints', '[addConstraintObject] Missing type on constraint object', constraintObj);
        return false;
    }
    
    // Expand multi-joint coincident into pairwise constraints so solver and UI treat them consistently
    if (constraintObj.type === CONSTRAINT_TYPES.COINCIDENT && Array.isArray(constraintObj.joints)) {
        const ids = constraintObj.joints.map(j => (j && j.id) ? j.id : j).filter(Boolean);
        if (ids.length > 2) {
            const anchor = ids[0];
            let added = false;
            for (let i = 1; i < ids.length; i++) {
                const ok = addConstraint(state, constraintObj.type, { ...constraintObj, joints: [anchor, ids[i]] });
                added = added || ok;
            }
            return added;
        }
    }

    // Use the canonical addConstraint path to validate, dedupe and push
    return addConstraint(state, constraintObj.type, constraintObj);
}

// Convenience helpers for common constraints operating on shapes or joints
export function addHorizontal(state, shapeOrJoints) {
    // DEPRECATION: Use ConstraintManager.addHorizontal or ConstraintManager.addHorizontalOrVertical instead
    try{ dbg.warn('constraints', '[DEPRECATION] addHorizontal() is deprecated; use ConstraintManager.addHorizontal(state, joints, { source, autoSolve })'); }catch(_){ }
    try{
        // If a shape id is provided, look up its joints
        if (typeof shapeOrJoints === 'string') {
            const s = state.shapes.find(xx => xx.id === shapeOrJoints);
            if (!s || !s.joints || s.joints.length < 2) return false;
            return ConstraintManager.addHorizontal(state, [s.joints[0], s.joints[1]]);
        }
        // Otherwise assume array of joint ids
        if (Array.isArray(shapeOrJoints)) return ConstraintManager.addHorizontal(state, shapeOrJoints);
    }catch(_){ }
    return false;
}

export function addVertical(state, shapeOrJoints) {
    // DEPRECATION: Use ConstraintManager.addVertical instead
    try{ dbg.warn('constraints', '[DEPRECATION] addVertical() is deprecated; use ConstraintManager.addVertical(state, joints, { source, autoSolve })'); }catch(_){ }
    try{
        if (typeof shapeOrJoints === 'string') {
            const s = state.shapes.find(xx => xx.id === shapeOrJoints);
            if (!s || !s.joints || s.joints.length < 2) return false;
            return ConstraintManager.addVertical(state, [s.joints[0], s.joints[1]]);
        }
        if (Array.isArray(shapeOrJoints)) return ConstraintManager.addVertical(state, shapeOrJoints);
    }catch(_){ }
    return false;
}

export function addPerpendicular(state, shapeA, shapeB) {
    // DEPRECATION: Use ConstraintManager.addPerpendicular instead
    try{ dbg.warn('constraints', '[DEPRECATION] addPerpendicular() is deprecated; use ConstraintManager.addPerpendicular(state, shapeA, shapeB, { source, autoSolve })'); }catch(_){ }
    try{
        // Accept either shape ids or shape objects
        const aId = typeof shapeA === 'string' ? shapeA : (shapeA && shapeA.id);
        const bId = typeof shapeB === 'string' ? shapeB : (shapeB && shapeB.id);
        if (!aId || !bId) return false;
        return ConstraintManager.addPerpendicular(state, aId, bId);
    }catch(_){ }
    return false;
}