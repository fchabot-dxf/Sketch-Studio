// ═══════════════════════════════════════════════════════════════════════════════
// PAN-ZOOM TOOLS - Handles viewport navigation (pan and zoom)
// ═══════════════════════════════════════════════════════════════════════════════

import { dbg } from '#core/debug.js';
import { TOOL_MODES, DEFAULT_VIEW } from '#core/constants.js';
import { computeGeometryBounds } from '#core/geometry-bounds.js';
import { computeDimLabelBounds } from '#ui/svg-renderer.js';

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

function getPanZoomState(state) {
    return (state && state._panZoom) || panZoomState;
}

export function updateViewBox(svg, view) {
    if (!svg || !view) return;
    const rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    if (rect && rect.width && rect.height) {
        view.h = view.w / (rect.width / rect.height);
    }
    svg.setAttribute('viewBox', `${view.x - view.w / 2} ${view.y - view.h / 2} ${view.w} ${view.h}`);
}

/**
 * Fits `view` and `svg`'s viewBox to the sketch geometry bounds (`computeGeometryBounds` in `#core/geometry-bounds.js`)
 * with margin padding (default 1.2x, minimum width 10) and container aspect-ratio preservation; falls back to
 * `DEFAULT_VIEW` when the sketch has no geometry.
 */
const DEFAULT_AVOID_GAP = 8;

/**
 * Compute per-edge screen-pixel insets (`{ left, top, right, bottom }`) inside `svg` from an explicit `options.inset`
 * and/or an overlapping floating element `options.avoidEl` (e.g. a floating cut card over top-right).
 * Non-overlapping elements (zero size or lying outside `svg`'s box, such as a side column) contribute 0 inset.
 */
function resolveFitInset(svg, svgRect, options = {}) {
    const raw = options.inset || {};
    let left = Math.max(0, Number(raw.left) || 0);
    let top = Math.max(0, Number(raw.top) || 0);
    let right = Math.max(0, Number(raw.right) || 0);
    let bottom = Math.max(0, Number(raw.bottom) || 0);

    const avoidEl = options.avoidEl;
    if (avoidEl && avoidEl.getBoundingClientRect && svgRect && svgRect.width > 0 && svgRect.height > 0) {
        const ar = avoidEl.getBoundingClientRect();
        if (ar && ar.width > 0 && ar.left < svgRect.right && ar.right > svgRect.left) {
            const gap = Number.isFinite(options.avoidGap) ? Math.max(0, options.avoidGap) : DEFAULT_AVOID_GAP;
            const distToRight = svgRect.right - ar.right;
            const distToLeft = ar.left - svgRect.left;
            if (distToRight <= distToLeft) {
                right = Math.max(right, svgRect.right - ar.left + gap);
            } else {
                left = Math.max(left, ar.right - svgRect.left + gap);
            }
        }
    }

    if (svgRect && svgRect.width > 0) {
        const maxTrimX = svgRect.width * 0.8;
        if (left + right > maxTrimX) {
            const scale = maxTrimX / (left + right);
            left *= scale;
            right *= scale;
        }
    }
    if (svgRect && svgRect.height > 0) {
        const maxTrimY = svgRect.height * 0.8;
        if (top + bottom > maxTrimY) {
            const scale = maxTrimY / (top + bottom);
            top *= scale;
            bottom *= scale;
        }
    }
    return { left, top, right, bottom };
}

export function fitViewToExtents(svg, view, state, options = {}) {
    if (!svg || !view) return;
    const padding = options.padding || 1.2;
    const minWidth = options.minWidth || 10;

    const geoBounds = computeGeometryBounds(state);
    if (!geoBounds) {
        view.x = DEFAULT_VIEW.x;
        view.y = DEFAULT_VIEW.y;
        view.w = DEFAULT_VIEW.w;
        view.h = DEFAULT_VIEW.h;
    } else {
        const rect = (svg.getBoundingClientRect && svg.getBoundingClientRect()) || null;
        const W = rect && rect.width > 0 ? rect.width : 0;
        const H = rect && rect.height > 0 ? rect.height : 0;
        const aspect = (W > 0 && H > 0)
            ? (W / H)
            : (DEFAULT_VIEW.w / DEFAULT_VIEW.h);

        const inset = resolveFitInset(svg, rect, options);
        const hasInset = W > 0 && H > 0 && (inset.left > 0 || inset.top > 0 || inset.right > 0 || inset.bottom > 0);
        const safeW = hasInset ? Math.max(1, W - inset.left - inset.right) : W;
        const safeH = hasInset ? Math.max(1, H - inset.top - inset.bottom) : H;
        const safeAspect = hasInset ? (safeW / safeH) : aspect;

        const frameBounds = (b) => {
            const w = Math.max(1e-3, b.maxX - b.minX);
            const h = Math.max(1e-3, b.maxY - b.minY);
            const requiredSafeW = Math.max(w, h * safeAspect);
            const fittedSafeW = Math.max(minWidth, requiredSafeW * padding);
            const vw = hasInset ? fittedSafeW * (W / safeW) : fittedSafeW;
            return {
                cx: (b.minX + b.maxX) / 2,
                cy: (b.minY + b.maxY) / 2,
                vw,
                zoom: W > 0 ? (vw / W) : 0,
            };
        };

        let framed = frameBounds(geoBounds);
        // Dimension labels (and narrow-dim stubs) scale with zoom (`scale(px) = px * zoom`), so iterate to a fixed point
        // where geometry + every `.dim-label` box fit with the same margin padding.
        if (state && Array.isArray(state.constraints) && state.constraints.length > 0) {
            for (let iter = 0; iter < 6; iter++) {
                const labelBounds = computeDimLabelBounds(state, framed.zoom);
                if (!labelBounds) break;
                const combined = {
                    minX: Math.min(geoBounds.minX, labelBounds.minX),
                    minY: Math.min(geoBounds.minY, labelBounds.minY),
                    maxX: Math.max(geoBounds.maxX, labelBounds.maxX),
                    maxY: Math.max(geoBounds.maxY, labelBounds.maxY),
                };
                const next = frameBounds(combined);
                const converged = Math.abs(next.vw - framed.vw) <= 1e-6 * framed.vw
                    && Math.abs(next.cx - framed.cx) <= 1e-6 * Math.max(1, framed.vw)
                    && Math.abs(next.cy - framed.cy) <= 1e-6 * Math.max(1, framed.vw);
                framed = next;
                if (converged) break;
            }
        }

        view.w = framed.vw;
        view.h = view.w / aspect;
        view.x = framed.cx - ((inset.left - inset.right) / 2) * framed.zoom;
        view.y = framed.cy - ((inset.top - inset.bottom) / 2) * framed.zoom;
    }

    updateViewBox(svg, view);
}

// Smallest world width a fit may zoom in to: a single point or a 1-unit line is framed at 10 units across, never blown up
// further (the same floor `fitViewToExtents` declares as its default `minWidth`).
export const FIT_MIN_WIDTH = 10;
// Empty space left around the drawing on each side, as a fraction of the fitted extent (10%).
export const FIT_MARGIN = 0.1;

const pendingFits = new WeakMap(); // svg -> stop() of its armed "fit once the canvas has a size" observer

/**
 * Frames the visible drawing (geometry extents + visible dimension labels' boxes) centred in `svg` with `margin`
 * (default FIT_MARGIN) on each side, by setting the shared `state.view`. An empty drawing leaves the view alone.
 * Returns true when the view was set now.
 * A canvas with no size yet (hidden tab) is not fitted: the fit is armed and runs at the first real size, unless the user
 * has panned or zoomed `state.view` in the meantime. The next call for the same svg replaces an armed fit.
 */
export function fitToDrawing(svg, state, { margin = FIT_MARGIN, inset, avoidEl, avoidGap } = {}) {
    if (!svg || !state || !state.view) return false;
    const armed = pendingFits.get(svg);
    if (armed) armed();
    if (!computeGeometryBounds(state)) return false;
    const sized = () => { const r = svg.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const fit = () => fitViewToExtents(svg, state.view, state, { padding: 1 + 2 * margin, minWidth: FIT_MIN_WIDTH, inset, avoidEl, avoidGap });
    if (sized()) { fit(); return true; }
    if (typeof ResizeObserver === 'undefined') return false;
    const { x, y, w } = state.view;
    const ro = new ResizeObserver(() => {
        if (!sized()) return;
        stop();
        const v = state.view;
        if (v.x === x && v.y === y && v.w === w) fit(); // untouched since the restore
    });
    const stop = () => { ro.disconnect(); pendingFits.delete(svg); };
    pendingFits.set(svg, stop);
    ro.observe(svg);
    return false;
}

function getTouchMetrics(pz = panZoomState) {
    const pts = Array.from(pz.touchPoints.values());
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

const MIN_W = 1e-3;
const MAX_W = 1e6;
const ZOOM_FACTOR_PER_DELTA = 1.0015;

/**
 * Shared wheel zoom about cursor — maintains stationary world point under cursor,
 * enforces Design's limits [1e-3, 1e6] and exponential zoom response.
 */
export function handlePanZoomWheel(e, svg, state) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (!state || !state.view) return;

    const rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const rectW = (rect && rect.width) || (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || state.view.w || 100;
    const rectH = (rect && rect.height) || (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height) || state.view.h || 100;
    const rectL = (rect && rect.left) || 0;
    const rectT = (rect && rect.top) || 0;

    const rx = (e.clientX - rectL) / rectW;
    const ry = (e.clientY - rectT) / rectH;
    const wx = state.view.x + (rx - 0.5) * state.view.w;
    const wy = state.view.y + (ry - 0.5) * state.view.h;

    const factor = Math.pow(ZOOM_FACTOR_PER_DELTA, e.deltaY);

    let newW = state.view.w * factor;
    newW = Math.max(MIN_W, Math.min(MAX_W, newW));
    const newH = newW * (state.view.h / state.view.w);

    state.view.w = newW;
    state.view.h = newH;

    state.view.x = wx - (rx - 0.5) * state.view.w;
    state.view.y = wy - (ry - 0.5) * state.view.h;

    try {
        updateViewBox(svg, state.view);
        state.lastMouse = { x: e.clientX, y: e.clientY };
        if (typeof document !== 'undefined' && document.dispatchEvent && typeof CustomEvent === 'function') {
            const ev = new CustomEvent('panzoom:viewportChanged', { detail: { screenX: e.clientX, screenY: e.clientY } });
            document.dispatchEvent(ev);
        }
    } catch (_) { }
}

/**
 * Setup pan-zoom tools
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} appState - Application state
 * @param {object} [options] - Optional configuration
 */
export function setupPanZoom(svg, appState, options = {}) {
    dbg.log('pan-zoom', '[pan-zoom] Setting up pan-zoom tools...');
    if (options.attachListeners) {
        const onWheel = (e) => {
            handlePanZoomWheel(e, svg, appState);
        };
        const onDown = (e) => {
            if (options.onPointerDown && options.onPointerDown(e) === true) {
                return;
            }
            handlePanZoomPointerDown(e, svg, appState);
        };
        const onMove = (e) => {
            if (handlePanZoomPointerMove(e, svg, appState)) {
                return;
            }
            if (options.onPointerMove) {
                options.onPointerMove(e);
            }
        };
        const onUp = (e) => {
            handlePanZoomPointerUp(e, svg, appState);
            if (options.onPointerUp) {
                options.onPointerUp(e);
            }
        };
        svg.addEventListener('wheel', onWheel, { passive: false });
        svg.addEventListener('pointerdown', onDown);
        svg.addEventListener('pointermove', onMove);
        svg.addEventListener('pointerup', onUp);
        return {
            destroy() {
                svg.removeEventListener('wheel', onWheel);
                svg.removeEventListener('pointerdown', onDown);
                svg.removeEventListener('pointermove', onMove);
                svg.removeEventListener('pointerup', onUp);
            }
        };
    }
}

/**
 * Handle pointer down for pan-zoom
 * @param {PointerEvent} e - Pointer event
 * @param {SVGElement} svg - SVG canvas element
 * @param {object} state - Application state
 * @returns {boolean} True if event was handled
 */
export function handlePanZoomPointerDown(e, svg, state) {
    const pz = getPanZoomState(state);
    if (e.pointerType === 'touch') {
        pz.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pz.touchPoints.size >= 2) {
            e.preventDefault();
            pz.isPinching = true;
            const metrics = getTouchMetrics(pz);
            if (metrics) {
                pz.lastPinchCenter = metrics.center;
                pz.lastPinchDistance = metrics.distance;
            }
            pz.isPanning = false;
            return true;
        }
        return false;
    }

    // Middle-button panning (button 1)
    if (e.button === 1) {
        console.debug && console.debug('[pan-zoom] MMB down', { x: e.clientX, y: e.clientY });
        e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch(_){ }
        pz.isPanning = true;
        pz.lastPanPoint = { x: e.clientX, y: e.clientY };
        svg.style.cursor = 'grabbing';
        return true;
    }

    // Left-button empty-space panning when in PAN mode and nothing was hit,
    // or when allowEmptyPan is set (canvases without tool pickers, e.g. Prepare/Vcarve)
    if (e.button === 0 && (state.currentTool === TOOL_MODES.PAN || state.allowEmptyPan) && !state.snapTarget) {
        e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch(_){}
        pz.isPanning = true;
        pz.lastPanPoint = { x: e.clientX, y: e.clientY };
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
    const pz = getPanZoomState(state);
    if (e.pointerType === 'touch' && pz.touchPoints.has(e.pointerId)) {
        pz.touchPoints.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pz.isPinching && pz.touchPoints.size >= 2) {
            e.preventDefault();
            const metrics = getTouchMetrics(pz);
            if (metrics && pz.lastPinchDistance) {
                const scale = pz.lastPinchDistance / metrics.distance;
                applyPinch(svg, state, pz.lastPinchCenter, metrics.center, scale);
                pz.lastPinchCenter = metrics.center;
                pz.lastPinchDistance = metrics.distance;
            }
            return true;
        }
        return false;
    }

    if (!pz.isPanning || !pz.lastPanPoint) {
        return false;
    }
    
    e.preventDefault();
    
    const dx = e.clientX - pz.lastPanPoint.x;
    const dy = e.clientY - pz.lastPanPoint.y;
    
    const rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    const vb = svg.viewBox && svg.viewBox.baseVal;
    
    const rectW = (rect && rect.width) || (vb && vb.width) || state.view.w || 100;
    const rectH = (rect && rect.height) || (vb && vb.height) || state.view.h || 100;
    const vbW = (vb && vb.width) || state.view.w;
    const vbH = (vb && vb.height) || state.view.h;

    // Convert screen delta to world delta
    const worldDx = dx * (vbW / rectW);
    const worldDy = dy * (vbH / rectH);
    
    // Update view
    state.view.x -= worldDx;
    state.view.y -= worldDy;
    
    // Update SVG viewBox
    updateViewBox(svg, state.view);
    
    pz.lastPanPoint = { x: e.clientX, y: e.clientY };

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
    const pz = getPanZoomState(state);
    if (e.pointerType === 'touch') {
        const wasPinching = pz.isPinching;
        pz.touchPoints.delete(e.pointerId);
        if (pz.touchPoints.size < 2) {
            pz.isPinching = false;
            pz.lastPinchCenter = null;
            pz.lastPinchDistance = null;
        }
        if (wasPinching) return true;
    }

    if (pz.isPanning) {
        pz.isPanning = false;
        pz.lastPanPoint = null;
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
export function resetPanZoomState(state) {
    const pz = getPanZoomState(state);
    pz.isPanning = false;
    pz.lastPanPoint = null;
    pz.lastTouchDistance = null;
    pz.touchPoints.clear ? pz.touchPoints.clear() : (pz.touchPoints = new Map());
    pz.isPinching = false;
    pz.lastPinchCenter = null;
    pz.lastPinchDistance = null;
}
