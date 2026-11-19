// Rect tool - preview and creation
import { dbg } from '#core/debug.js';
import { TOOL_MODES, RECT_MODES, CONSTRAINT_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { makeRectFromTwoJoints, makeRectFromCenter, makeRectFrom3Points } from '#core/shapes.js';
import { findNearbyJoint } from '#core/joints.js';
import { setupNumericInput, showDualInput, hideInput, resetLockedDimensions, isInputActive } from '#ui/numeric-input-manager.js';
import { updatePreview, clearPreview } from '#ui/preview-manager.js';
import { applySnapConstraint, previewSnapConstraint } from '#core/snap-constraints.js';
import { findSnap } from '#ui/snap-detection.js';
import { worldToScreen } from '#ui/coords.js';
import { checkDragThreshold, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, tooSmall } from '#ui/input-handlers/base-tool.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there

let rectState = { lockedWidth: null, lockedHeight: null, previewWidth: null, previewHeight: null };
const localState = { isDragging: false, dragStartScreen: null, boxes: false, cursor: null };
// TASK 596: after the first click of a two-point rectangle the W x H boxes show at once (base-tool's shared creation-box path); the sides follow the cursor until typed
const BOX = { dual: { kind: 'rect', labels: ['W', 'H'], separator: '×', quantities: ['length', 'length'] } };

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
/** Where Enter places the corner: the last cursor point (else the preview's), with the typed sides held. */
function enterCorner(state) {
    const rectMode = rectModeOf(state);
    const c1 = state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null));
    const raw = localState.cursor || (state.active && state.active.preview && state.active.preview.pt) || null;
    if (!c1 || !raw) return null;
    return { c1, corner: lockedCorner(c1, raw, rectMode === RECT_MODES.CENTER) };
}

/** TASK 782: the typed sides become the rectangle's dimensions, ONCE each (one width on a horizontal side, one height on a vertical side: a rectangle's
 *  four sides used to carry four, two of them reference), by the click AND by Enter, in the two-point and the centre mode. A centre rectangle's
 *  construction diagonals are not axis-aligned, so they are never picked. */
function addTypedSideDimensions(state, rectResult) {
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
    const w = rectState.lockedWidth && side(true), h = rectState.lockedHeight && side(false);
    if (w) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [w.joints[0], w.joints[1]], value: rectState.lockedWidth }, { source: 'rect' });
    if (h) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [h.joints[0], h.joints[1]], value: rectState.lockedHeight }, { source: 'rect' });
}

export function setupRectTool(svg, state){
    setupNumericInput(svg, state);
    state.onDrawCancelled(() => { if (localState.boxes) closeRectBoxes(); });   // another tool picked / Undo mid-draw: the boxes go with the draw
    setupDimensionListeners(state, TOOL_MODES.RECT, {
        guard: (detail) => detail.mode === 'dual' && detail.kind === 'rect',
        onApply: (detail) => {
            dbg.log('rect-tool', '[DEBUG RECT] liveDimensionApplied event:', { tool: state.currentTool, hasActive: !!state.active, detail });
            // a typed side is locked already (onPreview); Enter places the rectangle at the preview: typed sides exact, the others at the cursor
            if (detail.confirmedBy === 'enter') {
                const sized = sizedMode(rectModeOf(state)) ? enterCorner(state) : null;
                if (sized && tooSmall(...sideSizes(sized.c1, sized.corner, rectModeOf(state) === RECT_MODES.CENTER))) { detail.keepOpen = true; return; }   // no size yet (cursor still on the first click, none typed): the boxes stay open
                try{ finalizeRectFromActive(svg, state); }catch(_){ }
            }
        },
        onPreview: (detail) => {
            dbg.log('rect-tool', '[DEBUG RECT] liveDimensionPreview:', detail);
            if (detail.reset && detail.reset[0]) rectState.lockedWidth = null;
            else if (detail.typed[0]) rectState.lockedWidth = detail.width > 0 ? detail.width : null;   // only a TYPED side locks; the other shows the live cursor size
            if (detail.reset && detail.reset[1]) rectState.lockedHeight = null;
            else if (detail.typed[1]) rectState.lockedHeight = detail.height > 0 ? detail.height : null;
            const c1 = state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null));
            if (c1 && sizedMode(rectModeOf(state))) {
                const centre = rectModeOf(state) === RECT_MODES.CENTER;
                safeUpdatePreview(state, 'rect', [state.active.start], lockedCorner(c1, localState.cursor || c1, centre), { mode: centre ? 'center' : RECT_MODES.TWO_POINT });
            }
        },
        onCancel: () => { rectState.lockedWidth = null; rectState.lockedHeight = null; } // Esc in the box also runs the canvas Esc (input-manager handleEscape)
    });
}

/**
 * Finalize rectangle creation using current preview (used when user presses Enter)
 */
export function finalizeRectFromActive(svg, state){
    if(!state.active || state.active.mode !== TOOL_MODES.RECT) return false;
    const rectMode = state.rectMode || RECT_MODES.TWO_POINT;
    if(rectMode === RECT_MODES.THREE_POINT && !state.active.secondPt) return false;

    try{
        state.saveState();
        const sized = sizedMode(rectMode) ? enterCorner(state) : null;   // TASK 782: the typed sides hold at Enter whatever the mouse did since
        const previewPt = sized ? sized.corner : (state.active.preview && state.active.preview.pt ? state.active.preview.pt : (state.active.secondPt ? (state.joints.get(state.active.secondPt) || null) : null));
        if(!previewPt) return false;
        if(sized && tooSmall(...sideSizes(sized.c1, sized.corner, rectMode === RECT_MODES.CENTER))) return false;
        const endId = state.genJ();
        state.joints.set(endId, { x: previewPt.x, y: previewPt.y, fixed:false });

        if(rectMode === RECT_MODES.THREE_POINT){
			const rectResult = makeRectFrom3Points(state.joints, state.active.start, state.active.secondPt, endId, state.genJ, state.isConstructionMode || false);
			if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>state.shapes.push(s));
			if(rectResult && rectResult.constraints) rectResult.constraints.forEach(c=>ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' }));
            try{
                const allCornerIds = [];
                if(rectResult && rectResult.shapes){ rectResult.shapes.forEach(s=>{ if(s && s.joints) s.joints.forEach(j=> allCornerIds.push(j)); }); }
				for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01); if(nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' }); }
                try{
                    for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const screen = worldToScreen(svg, jpt); const snap = findSnap(state.joints, state.shapes, svg, screen, allCornerIds); if(snap){ applySnapConstraint(state, cid, snap, { excludeJoints: allCornerIds }); } }
                }catch(_){ }
            }catch(_){ }
        } else if(rectMode === RECT_MODES.CENTER){
			const rectResult = makeRectFromCenter(state.joints, state.active.start, endId, state.genJ, state.isConstructionMode || false);
			if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>state.shapes.push(s));
			if(rectResult && rectResult.constraints) rectResult.constraints.forEach(c=>ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' }));
            try{
                const allCornerIds = [];
                if(rectResult && rectResult.shapes){ rectResult.shapes.forEach(s=>{ if(s && s.joints) s.joints.forEach(j=> allCornerIds.push(j)); }); }
				for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01); if(nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' }); }
                try{
                    for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const screen = worldToScreen(svg, jpt); const snap = findSnap(state.joints, state.shapes, svg, screen, allCornerIds); if(snap){ applySnapConstraint(state, cid, snap, { excludeJoints: allCornerIds }); } }
                }catch(_){ }
            }catch(_){ }
            addTypedSideDimensions(state, rectResult);
        } else {
			const rectResult = makeRectFromTwoJoints(state.joints, state.active.start, endId, state.genJ, state.isConstructionMode || false);
			if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>state.shapes.push(s));
			if(rectResult && rectResult.constraints) rectResult.constraints.forEach(c=>ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' }));
            try{
                const allCornerIds = [];
                if(rectResult && rectResult.shapes){ rectResult.shapes.forEach(s=>{ if(s && s.joints) s.joints.forEach(j=> allCornerIds.push(j)); }); }
				for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01); if(nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' }); }
                try{
                    for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const screen = worldToScreen(svg, jpt); const snap = findSnap(state.joints, state.shapes, svg, screen, allCornerIds); if(snap){ applySnapConstraint(state, cid, snap, { excludeJoints: allCornerIds }); } }
                }catch(_){ }
            }catch(_){ }
            addTypedSideDimensions(state, rectResult);
        }
        closeRectBoxes();
        state.endUndoGroup(); state.active = null; return true;
    }catch(_){ try{ state.endUndoGroup(); }catch(_){ } state.active = null; return false; }
}
/** The W x H boxes and the sides typed in them go away (a rectangle was placed, or the tool was left). */
function closeRectBoxes(){ rectState.lockedWidth = null; rectState.lockedHeight = null; localState.boxes = false; localState.cursor = null; try{ hideInput(); }catch(_){ } }
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
	const startPt = (snap && snap.pt && snap.isLocked) ? snap.pt : w;
	const startId = state.genJ();
	state.joints.set(startId, { x: startPt.x, y: startPt.y, fixed:false });
	state.active = { mode: TOOL_MODES.RECT, start: startId, startPt: startPt, preview: null, polylineOrigin: startId, _tempStart:true, waitingForSecondClick:false, secondPt:null, startSnapTarget: snap }; 
	localState.dragStartScreen = { x: e.clientX, y: e.clientY };
	localState.isDragging = false;
	return true;
}

export function handleRectPointerMove(e, svg, state, w){
	if(!state.active || state.active.mode!==TOOL_MODES.RECT) return false;
	if (checkDragThreshold(e, localState.dragStartScreen)) localState.isDragging = true;
	const previewPt = state.snapTarget ? state.snapTarget.pt : w;
	localState.cursor = previewPt;
	if (isInputActive() && !localState.boxes) { followCreationBoxes(e, []); return true; }   // a box opened by a typed digit in the other rect modes: the preview waits for Enter
	const rectMode = rectModeOf(state);
	if (rectMode === RECT_MODES.THREE_POINT) {
		safeUpdatePreview(state, 'rect', [state.active.start], previewPt, { mode: 'three-point' });
	} else {
		const centre = rectMode === RECT_MODES.CENTER;
		const c1 = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
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
		if (sizedMode(rectMode)) { localState.boxes = true; localState.cursor = null; openCreationBoxes(e, BOX, [0, 0]); } // TASK 596: W and H show now, not after a typed digit (TASK 782: in the centre mode too)
		return true;
	}

	dbg.log('rect-tool', '[rect-tool] pointerUp entry', { snap: state.activeSnap || hitSnap, wasDragging });
	const snap = state.activeSnap || hitSnap;
	let endPt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
	if (sizedMode(rectMode) && state.active.startPt) {
		endPt = lockedCorner(state.active.startPt, endPt, rectMode === RECT_MODES.CENTER); // a typed side holds at the click too
		if (tooSmall(...sideSizes(state.active.startPt, endPt, rectMode === RECT_MODES.CENTER))) return true;   // TASK 782: a click on the first point (or on its row / column) places nothing
	}
	if (rectMode === RECT_MODES.THREE_POINT) {   // TASK 782: the base needs a length, then the rectangle a height
		const b0 = state.active.startPt, b1 = state.active.secondPt ? state.joints.get(state.active.secondPt) : null;
		if (!b1 ? tooSmall(Math.hypot(endPt.x - b0.x, endPt.y - b0.y)) : tooSmall(Math.abs((b1.x - b0.x) * (endPt.y - b1.y) - (b1.y - b0.y) * (endPt.x - b1.x)) / Math.hypot(b1.x - b0.x, b1.y - b0.y))) return true;
	}
	const endId = state.genJ();
	state.joints.set(endId, { x:endPt.x, y:endPt.y, fixed:false });
	dbg.log('rect-tool', '[rect-tool] created corner', { endId, endPt });

	if(rectMode === RECT_MODES.THREE_POINT && !state.active.secondPt){
		state.saveState(); state.active.secondPt = endId; state.active.preview = { type: 'rect-3pt', pt: endPt }; return true;
	} else if(rectMode === RECT_MODES.THREE_POINT && state.active.secondPt){
		state.saveState();
		if(snap && snap.isLocked){
			try{ applySnapConstraint(state, endId, snap, { excludeJoints: [state.active.start] }); }catch(_){ }
		}
		const rectResult = makeRectFrom3Points(state.joints, state.active.start, state.active.secondPt, endId, state.genJ, state.isConstructionMode || false);
		if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>state.shapes.push(s));
		if(rectResult && rectResult.constraints) rectResult.constraints.forEach(c=>ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' }));
		try{
			const allCornerIds = [];
			if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>{ if(s && s.joints) s.joints.forEach(j=> allCornerIds.push(j)); });
			for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01); if(nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' }); }
		}catch(_){ }
		applyLockedDims(state, rectResult);
		state.endUndoGroup(); state.active=null; localState.isDragging = false; localState.dragStartScreen = null; return true;
	} else if(rectMode === RECT_MODES.CENTER){
		state.saveState();
		if(hitSnap && hitSnap.isLocked){
			try{ applySnapConstraint(state, endId, hitSnap, { excludeJoints: [state.active.start] }); }catch(_){ }
		}
		const rectResult = makeRectFromCenter(state.joints, state.active.start, endId, state.genJ, state.isConstructionMode || false);
		if(rectResult && rectResult.shapes){ rectResult.shapes.forEach(s=>state.shapes.push(s)); }
		if(rectResult && rectResult.constraints){ rectResult.constraints.forEach(c=>ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' })); }
		try{
			const allCornerIds = [];
			if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>{ if(s && s.joints) s.joints.forEach(j=> allCornerIds.push(j)); });
			for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01); if(nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' }); }
		}catch(_){ }
		applyLockedDims(state, rectResult);
		state.endUndoGroup(); state.active=null; localState.isDragging = false; localState.dragStartScreen = null; return true;
	} else {
		state.saveState();
		if(hitSnap && hitSnap.isLocked){
			try{ applySnapConstraint(state, endId, hitSnap, { excludeJoints: [state.active.start] }); }catch(_){ }
		}
		const rectResult = makeRectFromTwoJoints(state.joints, state.active.start, endId, state.genJ, state.isConstructionMode || false);
		if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>state.shapes.push(s));
		if(rectResult && rectResult.constraints) rectResult.constraints.forEach(c=>ConstraintManager.createConstraint(state, c.type, c, { source: 'rect' }));
		try{
			const allCornerIds = [];
			if(rectResult && rectResult.shapes) rectResult.shapes.forEach(s=>{ if(s && s.joints) s.joints.forEach(j=> allCornerIds.push(j)); });
			for(const cid of allCornerIds){ const jpt = state.joints.get(cid); if(!jpt) continue; const nearby = findNearbyJoint(state.joints, jpt, cid, 0.01); if(nearby && nearby !== cid) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [cid, nearby] }, { source: 'rect' }); }
		}catch(_){ }
		applyLockedDims(state, rectResult);
		state.endUndoGroup(); state.active=null; localState.isDragging = false; localState.dragStartScreen = null; return true;
	}
}

// The typed sides become dimensions once the rectangle is placed by a click (Enter does the same in finalizeRectFromActive); the boxes go
function applyLockedDims(state, rectResult) {
	addTypedSideDimensions(state, rectResult);
	closeRectBoxes();
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
