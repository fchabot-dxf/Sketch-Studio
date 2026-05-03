// Unified Preview Manager
// Centralizes preview state and keeps backwards-compatible active.preview

export function updatePreview(state, toolType, fixedPoints, cursorPoint, properties = {}) {
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
                        // Only center-start-end arc preview supported
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
