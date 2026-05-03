import { removeOrphanJoints } from './joints.js';
import { SolverConfig } from './solver-config.js';

export function deleteConstraints(state, constraintsOrIds) {
  if (!state) return 0;
  const toDelete = Array.isArray(constraintsOrIds) ? constraintsOrIds : [constraintsOrIds];
  if (toDelete.length === 0) return 0;
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup(); } catch (_) {}
  try { if (typeof state.saveState === 'function') state.saveState(); } catch (_) {}

  let removed = 0;
  for (const c of toDelete) {
    // Remove by reference or by index/id
    const idx = state.constraints.indexOf(c);
    if (idx !== -1) { state.constraints.splice(idx, 1); removed++; continue; }
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

  // Clear selection references
  try { if (state.selectedConstraints && typeof state.selectedConstraints.clear === 'function') state.selectedConstraints.clear(); } catch(_) {}

  // Re-solve (best-effort)
  try { if (state.engine && typeof state.engine.solve === 'function') state.engine.solve(SolverConfig.QUICK_SOLVE || 8); } catch(_) {}
  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}

  return removed;
}

export function deleteShapes(state, shapeIds) {
  if (!state) return 0;
  const ids = Array.isArray(shapeIds) ? shapeIds.slice() : [shapeIds];
  if (ids.length === 0) return 0;
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup(); } catch (_) {}
  try { if (typeof state.saveState === 'function') state.saveState(); } catch (_) {}

  let removed = 0;
  const removedJoints = new Set();

  for (const id of ids) {
    const idx = state.shapes.findIndex(s => s && s.id === id);
    if (idx !== -1) {
      const s = state.shapes[idx];
      // Collect joints to consider for orphan cleanup
      if (s && s.joints && Array.isArray(s.joints)) s.joints.forEach(j => removedJoints.add(j));
      state.shapes.splice(idx, 1);
      removed++;
    }
  }

  // Remove constraints that reference removed shapes (including tangent line/circle fields)
  for (let i = state.constraints.length - 1; i >= 0; i--) {
    const c = state.constraints[i];
    if (!c) continue;
    if ((c.shape && ids.includes(c.shape))
        || (c.shapes && c.shapes.some(sid => ids.includes(sid)))
        || (c.line && ids.includes(c.line))
        || (c.circle && ids.includes(c.circle))) {
      state.constraints.splice(i, 1);
    }
  }

  // Remove shapes that referenced removed joints (safety)
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (!s) continue;
    if (s.joints && s.joints.some(j => removedJoints.has(j))) {
      state.shapes.splice(i, 1);
      removed++;
    }
  }

  // Clean orphan joints
  try { removeOrphanJoints(state); } catch(_) {}

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
  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup(); } catch (_) {}
  try { if (typeof state.saveState === 'function') state.saveState(); } catch (_) {}

  let removed = 0;
  // Remove joints from shapes; if any shape loses joints, remove it
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (!s || !s.joints) continue;
    // If the shape references any of the joints-to-delete, remove the shape entirely
    if (s.joints.some(j => ids.includes(j))) {
      state.shapes.splice(i, 1);
      removed++;
    }
  }

  // Remove constraints that reference the joints
  for (let i = state.constraints.length - 1; i >= 0; i--) {
    const c = state.constraints[i];
    if (!c) continue;
    if ((c.joints && c.joints.some(j => ids.includes(j))) || (c.joint && ids.includes(c.joint))) {
      state.constraints.splice(i, 1);
    }
  }

  // Finally remove the joints from the joints map
  for (const jid of ids) {
    if (state.joints && state.joints.has(jid)) { state.joints.delete(jid); removed++; }
  }

  // Cleanup orphans
  try { removeOrphanJoints(state); } catch(_) {}

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

  try { if (typeof state.beginUndoGroup === 'function') state.beginUndoGroup(); } catch (_) {}

  // 1. Identify explicit selections
  const constraintsToDelete = state.selectedConstraints ? Array.from(state.selectedConstraints) : [];
  const explicitShapes = state.selectedShapes ? Array.from(state.selectedShapes) : [];
  const explicitJoints = state.selectedJoints ? Array.from(state.selectedJoints) : [];

  // Add explicitly selected constraints (dimensions, etc.) to the delete list
  if (state.selectedConstraints && state.selectedConstraints.size > 0) {
      for (const c of state.selectedConstraints) {
          constraintsToDelete.push(c);
      }
  }

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
  for (const jid of candidateJoints) {
      if (!usedBySurvivors.has(jid) && !jointsToDeleteSet.has(jid)) {
          finalJointsToDelete.push(jid);
          jointsToDeleteSet.add(jid);
      }
  }

  // 3. Execute Deletions
  if (constraintsToDelete.length > 0) deleteConstraints(state, constraintsToDelete);
  if (explicitShapes.length > 0) deleteShapes(state, explicitShapes);
  
  if (finalJointsToDelete.length > 0) {
      // Protect origin from deletion
      const safeToDelete = finalJointsToDelete.filter(id => id !== 'j_origin');
      if (safeToDelete.length > 0) deleteJoints(state, safeToDelete);
  }

  try { if (typeof state.endUndoGroup === 'function') state.endUndoGroup(); } catch (_) {}
}
