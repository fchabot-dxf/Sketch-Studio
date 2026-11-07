// packages/core/group-model.js — the user GROUP substrate (SKETCH-4c). A GROUP is an ad-hoc sub-container inside a
// sketch (Sketch > Group > Entity): a `userGroupId` membership tag on SHAPES + a `state.groups` list
// [{ id, name, sketchId }]. PURE (no DOM).
//
// CRITICAL: `userGroupId` is DISTINCT from the shape factories' `groupId` (the RENDERER's closed-shape-fill key —
// LEFT UNTOUCHED). The user group never reads/writes the factory `groupId`.
//
// ADDITIVE — declared here, NO consumer yet (the Group ACTION = S-4d; islands / export threading = S-4e) → both apps
// byte-identical. Declared richly (name + sketch) so a future action / tree / export all read DATA, not new code.

import { polygonContains } from './loop-geometry.js';

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

// groupOfLoop(loop, state) → the `userGroupId` a loop belongs to (when ALL its edge-shapes share one), else null.
export function groupOfLoop(loop, state) {
  if (!loop || !Array.isArray(loop.edges) || !loop.edges.length) return null;
  const shapeById = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
  const gid = groupOf(shapeById.get(loop.edges[0]));
  if (!gid) return null;
  return loop.edges.every((eid) => groupOf(shapeById.get(eid)) === gid) ? gid : null;
}

// holesOfLoop(loopOrId, loops, state, loopPolys, { requireGroup = true } = {}) → string[] (loop ids)
// Derive the direct holes of `loopOrId`:
// 1. By default (`requireGroup: true`), holes must belong to the same explicit user GROUP (SKETCH-4e).
//    Set `requireGroup: false` for pure geometric containment (one-line switch if future needs automatic).
// 2. A candidate hole must be strictly contained inside the outer loop's polygon (`polygonContains`).
// 3. Nested-island filter (bullseye): candidates contained inside any other candidate hole are excluded
//    (a solid island inside a hole stays uncut).
export function holesOfLoop(loopOrId, loops, state, loopPolys, { requireGroup = true } = {}) {
  if (!loopOrId || !Array.isArray(loops) || !state || !loopPolys) return [];
  const loop = typeof loopOrId === 'object' ? loopOrId : loops.find((l) => l && l.id === loopOrId);
  if (!loop || !loop.id) return [];
  const outerPoly = loopPolys[loop.id];
  if (!outerPoly || outerPoly.length < 3) return [];

  let candidateIds;
  if (requireGroup) {
    const gid = groupOfLoop(loop, state);
    if (!gid) return [];
    candidateIds = loopsInGroup(loops, state, gid).filter((hid) => hid !== loop.id);
  } else {
    candidateIds = loops.map((l) => l && l.id).filter((hid) => hid && hid !== loop.id);
  }

  const candidateHoles = [];
  for (const hid of candidateIds) {
    const hp = loopPolys[hid];
    if (hp && hp.length >= 3 && polygonContains(outerPoly, hp)) {
      candidateHoles.push({ id: hid, poly: hp });
    }
  }

  // Nested-island filter: exclude any candidate that is inside another candidate hole
  const directHoles = candidateHoles.filter((h) =>
    !candidateHoles.some((other) => other.id !== h.id && polygonContains(other.poly, h.poly))
  );

  return directHoles.map((h) => h.id);
}
