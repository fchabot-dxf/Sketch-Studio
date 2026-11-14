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
import { checkDragThreshold, safeUpdatePreview, setupDimensionListeners, openCreationBoxes, followCreationBoxes, cancelCreation } from '#ui/input-handlers/base-tool.js';

let rectState = { lockedWidth: null, lockedHeight: null, previewWidth: null, previewHeight: null };
const localState = { isDragging: false, dragStartScreen: null, boxes: false, cursor: null };
// TASK 596: after the first click of a two-point rectangle the W x H boxes show at once (base-tool's shared creation-box path); the sides follow the cursor until typed
const BOX = { dual: { kind: 'rect', labels: ['W', 'H'], separator: '×', digits: [1, 1] } };

/** The second corner: the cursor, but a typed width / height holds its side (the other still follows the cursor). */
function lockedCorner(c1, pt) {
    const signX = pt.x - c1.x >= 0 ? 1 : -1, signY = pt.y - c1.y >= 0 ? 1 : -1;
    return { x: c1.x + (rectState.lockedWidth ? rectState.lockedWidth * signX : pt.x - c1.x), y: c1.y + (rectState.lockedHeight ? rectState.lockedHeight * signY : pt.y - c1.y) };
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
                try{ finalizeRectFromActive(svg, state); }catch(_){ }
            }
        },
        onPreview: (detail) => {
            dbg.log('rect-tool', '[DEBUG RECT] liveDimensionPreview:', detail);
            if (detail.typed[0]) rectState.lockedWidth = detail.width > 0 ? detail.width : null;   // only a TYPED side locks; the other shows the live cursor size
            if (detail.typed[1]) rectState.lockedHeight = detail.height > 0 ? detail.height : null;
            const c1 = state.active && (state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null));
            if (c1 && (state.rectMode || RECT_MODES.TWO_POINT) === RECT_MODES.TWO_POINT) {
                safeUpdatePreview(state, 'rect', [state.active.start], lockedCorner(c1, localState.cursor || c1), { mode: RECT_MODES.TWO_POINT });
            }
        },
        onCancel: () => {
            rectState.lockedWidth = null; rectState.lockedHeight = null; localState.boxes = false;
            // Esc inside the box (open since the first click): nothing is made and no undo step, as Esc on the canvas
            if (state.active && state.active.mode === TOOL_MODES.RECT && state.active.waitingForSecondClick) cancelCreation(state);
        }
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
        const previewPt = state.active.preview && state.active.preview.pt ? state.active.preview.pt : (state.active.secondPt ? (state.joints.get(state.active.secondPt) || null) : null);
        if(!previewPt) return false;
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
            if (rectState.lockedWidth || rectState.lockedHeight) {
                const lines = rectResult && rectResult.shapes ? rectResult.shapes : [];
                for (const line of lines) {
                    const j1 = state.joints.get(line.joints[0]);
                    const j2 = state.joints.get(line.joints[1]);
                    if (!j1 || !j2) continue;
                    const dx = Math.abs(j2.x - j1.x);
                    const dy = Math.abs(j2.y - j1.y);
					if (dx > dy && rectState.lockedWidth) {
						ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [line.joints[0], line.joints[1]], value: rectState.lockedWidth }, { source: 'rect' });
					} else if (dy > dx && rectState.lockedHeight) {
						ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [line.joints[0], line.joints[1]], value: rectState.lockedHeight }, { source: 'rect' });
					}
                }
                rectState.lockedWidth = null; rectState.lockedHeight = null; try{ hideInput(); }catch(_){ }
            }
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
	const rectMode = state.rectMode || RECT_MODES.TWO_POINT;
	if (rectMode === RECT_MODES.CENTER) {
		safeUpdatePreview(state, 'rect', [state.active.start], previewPt, { mode: 'center' });
	} else if (rectMode === RECT_MODES.THREE_POINT) {
		safeUpdatePreview(state, 'rect', [state.active.start], previewPt, { mode: 'three-point' });
	} else {
		const c1 = state.active.startPt || (state.active.start ? state.joints.get(state.active.start) : null);
		let corner2 = previewPt;
		if (c1) {
			corner2 = lockedCorner(c1, previewPt);
			if (localState.boxes) followCreationBoxes(e, [Math.abs(previewPt.x - c1.x), Math.abs(previewPt.y - c1.y)]);
		}
		safeUpdatePreview(state, 'rect', [state.active.start], corner2, { mode: 'two-point', lockedWidth: rectState.lockedWidth || undefined, lockedHeight: rectState.lockedHeight || undefined });
	}
	return true;
}

export function handleRectPointerUp(e, svg, state, hitSnap, w, wasDragging){
	if(!state.active || state.active.mode!==TOOL_MODES.RECT) return false;
	const rectMode = state.rectMode || RECT_MODES.TWO_POINT;
	const isDragging = localState.isDragging;
	// For THREE_POINT, CENTER, or TWO_POINT modes: on the very first click create a waiting state so the flow is click -> click
	if ((rectMode === RECT_MODES.THREE_POINT || rectMode === RECT_MODES.CENTER || rectMode === RECT_MODES.TWO_POINT) && !isDragging && state.active && state.active._tempStart && !state.active.waitingForSecondClick && !state.active.secondPt) {
		state.active.waitingForSecondClick = true;
		localState.dragStartScreen = null;
		localState.isDragging = false;
		if (rectMode === RECT_MODES.TWO_POINT) { localState.boxes = true; localState.cursor = null; openCreationBoxes(e, BOX, [0, 0]); } // TASK 596: W and H show now, not after a typed digit
		return true;
	}

	dbg.log('rect-tool', '[rect-tool] pointerUp entry', { snap: state.activeSnap || hitSnap, wasDragging });
	const snap = state.activeSnap || hitSnap;
	let endPt = (snap && snap.isLocked && snap.pt) ? snap.pt : w;
	if (rectMode === RECT_MODES.TWO_POINT && state.active.startPt) endPt = lockedCorner(state.active.startPt, endPt); // a typed side holds at the click too
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
		applyLockedDims(state, rectResult, rectMode);
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
		applyLockedDims(state, rectResult, rectMode);
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
		applyLockedDims(state, rectResult, rectMode);
		state.endUndoGroup(); state.active=null; localState.isDragging = false; localState.dragStartScreen = null; return true;
	}
}

// Extracted: apply locked width/height as distance constraints
function applyLockedDims(state, rectResult, rectMode) {
	if (!rectState.lockedWidth && !rectState.lockedHeight) { closeRectBoxes(); return; }
	const lines = rectResult && rectResult.shapes ? rectResult.shapes : [];
	if (rectMode === RECT_MODES.THREE_POINT || rectMode === RECT_MODES.CENTER) {
		if (rectState.lockedWidth) {
			const bottomLine = lines.find(l => {
				const j1 = state.joints.get(l.joints[0]);
				const j2 = state.joints.get(l.joints[1]);
				return j1 && j2 && Math.abs(j1.y - j2.y) < 0.01;
			});
			if (bottomLine) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: bottomLine.joints, value: rectState.lockedWidth }, { source: 'rect' });
		}
		if (rectState.lockedHeight) {
			const leftLine = lines.find(l => {
				const j1 = state.joints.get(l.joints[0]);
				const j2 = state.joints.get(l.joints[1]);
				return j1 && j2 && Math.abs(j1.x - j2.x) < 0.01;
			});
			if (leftLine) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: leftLine.joints, value: rectState.lockedHeight }, { source: 'rect' });
		}
	} else {
		for (const line of lines) {
			const j1 = state.joints.get(line.joints[0]);
			const j2 = state.joints.get(line.joints[1]);
			if (!j1 || !j2) continue;
			const dx = Math.abs(j2.x - j1.x);
			const dy = Math.abs(j2.y - j1.y);
			if (dx > dy && rectState.lockedWidth) {
				ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [line.joints[0], line.joints[1]], value: rectState.lockedWidth }, { source: 'rect' });
			} else if (dy > dx && rectState.lockedHeight) {
				ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [line.joints[0], line.joints[1]], value: rectState.lockedHeight }, { source: 'rect' });
			}
		}
	}
	closeRectBoxes();
}

export function handleRectKeyDown(e, svg, state) {
	dbg.log('rect-tool', '[DEBUG RECT] handleRectKeyDown called:', { key: e.key, tool: state.currentTool, hasActive: !!state.active, hasStart: !!(state.active && state.active.start), inputActive: isInputActive() });
	if (state.currentTool !== TOOL_MODES.RECT) return false;
	if (!state.active || !state.active.start) return false;
	if (/^[0-9.]$/.test(e.key) && !isInputActive()) {
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
