// Regular POLYGON tool (TASK 483) — click = centre; drag, or a second click = a corner (sets the radius AND the rotation).
// N sides come from state.polygonSides (default 6, 3..64, remembered in localStorage). TASK 596: after the centre click the on-canvas
// two-field box (numeric-input-manager's dual box: size, sides) is the one place to type them: Tab switches fields, Enter or a click
// places it, Esc cancels. The result is N plain LINE shapes with shared joints + construction radii + equal-side / equal-radius
// constraints (core/shapes.js makePolygon), made in ONE undo group so a single Undo removes the whole polygon. Modelled on the
// circle tool (same click-or-drag flow).
import { TOOL_MODES, POLYGON_SIDES, CONSTRAINT_TYPES } from '#core/constants.js';
import { addConstraint } from '#core/constraints.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makePolygon, clampPolygonSides } from '#core/shapes.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { clearPreview } from '#ui/preview-manager.js';
import { hideInput } from '#ui/numeric-input-manager.js';
import { checkDragThreshold, beginDrawing, resetToolState, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, applyLockedSnap, shownSnap, snapPoint, MIN_SHAPE_SIZE, liveExpression, liveName, liveAssign, applyLiveAssign } from '#ui/input-handlers/base-tool.js';

const localState = { isDragging: false, dragStartScreen: null };
// The live box: `sides` / `lockedRadius` are what the user typed in it (null = not typed: the cursor sets the size, state.polygonSides the sides).
const live = { boxOpen: false, sides: null, sidesAssign: null, lockedRadius: null, radiusExpression: null, radiusName: null, radiusAssign: null, cursor: null };   // TASK 1028 (B-13): sidesAssign = `param = 6` typed in the N box
const MIN_RADIUS = MIN_SHAPE_SIZE;   // TASK 782: the one minimum size (base-tool.js)
const SIDES_KEY = 'sk-polygon-sides';
const BOX = { dual: { kind: 'polygon', labels: ['R', 'N'], separator: 'sides', quantities: ['length', 'count'] } };

/** The side count in force: what is typed in the open box, else the remembered one, clamped to the declared range. */
export const polygonSides = (state) => clampPolygonSides(live.sides != null ? live.sides : (state && state.polygonSides));

/** The remembered side count: state.polygonSides, kept across sessions in localStorage (the key the ribbon's old field used). */
function rememberSides(state, n) {
    state.polygonSides = n;
    try { localStorage.setItem(SIDES_KEY, String(n)); } catch (_) { /* storage blocked: it is still remembered for this session */ }
}

export function setupPolygonTool(svg, state) {
    if (state.polygonSides == null) {
        let stored = null; try { stored = localStorage.getItem(SIDES_KEY); } catch (_) { /* storage blocked: the default applies */ }
        state.polygonSides = clampPolygonSides(stored == null ? POLYGON_SIDES.default : stored);
    }
    state.onDrawCancelled(() => { if (live.boxOpen) resetLive(); });   // another tool picked / Undo mid-draw: the boxes go with the draw
    setupDimensionListeners(state, TOOL_MODES.POLYGON, {
        guard: (detail) => detail.mode === 'dual' && detail.kind === 'polygon',
        onPreview: (detail) => {
            if (detail.reset && detail.reset[1]) { live.sides = null; live.sidesAssign = null; }
            else if (detail.typed[1] && Number.isFinite(detail.height)) { live.sides = clampPolygonSides(detail.height); live.sidesAssign = liveAssign(detail, 1); }
            if (detail.reset && detail.reset[0]) { live.lockedRadius = null; live.radiusExpression = null; live.radiusName = null; live.radiusAssign = null; }
            else if (detail.typed[0]) {
                live.lockedRadius = detail.width > 0 ? detail.width : null;
                live.radiusExpression = live.lockedRadius !== null ? liveExpression(detail, 0) : null;
                live.radiusName = live.lockedRadius !== null ? liveName(detail, 0) : null;
                live.radiusAssign = live.lockedRadius !== null ? liveAssign(detail, 0) : null;
            }
            redrawPreview(state);
        },
        onApply: (detail) => {
            if (detail.confirmedBy !== 'enter') return;
            if (detail.typed && detail.typed[0]) {
                live.lockedRadius = detail.width > 0 ? detail.width : null;
                live.radiusExpression = live.lockedRadius !== null ? liveExpression(detail, 0) : null;
                live.radiusName = live.lockedRadius !== null ? liveName(detail, 0) : null;
                live.radiusAssign = live.lockedRadius !== null ? liveAssign(detail, 0) : null;
            }
            if (Number.isFinite(detail.height)) { live.sides = clampPolygonSides(detail.height); live.sidesAssign = liveAssign(detail, 1); }
            const center = state.joints.get(state.active.start);
            const end = sizedEnd(center, live.cursor || center);
            if (!(Math.hypot(end.x - center.x, end.y - center.y) > MIN_RADIUS)) { detail.keepOpen = true; return; } // no size yet (cursor still on the centre, none typed): the box stays open
            live.boxOpen = false;
            createPolygon(state, end, live.lockedRadius == null ? shownSnap(state) : null); // Enter places it at the typed size, else at the cursor (TASK 1033, X-01: with the corner snap the cursor shows, as the click)
        }
    });   // Esc inside the box is the canvas Esc (input-manager handleEscape -> resetPolygonState)
}

function resetLive() {
    if (live.boxOpen) hideInput();
    live.boxOpen = false; live.sides = null; live.sidesAssign = null; live.lockedRadius = null; live.radiusExpression = null; live.radiusName = null; live.radiusAssign = null; live.cursor = null;
}

/** `pt`, pulled to the typed size along the centre -> pt direction (a typed size holds while the cursor turns the polygon). */
function sizedEnd(center, pt) {
    if (live.lockedRadius == null) return pt;
    const d = Math.hypot(pt.x - center.x, pt.y - center.y);
    const ux = d > MIN_RADIUS ? (pt.x - center.x) / d : 1, uy = d > MIN_RADIUS ? (pt.y - center.y) / d : 0;
    return { x: center.x + ux * live.lockedRadius, y: center.y + uy * live.lockedRadius };
}

function redrawPreview(state) {
    const center = state.joints.get(state.active && state.active.start);
    if (!center) return;
    safeUpdatePreview(state, 'polygon', [state.active.start], sizedEnd(center, live.cursor || center), { sides: polygonSides(state) });
}

export function resetPolygonState(state) {
    resetLive();
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
    const center = state.joints.get(state.active.start);
    if (!center) return false;
    live.cursor = previewPt;
    redrawPreview(state);
    if (live.boxOpen) {   // the box follows the cursor and shows the size it would have (until a size is typed)
        followCreationBoxes(e, [Math.hypot(previewPt.x - center.x, previewPt.y - center.y)]);
    }
    return true;
}

export function handlePolygonPointerUp(e, svg, state, hitSnap, w) {
    if (!state.active || state.active.mode !== TOOL_MODES.POLYGON) return false;
    // a click (no drag): wait for the second click that sets the corner
    if (!localState.isDragging && !state.active.waitingForSecondClick) {
        state.active.waitingForSecondClick = true;
        localState.dragStartScreen = null;
        // TASK 596: only now, after the centre click, the size and the sides show on the canvas, beside the cursor
        live.boxOpen = true; live.cursor = null;
        openCreationBoxes(e, BOX, [0, polygonSides(state)]);
        return true;
    }
    const snapForEnd = state.activeSnap || hitSnap;   // the click's locked snap, read as the Line tool and the Rectangle read it
    const endPt = (snapForEnd && snapForEnd.isLocked && snapPoint(snapForEnd)) || w;
    // a typed size is the user's own: the corner then lies where the size puts it, not on the snap
    return createPolygon(state, sizedEnd(state.joints.get(state.active.start) || endPt, endPt), live.lockedRadius == null ? snapForEnd : null);
}

/** Build the polygon from the active centre joint to `endPt` (the first corner, with `vertexSnap` = the locked snap it was placed on, if any). Returns true when the event was handled. */
export function createPolygon(state, endPt, vertexSnap = null) {
    const center = state.joints.get(state.active && state.active.start);
    if (!center || !endPt) { resetLive(); state.closeDrawStep(); state.active = null; return false; }
    const radius = Math.hypot(endPt.x - center.x, endPt.y - center.y);
    localState.isDragging = false; localState.dragStartScreen = null;
    const sides = polygonSides(state);
    const typedRadius = live.lockedRadius;
    const radiusExpression = live.radiusExpression;
    const radiusName = live.radiusName;
    const radiusAssign = live.radiusAssign;
    const sidesAssign = live.sides != null ? live.sidesAssign : null;
    resetLive();
    if (!(radius > MIN_RADIUS)) {   // a second click on the centre: no polygon, and the centre joint made by the first click goes too
        state.closeDrawStep(); // nothing committed: the centre joint made by the first click goes with the cancelled step
        clearPreview(state);
        state.active = null;
        return true;
    }
    state.saveState();
    if (sidesAssign) applyLiveAssign(state, sidesAssign);   // TASK 1028 (B-13): `param = 6` in the N box updates that parameter
    const vertexId = state.genJ();
    state.joints.set(vertexId, { x: endPt.x, y: endPt.y, fixed: false });
    const built = makePolygon(state.joints, state.active.start, vertexId, sides, state.genJ, !!state.isConstructionMode);
    rememberSides(state, sides);
    for (const s of built.shapes) state.shapes.push(s);
    for (const c of built.constraints) addConstraint(state, c.type, c);
    // TASK 1013 (B-19b): a typed radius (or formula `d1 / 2`) becomes a driving radius dimension on the polygon's radial
    if (typedRadius != null) {
        if (radiusAssign) applyLiveAssign(state, radiusAssign);
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
            joints: [state.active.start, vertexId],
            value: typedRadius,
            expression: radiusExpression,
            ...(radiusName ? { name: radiusName } : {}),
        }, { source: 'polygon' });
    }
    try {
        if (state.active.centerSnapTarget && state.active.centerSnapTarget.isLocked) applySnapConstraint(state, state.active.start, state.active.centerSnapTarget);
    } catch (_) { /* a snap that cannot constrain still leaves a valid polygon */ }
    applyLockedSnap(state, vertexId, vertexSnap, [state.active.start]);
    state.endUndoGroup();
    state.active = null;
    return true;
}
