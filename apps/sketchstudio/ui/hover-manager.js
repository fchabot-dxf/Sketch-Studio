// ═══════════════════════════════════════════════════════════════════════════════
// HOVER MANAGER - Single source of truth for hover state
// ═══════════════════════════════════════════════════════════════════════════════
import { findSnap } from '#ui/snap-detection.js';
import { worldToScreen } from '#ui/coords.js';

// CRITICAL: This is the ONLY file that modifies hoveredJoint/hoveredShape/hoveredConstraint
// All other files must call functions from this module instead of touching state directly

const SELECT_THRESHOLD = 40; // pixels - increased for better UX

// Helper: compute screen-space distance (pixels) between mouse and a world point
export const getScreenDist = (svg, mx, my, worldPt) => {
    if (!worldPt) return Infinity;
    const s = worldToScreen(svg, worldPt);
    if (!s || typeof s.x !== 'number' || typeof s.y !== 'number') return Infinity;
    return Math.hypot(mx - s.x, my - s.y);
};

// Helper: find the closest constraint glyph (by glyphPos) to screen point
export const findClosestConstraintGlyph = (svg, mx, my, constraints = [], requireVisible = true) => {
    let best = { constraint: null, dist: Infinity, pt: null };
    
    for (const c of constraints) {
        if (requireVisible && !c) continue;
        if (requireVisible && !c.__isPreview && c.__visible === false) continue;
        if (!c || !c.glyphPos) continue;
        
        if (Array.isArray(c.glyphPos)) {
            for (const gp of c.glyphPos) {
                const d = getScreenDist(svg, mx, my, gp);
                if (d < best.dist) {
                    best = { constraint: c, dist: d, pt: gp };
                }
            }
        } else {
            const d = getScreenDist(svg, mx, my, c.glyphPos);
            if (d < best.dist) {
                best = { constraint: c, dist: d, pt: c.glyphPos };
            }
        }
    }
    
    return best;
};

/**
 * Apply hover priority logic and set state.hovered* appropriately
 * Priority: joint > constraint > shape (within threshold)
 */
function applyHoverPriority(state, svg, hitJoint, hitShape, hitConstraint, px, py) {
    // Calculate distances
    const dJoint = hitJoint ? getScreenDist(svg, px, py, hitJoint.j) : Infinity;
    
    const constraintsList = state.constraints || [];
    const best = findClosestConstraintGlyph(svg, px, py, constraintsList);
    const dConstraint = best.constraint ? best.dist : Infinity;
    
    // Find closest within threshold
    let winner = null;
    let minDist = SELECT_THRESHOLD;
    
    if (dJoint <= minDist) {
        winner = 'joint';
        minDist = dJoint;
    }
    
    if (dConstraint <= minDist) {
        winner = 'constraint';
        minDist = dConstraint;
    }
    
    // Shape fallback: If no joint/constraint within threshold AND we have a hitShape
    if (!winner && hitShape) {
        winner = 'shape';
    }
    
    // Set hover state
    if (winner === 'joint') {
        state.hoveredJoint = hitJoint.id;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    } else if (winner === 'constraint') {
        state.hoveredJoint = null;
        state.hoveredConstraint = best.constraint;
        state.hoveredShape = null;
    } else if (winner === 'shape') {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = hitShape.shape.id;
    } else {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    }
}

export function setHoverFromSnap(state) {
    if (!state.snapTarget) {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
        return;
    }
    
    if (state.snapTarget.type === 'joint') {
        state.hoveredJoint = state.snapTarget.targetId;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    } else if (state.snapTarget.type === 'line' || state.snapTarget.type === 'shape') {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = state.snapTarget.shape?.id || null;
    } else {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    }
}

export function updateHover(svg, screenX, screenY, state) {
    // Find potential targets via snap system
    const hoverSnapResult = findSnap(state.joints, state.shapes, svg, {x: screenX, y: screenY}, [], false, false, 1.0);
    
    // Extract hits
    let hitJoint = null;
    let hitShape = null;
    
    if (hoverSnapResult) {
        if (hoverSnapResult.type === 'joint') {
            const jid = hoverSnapResult.targetId;
            hitJoint = { id: jid, j: state.joints.get(jid) };
        } else if (hoverSnapResult.type === 'line' || hoverSnapResult.type === 'shape') {
            hitShape = { shape: hoverSnapResult.shape, pt: hoverSnapResult.pt || { x: hoverSnapResult.x, y: hoverSnapResult.y } };
        }
    }
    
    // Compute constraint hit
    let hitConstraint = null;
    try { 
        const constraintsList = state.constraints || [];
        const best = findClosestConstraintGlyph(svg, screenX, screenY, constraintsList);
        if (best.constraint && best.dist < SELECT_THRESHOLD) {
            hitConstraint = best.constraint;
        }
    } catch(_) { }
    
    // Apply priority logic
    applyHoverPriority(state, svg, hitJoint, hitShape, hitConstraint, screenX, screenY);
}

/**
 * Clear all hover state
 * Called by tools that take exclusive control (like drawing tools)
 */
export function clearHover(state) {
    state.hoveredJoint = null;
    state.hoveredConstraint = null;
    state.hoveredShape = null;
}