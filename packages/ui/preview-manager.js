// Unified Preview Manager
// Centralizes preview state and keeps backwards-compatible active.preview
//
// CONTRACT (TASK 470): a preview is a transient SNAPSHOT of values the tool just computed, so it carries RESOLVED POINTS
// ({x,y}), never joint ids the renderer would have to look up a frame later (the joint may be gone by then: tool reset,
// undo). The PRODUCER owns the resolution (it has the joints in hand); this module enforces the shape. An arc preview whose
// centre / radius / angles / cursor are not finite is not a preview at all: it is cleared, never half-drawn.

const isPoint = (q) => !!q && Number.isFinite(q.x) && Number.isFinite(q.y);

/** The one declared shape of an arc preview (centre-start-end): everything the renderer reads must be finite. */
export function isValidArcPreview(properties, cursorPoint) {
    const p = properties || {};
    return isPoint(p.center) && Number.isFinite(p.radius) && Number.isFinite(p.startAngle) && Number.isFinite(p.endAngle) && isPoint(cursorPoint);
}

export function updatePreview(state, toolType, fixedPoints, cursorPoint, properties = {}) {
    if (toolType === 'arc' && !isValidArcPreview(properties, cursorPoint)) { clearPreview(state); return; } // TASK 470: not a preview
    try {
        state.preview = {
            type: toolType,
            points: fixedPoints ? fixedPoints.slice() : [],
            cursorPoint: cursorPoint ? { x: cursorPoint.x, y: cursorPoint.y } : null,
            properties: Object.assign({}, properties)
        };

        // Mirror into legacy state.active.preview for backwards compatibility
        try {
            if (state.active) {
                switch (toolType) {
                    case 'line':
                        state.active.preview = { type: 'line', p1: fixedPoints && fixedPoints[0] ? fixedPoints[0] : null, pt: cursorPoint };
                        break;
                    case 'rect':
                        // mode may be 'two-point'|'center'|'three-point' - map to existing preview types
                        const mode = (properties && properties.mode) ? properties.mode : 'two-point';
                        if (mode === 'center') state.active.preview = { type: 'rect-center', pt: cursorPoint };
                        else if (mode === 'three-point') state.active.preview = { type: 'rect-3pt', pt: cursorPoint };
                        else state.active.preview = { type: 'rect', pt: cursorPoint };
                        break;
                    case 'circle':
                        state.active.preview = { type: 'circle', center: fixedPoints && fixedPoints[0] ? fixedPoints[0] : null, radius: properties && properties.radius ? properties.radius : undefined, pt: cursorPoint };
                        break;
                    case 'arc':
                        // Only center-start-end arc preview supported; centre is a resolved {x,y} (validated above)
                        const obj = { type: 'arc', center: properties && properties.center, radius: properties && properties.radius, startAngle: properties && properties.startAngle, endAngle: properties && properties.endAngle, pt: cursorPoint };
                        state.active.preview = obj;
                        break;
                    default:
                        state.active.preview = { type: toolType, pt: cursorPoint };
                }
            }
        } catch (_) { }

        try { state.tempMousePos = cursorPoint ? { x: cursorPoint.x, y: cursorPoint.y } : null; } catch (_) { }
    } catch (_) { }
}

export function clearPreview(state) {
    try { state.preview = null; } catch (_) { }
    try { if (state.active) state.active.preview = null; } catch (_) { }
    try { state.tempMousePos = null; } catch (_) { }
}

export function getPreviewData(state) {
    if (!state || !state.preview) return null;
    // Normalize preview data using current joints for convenience to renderers
    const p = state.preview;
    const pts = (p.points || []).map(id => (state.joints && state.joints.has(id)) ? state.joints.get(id) : null);
    const out = Object.assign({}, p);
    out.jointPoints = pts;
    return out;
}
