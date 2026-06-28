// Coordinate transforms — screen ↔ world. SHELL-side (north-star #4/#5: convert only at the
// edges). These are DOM-coupled (svg.getBoundingClientRect() + svg.viewBox), so they were
// extracted verbatim from core/geometry.js — which now keeps pure math only. Self-contained;
// no imports needed.

/**
 * Convert screen coordinates to world coordinates
 * @param {SVGElement} svg - SVG element
 * @param {number} screenX - Screen X coordinate
 * @param {number} screenY - Screen Y coordinate
 * @returns {object} World coordinates {x, y}
 */
export function screenToWorld(svg, screenX, screenY) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;

    // Use the actual rendered size of the SVG
    const scaleX = vb.width / rect.width;
    const scaleY = vb.height / rect.height;

    // Some test environments provide rect.x/rect.y instead of rect.left/rect.top
    const left = (typeof rect.left === 'number') ? rect.left : (typeof rect.x === 'number' ? rect.x : 0);
    const top = (typeof rect.top === 'number') ? rect.top : (typeof rect.y === 'number' ? rect.y : 0);

    const localX = screenX - left;
    const localY = screenY - top;

    return {
        x: vb.x + localX * scaleX,
        y: vb.y + localY * scaleY
    };
}

/**
 * Convert world coordinates to screen coordinates
 * @param {SVGElement} svg - SVG element
 * @param {object} pt - World coordinates {x, y}
 * @returns {object} Screen coordinates {x, y}
 */
export function worldToScreen(svg, pt) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    // Defensive defaults — real SVGRect always has x/y, but tests may stub
    // viewBox.baseVal as { width, height }. Without these, (pt.x - undefined)
    // becomes NaN and silently propagates.
    const vbX = (typeof vb.x === 'number') ? vb.x : 0;
    const vbY = (typeof vb.y === 'number') ? vb.y : 0;

    const scaleX = rect.width / vb.width;
    const scaleY = rect.height / vb.height;

    const localX = (pt.x - vbX) * scaleX;
    const localY = (pt.y - vbY) * scaleY;

    const left = (typeof rect.left === 'number') ? rect.left : (typeof rect.x === 'number' ? rect.x : 0);
    const top = (typeof rect.top === 'number') ? rect.top : (typeof rect.y === 'number' ? rect.y : 0);

    return {
        x: left + localX,
        y: top + localY
    };
}

/**
 * Get the zoom factor for screen↔world conversion.
 */
export function getZoomFactor(svg) {
    const vb = svg.viewBox.baseVal;
    return Math.max(vb.width / svg.clientWidth, vb.height / svg.clientHeight);
}
