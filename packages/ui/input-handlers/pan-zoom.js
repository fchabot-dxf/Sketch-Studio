// ═══════════════════════════════════════════════════════════════════════════════
// PAN-ZOOM TOOLS - Handles viewport navigation (pan and zoom)
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES } from '#core/constants.js';

// Local state for pan-zoom
let panZoomState = {
    isPanning: false,
    lastPanPoint: null,
    lastTouchDistance: null,
    touchPoints: new Map(),
    isPinching: false,
    lastPinchCenter: null,
    lastPinchDistance: null
};

function updateViewBox(svg, view) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    view.h = view.w / (rect.width / rect.height);
    svg.setAttribute('viewBox', `${view.x - view.w / 2} ${view.y - view.h / 2} ${view.w} ${view.h}`);
}

function getTouchMetrics() {
    const pts = Array.from(panZoomState.touchPoints.values());
    if (pts.length < 2) return null;
    const a = pts[0];
    const b = pts[1];
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    return { center, distance };
}

function applyPinch(svg, state, lastCenter, nextCenter, scale) {
    if (!state.view || !lastCenter || !nextCenter || !scale || !isFinite(scale)) return;

    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const rx1 = (lastCenter.x - rect.left) / rect.width;
    const ry1 = (lastCenter.y - rect.top) / rect.height;
    const wx = state.view.x + (rx1 - 0.5) * state.view.w;
    const wy = state.view.y + (ry1 - 0.5) * state.view.h;

    state.view.w *= scale;
    state.view.h = state.view.w / (rect.width / rect.height);

    const rx2 = (nextCenter.x - rect.left) / rect.width;
    const ry2 = (nextCenter.y - rect.top) / rect.height;
    state.view.x = wx - (rx2 - 0.5) * state.view.w;
    state.view.y = wy - (ry2 - 0.5) * state.view.h;

    updateViewBox(svg, state.view);

    try {
        state.lastMouse = { x: nextCenter.x, y: nextCenter.y };
        const ev = new CustomEvent('panzoom:viewportChanged', { detail: { screenX: nextCenter.x, screenY: nextCenter.y } });
        document.dispatchEvent(ev);
    } catch (_) { }
}

/**
 * Setup pan-zoom tools
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} appState - Application state
 */
export function setupPanZoom(svg, appState) {
    dbg.log('pan-zoom', '[pan-zoom] Setting up pan-zoom tools...');
    // Event handlers will be attached by the input manager
}

/**
 * Handle pointer down for pan-zoom
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @returns {boolean} True if event was handled
 */
export function handlePanZoomPointerDown(e, svg, state) {
    if (e.pointerType === 'touch') {
        panZoomState.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (panZoomState.touchPoints.size >= 2) {
            e.preventDefault();
            panZoomState.isPinching = true;
            const metrics = getTouchMetrics();
            if (metrics) {
                panZoomState.lastPinchCenter = metrics.center;
                panZoomState.lastPinchDistance = metrics.distance;
            }
            panZoomState.isPanning = false;
            return true;
        }
        return false;
    }

    // Middle-button panning (button 1)
    if (e.button === 1) {
        console.debug && console.debug('[pan-zoom] MMB down', { x: e.clientX, y: e.clientY });
        e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch(_){ }
        panZoomState.isPanning = true;
        panZoomState.lastPanPoint = { x: e.clientX, y: e.clientY };
        svg.style.cursor = 'grabbing';
        return true;
    }

    // Left-button empty-space panning when in PAN mode and nothing was hit
    // state.snapTarget is expected to be set by the input manager before calling this
    if (e.button === 0 && (state.currentTool === TOOL_MODES.PAN) && !state.snapTarget) {
        e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch(_){}
        panZoomState.isPanning = true;
        panZoomState.lastPanPoint = { x: e.clientX, y: e.clientY };
        svg.style.cursor = 'grabbing';
        return true;
    }

    return false;
    }

/**
 * Handle pointer move for pan-zoom
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @returns {boolean} True if event was handled
 */
export function handlePanZoomPointerMove(e, svg, state) {
    if (e.pointerType === 'touch' && panZoomState.touchPoints.has(e.pointerId)) {
        panZoomState.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (panZoomState.isPinching && panZoomState.touchPoints.size >= 2) {
            e.preventDefault();
            const metrics = getTouchMetrics();
            if (metrics && panZoomState.lastPinchDistance) {
                const scale = panZoomState.lastPinchDistance / metrics.distance;
                applyPinch(svg, state, panZoomState.lastPinchCenter, metrics.center, scale);
                panZoomState.lastPinchCenter = metrics.center;
                panZoomState.lastPinchDistance = metrics.distance;
            }
            return true;
        }
        return false;
    }

    if (!panZoomState.isPanning || !panZoomState.lastPanPoint) {
        return false;
    }
    
    e.preventDefault();
    
    const dx = e.clientX - panZoomState.lastPanPoint.x;
    const dy = e.clientY - panZoomState.lastPanPoint.y;
    
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    
    // Convert screen delta to world delta
    const worldDx = dx * (vb.width / rect.width);
    const worldDy = dy * (vb.height / rect.height);
    
    // Update view
    state.view.x -= worldDx;
    state.view.y -= worldDy;
    
    // Update SVG viewBox
    svg.setAttribute('viewBox', 
        `${state.view.x-state.view.w/2} ${state.view.y-state.view.h/2} ${state.view.w} ${state.view.h}`);
    
    panZoomState.lastPanPoint = { x: e.clientX, y: e.clientY };

    // Keep global lastMouse in sync so tools that depend on it (previews/snap) can refresh
    try {
        state.lastMouse = { x: e.clientX, y: e.clientY };
        // Notify input manager / UI that the viewport changed so active tool previews can update
        const ev = new CustomEvent('panzoom:viewportChanged', { detail: { screenX: e.clientX, screenY: e.clientY } });
        document.dispatchEvent(ev);
    } catch (_) { }

    return true;
}

/**
 * Handle pointer up for pan-zoom
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @returns {boolean} True if event was handled
 */
export function handlePanZoomPointerUp(e, svg, state) {
    if (e.pointerType === 'touch') {
        const wasPinching = panZoomState.isPinching;
        panZoomState.touchPoints.delete(e.pointerId);
        if (panZoomState.touchPoints.size < 2) {
            panZoomState.isPinching = false;
            panZoomState.lastPinchCenter = null;
            panZoomState.lastPinchDistance = null;
        }
        if (wasPinching) return true;
    }

    if (panZoomState.isPanning) {
        panZoomState.isPanning = false;
        panZoomState.lastPanPoint = null;
        svg.style.cursor = '';

        // Release pointer capture
        try {
            svg.releasePointerCapture(e.pointerId);
        } catch (_) { /* Ignore */ }

        // Final update: notify input-manager that viewport changed so previews finalize correctly
        try {
            const ex = e && typeof e.clientX === 'number' ? e.clientX : (state && state.lastMouse ? state.lastMouse.x : null);
            const ey = e && typeof e.clientY === 'number' ? e.clientY : (state && state.lastMouse ? state.lastMouse.y : null);
            if (ex !== null && ey !== null) {
                state.lastMouse = { x: ex, y: ey };
                const ev = new CustomEvent('panzoom:viewportChanged', { detail: { screenX: ex, screenY: ey } });
                document.dispatchEvent(ev);
            }
        } catch(_) { }

        return true;
    }

    return false;
}

/**
 * Reset pan-zoom state
 */
export function resetPanZoomState() {
    panZoomState = {
        isPanning: false,
        lastPanPoint: null,
        lastTouchDistance: null,
        touchPoints: new Map(),
        isPinching: false,
        lastPinchCenter: null,
        lastPinchDistance: null
    };
}