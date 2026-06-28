// ═══════════════════════════════════════════════════════════════════════════════
// SELECTION TOOLS - Handles selection, dragging, and dimension label interaction
// ═══════════════════════════════════════════════════════════════════════════════
// Shared UI (#ui/input-handlers/). Relocated VERBATIM from apps/sketchstudio in slice S4d.
// TODO(shaper): parameterize the DOM reaches before Shaper adopts this — relocation only for now.

import { dbg } from '#core/debug.js';
import { TOOL_MODES, DRAG_TYPES, SNAP, CONSTRAINT_TYPES } from '#core/constants.js';
import { findCoincidentCluster, hitJointAtScreen } from '#ui/snap-detection.js';
import { addConstraint } from '#core/constraints.js';
import { screenToWorld, worldToScreen } from '#ui/coords.js';
import { perpendicularDistance, getDist, projectPointOnLine, getLineIntersection } from '#core/geometry.js';
import { showEditInput } from '#ui/numeric-input-manager.js';
import { applySnapConstraint } from '#core/snap-constraints.js';
import { findInference } from '#core/inference-engine.js';
import SettingsManager from '#core/settings-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { isWithinMagnet } from '#ui/snap-magnet.js';
import { INFERENCE_TYPES } from '#core/constants.js';
import { ConstraintManager } from '#core/constraint-manager.js';

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
import { findClosestConstraintGlyph, getScreenDist } from '#ui/hover-manager.js';

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT MASKING HELPER (Rigid Drag Logic)
// ═══════════════════════════════════════════════════════════════════════════════

// Helper: Analyze constraints to determine allowed Degrees of Freedom (DOF) for dragging
import { analyzeConstraintStatus } from '#core/constraint-status.js';

function getDragDOF(state, jointIds) {
    // Rigid masked interaction: use analyzeConstraintStatus as single source-of-truth
    let lockX = false, lockY = false, guideLine = null;
    let status = null;
    try { status = analyzeConstraintStatus({ joints: state.joints, shapes: state.shapes || [], constraints: state.constraints || [] }); } catch (_) { status = null; }

    const jointDOFs = (status && status.jointDOFs) ? status.jointDOFs : new Map();
    const fixedJoints = (status && status.fixedJoints) ? status.fixedJoints : new Set();

    // 0 DOF protocol — immediate full lock if any dragged joint is fixed/0DOF/j_origin
    for (const id of jointIds) {
        const dof = jointDOFs.get(id) ?? 2;
        if (id === 'j_origin' || fixedJoints.has(id) || dof <= 0) {
            return { lockX: true, lockY: true, guideLine: null };
        }
    }

    // Propagation for clusters: if ANY joint in the coincident cluster is 0DOF/fixed,
    // lock the entire cluster to avoid internal deformation.
    if (jointIds.length > 1) {
        for (const id of jointIds) {
            const cluster = findCoincidentCluster(id, state.constraints || []);
            for (const cid of cluster) {
                const cdof = jointDOFs.get(cid) ?? 2;
                if (cid === 'j_origin' || fixedJoints.has(cid) || cdof <= 0) {
                    return { lockX: true, lockY: true, guideLine: null };
                }
            }
        }
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
 * Update hover feedback for selection tests and UI. This enforces the origin-suppression rule
 * where the origin joint should not win over a nearby constraint glyph when distances tie/are close.
 */
export function updateHoverFeedback(svg, hitJoint, hitShape, _e, state) {
    const px = state.lastMouse?.x ?? null;
    const py = state.lastMouse?.y ?? null;
    if (px === null || py === null) return;

    // Compute screen distances
    const dJoint = hitJoint ? getScreenDist(svg, px, py, hitJoint.j) : Infinity;
    const constraintsList = state.constraints || [];
    const best = findClosestConstraintGlyph(svg, px, py, constraintsList);
    const dConstraint = best.constraint ? best.dist : Infinity;

    // Apply special origin suppression: if joint is origin and glyph is as close or closer, prefer glyph
    let winner = null;
    const SELECT_THRESHOLD = 24;
    if (dJoint < SELECT_THRESHOLD && dJoint <= dConstraint) {
        if (hitJoint && hitJoint.id === 'j_origin' && dConstraint <= dJoint) {
            winner = 'constraint';
        } else {
            winner = 'joint';
        }
    } else if (dConstraint < SELECT_THRESHOLD) {
        winner = 'constraint';
    } else if (hitShape) {
        winner = 'shape';
    } else {
        winner = null;
    }

    if (winner === 'joint') {
        state.hoveredJoint = hitJoint.id;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    } else if (winner === 'constraint') {
        state.hoveredJoint = null;
        state.hoveredConstraint = best.constraint;
        state.hoveredShape = null;
    } else if (winner === 'shape') {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = hitShape.shape.id;
    } else {
        state.hoveredJoint = null;
        state.hoveredConstraint = null;
        state.hoveredShape = null;
    }
}

/**
 * Handle pointer down for selection tool
 */
export function handleSelectionPointerDown(e, svg, state, hitJoint, hitShape, hitConstraint) {
    const isSelectOrDim = (state.currentTool === TOOL_MODES.SELECT || state.currentTool === TOOL_MODES.DIMENSION);
    if (!isSelectOrDim) return false;
    
    // Track double-clicks for dimension editing
    const now = Date.now();
    // Defensive dataset access: some tests pass events without DOM targets
    const _targetConstraintIdx = (e && e.target && e.target.dataset) ? e.target.dataset.constraintIdx : undefined;
    const isDoubleClick = (now - selectionState.lastClickTime < 500) && (selectionState.lastClickedIndex === _targetConstraintIdx);
    selectionState.lastClickTime = now;
    selectionState.lastClickedIndex = _targetConstraintIdx;

    // 1. Check for Dimension Label Interaction
    // Test environments may pass synthetic pointer events whose target lacks
    // .closest(); fall back to null so the dim-label branch is skipped.
    const dimLabel = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.dim-label') : null;
    if (dimLabel) {
        const cIdx = parseInt(dimLabel.dataset.constraintIdx);
        const constraint = state.constraints[cIdx];
        if (constraint) {
            if(!state.selectedConstraints) state.selectedConstraints = new Set();
            if(!e.shiftKey) state.selectedConstraints.clear();
            state.selectedConstraints.add(constraint);
            
            if (isDoubleClick) {
                e.stopPropagation(); e.preventDefault();
                showEditInput(svg, state, constraint);
                return true;
            }

            // Prepare for dragging dimension offset
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

    // Priority: If the manager already detected a hit using the high-tolerance findSnap, use it immediately.
    if (hitJoint) {
        return handleJointSelection(e, svg, state, hitJoint);
    }

    // If Shift is not held, clear all selection sets before processing (single-select mode)
    if (!e.shiftKey) {
        if(state.selectedJoints) state.selectedJoints.clear();
        if(state.selectedShapes) state.selectedShapes.clear();
        if(state.selectedConstraints) state.selectedConstraints.clear();
        // Clear any previously forced coincident glyphs when selection changes
        try{ clearCoincidentGlyphFlags(state); }catch(_){ }
    }

    // Distance-based tie-breaker between joint and constraint (constraint-first policy)
    const SELECT_THRESHOLD = 24; // px in screen space

    // Compute screen distances for constraint glyphs and joint before considering shapes
    const dJoint = hitJoint ? getScreenDist(svg, e.clientX, e.clientY, hitJoint.j) : Infinity;
    const constraintsList = state.constraints || [];
    // First, check for a VISIBLE glyph and capture the click immediately to prevent click-through
    const bestVisible = findClosestConstraintGlyph(svg, e.clientX, e.clientY, constraintsList, true);
    dbg.log('selection', '[selection-tools] bestVisible check', { bestVisible: bestVisible && bestVisible.constraint ? { type: bestVisible.constraint.type, dist: bestVisible.dist, visible: bestVisible.constraint && (bestVisible.constraint.__isPreview ? true : !!bestVisible.constraint.__visible) } : null });
    if (bestVisible.constraint && bestVisible.dist < SELECT_THRESHOLD) {
        dbg.log('selection', '[selection-tools] capturing click on VISIBLE glyph', { type: bestVisible.constraint.type, dist: bestVisible.dist, pt: bestVisible.pt });
        return handleConstraintSelection(e, svg, state, bestVisible.constraint);
    }

    const best = findClosestConstraintGlyph(svg, e.clientX, e.clientY, constraintsList, false);
    const dConstraint = best.dist;

    // Winner priority gate: joint beats constraint when closer-or-equal; constraint next; shape last
    // Special-case: the origin joint should NOT win over a nearby constraint glyph
    let winner = null;
    if (dJoint < SELECT_THRESHOLD && dJoint <= dConstraint) {
        // If this joint is the origin, prefer a nearby constraint glyph when distances tie/close
        if (hitJoint && hitJoint.id === 'j_origin' && dConstraint <= dJoint) {
            winner = 'constraint';
        } else {
            winner = 'joint';
        }
    } else if (dConstraint < SELECT_THRESHOLD) {
        winner = 'constraint';
    } else if (hitShape) {
        winner = 'shape';
    }

    if (winner === 'constraint') {
        return handleConstraintSelection(e, svg, state, best.constraint || hitConstraint);
    }
    if (winner === 'joint') {
        // Prefer hoveredJoint if it exists and is within threshold (keeps click matching hover)
        if (state.hoveredJoint) {
            const hj = state.joints.get(state.hoveredJoint);
            if (hj && getScreenDist(svg, e.clientX, e.clientY, hj) < SELECT_THRESHOLD) {
                return handleJointSelection(e, svg, state, { id: state.hoveredJoint, j: hj });
            }
        }
        return handleJointSelection(e, svg, state, hitJoint);
    }
    if (winner === 'shape') {
        return handleShapeSelection(e, svg, state, hitShape);
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

/**
 * Handle joint selection and dragging
 */
export function handleJointSelection(e, svg, state, hitJoint) {
    // Ensure selection set exists
    if (!state.selectedJoints) state.selectedJoints = new Set();

    // If Shift not held, clear selection then add this joint id
    if (!e.shiftKey) state.selectedJoints.clear();
    state.selectedJoints.add(hitJoint.id);

    // Prepare pointer capture and drag data for the joint (allow cluster dragging still)
    svg.setPointerCapture(e.pointerId);
    const cluster = findCoincidentCluster(hitJoint.id, state.constraints);
    // Include arc endpoints when dragging an arc center so the user can translate the arc by its center
    const jointIdSet = new Set(Array.from(cluster));
    try{
        if(state.shapes && state.shapes.length){
            for(const s of state.shapes){
                if(s && s.type === 'arc' && s.joints && s.joints.length >= 3){
                    // If the clicked joint is the center of an arc, include the arc's rim joints so drag translates the arc
                    if(s.joints[0] === hitJoint.id){ jointIdSet.add(s.joints[1]); jointIdSet.add(s.joints[2]); }
                    // If the clicked joint is one of the rim joints, include the center and the other rim so dragging any arc joint
                    // will translate the entire arc symmetrically
                    if(s.joints[1] === hitJoint.id || s.joints[2] === hitJoint.id){ jointIdSet.add(s.joints[0]); jointIdSet.add(s.joints[1]); jointIdSet.add(s.joints[2]); }
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

    // Visualize coincident constraints for this cluster so glyphs become visible
    try{ clearCoincidentGlyphFlags(state); showCoincidentGlyphsForCluster(state, cluster); }catch(_){ }

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
        pointerId: e.pointerId
    };

    // Stop further processing by the caller (ensures shape-selection etc. won't clear this)
    dbg.log('selection', '[selection-tools] joint selected', { id: hitJoint.id, selectedCount: state.selectedJoints.size });
    return true;
}

/**
 * Handle shape selection
 */
function handleShapeSelection(e, svg, state, hitShape) {
    // Toggle shape selection in the set
    const id = hitShape.shape.id;
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
        const wantParallel = type === INFERENCE_TYPES.PARALLEL;
        for (const s of lineShapes) {
            if (s.id === targetId) continue;
            if (isRelationshipAlreadyEnforced(state, s.id, targetId, wantParallel)) return false;
        }
        // During dragging (full: false), always allow position snapping for visual guidance
        // Only validate constraint addition when committing (full: true)
        if (!opts.full) return true;
        const cType = wantParallel ? CONSTRAINT_TYPES.PARALLEL : CONSTRAINT_TYPES.PERPENDICULAR;
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

    // 1. Dragging Dimension Offset
    if (state.drag.type === DRAG_TYPES.DIMENSION) {
        const wpt = screenToWorld(svg, e.clientX, e.clientY);
        const c = state.drag.constraint;
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
            const radius = (typeof c.value === 'number') ? c.value : (shape && typeof shape.radius === 'number' ? shape.radius : 0);
            if (center) {
                c.offset = getDist(center, wpt) - radius;
            }
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
    
    // 2. Standard Dragging (Joints/Lines)
    const wpt = screenToWorld(svg, e.clientX, e.clientY);

    // Default target: raw mouse position
    let target = wpt;

    // 3. Constraint-Aware Input Masking (Rigid Drag)
    // Apply masking when dragging joints, clusters, or whole shapes/lines
    if (state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER || state.drag.type === DRAG_TYPES.LINE) {
        // Calculate deltas relative to START position to keep dragging consistent
        const startPos = state.drag.startWorld;
        let dx = target.x - startPos.x;
        let dy = target.y - startPos.y;

        // Get allowed degrees of freedom (for shapes, state.drag.jointIds contains the member joints)
        const { lockX, lockY, guideLine } = getDragDOF(state, state.drag.jointIds);

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
    }

    let smoothed = target;

    // Track whether we've moved far enough during the drag to consider it a real drag
    try{
        if (selectionState.dragStartScreen) {
            const dxs = e.clientX - selectionState.dragStartScreen.x;
            const dys = e.clientY - selectionState.dragStartScreen.y;
            const moved = Math.hypot(dxs, dys);
            if (moved > 5) selectionState.isDragging = true;
        }
    }catch(_){ }

    // UNIFIED BEHAVIOR: Prefer the 'isLocked' flag computed by input-manager, but fall back to a local proximity check
    // so tests that set state.activeSnap directly (without running input-manager) still get expected lock behavior.
    let activeIsLocked = false;
    if (state.activeSnap) {
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

    if (state.activeSnap && activeIsLocked && (state.activeSnap.type === 'joint' || state.activeSnap.type === 'line' || state.activeSnap.type === 'shape' || state.activeSnap.type === 'grid')) {
        // Normalize snap point (some snap objects use .pt, others use x/y or id/targetId)
        let snapPt = null;
        try{
            if (state.activeSnap.pt) snapPt = state.activeSnap.pt;
            else if (typeof state.activeSnap.x === 'number' && typeof state.activeSnap.y === 'number') snapPt = { x: state.activeSnap.x, y: state.activeSnap.y };
            else if (state.activeSnap.targetId) { const j = state.joints.get(state.activeSnap.targetId); if (j) snapPt = { x: j.x, y: j.y }; }
            else if (state.activeSnap.id) { const j = state.joints.get(state.activeSnap.id); if (j) snapPt = { x: j.x, y: j.y }; }
        }catch(_){ snapPt = null; }

        if (snapPt) {
            smoothed = snapPt;
            state.inference = null; // Clear inference when snapped
            // Track locked target for debugging and release validation
            try { state.drag.lockedTo = state.activeSnap.targetId || state.activeSnap.id || ((state.activeSnap.type === 'line' || state.activeSnap.type === 'shape') && state.activeSnap.shape ? state.activeSnap.shape.id : null) || null; } catch(_) { state.drag.lockedTo = null; }
            // Ensure activeSnap remains exposed for renderer and hover suppression
            try { state.activeSnap = state.activeSnap; }catch(_){ }
            try{
                const selVerbose = (typeof window !== 'undefined' && window.ug && window.ug.debug && window.ug.debug.verboseSelectionLogs) ? true : false;
                const lastLocked = state.drag._lastLockedTo || null;
                const nowLocked = state.drag.lockedTo || null;
                if(selVerbose || lastLocked !== nowLocked){
                    dbg.log('selection', '[selection-tools] drag LOCKED to snap', { draggedId: state.drag && state.drag.id, target: nowLocked });
                    state.drag._lastLockedTo = nowLocked;
                }
            }catch(_){ }
        }
    } else {
        // If not locked, ensure we don't keep a stale lockedTo
        try{ delete state.drag.lockedTo; }catch(_){ }

        // Axis Inference (H/V relative to start)
        if (state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER) {
            const primaryId = state.drag.id;
            const initialPos = state.drag.initial.get(primaryId);
            if (initialPos) {
                // Check inference relative to start position (allow full geometry-based inference)
                const primaryId = state.drag && state.drag.id;
                const draggedType = state.drag && state.drag.type === DRAG_TYPES.JOINT ? 'joint' : 'other';
                const inf = findInference(initialPos, target, state.shapes || [], state.joints || new Map(), state.snapTarget || null, { draggedId: primaryId, draggedType });
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

    // Drag step cap: when the cursor jumps far in a single frame (lag, focus
    // loss, fast flick), the solver gets a huge target displacement and can
    // overshoot. Clamp the proposed target to MAX_DRAG_STEP world units from
    // the dragged joint's current position. The joint catches up over the
    // next few frames if constraints allow.
    try {
        const maxStep = SolverConfig.MAX_DRAG_STEP;
        if (maxStep && maxStep > 0 && state.drag && state.drag.id) {
            const j = state.joints && state.joints.get(state.drag.id);
            if (j) {
                const sdx = smoothed.x - j.x, sdy = smoothed.y - j.y;
                const stepLen = Math.hypot(sdx, sdy);
                if (stepLen > maxStep) {
                    const k = maxStep / stepLen;
                    smoothed = { x: j.x + sdx * k, y: j.y + sdy * k };
                }
            }
        }
    } catch (_) { /* fail-open */ }

    state.drag.lastTarget = smoothed;

    // NATIVE SOLVER DRAG: Set drag targets on joints instead of forcing positions
    // This tells the solver "try to be here", but allows constraints to override.
    // Set dragTarget on every member of the drag (fixed joints included) so the
    // renderer can show them and downstream tests/inspections can see what the
    // mask actually allows. The solver's auto-detect path already skips fixed
    // joints, so fixed joints never produce a mouse_spring.
    const dx = smoothed.x - state.drag.startWorld.x, dy = smoothed.y - state.drag.startWorld.y;
    console.log('[DRAG] smoothed:', smoothed, 'startWorld:', state.drag.startWorld, 'dx/dy:', dx, dy);
    for (const id of state.drag.jointIds) {
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
            const dt = { jointId: primary, x: smoothed.x, y: smoothed.y, stiffness: (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4 };
            try { state.engine.solve(SolverConfig.QUICK_SOLVE || 8, { dragTarget: dt }); } catch (_) { /* fail-open */ }
        }
    } catch (_) { }

    return true;
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
        state.shapes.forEach(s => {
            if (s.joints) {
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
            if (id === 'j_origin') return;
            if (inRect(j)) state.selectedJoints.add(id);
        });
        
        selectionState.isMarqueeActive = false;
        state.active = null;
        try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
        return true;
    }
    
    // Cleanup drag targets so joints stop trying to follow the mouse
    if (state.drag && state.drag.jointIds) {
        for (const id of state.drag.jointIds) {
            const j = state.joints.get(id);
            if (j) delete j.dragTarget;
        }
    }

    if (state.drag && (state.drag.type === DRAG_TYPES.JOINT || state.drag.type === DRAG_TYPES.CLUSTER)) {
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
                          state.beginUndoGroup();
                          state.saveState();
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

                          try{ state.endUndoGroup(); }catch(_){ }
                      }catch(_){ try{ state.endUndoGroup(); }catch(_){ } }
                  }
                } else {
                  try{ dbg.log('selection', '[selection-tools] skipping snap-on-release — no active locked snap (no visual lock present)'); }catch(_){ }
                  // Apply inference constraints even when no snap lock was present (commit on release)
                  try{
                      if (state.inference && canApplyInference(state, state.drag && state.drag.id, state.inference, { full: true })) {
                          try{ state.beginUndoGroup(); state.saveState(); }catch(_){ }
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

                          try{ state.endUndoGroup(); }catch(_){ }
                      }
                  } catch(_){ }
                }
            }

            // If there was no active snap object at all, still attempt inference-commit on release
            if (!state.activeSnap) {
                try{
                    if (state.inference && canApplyInference(state, state.drag && state.drag.id, state.inference, { full: true })) {
                        try{ state.beginUndoGroup(); state.saveState(); }catch(_){ }
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
                        try{ state.endUndoGroup(); }catch(_){ }
                    }
                } catch(_) { }
            }

        } else {
            try{ dbg.log('selection', '[selection-tools] pointerUp treated as click — skipping snap-on-release (drag distance below threshold)'); }catch(_){ }
        }
    }
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
export { findClosestConstraintGlyph };