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
  return { sketches: [{ id: DEFAULT_SKETCH_ID, name: DEFAULT_SKETCH_NAME, visible: true }], activeSketchId: DEFAULT_SKETCH_ID, groups: [], vcarves: [] };
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

// A constraint's sketch: the HOME id (a string) when all its joints share one sketch; else the SET of the spanning
// sketchIds (the cross-sketch LINK signal — the constraint shows under each). null when it resolves no joints.
export function constraintSketch(constraint, state) {
  const joints = state && state.joints;
  const ids = new Set();
  for (const jid of ((constraint && constraint.joints) || [])) {
    const j = (joints && typeof joints.get === 'function') ? joints.get(jid) : null;
    ids.add(sketchOf(j));
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
  if (state && Array.isArray(state.sketches) && state.sketches.some((s) => s.id === id)) state.activeSketchId = id;
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
