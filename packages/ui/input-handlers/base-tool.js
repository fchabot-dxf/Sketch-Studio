// ═══════════════════════════════════════════════════════════════════════════════
// BASE TOOL - Shared utilities for all drawing tools
// ═══════════════════════════════════════════════════════════════════════════════

import { updatePreview } from '#ui/preview-manager.js';
import { showDualInput, showSingleInput, setLiveInputValue, updateInputPosition } from '#ui/numeric-input-manager.js';
import { applySnapConstraint, sharedEndTarget, SNAP_JOIN } from '#core/snap-constraints.js';
import { planChange } from '#core/parameters.js';
import { applyParameterChange } from '#core/dimension-seams.js';
import { docUnit } from '#core/settings-manager.js';

/** Extract `{ x, y }` from a snap target (`.pt` or `.x`/`.y`). */
export const snapPoint = (snap) => (snap ? (snap.pt || (typeof snap.x === 'number' && typeof snap.y === 'number' ? { x: snap.x, y: snap.y } : null)) : null);

/**
 * TASK 1033 (X-01): THE snap the cursor shows, for a step that has no pointer event of its own (Enter in a value box steps at the last hover point).
 * It is the locked snap the last move found, kept by input-manager updateSnapTarget in `state.activeSnap`: the one the click reads too
 * (`state.activeSnap || hitSnap`), so Enter and a click on the same point apply the same snap. Never read from `state.active.preview`: each tool's
 * updatePreview rebuilds that object on every move. A typed value that positions the point still drops it, in each tool's own step (as its click does).
 */
export const shownSnap = (state) => state.activeSnap || null;

/**
 * Apply the constraint for a locked drawing snap onto `jointId` (grid snaps are visual-only).
 * Shared by line-tool and rect-tool so corner/endpoint/midpoint/on-curve snap rules live in ONE place.
 * TASK 1045: it is THE DRAWING tools' snap (Line, Rectangle, Circle, Polygon, Slot, Bezier): SNAP_JOIN.DRAW, so a new point on an existing curve end
 * point is SHARED with it (the new joint `jointId` is merged into that point and gone), on any other point glued.
 * -> the joint the point IS after its snap: that end point when it was shared, else `jointId` (a caller that goes on using the point uses this id).
 */
export function applyLockedSnap(state, jointId, snap, excludeJoints = []) {
    if (!jointId || !snap || !snap.isLocked || snap.type === 'grid') return jointId;
    const opts = { excludeJoints, join: SNAP_JOIN.DRAW };
    const shared = sharedEndTarget(state, jointId, snap, opts);
    applySnapConstraint(state, jointId, snap, opts);
    return shared && !state.joints.has(jointId) ? shared : jointId;
}

/** A snap that binds the point it places (a LOCKED one, not the grid's): applyLockedSnap joins / binds the point to it. */
export const isBindingSnap = (snap) => !!snap && !!snap.isLocked && snap.type !== 'grid';

/**
 * TASK 1028 (B-06) / 1045: the point `jointId` a drawing tool placed with NO binding snap (a typed size put it there, or no snap was shown) that lies ON an
 * existing point (within PLACED_ON_POINT_TOL; not one of `exclude`, the drawn shape's own points) is joined there as a click's snap on it would join it
 * (applyLockedSnap: an end point shared, another point glued). A typed end 0.3 mm from an unrelated point is never joined with it.
 * -> the joint the point IS (applyLockedSnap's).
 */
export const PLACED_ON_POINT_TOL = 0.01;
export function joinPointUnder(state, jointId, exclude = []) {
    const p = state.joints.get(jointId);
    if (!p) return jointId;
    for (const [id, q] of state.joints) {
        if (id === jointId || exclude.includes(id) || Math.hypot(q.x - p.x, q.y - p.y) >= PLACED_ON_POINT_TOL) continue;
        return applyLockedSnap(state, jointId, { type: 'joint', targetId: id, pt: { x: q.x, y: q.y }, isLocked: true }, exclude);
    }
    return jointId;
}

/**
 * TASK 782: THE minimum size of a shape a click (or Enter) may place, in the document base unit: a double click on one spot, or a click on the
 * base line of a 3-point rectangle, would make a shape nobody can see or select. Every creation tool asks `tooSmall` with the sizes that must be
 * above it (a rectangle's two sides, a circle's or arc's radius, a polygon's radius, a line's length) and, when it says true, ignores the click.
 */
export const MIN_SHAPE_SIZE = 1e-4;
export const tooSmall = (...sizes) => sizes.some((s) => !(s > MIN_SHAPE_SIZE));

/**
 * Check if pointer movement exceeds drag threshold.
 * @param {PointerEvent} e - Current pointer event
 * @param {{x:number, y:number}|null} dragStart - Screen position at pointer down
 * @param {number} threshold - Pixel threshold (default 3)
 * @returns {boolean} True if dragging
 */
export function checkDragThreshold(e, dragStart, threshold = 3) {
    if (!dragStart) return false;
    return Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > threshold;
}

/**
 * Common pointer-down initialization for drawing tools.
 * Creates a start joint, sets state.active, begins undo group.
 * @returns {{ startId, startPt, snap }}
 */
export function beginDrawing(state, hitSnap, worldPt, toolMode, extraProps = {}) {
    try { state.beginDrawStep(); } catch (_) { }
    const snap = state.activeSnap || hitSnap;
    const startPt = (snap && snap.isLocked && snap.pt) ? snap.pt : worldPt;
    const startId = state.genJ();
    state.joints.set(startId, { x: startPt.x, y: startPt.y, fixed: false });
    state.active = {
        mode: toolMode,
        start: startId,
        startPt,
        preview: null,
        polylineOrigin: startId,
        _tempStart: true,
        startSnapTarget: snap,
        ...extraProps
    };
    return { startId, startPt, snap };
}

/**
 * Common reset for drawing tools. Clears active state, drag tracking, preview constraints.
 * @param {object} state - App state
 * @param {string} toolMode - TOOL_MODES constant to match
 * @param {object} localState - Mutable local state object with isDragging, dragStartScreen
 */
export function resetToolState(state, toolMode, localState) {
    if (state?.active?.mode === toolMode) state.active = null;
    localState.isDragging = false;
    localState.dragStartScreen = null;
    if (state?.previewConstraint) {
        const idx = state.constraints.indexOf(state.previewConstraint);
        if (idx >= 0) state.constraints.splice(idx, 1);
        state.previewConstraint = null;
    }
    if (state) state.inference = null;
}

/**
 * Safely update preview and set tempMousePos. Wraps updatePreview in try-catch.
 */
export function safeUpdatePreview(state, type, jointIds, pt, opts) {
    try { updatePreview(state, type, jointIds, pt, opts); } catch (_) { }
    state.tempMousePos = pt;
}

/**
 * TASK 596: the ONE "show the tool's boxes on the first click" path of the creation tools (rect, circle, polygon). A tool declares its box
 * ({ dual: { kind, labels, separator, quantities } } for two fields, { single: { field, quantity, refuse? } } for one (TASK 1028: `refuse(v)` -> why | '' is the
 * field's own value rule, numeric-input-manager boxRefusal); TASK 769: a field's quantity is 'length'
 * (the default: shown and typed in the document unit), 'angle' or 'count') and calls these:
 * openCreationBoxes on the first click (the boxes show at once, beside the cursor, the first field focused: a digit typed now goes in it),
 * followCreationBoxes on every move (the box follows the cursor and each field shows the live value unless the user typed in it),
 * On TOUCH (pointerType 'touch') the boxes show but are NOT focused (a focused box pops the phone keyboard on every click and shrinks the viewport); tapping a box focuses it; mouse and pen auto-focus.
 * Esc inside a box is NOT handled here: the box raises 'liveDimensionCancelled' and input-manager runs the canvas Esc (handleEscape) for it.
 */
export function openCreationBoxes(e, box, values) {
    openCreationBoxesAt({ x: e.clientX, y: e.clientY }, box, values, { focus: e.pointerType !== 'touch' });
}
/** TASK 1034: THE opening of the creation boxes beside a screen point. `owner` (a tool session's box translator, #ui/input-translate-box.js)
 *  hears the box's edits and Enter directly; `initialKey` is the key that opened the box (its first character). */
export function openCreationBoxesAt(at, box, values, { focus = true, owner = null, initialKey = null } = {}) {
    const x = at.x + 15, y = at.y + 15;
    if (box.dual) showDualInput(x, y, values[0], values[1], { ...box.dual, focus, owner, initialKey });
    else showSingleInput(x, y, values[0], box.single.field, initialKey, focus, box.single.quantity, box.single.refuse || null, owner);   // TASK 1028 (B-07): a box may declare its own value rule
}
export function followCreationBoxes(e, values) {
    followCreationBoxesAt({ x: e.clientX, y: e.clientY }, values);
}
/** TASK 1034: the open creation box follows a screen point and shows each field's live value (a typed field keeps its text) */
export function followCreationBoxesAt(at, values) {
    updateInputPosition(at.x, at.y);
    values.forEach((v, i) => setLiveInputValue(i, v));
}

/** TASK 876: the formula a TYPED field of the creation box reads as ("d1 / 2", from the box's detail.expressions), or null (untyped, a plain number).
 *  A tool keeps it beside the locked value and hands it to the dimension it creates (ConstraintManager.createConstraint params.expression: the ONE seam),
 *  so the new dimension is driven by the name it was typed from and follows it. */
export function liveExpression(detail, i) {
    return (detail.typed && detail.typed[i] && detail.expressions && detail.expressions[i]) || null;
}
/** TASK 1013 (UX-17a): custom dimension name typed via `w = expr` in field `i` of a draw-time box, or null. */
export function liveName(detail, i) {
    return (detail.typed && detail.typed[i] && detail.names && detail.names[i]) || null;
}
/** TASK 1013 (UX-17a): existing user parameter update `{ name, text }` typed via `param = expr` in field `i` of a draw-time box, or null. */
export function liveAssign(detail, i) {
    return (detail.typed && detail.typed[i] && detail.assigns && detail.assigns[i]) || null;
}
/** TASK 1013 (UX-17a): commit an existing user parameter update (`param = expr`) inside the active draw/modify undo step (snapshot: false). */
export function applyLiveAssign(state, assign) {
    if (!state || !assign || !assign.name) return { ok: true };
    const plan = planChange(state, { type: 'setParameter', name: assign.name, text: assign.text }, { unit: docUnit() });
    if (!plan.ok) return plan;
    return applyParameterChange(state, plan, `change parameter ${assign.name}`, { snapshot: false });
}

/**
 * Wire up liveDimensionApplied / liveDimensionPreview / liveDimensionCancelled listeners.
 * @param {object} state - App state
 * @param {string} toolMode - TOOL_MODES constant to guard on
 * @param {object} config - { onApply, onPreview, onCancel, guard? }
 */
export function setupDimensionListeners(state, toolMode, config) {
    // Guard for non-browser test environments where `window.addEventListener` may not exist
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    window.addEventListener('liveDimensionApplied', (e) => {
        if (state.currentTool !== toolMode || !state.active) return;
        if (config.guard && !config.guard(e.detail)) return;
        config.onApply(e.detail);
    });
    window.addEventListener('liveDimensionPreview', (e) => {
        if (state.currentTool !== toolMode || !state.active) return;
        if (config.guard && !config.guard(e.detail)) return;
        config.onPreview(e.detail);
    });
    window.addEventListener('liveDimensionCancelled', () => {
        if (state.currentTool !== toolMode) return;
        if (config.onCancel) config.onCancel();
    });
}
