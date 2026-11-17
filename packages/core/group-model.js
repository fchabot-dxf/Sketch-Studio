// packages/core/group-model.js — the user GROUP substrate (SKETCH-4c). A GROUP is an ad-hoc sub-container inside a
// sketch (Sketch > Group > Entity) for organisation only: a `userGroupId` membership tag on SHAPES + a `state.groups`
// list [{ id, name, sketchId, parentId? }]. PURE (no DOM).
//
// CRITICAL: `userGroupId` is DISTINCT from the shape factories' `groupId` (the RENDERER's closed-shape-fill key —
// LEFT UNTOUCHED). The user group never reads/writes the factory `groupId`. User groups carry NO toolpath/hole meaning
// (holes and combined faces belong exclusively to `#core/profile-model.js`) and no solver meaning (a group is not a rigid body).
//
// TASK 751: NESTED groups. A group entry may name its `parentId` (a group inside a group); a shape's `userGroupId` is its
// INNERMOST group. A document of flat groups (no parentId) is a nest of depth one: it loads unchanged.
// The Select tool works on ONE level of the nest at a time: `state.enteredGroupId` (session UI: never saved, never an undo
// step) names the group the user has ENTERED (a double click); `selectUnit` answers, for a shape, the group a click on it
// selects at that level (the ONE place that answers it).

import { findLoops, findConnectedChains } from './loop-finder.js';
import { loopPolygon, polygonContains } from './loop-geometry.js';

// An entity's USER group — its stored `userGroupId` (its innermost group), or null (ungrouped). NOT the factory `groupId`.
export function groupOf(shape) { return (shape && shape.userGroupId) || null; }

// The group INDEX of a state, built once for a whole pass over many shapes (a box selection, a frame, the browser's rows): the parent of
// each group, the groups directly inside each, shapesOf(gid) (its own shapes and its child groups'), chainOf(gid) (up to the top) and
// unitOf(shapeId) (selectUnit's answer). The shapes are read once, when first needed.
export function groupIndex(state) { return indexOf(state); }
function indexOf(state) {
  const groups = (state && state.groups) || [];
  const parent = new Map(), kids = new Map();
  for (const g of groups) { parent.set(g.id, g.parentId || null); kids.set(g.id, []); }
  for (const g of groups) if (g.parentId && kids.has(g.parentId)) kids.get(g.parentId).push(g.id);
  let direct = null; // the shapes directly in each group: read from the shapes the first time a group's shapes are asked for
  const all = new Map();
  const shapesOf = (gid) => {
    if (all.has(gid)) return all.get(gid);
    if (!direct) {
      direct = new Map(groups.map((g) => [g.id, []]));
      for (const s of ((state && state.shapes) || [])) { const g = groupOf(s); if (g && direct.has(g)) direct.get(g).push(s.id); }
    }
    const out = [...(direct.get(gid) || [])];
    all.set(gid, out);
    for (const k of (kids.get(gid) || [])) out.push(...shapesOf(k));
    return out;
  };
  const chainOf = (gid) => { const c = []; for (let g = gid; g && parent.has(g) && !c.includes(g); g = parent.get(g)) c.push(g); return c; };
  const entered = enteredGroup(state);
  let shapeById = null;
  const unitOf = (shapeId) => {
    if (!shapeById) shapeById = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
    const chain = chainOf(groupOf(shapeById.get(shapeId)));
    if (!chain.length) return null;
    const i = chain.indexOf(entered);
    if (i < 0) return chain[chain.length - 1];
    return i === 0 ? null : chain[i - 1];
  };
  return { parent, kids, shapesOf, chainOf, unitOf };
}

// The group chain of a shape: [its innermost group, ..., its outermost group]; [] for an ungrouped shape.
export function groupChain(state, shape) { return indexOf(state).chainOf(groupOf(shape)); }

// The group the user has entered, when it still exists (an undo may have removed it), else null.
export function enteredGroup(state) {
  const id = state && state.enteredGroupId;
  return id && ((state.groups || []).some((g) => g.id === id)) ? id : null;
}

// THE level rule (TASK 751): the group a Select-tool click on shape `shapeId` selects = the outermost group of the shape
// BELOW the entered level. Nothing entered: its outermost group. Inside the entered group: the entered group's child that
// holds the shape, or null when the shape is a direct member of the entered group (the click selects the curve itself).
// A shape outside the entered group: its outermost group (the Select tool leaves the entered group first). Ungrouped: null.
export function selectUnit(state, shapeId) { return indexOf(state).unitOf(shapeId); }

// Is shape `shapeId` inside group `gid` (a member of it or of one of its child groups)?
export function isInGroup(state, shapeId, gid) {
  const shape = ((state && state.shapes) || []).find((s) => s.id === shapeId);
  return !!gid && groupChain(state, shape).includes(gid);
}

// The groups the selection holds WHOLE at the entered level (every shape of the group selected): what a Select-tool click selected.
export function selectedGroups(state) {
  const ix = indexOf(state), sel = (state && state.selectedShapes) || new Set(), out = new Set();
  for (const id of sel) { const u = ix.unitOf(id); if (u && !out.has(u) && ix.shapesOf(u).every((x) => sel.has(x))) out.add(u); }
  return [...out];
}

// Enter group `gid` (one level down: the Select tool's double click). Session state only.
export function enterGroup(state, gid) { if (state && gid) state.enteredGroupId = gid; }

// Leave every entered level (a press on geometry outside the entered group).
export function leaveGroups(state) { if (state) state.enteredGroupId = null; }

// Step OUT one level (Esc, a click on empty canvas): the entered group's parent becomes the entered level. Returns true when
// a group was entered (something changed).
export function stepOutOfGroup(state) {
  const id = enteredGroup(state);
  if (!id) { leaveGroups(state); return false; }
  state.enteredGroupId = indexOf(state).parent.get(id) || null;
  return true;
}

// makeGroup(state, shapeIds, name?) → the new group. Mints a fresh 'group-N' id and appends { id, name, sketchId[, parentId] }
// (the group belongs to the ACTIVE sketch). TASK 751: a group whose shapes are ALL in `shapeIds` goes into the new group WHOLE
// (it becomes a child group: the highest such group of each shape); every other shape is stamped with the new `userGroupId`
// (it leaves the group it was in). The new group is made inside the group that held all of those items when they were all in
// the same one, else at the top. Returns the group, or null on no shapes.
export function makeGroup(state, shapeIds, name) {
  if (!state) return null;
  if (!Array.isArray(state.groups)) state.groups = [];
  const ids = new Set(shapeIds || []);
  if (!ids.size) return null;
  const ix = indexOf(state);
  const nested = new Set(), loose = [];
  let found = 0;
  for (const s of (state.shapes || [])) {
    if (found === ids.size) break;
    if (!ids.has(s.id)) continue;
    found++;
    let whole = null;
    for (const gid of ix.chainOf(groupOf(s))) { if (ix.shapesOf(gid).every((id) => ids.has(id))) whole = gid; else break; }
    if (whole) nested.add(whole); else loose.push(s);
  }
  if (!nested.size && !loose.length) return null;
  const containers = new Set([...[...nested].map((gid) => ix.parent.get(gid) || null), ...loose.map((s) => groupOf(s))]);
  const parentId = containers.size === 1 ? [...containers][0] : null;
  const used = new Set(state.groups.map((g) => g.id));
  let n = 1; while (used.has('group-' + n)) n++;
  const id = 'group-' + n;
  const sketchId = state.activeSketchId || 'sketch-1';
  for (const g of state.groups) if (nested.has(g.id)) g.parentId = id;
  for (const s of loose) s.userGroupId = id;
  const g = { id, name: name || ('Group ' + n), sketchId, ...(parentId ? { parentId } : {}) };
  state.groups.push(g);
  return g;
}

// ungroup(state, gid) → dissolves ONE level: the group's own shapes and child groups move up to its parent (or out of any
// group when it has none), and the entry is removed. A dissolved entered group leaves its parent entered.
export function ungroup(state, gid) {
  if (!state || !gid) return false;
  const g = (state.groups || []).find((x) => x.id === gid);
  const parentId = (g && g.parentId) || null;
  for (const s of (state.shapes || [])) if (s && s.userGroupId === gid) { if (parentId) s.userGroupId = parentId; else delete s.userGroupId; }
  for (const k of (state.groups || [])) if (k.parentId === gid) { if (parentId) k.parentId = parentId; else delete k.parentId; }
  if (Array.isArray(state.groups)) { const i = state.groups.findIndex((x) => x.id === gid); if (i >= 0) state.groups.splice(i, 1); }
  if (state.enteredGroupId === gid) state.enteredGroupId = parentId;
  return true;
}

// renameGroup(state, gid, name) → rename the group entry.
export function renameGroup(state, gid, name) {
  if (!state || !Array.isArray(state.groups)) return false;
  const g = state.groups.find((x) => x.id === gid); if (!g) return false;
  g.name = name; return true;
}

// shapesInGroup(state, gid) → the shape ids in the group: its own members and those of its child groups (TASK 751: nested).
export function shapesInGroup(state, gid) { return indexOf(state).shapesOf(gid); }

// childGroups(state, gid) → the ids of the groups directly inside `gid` (null: the top-level groups), in list order.
export function childGroups(state, gid) {
  return ((state && state.groups) || []).filter((g) => (g.parentId || null) === (gid || null)).map((g) => g.id);
}

// loopsInGroup(loops, state, gid) → the loop ids whose ALL edge-shapes carry the group's `userGroupId` (a fully
// grouped loop).
export function loopsInGroup(loops, state, gid) {
  const shapeById = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
  return (loops || []).filter((l) => Array.isArray(l.edges) && l.edges.length &&
    l.edges.every((eid) => { const s = shapeById.get(eid); return s && groupOf(s) === gid; })).map((l) => l.id);
}

// TASK 751: the PIECES of an imported drawing (`shapes`, already in `state`), in the order of their first shape: a piece is
// { shapeIds, outline } = a connected chain (#core loop-finder findConnectedChains: the double click's chain rule) together with the chains of the closed
// outlines directly inside one of its loops (its holes: a letter O, A, B). Nesting is even-odd: a loop inside 1, 3, ... other
// loops is a hole of the loop directly around it; a loop inside 0, 2, ... is an outline of its own (an island inside a hole is
// its own piece). `outline` = the piece has a closed loop. Construction geometry never makes a hole (findLoops skips it).
export function importedPieces(state, shapes) {
  const view = { joints: state.joints, shapes: shapes || [], constraints: state.constraints || [] };
  const order = new Map(view.shapes.map((s, i) => [s.id, i]));
  const root = new Map(view.shapes.map((s) => [s.id, s.id]));
  const find = (x) => { while (root.get(x) !== x) { root.set(x, root.get(root.get(x))); x = root.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra === rb) return; if (order.get(ra) < order.get(rb)) root.set(rb, ra); else root.set(ra, rb); };
  for (const chain of findConnectedChains(view)) for (const id of chain) union(chain[0], id);
  const byId = new Map(view.shapes.map((s) => [s.id, s]));
  const loops = findLoops(view).map((l) => {
    const poly = loopPolygon(l, view, byId);
    const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
    return { l, poly, box: poly.length >= 3 ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null };
  }).filter((x) => x.box);
  const inBox = (a, b) => a.box[0] >= b.box[0] && a.box[1] >= b.box[1] && a.box[2] <= b.box[2] && a.box[3] <= b.box[3];
  const around = new Map(loops.map((a) => [a, loops.filter((b) => b !== a && inBox(a, b) && polygonContains(b.poly, a.poly))]));
  for (const a of loops) {
    const depth = around.get(a).length;
    if (depth % 2 === 0) continue; // an outline
    const parent = around.get(a).find((b) => around.get(b).length === depth - 1); // the loop directly around this hole
    if (parent) union(a.l.edges[0], parent.l.edges[0]);
  }
  const pieces = new Map();
  for (const s of view.shapes) { const r = find(s.id); if (!pieces.has(r)) pieces.set(r, { shapeIds: [], outline: false }); pieces.get(r).shapeIds.push(s.id); }
  for (const { l } of loops) pieces.get(find(l.edges[0])).outline = true;
  return [...pieces.values()];
}

// TASK 751: group an IMPORTED drawing, in the app only (the user GROUP model above; no exporter reads it): each piece of two or
// more shapes (importedPieces) becomes a group named nameOf(piece) or "Outline N" / "Chain N"; then the whole file becomes ONE
// group named `fileName` holding them (and the single-shape pieces, as its own members). A file of one piece gets that one group
// only (no wrapper around a single child). Returns the groups made, the file's last.
export function groupImported(state, shapes, { fileName = 'Imported', nameOf = () => null } = {}) {
  const pieces = importedPieces(state, shapes);
  const made = [];
  let outlines = 0, chains = 0;
  for (const p of pieces) {
    const label = p.outline ? 'Outline ' + (++outlines) : 'Chain ' + (++chains);
    if (p.shapeIds.length > 1) made.push(makeGroup(state, p.shapeIds, nameOf(p) || label));
  }
  const all = (shapes || []).map((s) => s.id);
  if (pieces.length > 1) made.push(makeGroup(state, all, fileName));
  return made;
}
