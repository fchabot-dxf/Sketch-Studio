// packages/core/sketch-model.js — the SKETCH CONTAINER data model + pure derived helpers. PURE (no DOM).
//
// Sketches are an ORGANIZATIONAL + EXPORT OVERLAY over the GLOBAL solver — a `sketchId` LABEL on entities + a sketches
// list + an active sketch. The solver NEVER reads any of this (it stays one global system over flat
// joints/constraints/shapes). ADDITIVE — declared here, NO consumer yet (the panel sketch-tree = S-1b; export
// sketch→<g> = a later slice) → both apps byte-identical. Default = a single 'Sketch 1' owning everything; an UNTAGGED
// entity resolves to Sketch 1 via the `sketchOf` fallback, so today's flat single-sketch behaviour is unchanged.

export const DEFAULT_SKETCH_ID = 'sketch-1';
export const DEFAULT_SKETCH_NAME = 'Sketch 1';

// The default container: one visible 'Sketch 1', active, and NO user groups. Spread onto the sketch state.
// (SKETCH-4c: `groups` = the user-GROUP list — the Sketch > Group > Entity substrate; see #core/group-model.js.)
export function createSketches() {
  // VCARVE-3b: `vcarves` = the V-carve records (a region + a V-bit + params); like `groups`, additive DATA, unread by
  // SketchStudio → byte-identical. The contour stack is DERIVED (vcarveContours), never materialized.
  return { sketches: [{ id: DEFAULT_SKETCH_ID, name: DEFAULT_SKETCH_NAME, visible: true }], activeSketchId: DEFAULT_SKETCH_ID, groups: [], vcarves: [], soloMemory: null };
}

// An entity's sketch — its stored `sketchId`, or the default (untagged entities belong to Sketch 1; load-safe).
export function sketchOf(entity) {
  return (entity && entity.sketchId) || DEFAULT_SKETCH_ID;
}

// Stamp an entity (joint / shape) with the state's ACTIVE sketch at creation. Returns the entity (chainable).
export function stampSketch(entity, state) {
  if (entity) entity.sketchId = (state && state.activeSketchId) || DEFAULT_SKETCH_ID;
  return entity;
}

// A constraint's sketch: the HOME id (a string) when all its joints/shapes share one sketch; else the SET of the spanning
// sketchIds (the cross-sketch LINK signal — the constraint shows under each). null when it resolves no joints or shapes.
export function constraintSketch(constraint, state) {
  const joints = state && state.joints;
  const ids = new Set();
  for (const jid of ((constraint && constraint.joints) || [])) {
    const j = (joints && typeof joints.get === 'function') ? joints.get(jid) : null;
    ids.add(sketchOf(j));
  }
  const shapes = state && state.shapes;
  const resolveShape = (sid) => {
    if (!sid) return null;
    if (typeof sid === 'object' && sid.id) return sid;
    if (Array.isArray(shapes)) return shapes.find((s) => s && s.id === sid);
    if (shapes && typeof shapes.get === 'function') return shapes.get(sid);
    return null;
  };
  if (constraint && constraint.shape) {
    ids.add(sketchOf(resolveShape(constraint.shape)));
  }
  if (constraint && Array.isArray(constraint.shapes)) {
    for (const sid of constraint.shapes) {
      ids.add(sketchOf(resolveShape(sid)));
    }
  }
  if (ids.size === 0) return null;
  if (ids.size === 1) return [...ids][0];
  return ids; // spans ≥2 sketches → the LINK
}

// SKETCH-2a: append a new sketch ('Sketch N' with the lowest free 'sketch-N' id) and return it (does NOT activate —
// the caller activates). activateSketch sets the active sketch (new geometry stamps with it). Both MUTATE state.
export function addSketch(state, name) {
  if (!state.sketches) Object.assign(state, createSketches());
  const used = new Set(state.sketches.map((s) => s.id));
  let n = 1; while (used.has('sketch-' + n)) n++;
  const sk = { id: 'sketch-' + n, name: name || ('Sketch ' + n), visible: true };
  state.sketches.push(sk);
  return sk;
}
export function activateSketch(state, id) {
  if (state && Array.isArray(state.sketches) && state.sketches.some((s) => s.id === id && s.locked !== true)) state.activeSketchId = id; // TASK 577: a LOCKED sketch is never active (refused; the lock icon unlocks)
  return state && state.activeSketchId;
}

// SKETCH-2b: the set of HIDDEN sketch ids (visible === false). Default (all visible) → empty → nothing filtered →
// byte-identical. The canvas render filter skips entities whose sketch is in this set.
export function hiddenSketchIds(state) {
  const ids = new Set();
  if (state && Array.isArray(state.sketches)) for (const s of state.sketches) if (s && s.visible === false) ids.add(s.id);
  return ids;
}

// All entity ids in a sketch: { joints:[id…], shapes:[id…] }.
export function entitiesInSketch(state, id) {
  const joints = [], shapes = [];
  const J = state && state.joints;
  if (J && typeof J.forEach === 'function') J.forEach((j, jid) => { if (sketchOf(j) === id) joints.push(jid); });
  if (state && Array.isArray(state.shapes)) for (const s of state.shapes) if (sketchOf(s) === id) shapes.push(s.id);
  return { joints, shapes };
}

// ───────────────────────── TASK 577: sketches as LAYERS — lock, move to sketch, reorder, solo ─────────────────────────
// Everything a host's Design tab does with sketches goes through these functions (the panel and the canvas context menu call the
// SAME ones). Each action that changes the document records ONE undo step (state.saveState, the shared snapshot that already carries
// `sketches` + `activeSketchId` + every entity's sketchId), so Ctrl+Z reverts the whole action. The saved format only GAINS: a sketch
// object may carry `locked: true` (absent = unlocked: old files load unchanged) and the ORDER of state.sketches is the saved order.
const ORIGIN_ID = 'j_origin'; // the fixed origin joint (constants.js ORIGIN_JOINT_ID): shared by every sketch, never locked or hidden

/** The ONE undo path of the sketch actions: a snapshot BEFORE the change, so one Ctrl+Z reverts it. No-op for a headless state. */
export function recordUndo(state, label) { if (state && typeof state.saveState === 'function') state.saveState(label); }

/** The ids of the LOCKED sketches. */
export function lockedSketchIds(state) {
  const ids = new Set();
  if (state && Array.isArray(state.sketches)) for (const s of state.sketches) if (s && s.locked === true) ids.add(s.id);
  return ids;
}
export function isSketchLocked(state, id) { return lockedSketchIds(state).has(id); }

/**
 * Lock or unlock a sketch (one undo step). A LOCKED sketch stays visible and is still a snap target, but its shapes, points,
 * dimensions and constraints cannot be picked, dragged, deleted or edited, and nothing is drawn into it. The ACTIVE sketch (the
 * one new geometry goes into) is never locked: locking it moves the active sketch to the next unlocked one (the previous one when it
 * was last), and when no other sketch is unlocked the lock is refused. Returns { ok, reason?, activeSketchId }.
 */
export function setSketchLocked(state, id, locked) {
  const sk = state && Array.isArray(state.sketches) ? state.sketches.find((s) => s.id === id) : null;
  if (!sk) return { ok: false, reason: 'no such sketch', activeSketchId: state && state.activeSketchId };
  const want = !!locked;
  if (!!sk.locked === want) return { ok: true, activeSketchId: state.activeSketchId };
  let nextActive = null;
  if (want && state.activeSketchId === id) {
    const i = state.sketches.indexOf(sk);
    const others = state.sketches.filter((s) => s !== sk && s.locked !== true);
    nextActive = others.find((s) => state.sketches.indexOf(s) > i) || others[others.length - 1] || null;
    if (!nextActive) return { ok: false, reason: 'this is the only unlocked sketch: new geometry needs one to go into', activeSketchId: state.activeSketchId };
  }
  recordUndo(state, want ? 'lock sketch' : 'unlock sketch');
  if (want) sk.locked = true; else delete sk.locked; // an unlocked sketch carries no `locked` key (saved files stay as they were)
  if (nextActive) state.activeSketchId = nextActive.id;
  return { ok: true, activeSketchId: state.activeSketchId };
}

/**
 * Entities a pick must NOT reach: those of a LOCKED sketch (not editable) and of a HIDDEN sketch (not on the canvas).
 * { lockedJ, lockedS, hiddenJ, hiddenS } (Sets of joint / shape ids), or null when no sketch is locked or hidden (the fast path:
 * the unchanged one-sketch behaviour). A joint a locked sketch's shape uses is locked too, even when it was stamped to another
 * sketch (a point shared across sketches must not move a locked shape); the origin is neither.
 */
export function inertEntities(state) {
  const locked = lockedSketchIds(state), hidden = hiddenSketchIds(state);
  if (!locked.size && !hidden.size) return null;
  const r = { lockedJ: new Set(), lockedS: new Set(), hiddenJ: new Set(), hiddenS: new Set() };
  const J = state.joints;
  if (J && typeof J.forEach === 'function') J.forEach((j, jid) => {
    if (jid === ORIGIN_ID) return;
    const sk = sketchOf(j);
    if (locked.has(sk)) r.lockedJ.add(jid);
    if (hidden.has(sk)) r.hiddenJ.add(jid);
  });
  for (const s of (state.shapes || [])) {
    const sk = sketchOf(s);
    const l = locked.has(sk), h = hidden.has(sk);
    if (l) r.lockedS.add(s.id);
    if (h) r.hiddenS.add(s.id);
    if (l) for (const jid of (s.joints || [])) if (jid !== ORIGIN_ID) r.lockedJ.add(jid);
  }
  return r;
}
const operandsOf = (c) => {
  const shapes = [];
  if (c && c.shape) shapes.push(c.shape);
  if (c && Array.isArray(c.shapes)) shapes.push(...c.shapes);
  return { joints: (c && c.joints) || [], shapes: shapes.map((s) => (s && typeof s === 'object' ? s.id : s)) };
};
export const isJointInert = (inert, id) => !!inert && (inert.lockedJ.has(id) || inert.hiddenJ.has(id));
export const isShapeInert = (inert, id) => !!inert && (inert.lockedS.has(id) || inert.hiddenS.has(id));
/** A constraint / dimension is out of reach when ANY operand is locked, or ALL its operands are hidden (it is drawn while one shows). */
export function isConstraintInert(inert, c) {
  if (!inert) return false;
  const { joints, shapes } = operandsOf(c);
  if (joints.some((id) => inert.lockedJ.has(id)) || shapes.some((id) => inert.lockedS.has(id))) return true;
  const n = joints.length + shapes.length;
  return n > 0 && joints.every((id) => inert.hiddenJ.has(id)) && shapes.every((id) => inert.hiddenS.has(id));
}
/** The joints Map and shapes array a PICK may search: the real ones when nothing is inert (the same objects), else filtered copies. */
export function pickScene(state, shapes = state.shapes) {
  const inert = inertEntities(state);
  if (!inert) return { joints: state.joints, shapes, inert };
  const joints = new Map();
  for (const [id, j] of state.joints) if (!isJointInert(inert, id)) joints.set(id, j);
  return { joints, shapes: shapes.filter((s) => !isShapeInert(inert, s.id)), inert };
}
/** True when a snap result (joint / shape / virtual midpoint) lands on an inert joint or shape. */
export function snapIsInert(inert, snap) {
  if (!inert || !snap) return false;
  if (snap.type === 'joint') return isJointInert(inert, snap.targetId);
  if (snap.shape && snap.shape.id != null) return isShapeInert(inert, snap.shape.id);
  if (Array.isArray(snap.joints)) return snap.joints.some((id) => isJointInert(inert, id));
  return false;
}
/** A locked sketch is a REFERENCE for drawing: the pointer snaps to its place but binds to nothing (no shared point, no constraint). */
export function asPositionSnap(snap) {
  const pt = snap.pt || { x: snap.x, y: snap.y };
  return { type: 'grid', pt: { x: pt.x, y: pt.y } };
}

/**
 * MOVE SHAPES (and their points) to another sketch: one undo step. The shapes are the given ids plus every shape that uses a given
 * joint; their joints go with them. A constraint / dimension whose operands ALL move goes with them (it follows its operands'
 * sketch, derived by constraintSketch). The rule that a constraint stays inside one sketch is NOT changed: a move that would split
 * a constraint (some operands move, some stay), or leave a point shared with a shape that stays, is REFUSED and nothing changes.
 * The origin and the axes belong to no sketch (neutral). Returns { ok, reason?, shapes, joints, constraints }.
 */
export function moveToSketch(state, { shapeIds = [], jointIds = [] } = {}, targetId) {
  const fail = (reason) => ({ ok: false, reason, shapes: 0, joints: 0, constraints: 0 });
  const target = state && Array.isArray(state.sketches) ? state.sketches.find((s) => s.id === targetId) : null;
  if (!target) return fail('no such sketch');
  if (target.locked === true) return fail(`"${target.name}" is locked`);
  const move = new Set(), moveJ = new Set();
  const shapeById = new Map((state.shapes || []).map((s) => [s.id, s]));
  for (const id of shapeIds) if (shapeById.has(id)) move.add(id);
  for (const jid of jointIds) { if (jid === ORIGIN_ID) continue; for (const s of state.shapes) if ((s.joints || []).includes(jid)) move.add(s.id); }
  for (const id of move) for (const jid of (shapeById.get(id).joints || [])) if (jid !== ORIGIN_ID) moveJ.add(jid);
  for (const jid of jointIds) if (jid !== ORIGIN_ID && state.joints.has(jid)) moveJ.add(jid); // a free point with no shape
  if (!move.size && !moveJ.size) return fail('nothing to move');
  const locked = lockedSketchIds(state);
  for (const id of move) if (locked.has(sketchOf(shapeById.get(id)))) return fail('a shape is in a locked sketch');
  for (const jid of moveJ) if (locked.has(sketchOf(state.joints.get(jid)))) return fail('a point is in a locked sketch');
  // a point shared with a shape that stays behind
  for (const s of state.shapes) if (!move.has(s.id) && (s.joints || []).some((jid) => moveJ.has(jid))) return fail('a point is shared with a shape that stays in its sketch');
  // constraints: all operands move (goes along) / none move (stays) / mixed (refuse)
  let along = 0, split = 0;
  for (const c of (state.constraints || [])) {
    const { joints, shapes } = operandsOf(c);
    const real = joints.filter((id) => id !== ORIGIN_ID && state.joints.has(id)), realS = shapes.filter((id) => shapeById.has(id));
    const nMove = real.filter((id) => moveJ.has(id)).length + realS.filter((id) => move.has(id)).length;
    if (!nMove) continue;
    if (nMove === real.length + realS.length) along++; else split++;
  }
  if (split) return fail(`${split} constraint${split === 1 ? '' : 's'} / dimension${split === 1 ? '' : 's'} tie${split === 1 ? 's' : ''} these shapes to geometry that stays in its sketch (a constraint stays inside one sketch)`);
  recordUndo(state, 'move to sketch');
  for (const id of move) shapeById.get(id).sketchId = targetId;
  for (const jid of moveJ) state.joints.get(jid).sketchId = targetId;
  return { ok: true, shapes: move.size, joints: moveJ.size, constraints: along };
}

/** Move the CURRENT SELECTION (selected shapes + points) to a sketch: moveToSketch on what state.selectedShapes / selectedJoints hold. */
export function moveSelectionToSketch(state, targetId) {
  return moveToSketch(state, { shapeIds: [...(state.selectedShapes || [])], jointIds: [...(state.selectedJoints || [])] }, targetId);
}
/** The sketches a selection may be moved to: every unlocked sketch (none when the document has one sketch). */
export function moveTargets(state) {
  return state && Array.isArray(state.sketches) && state.sketches.length > 1 ? state.sketches.filter((s) => s.locked !== true) : [];
}

/** A cheap string that changes when anything the sketch tree shows changes (order, names, visibility, lock, active, solo, how many shapes each holds). */
export function sketchesSignature(state) {
  if (!state || !Array.isArray(state.sketches)) return '';
  const n = new Map();
  for (const s of (state.shapes || [])) { const k = sketchOf(s); n.set(k, (n.get(k) || 0) + 1); }
  return state.sketches.map((s) => s.id + '|' + s.name + '|' + (s.visible === false ? 'h' : 'v') + (s.locked === true ? 'L' : '') + '|' + (n.get(s.id) || 0)).join(',') + '|' + state.activeSketchId + '|' + (state.soloMemory ? state.soloMemory.soloId : '');
}

/** REORDER: put a sketch at an index of state.sketches (the saved order; one undo step). Returns true when it moved. */
export function reorderSketch(state, id, toIndex) {
  const list = state && state.sketches;
  const from = Array.isArray(list) ? list.findIndex((s) => s.id === id) : -1;
  if (from < 0) return false;
  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  if (to === from) return false;
  recordUndo(state, 'reorder sketch');
  const [sk] = list.splice(from, 1); list.splice(to, 0, sk);
  return true;
}
/** Move a sketch one place up (-1, toward the top of the tree) or down (+1): the keyboard / touch twin of dragging it. */
export function moveSketchBy(state, id, delta) {
  const i = state && Array.isArray(state.sketches) ? state.sketches.findIndex((s) => s.id === id) : -1;
  return i < 0 ? false : reorderSketch(state, id, i + delta);
}

/** True while `id` is the only visible sketch AND a solo memory of it exists (what "solo'd" shows in the panel). */
export function isSoloed(state, id) {
  const m = state && state.soloMemory;
  return !!m && m.soloId === id && state.sketches.every((s) => (s.id === id) === (s.visible !== false));
}
/**
 * SOLO: "show only this sketch" hides every other one (the soloed one is shown); a second call on it restores the visibility
 * exactly as it was. The memory lives on the state for the document SESSION only (not saved, not part of undo snapshots): after a
 * reload, or when the visibility was changed in between, the second call falls back to "show all". One undo step each way.
 */
export function soloSketch(state, id) {
  if (!state || !Array.isArray(state.sketches) || !state.sketches.some((s) => s.id === id)) return false;
  // already the ONLY visible sketch: this click undoes the solo: back to the remembered visibility, or (no memory: a reload, or a change since) all shown
  if (state.sketches.every((s) => (s.id === id) === (s.visible !== false))) {
    const before = state.soloMemory && state.soloMemory.soloId === id ? state.soloMemory.visibleById : null;
    recordUndo(state, 'restore sketch visibility');
    for (const s of state.sketches) s.visible = before && before.has(s.id) ? before.get(s.id) : true;
    state.soloMemory = null;
    return true;
  }
  recordUndo(state, 'show only sketch');
  state.soloMemory = { soloId: id, visibleById: new Map(state.sketches.map((s) => [s.id, s.visible !== false])) };
  for (const s of state.sketches) s.visible = s.id === id;
  return true;
}

/** The constraints a pick may reach (the real array when nothing is locked or hidden). */
export function pickableConstraints(state) {
  const inert = inertEntities(state);
  return inert ? (state.constraints || []).filter((c) => !isConstraintInert(inert, c)) : state.constraints;
}
