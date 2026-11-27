// Circle tool - preview and creation
import { TOOL_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { addConstraint, radialDimensionParams } from '#core/constraints.js';
import { setupNumericInput, showSingleInput, hideInput, resetLockedDimensions, isInputActive } from '#ui/numeric-input-manager.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { applySnapConstraint, onShapeSnap } from '#core/snap-constraints.js';
import { worldToScreen } from '#ui/coords.js';
import { checkDragThreshold, beginDrawing, resetToolState, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, tooSmall, applyLockedSnap, shownSnap, snapPoint, liveExpression, liveName, liveAssign, applyLiveAssign } from '#ui/input-handlers/base-tool.js';
import { newShapeId } from '#core/shape-id.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there

let circleState = { lockedRadius: null, diameterExpression: null, radiusName: null, radiusAssign: null, boxOpen: false };   // TASK 876 / 1013: diameterExpression = formula of the typed DIAMETER (task 1008: a circle's dimension is a diameter); radiusName / radiusAssign from `w = expr`
const clearCircleLocks = () => { circleState.lockedRadius = null; circleState.diameterExpression = null; circleState.radiusName = null; circleState.radiusAssign = null; };
const localState = { isDragging: false, dragStartScreen: null };
// TASK 596: after the first click the size box shows at once (base-tool's shared creation-box path); the size follows the cursor until one is typed.
// TASK 597: the box is the DIAMETER (like Fusion); the circle keeps its radius, and a typed one adds its DIAMETER dimension (task 1008, radialDimensionParams: value = the typed diameter)
const BOX = { single: { field: 'diameter' } };

export function setupCircleTool(svg, state){
    setupNumericInput(svg, state);
    state.onDrawCancelled(() => { if (circleState.boxOpen) { circleState.boxOpen = false; clearCircleLocks(); hideInput(); } });   // another tool picked / Undo mid-draw: the box goes with the draw
    setupDimensionListeners(state, TOOL_MODES.CIRCLE, {
        onApply: (detail) => {
            if (detail.mode === 'single' && detail.field === 'diameter') {
                if (detail.typed[0] && detail.value > 0) {
                    circleState.lockedRadius = detail.value / 2;
                    circleState.diameterExpression = liveExpression(detail, 0);
                    circleState.radiusName = liveName(detail, 0);
                    circleState.radiusAssign = liveAssign(detail, 0);
                } // only a typed diameter locks (the box otherwise shows the live one, rounded)
                if (detail.confirmedBy === 'enter') {
                    let placed = false;
                    try { placed = finalizeCircleFromActive(svg, state); } catch (_) { }
                    if (!placed && state.active) detail.keepOpen = true;   // TASK 782: no radius yet (the cursor is still on the centre, none typed): the box stays open
                }
            }
        },
        onPreview: (detail) => {
            if (detail.mode !== 'single' || detail.field !== 'diameter') return;
            const v = detail.value / 2;
            circleState.lockedRadius = (detail.reset && detail.reset[0]) ? null : (v > 0 ? v : null);
            circleState.diameterExpression = circleState.lockedRadius !== null ? liveExpression(detail, 0) : null;
            circleState.radiusName = circleState.lockedRadius !== null ? liveName(detail, 0) : null;
            circleState.radiusAssign = circleState.lockedRadius !== null ? liveAssign(detail, 0) : null;
            const center = state.joints.get(state.active.start) || state.active.startPt;
            if (center) {
                const pt = (state.active.preview && state.active.preview.pt) || center;
                try { updatePreview(state, 'circle', [state.active.start], pt, { radius: v }); } catch (_) { }
                try { state.tempMousePos = pt; } catch (_) { }
            }
        },
        onCancel: () => { clearCircleLocks(); } // Esc in the box also runs the canvas Esc (input-manager handleEscape)
    });
}

export function resetCircleState(state){ 
    if (state && state.active && state.active.mode === TOOL_MODES.CIRCLE) { clearCircleLocks(); try { hideInput(); } catch (_) { /* no DOM (node) */ } } // the radius box open since the first click goes with the circle
    resetToolState(state, TOOL_MODES.CIRCLE, localState);
}

export function handleCirclePointerDown(e, svg, state, hitSnap, w){
    // FIX: If we are waiting for the second click (radius definition), consume the event 
    // so we don't start a new circle inside the current one. Let PointerUp handle finalization.
    if (state.active && state.active.mode === TOOL_MODES.CIRCLE && state.active.waitingForSecondClick) {
        return true;
    }

    const { startId, startPt, snap } = beginDrawing(state, hitSnap, w, TOOL_MODES.CIRCLE, {
        centerSnapTarget: null,
        waitingForSecondClick: false
    });
    // Override centerSnapTarget with the resolved snap
    state.active.centerSnapTarget = snap;
    localState.dragStartScreen = { x: e.clientX, y: e.clientY };
    localState.isDragging = false;
    return true;
}

export function handleCirclePointerMove(e, svg, state, w){
    if(!state.active || state.active.mode!==TOOL_MODES.CIRCLE) return false;
    // Check drag distance to distinguish intentional drag from a shaky click
    if (checkDragThreshold(e, localState.dragStartScreen)) localState.isDragging = true;
    const previewPt = state.snapTarget ? state.snapTarget.pt : w;
    const center = state.joints.get(state.active.start);
    if(!center) return false;
    const dx = previewPt.x - center.x, dy = previewPt.y - center.y;
    let r = Math.hypot(dx, dy);
    if (isInputActive()) followCreationBoxes(e, [2 * r]);
    if (circleState.lockedRadius) r = circleState.lockedRadius;
    safeUpdatePreview(state, 'circle', [state.active.start], previewPt, { radius: r });
    return true;
}

/**
 * A rim click on an existing POINT (a joint, a circle centre, the origin) puts that point ON the new circle: the point-on-curve the Line tool makes for
 * an end placed on a circle, made by the shared `applyLockedSnap` with the point as the subject and the new circle as the target. A rim click on a
 * line, curve or axis only places the radius there (no constraint, as in Fusion); a typed radius is the user's own size and takes none.
 */
function applyRimSnap(state, shapeId, snap, rimPt) {
    if (circleState.lockedRadius != null || !snap || (snap.type !== 'joint' && snap.type !== 'point')) return;
    applyLockedSnap(state, snap.id || snap.targetId, onShapeSnap(shapeId, rimPt));
}

/**
 * TASK 1013 (B-8): ONE commit path for BOTH pointer-up and Enter finalization, so typed and clicked circles
 * always keep the centre's snap constraint (`centerSnapTarget`), dimension formula/name, and cleanup identically.
 */
function commitCircle(state, r, { snapForEnd = null, endPt = null } = {}) {
    if (tooSmall(r)) return false;
    state.saveState();
    const shapeId = newShapeId('s');
    state.shapes.push({ id: shapeId, type: 'circle', joints: [state.active.start], radius: r, isConstruction: !!state.isConstructionMode });

    // Only add a radius distance constraint if the user explicitly entered a radius
    if (circleState.lockedRadius != null) {
        if (circleState.radiusAssign) applyLiveAssign(state, circleState.radiusAssign);
        addConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            ...radialDimensionParams({ id: shapeId, type: 'circle' }, r),
            expression: circleState.diameterExpression,
            ...(circleState.radiusName ? { name: circleState.radiusName } : {}),
        });
    }

    try {
        if (state.active && state.active.centerSnapTarget && state.active.centerSnapTarget.isLocked) {
            applySnapConstraint(state, state.active.start, state.active.centerSnapTarget);
        }
    } catch (_) { }
    if (snapForEnd && endPt) applyRimSnap(state, shapeId, snapForEnd, endPt);

    clearCircleLocks(); circleState.boxOpen = false;
    localState.isDragging = false;
    localState.dragStartScreen = null;
    try { resetLockedDimensions(); } catch (_) { }
    try { hideInput(); } catch (_) { }
    state.endUndoGroup();
    state.active = null;
    return true;
}

export function handleCirclePointerUp(e, svg, state, hitSnap, w, wasDraggingGlobal){
    if(!state.active || state.active.mode!==TOOL_MODES.CIRCLE) return false;

    // FIX: Hybrid Workflow Logic
    // If user clicked (did not drag) and we aren't already waiting, switch to "Waiting for Second Click" mode.
    if (!localState.isDragging && !state.active.waitingForSecondClick) {
        state.active.waitingForSecondClick = true;
        localState.dragStartScreen = null; 
        openCreationBoxes(e, BOX, [0]); circleState.boxOpen = true;
        return true;
    }

    // Otherwise (if we Dragged OR if this is the Second Click), finalize the circle.
    const snapForEnd = state.activeSnap || hitSnap;   // the click's locked snap, read as the Line tool and the Rectangle read it
    const endPt = (snapForEnd && snapForEnd.isLocked && snapPoint(snapForEnd)) || w;
    const center = state.joints.get(state.active.start);
    if(!center) return false;
    const dx = endPt.x - center.x, dy = endPt.y - center.y;
    let r = Math.hypot(dx, dy);
    if (circleState.lockedRadius) r = circleState.lockedRadius;
    if (!commitCircle(state, r, { snapForEnd, endPt })) return true;   // TASK 782: a click on the centre places no circle (keeps waiting)
    return true;
}

/**
 * Finalize circle creation immediately (used when Enter confirms radius / diameter).
 * TASK 1013 (B-8): works even without a prior pointermove when a diameter was typed, and shares commitCircle so centerSnapTarget is kept.
 */
export function finalizeCircleFromActive(svg, state){
    if(!state.active || state.active.mode !== TOOL_MODES.CIRCLE) return false;
    try{
        const center = state.joints.get(state.active.start);
        if(!center) return false;
        const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : null;
        let r = previewPt ? Math.hypot(previewPt.x - center.x, previewPt.y - center.y) : 0;
        if (circleState.lockedRadius) r = circleState.lockedRadius;
        return commitCircle(state, r, { snapForEnd: shownSnap(state), endPt: previewPt });   // TASK 1033 (X-01): the rim snap the cursor shows, as the click (a typed diameter drops it: applyRimSnap)
    }catch(_){ try{ state.endUndoGroup(); }catch(_){ } state.active = null; return false; }
}

export function handleCircleKeyDown(e, svg, state) {
    if (state.currentTool !== TOOL_MODES.CIRCLE) return false;
    if (!state.active || !state.active.start) return false;
    if (matchesShortcut(e, 'draw.typeValue') && !isInputActive()) {
        const center = state.joints.get(state.active.start) || state.active.startPt;
        const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : center;
        const currentRadius = Math.hypot((previewPt.x - center.x), (previewPt.y - center.y));
        const midWorld = { x: (center.x + previewPt.x) / 2, y: (center.y + previewPt.y) / 2 };
        const midScreen = worldToScreen(svg, midWorld);
        showSingleInput(midScreen.x, midScreen.y, 2 * currentRadius, 'diameter', e.key); // the typed digit is the box's first character
        return true;
    }
    return false;
}

// Test helper to set locked radius during unit tests
export function _test_setCircleLockedRadius(v) { circleState.lockedRadius = v; }
