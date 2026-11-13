// ═══════════════════════════════════════════════════════════════════════════════
// SELECTION TOOLS - Handles selection, dragging, and dimension label interaction
// ═══════════════════════════════════════════════════════════════════════════════
// Shared UI (#ui/input-handlers/). Relocated VERBATIM from apps/sketchstudio in slice S4d.
// TODO(shaper): parameterize the DOM reaches before Shaper adopts this — relocation only for now.

import { dbg } from '#core/debug.js';
import { TOOL_MODES, DRAG_TYPES, DRAG_UNDO_LABELS, DRAG_SHAPE_UNDO_LABELS, DRAG_GROUP_UNDO_LABEL, SNAP, CONSTRAINT_TYPES, AXIS_SNAP_TARGETS } from '#core/constants.js';
import { findCoincidentCluster, hitJointAtScreen } from '#ui/snap-detection.js';
import { addConstraint } from '#core/constraints.js';
import { screenToWorld, worldToScreen, getZoomFactor } from '#ui/coords.js';
import { perpendicularDistance, getDist, projectPointOnLine, getLineIntersection } from '#core/geometry.js';
import { showEditInput } from '#ui/numeric-input-manager.js';
import { dragDimensionLabel } from '#ui/dimension-seams.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { findInference } from '#core/inference-engine.js';
import SettingsManager from '#core/settings-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { BODY_POINTS } from '#core/solver/definitions.js';
import { isWithinMagnet } from '#ui/snap-magnet.js';
import { INFERENCE_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { placeRadiusLabel } from '#ui/input-handlers/dimension-tool.js'; // TASK 448: the one radius-label placement writer
import { releaseDragTargets } from '#ui/sketch-state.js'; // TASK 575: the one release of a drag's solver targets

// Local state for selection tools
let selectionState = {
    isDragging: false,
    dragStartScreen: null,
    lastClickTime: 0,
    lastClickedIndex: -1, // FIX: Track index
    isMarqueeActive: false,
    marqueeStart: null,
    marqueeEnd: null,
    selectMode: null // 'window' or 'crossing'
};

// Helpers to manage transient visibility for coincident glyphs when clusters are selected
function clearCoincidentGlyphFlags(state){
    if(!state || !state.constraints) return;
    for(const c of state.constraints){ if(c && c.__showGlyph) delete c.__showGlyph; }
}

function showCoincidentGlyphsForCluster(state, cluster){
    if(!state || !state.constraints || !cluster) return;
    for(const c of state.constraints){
        if(c && c.type === 'coincident' && c.joints && c.joints.length >= 2){
            if(cluster.has(c.joints[0]) && cluster.has(c.joints[1])){ c.__showGlyph = true; }
        }
    }
} 

// Import shared helpers from hover-manager (single source of truth)
import { selectPick, applyHoverPriority } from '#ui/hover-manager.js';
import { findConnectedChain } from '#core/loop-finder.js'; // TASK 588: the double-click chain
import { inertEntities, isConstraintInert, isJointInert, isShapeInert } from '#core/sketch-model.js'; // TASK 577: locked / hidden sketches are out of reach

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT MASKING HELPER (Rigid Drag Logic)
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: Analyze constraints to determine allowed Degrees of Freedom (DOF) for dragging
import { analyzeConstraintStatus } from '#core/constraint-status.js';

function getDragDOF(state, jointIds, drag = null) {
    // Rigid masked interaction: use analyzeConstraintStatus as single source-of-truth
    let lockX = false, lockY = false, guideLine = null;
    let status = null;
    try { status = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes || [], constraints: state.constraints || [] }); } catch (_) { status = null; }

    const jointDOFs = (status && status.jointDOFs) ? status.jointDOFs : new Map();
    const fixedJoints = (status && status.fixedJoints) ? status.fixedJoints : new Set();
    const isHeld = (id) => id === 'j_origin' || fixedJoints.has(id) || (jointDOFs.get(id) ?? 2) <= 0;
    const clusterHeld = (id) => Array.from(findCoincidentCluster(id, state.constraints || [])).some(isHeld);

    // TASK 582: an arc dragged by its CENTRE (handleJointSelection: drag.arcRims, the rims that grab added) moves rigidly with the centre.
    // A HELD rim (fixed, 0 DOF, or coincident with such a point) does not lock that drag: it is the PIVOT the arc turns about, keeping its
    // radius (Fusion, measured: the centre moves on the circle about the held end). Two held rims lock it (no rigid motion keeps both). The
    // other members (the centre and its coincident cluster) lock the drag when held, as in every drag.
    const rims = (drag && drag.arcRims) || [];
    const members = jointIds.filter(id => !rims.includes(id));

    // 0 DOF protocol — immediate full lock if any dragged joint is fixed/0DOF/j_origin
    for (const id of members) {
        if (isHeld(id)) return { lockX: true, lockY: true, guideLine: null };
    }

    // Propagation for clusters: if ANY joint in the coincident cluster is 0DOF/fixed,
    // lock the entire cluster to avoid internal deformation.
    if (jointIds.length > 1) {
        for (const id of members) {
            if (clusterHeld(id)) return { lockX: true, lockY: true, guideLine: null };
        }
    }

    const heldRims = rims.filter(clusterHeld);
    if (heldRims.length > 1) return { lockX: true, lockY: true, guideLine: null };
    if (heldRims.length === 1) {
        const p = state.joints.get(heldRims[0]);
        return { lockX: false, lockY: false, guideLine: null, pivot: { x: p.x, y: p.y } };
    }

    // 1 DOF protocol — use analyzer's axis-lock results (trusted single source-of-truth)
    // If the analyzer reports an X/Y lock for any dragged joint, mask that axis in the UI.
    const lockedAxisX = (status && status.lockedAxisX) ? status.lockedAxisX : new Set();
    const lockedAxisY = (status && status.lockedAxisY) ? status.lockedAxisY : new Set();

    for (const jid of jointIds) {
        if (lockedAxisX.has(jid)) lockX = true;
        if (lockedAxisY.has(jid)) lockY = true;
    }

    // Note: radial/arc (distance) 1-DOF reductions are *not* mapped to axis locks —
    // they are handled by the solver. UI should not mask an axis for radial locks.


    // Preserve existing POINT_ON_LINE guide-line behavior (only if both line endpoints are effectively fixed)
    for (const jid of jointIds) {
        for (const c of (state.constraints || [])) {
            if (c && c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.joint === jid) {
                const shape = state.shapes.find(s => s.id === c.shape);
                if (shape && shape.type === 'line' && shape.joints && shape.joints.length >= 2) {
                    const [j1, j2] = shape.joints;
                    if ((fixedJoints.has(j1) || (jointDOFs.get(j1) ?? 2) <= 0) && (fixedJoints.has(j2) || (jointDOFs.get(j2) ?? 2) <= 0)) {
                        guideLine = { p1: state.joints.get(j1), p2: state.joints.get(j2) };
                    }
                }
            }
        }
    }

    return { lockX, lockY, guideLine };
}

/**
 * Setup selection tools
 */
export function setupSelectionTools(svg, appState) {
    dbg.log('selection', '[selection-tools] Setting up selection tools...');
}

/**
 * Update hover feedback for selection tests and UI: the select tool's hover, through THE pick the click uses (hover-manager selectPick).
 */
export function updateHoverFeedback(svg, hitJoint, hitShape, _e, state) {
    const px = state.lastMouse?.x ?? null;
    const py = state.lastMouse?.y ?? null;
    if (px === null || py === null) return;
    applyHoverPriority(state, svg, hitJoint, hitShape, px, py); // TASK 588: THE hover (hover-manager selectPick, the click's pick)
}

/**
 * Handle pointer down for selection tool
 */
export function handleSelectionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint) {
    const isSelectOrDim = (state.currentTool === TOOL_MODES.SELECT || state.currentTool === TOOL_MODES.DIMENSION);
    if (!isSelectOrDim) return false;
    
    // Track double-clicks: a double click is two presses on the SAME target within DOUBLE_CLICK_MS, keyed by what the press landed on: a
    // dimension label ('dim:' + its index: the value edit) or a shape body ('shape:' + its id, task 588: the chain select). Any other press
    // (a joint, a glyph, empty space, a label child element without its own dataset) records no key, so it never pairs with another.
    const now = Date.now();
    const prevPress = { time: selectionState.lastClickTime, key: selectionState.lastClickedIndex };
    selectionState.lastClickTime = now;
    selectionState.lastClickedIndex = null;
    const pressOn = (key) => { selectionState.lastClickedIndex = key; return key != null && prevPress.key === key && now - prevPress.time < DOUBLE_CLICK_MS; };
    // Test environments may pass synthetic pointer events whose target lacks
    // .closest(); fall back to null so the dim-label branch is skipped.
    const dimLabel = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.dim-label') : null;
    const _labelKey = dimLabel ? dimLabel.dataset.constraintIdx : null;
    const isDoubleClick = pressOn(_labelKey != null ? 'dim:' + _labelKey : null);

    // 1. Check for Dimension Label Interaction
    if (dimLabel) {
        const cIdx = parseInt(dimLabel.dataset.constraintIdx);
        const constraint = state.constraints[cIdx];
        if (constraint && !isConstraintInert(inertEntities(state), constraint)) {
            if(!state.selectedConstraints) state.selectedConstraints = new Set();
            // TASK 485: selecting a dimension selects ONLY the dimension (unless Shift extends the selection), exactly like every other
            // route to a constraint (handleConstraintSelection, the empty-space clear above). This branch used to clear only the
            // constraints, so a line / joint selected a moment before stayed selected, and Delete then removed the dimension AND that geometry.
            if(!e.shiftKey) { state.selectedConstraints.clear(); if(state.selectedShapes) state.selectedShapes.clear(); if(state.selectedJoints) state.selectedJoints.clear(); }
            state.selectedConstraints.add(constraint);
            
            if (isDoubleClick) {
                e.stopPropagation(); e.preventDefault();
                showEditInput(svg, state, constraint);
                return true;
            }

            // The value drags freely in X and Y (labelPos); the blue handle (below) moves the dimension line
            svg.setPointerCapture(e.pointerId);
            state.drag = {
                type: DRAG_TYPES.DIMENSION,
                mode: 'label',
                constraint: constraint,
                initialOffset: constraint.offset || SolverConfig.DIMENSION_OFFSET || 30,
                startWorld: screenToWorld(svg, e.clientX, e.clientY),
                startClient: { x: e.clientX, y: e.clientY },
                pointerId: e.pointerId
            };
            return true;
        }
    }

    // The blue dot on a selected dimension moves the dimension LINE (its offset)
    const dimHandle = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.dim-offset-handle') : null;
    if (dimHandle) {
        const constraint = state.constraints[parseInt(dimHandle.dataset.constraintIdx)];
        if (constraint) {
            svg.setPointerCapture(e.pointerId);
            state.drag = {
                type: DRAG_TYPES.DIMENSION,
                constraint: constraint,
                initialOffset: constraint.offset || SolverConfig.DIMENSION_OFFSET || 30,
                startWorld: screenToWorld(svg, e.clientX, e.clientY),
                pointerId: e.pointerId
            };
            return true;
        }
    }

    if (state.currentTool !== TOOL_MODES.SELECT) return false;
    
    // Reset drag tracking
    selectionState.isDragging = false;
    selectionState.dragStartScreen = { x: e.clientX, y: e.clientY };

    // THE select tool's pick (hover-manager selectPick, task 588: the hover uses the same function, so a click selects exactly what the hover
    // lit): a joint in snap reach, else a glyph the pointer is ON (its drawn badge + 3 px: THE glyph pick, the right click's too), else a shape.
    // A pointer merely NEAR a glyph (on the line beside it) picks the line.
    const pick = selectPick(svg, state, hitJoint, hitShape, e.clientX, e.clientY);
    // TASK 588: a press on a member of a selection of several shapes / points (no Shift) MOVES the whole selection (startGroupDrag); a
    // release without a move is the click it was before (the one entity selected). The second press of a double click on a shape selects its
    // connected chain (selectChain). Both are decided before the selection is cleared.
    if (pick && pick.joint) {
        if (!e.shiftKey && inGeometrySelection(state, 'joint', pick.joint.id)) return startGroupDrag(e, svg, state, pick.joint.id, { kind: 'joint', id: pick.joint.id });
        return handleJointSelection(e, svg, state, pick.joint);
    }
    if (pick && pick.shape) {
        const id = pick.shape.shape.id;
        if (pressOn('shape:' + id)) return selectChain(e, svg, state, pick.shape);
        if (!e.shiftKey && inGeometrySelection(state, 'shape', id)) return startGroupDrag(e, svg, state, pick.shape.shape.joints[0], { kind: 'shape', id });
    }

    // If Shift is not held, clear all selection sets before processing (single-select mode)
    if (!e.shiftKey) clearSelection(state);

    if (pick && pick.constraint) {
        dbg.log('selection', '[selection-tools] capturing click on glyph', { type: pick.constraint.type });
        return handleConstraintSelection(e, svg, state, pick.constraint);
    }
    if (pick && pick.shape) {
        return handleShapeSelection(e, svg, state, pick.shape);
    }
    
    // If no target hit, start marquee selection
    selectionState.isMarqueeActive = true;
    selectionState.marqueeStart = { x: e.clientX, y: e.clientY };
    selectionState.marqueeEnd = { x: e.clientX, y: e.clientY };
    selectionState.selectMode = 'window';
    svg.setPointerCapture(e.pointerId);
    if (!e.shiftKey) {
        if(state.selectedJoints) state.selectedJoints.clear();
        if(state.selectedShapes) state.selectedShapes.clear();
        if(state.selectedConstraints) state.selectedConstraints.clear();
    }
    return true;
}

const DOUBLE_CLICK_MS = 500; // two presses on the same target within this pair into a double click (the app's one pairing window)

function clearSelection(state) {
    if(state.selectedJoints) state.selectedJoints.clear();
    if(state.selectedShapes) state.selectedShapes.clear();
    if(state.selectedConstraints) state.selectedConstraints.clear();
    // Clear any previously forced coincident glyphs when selection changes
    try{ clearCoincidentGlyphFlags(state); }catch(_){ }
}

// TASK 588: true when the selection holds SEVERAL shapes / points and the pressed entity is one of them: a selected shape, or a point that is
// selected or is a joint (or coincident with a joint) of a selected shape.
function inGeometrySelection(state, kind, id) {
    const shapes = state.selectedShapes || new Set(), joints = state.selectedJoints || new Set();
    if (shapes.size + joints.size < 2) return false;
    if (kind === 'shape') return shapes.has(id);
    if (joints.has(id)) return true;
    const cluster = findCoincidentCluster(id, state.constraints || []);
    return (state.shapes || []).some(s => shapes.has(s.id) && (s.joints || []).some(j => cluster.has(j)));
}

// TASK 588: a GROUP drag moves the whole selection: a CLUSTER drag (the existing point-drag step: DOF mask, drag step, solve) whose members
// are every joint of the selected shapes and every selected point, all CARRIED (no drag.carried: pullDrag carries jointIds), so each is
// pulled toward its start + the CURSOR's displacement by its own spring (task 584's engine._jointDragSprings). The constraints still hold: the ones inside the
// selection keep it as drawn, the ones to unselected geometry pull that geometry along or hold the selection back, as the solver decides; a
// held member (fixed, 0 DOF, or coincident with such a point) locks the whole group and an axis lock of any member masks that axis for all
// (getDragDOF, the rule of every cluster drag). It neither snaps (dragToward) nor infers (a cluster drag, task 584), and adds no constraint on
// release. drag.group serves only the undo label, the no-snap rule and the click handling. It moves once the pointer
// leaves the click radius (5 px, handleSelectionPointerMove's isDragging), so a click on a member stays a click: its release selects the
// pressed entity alone (drag.click), what the press selected before.
function startGroupDrag(e, svg, state, primaryId, click) {
    const startWorld = screenToWorld(svg, e.clientX, e.clientY); // the selection moves by the CURSOR's displacement (no jump to the press point)
    const ids = new Set(state.selectedJoints || []);
    for (const s of (state.shapes || [])) if (state.selectedShapes && state.selectedShapes.has(s.id)) for (const j of (s.joints || [])) ids.add(j);
    const jointIds = [...ids].filter(id => state.joints.has(id));
    const initial = new Map(jointIds.map(id => { const j = state.joints.get(id); return [id, { x: j.x, y: j.y }]; }));
    svg.setPointerCapture(e.pointerId);
    state.drag = { type: DRAG_TYPES.CLUSTER, group: true, id: primaryId, jointIds, initial, startWorld, lastTarget: startWorld, arcRims: [], click, pointerId: e.pointerId };
    dbg.log('selection', '[selection-tools] group drag', { joints: jointIds.length, click });
    return true;
}

// TASK 588: the select tool's DOUBLE CLICK on a curve selects the whole chain connected end to end to it (#core loop-finder
// findConnectedChain: through branches, the same kind only (construction or normal), never into a locked or hidden sketch); Shift adds the
// chain to the selection. The press then drags like any press on the selection: a move moves the chain (a group drag when the selection
// holds several entities, else the shape's own drag).
function selectChain(e, svg, state, hitShape) {
    const inert = inertEntities(state);
    const chain = findConnectedChain(state, hitShape.shape.id, s => !isShapeInert(inert, s.id));
    if (!e.shiftKey) clearSelection(state);
    if (!state.selectedShapes) state.selectedShapes = new Set();
    for (const id of chain) state.selectedShapes.add(id);
    dbg.log('selection', '[selection-tools] chain selected', { from: hitShape.shape.id, chain });
    if ((state.selectedShapes.size + (state.selectedJoints ? state.selectedJoints.size : 0)) > 1) return startGroupDrag(e, svg, state, hitShape.shape.joints[0], null);
    return startShapeDrag(e, svg, state, hitShape);
}

/**
 * Handle joint selection and dragging
 */
export function handleJointSelection(e, svg, state, hitJoint) {
    selectJoint(e, state, hitJoint.id);

    // Prepare pointer capture and drag data for the joint (allow cluster dragging still)
    svg.setPointerCapture(e.pointerId);
    const cluster = findCoincidentCluster(hitJoint.id, state.constraints);
    // Include arc endpoints when dragging an arc center so the user can translate the arc by its center
    const jointIdSet = new Set(Array.from(cluster));
    const arcRims = []; // TASK 582: the rims an arc CENTRE grab adds (getDragDOF: a held one is the pivot the arc turns about)
    try{
        if(state.shapes && state.shapes.length){
            for(const s of state.shapes){
                if(s && s.type === 'arc' && s.joints && s.joints.length >= 3){
                    // If the clicked joint is the center of an arc, include the arc's rim joints so drag translates the arc
                    if(s.joints[0] === hitJoint.id){ jointIdSet.add(s.joints[1]); jointIdSet.add(s.joints[2]); arcRims.push(s.joints[1], s.joints[2]); }
                    // A rim joint drags ITSELF only (task 578, like Fusion): the solver moves whatever its constraints require.
                }
            }

            // Logic for Center Point Rectangle (Intersection of Construction Diagonals)
            // If the joint (or its coincident cluster) is constrained to be on >=2 construction lines of the same group, treat it as a group handle.
            const clusterArr = Array.from(cluster);
            const polConstraints = (state.constraints || []).filter(c => c.type === CONSTRAINT_TYPES.POINT_ON_LINE && clusterArr.includes(c.joint));
            if (polConstraints.length >= 2) {
                const constructionShapes = [];
                let commonGroupId = null;
                let consistentGroup = true;

                for (const c of polConstraints) {
                    const s = state.shapes.find(sh => sh.id === c.shape);
                    if (s && s.isConstruction && s.groupId) {
                        constructionShapes.push(s);
                        if (commonGroupId === null) commonGroupId = s.groupId;
                        else if (commonGroupId !== s.groupId) consistentGroup = false;
                    }
                }

                if (consistentGroup && commonGroupId && constructionShapes.length >= 2) {
                    // It's a center point of a group. Add all joints in this group to the drag.
                    for (const s of state.shapes) {
                        if (s.groupId === commonGroupId && s.joints) {
                            s.joints.forEach(jid => jointIdSet.add(jid));
                        }
                    }
                }
            }
        }
    }catch(_){ }
    const jointIds = Array.from(jointIdSet);

    const initialPositions = new Map();
    for (const id of jointIds) {
        const j = state.joints.get(id);
        if (j) initialPositions.set(id, { x: j.x, y: j.y });
    }

    state.drag = {
        type: jointIds.length > 1 ? DRAG_TYPES.CLUSTER : DRAG_TYPES.JOINT,
        id: hitJoint.id,
        jointIds: jointIds,
        initial: initialPositions,
        startWorld: { x: hitJoint.j.x, y: hitJoint.j.y },
        lastTarget: { x: hitJoint.j.x, y: hitJoint.j.y },
        arcRims,
        // TASK 584: the joints the drag CARRIES, each pulled toward its own target by every solve while the drag lasts (pullDrag; the engine
        // pulls every joint carrying a dragTarget): the grabbed point (its coincident cluster) and the rims an arc-centre grab adds (the arc
        // translates whole, like Fusion; a held rim makes it a pivot instead, getDragDOF). The other members (a centre-point rectangle's
        // group) are masked with the grab and follow the constraints.
        carried: Array.from(new Set([...cluster, ...arcRims])),
        pointerId: e.pointerId
    };

    // Stop further processing by the caller (ensures shape-selection etc. won't clear this)
    dbg.log('selection', '[selection-tools] joint selected', { id: hitJoint.id, selectedCount: state.selectedJoints.size });
    return true;
}

// A press on a point selects it (Shift adds it) and shows the coincident glyphs of its cluster. (A press on a point keeps the selected shapes.)
function selectJoint(e, state, id) {
    if (!state.selectedJoints) state.selectedJoints = new Set();
    if (!e.shiftKey) state.selectedJoints.clear();
    state.selectedJoints.add(id);
    // Visualize coincident constraints for this cluster so glyphs become visible
    try{ clearCoincidentGlyphFlags(state); showCoincidentGlyphsForCluster(state, findCoincidentCluster(id, state.constraints)); }catch(_){ }
}

/**
 * TASK 545: a drag that changes geometry is ONE undo step. The snapshot is taken ONCE per drag, at its first pointer move (before the
 * solver moves anything), through saveState; a press with no move saves nothing. A snap / inference constraint added on release joins
 * the same step (ensureDragUndo is a no-op once the drag has its snapshot).
 */
function dragUndoLabel(state) {
    const d = state.drag;
    if (d.group) return DRAG_GROUP_UNDO_LABEL;
    if (d.type === DRAG_TYPES.LINE) {
        const shape = (state.shapes || []).find(s => s.id === d.id);
        return (shape && DRAG_SHAPE_UNDO_LABELS[shape.type]) || DRAG_UNDO_LABELS[DRAG_TYPES.LINE];
    }
    return DRAG_UNDO_LABELS[d.type];
}
function ensureDragUndo(state) {
    if (!state.drag || state.drag.undoLen !== undefined) return;
    state.saveState(dragUndoLabel(state));
    state.drag.undoLen = state.history.length;
}
// A drag that ended exactly where it started (same joints, shapes and constraint count as its snapshot) leaves no step.
function settleDragUndo(state) {
    const len = state.drag && state.drag.undoLen;
    if (len === undefined || state.history.length !== len) return;
    const snap = state.history[len - 1];
    const same = snap.constraints.length === state.constraints.length
        && snap.joints.size === state.joints.size
        && [...snap.joints].every(([id, p]) => { const j = state.joints.get(id); return j && j.x === p.x && j.y === p.y; })
        && JSON.stringify(snap.shapes) === JSON.stringify(state.shapes);
    if (same) state.discardSnapshotAt(len);
}

/**
 * Handle shape selection
 */
function handleShapeSelection(e, svg, state, hitShape) {
    selectShape(e, state, hitShape.shape.id);
    return startShapeDrag(e, svg, state, hitShape);
}

// A press on a shape selects it (Shift toggles it).
function selectShape(e, state, id) {
    // Lazy-init selection sets — same pattern used for selectedShapes below.
    if (!state.selectedJoints) state.selectedJoints = new Set();
    if (!state.selectedConstraints) state.selectedConstraints = new Set();
    if (!e.shiftKey) { state.selectedJoints.clear(); state.selectedConstraints.clear(); }
    // Clear cluster glyphs when changing selection to a non-joint entity
    try{ clearCoincidentGlyphFlags(state); }catch(_){ }
    if(!state.selectedShapes) state.selectedShapes = new Set();
    if (e.shiftKey) {
        if (state.selectedShapes.has(id)) state.selectedShapes.delete(id);
        else state.selectedShapes.add(id);
    } else {
        state.selectedShapes.add(id);
    }
}

// The drag of one shape pressed on its body: a BODY drag (task 538), or the member joint targets of a kind without a body point.
function startShapeDrag(e, svg, state, hitShape) {
    const id = hitShape.shape.id;
    svg.setPointerCapture(e.pointerId);
    const initialPositions = new Map();
    const jointIds = hitShape.shape.joints.slice();
    for (const id of jointIds) {
        const j = state.joints.get(id);
        if (j) initialPositions.set(id, { x: j.x, y: j.y });
    }
    state.drag = {
        type: DRAG_TYPES.LINE,
        id: hitShape.shape.id,
        jointIds: jointIds,
        initial: initialPositions,
        startWorld: { x: hitShape.pt.x, y: hitShape.pt.y },
        lastTarget: { x: hitShape.pt.x, y: hitShape.pt.y },
        pointerId: e.pointerId
    };
    // TASK 538: the BODY point = the point of the shape that was grabbed, fixed ONCE here by its parameter (t along a line, the angle
    // on a circle / arc rim) through the shape kind's declared entry (definitions.js BODY_POINTS); the solver's spring pulls that point.
    // A kind without an entry (bezier) has no body point: its drag keeps the member joint targets below.
    const bodyKind = BODY_POINTS[hitShape.shape.type];
    if (bodyKind) state.drag.body = { shape: id, param: bodyKind.param(jointIds.map(jid => state.joints.get(jid)), hitShape.pt) };
    dbg.log('selection', '[selection-tools] shape selected', { id: hitShape.shape.id, selectedCount: state.selectedShapes.size });
    return true;
}

// True if shape1 and shape2 are already constrained to be (parallel | perpendicular)
// to each other — either explicitly via a PARALLEL/PERPENDICULAR constraint or
// implicitly via H/V locks on both lines. Used by canApplyInference to suppress
// redundant parallel/perpendicular hints during drag.
function isRelationshipAlreadyEnforced(state, shape1Id, shape2Id, wantParallel) {
    const constraints = state.constraints || [];
    const shapes = state.shapes || [];
    const matchingType = wantParallel ? CONSTRAINT_TYPES.PARALLEL : CONSTRAINT_TYPES.PERPENDICULAR;
    // Explicit constraint between the two
    for (const c of constraints) {
        if (c.type !== matchingType || !c.shapes || c.shapes.length !== 2) continue;
        const [a, b] = c.shapes;
        if ((a === shape1Id && b === shape2Id) || (a === shape2Id && b === shape1Id)) return true;
    }
    // H/V implicit relationship
    const s1 = shapes.find(s => s.id === shape1Id);
    const s2 = shapes.find(s => s.id === shape2Id);
    if (!s1 || !s2 || !Array.isArray(s1.joints) || !Array.isArray(s2.joints) || s1.joints.length < 2 || s2.joints.length < 2) return false;
    const samePair = (c, j1, j2) => c.joints && c.joints.length >= 2 &&
        ((c.joints[0] === j1 && c.joints[1] === j2) || (c.joints[0] === j2 && c.joints[1] === j1));
    const has = (s, type) => constraints.some(c => c.type === type && samePair(c, s.joints[0], s.joints[1]));
    const s1H = has(s1, CONSTRAINT_TYPES.HORIZONTAL);
    const s1V = has(s1, CONSTRAINT_TYPES.VERTICAL);
    const s2H = has(s2, CONSTRAINT_TYPES.HORIZONTAL);
    const s2V = has(s2, CONSTRAINT_TYPES.VERTICAL);
    if (wantParallel) return (s1H && s2H) || (s1V && s2V);
    return (s1H && s2V) || (s1V && s2H);
}

function canApplyInference(state, primaryId, inference, options = {}) {
    if (!inference || !primaryId) return false;
    const opts = { full: false, ...options };
    const type = inference.type;

    const lineShapes = state.shapes.filter(s => s && s.type === 'line' && Array.isArray(s.joints) && s.joints.includes(primaryId));

    if (type === INFERENCE_TYPES.HORIZONTAL || type === INFERENCE_TYPES.VERTICAL) {
        // During dragging (full: false), always allow position snapping for visual guidance
        // Only validate constraint addition when committing (full: true)
        if (!opts.full) return true;
        const cType = type === INFERENCE_TYPES.HORIZONTAL ? CONSTRAINT_TYPES.HORIZONTAL : CONSTRAINT_TYPES.VERTICAL;
        for (const s of lineShapes) {
            const res = ConstraintManager.canAddConstraint(state, cType, { joints: s.joints }, opts);
            if (res.ok) return true;
        }
        return false;
    }

    if (type === INFERENCE_TYPES.PARALLEL || type === INFERENCE_TYPES.PERPENDICULAR) {
        const targetId = inference.targetId;
        if (!targetId) return false;
        // Suppress inference when the geometric relationship is ALREADY enforced
        // by existing constraints — otherwise the snap fires on every drag frame
        // for, e.g., a horizontal-locked line being dragged along a vertical-locked
        // line (which are already perpendicular by construction). The snap value
        // would equal the cursor's current position and produce nothing but visual
        // noise.
        // TASK 582: "already enforced" also when the sketch's constraints IMPLY it (the engine's rank test, the one task 575's snap rule uses):
        // the owner's side is collinear with a construction line, so it is parallel to it by construction. Found at the cursor, that inference
        // held the dragged end on its own line until the cursor left the angle tolerance (task 578's staircase), and the release added a
        // redundant parallel.
        const wantParallel = type === INFERENCE_TYPES.PARALLEL;
        const cType = wantParallel ? CONSTRAINT_TYPES.PARALLEL : CONSTRAINT_TYPES.PERPENDICULAR;
        const impliedBySketch = (s) => !!(state.engine && typeof state.engine.isDistanceRedundant === 'function' && state.engine.isDistanceRedundant({ type: cType, shapes: [s.id, targetId] }));
        for (const s of lineShapes) {
            if (s.id === targetId) continue;
            if (isRelationshipAlreadyEnforced(state, s.id, targetId, wantParallel) || impliedBySketch(s)) return false;
        }
        // During dragging (full: false), always allow position snapping for visual guidance
        // Only validate constraint addition when committing (full: true)
        if (!opts.full) return true;
        for (const s of lineShapes) {
            if (s.id === targetId) continue;
            const res = ConstraintManager.canAddConstraint(state, cType, { shapes: [s.id, targetId] }, opts);
            if (res.ok) return true;
        }
        return false;
    }

    if (type === INFERENCE_TYPES.TANGENT) {
        const targetId = inference.targetId;
        if (!targetId) return false;
        for (const s of lineShapes) {
            const res = ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: s.id, circle: targetId }, opts);
            if (res.ok) return true;
        }
        return false;
    }

    if (type === INFERENCE_TYPES.MIDPOINT) {
        let anchors = null;
        const possibleRef = inference.ref ? (inference.ref.joints ? inference.ref : (inference.ref.ref ? inference.ref.ref : null)) : null;
        if (possibleRef && Array.isArray(possibleRef.joints)) {
            anchors = possibleRef.joints.slice(0, 2);
        } else if (inference.targetId) {
            const targetShape = state.shapes.find(x => x.id === inference.targetId);
            if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
        }
        if (!anchors || anchors.length !== 2) return false;
        const res = ConstraintManager.canAddConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primaryId] }, opts);
        return !!res.ok;
    }

    return true;
}

/**
 * Handle constraint selection
 */
function handleConstraintSelection(e, svg, state, hitConstraint) {
    if (!e.shiftKey) { state.selectedJoints.clear(); state.selectedShapes.clear(); }
    // Clear cluster glyphs when changing selection to a non-joint entity
    try{ clearCoincidentGlyphFlags(state); }catch(_){ }
    if(!state.selectedConstraints) state.selectedConstraints = new Set();
    if (e.shiftKey) {
        if (state.selectedConstraints.has(hitConstraint)) state.selectedConstraints.delete(hitConstraint);
        else state.selectedConstraints.add(hitConstraint);
    } else {
        state.selectedConstraints.add(hitConstraint);
    }
    dbg.log('selection', '[selection-tools] constraint selected', { selectedCount: state.selectedConstraints.size });
    return true;
}

/**
 * Handle pointer move for selection tools (dragging)
 */
export function handleSelectionPointerMove(e, svg, state) {
    // Debug trace to confirm pointer moves reach selection tools
    dbg.log('selection', '[selection-tools] pointerMove', {tool: state.currentTool, drag: state.drag?.type});
    
    // 0. Marquee Selection (Priority - runs without state.drag)
    if (selectionState.isMarqueeActive && selectionState.marqueeStart) {
        selectionState.marqueeEnd = { x: e.clientX, y: e.clientY };
        const width = selectionState.marqueeEnd.x - selectionState.marqueeStart.x;
        selectionState.selectMode = width > 0 ? 'window' : 'crossing';
        
        state.active = {
            mode: TOOL_MODES.SELECT,
            type: 'marquee',
            start: screenToWorld(svg, selectionState.marqueeStart.x, selectionState.marqueeStart.y),
            end: screenToWorld(svg, selectionState.marqueeEnd.x, selectionState.marqueeEnd.y),
            selectMode: selectionState.selectMode
        };
        return true;
    }

    if (!state.drag) return false;

    // 1. Dragging a Dimension: the value moves freely (labelPos); the offset handle moves the dimension line
    if (state.drag.type === DRAG_TYPES.DIMENSION) {
        const wpt = screenToWorld(svg, e.clientX, e.clientY);
        const c = state.drag.constraint;
        if (state.drag.mode === 'label') {
            dragDimensionLabel(state, state.drag, e, wpt);
            return true;
        }
        // If this is a radial (circle) dimension, compute radial offset from center
        if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
            const s1 = state.shapes.find(s => s.id === c.shapes[0]);
            const s2 = state.shapes.find(s => s.id === c.shapes[1]);
            if (s1 && s2 && s1.joints && s2.joints) {
                const j1 = state.joints.get(s1.joints[0]), j2 = state.joints.get(s1.joints[1]);
                const j3 = state.joints.get(s2.joints[0]), j4 = state.joints.get(s2.joints[1]);
                if (j1 && j2 && j3 && j4) {
                    const int = getLineIntersection(j1, j2, j3, j4);
                    if (int) {
                        c.offset = getDist(int, wpt);
                    }
                }
            }
            return true;
        } else if (c && c.isRadius) {
            const shape = c.shape ? state.shapes.find(s => s.id === c.shape) : null;
            const center = (shape && shape.joints && shape.joints[0]) ? state.joints.get(shape.joints[0]) : null;
            if (center) placeRadiusLabel(c, center, wpt);
        } else {
            const j1 = state.joints.get(c.joints[0]);
            const j2 = state.joints.get(c.joints[1]);
            if (j1 && j2) {
                c.offset = perpendicularDistance(wpt, j1, j2);
            }
        }
        return true;
    }

    if (state.currentTool !== TOOL_MODES.SELECT) return false;
    ensureDragUndo(state); // TASK 545: the first move of a geometry drag takes its ONE undo snapshot, before anything moves

    // 2. Standard Dragging (Joints/Lines)
    const wpt = screenToWorld(svg, e.clientX, e.clientY);

    // Track whether we've moved far enough during the drag to consider it a real drag
    try{
        if (selectionState.dragStartScreen) {
            const dxs = e.clientX - selectionState.dragStartScreen.x;
            const dys = e.clientY - selectionState.dragStartScreen.y;
            const moved = Math.hypot(dxs, dys);
            if (moved > 5) selectionState.isDragging = true;
        }
    }catch(_){ }
    if (state.drag.group && !selectionState.isDragging) return true; // TASK 588: a group drag moves once the pointer leaves the click radius

    // Drag step (TASK 548): a JOINT drag never moves its target more than MAX_DRAG_STEP world units in one go (a lag spike, focus loss or a
    // fast flick is a huge jump). A longer pointer jump is walked as straight sub-moves of at most that length from the last pointer
    // position, each through the whole step below (mask, inference, target, solve) as a pointer event there would be, solved to convergence
    // (no frame solve runs between sub-moves); the last sub-move is the pointer itself, so the joint is under the cursor (or at the closest
    // reachable pose) in THIS event. The step used to clamp the target to MAX_DRAG_STEP from the joint instead, so the joint trailed the
    // cursor and stayed behind when the cursor stopped.
    const maxStep = SolverConfig.MAX_DRAG_STEP;
    const from = state.drag.lastPointer || state.drag.startWorld;
    const jump = Math.hypot(wpt.x - from.x, wpt.y - from.y);
    const n = (maxStep > 0 && state.drag.id && state.joints.has(state.drag.id)) ? Math.max(1, Math.ceil(jump / maxStep)) : 1;
    for (let k = 1; k < n; k++) dragToward(e, svg, state, { x: from.x + (wpt.x - from.x) * k / n, y: from.y + (wpt.y - from.y) * k / n }, false);
    dragToward(e, svg, state, wpt, true);
    state.drag.lastPointer = wpt;
    return true;
}

// One step of a geometry drag toward the world point wpt: the DOF mask, the drag target and the solver pass, the snap or inference.
// atPointer: wpt is the pointer itself. The snap found for this pointer event applies only there, and the solver pass is the quick one
// (the app's frame solve follows it); a sub-move of the drag step is not at the pointer and is solved to convergence (SolverConfig.ITERATIONS).
// TASK 582 (Fusion, measured with the real mouse): a JOINT / CLUSTER drag takes its SNAP from where the solve PUTS the dragged point, not
// from where the cursor is. The step first pulls toward the masked cursor (a PRE-SOLVE in this same event, the quick pass: the previous
// frame's position is one event late, and once a snap has pinned the point it sits on the snap point and would keep any snap locked); the
// dragged joint's solved position `reached` then takes the cursor's snap candidate (input-manager updateSnapTarget) only when the candidate's
// point is within the snap magnet of it (a point held on a line that cannot reach the target does not snap, and the release adds nothing).
// The inference stays found at the masked cursor (see below). A pin (the snap point, the inferred position) is a second pull. A free point
// reaches the cursor: its snap is the cursor's, as before. A BODY / LINE drag is unchanged: its snap is taken at the cursor, no inference.
function dragToward(e, svg, state, wpt, atPointer) {
    const iters = atPointer ? (SolverConfig.QUICK_SOLVE || 8) : (SolverConfig.ITERATIONS || 500);
    const pointDrag = state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER;

    // Default target: raw mouse position
    let target = wpt;
    let pivot = null;

    // 3. Constraint-Aware Input Masking (Rigid Drag)
    // Apply masking when dragging joints, clusters, or whole shapes/lines. Not for a BODY point drag (task 538): the mask reads the
    // member JOINTS' freedom (a held centre would lock a whole circle), while the body spring moves only what the constraints allow.
    if ((pointDrag || state.drag.type === DRAG_TYPES.LINE) && !state.drag.body) {
        // Calculate deltas relative to START position to keep dragging consistent
        const startPos = state.drag.startWorld;
        let dx = target.x - startPos.x;
        let dy = target.y - startPos.y;

        // Get allowed degrees of freedom (for shapes, state.drag.jointIds contains the member joints)
        const dof = getDragDOF(state, state.drag.jointIds, state.drag);
        const { lockX, lockY, guideLine } = dof;
        pivot = dof.pivot || null;

        // Apply Guide Line Projection (if valid and not fully locked)
        if (guideLine && !lockX && !lockY) {
            const p1 = guideLine.p1;
            const p2 = guideLine.p2;
            const lineDx = p2.x - p1.x;
            const lineDy = p2.y - p1.y;
            const lenSq = lineDx*lineDx + lineDy*lineDy;

            if (lenSq > 1e-6) {
                // Project delta onto the line vector
                const dot = (dx * lineDx + dy * lineDy) / lenSq;
                dx = dot * lineDx;
                dy = dot * lineDy;
            }
        }

        // Apply Axis Locks
        if (lockX) dx = 0;
        if (lockY) dy = 0;

        // Reconstruct filtered target
        target = { x: startPos.x + dx, y: startPos.y + dy };

        // TASK 582: an arc turning about its held rim (getDragDOF pivot): the grabbed centre keeps its distance to the pivot, so its target is
        // the point of that circle nearest the cursor (the radius stays; the rims are not carried, the other one follows the constraints, pullDrag).
        if (pivot) {
            const R = Math.hypot(startPos.x - pivot.x, startPos.y - pivot.y), vx = wpt.x - pivot.x, vy = wpt.y - pivot.y, len = Math.hypot(vx, vy);
            target = len > 0 ? { x: pivot.x + vx / len * R, y: pivot.y + vy / len * R } : { x: startPos.x, y: startPos.y };
        }
    }

    // TASK 582: the pre-solve of a point drag, and where it put the dragged joint
    let reached = target;
    if (pointDrag) {
        pullDrag(state, target, iters, pivot);
        const j = state.joints.get(state.drag.id);
        if (j) reached = { x: j.x, y: j.y };
    }

    let smoothed = target;

    // UNIFIED BEHAVIOR: Prefer the 'isLocked' flag computed by input-manager, but fall back to a local proximity check
    // so tests that set state.activeSnap directly (without running input-manager) still get expected lock behavior.
    let activeIsLocked = false;
    if (atPointer && state.activeSnap) {
        // Use explicit flag if present
        if (typeof state.activeSnap.isLocked === 'boolean') activeIsLocked = state.activeSnap.isLocked;
        else {
            // Fallback: compute proximity-based lock using available snap pt
            try{
                let snapPt = null;
                if (state.activeSnap.pt) snapPt = state.activeSnap.pt;
                else if (typeof state.activeSnap.x === 'number' && typeof state.activeSnap.y === 'number') snapPt = { x: state.activeSnap.x, y: state.activeSnap.y };
                else if (state.activeSnap.targetId) { const j = state.joints.get(state.activeSnap.targetId); if (j) snapPt = { x: j.x, y: j.y }; }
                else if (state.activeSnap.id) { const j = state.joints.get(state.activeSnap.id); if (j) snapPt = { x: j.x, y: j.y }; }

                if (snapPt && typeof e?.clientX === 'number' && typeof e?.clientY === 'number') {
                    const screenPt = (() => { try { return worldToScreen(svg, snapPt); } catch(_) { return null; } })();
                    if (screenPt) {
                        const dist = Math.hypot(e.clientX - screenPt.x, e.clientY - screenPt.y);
                        activeIsLocked = isWithinMagnet(dist, 'snap');
                    }
                }
            }catch(_){ activeIsLocked = false; }
        }
    }

    // Normalize the candidate's snap point (some snap objects use .pt, others use x/y or id/targetId)
    let snapPt = null;
    if (state.activeSnap && activeIsLocked && (state.activeSnap.type === 'joint' || state.activeSnap.type === 'line' || state.activeSnap.type === 'shape' || state.activeSnap.type === 'grid' || AXIS_SNAP_TARGETS[state.activeSnap.type])) {
        try{
            if (state.activeSnap.pt) snapPt = state.activeSnap.pt;
            else if (typeof state.activeSnap.x === 'number' && typeof state.activeSnap.y === 'number') snapPt = { x: state.activeSnap.x, y: state.activeSnap.y };
            else if (state.activeSnap.targetId) { const j = state.joints.get(state.activeSnap.targetId); if (j) snapPt = { x: j.x, y: j.y }; }
            else if (state.activeSnap.id) { const j = state.joints.get(state.activeSnap.id); if (j) snapPt = { x: j.x, y: j.y }; }
        }catch(_){ snapPt = null; }
    }

    // TASK 582: a point drag takes the snap only when the dragged point REACHES it: its solved position within the snap magnet of the snap
    // point (the release distance when the previous step held this same target, as input-manager's hysteresis). A candidate it does not take
    // is no lock: the renderer shows none, the release adds no constraint, and input-manager's release-jitter recovery has no lock to restore.
    // TASK 588: a GROUP drag (the selection moving) takes no snap: it is a solver move only (and, a cluster drag, it infers nothing: task 584).
    if (state.drag.group) {
        if (state.lastLockedSnap === state.activeSnap) state.lastLockedSnap = null;
        state.snapTarget = null;
        state.activeSnap = null;
        snapPt = null;
    }

    if (snapPt && pointDrag) {
        const a = worldToScreen(svg, reached), b = worldToScreen(svg, snapPt);
        const held = !!state.drag.lockedTo && state.drag.lockedTo === snapIdOf(state.activeSnap);
        if (!isWithinMagnet(Math.hypot(a.x - b.x, a.y - b.y), 'snap', held)) {
            if (state.lastLockedSnap === state.activeSnap) state.lastLockedSnap = null;
            state.snapTarget = null;
            state.activeSnap = null;
            snapPt = null;
        }
    }

    if (snapPt) {
        smoothed = snapPt;
        state.inference = null; // Clear inference when snapped
        // Track locked target for debugging and release validation
        state.drag.lockedTo = snapIdOf(state.activeSnap);
        try{
            const selVerbose = (typeof window !== 'undefined' && window.ug && window.ug.debug && window.ug.debug.verboseSelectionLogs) ? true : false;
            const lastLocked = state.drag._lastLockedTo || null;
            const nowLocked = state.drag.lockedTo || null;
            if(selVerbose || lastLocked !== nowLocked){
                dbg.log('selection', '[selection-tools] drag LOCKED to snap', { draggedId: state.drag && state.drag.id, target: nowLocked });
                state.drag._lastLockedTo = nowLocked;
            }
        }catch(_){ }
    } else {
        // If not locked, ensure we don't keep a stale lockedTo
        delete state.drag.lockedTo;

        // Axis Inference (H/V relative to start). Found at the (masked) cursor, NOT where the pre-solve put the point (TASK 582, measured): the
        // at-pointer pass is the quick one (task 548), so on a stiff drawing (the owner's 2.7 km arcs at the framed view, about 40 units per 4 px
        // event) it leaves the point behind the cursor; an inference found there pins it behind, the frame solve holds that pin and the drag
        // stalls (j3 stopped after 3 events). An inference the sketch already implies pins nothing (canApplyInference).
        // TASK 584: a CLUSTER drag (a corner of coincident joints, an arc by its centre, a centre-point rectangle's centre) infers NOTHING.
        // findInference has the attached-line tests for a single dragged joint only; for any other drag it read the displacement start ->
        // cursor as a line being DRAWN (tangent to a circle the start lies on, parallel / perpendicular to a nearby line): the point's
        // motion, not a line of the sketch, so the inferred pose is one the point cannot take (the owner's j3 corner, its side radial, showed
        // a tangent to the arc it sits on). Fusion: to verify; the conservative choice (no inference the point cannot satisfy).
        if (state.drag.type === DRAG_TYPES.CLUSTER) state.inference = null;
        else if (pointDrag) {
            const primaryId = state.drag.id;
            const initialPos = state.drag.initial.get(primaryId);
            if (initialPos) {
                // Check inference relative to start position (allow full geometry-based inference)
                const inf = findInference(initialPos, target, state.shapes || [], state.joints || new Map(), state.snapTarget || null, { draggedId: primaryId, draggedType: 'joint', worldPerPx: getZoomFactor(svg), constraints: state.constraints });
                if (inf) {
                    const infState = { type: inf.type, pos: inf.pos, origin: initialPos, targetId: inf.targetId || null, ref: inf };
                    if (canApplyInference(state, primaryId, infState, { full: false })) {
                        state.inference = infState;
                        smoothed = inf.pos;
                        console.log('[INFERENCE] Applying:', infState.type, 'pos:', inf.pos, 'target:', target, 'smoothed:', smoothed);
                    } else {
                        state.inference = null;
                    }
                } else {
                    state.inference = null;
                }
            }
        }
    }

    state.drag.lastTarget = smoothed;

    // A BODY drag (task 538) carries ONE target: the grabbed point of the shape goes to the cursor (shape.dragTarget, read by every
    // solve while the drag lasts: this pass and the app's frame solve); no member joint gets a target.
    // The target is the engine's (bodyDragTarget): the body point's reachable directions (the body-point form of the joint DOF mask),
    // the kind's preferred temporary holds (a rim drag keeps the centre when it can); a rim point lies on the cursor's ray from the centre.
    if (state.drag.body) {
        const shape = (state.shapes || []).find(s => s.id === state.drag.body.shape);
        const t = state.engine.bodyDragTarget(state.drag.body, smoothed);
        state.drag.lastTarget = { x: t.x, y: t.y };
        shape.dragTarget = { param: t.body.param, hold: t.body.hold, x: t.x, y: t.y };
        state.engine.solve(iters, { dragTarget: { ...t, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 } });
        return;
    }
    // a point drag already pulled toward `target` (the pre-solve): only a pin pulls again
    if (!pointDrag || smoothed !== target) pullDrag(state, smoothed, iters, pivot);
}

// The id a snap target locks to (state.drag.lockedTo): its joint / target id, or the snapped line or shape.
function snapIdOf(snap) {
    return snap.targetId || snap.id || ((snap.type === 'line' || snap.type === 'shape') && snap.shape ? snap.shape.id : null) || null;
}

// Pull the drag toward the world point `to`: the drag targets of the joints it carries and a solver pass of `iters` iterations.
// pivot (TASK 582, getDragDOF: an arc grabbed by its centre with one held rim): the rims are not carried, the arc turns about the held one
// as its constraints require (radius kept).
function pullDrag(state, to, iters, pivot) {
    // NATIVE SOLVER DRAG: Set drag targets on joints instead of forcing positions
    // This tells the solver "try to be here", but allows constraints to override.
    // TASK 584: every joint the drag CARRIES (state.drag.carried; a shape drag with no body point carries all its members) gets the grab's
    // displacement as its target, and every solve while the drag lasts pulls each of them (engine._jointDragSprings; a fixed joint never
    // produces a spring). Before, the targets were set but the solver pulled only one joint, so the rims of an arc dragged by its centre
    // lagged and the radius changed.
    const start = state.drag.startWorld;
    const dx = to.x - start.x, dy = to.y - start.y;
    const rims = pivot ? (state.drag.arcRims || []) : [];
    console.log('[DRAG] smoothed:', to, 'startWorld:', start, 'dx/dy:', dx, dy);
    for (const id of (state.drag.carried || state.drag.jointIds)) {
        if (rims.includes(id)) continue;
        const init = state.drag.initial.get(id), j = state.joints.get(id);
        if (j && init) {
            j.dragTarget = { x: init.x + dx, y: init.y + dy };
            console.log('[DRAG] Joint', id, 'init:', init, 'dragTarget:', j.dragTarget);
        }
    }

    // Immediately invoke a quick solver pass with an explicit dragTarget so the
    // engine treats the mouse as a "weak target" (mouse_spring) and enforces
    // structural constraints deterministically in the same frame.
    try {
        const primary = state.drag && state.drag.id ? state.drag.id : (state.drag && state.drag.jointIds && state.drag.jointIds[0]);
        if (state.engine && primary) {
            // the grabbed joint's own target: its start + the grab's displacement. That is `to` for every drag that starts ON its joint
            // (startWorld = the joint); a GROUP drag (task 588) starts at the cursor, so its first member's target is not the cursor itself.
            const init0 = !pivot && state.drag.initial && state.drag.initial.get(primary);
            const pt = init0 ? { x: init0.x + dx, y: init0.y + dy } : to;
            const dt = { jointId: primary, x: pt.x, y: pt.y, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 };
            try { state.engine.solve(iters, { dragTarget: dt }); } catch (_) { /* fail-open */ }
        }
    } catch (_) { }
}

/**
 * Handle pointer up for selection tools
 */
export function handleSelectionPointerUp(e, svg, state) {
    dbg.log('selection', '[selection-tools] pointerUp', {tool: state.currentTool});

    if (selectionState.isMarqueeActive) {
        const start = screenToWorld(svg, selectionState.marqueeStart.x, selectionState.marqueeStart.y);
        const end = screenToWorld(svg, selectionState.marqueeEnd.x, selectionState.marqueeEnd.y);
        
        const x1 = Math.min(start.x, end.x);
        const x2 = Math.max(start.x, end.x);
        const y1 = Math.min(start.y, end.y);
        const y2 = Math.max(start.y, end.y);
        
        const inRect = (p) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
        
        // Select Shapes
        const inert = inertEntities(state); // TASK 577: a marquee selects nothing of a locked or hidden sketch
        state.shapes.forEach(s => {
            if (s.joints && !isShapeInert(inert, s.id)) {
                const joints = s.joints.map(jid => state.joints.get(jid)).filter(j => j);
                if (joints.length > 0) {
                    const allIn = joints.every(j => inRect(j));
                    const anyIn = joints.some(j => inRect(j));
                    
                    if (selectionState.selectMode === 'window') {
                        if (allIn) state.selectedShapes.add(s.id);
                    } else {
                        if (anyIn) state.selectedShapes.add(s.id);
                    }
                }
            }
        });
        
        // Select Joints
        state.joints.forEach((j, id) => {
            if (id === 'j_origin' || isJointInert(inert, id)) return;
            if (inRect(j)) state.selectedJoints.add(id);
        });
        
        selectionState.isMarqueeActive = false;
        state.active = null;
        try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
        return true;
    }
    
    // Cleanup drag targets so joints stop trying to follow the mouse (a body drag: its shape's one target, task 538), BEFORE a
    // snap-on-release below solves (TASK 575: the one release, #ui/sketch-state.js releaseDragTargets)
    releaseDragTargets(state, state.drag);

    // TASK 588: a group drag adds nothing on release; released without a move it was a click on the pressed member: that entity alone is
    // then selected, exactly as the press selected it before (selectShape / selectJoint after the press's clear).
    if (state.drag && state.drag.group && state.drag.click && !selectionState.isDragging) {
        const press = { shiftKey: false };
        if (state.drag.click.kind === 'shape') { clearSelection(state); selectShape(press, state, state.drag.click.id); }
        else selectJoint(press, state, state.drag.click.id);
    }

    if (state.drag && !state.drag.group && (state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER)) {
        // Only consider snap-on-release if the user actually dragged the pointer a meaningful distance.
        // Treat small pointer movements as a click (selection-only) to avoid accidental snap creation.
        const MIN_DRAG_THRESHOLD = 5; // pixels
        let performedDrag = false;
        try{
            if (selectionState.dragStartScreen) {
                const dx = e.clientX - selectionState.dragStartScreen.x;
                const dy = e.clientY - selectionState.dragStartScreen.y;
                const dist = Math.hypot(dx, dy);
                // Consider it a drag if we either ever moved beyond threshold during the drag
                // or if the final release point is sufficiently far from the start.
                performedDrag = selectionState.isDragging || (dist > MIN_DRAG_THRESHOLD);
            }
        }catch(_){ performedDrag = false; }

        if (performedDrag) {
            dbg.log('selection', '[selection-tools] pointerUp performedDrag', { activeSnap: state.activeSnap, inference: state.inference });
            // Use the unified active snap computed by input-manager and only create a constraint
            // if the snap is currently locked. We check both the fresh 'isLocked' flag (from pointerUp update)
            // and the drag state's 'lockedTo' (historical intent) to be robust against release jitter.
            const snap = state.activeSnap;
            // Note: input-manager now handles snap recovery, so state.activeSnap is reliable here.
            {
                // Enhanced snap-on-release: treat a proximity drop onto a joint as a valid snap even if explicit 'isLocked' wasn't set
                let shouldApplySnap = false;
                if (snap && state.drag) {
                  shouldApplySnap = !!(snap.isLocked || state.drag.lockedTo);
                  // Fallback: if snapping to a joint and pointer is within magnet range, allow applying the snap on release
                  if (!shouldApplySnap && snap.type === 'joint' && state.lastMouse) {
                    try {
                      const targetId = snap.targetId || snap.id || null;
                      const tj = targetId ? state.joints.get(targetId) : null;
                      if (tj) {
                        const screenPt = worldToScreen(svg, tj);
                        const dist = Math.hypot((state.lastMouse.x || 0) - screenPt.x, (state.lastMouse.y || 0) - screenPt.y);
                        if (isWithinMagnet(dist, 'snap')) shouldApplySnap = true;
                      }
                    } catch (_) { shouldApplySnap = shouldApplySnap; }
                  }
                }

                if (shouldApplySnap) {
                  // GRID SNAP EXCEPTION: Do not create constraints for grid snaps.
                  // The geometry has already been moved to the grid point by the drag handler.
                  if (snap.type !== 'grid') {
                      try{ dbg.log('selection', '[selection-tools] creating snap-based constraint (from state.activeSnap)', { dragIds: state.drag && state.drag.jointIds, snap, lockedTo: state.drag && state.drag.lockedTo }); }catch(_){ }
                      try{
                          ensureDragUndo(state);
                          const dragged = state.drag.jointIds || [];
                          const primary = state.drag.id;
                          // Filter primary out of excludeJoints to avoid blocking the constraint if applySnapConstraint checks source against exclude list
                          const exclude = dragged.filter(id => id !== primary);
                          try{ 
                              // Use filtered exclude list (allowPointOnLine defaults to true)
                              const applied = applySnapConstraint(state, primary, snap, { excludeJoints: exclude });
                              console.log('[selection-tools] applySnapConstraint returned', applied, 'snap:', snap, 'primary:', primary, 'exclude:', exclude);
                              if(applied) dbg.log('selection', '[selection-tools] constraint applied for primary joint', primary);
                          }catch(e){ console.error('[selection-tools] snap error', e); }

                          // Apply inference constraints once (full validation) to match toolbar behavior.
                          try{
                              if (state.inference && canApplyInference(state, primary, state.inference, { full: true })) {
                                  const dir = state.inference.type;
                                  const shapesToConstrain = state.shapes.filter(s => s.type === 'line' && Array.isArray(s.joints) && s.joints.includes(primary));

                                  for (const s of shapesToConstrain) {
                                      try{
                                          if (dir === INFERENCE_TYPES.HORIZONTAL) {
                                              ConstraintManager.addHorizontal(state, s.joints, { source: 'inference', autoSolve: true });
                                          } else if (dir === INFERENCE_TYPES.VERTICAL) {
                                              ConstraintManager.addVertical(state, s.joints, { source: 'inference', autoSolve: true });
                                          } else if (dir === INFERENCE_TYPES.PARALLEL && state.inference.targetId && s.id !== state.inference.targetId) {
                                              ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [s.id, state.inference.targetId] }, { source: 'inference', autoSolve: true });
                                          } else if (dir === INFERENCE_TYPES.PERPENDICULAR && state.inference.targetId && s.id !== state.inference.targetId) {
                                              ConstraintManager.addPerpendicular(state, s.id, state.inference.targetId, { source: 'inference', autoSolve: true });
                                          } else if (dir === INFERENCE_TYPES.TANGENT && state.inference.targetId) {
                                              try { ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: s.id, circle: state.inference.targetId }, { source: 'inference', autoSolve: true }); } catch(_){ }
                                          } else if (dir === INFERENCE_TYPES.MIDPOINT) {
                                              let anchors = null;
                                              const possibleRef = state.inference && state.inference.ref ? (state.inference.ref.joints ? state.inference.ref : (state.inference.ref.ref ? state.inference.ref.ref : null)) : null;
                                              if (possibleRef && Array.isArray(possibleRef.joints)) {
                                                  anchors = possibleRef.joints.slice(0,2);
                                              } else if (state.inference && state.inference.targetId) {
                                                  const targetShape = state.shapes.find(x => x.id === state.inference.targetId);
                                                  if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
                                              }
                                              if (anchors && anchors.length === 2) {
                                                  try{ ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primary] }, { source: 'inference', autoSolve: true }); }catch(_){ }
                                              }
                                          }
                                      }catch(_){ }
                                  }

                                  if (shapesToConstrain.length === 0 && state.inference.type === INFERENCE_TYPES.MIDPOINT) {
                                      let anchors = null;
                                      const possibleRef = state.inference && state.inference.ref ? (state.inference.ref.joints ? state.inference.ref : (state.inference.ref.ref ? state.inference.ref.ref : null)) : null;
                                      if (possibleRef && Array.isArray(possibleRef.joints)) {
                                          anchors = possibleRef.joints.slice(0,2);
                                      } else if (state.inference && state.inference.targetId) {
                                          const targetShape = state.shapes.find(x => x.id === state.inference.targetId);
                                          if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
                                      }
                                      if (anchors && anchors.length === 2) {
                                          try{ ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primary] }, { source: 'inference', autoSolve: true }); }catch(_){ }
                                      }
                                  }
                              }
                          }catch(_){ }

                      }catch(_){ }
                  }
                } else {
                  try{ dbg.log('selection', '[selection-tools] skipping snap-on-release — no active locked snap (no visual lock present)'); }catch(_){ }
                  // Apply inference constraints even when no snap lock was present (commit on release)
                  try{
                      if (state.inference && canApplyInference(state, state.drag && state.drag.id, state.inference, { full: true })) {
                          ensureDragUndo(state);
                          const primary = state.drag && state.drag.id;
                          const dir = state.inference.type;
                          const shapesToConstrain = state.shapes.filter(s => s.type === 'line' && Array.isArray(s.joints) && s.joints.includes(primary));

                          for (const s of shapesToConstrain) {
                              try{
                                  if (dir === INFERENCE_TYPES.HORIZONTAL) {
                                      ConstraintManager.addHorizontal(state, s.joints, { source: 'inference', autoSolve: true });
                                  } else if (dir === INFERENCE_TYPES.VERTICAL) {
                                      ConstraintManager.addVertical(state, s.joints, { source: 'inference', autoSolve: true });
                                  } else if (dir === INFERENCE_TYPES.PARALLEL && state.inference.targetId && s.id !== state.inference.targetId) {
                                      ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [s.id, state.inference.targetId] }, { source: 'inference', autoSolve: true });
                                  } else if (dir === INFERENCE_TYPES.PERPENDICULAR && state.inference.targetId && s.id !== state.inference.targetId) {
                                      ConstraintManager.addPerpendicular(state, s.id, state.inference.targetId, { source: 'inference', autoSolve: true });
                                  } else if (dir === INFERENCE_TYPES.TANGENT && state.inference.targetId) {
                                      try { ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: s.id, circle: state.inference.targetId }, { source: 'inference', autoSolve: true }); } catch(_){ }
                                  } else if (dir === INFERENCE_TYPES.MIDPOINT) {
                                      let anchors = null;
                                      const possibleRef = state.inference && state.inference.ref ? (state.inference.ref.joints ? state.inference.ref : (state.inference.ref.ref ? state.inference.ref.ref : null)) : null;
                                      if (possibleRef && Array.isArray(possibleRef.joints)) {
                                          anchors = possibleRef.joints.slice(0,2);
                                      } else if (state.inference && state.inference.targetId) {
                                          const targetShape = state.shapes.find(x => x.id === state.inference.targetId);
                                          if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
                                      }
                                      if (anchors && anchors.length === 2) {
                                          try{ ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primary] }, { source: 'inference', autoSolve: true }); }catch(_){ }
                                      }
                                  }
                              }catch(_){ }
                          }

                          if (shapesToConstrain.length === 0 && state.inference.type === INFERENCE_TYPES.MIDPOINT) {
                              let anchors = null;
                              const possibleRef = state.inference && state.inference.ref ? (state.inference.ref.joints ? state.inference.ref : (state.inference.ref.ref ? state.inference.ref.ref : null)) : null;
                              if (possibleRef && Array.isArray(possibleRef.joints)) {
                                  anchors = possibleRef.joints.slice(0,2);
                              } else if (state.inference && state.inference.targetId) {
                                  const targetShape = state.shapes.find(x => x.id === state.inference.targetId);
                                  if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
                              }
                              if (anchors && anchors.length === 2) {
                                  try{ ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primary] }, { source: 'inference', autoSolve: true }); }catch(_){ }
                              }
                          }

                      }
                  } catch(_){ }
                }
            }

            // If there was no active snap object at all, still attempt inference-commit on release
            if (!state.activeSnap) {
                try{
                    if (state.inference && canApplyInference(state, state.drag && state.drag.id, state.inference, { full: true })) {
                        ensureDragUndo(state);
                        const primary = state.drag && state.drag.id;
                        const dir = state.inference.type;
                        const shapesToConstrain = state.shapes.filter(s => s.type === 'line' && Array.isArray(s.joints) && s.joints.includes(primary));
                        for (const s of shapesToConstrain) {
                            try{
                                if (dir === INFERENCE_TYPES.HORIZONTAL) {
                                    ConstraintManager.addHorizontal(state, s.joints, { source: 'inference', autoSolve: true });
                                } else if (dir === INFERENCE_TYPES.VERTICAL) {
                                    ConstraintManager.addVertical(state, s.joints, { source: 'inference', autoSolve: true });
                                } else if (dir === INFERENCE_TYPES.PARALLEL && state.inference.targetId && s.id !== state.inference.targetId) {
                                    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.PARALLEL, { shapes: [s.id, state.inference.targetId] }, { source: 'inference', autoSolve: true });
                                } else if (dir === INFERENCE_TYPES.PERPENDICULAR && state.inference.targetId && s.id !== state.inference.targetId) {
                                    ConstraintManager.addPerpendicular(state, s.id, state.inference.targetId, { source: 'inference', autoSolve: true });
                                } else if (dir === INFERENCE_TYPES.TANGENT && state.inference.targetId) {
                                    try { ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.TANGENT, { line: s.id, circle: state.inference.targetId }, { source: 'inference', autoSolve: true }); } catch(_){ }
                                } else if (dir === INFERENCE_TYPES.MIDPOINT) {
                                    let anchors = null;
                                    const possibleRef = state.inference && state.inference.ref ? (state.inference.ref.joints ? state.inference.ref : (state.inference.ref.ref ? state.inference.ref.ref : null)) : null;
                                    if (possibleRef && Array.isArray(possibleRef.joints)) {
                                        anchors = possibleRef.joints.slice(0,2);
                                    } else if (state.inference && state.inference.targetId) {
                                        const targetShape = state.shapes.find(x => x.id === state.inference.targetId);
                                        if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
                                    }
                                    if (anchors && anchors.length === 2) {
                                        try{ ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primary] }, { source: 'inference', autoSolve: true }); }catch(_){ }
                                    }
                                }
                            }catch(_){ }
                        }
                        if (shapesToConstrain.length === 0 && state.inference.type === INFERENCE_TYPES.MIDPOINT) {
                            let anchors = null;
                            const possibleRef = state.inference && state.inference.ref ? (state.inference.ref.joints ? state.inference.ref : (state.inference.ref.ref ? state.inference.ref.ref : null)) : null;
                            if (possibleRef && Array.isArray(possibleRef.joints)) {
                                anchors = possibleRef.joints.slice(0,2);
                            } else if (state.inference && state.inference.targetId) {
                                const targetShape = state.shapes.find(x => x.id === state.inference.targetId);
                                if (targetShape && targetShape.joints && targetShape.joints.length >= 2) anchors = [targetShape.joints[0], targetShape.joints[1]];
                            }
                            if (anchors && anchors.length === 2) {
                                try{ ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.MIDPOINT, { joints: [anchors[0], anchors[1], primary] }, { source: 'inference', autoSolve: true }); }catch(_){ }
                            }
                        }
                    }
                } catch(_) { }
            }

        } else {
            try{ dbg.log('selection', '[selection-tools] pointerUp treated as click — skipping snap-on-release (drag distance below threshold)'); }catch(_){ }
        }
    }
    settleDragUndo(state);
    // Clear any temporary drag snap preview state
    try{ delete state.activeSnap; }catch(_){ }
    if (state.drag && state.drag.pointerId) {
        try { svg.releasePointerCapture(state.drag.pointerId); } catch (_) {}
    }
    state.drag = null;
    state.inference = null;
    // Clear stored drag start screen and drag flag to avoid stale values
    selectionState.dragStartScreen = null;
    selectionState.isDragging = false;
    return true;
}

/**
 * Reset selection state
 */
export function resetSelectionState() {
    selectionState.isDragging = false;
    selectionState.dragStartScreen = null;
    selectionState.isMarqueeActive = false;
    selectionState.marqueeStart = null;
    selectionState.marqueeEnd = null;
}

// Re-export for external diagnostics (canonical source is hover-manager.js)
