import { CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from './constants.js';
import { removeOrphanJoints } from './joints.js';
import { patternsAfterDelete } from './pattern.js';
import { undimensionOffset, offsetsAfterDelete, isOffsetRelation } from './offset.js';
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
    // TASK 1046: an offset RELATION glyph (#core/offset.js, derived from its record): the relation goes, record and dimension (the copies stay as
    // plain geometry); its label, if also picked, is the same record (skipped)
    if (isOffsetRelation(c)) {
      const at = state.constraints.indexOf(c.offset);
      seen.add(c.offset);
      if (at !== -1) { state.constraints.splice(at, 1); removed++; }
      continue;
    }
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
 * stays (virtualSharpProtectedJoints). A constraint naming only surviving geometry stays. Unused points are then cleaned and sketch patterns and offsets follow
 * (patternsAfterDelete / offsetsAfterDelete, TASK 1046: a deleted copy curve goes alone, the relation keeps the rest). A dimension that goes while a formula reads its name keeps that name as a value (#core/parameters.js
 * reconcileKeptDimensions, decision O10: Fusion's). The ONE place geometry is removed: deleteShapes / deleteJoints (Delete, Cut, Clear sketch, Delete
 * sketch) and the Trim tool (#core/trim.js) call it. No history, no solve: the callers own those.
 * -> { shapes: the shapes removed, joints: the points of `jointIds` removed }
 */
export function removeGeometry(state, shapeIds = [], jointIds = [], opts = {}) {
  const dimsBefore = dimensionValuesOf(state.constraints);
  const deleteJ = new Set(jointIds);
  const goneS = new Set(shapeIds);
  for (const s of state.shapes) if (s && asList(s.joints).some((j) => deleteJ.has(j))) goneS.add(s.id);
  const shapeJoints = new Set(), goneSharps = new Set();
  const removedLinePairs = new Set();
  for (const p of (opts.trimmedPairs || [])) {
    if (Array.isArray(p) && p.length === 2 && p[0] && p[1]) removedLinePairs.add(pairKey(p[0], p[1]));
  }
  let shapes = 0;
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (!s || !goneS.has(s.id)) continue;
    asList(s.joints).forEach((j) => shapeJoints.add(j));
    if (s.filletSharp) goneSharps.add(s.filletSharp);
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
  // lines) survive with it. TASK 1044 (BUG-A, audit O-09b / O-09c): the ORIGIN is never gone: a deleted line drawn from it uses j_origin itself, and
  // the other curves' dimensions / coincidents to the origin are not that line's (the origin point itself was always kept, removeOrphanJoints).
  const usedBySurvivors = new Set(state.shapes.flatMap((s) => asList(s && s.joints)));
  const kept = virtualSharpProtectedJoints(state);
  // TASK 1044 (BUG-C, audit D-33, Fusion: the fillet arc goes with its points, no point stays): a deleted fillet arc's virtual sharp V
  // (arc.filletSharp, a point on no curve) is the arc's own dependant: it goes with the arc, and with it the constraints that exist only to hold it
  // (its point-on-line on the trimmed sides: they name V). It stays while a surviving curve still claims it (a construction radial re-linked to V,
  // the other piece of a broken fillet arc) or a measurement dimension holds it (virtualSharpProtectedJoints, the documented exception).
  const claimed = new Set(state.shapes.map((s) => s && s.filletSharp).filter(Boolean));
  const sharps = [...goneSharps].filter((j) => { const v = state.joints.get(j); return v && v.virtualSharp && !claimed.has(j) && !usedBySurvivors.has(j) && !kept.has(j); });
  const goneJ = new Set([...deleteJ, ...sharps, ...[...shapeJoints].filter((j) => !usedBySurvivors.has(j) && !kept.has(j))].filter((j) => j !== ORIGIN_JOINT_ID));
  for (let i = state.constraints.length - 1; i >= 0; i--) {
    const c = state.constraints[i];
    if (!c || c.type === CONSTRAINT_TYPES.OFFSET) continue; // TASK 1046: an offset record follows its own rule (offsetsAfterDelete, below)
    if (namesAny(c, SHAPE_FIELDS, goneS) || namesAny(c, JOINT_FIELDS, goneJ) || namesDeletedLinePair(c)) state.constraints.splice(i, 1);
  }
  let joints = 0;
  for (const j of deleteJ) if (state.joints.delete(j)) joints++;
  removeOrphanJoints(state);
  // TASK 1046 (Fusion D-38 / D-39 / D-43 / D-44): the relation records follow, each by its module's ONE rule: a deleted COPY curve goes alone
  // (the pattern / offset keeps the rest); a deleted pattern source / centre / direction line ends the pattern; a deleted offset source leaves
  // its copy as plain geometry and the offset keeps the rest
  patternsAfterDelete(state);
  offsetsAfterDelete(state);
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

// TASK 1044 THE POINT RULE (owner ruling 2026-11-27, Fusion measured: no curve end, centre or the origin is ever deletable; right-click Delete on
// one opens Fusion's Delete with an empty selection): a selected point that is a CURVE's point (an end, a centre, a shared or glued corner, a bezier
// anchor) or the ORIGIN is never deleted, and no curve goes because of it. A FREE point (no curve uses it: a centre rectangle's centre, a fillet's
// virtual sharp) still deletes, with its constraints and dimensions (Fusion D-25). Every Delete path asks THIS plan (deleteSelection: the Delete key,
// Backspace, the right-click / touch-and-hold menu, the footer red X, Cut; hasSelection: the red X's enabled state).

// What Delete does with the current selection: { pointSplits, constraints, shapes, joints (the free points and the selected shapes' orphaned points),
// curvePoints (the selected curve points it refuses) }.
function deletePlan(state) {
  // TASK 577: nothing of a LOCKED sketch is deleted (a pick cannot select it; this is the same rule for a selection made some other way)
  const inert = inertEntities(state);
  const pickedConstraints = state.selectedConstraints ? Array.from(state.selectedConstraints).filter((c) => !isConstraintInert(inert, c)) : [];
  // TASK 1041: a selected SharedPointCoincident glyph (#core/shared-point.js, derived, never stored) is a curve's membership of a shared point:
  // its Delete detaches that curve (deleteSharedPointCoincidents); every other selected constraint is deleted as before
  const pointSplits = pickedConstraints.filter(isSharedPointCoincident);
  const constraints = pickedConstraints.filter((c) => !isSharedPointCoincident(c));
  const shapes = state.selectedShapes ? Array.from(state.selectedShapes).filter((id) => !isShapeInert(inert, id)) : [];
  const selectedJoints = state.selectedJoints ? Array.from(state.selectedJoints).filter((id) => !isJointInert(inert, id)) : [];
  const onCurves = new Set((state.shapes || []).flatMap((s) => asList(s && s.joints)));
  const isCurvePoint = (id) => id === ORIGIN_JOINT_ID || onCurves.has(id);
  const curvePoints = selectedJoints.filter(isCurvePoint);
  const joints = selectedJoints.filter((id) => !isCurvePoint(id));
  // the selected shapes' points that no surviving shape uses go with them (a centre a constraint no longer names, an orphanAllowed slot centre)
  const goneShapes = new Set(shapes);
  const usedBySurvivors = new Set((state.shapes || []).filter((s) => s && !goneShapes.has(s.id)).flatMap((s) => asList(s.joints)));
  const vsProtected = virtualSharpProtectedJoints(state);
  const listed = new Set(joints);
  for (const s of (state.shapes || [])) {
    if (!s || !goneShapes.has(s.id)) continue;
    for (const jid of asList(s.joints)) {
      if (jid !== ORIGIN_JOINT_ID && !usedBySurvivors.has(jid) && !listed.has(jid) && !vsProtected.has(jid)) { joints.push(jid); listed.add(jid); }
    }
  }
  return { pointSplits, constraints, shapes, joints, curvePoints };
}
const planDeletes = (p) => p.pointSplits.length > 0 || p.constraints.length > 0 || p.shapes.length > 0 || p.joints.length > 0;

/** TASK 1044: the hint a Delete that the point rule refused answers with (null: nothing refused). The origin alone has its own sentence. */
export function deleteRefusedHint(curvePoints) {
  if (!curvePoints || curvePoints.length === 0) return null;
  if (curvePoints.every((id) => id === ORIGIN_JOINT_ID)) return "The origin can't be deleted.";
  return 'Select the line to delete it, or the corner mark to separate.';
}

/**
 * Delete the current selection in ONE undo step (THE point rule above decides what goes): the selected constraints / dimensions, the selected
 * SharedPointCoincident glyphs (a split), the selected shapes (with their points no surviving shape uses), the selected FREE points. Selected curve
 * points are ignored. -> { deleted: whether anything was deleted, hint: deleteRefusedHint when nothing was and curve points were refused, else null }
 * @param {object} state - Application state
 */
export function deleteSelection(state) {
  if (!state) return { deleted: false, hint: null };
  const plan = deletePlan(state);
  const { pointSplits, constraints: constraintsToDelete, shapes: explicitShapes, joints: safeToDelete } = plan;
  if (!planDeletes(plan)) return { deleted: false, hint: deleteRefusedHint(plan.curvePoints) };

  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup('delete selection'); } catch (_) {}

  // 3. Execute Deletions
  if (pointSplits.length > 0) deleteSharedPointCoincidents(state, pointSplits);
  if (constraintsToDelete.length > 0) deleteConstraints(state, constraintsToDelete);
  if (explicitShapes.length > 0) deleteShapes(state, explicitShapes);
  if (safeToDelete.length > 0) deleteJoints(state, safeToDelete);

  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}
  return { deleted: true, hint: null };
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

/** True when Delete acts on the current selection: it deletes something, or (TASK 1044, the point rule) it answers a refused curve-point
 *  selection with its hint, so the footer red X agrees with the Delete key. The same plan as deleteSelection. */
export function hasSelection(state) {
  if (!state) return false;
  const size = (set) => (set ? set.size : 0);
  if (size(state.selectedShapes) + size(state.selectedJoints) + size(state.selectedConstraints) === 0) return false;
  const plan = deletePlan(state);
  return planDeletes(plan) || plan.curvePoints.length > 0;
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
