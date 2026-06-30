// packages/core/group-model.js — the user GROUP substrate (SKETCH-4c). A GROUP is an ad-hoc sub-container inside a
// sketch (Sketch > Group > Entity): a `userGroupId` membership tag on SHAPES + a `state.groups` list
// [{ id, name, sketchId }]. PURE (no DOM).
//
// CRITICAL: `userGroupId` is DISTINCT from the shape factories' `groupId` (the RENDERER's closed-shape-fill key —
// LEFT UNTOUCHED). The user group never reads/writes the factory `groupId`.
//
// ADDITIVE — declared here, NO consumer yet (the Group ACTION = S-4d; islands / export threading = S-4e) → both apps
// byte-identical. Declared richly (name + sketch) so a future action / tree / export all read DATA, not new code.

// An entity's USER group — its stored `userGroupId`, or null (ungrouped). NOT the factory `groupId`.
export function groupOf(shape) { return (shape && shape.userGroupId) || null; }

// makeGroup(state, shapeIds, name?) → the new group. Mints a fresh 'group-N' id, stamps each named shape's
// `userGroupId`, and appends { id, name, sketchId } (the group belongs to the ACTIVE sketch). Returns the group, or
// null on no shapes.
export function makeGroup(state, shapeIds, name) {
  if (!state) return null;
  if (!Array.isArray(state.groups)) state.groups = [];
  const ids = new Set(shapeIds || []);
  if (!ids.size) return null;
  const used = new Set(state.groups.map((g) => g.id));
  let n = 1; while (used.has('group-' + n)) n++;
  const id = 'group-' + n;
  const sketchId = state.activeSketchId || 'sketch-1';
  for (const s of (state.shapes || [])) if (ids.has(s.id)) s.userGroupId = id;
  const g = { id, name: name || ('Group ' + n), sketchId };
  state.groups.push(g);
  return g;
}

// ungroup(state, gid) → clears the `userGroupId` stamp off every member shape + removes the group entry.
export function ungroup(state, gid) {
  if (!state || !gid) return false;
  for (const s of (state.shapes || [])) if (s && s.userGroupId === gid) delete s.userGroupId;
  if (Array.isArray(state.groups)) { const i = state.groups.findIndex((g) => g.id === gid); if (i >= 0) state.groups.splice(i, 1); }
  return true;
}

// renameGroup(state, gid, name) → rename the group entry.
export function renameGroup(state, gid, name) {
  if (!state || !Array.isArray(state.groups)) return false;
  const g = state.groups.find((x) => x.id === gid); if (!g) return false;
  g.name = name; return true;
}

// shapesInGroup(state, gid) → the shape ids carrying the group's `userGroupId`.
export function shapesInGroup(state, gid) {
  return ((state && state.shapes) || []).filter((s) => groupOf(s) === gid).map((s) => s.id);
}

// loopsInGroup(loops, state, gid) → the loop ids whose ALL edge-shapes carry the group's `userGroupId` (a fully
// grouped loop). The island/export consumer reads these. (Disconnected island loops never share edges.)
export function loopsInGroup(loops, state, gid) {
  const shapeById = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
  return (loops || []).filter((l) => Array.isArray(l.edges) && l.edges.length &&
    l.edges.every((eid) => { const s = shapeById.get(eid); return s && groupOf(s) === gid; })).map((l) => l.id);
}
