// Regular POLYGON tool (TASK 483) — click = centre; drag, or a second click = a corner (sets the radius AND the rotation).
// N sides come from state.polygonSides (the ribbon's Sides field; default 6, 3..64, remembered). The result is N plain LINE
// shapes with shared joints + construction radii + equal-side / equal-radius constraints (core/shapes.js makePolygon), made
// in ONE undo group so a single Undo removes the whole polygon. Modelled on the circle tool (same click-or-drag flow).
import { TOOL_MODES } from '#core/constants.js';
import { addConstraint } from '#core/constraints.js';
import { makePolygon, clampPolygonSides } from '#core/shapes.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { findSnap } from '#ui/snap-detection.js';
import { clearPreview } from '#ui/preview-manager.js';
import { checkDragThreshold, beginDrawing, resetToolState, safeUpdatePreview } from '#ui/input-handlers/base-tool.js';

const localState = { isDragging: false, dragStartScreen: null };
const MIN_RADIUS = 1e-6;

/** The side count in force: the ribbon field's value, clamped to the declared range. */
export const polygonSides = (state) => clampPolygonSides(state && state.polygonSides);

export function resetPolygonState(state) {
    resetToolState(state, TOOL_MODES.POLYGON, localState);
}

export function handlePolygonPointerDown(e, svg, state, hitSnap, w) {
    // waiting for the second click (the corner): consume it so a new polygon does not start inside this one
    if (state.active && state.active.mode === TOOL_MODES.POLYGON && state.active.waitingForSecondClick) return true;
    const { snap } = beginDrawing(state, hitSnap, w, TOOL_MODES.POLYGON, { centerSnapTarget: null, waitingForSecondClick: false });
    state.active.centerSnapTarget = snap;
    localState.dragStartScreen = { x: e.clientX, y: e.clientY };
    localState.isDragging = false;
    return true;
}

export function handlePolygonPointerMove(e, svg, state, w) {
    if (!state.active || state.active.mode !== TOOL_MODES.POLYGON) return false;
    if (checkDragThreshold(e, localState.dragStartScreen)) localState.isDragging = true;
    const previewPt = state.snapTarget ? state.snapTarget.pt : w;
    if (!state.joints.get(state.active.start)) return false;
    safeUpdatePreview(state, 'polygon', [state.active.start], previewPt, { sides: polygonSides(state) });
    return true;
}

export function handlePolygonPointerUp(e, svg, state, hitSnap, w) {
    if (!state.active || state.active.mode !== TOOL_MODES.POLYGON) return false;
    // a click (no drag): wait for the second click that sets the corner
    if (!localState.isDragging && !state.active.waitingForSecondClick) {
        state.active.waitingForSecondClick = true;
        localState.dragStartScreen = null;
        return true;
    }
    let snapForEnd = hitSnap;
    if (state.active.waitingForSecondClick) {
        try { snapForEnd = findSnap(state.joints, state.shapes, svg, { x: e.clientX, y: e.clientY }, [state.active.start]); } catch (_) { snapForEnd = null; }
    }
    const endPt = (snapForEnd && snapForEnd.isLocked && snapForEnd.pt) ? snapForEnd.pt : w;
    return createPolygon(state, endPt);
}

/** Build the polygon from the active centre joint to `endPt` (the first corner). Returns true when the event was handled. */
export function createPolygon(state, endPt) {
    const center = state.joints.get(state.active && state.active.start);
    if (!center || !endPt) { try { state.endUndoGroup(); } catch (_) {} state.active = null; return false; }
    const radius = Math.hypot(endPt.x - center.x, endPt.y - center.y);
    localState.isDragging = false; localState.dragStartScreen = null;
    if (!(radius > MIN_RADIUS)) {   // a second click on the centre: no polygon, and the centre joint made by the first click goes too
        state.joints.delete(state.active.start);
        try { state.endUndoGroup(); } catch (_) {}
        clearPreview(state);
        state.active = null;
        return true;
    }
    state.saveState();
    const vertexId = state.genJ();
    state.joints.set(vertexId, { x: endPt.x, y: endPt.y, fixed: false });
    const built = makePolygon(state.joints, state.active.start, vertexId, polygonSides(state), state.genJ, !!state.isConstructionMode);
    for (const s of built.shapes) state.shapes.push(s);
    for (const c of built.constraints) addConstraint(state, c.type, c);
    try {
        if (state.active.centerSnapTarget && state.active.centerSnapTarget.isLocked) applySnapConstraint(state, state.active.start, state.active.centerSnapTarget);
    } catch (_) { /* a snap that cannot constrain still leaves a valid polygon */ }
    state.endUndoGroup();
    state.active = null;
    return true;
}

