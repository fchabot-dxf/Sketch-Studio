// ═══════════════════════════════════════════════════════════════════════════════
// LINE TOOL - Handles line and polyline behavior; its points join what they are placed on (TASK 1045: joinSegment)
// ═══════════════════════════════════════════════════════════════════════════════
// Shared UI (#ui/input-handlers/). Relocated VERBATIM from apps/sketchstudio in slice S4d.
// TODO(shaper): parameterize the DOM reaches before Shaper adopts this — relocation only for now.

import { dbg } from '#core/debug.js';
import { TOOL_MODES, SNAP, CONSTRAINT_TYPES, INFERENCE_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { findInference } from '#core/inference-engine.js';
import { screenToWorld, worldToScreen } from '#ui/coords.js';
import { hideInput, setupNumericInput, refuseLiveValue, cantSetText } from '#ui/numeric-input-manager.js';
import { quantityText } from '#core/parameters.js';
import { docUnit } from '#core/settings-manager.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { checkDragThreshold, resetToolState, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, applyLockedSnap, isBindingSnap, joinPointUnder, shownSnap, MIN_SHAPE_SIZE, liveExpression, liveName, liveAssign, applyLiveAssign } from '#ui/input-handlers/base-tool.js';
import { newShapeId as mintShapeId } from '#core/shape-id.js';
import { clearHover } from '#ui/hover-manager.js';
import SettingsManager from '#core/settings-manager.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there

// TASK 597: lockedLength / lockedAngle (degrees) are what the user TYPED in the length + angle boxes (null = the cursor sets it)
let lineState = { lockedLength: null, lockedAngle: null, lengthExpression: null, lengthName: null, lengthAssign: null, angleAssign: null };   // TASK 876 / 1013: expression / name / user-param assign from typed length box; TASK 1028 (B-13): `param = value` typed in the angle box
// the boxes shown since the segment's first click (base-tool's shared creation-box path); `cursor` = the last world point, `screen` = the last pointer
const live = { boxOpen: false, cursor: null, screen: null };
const BOX = { dual: { kind: 'line', labels: ['L', '°'], separator: '∠', quantities: ['length', 'angle'] } };
const MIN_LEN = MIN_SHAPE_SIZE;   // TASK 782: the one minimum size (base-tool.js)
// TASK 782: the angle box counts COUNTER-CLOCKWISE from the +x axis (up-right on the screen is +45, like Fusion). The world's y points DOWN, so the box angle is the
// negated atan2: ONE pair of conversions for what the box shows (cursorBoxAngle) and what a typed angle means (worldAngleOf).
const cursorBoxAngle = (dx, dy) => { const a = -Math.atan2(dy, dx) * 180 / Math.PI; return a === 0 ? 0 : a; };   // no -0 in the box
const worldAngleOf = (deg) => -deg * Math.PI / 180;

const startOf = (state) => (state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null))) || null;
const hasLock = () => lineState.lockedLength !== null || lineState.lockedAngle !== null;
/** The segment's end: the cursor, but a typed length holds the length and a typed angle the angle (the other still follows the cursor). */
function lockedEnd(spt, pt) {
    if (!hasLock()) return pt;
    const dx = pt.x - spt.x, dy = pt.y - spt.y;
    const len = lineState.lockedLength !== null ? lineState.lockedLength : Math.hypot(dx, dy);
    const ang = lineState.lockedAngle !== null ? worldAngleOf(lineState.lockedAngle) : Math.atan2(dy, dx);
    return { x: spt.x + Math.cos(ang) * len, y: spt.y + Math.sin(ang) * len };
}
function openLineBoxes(e) {   // e: the click (or { clientX, clientY } where the last pointer was)
    lineState.lockedLength = null; lineState.lockedAngle = null; lineState.lengthExpression = null; lineState.lengthName = null; lineState.lengthAssign = null; lineState.angleAssign = null;
    live.boxOpen = true; live.cursor = null; live.screen = { x: e.clientX, y: e.clientY };
    openCreationBoxes(e, BOX, [0, 0]);
}
function closeLineBoxes() {
    lineState.lockedLength = null; lineState.lockedAngle = null; lineState.lengthExpression = null; lineState.lengthName = null; lineState.lengthAssign = null; lineState.angleAssign = null;
    if (live.boxOpen) hideInput();
    live.boxOpen = false; live.cursor = null; live.screen = null;
}
function redrawLinePreview(state) {
    const spt = startOf(state);
    if (!spt || !state.active || state.active.mode !== TOOL_MODES.LINE) return;
    if (lineState.lockedAngle !== null) { state.activeInference = null; state.inference = null; }   // a typed angle beats the inferred H / V / parallel; a typed length alone keeps it (R2-04)
    const inferredPt = state.activeInference && state.activeInference.pos;   // the inferred direction a typed length runs along
    const pt = lockedEnd(spt, inferredPt || live.cursor || spt);
    safeUpdatePreview(state, 'line', [state.active.start], pt, { lockedLength: lineState.lockedLength || undefined });
}

/**
 * TASK 1045: THE join of a committed segment's two points, the click's and Enter's (Fusion, MEASURED by the advisor 2026-11-27: a line ending, or
 * starting, ON an existing curve END POINT shares that point, by a click and by Enter; on a curve's middle it is a point-on-curve; on a circle
 * centre, a lone point or the origin a separate point + Coincident). The segment is pushed first, then its start takes the snap its first click
 * showed and its end the snap shown now (`endSnap`, null when a typed size placed it); an end with no binding snap that lies on an existing
 * point is joined there the same way (base-tool joinPointUnder, TASK 1028 B-06: within 0.01; a typed end 0.3 mm from an unrelated point is never
 * joined with it). Then the typed sizes become dimensions between them, on the joined points (TASK 1028 B-08: a length a locked point cannot hold
 * is refused and the caller puts the document back). Every join is applyLockedSnap's (SNAP_JOIN.DRAW): a shared point's new joint is gone, so the
 * segment's joints are read back from the shape.
 * -> the refusal text of a typed length ('' = kept).
 */
function joinSegment(state, seg, startSnap, endSnap) {
    applyLockedSnap(state, seg.joints[0], startSnap, [seg.joints[1]]);
    if (isBindingSnap(endSnap)) applyLockedSnap(state, seg.joints[1], endSnap, [seg.joints[0]]);
    else joinPointUnder(state, seg.joints[1], [seg.joints[0]]);
    return addTypedSizes(state, seg.joints[0], seg.joints[1]);
}
/** The typed length of the segment startId -> endId becomes its driving dimension (THE constraint path: a redundant size is placed as a reference), and
 *  TASK 1028 (B-13) a `param = value` typed in the angle box updates that parameter. TASK 1028 (B-08): a typed length the sketch cannot hold (it came in as
 *  a reference measuring another value: the end is held by a locked point) is not silently dropped: returns the refusal (the edit box's wording), '' = kept. */
function addTypedSizes(state, startId, endId) {
    if (lineState.lockedAngle !== null && lineState.angleAssign) applyLiveAssign(state, lineState.angleAssign);
    if (lineState.lockedLength === null) return '';
    if (lineState.lengthAssign) applyLiveAssign(state, lineState.lengthAssign);
    const c = ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [startId, endId], value: lineState.lockedLength, expression: lineState.lengthExpression, ...(lineState.lengthName ? { name: lineState.lengthName } : {}) }, { source: 'line' });
    const a = state.joints.get(startId), b = state.joints.get(endId);
    const held = !c || !(c.isDriven || c.driven) || !a || !b || Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - lineState.lockedLength) <= 1e-6;
    return held ? '' : cantSetText(quantityText(lineState.lockedLength, docUnit(), 'unit'), 'the sketch is over constrained');
}
/** TASK 1028 (B-08): put the document back as it was before the refused segment (the draw goes on: the same start, the boxes keep the text) and refuse the length box. */
function refuseSegment(state, before, why) {
    const active = state.active;
    state._restoreSnapshot(before);
    state.active = active;
    state.inference = null; state.activeInference = null;
    refuseLiveValue(0, why);
}

const SNAP_DEBUG = false;
const localState = { isDragging: false, dragStartScreen: null };
let justCreatedActive = false;
let lastLineCommitTime = 0;
// TASK 549 (undo): ONE drawn segment = ONE undo step. The step opens at the segment's FIRST click and closes at its commit. A CHAIN's next
// segment starts ON the previous segment's end point (TASK 1045: shared, nothing is made for it); the document as it was right after the
// previous commit is kept here and becomes the next step's "before", so Undo removes the segment's end joint, shape and constraints together
// and leaves no orphan. LINE_CHAIN_UNDO = 'per-tool-session' keeps ONE step open for the whole chain instead.
let pendingStepSnapshot = null;
const chainPerSession = () => SettingsManager.get('LINE_CHAIN_UNDO') === 'per-tool-session';
// open the step of a chain's next segment (its first click / typed length) unless one is already open
function ensureSegmentStep(state){
    if (state.isUndoGroupOpen()) return;
    state.beginDrawStep(undefined, pendingStepSnapshot || undefined);
    pendingStepSnapshot = null;
}
// the segment is committed: close its step (per-segment) and remember the document as it is now (the next segment's "before")
function endSegmentStep(state){
    if (chainPerSession()) return;
    state.endUndoGroup();
    pendingStepSnapshot = state.captureUndoSnapshot();
}
// the draw ended without a (further) segment: remove the floating start joint and settle the step (cancelled = no step, kept = the chain)
function abortLine(state){
    deactivateLineTool(state);
    state.closeDrawStep();
}
// TASK 562: END the polyline chain, keeping the segments already committed by clicks and discarding the rubber-band segment to the
// cursor. The ONE function behind the Enter key and the touch "Done" button (a phone has neither Enter nor Esc).
export function finishLineChain(state){
    abortLine(state);
}
// TASK 1028 (B-05) + TASK 1030 (I-17): THE Line right-click. It ends the chain like Enter / Done, keeping the committed segments; a typed length is
// committed first (one segment of that length). It never adds a segment to the cursor. A typed length the sketch refuses keeps the chain (the
// edit box says why). Nothing drawn yet: nothing happens.
export function rightClickLine(svg, state){
    if (!state.active || state.active.mode !== TOOL_MODES.LINE) return;
    if (lineState.lockedLength !== null && !finalizeLineFromActive(svg, state)) return;
    finishLineChain(state);
}
// TASK 642: the point the Done button sits beside, one that does NOT follow the cursor (a button that flees the mouse cannot be clicked):
// the rubber band's end only when typed length AND angle lock it, otherwise the chain's last committed joint (the rubber band's start).
export function lineChainAnchor(state){
    const spt = startOf(state);
    if (!spt) return null;
    return lineState.lockedLength !== null && lineState.lockedAngle !== null ? lockedEnd(spt, spt) : spt;
}
const LINE_POINTERUP_DEBOUNCE_MS = 500;

function canPreviewLineInference(state, startId, endId, newShapeId, activeInf) {
    if (!activeInf) return false;
    if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [startId, endId] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints: [startId, endId] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PERPENDICULAR, { shapes: [newShapeId, target] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.TANGENT) {
        const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { full: false }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        const targetShape = state.shapes.find(s => s && s.id === target);
        if (!targetShape || !targetShape.joints || targetShape.joints.length < 2) return false;
        const [j0, j1] = targetShape.joints;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { full: false }).ok;
    }
    return true;
}

/** THE inference apply of a drawn segment (the Line tool's two commit paths and the Slot's centreline): the inferred H / V / perpendicular / parallel / tangent / midpoint becomes a constraint on the segment startId -> endId (shape newShapeId) when it can be added. */
export function applyLineInference(state, activeInf, startId, endId, newShapeId) {
    try{
        if (activeInf && canApplyLineInference(state, startId, endId, newShapeId, activeInf)) {
            if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
                ConstraintManager.addHorizontal(state, [startId, endId], { source: 'inference', autoSolve: true });
            } else if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
                ConstraintManager.addVertical(state, [startId, endId], { source: 'inference', autoSolve: true });
            } else if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
                const target = activeInf.targetId || null;
                if (target) {
                    ConstraintManager.addPerpendicular(state, newShapeId, target, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
                const target = activeInf.targetId || null;
                if (target) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.TANGENT) {
                const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
                if (target) {
                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { source: 'inference', autoSolve: true });
                }
            } else if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
                const target = activeInf.targetId || null;
                if (target) {
                    const targetShape = state.shapes.find(s => s && s.id === target);
                    if (targetShape && targetShape.joints && targetShape.joints.length >= 2) {
                        const [j0, j1] = targetShape.joints;
                        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { source: 'inference', autoSolve: true });
                    }
                }
            }
        }
    }catch(_){ }
}

function canApplyLineInference(state, startId, endId, newShapeId, activeInf) {
    if (!activeInf) return false;
    if (activeInf.type === INFERENCE_TYPES.HORIZONTAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.HORIZONTAL, { joints: [startId, endId] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.VERTICAL) {
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.VERTICAL, { joints: [startId, endId] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PERPENDICULAR) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PERPENDICULAR, { shapes: [newShapeId, target] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.PARALLEL) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [newShapeId, target] }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.TANGENT) {
        const target = activeInf.targetId || (activeInf.refCircle && activeInf.refCircle.id) || null;
        if (!target) return false;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: newShapeId, circle: target }, { full: true }).ok;
    }
    if (activeInf.type === INFERENCE_TYPES.MIDPOINT) {
        const target = activeInf.targetId || null;
        if (!target) return false;
        const targetShape = state.shapes.find(s => s && s.id === target);
        if (!targetShape || !targetShape.joints || targetShape.joints.length < 2) return false;
        const [j0, j1] = targetShape.joints;
        return ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [j0, j1, endId] }, { full: true }).ok;
    }
    return true;
}

export function setupLineTool(svg, state) {
    setupNumericInput(svg, state);
    state.onDrawCancelled(() => closeLineBoxes());   // another tool picked / Undo mid-draw: the boxes go with the draw
    setupDimensionListeners(state, TOOL_MODES.LINE, {
        guard: (detail) => detail.mode === 'dual' && detail.kind === 'line',
        onPreview: (detail) => {
            if (detail.reset && detail.reset[0]) { lineState.lockedLength = null; lineState.lengthExpression = null; lineState.lengthName = null; lineState.lengthAssign = null; }
            else if (detail.typed[0]) {
                lineState.lockedLength = detail.width > 0 ? detail.width : null;
                lineState.lengthExpression = lineState.lockedLength !== null ? liveExpression(detail, 0) : null;
                lineState.lengthName = lineState.lockedLength !== null ? liveName(detail, 0) : null;
                lineState.lengthAssign = lineState.lockedLength !== null ? liveAssign(detail, 0) : null;
            }   // only a TYPED field locks; the other shows the live cursor value
            if (detail.reset && detail.reset[1]) { lineState.lockedAngle = null; lineState.angleAssign = null; }
            else if (detail.typed[1]) { lineState.lockedAngle = Number.isFinite(detail.height) ? detail.height : null; lineState.angleAssign = lineState.lockedAngle !== null ? liveAssign(detail, 1) : null; }
            redrawLinePreview(state);
        },
        onApply: (detail) => {
            if (detail.confirmedBy !== 'enter') return;
            if (detail.typed[0]) {
                lineState.lockedLength = detail.width > 0 ? detail.width : null;
                lineState.lengthExpression = lineState.lockedLength !== null ? liveExpression(detail, 0) : null;
                lineState.lengthName = lineState.lockedLength !== null ? liveName(detail, 0) : null;
                lineState.lengthAssign = lineState.lockedLength !== null ? liveAssign(detail, 0) : null;
            }
            if (detail.typed[1]) { lineState.lockedAngle = Number.isFinite(detail.height) ? detail.height : null; lineState.angleAssign = lineState.lockedAngle !== null ? liveAssign(detail, 1) : null; }
            const spt = startOf(state);
            if (!spt) return;
            const end = lockedEnd(spt, live.cursor || spt);
            if (!(Math.hypot(end.x - spt.x, end.y - spt.y) > MIN_LEN)) { detail.keepOpen = true; return; }   // no length yet (cursor still on the start, none typed): the boxes stay open
            redrawLinePreview(state);
            try { finalizeLineFromActive(svg, state); } catch (err) { console.error('[line-tool] Enter finalize error:', err); }
            detail.keepOpen = true;   // the next segment of the chain has its boxes (opened by finalize), or the draw ended and hid them
        }
    });   // Esc inside the boxes is the canvas Esc (input-manager handleEscape)
}

export function handleLineKeyDown(e, svg, state) {
    dbg.log('line-tool', '[DEBUG LINE] KeyDown:', e.key);
    if (state.currentTool !== TOOL_MODES.LINE) return false;
    if (!state.active || !state.active.start) return false;

    // Enter: end the polyline chain, keeping only segments that were already
    // committed by clicks. The current preview segment (the rubber-band from
    // the last click to the cursor) is DISCARDED — same as Escape but more
    // ergonomic to reach for. deactivateLineTool removes a floating start
    // joint (a first click with no segment yet).
    if (matchesShortcut(e, 'line.finish')) {
        try { finishLineChain(state); } catch (err) { console.error('[line-tool] Enter deactivate error:', err); }
        return true;
    }

    return false;
}

export function resetLineState(state) {
    if(state){ state.continueFrom = null; state.polylineOrigin = null; }
    justCreatedActive = false;
    lastLineCommitTime = 0;
    pendingStepSnapshot = null;
    closeLineBoxes();
    resetToolState(state, TOOL_MODES.LINE, localState);
}

export function handleLinePointerDown(e, svg, state, hitSnap, w) {
    console.log('[DEBUG line-tool] handleLinePointerDown', { 
        hitSnap: hitSnap ? { type: hitSnap.type, targetId: hitSnap.targetId, pt: hitSnap.pt, isLocked: hitSnap.isLocked } : null,
        hasActive: !!state.active,
        activeStart: state.active?.start,
        w 
    });
    if (state.active && state.active.start) { ensureSegmentStep(state); return true; }

    if (state.continueFrom) {
        ensureSegmentStep(state);
        const prevId = state.continueFrom;
        const prevPt = state.joints.get(prevId) || { x: 0, y: 0 };

        state.active = {   // TASK 1045: the chain goes on from that point, shared (continueChain's rule)
            mode: TOOL_MODES.LINE,
            start: prevId,
            startPt: { x: prevPt.x, y: prevPt.y },
            preview: null,
            polylineOrigin: state.polylineOrigin
        };
        state.continueFrom = null;
        justCreatedActive = true;
        return true;
    }
    pendingStepSnapshot = null;
    state.beginDrawStep();
    const startPt = hitSnap ? hitSnap.pt : w;

    // TASK 1045: the start is ALWAYS a new point, joined to what the first click hit when the segment is committed (joinSegment: an existing curve end
    // point shared; a circle centre, a lone point, the origin glued by a Coincident; Fusion measured 2026-11-27: a line from the origin is a separate
    // point + Coincident). It used to BE any joint hit, the origin included.
    state.active = { mode: TOOL_MODES.LINE, start: null, startPt: startPt, preview: null, polylineOrigin: null, _tempStart: true, startSnapTarget: hitSnap };

    justCreatedActive = true;
    // Reset per-call drag flag so `justCreatedActive` semantics are deterministic
    // (prevents leakage from other tests that may modify module-level localState).
    localState.isDragging = false;
    localState.dragStartScreen = { x: e.clientX, y: e.clientY };
    return true;
}

export function handleLinePointerMove(e, svg, state, w) {
    live.screen = { x: e.clientX, y: e.clientY };
    if (localState.dragStartScreen && state.active) {
        if (checkDragThreshold(e, localState.dragStartScreen, SNAP.DRAG_THRESHOLD || 2)) localState.isDragging = true;
    }
    if (state.active && state.active.mode === TOOL_MODES.LINE) {
        if (SNAP_DEBUG && state.snapTarget) {
            dbg.log('snap', '[SNAP CHECK]', {
                type: state.snapTarget.type,
                targetId: state.snapTarget.targetId,
                hasPt: !!state.snapTarget.pt,
                pt: state.snapTarget.pt
            });
        }
        const rawPreviewPt = state.snapTarget 
            ? (state.snapTarget.pt || { x: state.snapTarget.x, y: state.snapTarget.y })
            : w;

        let previewPt = rawPreviewPt;
        
        live.cursor = rawPreviewPt;
        if (lineState.lockedAngle !== null) {   // a typed angle holds (the length still follows the cursor unless typed); no inference then
            const spt = startOf(state);
            if (spt) previewPt = lockedEnd(spt, rawPreviewPt);
            state.activeInference = null; state.inference = null;
        } else {
            try {
                const spt = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
                const inf = findInference(spt, rawPreviewPt, state.shapes, state.joints, state.snapTarget);
                if (inf) {
                    const startId = state.active.start || 'temp_start';
                    const previewEndId = 'temp_end';
                    const previewShapeId = 'temp_line';
                    const infState = { type: inf.type, pos: inf.pos || inf.pt || null, targetId: inf.targetId || (inf.refLine && inf.refLine.id) || null, refCircle: inf.refCircle };
                    if (canPreviewLineInference(state, startId, previewEndId, previewShapeId, infState)) {
                        state.activeInference = infState;
                        state.inference = state.activeInference;
                    } else {
                        state.activeInference = null;
                        state.inference = null;
                    }
                } else { state.activeInference = null; state.inference = null; }
                if (state.activeInference && state.activeInference.pos) previewPt = state.activeInference.pos;
            } catch (_) { state.activeInference = null; state.inference = null; }
            const lenStart = startOf(state);
            if (lineState.lockedLength !== null && lenStart) previewPt = lockedEnd(lenStart, previewPt);   // a typed length alone runs along the inferred (or cursor) direction
        }

        safeUpdatePreview(state, 'line', [state.active.start], previewPt, { lockedLength: lineState.lockedLength || undefined });
        if (live.boxOpen) {   // the boxes follow the cursor and show the length / angle it would have (until typed)
            const spt = startOf(state);
            if (spt) followCreationBoxes(e, [Math.hypot(previewPt.x - spt.x, previewPt.y - spt.y), cursorBoxAngle(previewPt.x - spt.x, previewPt.y - spt.y)]);
        }
    }
    return true;
}

export function handleLinePointerUp(e, svg, state, hitSnap, w, wasDragging) {
    console.log('[DEBUG line-tool] handleLinePointerUp', { 
        hasActive: !!state.active, 
        activeMode: state.active?.mode,
        activeStart: state.active?.start,
        tempStart: state.active?._tempStart,
        justCreatedActive,
        isDragging: localState.isDragging,
        timeSinceLastCommit: Date.now() - lastLineCommitTime
    });
    if (!state.active || state.active.mode !== TOOL_MODES.LINE) return false;

    const now = Date.now();
    // Allow immediate pointerUp when we just created an active start (click -> temp start)
    // or when the active is a temporary start. This prevents the module-level debounce
    // from blocking the test/UX case that confirms a click should create the start joint.
    // Only debounce a pointerUp that lands back at (near enough to be a duplicate release of)
    // the segment's own start point -- a click at a genuinely different location is a new,
    // deliberate polyline point and must go through regardless of how soon it follows the last
    // commit (live-driven triangle repro: clicks under ~500ms apart were silently dropped here).
    const debounceAnchor = state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null));
    const nearDebounceAnchor = debounceAnchor ? (Math.hypot(w.x - debounceAnchor.x, w.y - debounceAnchor.y) < 0.05) : true;
    if (now - lastLineCommitTime < LINE_POINTERUP_DEBOUNCE_MS && nearDebounceAnchor && !(justCreatedActive || (state.active && state.active._tempStart))) {
        dbg.log('line-tool', '[line-tool] pointerUp debounced', { delta: now - lastLineCommitTime });
        return true;
    }

    if ((justCreatedActive || (state.active && state.active._tempStart)) && !localState.isDragging) {
        // Click vs drag compares raw screen pointer movement since pointerdown against SNAP.DRAG_THRESHOLD
        // (never raw release vs snapped startPt, so clicking a few px off a joint still starts at that joint).
        const movedSinceStart = checkDragThreshold(e, localState.dragStartScreen, SNAP.DRAG_THRESHOLD || 2);

        justCreatedActive = false;
        localState.dragStartScreen = null;

        // a press on an existing POINT released elsewhere draws the segment at once (as when the start used to BE that point); otherwise the release
        // of the first press only places the start
        const pressedOnPoint = !!(state.active && state.active.startSnapTarget && state.active.startSnapTarget.type === 'joint');
        if (state.active && state.active._tempStart && !(movedSinceStart && pressedOnPoint)) {
            const startId = state.genJ();
            const sp = state.active.startPt || { x: 0, y: 0 };
            state.joints.set(startId, { x: sp.x, y: sp.y, fixed: false });
            state.active.start = startId;
            state.active.polylineOrigin = startId;
            state.polylineOrigin = startId;
            // Consumed: clear the flag (mirrors arc-tool.js) so the NEXT pointerUp falls through to real
            // segment creation instead of re-entering this "place start" branch forever.
            state.active._tempStart = false;
            // This pointerup was the click that created the start joint; do not finalize a line now.
            openLineBoxes(e);   // TASK 597: length and angle show now, after the first click
            return true;
        }

        // If the pointerUp is essentially at the same point as the start, treat it as a click (no end created).
        if (!movedSinceStart) { openLineBoxes(e); return true; }   // TASK 597: the first click on an existing point: the boxes show now
        // Otherwise fall through and allow the normal pointerUp logic to create the end joint
        // (this covers the UX case: click to start on an existing joint, then release elsewhere to create a line).
    }

    dbg.log('line-tool', '[line-tool] pointerUp entry', { hitSnap, activeSnap: state.activeSnap, wasDragging });
    // Ensure the start joint exists before creating the end joint. On drag releases
    // where the user started on an empty canvas, creating the end first could lead
    // to two distinct joints at the same coordinates. Create the start now so the
    // end joint's 'nearby' check can coalesce to it when appropriate.
    let startId = state.active.start;
    if (!startId) {
        startId = state.genJ();
        const sp = state.active.startPt || (state.active.preview && state.active.preview.pt) || w;
        state.joints.set(startId, { x: sp.x, y: sp.y, fixed: false });
        state.active.start = startId;
        state.active.polylineOrigin = startId;
        state.polylineOrigin = startId;
    }

    const snap = state.activeSnap || hitSnap;
    const typedLock = hasLock();   // a typed length / angle holds the segment (a click places it along the cursor)
    const clickPt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
    const startForLock = startOf(state);
    const endPt = (typedLock && startForLock) ? lockedEnd(startForLock, clickPt) : clickPt;
    const before = state.captureUndoSnapshot();   // TASK 1028 (B-08): the document before this segment (a refused typed length puts it back)
    const endId = state.genJ();
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    dbg.log('line-tool', '[line-tool] created end joint', { endId, endPt });

    // Abort zero-length segments (prevents tiny stub at start when click jitter occurs)
    const startPt = state.active.startPt || state.joints.get(startId) || { x: 0, y: 0 };
    const segLen = Math.hypot((endPt.x - startPt.x), (endPt.y - startPt.y));
    if (segLen < MIN_LEN) {
        state.joints.delete(endId);
        abortLine(state);
        justCreatedActive = false;
        localState.dragStartScreen = null;
        return true;
    }

    state.saveState();
    // startId has already been created above if missing — reuse the variable
    // (avoids creating duplicate joints when dragging the start on empty canvas).

    const newShapeId = mintShapeId('s');   // THE shape-id generator (#core/shape-id.js)
    const seg = { id: newShapeId, type: 'line', joints: [startId, endId], isConstruction: !!state.isConstructionMode };
    state.shapes.push(seg);
    const refused = joinSegment(state, seg, state.active.startSnapTarget, typedLock ? null : hitSnap);
    if (refused) { refuseSegment(state, before, refused); return true; }
    lastLineCommitTime = Date.now();

    lineState.lockedLength = null;
    lineState.lockedAngle = null;
    lineState.lengthExpression = null;
    lineState.lengthName = null;
    lineState.lengthAssign = null;
    lineState.angleAssign = null;

    applyLineInference(state, state.activeInference || state.inference || null, seg.joints[0], seg.joints[1], newShapeId);

    if(state.previewConstraint){
        const idx = state.constraints.indexOf(state.previewConstraint);
        if(idx >= 0) state.constraints.splice(idx,1);
        state.previewConstraint = null;
    }
    state.inference = null; state.activeInference = null;   // the next segment infers afresh
    endSegmentStep(state);
    continueChain(state, seg, w);
    justCreatedActive = false;
    openLineBoxes(e);   // TASK 597: the next segment of the chain has its boxes at once
    localState.dragStartScreen = null;

    return true;
}

/** TASK 1045: the chain goes on FROM the segment's end point: the next segment STARTS ON IT, one point shared by both (Fusion measured 2026-11-27:
 *  a Line chain's consecutive segments share their point; it used to be a new start joint + a coincident). */
function continueChain(state, seg, fallbackPt) {
    const endId = seg.joints[1], ep = state.joints.get(endId);
    state.active = {
        mode: TOOL_MODES.LINE,
        start: endId,
        startPt: ep ? { x: ep.x, y: ep.y } : (state.active.startPt || { x: 0, y: 0 }),
        preview: { type: 'line', pt: ep ? { x: ep.x, y: ep.y } : fallbackPt },
        polylineOrigin: state.polylineOrigin || endId
    };
}

/**
 * Finalize the currently active line segment programmatically.
 * Used by the Enter in the length / angle boxes to create the segment and start the next one.
 */
export function finalizeLineFromActive(svg, state) {
    dbg.log('line-tool', '[DEBUG LINE] Finalizing line. Locked:', lineState);
    if (!state || !state.active || state.active.mode !== TOOL_MODES.LINE) return false;
    ensureSegmentStep(state);
    const typedLock = hasLock();   // TASK 1033 (X-01): as the click: a typed length / angle positions the end, so the shown snap is dropped

    const endPt = (state.active.preview && state.active.preview.pt) ? state.active.preview.pt : (state.tempMousePos || state.active.startPt || { x: 0, y: 0 });
    const before = state.captureUndoSnapshot();   // TASK 1028 (B-08): the document before this segment (a refused typed length puts it back)
    const endId = state.genJ();   // TASK 1028 (B-06): a new end joint, merged by the click's rule below (mergeEndWithNearby), never an existing joint 0.5 mm away
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });

    let startId = state.active.start;
    if(!startId){
        startId = state.genJ();
        const sp = state.active.startPt || state.active.preview.pt || endPt;
        state.joints.set(startId, { x: sp.x, y: sp.y, fixed: false });
        state.active.start = startId; state.active.polylineOrigin = startId; state.polylineOrigin = startId;
    }

    // Abort zero-length segments (prevents tiny stub when finalize is triggered without movement)
    const spt = state.joints.get(startId) || { x: 0, y: 0 };
    const segLen = Math.hypot((endPt.x - spt.x), (endPt.y - spt.y));
    if (segLen < MIN_LEN) {
        state.joints.delete(endId);
        abortLine(state);
        justCreatedActive = false;
        localState.dragStartScreen = null;
        return true;
    }

    const newShapeId = mintShapeId('s');   // THE shape-id generator (#core/shape-id.js)
    const seg = { id: newShapeId, type: 'line', joints: [startId, endId], isConstruction: !!state.isConstructionMode };
    state.shapes.push(seg);

    const refused = joinSegment(state, seg, state.active && state.active.startSnapTarget, typedLock ? null : shownSnap(state));
    if (refused) { refuseSegment(state, before, refused); return false; }

    lineState.lockedLength = null;
    lineState.lockedAngle = null;
    lineState.lengthExpression = null;
    lineState.lengthName = null;
    lineState.lengthAssign = null;
    lineState.angleAssign = null;

    applyLineInference(state, state.activeInference || state.inference || null, seg.joints[0], seg.joints[1], newShapeId);

    state.inference = null; state.activeInference = null;   // the next segment infers afresh
    endSegmentStep(state);
    continueChain(state, seg, endPt);
    justCreatedActive = false;
    if (live.screen) openLineBoxes({ clientX: live.screen.x, clientY: live.screen.y });   // TASK 597: the next segment of the chain has its boxes at once
    localState.dragStartScreen = null;

    return true;
}

// Deactivate/Cleanup the line tool: remove a floating start joint and any constraint naming it
export function deactivateLineTool(state) {
    try{
        if(!state) return;
        pendingStepSnapshot = null;
        closeLineBoxes();   // the length / angle boxes go with the chain (Esc, Enter with no length, another tool)
        if(!state.active || state.active.mode !== TOOL_MODES.LINE){
            state.active = null; state.continueFrom = null; state.polylineOrigin = null; return;
        }

        // TASK 1045: only a FLOATING start (the first click's new point, no segment made from it yet) goes, with any constraint naming it; a chain's
        // start is the last segment's shared end point and stays with everything on it
        const curStart = state.active.start;
        const used = !!curStart && state.shapes && state.shapes.some(s => s.joints && s.joints.includes(curStart));
        if(curStart && !used){
            if(state.constraints){
                for(let i = state.constraints.length - 1; i >= 0; i--) {
                    const c = state.constraints[i];
                    if(c && c.joints && c.joints.includes(curStart)) state.constraints.splice(i,1);
                }
            }
            if(state.joints && state.joints.has(curStart)) state.joints.delete(curStart);
        }

        state.active = null;
        state.continueFrom = null;
        state.polylineOrigin = null;

        try{ clearHover(state); }catch(_){ }
    }catch(_){ }
}