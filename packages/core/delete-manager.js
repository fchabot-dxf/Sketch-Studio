import { CONSTRAINT_TYPES } from './constants.js';
import { removeOrphanJoints } from './joints.js';
import { patternsAfterDelete } from './pattern.js';
import { undimensionOffset } from './offset.js';
import { SolverConfig } from './solver-config.js';
import { dimensionValuesOf, reconcileKeptDimensions } from './parameters.js';
import { docUnit } from './settings-manager.js';
import { inertEntities, isConstraintInert, isJointInert, isShapeInert, sketchOf, recordUndo, constraintSketch, DEFAULT_SKETCH_ID, DEFAULT_SKETCH_NAME } from './sketch-model.js'; // TASK 577/619
import { dropEmptyGroups } from './group-model.js'; // TASK 756: a group whose shapes all went goes too
import { isSharedPointCoincident, sharedPointCoincidents, detachFromSharedPoint } from './shared-point.js'; // TASK 1041: Delete on a SharedPointCoincident splits the point

// A fillet's virtual-sharp joint V (joint.virtualSharp) is a deliberate exception to "a joint goes when no
// surviving shape uses it": the overall dimensions at a filleted corner stay attached to V as a standalone point
// even after the lines/arc around it are deleted (Fusion parity). Returns the joint ids to KEEP: every V that a
// measurement dimension (joint-pair DISTANCE, joint-form EQUAL) is attached to, plus that dimension's other joints.
// Deleting V explicitly (deleteJoints) is unaffected and still removes V and its dimensions.
function virtualSharpProtectedJoints(state) {
  const keep = new Set();
  if (!state || !state.joints || !Array.isArray(state.constraints)) return keep;
  const isV = (id) => { const j = state.joints.get(id); return !!(j && j.virtualSharp); };
  for (const c of state.constraints) {
    if (!c || c.isRadius || !Array.isArray(c.joints)) continue;
    const measure = (c.type === 'distance' && c.joints.length >= 2) || (c.type === 'equal' && c.joints.length >= 4);
    if (measure && c.joints.some(isV)) c.joints.forEach(j => keep.add(j));
  }
  return keep;
}

export function deleteConstraints(state, constraintsOrIds) {
  if (!state) return 0;
  const toDelete = Array.isArray(constraintsOrIds) ? constraintsOrIds : [constraintsOrIds];
  if (toDelete.length === 0) return 0;
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('delete constraints'); } catch (_) {}
  try { if (typeof state.saveState === 'function') state.saveState('delete constraints'); } catch (_) {}

  const dimsBefore = dimensionValuesOf(state.constraints); // TASK 709: a deleted dimension a formula reads keeps its name as a value (O10)
  let removed = 0;
  const seen = new Set();
  for (const c of toDelete) {
    if (seen.has(c)) continue;
    seen.add(c);
    // Remove by reference or by index/id
    const idx = state.constraints.indexOf(c);
    if (idx !== -1) {
      const target = state.constraints[idx];
      if (target && target.type === CONSTRAINT_TYPES.OFFSET && target.dimensioned !== false) {
        undimensionOffset(target); // task 667: the relation stays with a free distance (task 690: a negative value turns positive, sides flipped)
        removed++;
        continue;
      }
      state.constraints.splice(idx, 1); removed++; continue;
    }
    // Try matching by properties (heuristic)
    for (let i = state.constraints.length - 1; i >= 0; i--) {
      const cc = state.constraints[i];
      if (!cc) continue;
      // If caller provided an id-like value, support c.id
      if (typeof c === 'string' && (cc.id === c || cc._id === c)) { state.constraints.splice(i, 1); removed++; break; }
      // If caller passed an object similar to constraint, try shallow equal keys
      if (typeof c === 'object') {
        try {
          const keys = Object.keys(c);
          let match = true;
          for (const k of keys) { if (cc[k] !== c[k]) { match = false; break; } }
          if (match) { state.constraints.splice(i, 1); removed++; break; }
        } catch(_) {}
      }
    }
  }

  reconcileKeptDimensions(state, dimsBefore, { unit: docUnit() }); // TASK 709 (O10): kept values made / dropped
  // Clear selection references
  try { if (state.selectedConstraints && typeof state.selectedConstraints.clear === 'function') state.selectedConstraints.clear(); } catch(_) {}

  // Re-solve (best-effort)
  try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.QUICK_SOLVE || 8); } catch(_) {}
  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}

  return removed;
}

/**
 * TASK 1041: Delete on SharedPointCoincident glyphs (#core/shared-point.js): each detaches its curve from the shared point (detachFromSharedPoint,
 * THE split), all in ONE undo step (Undo puts the shared joint back, ids included). A glyph that is not one of the scene's live glyphs (a stale
 * selection: the point is no longer shared) changes nothing and leaves no step. Returns how many curves were detached.
 */
export function deleteSharedPointCoincidents(state, glyphs) {
  const live = new Set(sharedPointCoincidents(state.joints, state.shapes));
  const valid = glyphs.filter((g) => live.has(g));
  if (!valid.length) return 0;
  state.beginUndoGroup('split point');
  let detached = 0;
  for (const g of valid) if (detachFromSharedPoint(state, g.joints[0], g.shape).ok) detached++;
  state.selectedConstraints.clear();
  state.engine.solve(SolverConfig.QUICK_SOLVE || 8);
  state.endUndoGroup();
  return detached;
}

// TASK 709: the constraint fields that name a SHAPE / a POINT (a sketch pattern's sources, copies, centre and direction lines are followed by
// #core/pattern.js patternsAfterDelete).
const SHAPE_FIELDS = ['shapes', 'shape', 'line', 'circle'], JOINT_FIELDS = ['joints', 'joint'];
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const namesAny = (c, fields, ids) => fields.some((f) => asList(c[f]).some((x) => ids.has(x)));
const pairKey = (a, b) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

/**
 * TASK 709 - THE rule (Fusion: deleting a sketch curve or point deletes every dimension and constraint that names it, and the dimension's
 * parameter with it). The shapes `shapeIds` and the points `jointIds` go, with every shape that uses one of those points, and every constraint
 * or dimension that names a shape that goes, a point that goes, or a line's endpoint pair that no surviving line keeps (point-to-line distance
 * [p,a,b], midpoint [a,b,m], H/V, and edge distance [a,b] on a deleted/trimmed rectangle edge). A fillet's virtual sharp that a dimension holds
 * stays (virtualSharpProtectedJoints). A constraint naming only surviving geometry stays. Unused points are then cleaned and sketch patterns follow
 * (patternsAfterDelete). A dimension that goes while a formula reads its name keeps that name as a value (#core/parameters.js
 * reconcileKeptDimensions, decision O10: Fusion's). The ONE place geometry is removed: deleteShapes / deleteJoints (Delete, Cut, Clear sketch, Delete
 * sketch) and the Trim tool (#core/trim.js) call it. No history, no solve: the callers own those.
 * -> { shapes: the shapes removed, joints: the points of `jointIds` removed }
 */
export function removeGeometry(state, shapeIds = [], jointIds = [], opts = {}) {
  const dimsBefore = dimensionValuesOf(state.constraints);
  const deleteJ = new Set(jointIds);
  const goneS = new Set(shapeIds);
  for (const s of state.shapes) if (s && asList(s.joints).some((j) => deleteJ.has(j))) goneS.add(s.id);
  const shapeJoints = new Set();
  const removedLinePairs = new Set();
  for (const p of (opts.trimmedPairs || [])) {
    if (Array.isArray(p) && p.length === 2 && p[0] && p[1]) removedLinePairs.add(pairKey(p[0], p[1]));
  }
  let shapes = 0;
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (!s || !goneS.has(s.id)) continue;
    asList(s.joints).forEach((j) => shapeJoints.add(j));
    if (s.type === 'line' && Array.isArray(s.joints) && s.joints.length === 2) removedLinePairs.add(pairKey(s.joints[0], s.joints[1]));
    state.shapes.splice(i, 1);
    shapes++;
  }
  const survivingLinePairs = new Set();
  for (const s of state.shapes) {
    if (s && s.type === 'line' && Array.isArray(s.joints) && s.joints.length === 2) survivingLinePairs.add(pairKey(s.joints[0], s.joints[1]));
  }
  const gonePairs = new Set([...removedLinePairs].filter((k) => !survivingLinePairs.has(k)));
  const namesDeletedLinePair = (c) => {
    if (!gonePairs.size || !Array.isArray(c.joints)) return false;
    if (c.joints.length === 2 && (c.type === CONSTRAINT_TYPES.DISTANCE || c.type === CONSTRAINT_TYPES.HORIZONTAL || c.type === CONSTRAINT_TYPES.VERTICAL)) {
      return gonePairs.has(pairKey(c.joints[0], c.joints[1]));
    }
    if (c.joints.length === 3 && c.type === CONSTRAINT_TYPES.DISTANCE) {
      return gonePairs.has(pairKey(c.joints[1], c.joints[2]));
    }
    if (c.joints.length === 3 && c.type === CONSTRAINT_TYPES.MIDPOINT) {
      return gonePairs.has(pairKey(c.joints[0], c.joints[1]));
    }
    return false;
  };
  // A point goes only when NO surviving shape uses it: shapes that merely SHARE a point with a deleted shape (a fillet's rim points, chained
  // lines) survive with it.
  const usedBySurvivors = new Set(state.shapes.flatMap((s) => asList(s && s.joints)));
  const kept = virtualSharpProtectedJoints(state);
  const goneJ = new Set([...deleteJ, ...[...shapeJoints].filter((j) => !usedBySurvivors.has(j) && !kept.has(j))]);
  for (let i = state.constraints.length - 1; i >= 0; i--) {
    const c = state.constraints[i];
    if (c && (namesAny(c, SHAPE_FIELDS, goneS) || namesAny(c, JOINT_FIELDS, goneJ) || namesDeletedLinePair(c))) state.constraints.splice(i, 1);
  }
  let joints = 0;
  for (const j of deleteJ) if (state.joints.delete(j)) joints++;
  removeOrphanJoints(state);
  patternsAfterDelete(state); // TASK 658: a deleted copy suppresses its pattern instance; a deleted source / centre / direction line ends the pattern
  dropEmptyGroups(state); // TASK 756: a user group left with no shape (every member deleted, here or by a pattern above) is removed, in this ONE place
  reconcileKeptDimensions(state, dimsBefore, { unit: docUnit() }); // a deleted dimension (or pattern value) a formula reads keeps its name as a value (O10)
  return { shapes, joints };
}

export function deleteShapes(state, shapeIds) {
  if (!state) return 0;
  const ids = Array.isArray(shapeIds) ? shapeIds.slice() : [shapeIds];
  if (ids.length === 0) return 0;
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('delete shapes'); } catch (_) {}
  try { if (typeof state.saveState === 'function') state.saveState('delete shapes'); } catch (_) {}

  const removed = removeGeometry(state, ids, []).shapes; // TASK 709: THE rule

  // Clear selected shapes if present
  try { if (state.selectedShapes && typeof state.selectedShapes.clear === 'function') state.selectedShapes.clear(); } catch(_) {}

  try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.QUICK_SOLVE || 8); } catch(_) {}
  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}

  return removed;
}

export function deleteJoints(state, jointIds) {
  if (!state) return 0;
  const ids = Array.isArray(jointIds) ? jointIds.slice() : [jointIds];
  if (ids.length === 0) return 0;
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('delete joints'); } catch (_) {}
  try { if (typeof state.saveState === 'function') state.saveState('delete joints'); } catch (_) {}

  // TASK 709: THE rule: every shape using one of the points goes, and every constraint / dimension on those shapes or points
  const r = removeGeometry(state, [], ids);
  const removed = r.shapes + r.joints;

  try { if (state.selectedJoints && typeof state.selectedJoints.clear === 'function') state.selectedJoints.clear(); } catch(_) {}
  try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.QUICK_SOLVE || 8); } catch(_) {}
  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}

  return removed;
}

/**
 * Smart delete function that handles cascading deletions based on current selection.
 * Identifies implicit deletions (e.g., deleting a joint deletes connected lines) and
 * cleans up resulting orphans.
 * @param {object} state - Application state
 */
export function deleteSelection(state) {
  if (!state) return;

  // 1. Identify explicit selections
  // TASK 577: nothing of a LOCKED sketch is deleted (a pick cannot select it; this is the same rule for a selection made some other way)
  const inert = inertEntities(state);
  const pickedConstraints = state.selectedConstraints ? Array.from(state.selectedConstraints).filter((c) => !isConstraintInert(inert, c)) : [];
  // TASK 1041: a selected SharedPointCoincident glyph (#core/shared-point.js, derived, never stored) is a curve's membership of a shared point:
  // its Delete detaches that curve (deleteSharedPointCoincidents); every other selected constraint is deleted as before
  const pointSplits = pickedConstraints.filter(isSharedPointCoincident);
  const constraintsToDelete = pickedConstraints.filter((c) => !isSharedPointCoincident(c));
  const explicitShapes = state.selectedShapes ? Array.from(state.selectedShapes).filter((id) => !isShapeInert(inert, id)) : [];
  const explicitJoints = state.selectedJoints ? Array.from(state.selectedJoints).filter((id) => !isJointInert(inert, id)) : [];

  // 2. Cascade Logic: Identify orphaned joints (joints that would be left without any shapes)
  // A joint is orphaned if ALL shapes connected to it are being deleted.
  
  // Shapes are deleted if:
  // a) They are explicitly selected
  // b) Any of their joints are explicitly selected (standard CAD behavior)
  const allShapesToDelete = new Set(explicitShapes);
  const jointsToDeleteSet = new Set(explicitJoints);

  if (state.shapes) {
      for (const s of state.shapes) {
          if (s.joints && s.joints.some(jid => jointsToDeleteSet.has(jid))) {
              allShapesToDelete.add(s.id);
          }
      }
  }

  // Find all joints involved in the deleted shapes
  const candidateJoints = new Set();
  if (state.shapes) {
      for (const s of state.shapes) {
          if (allShapesToDelete.has(s.id) && s.joints) {
              s.joints.forEach(jid => candidateJoints.add(jid));
          }
      }
  }

  // Identify joints used by surviving shapes
  const usedBySurvivors = new Set();
  if (state.shapes) {
      for (const s of state.shapes) {
          if (!allShapesToDelete.has(s.id) && s.joints) {
              s.joints.forEach(jid => usedBySurvivors.add(jid));
          }
      }
  }

  // Any candidate not used by survivors is an orphan -> delete it
  const finalJointsToDelete = [...explicitJoints];
  const vsProtected = virtualSharpProtectedJoints(state);
  for (const jid of candidateJoints) {
      if (!usedBySurvivors.has(jid) && !jointsToDeleteSet.has(jid) && !vsProtected.has(jid)) {
          finalJointsToDelete.push(jid);
          jointsToDeleteSet.add(jid);
      }
  }

  const safeToDelete = finalJointsToDelete.filter(id => id !== 'j_origin');
  if (pointSplits.length === 0 && constraintsToDelete.length === 0 && explicitShapes.length === 0 && safeToDelete.length === 0) return;

  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('delete selection'); } catch (_) {}

  // 3. Execute Deletions
  if (pointSplits.length > 0) deleteSharedPointCoincidents(state, pointSplits);
  if (constraintsToDelete.length > 0) deleteConstraints(state, constraintsToDelete);
  if (explicitShapes.length > 0) deleteShapes(state, explicitShapes);
  if (safeToDelete.length > 0) deleteJoints(state, safeToDelete);

  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}
}

/**
 * TASK 577: delete a SKETCH with its geometry (one undo step). Refused (nothing changes) for a LOCKED sketch and for the only sketch.
 * The shapes go through deleteSelection (so joints, constraints and dimensions of those shapes go with them, as for any delete); when
 * the deleted sketch was the active one, the first remaining unlocked sketch becomes active. Returns { ok, reason? }.
 */
export function deleteSketch(state, id) {
  const list = state && Array.isArray(state.sketches) ? state.sketches : [];
  const sk = list.find((s) => s.id === id);
  if (!sk) return { ok: false, reason: 'no such sketch' };
  if (sk.locked === true) return { ok: false, reason: 'it is locked: unlock it first' };
  if (list.length < 2) return { ok: false, reason: 'it is the only sketch' };
  const next = list.find((s) => s !== sk && s.locked !== true);
  if (!next) return { ok: false, reason: 'every other sketch is locked: new geometry needs one to go into' };
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('delete sketch'); } catch (_) {}
  recordUndo(state, 'delete sketch');
  state.selectedShapes = new Set((state.shapes || []).filter((s) => sketchOf(s) === id).map((s) => s.id));
  if (state.selectedJoints) state.selectedJoints = new Set();
  if (state.selectedConstraints) state.selectedConstraints = new Set();
  deleteSelection(state);
  list.splice(list.indexOf(sk), 1);
  if (state.activeSketchId === id) state.activeSketchId = next.id;
  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}
  return { ok: true };
}

/** True when any deletable shape, non-origin joint, or constraint is currently selected for Delete. */
export function hasSelection(state) {
  if (!state) return false;
  const ss = state.selectedShapes, sj = state.selectedJoints, sc = state.selectedConstraints;
  const rawS = ss ? ss.size : 0, rawJ = sj ? sj.size : 0, rawC = sc ? sc.size : 0;
  if (rawS === 0 && rawC === 0 && (rawJ === 0 || (rawJ === 1 && sj.has('j_origin')))) return false;
  const inert = inertEntities(state);
  if (ss) { for (const id of ss) if (!isShapeInert(inert, id)) return true; }
  if (sc) { for (const c of sc) if (!isConstraintInert(inert, c)) return true; }
  if (sj) { for (const id of sj) if (id !== 'j_origin' && !isJointInert(inert, id)) return true; }
  return false;
}

/** Display name of the active sketch (falls back to 'Sketch 1'). */
export function activeSketchName(state) {
  const id = (state && state.activeSketchId) || DEFAULT_SKETCH_ID;
  const sk = state && Array.isArray(state.sketches) ? state.sketches.find((s) => s.id === id) : null;
  return (sk && sk.name) || DEFAULT_SKETCH_NAME;
}

/** True when the active sketch is unlocked and owns at least one shape, non-origin joint, or constraint. */
export function canClearActiveSketch(state) {
  if (!state) return false;
  const id = state.activeSketchId || DEFAULT_SKETCH_ID;
  const sk = Array.isArray(state.sketches) ? state.sketches.find((s) => s.id === id) : null;
  if (sk && sk.locked === true) return false;
  if (Array.isArray(state.shapes) && state.shapes.some((s) => sketchOf(s) === id)) return true;
  if (state.joints && typeof state.joints[Symbol.iterator] === 'function') {
    for (const [jid, j] of state.joints) if (jid !== 'j_origin' && sketchOf(j) === id) return true;
  }
  if (Array.isArray(state.constraints) && state.constraints.some((c) => constraintSketch(c, state) === id)) return true;
  return false;
}

/**
 * TASK 619: Clear every shape, non-origin joint, and constraint belonging to the active sketch in ONE undo step.
 * Leaves all other sketches and any locked sketches untouched; refuses if the active sketch is locked or already empty.
 * Returns { ok, reason? }.
 */
export function clearActiveSketch(state) {
  if (!state) return { ok: false, reason: 'no state' };
  const id = state.activeSketchId || DEFAULT_SKETCH_ID;
  const sk = Array.isArray(state.sketches) ? state.sketches.find((s) => s.id === id) : null;
  if (sk && sk.locked === true) return { ok: false, reason: 'it is locked: unlock it first' };
  if (!canClearActiveSketch(state)) return { ok: false, reason: 'empty' };

  try { if (typeof state.closeDrawStep === 'function') state.closeDrawStep(); } catch (_) {}
  try {
    if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('clear sketch');
    else recordUndo(state, 'clear sketch');
  } catch (_) {}

  const shapeIds = (state.shapes || []).filter((s) => sketchOf(s) === id).map((s) => s.id);
  if (shapeIds.length > 0) deleteShapes(state, shapeIds);

  const remConstraints = (state.constraints || []).filter((c) => constraintSketch(c, state) === id);
  if (remConstraints.length > 0) deleteConstraints(state, remConstraints);

  const survivingUsed = new Set();
  for (const s of (state.shapes || [])) {
    if (s && Array.isArray(s.joints)) s.joints.forEach((jid) => survivingUsed.add(jid));
  }
  const remJoints = [];
  if (state.joints && typeof state.joints[Symbol.iterator] === 'function') {
    for (const [jid, j] of state.joints) {
      if (jid !== 'j_origin' && sketchOf(j) === id && !survivingUsed.has(jid)) remJoints.push(jid);
    }
  }
  if (remJoints.length > 0) deleteJoints(state, remJoints);

  try { if (state.selectedShapes && state.selectedShapes.clear) state.selectedShapes.clear(); } catch (_) {}
  try { if (state.selectedJoints && state.selectedJoints.clear) state.selectedJoints.clear(); } catch (_) {}
  try { if (state.selectedConstraints && state.selectedConstraints.clear) state.selectedConstraints.clear(); } catch (_) {}
  state.hoveredShape = null;
  state.hoverOwner = null; // TASK 756
  state.hoveredJoint = null;
  state.hoveredConstraint = null;
  state.pendingConstraint = null;
  state.active = null;
  state.drag = null;

  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}
  return { ok: true };
}
