// Rect tool - preview and creation
import { dbg } from '#core/debug.js';
import { TOOL_MODES, RECT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makeRectFromTwoJoints, makeRectFromCenter, makeRectFrom3Points } from '#core/shapes.js';
import { findNearbyJoint } from '#core/joints.js';
import { setupNumericInput, showDualInput, hideInput, resetLockedDimensions, isInputActive } from '#ui/numeric-input-manager.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { worldToScreen } from '#ui/coords.js';
import { checkDragThreshold, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, applyLockedSnap, shownSnap, snapPoint, tooSmall, liveExpression, liveName, liveAssign, applyLiveAssign } from '#ui/input-handlers/base-tool.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there

let rectState = { lockedWidth: null, lockedHeight: null, widthExpression: null, heightExpression: null, widthName: null, heightName: null, widthAssign: null, heightAssign: null, previewWidth: null, previewHeight: null };   // TASK 876 / 1013
const localState = { isDragging: false, dragStartScreen: null, boxes: false, cursor: null, screen: null };
// TASK 596: after the first click of a two-point rectangle the W x H boxes show at once (base-tool's shared creation-box path); the sides follow the cursor until typed
const BOX = { dual: { kind: 'rect', labels: ['W', 'H'], separator: '×', quantities: ['length', 'length'] } };
// TASK 1028 (B-03): the 3-point rectangle's boxes, the same shared path: its base LENGTH after the first click, then its HEIGHT once the base is placed.
// A typed length is the base side's dimension (rectState's width), a typed height the next side's (rectState's height).
const FIELD_3PT_LENGTH = 'rect3-length';
const FIELD_3PT_HEIGHT = 'rect3-height';
const BOX_3PT_LENGTH = { single: { field: FIELD_3PT_LENGTH } };
const BOX_3PT_HEIGHT = { single: { field: FIELD_3PT_HEIGHT } };

const rectModeOf = (state) => state.rectMode || RECT_MODES.TWO_POINT;
/** TASK 782: the two modes that show the W x H boxes from the first click (the 3-point rectangle has its own base / height boxes). */
const sizedMode = (mode) => mode === RECT_MODES.TWO_POINT || mode === RECT_MODES.CENTER;

/** The corner: the cursor, but a typed width / height holds its side (the other still follows the cursor). The first click is the corner's opposite in the
 *  two-point mode and the CENTRE in the centre mode, where each side runs both ways from it: a typed side is twice the corner's distance from the centre. */
function lockedCorner(c1, pt, centre = false) {
    const half = centre ? 0.5 : 1;
    const signX = pt.x - c1.x >= 0 ? 1 : -1, signY = pt.y - c1.y >= 0 ? 1 : -1;
    return { x: c1.x + (rectState.lockedWidth ? rectState.lockedWidth * half * signX : pt.x - c1.x), y: c1.y + (rectState.lockedHeight ? rectState.lockedHeight * half * signY : pt.y - c1.y) };
}
/** The two side lengths the rectangle has with `corner` as its second corner (the boxes show them, and the minimum-size rule reads them). */
const sideSizes = (c1, corner, centre) => [Math.abs(corner.x - c1.x) * (centre ? 2 : 1), Math.abs(corner.y - c1.y) * (centre ? 2 : 1)];
/** Where Enter places the corner: the last cursor point (else the preview's; TASK 1028, B-14: else the first click itself, a size of 0 the boxes keep open for),
 *  with the typed sides held. */
function enterCorner(state) {
    const rectMode = rectModeOf(state);
    const c1 = state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null));
    if (!c1) return null;
    const raw = localState.cursor || (state.active.preview && state.active.preview.pt) || c1;
    return { c1, corner: lockedCorner(c1, raw, rectMode === RECT_MODES.CENTER) };
}

/** TASK 1028 (B-03): the 3-point rectangle's base end: the cursor, or, with a typed length, the point at that length along the start -> cursor direction
 *  (+x while the cursor is on the start). */
function baseEnd(a, pt) {
    if (rectState.lockedWidth === null) return pt;
    const d = Math.hypot(pt.x - a.x, pt.y - a.y);
    const ux = d > 1e-9 ? (pt.x - a.x) / d : 1, uy = d > 1e-9 ? (pt.y - a.y) / d : 0;
    return { x: a.x + ux * rectState.lockedWidth, y: a.y + uy * rectState.lockedWidth };
}
/** The base a -> b's unit normal (core/shapes.js makeRectFrom3Points's), and the signed height of `pt` off the base. */
function baseNormal(a, b) { const len = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len }; }
const heightOf = (a, b, pt) => { const { nx, ny } = baseNormal(a, b); return (pt.x - a.x) * nx + (pt.y - a.y) * ny; };
/** The 3-point rectangle's third point: the cursor, or, with a typed height, the point at that height off the base on the cursor's side. */
function thirdPoint(a, b, pt) {
    if (rectState.lockedHeight === null) return pt;
    const { nx, ny } = baseNormal(a, b);
    const h = (heightOf(a, b, pt) >= 0 ? 1 : -1) * rectState.lockedHeight;
    return { x: b.x + nx * h, y: b.y + ny * h };
}

/** TASK 782: the typed sides become the rectangle's dimensions, ONCE each (one width on a horizontal side, one height on a vertical side: a rectangle's
 *  four sides used to carry four, two of them reference), by the click AND by Enter, in the two-point and the centre mode. A centre rectangle's
 *  construction diagonals are not axis-aligned, so they are never picked. TASK 1028 (B-03): a 3-point rectangle's typed length is its base side's
 *  (the first of makeRectFrom3Points's sides) and its typed height the next side's. */
function addTypedSideDimensions(state, rectResult, rectMode) {
    if (!rectState.lockedWidth && !rectState.lockedHeight) return;
    const lines = rectResult && rectResult.shapes ? rectResult.shapes : [];
    const TOL = 1e-6;
    const side = (horizontal) => lines.find((l) => {
        if (l.type !== 'line') return false;
        const a = state.joints.get(l.joints[0]), b = state.joints.get(l.joints[1]);
        if (!a || !b) return false;
        const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
        return horizontal ? dy < TOL && dx > TOL : dx < TOL && dy > TOL;
    });
    const three = rectMode === RECT_MODES.THREE_POINT;
    const w = rectState.lockedWidth && (three ? lines[0] : side(true)), h = rectState.lockedHeight && (three ? lines[1] : side(false));
    if (w) {
        if (rectState.widthAssign) applyLiveAssign(state, rectState.widthAssign);
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [w.joints[0], w.joints[1]], value: rectState.lockedWidth, expression: rectState.widthExpression, ...(rectState.widthName ? { name: rectState.widthName } : {}) }, { source: 'rect' });
    }
    if (h) {
        if (rectState.heightAssign) applyLiveAssign(state, rectState.heightAssign);
        ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [h.joints[0], h.joints[1]], value: rectState.lockedHeight, expression: rectState.heightExpression, ...(rectState.heightName ? { name: rectState.heightName } : {}) }, { source: 'rect' });
    }
}

/** What a box field typed for a side: only a TYPED field locks it (the box otherwise shows the live cursor size); an emptied / reset one unlocks it. */
function takeSide(side, detail, i, value) {
    const w = side === 'width';
    if (detail.reset && detail.reset[i]) {
        if (w) { rectState.lockedWidth = null; rectState.widthExpression = null; rectState.widthName = null; rectState.widthAssign = null; }
        else { rectState.lockedHeight = null; rectState.heightExpression = null; rectState.heightName = null; rectState.heightAssign = null; }
        return;
    }
    if (!detail.typed || !detail.typed[i]) return;
    const v = value > 0 ? value : null;
    const on = v !== null;
    if (w) { rectState.lockedWidth = v; rectState.widthExpression = on ? liveExpression(detail, i) : null; rectState.widthName = on ? liveName(detail, i) : null; rectState.widthAssign = on ? liveAssign(detail, i) : null; }
    else { rectState.lockedHeight = v; rectState.heightExpression = on ? liveExpression(detail, i) : null; rectState.heightName = on ? liveName(detail, i) : null; rectState.heightAssign = on ? liveAssign(detail, i) : null; }
}

/** The preview at the last cursor point with the typed sizes held (a typed value just changed). */
function redrawRectPreview(state) {
    const c1 = state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null));
    if (!c1) return;
    const rectMode = rectModeOf(state);
    if (rectMode === RECT_MODES.THREE_POINT) {
        const b = state.active.secondPt ? state.joints.get(state.active.secondPt) : null;
        const cur = localState.cursor || b || c1;
        safeUpdatePreview(state, 'rect', [state.active.start], b ? thirdPoint(c1, b, cur) : baseEnd(c1, cur), { mode: 'three-point' });
        return;
    }
    const centre = rectMode === RECT_MODES.CENTER;
    safeUpdatePreview(state, 'rect', [state.active.start], lockedCorner(c1, localState.cursor || c1, centre), { mode: centre ? 'center' : RECT_MODES.TWO_POINT });
}

/** Where a box opened without a pointer event (Enter placed the base) goes: where the pointer last was. */
const lastPointer = () => (localState.screen ? { clientX: localState.screen.x, clientY: localState.screen.y } : { clientX: 0, clientY: 0 });

export function setupRectTool(svg, state){
    setupNumericInput(svg, state);
    state.onDrawCancelled(() => { if (localState.boxes) closeRectBoxes(); });   // another tool picked / Undo mid-draw: the boxes go with the draw
    setupDimensionListeners(state, TOOL_MODES.RECT, {
        guard: (detail) => (detail.mode === 'dual' && detail.kind === 'rect') || (detail.mode === 'single' && (detail.field === FIELD_3PT_LENGTH || detail.field === FIELD_3PT_HEIGHT)),
        onApply: (detail) => {
            dbg.log('rect-tool', '[DEBUG RECT] liveDimensionApplied event:', { tool: state.currentTool, hasActive: !!state.active, detail });
            if (detail.confirmedBy !== 'enter') return;
            // a typed side is locked already (onPreview); Enter places what a click at the cursor would place: typed sizes exact, the others at the cursor
            if (rectModeOf(state) === RECT_MODES.THREE_POINT) {
                const a = state.active.startPt, b = state.active.secondPt ? state.joints.get(state.active.secondPt) : null;
                if (detail.field === FIELD_3PT_LENGTH && !b) {
                    const end = baseEnd(a, localState.cursor || a);
                    if (tooSmall(Math.hypot(end.x - a.x, end.y - a.y))) { detail.keepOpen = true; return; }   // no length yet: the box stays open
                    placeBase(state, end, rectState.lockedWidth !== null ? null : shownSnap(state), lastPointer());   // TASK 1033 (X-01): the click's snap rule
                    detail.keepOpen = true;   // the height box is up now
                } else if (detail.field === FIELD_3PT_HEIGHT && b) {
                    const p = thirdPoint(a, b, localState.cursor || b);
                    if (tooSmall(Math.abs(heightOf(a, b, p)))) { detail.keepOpen = true; return; }   // no height yet: the box stays open
                    placeRect(state, p, rectState.lockedHeight !== null ? null : shownSnap(state));
                }
                return;
            }
            const sized = enterCorner(state);
            if (!sized || tooSmall(...sideSizes(sized.c1, sized.corner, rectModeOf(state) === RECT_MODES.CENTER))) { detail.keepOpen = true; return; }   // no size yet (cursor still on the first click, none typed): the boxes stay open
            finalizeRectFromActive(svg, state);
        },
        onPreview: (detail) => {
            dbg.log('rect-tool', '[DEBUG RECT] liveDimensionPreview:', detail);
            if (detail.mode === 'dual') { takeSide('width', detail, 0, detail.width); takeSide('height', detail, 1, detail.height); }
            else takeSide(detail.field === FIELD_3PT_LENGTH ? 'width' : 'height', detail, 0, detail.value);
            redrawRectPreview(state);
        },
        onCancel: () => { rectState.lockedWidth = null; rectState.lockedHeight = null; rectState.widthExpression = null; rectState.heightExpression = null; rectState.widthName = null; rectState.heightName = null; rectState.widthAssign = null; rectState.heightAssign = null; } // Esc in the box also runs the canvas Esc (input-manager handleEscape)
    });
}

/** Apply all locked snap constraints recorded at rectangle click/drag points via the shared `applyLockedSnap` helper. */
function applyRectSnaps(state, pairs) {
    const placed = pairs.map(([jid]) => jid).filter(Boolean);
    for (const [jid, snap] of pairs) {
        if (!jid || !snap) continue;
        applyLockedSnap(state, jid, snap, placed.filter((id) => id !== jid));
    }
}

/** TASK 1028 (B-03): the 3-point rectangle's base is placed (its second point at `endPt`, `snap` = the locked snap it was placed on): the height box opens. */
function placeBase(state, endPt, snap, pos) {
    const endId = state.genJ();
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    state.saveState(); state.active.secondPt = endId; state.active.secondSnapTarget = snap; state.active.preview = { type: 'rect-3pt', pt: endPt };
    localState.boxes = true; localState.cursor = null;
    openCreationBoxes(pos, BOX_3PT_HEIGHT, [0]);
}

/**
 * TASK 1028 (B-02): THE placement of a rectangle, by a click AND by Enter (they used to be two copies, and Enter's re-ran findSnap on every corner of the
 * placed rectangle, binding a side that a typed size put on an axis to that axis: a click never did). `endPt` = the last corner (the 3-point rectangle's
 * third point), `endSnap` = the locked snap it was placed on (null when a typed size placed it). One undo step; the typed sizes become its dimensions.
 */
function placeRect(state, endPt, endSnap) {
    const rectMode = rectModeOf(state);
    state.saveState();
    const endId = state.genJ();
    state.joints.set(endId, { x: endPt.x, y: endPt.y, fixed: false });
    dbg.log('rect-tool', '[rect-tool] created corner', { endId, endPt });
    const three = rectMode === RECT_MODES.THREE_POINT;
    const rectResult = three ? makeRectFrom3Points(state.joints, state.active.start, state.active.secondPt, endId, state.genJ, state.isConstructionMode || false)
        : rectMode === RECT_MODES.CENTER ? makeRectFromCenter(state.joints, state.active.start, endId, state.genJ, state.isConstructionMode || false)
        : makeRectFromTwoJoints(state.joints, state.active.start, endId, state.genJ, state.isConstructionMode || false);
    if (rectResult && rectResult.shapes) rectResult.shapes.forEach((s) => state.shapes.push(s));
    if (rectResult && rectResult.constraints) rectResult.constraints.forEach((c) => ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' }));
    applyRectSnaps(state, three
        ? [[state.active.start, state.active.startSnapTarget], [state.active.secondPt, state.active.secondSnapTarget], [endId, endSnap]]
        : [[state.active.start, state.active.startSnapTarget], [endId, endSnap]]);
    const allCornerIds = [];
    if (rectResult && rectResult.shapes) rectResult.shapes.forEach((s) => { if (s && s.joints) s.joints.forEach((j) => allCornerIds.push(j)); });
    for (const cid of allCornerIds) {
        const jpt = state.joints.get(cid); if (!jpt) continue;
        const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01);
        if (nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' });
    }
    addTypedSideDimensions(state, rectResult, rectMode);
    closeRectBoxes();
    state.endUndoGroup(); state.active = null; localState.isDragging = false; localState.dragStartScreen = null;
    return true;
}

/**
 * Finalize rectangle creation using current preview (used when user presses Enter): the two-point / centre rectangle at the typed sides (else the cursor's).
 */
export function finalizeRectFromActive(svg, state){
    if(!state.active || state.active.mode !== TOOL_MODES.RECT || !sizedMode(rectModeOf(state))) return false;
    const sized = enterCorner(state);   // TASK 782: the typed sides hold at Enter whatever the mouse did since
    if(!sized || tooSmall(...sideSizes(sized.c1, sized.corner, rectModeOf(state) === RECT_MODES.CENTER))) return false;
    const hasLockedSide = rectState.lockedWidth !== null || rectState.lockedHeight !== null;
    return placeRect(state, sized.corner, hasLockedSide ? null : shownSnap(state));   // TASK 1033 (X-01): the snap the cursor shows, as the click
}
/** The W x H boxes and the sides typed in them go away (a rectangle was placed, or the tool was left). */
function closeRectBoxes(){ rectState.lockedWidth = null; rectState.lockedHeight = null; rectState.widthExpression = null; rectState.heightExpression = null; rectState.widthName = null; rectState.heightName = null; rectState.widthAssign = null; rectState.heightAssign = null; localState.boxes = false; localState.cursor = null; try{ hideInput(); }catch(_){ } }
export function resetRectState(state){ if(state && state.active && state.active.mode===TOOL_MODES.RECT){ closeRectBoxes(); state.active=null } }

export function handleRectPointerDown(e, svg, state, hitSnap, w){
		// If we're already in a 3-point rect and have the second point set, don't reset state.active.
		// This allows the third click to finalize the rectangle (click - click - click behavior).
		if (state.active && state.active.mode === TOOL_MODES.RECT && state.active.secondPt) {
			localState.dragStartScreen = { x: e.clientX, y: e.clientY };
			localState.isDragging = false;
			return true;
		}

		if (state.active && state.active.mode === TOOL_MODES.RECT && state.active.waitingForSecondClick) {
			localState.dragStartScreen = { x: e.clientX, y: e.clientY };
			localState.isDragging = false;
			return true;
		}
	dbg.log('rect-tool', '[rect-tool] pointerDown', { hitSnap, activeSnap: state.activeSnap, w });
	try{ state.beginDrawStep(); }catch(_){ }
	const snap = state.activeSnap || hitSnap;
	const startPt = (snap && snap.isLocked && snapPoint(snap)) || w;
	const startId = state.genJ();
	state.joints.set(startId, { x: startPt.x, y: startPt.y, fixed:false });
	state.active = { mode: TOOL_MODES.RECT, start: startId, startPt: startPt, preview: null, polylineOrigin: startId, _tempStart:true, waitingForSecondClick:false, secondPt:null, startSnapTarget: snap, secondSnapTarget: null };
	localState.dragStartScreen = { x: e.clientX, y: e.clientY };
	localState.isDragging = false;
	return true;
}

export function handleRectPointerMove(e, svg, state, w){
	if(!state.active || state.active.mode!==TOOL_MODES.RECT) return false;
	if (checkDragThreshold(e, localState.dragStartScreen)) localState.isDragging = true;
	const previewPt = (state.snapTarget && snapPoint(state.snapTarget)) || w;
	localState.cursor = previewPt;
	localState.screen = { x: e.clientX, y: e.clientY };
	if (isInputActive() && !localState.boxes) { followCreationBoxes(e, []); return true; }   // a box opened by a typed digit in the other rect modes: the preview waits for Enter
	const rectMode = rectModeOf(state);
	const c1 = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
	if (rectMode === RECT_MODES.THREE_POINT) {
		const b = state.active.secondPt ? state.joints.get(state.active.secondPt) : null;
		if (c1 && localState.boxes) followCreationBoxes(e, [b ? Math.abs(heightOf(c1, b, previewPt)) : Math.hypot(previewPt.x - c1.x, previewPt.y - c1.y)]);   // TASK 1028 (B-03): the box shows the live length / height
		safeUpdatePreview(state, 'rect', [state.active.start], c1 ? (b ? thirdPoint(c1, b, previewPt) : baseEnd(c1, previewPt)) : previewPt, { mode: 'three-point' });
	} else {
		const centre = rectMode === RECT_MODES.CENTER;
		let corner2 = previewPt;
		if (c1) {
			corner2 = lockedCorner(c1, previewPt, centre);
			if (localState.boxes) followCreationBoxes(e, sideSizes(c1, previewPt, centre));
		}
		safeUpdatePreview(state, 'rect', [state.active.start], corner2, centre ? { mode: 'center' } : { mode: 'two-point', lockedWidth: rectState.lockedWidth || undefined, lockedHeight: rectState.lockedHeight || undefined });
	}
	return true;
}

export function handleRectPointerUp(e, svg, state, hitSnap, w, wasDragging){
	if(!state.active || state.active.mode!==TOOL_MODES.RECT) return false;
	const rectMode = state.rectMode || RECT_MODES.TWO_POINT;
	const isDragging = localState.isDragging;
	// For THREE_POINT, CENTER, or TWO_POINT modes: on the very first click create a waiting state so the flow is click -> click
	if ((rectMode === RECT_MODES.THREE_POINT || sizedMode(rectMode)) && !isDragging && state.active && state.active._tempStart && !state.active.waitingForSecondClick && !state.active.secondPt) {
		state.active.waitingForSecondClick = true;
		localState.dragStartScreen = null;
		localState.isDragging = false;
		localState.boxes = true; localState.cursor = null; localState.screen = { x: e.clientX, y: e.clientY };
		openCreationBoxes(e, sizedMode(rectMode) ? BOX : BOX_3PT_LENGTH, sizedMode(rectMode) ? [0, 0] : [0]); // TASK 596: W and H show now, not after a typed digit (TASK 782: in the centre mode too; TASK 1028: the 3-point length)
		return true;
	}

	dbg.log('rect-tool', '[rect-tool] pointerUp entry', { snap: state.activeSnap || hitSnap, wasDragging });
	const snap = state.activeSnap || hitSnap;
	let endPt = (snap && snap.isLocked && snapPoint(snap)) || w;
	if (rectMode === RECT_MODES.THREE_POINT) {   // TASK 782: the base needs a length, then the rectangle a height; TASK 1028 (B-03): a typed one holds at the click
		const b0 = state.active.startPt, b1 = state.active.secondPt ? state.joints.get(state.active.secondPt) : null;
		if (!b1) {
			endPt = baseEnd(b0, endPt);
			if (tooSmall(Math.hypot(endPt.x - b0.x, endPt.y - b0.y))) return true;
			placeBase(state, endPt, rectState.lockedWidth !== null ? null : snap, e);
			return true;
		}
		endPt = thirdPoint(b0, b1, endPt);
		if (tooSmall(Math.abs(heightOf(b0, b1, endPt)))) return true;
		return placeRect(state, endPt, rectState.lockedHeight !== null ? null : snap);
	}
	const hasLockedSide = rectState.lockedWidth !== null || rectState.lockedHeight !== null;
	if (state.active.startPt) {
		endPt = lockedCorner(state.active.startPt, endPt, rectMode === RECT_MODES.CENTER); // a typed side holds at the click too
		if (tooSmall(...sideSizes(state.active.startPt, endPt, rectMode === RECT_MODES.CENTER))) return true;   // TASK 782: a click on the first point (or on its row / column) places nothing
	}
	return placeRect(state, endPt, hasLockedSide ? null : snap);
}

export function handleRectKeyDown(e, svg, state) {
	dbg.log('rect-tool', '[DEBUG RECT] handleRectKeyDown called:', { key: e.key, tool: state.currentTool, hasActive: !!state.active, hasStart: !!(state.active && state.active.start), inputActive: isInputActive() });
	if (state.currentTool !== TOOL_MODES.RECT) return false;
	if (!state.active || !state.active.start) return false;
	if (matchesShortcut(e, 'draw.typeValue') && !isInputActive()) {
		dbg.log('rect-tool', '[DEBUG RECT] Opening dual input');
		const c1 = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
		const c2 = state.active.preview && state.active.preview.pt ? state.active.preview.pt : c1;
		dbg.log('rect-tool', '[DEBUG RECT] Corners:', { c1, c2 });
		const currentWidth = Math.abs((c2 && c2.x) - (c1 && c1.x));
		const currentHeight = Math.abs((c2 && c2.y) - (c1 && c1.y));
		const midWorld = { x: (c1.x + c2.x) / 2, y: (c1.y + c2.y) / 2 };
		const midScreen = worldToScreen(svg, midWorld);
		dbg.log('rect-tool', '[DEBUG RECT] Input position:', midScreen);
		showDualInput(midScreen.x, midScreen.y, currentWidth, currentHeight, { kind: 'rect', initialKey: e.key }); // the typed digit is the first character of W, never lost
		return true;
	}
	return false;
}
