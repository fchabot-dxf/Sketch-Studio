// packages/core/lock-state.js — THE single source of truth for Lock / Unlock (UX-06 / B-1, UX-26).
// Shared by input-manager.js (selectionLockState, toggleFixedSelection), svg-renderer.js (LOCKED_LINE_COLOR),
// and solver/engine.js (hasRadiusUnknown reads shape.fixed on scalar-radius circles).

export function isJointLocked(joints, jid) {
  if (jid === 'j_origin') return true;
  const j = joints && joints.get(jid);
  return !!(j && j.fixed === true);
}

// A circle whose radius is stored as a scalar (`shape.radius`, 1 centre joint) rather than a rim joint.
export function isScalarRadiusCircle(s) {
  return !!s && s.type === 'circle' && Array.isArray(s.joints) && s.joints.length === 1
    && typeof s.radius === 'number' && Number.isFinite(s.radius);
}

// If `jid` is a tangent endpoint of a fillet arc (`arc.filletSharp === jV`) whose virtual sharp `jV`
// is held on `shape` by pointOnLine, return `jV`; else null.
function filletVirtualSharpForJoint(state, shape, jid) {
  const shapes = state && state.shapes;
  const constraints = state && state.constraints;
  if (!shape || !Array.isArray(shapes) || !Array.isArray(constraints)) return null;
  for (const arc of shapes) {
    if (!arc || arc.type !== 'arc' || !arc.filletSharp || arc.id === shape.id) continue;
    if (!Array.isArray(arc.joints) || !arc.joints.slice(1).includes(jid)) continue;
    if (constraints.some((c) => c && c.type === 'pointOnLine' && c.joint === arc.filletSharp && c.shape === shape.id)) {
      return arc.filletSharp;
    }
  }
  return null;
}

// The effective lock joints of a shape: each joint, except an unlocked fillet tangent end resolves to
// its fillet's fixed virtual sharp (UX-26: a filleted locked line stays locked while its tangent end
// remains free to slide along the line when the fillet radius is edited).
export function shapeLockJoints(state, shape) {
  if (!shape || !Array.isArray(shape.joints)) return [];
  const joints = state && state.joints;
  return shape.joints.map((jid) => {
    if (isJointLocked(joints, jid)) return jid;
    const v = filletVirtualSharpForJoint(state, shape, jid);
    return v && isJointLocked(joints, v) ? v : jid;
  });
}

// THE single predicate for "is this shape locked?" (selectionLockState, toggleFixedSelection, svg-renderer).
export function isShapeLocked(state, shape) {
  if (!shape || !Array.isArray(shape.joints) || shape.joints.length === 0) return false;
  if (isScalarRadiusCircle(shape) && shape.fixed !== true) return false;
  const jids = shapeLockJoints(state, shape);
  return jids.length > 0 && jids.every((id) => isJointLocked(state && state.joints, id));
}

// Collect { joints: string[], circles: Shape[] } that Lock / Unlock inspects and toggles.
export function lockTargets(state, selectionOnly = false) {
  const jointIds = new Set();
  const circles = new Set();
  const addShape = (s) => {
    if (!s) return;
    if (isScalarRadiusCircle(s)) circles.add(s);
    for (const jid of shapeLockJoints(state, s)) jointIds.add(jid);
  };

  if (state && state.selectedJoints && state.selectedJoints.size) {
    for (const jid of state.selectedJoints) jointIds.add(jid);
  }
  if (state && state.selectedShapes && state.selectedShapes.size) {
    for (const sid of state.selectedShapes) {
      const s = (state.shapes || []).find((x) => x && x.id === sid);
      addShape(s);
    }
  }
  if (!selectionOnly && jointIds.size === 0 && circles.size === 0 && state && state.hoveredShape) {
    const s = (state.shapes || []).find((x) => x && x.id === state.hoveredShape);
    addShape(s);
  }
  return { joints: Array.from(jointIds), circles: Array.from(circles) };
}
