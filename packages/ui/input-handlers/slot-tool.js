// Slot tool (TASK 673) — supports Fusion 360's five slot types using real lines and makeArc; a TYPED width is its diameter width dim (TASK 1049).
import { TOOL_MODES, SLOT_MODES, CONSTRAINT_TYPES, INFERENCE_TYPES } from '#core/constants.js';
import { findInference } from '#core/inference-engine.js';
import { addConstraint } from '#core/constraints.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { circumcenter3Pt, arcSweepFor3Pt } from '#core/geometry.js';   // TASK 1022: THE 3-point circle (shared with the Arc tool's 3-Point mode)
import {
    arcAngleSpan,
    perpDistToLine,
    arcWidthFromPoint,
    clampStraightSlotWidth,
    clampArcSlotWidth,
    computeStraightSlotPoints,
    computeArcSlotPoints,
    makeSlotCenterToCenter,
    makeSlotOverall,
    makeSlotCenterPoint,
    makeSlotThreePointArc,
    makeSlotCenterPointArc,
} from '#core/slot.js';
import { clearPreview } from '#ui/preview-manager.js';
import { hideInput, isInputActive, showSingleInput } from '#ui/numeric-input-manager.js';
import { worldToScreen } from '#ui/coords.js';
import {
    checkDragThreshold,
    resetToolState,
    safeUpdatePreview,
    setupDimensionListeners,
    openCreationBoxes,
    followCreationBoxes,
    applyLockedSnap,
    shownSnap,
    liveExpression,
    liveName,
    liveAssign,
    applyLiveAssign,
} from '#ui/input-handlers/base-tool.js';
import { applyLineInference } from '#ui/input-handlers/line-tool.js';   // R1-08: the Line tool's ONE inference apply
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there

const MIN_SPAN = 0.1;
const ARC_LOCK_ANGLE = 0.15;
const FIELD_SPAN = 'slot-span';
const FIELD_ARC = 'slot-arc';
const FIELD_WIDTH = 'slot-width';

const localState = {
    isDragging: false,
    dragStartScreen: null,
    boxOpen: false,
    lockedSpan: null,
    spanExpression: null,   // TASK 876 / 1013: the formula / name / assign of the typed span
    spanName: null,
    spanAssign: null,
    lockedWidth: null,
    widthTyped: false,      // TASK 1049 (audit 1037 D-6): the width was TYPED (it becomes the slot's width dimension); Enter on the shown width locks it, untyped
    widthExpression: null,  // TASK 1013 (B-19c): the formula / name / assign of the typed width
    widthName: null,
    widthAssign: null,
    cursor: null,
    arcSweep: null,
    lastArcSpan: 0,
};

function isArcMode(mode) {
    return mode === SLOT_MODES.THREE_POINT_ARC || mode === SLOT_MODES.CENTER_POINT_ARC;
}

function getSlotMode(state) {
    return (state && state.slotMode) || SLOT_MODES.CENTER_TO_CENTER;
}

function snapPoint(snap, fallback) {
    return (snap && snap.isLocked && snap.pt) ? { x: snap.pt.x, y: snap.pt.y } : { x: fallback.x, y: fallback.y };
}

// TASK 782: the span box is the slot's FULL centre-to-centre length in every straight mode. The centre-point slot's first click is the middle of the
// slot and the second click one end's centre, so its length is twice the click-to-click distance: `spanFactor` is that 2 (1 elsewhere), and the box, a typed
// length and the dimension a typed length keeps all go through it.
const spanFactor = (mode) => (mode === SLOT_MODES.CENTER_POINT ? 2 : 1);
const spanLength = (mode, p1, pt) => Math.hypot(pt.x - p1.x, pt.y - p1.y) * spanFactor(mode);

// R1-08: a straight slot's centreline infers Horizontal / Vertical like the Line tool does (the Line tool's findInference); clicked and typed spans alike.
// The inferred end: the cursor moved onto the axis through p1. null: no H / V inferred (or an arc slot).
function spanInference(state, p1, pt, mode) {
    if (isArcMode(mode) || !p1 || !pt) return null;
    const inf = findInference(p1, pt, state.shapes, state.joints, state.snapTarget);
    return inf && (inf.type === INFERENCE_TYPES.HORIZONTAL || inf.type === INFERENCE_TYPES.VERTICAL) ? inf : null;
}

function resolveSpanEnd(state, p1, pt, mode) {
    if (!p1 || !pt) return pt;
    const inf = spanInference(state, p1, pt, mode);
    if (inf && inf.pos) pt = inf.pos;
    if (!(localState.lockedSpan > MIN_SPAN)) return pt;
    const reach = localState.lockedSpan / spanFactor(mode);
    const dx = pt.x - p1.x, dy = pt.y - p1.y;
    const d = Math.hypot(dx, dy);
    const ux = d > 1e-6 ? dx / d : 1;
    const uy = d > 1e-6 ? dy / d : 0;
    return { x: p1.x + ux * reach, y: p1.y + uy * reach };
}

function defaultWidthForSpan(span) {
    return Math.max(0.4, Math.min(20, span * 0.28));
}

function currentStraightGeom(mode, p1, p2, cursorPt) {
    const rawSpan = p1 && p2 ? Math.hypot(p2.x - p1.x, p2.y - p1.y) : 0;
    if (!(rawSpan > MIN_SPAN)) return null;
    const cursorW = cursorPt ? perpDistToLine(p1, p2, cursorPt) * 2 : 0;
    const reqW = (localState.lockedWidth && localState.lockedWidth > 0)
        ? localState.lockedWidth
        : (cursorW > 0.1 ? cursorW : defaultWidthForSpan(rawSpan));
    return computeStraightSlotPoints({ mode, p1, p2, width: clampStraightSlotWidth(mode, rawSpan, reqW) });
}

function updateCenterPointArcSweep(center, c1, cursorPt) {
    const r = Math.hypot(c1.x - center.x, c1.y - center.y);
    if (!(r > MIN_SPAN) || !cursorPt) return true;
    const a1 = Math.atan2(c1.y - center.y, c1.x - center.x);
    const a2 = Math.atan2(cursorPt.y - center.y, cursorPt.x - center.x);
    let diff = Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1));
    if (localState.arcSweep === null) {
        localState.arcSweep = diff >= 0;
    } else if (Math.abs(diff) < ARC_LOCK_ANGLE && Math.abs(localState.lastArcSpan) > ARC_LOCK_ANGLE * 2) {
        // Flip only when pointer passes back through c1 after sweeping well away
        localState.arcSweep = diff >= 0;
    }
    const span = arcAngleSpan(center, c1, cursorPt, localState.arcSweep);
    localState.lastArcSpan = span;
    return localState.arcSweep;
}

function currentArcParams(active, cursorPt) {
    const mode = active.slotMode;
    if (mode === SLOT_MODES.THREE_POINT_ARC) {
        const c1 = active.picks[0] && active.picks[0].pt;
        const c2 = active.picks[1] && active.picks[1].pt;
        const p3 = active.picks[2] ? active.picks[2].pt : cursorPt;
        if (!c1 || !c2 || !p3) return null;
        const cc = circumcenter3Pt(c1, c2, p3);
        if (!cc) return { collinear: true, c1, c2, p3 };
        const sweep = arcSweepFor3Pt(cc.center, c1, c2, p3);
        return { center: cc.center, c1, c2, sweep, radius: cc.radius, p3 };
    }
    const center = active.picks[0] && active.picks[0].pt;
    const c1 = active.picks[1] && active.picks[1].pt;
    if (!center || !c1) return null;
    const r = Math.hypot(c1.x - center.x, c1.y - center.y);
    if (!(r > MIN_SPAN)) return null;
    if (active.picks[2] && active.arcData) return active.arcData;
    const p3 = cursorPt || c1;
    const sweep = updateCenterPointArcSweep(center, c1, p3);
    const d3 = Math.hypot(p3.x - center.x, p3.y - center.y);
    if (!(d3 > 1e-6)) return { incomplete: true, center, c1 };
    const c2 = {
        x: center.x + (p3.x - center.x) * (r / d3),
        y: center.y + (p3.y - center.y) * (r / d3),
    };
    if (Math.hypot(c2.x - c1.x, c2.y - c1.y) <= MIN_SPAN) return { incomplete: true, center, c1 };
    return { center, c1, c2, sweep, radius: r };
}

function currentArcGeom(active, cursorPt) {
    const arc = active.arcData || currentArcParams(active, cursorPt);
    if (!arc || arc.collinear || arc.incomplete) return null;
    const cursorW = cursorPt ? arcWidthFromPoint(arc.center, arc.radius, cursorPt) : 0;
    const reqW = (localState.lockedWidth && localState.lockedWidth > 0)
        ? localState.lockedWidth
        : (cursorW > 0.1 ? cursorW : defaultWidthForSpan(arc.radius));
    return computeArcSlotPoints({
        center: arc.center,
        c1: arc.c1,
        c2: arc.c2,
        sweep: arc.sweep,
        width: clampArcSlotWidth(arc.radius, reqW),
    });
}

function closeSlotBoxes() {
    if (localState.boxOpen) {
        hideInput();
    }
    localState.boxOpen = false;
    localState.lockedSpan = null;
    localState.spanExpression = null;
    localState.spanName = null;
    localState.spanAssign = null;
    localState.lockedWidth = null;
    localState.widthTyped = false;
    localState.widthExpression = null;
    localState.widthName = null;
    localState.widthAssign = null;
}

function openStepBox(eOrPt, svg, state, field, value, { initialKey = null } = {}) {
    let screenPt;
    if (eOrPt && Number.isFinite(eOrPt.clientX) && Number.isFinite(eOrPt.clientY)) {
        screenPt = eOrPt;
    } else {
        const sc = svg && eOrPt ? worldToScreen(svg, eOrPt) : { x: 200, y: 200 };
        screenPt = { clientX: sc.x, clientY: sc.y, pointerType: state.active && state.active.pointerType };
    }
    localState.boxOpen = true;
    if (initialKey) {
        showSingleInput(screenPt.clientX + 15, screenPt.clientY + 15, value, field, initialKey, true);
    } else {
        openCreationBoxes(screenPt, { single: { field } }, [Number.isFinite(value) ? value : 0]);
    }
}

function redrawPreview(state, cursorPt) {
    const active = state.active;
    if (!active || active.mode !== TOOL_MODES.SLOT) return;
    const mode = active.slotMode;
    const p1 = active.picks[0] && active.picks[0].pt;
    if (!p1) return;

    if (active.phase === 'span' || active.phase === 'span2') {
        const p2 = resolveSpanEnd(state, p1, cursorPt || p1, mode);
        let cl1 = p1, cl2 = p2;
        if (mode === SLOT_MODES.CENTER_POINT) {
            cl1 = { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
            cl2 = p2;
        }
        safeUpdatePreview(state, 'slot', [], p2, {
            slotMode: mode,
            phase: active.phase,
            cl1, cl2,
            centerPt: mode === SLOT_MODES.CENTER_POINT ? p1 : null,
            span: Math.hypot(cl2.x - cl1.x, cl2.y - cl1.y),
        });
        return;
    }

    if (active.phase === 'arc3') {
        const arc = currentArcParams(active, cursorPt || p1);
        safeUpdatePreview(state, 'slot', [], cursorPt || p1, {
            slotMode: mode,
            phase: 'arc3',
            arc,
        });
        return;
    }

    if (active.phase === 'width') {
        if (isArcMode(mode)) {
            const geom = currentArcGeom(active, cursorPt);
            safeUpdatePreview(state, 'slot', [], cursorPt || p1, {
                slotMode: mode,
                phase: 'width',
                arcGeom: geom,
            });
        } else {
            const p2 = active.picks[1] && active.picks[1].pt;
            const geom = currentStraightGeom(mode, p1, p2, cursorPt);
            safeUpdatePreview(state, 'slot', [], cursorPt || p2 || p1, {
                slotMode: mode,
                phase: 'width',
                straightGeom: geom,
            });
        }
    }
}

/** A new joint at `pt` (a slot point on an existing point is made coincident with it afterwards, by the snap: the way the Line tool does it). */
function allocJoint(state, pt) {
    const id = state.genJ();
    state.joints.set(id, { x: pt.x, y: pt.y, fixed: false });
    return id;
}

function commitSlot(svg, state, cursorPt) {
    const active = state.active;
    if (!active || active.mode !== TOOL_MODES.SLOT || active.phase !== 'width') return false;
    const mode = active.slotMode;
    const isConstruction = !!state.isConstructionMode;
    const p1Pick = active.picks[0];
    const p2Pick = active.picks[1];
    if (!p1Pick || !p2Pick) return false;

    let built = null;
    let snapsToApply = [];
    const cursor = cursorPt || localState.cursor || (active.picks[2] && active.picks[2].pt) || p2Pick.pt;
    const widthDimension = localState.widthTyped;   // TASK 1049 (audit 1037 D-6): only a typed width is a dimension (Fusion places none for a clicked one)

    if (isArcMode(mode)) {
        const geom = currentArcGeom(active, cursor);
        if (!geom) {
            resetSlotState(state);
            return false;
        }
        state.saveState('Create Slot');
        if (mode === SLOT_MODES.THREE_POINT_ARC) {
            const p3Pick = active.picks[2];
            const j1Id = allocJoint(state, p1Pick.pt);
            const j2Id = allocJoint(state, p2Pick.pt);
            const thirdSnap = p3Pick.snap;   // the arc point's snap: a POINT it was placed on is the arc's third joint (point-on-arc); a line / curve / axis only gave its position
            const thirdJointId = (thirdSnap && thirdSnap.isLocked && thirdSnap.type === 'joint') ? (thirdSnap.id || thirdSnap.targetId) : null;
            let thirdArg = p3Pick.pt;
            let bindThird = false;
            if (thirdJointId && state.joints.has(thirdJointId)) {
                thirdArg = thirdJointId;
                bindThird = true;
            }
            built = makeSlotThreePointArc(state.joints, j1Id, j2Id, thirdArg, geom.width, state.genJ, isConstruction, { bindThirdJoint: bindThird, widthDimension });
            snapsToApply.push([j1Id, p1Pick.snap]);
            snapsToApply.push([j2Id, p2Pick.snap]);
        } else {
            const jcmId = allocJoint(state, p1Pick.pt);
            const jc1Id = allocJoint(state, p2Pick.pt);
            const p3Pick = active.picks[2];
            const jc2Id = allocJoint(state, geom.c2);
            built = makeSlotCenterPointArc(state.joints, jcmId, jc1Id, jc2Id, geom.sweep, geom.width, state.genJ, isConstruction, { widthDimension });
            snapsToApply.push([jcmId, p1Pick.snap]);
            snapsToApply.push([jc1Id, p2Pick.snap]);
            if (p3Pick) snapsToApply.push([jc2Id, p3Pick.snap]);
        }
    } else {
        const geom = currentStraightGeom(mode, p1Pick.pt, p2Pick.pt, cursor);
        if (!geom) {
            resetSlotState(state);
            return false;
        }
        state.saveState('Create Slot');
        const j1Id = allocJoint(state, p1Pick.pt);
        const j2Id = allocJoint(state, p2Pick.pt);
        if (mode === SLOT_MODES.CENTER_TO_CENTER) {
            built = makeSlotCenterToCenter(state.joints, j1Id, j2Id, geom.width, state.genJ, isConstruction, { widthDimension });
        } else if (mode === SLOT_MODES.OVERALL) {
            built = makeSlotOverall(state.joints, j1Id, j2Id, geom.width, state.genJ, isConstruction, { widthDimension });
        } else {
            built = makeSlotCenterPoint(state.joints, j1Id, j2Id, geom.width, state.genJ, isConstruction, { widthDimension });
        }
        snapsToApply.push([j1Id, p1Pick.snap]);
        snapsToApply.push([j2Id, p2Pick.snap]);
    }

    if (!built || !built.shapes || built.shapes.length === 0) {
        state.endUndoGroup();
        resetSlotState(state);
        return false;
    }

    // TASK 1013 (B-19c): preserve typed width formula / name on the slot's width dimension (straight & arc modes; it exists for a typed width only)
    if (built.meta && built.meta.widthDim) {
        if (localState.widthAssign) applyLiveAssign(state, localState.widthAssign);
        if (localState.widthExpression && Math.abs(built.meta.widthDim.value - localState.lockedWidth) < 1e-4) {
            built.meta.widthDim.expression = localState.widthExpression;
        }
        if (localState.widthName) built.meta.widthDim.name = localState.widthName;
    }

    for (const s of built.shapes) state.shapes.push(s);
    for (const c of built.constraints) addConstraint(state, c.type, c);
    // TASK 1045: a slot point placed on an existing curve end point is SHARED with it: its joint id is that point's from here on (`live`)
    const sharedAs = new Map(snapsToApply.map(([jid, snap]) => [jid, applyLockedSnap(state, jid, snap)]));
    const live = (id) => sharedAs.get(id) || id;
    // R1-08: the centreline lies on the inferred Horizontal / Vertical: the constraint (the Line tool's apply)
    const centreJoints = mode === SLOT_MODES.OVERALL
        ? (built.meta && built.meta.t1Id && built.meta.t2Id ? [live(built.meta.t1Id), live(built.meta.t2Id)] : null)
        : (built.meta && !isArcMode(mode) && built.meta.c1Id && built.meta.c2Id ? [live(built.meta.c1Id), live(built.meta.c2Id)] : null);
    if (centreJoints && active.spanInference) applyLineInference(state, active.spanInference, centreJoints[0], centreJoints[1], null);
    // TASK 782 / 1013 (B-19c): a typed span length becomes a driving span dimension in ALL straight slot modes (C2C, Overall, Center-Point) and Center-Point Arc
    // (its radius). TASK 1028 (B-04): and the 3-point arc slot: its span box is the distance between its two end centres (resolveSpanEnd), so that distance.
    if (active.typedSpan > 0 && built.meta) {
        const spanJoints = mode === SLOT_MODES.OVERALL
            ? (built.meta.t1Id && built.meta.t2Id ? [live(built.meta.t1Id), live(built.meta.t2Id)] : null)
            : (mode !== SLOT_MODES.CENTER_POINT_ARC && built.meta.c1Id && built.meta.c2Id ? [live(built.meta.c1Id), live(built.meta.c2Id)] : null);
        if (spanJoints) {
            if (active.typedSpanAssign) applyLiveAssign(state, active.typedSpanAssign);
            ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                joints: spanJoints,
                value: active.typedSpan,
                expression: active.typedSpanExpression,
                ...(active.typedSpanName ? { name: active.typedSpanName } : {}),
            }, { source: 'slot' });
        } else if (mode === SLOT_MODES.CENTER_POINT_ARC && built.meta.ac) {
            if (active.typedSpanAssign) applyLiveAssign(state, active.typedSpanAssign);
            ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, {
                shape: built.meta.ac.id,
                isRadius: true,
                value: active.typedSpan,
                expression: active.typedSpanExpression,
                ...(active.typedSpanName ? { name: active.typedSpanName } : {}),
            }, { source: 'slot' });
        }
    }

    closeSlotBoxes();
    localState.isDragging = false;
    localState.dragStartScreen = null;
    localState.cursor = null;
    localState.arcSweep = null;
    localState.lastArcSpan = 0;
    clearPreview(state);
    state.active = null;
    state.endUndoGroup();
    if (state.engine && state.engine.solve) state.engine.solve();
    return true;
}

function advanceFromSpan(e, svg, state, endPt, snap) {
    const active = state.active;
    // TASK 1033 (S-1): a typed span positions the end (resolveSpanEnd): the snap it was clicked on is dropped, the rule of Rect / Arc / Polygon / Line
    active.picks[1] = { pt: { x: endPt.x, y: endPt.y }, snap: localState.lockedSpan === null ? (snap || null) : null };
    active.typedSpanExpression = localState.spanExpression;
    active.typedSpanName = localState.spanName;
    active.typedSpanAssign = localState.spanAssign;
    active.spanInference = spanInference(state, active.picks[0].pt, endPt, active.slotMode);   // R1-08: H / V the finished span lies on
    active.typedSpan = localState.lockedSpan;   // what was typed in the length box (null: the clicks set it): the dimension the slot keeps
    localState.lockedSpan = null;
    localState.spanExpression = null;
    localState.spanName = null;
    localState.spanAssign = null;
    localState.dragStartScreen = null;
    localState.isDragging = false;

    const cursor = localState.cursor || endPt;
    if (isArcMode(active.slotMode)) {
        active.phase = 'arc3';
        localState.arcSweep = null;
        localState.lastArcSpan = 0;
        redrawPreview(state, cursor);
        const r = Math.hypot(endPt.x - active.picks[0].pt.x, endPt.y - active.picks[0].pt.y);
        openStepBox(e || cursor, svg, state, FIELD_ARC, r);
    } else {
        active.phase = 'width';
        redrawPreview(state, cursor);
        const span = spanLength(active.slotMode, active.picks[0].pt, endPt);
        const initW = defaultWidthForSpan(span);
        openStepBox(e || cursor, svg, state, FIELD_WIDTH, initW);
    }
}

function advanceFromArc3(e, svg, state, pt, snap) {
    const active = state.active;
    const arc = currentArcParams(active, pt);
    if (!arc || arc.collinear || arc.incomplete) return false;
    active.arcData = arc;
    const thirdPt = (active.slotMode === SLOT_MODES.THREE_POINT_ARC) ? pt : (arc.c2 || pt);
    active.picks[2] = { pt: { x: thirdPt.x, y: thirdPt.y }, snap: snap || null };
    active.phase = 'width';
    localState.dragStartScreen = null;
    localState.isDragging = false;
    redrawPreview(state, localState.cursor || pt);
    openStepBox(e || pt, svg, state, FIELD_WIDTH, defaultWidthForSpan(arc.radius));
    return true;
}

export function setupSlotTool(svg, state) {
    if (typeof state.onDrawCancelled === 'function') {
        state.onDrawCancelled(() => {
            if (localState.boxOpen || (state.active && state.active.mode === TOOL_MODES.SLOT)) {
                resetSlotState(state);
            }
        });
    }
    setupDimensionListeners(state, TOOL_MODES.SLOT, {
        guard: (detail) => detail.mode === 'single' && (detail.field === FIELD_SPAN || detail.field === FIELD_ARC || detail.field === FIELD_WIDTH),
        onPreview: (detail) => {
            const active = state.active;
            if (!active) return;
            const v = detail.value;
            if (detail.field === FIELD_SPAN) {
                localState.lockedSpan = (detail.reset && detail.reset[0]) ? null : ((detail.typed[0] && v > MIN_SPAN) ? v : null);
                localState.spanExpression = localState.lockedSpan !== null ? liveExpression(detail, 0) : null;
                localState.spanName = localState.lockedSpan !== null ? liveName(detail, 0) : null;
                localState.spanAssign = localState.lockedSpan !== null ? liveAssign(detail, 0) : null;
            } else if (detail.field === FIELD_WIDTH) {
                localState.lockedWidth = (detail.reset && detail.reset[0]) ? null : ((detail.typed[0] && v > 0) ? v : null);
                localState.widthTyped = localState.lockedWidth !== null;
                localState.widthExpression = localState.lockedWidth !== null ? liveExpression(detail, 0) : null;
                localState.widthName = localState.lockedWidth !== null ? liveName(detail, 0) : null;
                localState.widthAssign = localState.lockedWidth !== null ? liveAssign(detail, 0) : null;
            }
            redrawPreview(state, localState.cursor || active.picks[0].pt);
        },
        onApply: (detail) => {
            if (detail.confirmedBy !== 'enter') return;
            const active = state.active;
            if (!active) return;
            const v = detail.value;
            if (active.phase === 'span' || active.phase === 'span2') {
                if (detail.typed[0] && v > MIN_SPAN) {
                    localState.lockedSpan = v;
                    localState.spanExpression = liveExpression(detail, 0);
                    localState.spanName = liveName(detail, 0);
                    localState.spanAssign = liveAssign(detail, 0);
                }   // TASK 782: only a TYPED length locks the span (and becomes a dimension), never the displayed rounding
                const p1 = active.picks[0].pt;
                const endPt = resolveSpanEnd(state, p1, localState.cursor || { x: p1.x + (localState.lockedSpan || 0) / spanFactor(active.slotMode), y: p1.y }, active.slotMode);
                if (!(Math.hypot(endPt.x - p1.x, endPt.y - p1.y) > MIN_SPAN)) {
                    detail.keepOpen = true;
                    return;
                }
                advanceFromSpan(null, svg, state, endPt, shownSnap(state));   // TASK 1033 (X-01): the snap the cursor shows, as the click
                detail.keepOpen = true;
            } else if (active.phase === 'arc3') {
                const cursor = localState.cursor || active.picks[1].pt;
                if (!advanceFromArc3(null, svg, state, cursor, shownSnap(state))) {   // TASK 1033 (X-01): as the click
                    detail.keepOpen = true;
                    return;
                }
                detail.keepOpen = true;
            } else if (active.phase === 'width') {
                localState.widthTyped = !!(detail.typed[0] && v > 0);
                if (localState.widthTyped) {
                    localState.lockedWidth = v;
                    localState.widthExpression = liveExpression(detail, 0);
                    localState.widthName = liveName(detail, 0);
                    localState.widthAssign = liveAssign(detail, 0);
                } else if (v > 0) {
                    localState.lockedWidth = v;
                }
                if (!commitSlot(svg, state, localState.cursor)) {
                    detail.keepOpen = true;
                }
            }
        },
        onCancel: () => {
            // Esc in the box also runs input-manager handleEscape -> resetDrawingState -> resetSlotState;
            // keep state.active intact until handleEscape sees it and switches cleanly to Select.
            localState.lockedSpan = null;
            localState.spanExpression = null;
            localState.spanName = null;
            localState.spanAssign = null;
            localState.lockedWidth = null;
            localState.widthTyped = false;
            localState.widthExpression = null;
            localState.widthName = null;
            localState.widthAssign = null;
        },
    });
}

export function resetSlotState(state) {
    closeSlotBoxes();
    localState.cursor = null;
    localState.arcSweep = null;
    localState.lastArcSpan = 0;
    resetToolState(state, TOOL_MODES.SLOT, localState);
}

export function isSlotActive(state) {
    return !!(state && state.active && state.active.mode === TOOL_MODES.SLOT && state.active.phase === 'width');
}

export function finishSlotStep(svg, state) {
    return commitSlot(svg, state, localState.cursor);
}

export function slotAnchorPoint(state) {
    const active = state && state.active;
    if (!active || active.mode !== TOOL_MODES.SLOT) return null;
    const p1 = active.picks && active.picks[0] && active.picks[0].pt;
    const p2 = active.picks && active.picks[1] && active.picks[1].pt;
    if (p1 && p2) return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return p1 || null;
}

export function handleSlotPointerDown(e, svg, state, hitSnap, w) {
    localState.dragStartScreen = { x: e.clientX, y: e.clientY };
    localState.isDragging = false;
    localState.cursor = { x: w.x, y: w.y };

    if (state.active && state.active.mode === TOOL_MODES.SLOT) {
        // Subsequent click while drawing: pointerUp handles placement / advance cleanly
        state.active.pointerType = e.pointerType;
        return true;
    }

    const mode = getSlotMode(state);
    const p1 = snapPoint(hitSnap, w);
    localState.lockedSpan = null;
    localState.spanExpression = null;
    localState.spanName = null;
    localState.spanAssign = null;
    localState.lockedWidth = null;
    localState.widthTyped = false;
    localState.widthExpression = null;
    localState.widthName = null;
    localState.widthAssign = null;
    localState.arcSweep = null;
    localState.lastArcSpan = 0;

    state.active = {
        mode: TOOL_MODES.SLOT,
        slotMode: mode,
        phase: isArcMode(mode) ? 'span2' : 'span',
        pointerType: e.pointerType,
        picks: [{ pt: p1, snap: (hitSnap && hitSnap.isLocked) ? hitSnap : null }],
        arcData: null,
        preview: null,
    };
    redrawPreview(state, p1);
    return true;
}

export function handleSlotPointerMove(e, svg, state, w) {
    const active = state.active;
    if (!active || active.mode !== TOOL_MODES.SLOT) return false;
    if (checkDragThreshold(e, localState.dragStartScreen)) localState.isDragging = true;

    const pt = (state.snapTarget && state.snapTarget.isLocked && state.snapTarget.pt)
        ? { x: state.snapTarget.pt.x, y: state.snapTarget.pt.y }
        : { x: w.x, y: w.y };
    localState.cursor = pt;
    redrawPreview(state, pt);

    if (localState.boxOpen) {
        const p1 = active.picks[0] && active.picks[0].pt;
        const p2 = active.picks[1] && active.picks[1].pt;
        if ((active.phase === 'span' || active.phase === 'span2') && p1) {
            const effP2 = resolveSpanEnd(state, p1, pt, active.slotMode);
            followCreationBoxes(e, [spanLength(active.slotMode, p1, effP2)]);
        } else if (active.phase === 'arc3') {
            const arc = currentArcParams(active, pt);
            if (arc && Number.isFinite(arc.radius)) followCreationBoxes(e, [arc.radius]);
        } else if (active.phase === 'width') {
            if (isArcMode(active.slotMode)) {
                const geom = currentArcGeom(active, pt);
                if (geom) followCreationBoxes(e, [geom.width]);
            } else if (p1 && p2) {
                const geom = currentStraightGeom(active.slotMode, p1, p2, pt);
                if (geom) followCreationBoxes(e, [geom.width]);
            }
        }
    }
    return true;
}

export function handleSlotPointerUp(e, svg, state, hitSnap, w) {
    const active = state.active;
    if (!active || active.mode !== TOOL_MODES.SLOT) return false;

    const snap = hitSnap || state.snapTarget || null;
    const rawPt = snapPoint(snap, w);
    localState.cursor = rawPt;

    if (active.phase === 'span' || active.phase === 'span2') {
        if (!localState.isDragging && !active.waitingNextClick) {
            // Click 1 released without dragging: stay on current phase waiting for click 2 + open live box
            active.waitingNextClick = true;
            localState.dragStartScreen = null;
            const p1 = active.picks[0].pt;
            openStepBox(e, svg, state, FIELD_SPAN, spanLength(active.slotMode, p1, rawPt));
            return true;
        }
        const p1 = active.picks[0].pt;
        const endPt = resolveSpanEnd(state, p1, rawPt, active.slotMode);
        if (!(Math.hypot(endPt.x - p1.x, endPt.y - p1.y) > MIN_SPAN)) {
            return true;
        }
        advanceFromSpan(e, svg, state, endPt, snap);
        return true;
    }

    if (active.phase === 'arc3') {
        advanceFromArc3(e, svg, state, rawPt, snap);
        return true;
    }

    if (active.phase === 'width') {
        return commitSlot(svg, state, rawPt);
    }

    return false;
}

export function handleSlotKeyDown(e, svg, state) {
    if (state.currentTool !== TOOL_MODES.SLOT || !state.active || state.active.mode !== TOOL_MODES.SLOT) return false;
    if (matchesShortcut(e, 'draw.typeValue') && !isInputActive()) {
        const active = state.active;
        const cursor = localState.cursor || active.picks[0].pt;
        const p1 = active.picks[0].pt;
        if (active.phase === 'span' || active.phase === 'span2') {
            openStepBox(cursor, svg, state, FIELD_SPAN, spanLength(active.slotMode, p1, cursor), { initialKey: e.key });
        } else if (active.phase === 'arc3') {
            const arc = currentArcParams(active, cursor);
            openStepBox(cursor, svg, state, FIELD_ARC, (arc && arc.radius) || 10, { initialKey: e.key });
        } else if (active.phase === 'width') {
            openStepBox(cursor, svg, state, FIELD_WIDTH, 10, { initialKey: e.key });
        }
        return true;
    }
    return false;
}
