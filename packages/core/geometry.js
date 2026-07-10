﻿﻿﻿// 
// GEOMETRY - Pure geometry functions for vector math and coordinate transformations
// 

/**
 * Calculate distance between two points
 * @param {object} p1 - First point {x, y}
 * @param {object} p2 - Second point {x, y}
 * @returns {number} Distance
 */
export function getDist(p1, p2) { 
    return Math.hypot((p1.x - p2.x), (p1.y - p2.y)); 
}

/**
 * Project a point onto a line segment (clamped to segment endpoints)
 * @param {object} pt - Point to project {x, y}
 * @param {object} a - Segment start point {x, y}
 * @param {object} b - Segment end point {x, y}
 * @returns {object} Projected point {x, y}
 */
export function projectPointOnSegment(pt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    
    if (L2 === 0) return { x: a.x, y: a.y }; // Segment is a point
    
    let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment
    
    return {
        x: a.x + t * dx,
        y: a.y + t * dy
    };
}

/**
 * Project a point onto an infinite line
 * @param {object} pt - Point to project {x, y}
 * @param {object} a - Line point 1 {x, y}
 * @param {object} b - Line point 2 {x, y}
 * @returns {object} Projected point {x, y}
 */
export function projectPointOnLine(pt, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    
    if (L2 === 0) return { x: a.x, y: a.y }; // Line is a point
    
    const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2;
    
    return {
        x: a.x + t * dx,
        y: a.y + t * dy
    };
}

/**
 * Clamp a value between min and max
 * @param {number} v - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * Calculate the angle between two points (in radians)
 * @param {object} from - Starting point {x, y}
 * @param {object} to - Ending point {x, y}
 * @returns {number} Angle in radians
 */
export function angleBetween(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Calculate the angle between two points (in degrees)
 * @param {object} from - Starting point {x, y}
 * @param {object} to - Ending point {x, y}
 * @returns {number} Angle in degrees
 */
export function angleBetweenDegrees(from, to) {
    return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
}

/**
 * Check if two points are approximately equal (within tolerance)
 * @param {object} p1 - First point {x, y}
 * @param {object} p2 - Second point {x, y}
 * @param {number} tolerance - Maximum allowed distance
 * @returns {boolean} True if points are within tolerance
 */
export function pointsEqual(p1, p2, tolerance = 0.001) {
    return getDist(p1, p2) < tolerance;
}

/**
 * Calculate midpoint between two points
 * @param {object} p1 - First point {x, y}
 * @param {object} p2 - Second point {x, y}
 * @returns {object} Midpoint {x, y}
 */
export function midpoint(p1, p2) {
    return {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
    };
}

/**
 * Calculate perpendicular offset from a line
 * @param {object} pt - Point {x, y}
 * @param {object} lineStart - Line start point {x, y}
 * @param {object} lineEnd - Line end point {x, y}
 * @returns {number} Signed perpendicular distance
 */
export function perpendicularDistance(pt, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const len = Math.hypot(dx, dy);
    
    if (len === 0) return getDist(pt, lineStart);
    
    // Normal vector (perpendicular)
    const nx = -dy / len;
    const ny = dx / len;
    
    // Vector from midpoint to point
    const mx = (lineStart.x + lineEnd.x) / 2;
    const my = (lineStart.y + lineEnd.y) / 2;
    const toPoint = { x: pt.x - mx, y: pt.y - my };
    
    // Project onto normal to get signed offset
    return toPoint.x * nx + toPoint.y * ny;
}

/**
 * Compute a small fanned offset for coincident glyphs so they don't overlap.
 * Returns screen-space offsets (dx, dy) which the renderer will scale into world-space.
 * @param {object} anchorJoint - Anchor joint {x, y} (unused for direction, kept for future use)
 * @param {number} fanIndex - Index of the coincident item (0..N)
 * @returns {object} Offsets {dx, dy} in screen pixels
 */
export function getFannedPosition(anchorJoint, fanIndex){
    // Increase base spacing to keep coincident glyphs clearly offset from joint centers
    const BASE_SPACING = 18; // px (was 6)
    const perRing = 8;
    const ring = Math.floor(fanIndex / perRing);
    const slot = fanIndex % perRing;
    // Slightly larger ring scaling for multi-ring fans
    const radius = BASE_SPACING * (1 + ring * 0.85);
    const angle = slot * (Math.PI * 2 / perRing) + (ring % 2) * (Math.PI / perRing);
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
}

/**
 * Calculate intersection point of two infinite lines defined by (p1, p2) and (p3, p4)
 * @param {object} p1 - Line 1 start
 * @param {object} p2 - Line 1 end
 * @param {object} p3 - Line 2 start
 * @param {object} p4 - Line 2 end
 * @returns {object|null} Intersection point or null if parallel
 */
export function getLineIntersection(p1, p2, p3, p4) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;

    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return null;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    return { x: x1 + ua * (x2 - x1), y: y1 + ua * (y2 - y1) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED UTILITIES — extracted from repeated inline patterns across the codebase
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute the unit perpendicular normal of a segment (a→b), plus its length.
 * Returns { nx, ny, len }. If degenerate (zero-length), returns straight-up normal.
 */
export function perpendicularNormal(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return { nx: len > 0 ? -dy / len : 0, ny: len > 0 ? dx / len : 1, len };
}

/**
 * Safely resolve joint IDs from a Map. Returns the array of joints if ALL exist, or null.
 * @param {Map} joints - Joint map
 * @param {string[]} ids - Array of joint IDs
 * @returns {object[]|null} Array of joint objects, or null if any missing
 */
export function resolveJoints(joints, ids) {
    const resolved = ids.map(id => joints.get(id));
    return resolved.every(Boolean) ? resolved : null;
}

/**
 * Check if a constraint is a valid coincident constraint (has type and 2+ joints).
 */
export function isCoincidentConstraint(c) {
    return c.type === 'coincident' && c.joints && c.joints.length >= 2;
}

/**
 * Generates SVG Path 'd' attribute for Arcs
 * Supports subType: 'CENTER' (center + start + end)
 * Returns an SVG path string (move + arc) or empty string on failure/degenerate case.
 */
export function calculateArcPath(p1, p2, p3, subType, options = {}) {
    // Only CENTER subType supported: p1 = Center, p2 = Start, p3 = End (sweep direction)
    if (subType === 'CENTER') {
        const r = getDist(p1, p2);

        // If explicit flags are provided, use them
        if (typeof options.largeArc === 'boolean' && typeof options.sweep === 'boolean') {
             return `M ${p2.x} ${p2.y} A ${r} ${r} 0 ${options.largeArc ? 1 : 0} ${options.sweep ? 1 : 0} ${p3.x} ${p3.y}`;
        }

        const startAngle = angleBetween(p1, p2);
        const endAngle = angleBetween(p1, p3);

        let diff = endAngle - startAngle;
        // Normalize to -PI...PI to ensure shortest path
        while (diff <= -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        const largeArcFlag = 0; // Always use shortest path for consistent behavior
        const sweepFlag = diff > 0 ? 1 : 0;

        return `M ${p2.x} ${p2.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${p3.x} ${p3.y}`;
    }
    return "";
}

/**
 * UNIFY-3: SVG Path 'd' for a CUBIC BEZIER — start p0, control points c1/c2, end p3 (all {x,y}).
 * Returns "M .. C .. .. ..". Pure; used by the renderer's bezier case + oracle-tested.
 */
export function cubicPathD(p0, c1, c2, p3) {
    if (!p0 || !c1 || !c2 || !p3) return "";
    return `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`;
}

// NEW HELPER: Calculate Center and Radius from 3 points
export function getArcParams(p1, p2, p3) {
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const D = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
    if (Math.abs(D) < 0.00001) return null; // Collinear
    const centerX = ((x1*x1 + y1*y1) * (y2 - y3) + (x2*x2 + y2*y2) * (y3 - y1) + (x3*x3 + y3*y3) * (y1 - y2)) / D;
    const centerY = ((x1*x1 + y1*y1) * (x3 - x2) + (x2*x2 + y2*y2) * (x1 - x3) + (x3*x3 + y3*y3) * (x2 - x1)) / D;
    const radius = Math.hypot(x1 - centerX, y1 - centerY);
    return { center: { x: centerX, y: centerY }, radius };
}
