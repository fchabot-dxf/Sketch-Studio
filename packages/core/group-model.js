// packages/core/group-model.js — the user GROUP substrate (SKETCH-4c). A GROUP is an ad-hoc sub-container inside a
// sketch (Sketch > Group > Entity) for organisation only: a `userGroupId` membership tag on SHAPES + a `state.groups`
// list [{ id, name, sketchId, parentId? }]. PURE (no DOM).
//
// CRITICAL: `userGroupId` is DISTINCT from the shape factories' `groupId` (the RENDERER's closed-shape-fill key —
// LEFT UNTOUCHED). The user group never reads/writes the factory `groupId`. User groups carry NO toolpath/hole meaning
// (holes and combined faces belong exclusively to `#core/profile-model.js`). TASK 752: a group that is not entered is a rigid
// BLOCK for the solver (rigidBlocks below; the solver only translates it).
//
// TASK 751: NESTED groups. A group entry may name its `parentId` (a group inside a group); a shape's `userGroupId` is its
// INNERMOST group. A document of flat groups (no parentId) is a nest of depth one: it loads unchanged.
// The Select tool works on ONE level of the nest at a time: `state.enteredGroupId` (session UI: never saved, never an undo
// step) names the group the user has ENTERED (a double click); `selectUnit` answers, for a shape, the group a click on it
// selects at that level (the ONE place that answers it).

import { findLoops, findConnectedChains } from './loop-finder.js';
import { loopPolygon, polygonContains } from './loop-geometry.js';
import { TOOL_MODES, ORIGIN_JOINT_ID } from './constants.js';

// TASK 753: THE two LOCKS of a group, declared once (the box's padlocks, the canvas / hold menu and the browser row all read and toggle these).
// Each is ONE flat field on the group entry (absent = off: every group, imported or hand-made, starts unlocked; a document without locks
// saves exactly as before). Full lock implies Lock size & angle.
//   sizeAngle  "Lock size & angle": no rotate / scale (the box shows no handles, typed values are refused); the group still moves.
//   full       "Full lock": the group cannot move, rotate or scale (the solver holds it: rigidBlocks below).
export const GROUP_LOCKS = Object.freeze({
  sizeAngle: Object.freeze({ field: 'lockSizeAngle', label: 'Lock size & angle' }),
  full: Object.freeze({ field: 'fullLock', label: 'Full lock' }),
});
// THE hold a full-locked block carries (TASK 753): the origin, the one point every document holds fixed, as one more MEMBER of the block. The
// solver's own rule for a block (TASK 752, engine.js _pack: "a block holding a fixed point cannot move: every joint of it is a constant") then
// pins it: no solver change, and the DOF / colours show it as fixed through the same block. Never drawn, saved or exported (it lives only in
// rigidBlocks' answer).
export const FULL_LOCK_HOLD = Object.freeze({ id: 'full-lock-hold', type: 'hold', joints: Object.freeze([ORIGIN_JOINT_ID]) });

// The group's OWN lock state (what its padlocks show and toggle): { sizeAngle, full } (full implies sizeAngle).
export function groupLockState(state, gid) {
  const g = ((state && state.groups) || []).find((x) => x.id === gid);
  const full = !!(g && g[GROUP_LOCKS.full.field]);
  return { sizeAngle: full || !!(g && g[GROUP_LOCKS.sizeAngle.field]), full };
}

// Set lock `kind` ('sizeAngle' | 'full') of group `gid` on or off (the flat field; off removes it). -> false when there is no such group.
export function setGroupLock(state, gid, kind, on) {
  const g = ((state && state.groups) || []).find((x) => x.id === gid);
  const lock = GROUP_LOCKS[kind];
  if (!g || !lock) return false;
  if (on) g[lock.field] = true; else delete g[lock.field];
  return true;
}

// The group in `gid`'s nest (the group itself first, then the groups inside it) that holds lock `kind`, or null: a rotate / scale of a group is
// refused when it or a group inside it is locked (a locked child would turn with its parent). Full lock counts as Lock size & angle.
export function lockHolder(state, gid, kind) {
  const ix = indexOf(state);
  const byId = new Map(((state && state.groups) || []).map((g) => [g.id, g]));
  const has = (g) => !!g && (kind === 'full' ? !!g[GROUP_LOCKS.full.field] : !!(g[GROUP_LOCKS.full.field] || g[GROUP_LOCKS.sizeAngle.field]));
  const queue = [gid];
  while (queue.length) {
    const id = queue.shift();
    if (has(byId.get(id))) return id;
    queue.push(...(ix.kids.get(id) || []));
  }
  return null;
}

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

// TASK 752: THE rigid BLOCKS of the solver. Every group a Select-tool click selects at the entered level (selectUnit: the outermost
// group below the entered level) is ONE block the solver only TRANSLATES: its joints keep their positions relative to each other (no
// rotation, no scale). The direct members of the entered group, and ungrouped shapes, are in no block. Derived at every solve from the
// shapes' `userGroupId`, `groups` and `enteredGroupId` (nothing stored, nothing added to the constraints). `state` = { shapes, groups,
// enteredGroupId }. Returns [{ id: groupId, shapes: [shape, ...] }] in the order of each block's first shape; [] when there is no group.
// TASK 753: a block whose group, or a group inside it, has FULL LOCK on also holds FULL_LOCK_HOLD (the origin as a member): the solver pins it.
export function rigidBlocks(state) {
  if (!state || !Array.isArray(state.groups) || !state.groups.length) return [];
  const ix = indexOf(state), out = new Map();
  const fullIds = new Set(state.groups.filter((g) => g[GROUP_LOCKS.full.field]).map((g) => g.id));
  const held = new Set();
  for (const s of (state.shapes || [])) {
    const u = s && s.userGroupId ? ix.unitOf(s.id) : null;
    if (!u) continue;
    if (!out.has(u)) out.set(u, []);
    out.get(u).push(s);
    if (fullIds.size && !held.has(u)) { const chain = ix.chainOf(groupOf(s)); if (chain.slice(0, chain.indexOf(u) + 1).some((g) => fullIds.has(g))) held.add(u); }
  }
  return [...out].map(([id, shapes]) => ({ id, shapes: held.has(id) ? [...shapes, FULL_LOCK_HOLD] : shapes }));
}

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
  const { id, n } = groupIdMinter(state)();
  const sketchId = state.activeSketchId || 'sketch-1';
  for (const g of state.groups) if (nested.has(g.id)) g.parentId = id;
  for (const s of loose) s.userGroupId = id;
  const g = { id, name: name || ('Group ' + n), sketchId, ...(parentId ? { parentId } : {}) };
  state.groups.push(g);
  return g;
}

// The next free 'group-N' ids of a state (the smallest unused N first): mint() → { id, n }. makeGroup, groupImported and copyGroups take
// their ids from it, so a group is numbered the same whichever of them made it.
function groupIdMinter(state) {
  const used = new Set(((state && state.groups) || []).map((g) => g.id));
  let n = 1;
  return () => { while (used.has('group-' + n)) n++; const id = 'group-' + n; used.add(id); return { id, n }; };
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
// TASK 756: ONE pass. The imported shapes are new (in no group yet), so each piece's group is written directly (what makeGroup made of
// them: the same ids, names, order and nesting) instead of one makeGroup per piece, each re-reading every shape (2070 pieces: 0.4 s).
export function groupImported(state, shapes, { fileName = 'Imported', nameOf = () => null } = {}) {
  if (!Array.isArray(state.groups)) state.groups = [];
  const pieces = importedPieces(state, shapes);
  const byId = new Map((shapes || []).map((s) => [s.id, s]));
  const mint = groupIdMinter(state), sketchId = state.activeSketchId || 'sketch-1';
  const made = [], loose = [];
  let outlines = 0, chains = 0;
  for (const p of pieces) {
    const label = p.outline ? 'Outline ' + (++outlines) : 'Chain ' + (++chains);
    if (p.shapeIds.length < 2) { loose.push(...p.shapeIds); continue; }
    const g = { id: mint().id, name: nameOf(p) || label, sketchId };
    for (const id of p.shapeIds) byId.get(id).userGroupId = g.id;
    state.groups.push(g); made.push(g);
  }
  if (pieces.length > 1) {
    const file = { id: mint().id, name: fileName, sketchId };
    for (const g of made) g.parentId = file.id;
    for (const id of loose) byId.get(id).userGroupId = file.id;
    state.groups.push(file); made.push(file);
  }
  return made;
}

// TASK 756: drop the group entries left with no shape (in the group or in its child groups): their shapes were all deleted. Called by
// the ONE place geometry is removed (#core/delete-manager.js removeGeometry) and by a pattern removing an instance's copies
// (#core/pattern.js removeInstance). -> how many entries went.
export function dropEmptyGroups(state) {
  if (!state || !Array.isArray(state.groups) || !state.groups.length) return 0;
  const ix = indexOf(state);
  const gone = new Set(state.groups.filter((g) => !ix.shapesOf(g.id).length).map((g) => g.id));
  for (let i = state.groups.length - 1; i >= 0; i--) if (gone.has(state.groups[i].id)) state.groups.splice(i, 1);
  return gone.size;
}

// TASK 756: a COPY of a whole group is a group (paste, mirror, pattern: each calls this once its copies are in `state`).
// `source` = { shapes, groups } the originals come from (the state itself, or the clipboard's document); `copies` = Map original shape id
// -> its copy (a shape object in state.shapes). Every group of `source` whose shapes are ALL copied gets a copy entry (same name, a new id,
// the active sketch); its copied child groups stay nested in it, and the copies of its own members join it. The copy of the outermost
// copied group goes where `parentId` says when given (the clipboard: the group the user has entered, as the active sketch is for its
// shapes), else into the same group as the original (mirror, pattern). Copies of curves that are not a whole group stay in no group, as
// before. -> the group entries made.
export function copyGroups(state, source, copies, { parentId } = {}) {
  const sx = indexOf(source);
  const whole = ((source && source.groups) || []).filter((g) => { const ids = sx.shapesOf(g.id); return ids.length > 0 && ids.every((id) => copies.has(id)); });
  if (!whole.length) return [];
  if (!Array.isArray(state.groups)) state.groups = [];
  const mint = groupIdMinter(state), sketchId = state.activeSketchId || 'sketch-1';
  const newId = new Map(whole.map((g) => [g.id, mint().id]));
  const made = whole.map((g) => {
    const up = newId.has(g.parentId) ? newId.get(g.parentId) : (parentId !== undefined ? parentId : (g.parentId || null));
    return { id: newId.get(g.id), name: g.name, sketchId, ...(up ? { parentId: up } : {}) };
  });
  state.groups.push(...made);
  for (const s of (source.shapes || [])) { const g = groupOf(s); if (g && newId.has(g) && copies.has(s.id)) copies.get(s.id).userGroupId = newId.get(g); }
  return made;
}

// TASK 756: the groups the selection holds WHOLE (every shape of the group in `shapeIds`), with their nesting, for the clipboard: a pasted
// copy of a whole group is a group (copyGroups). A group only partly selected is not carried (its copied curves paste loose).
export function wholeGroupsOf(state, shapeIds) {
  const ix = indexOf(state), ids = new Set(shapeIds || []);
  return ((state && state.groups) || []).filter((g) => { const m = ix.shapesOf(g.id); return m.length > 0 && m.every((id) => ids.has(id)); }).map((g) => ({ ...g }));
}

// TASK 756: the shape a Select-tool press or hover on a shape / a point is on (the picked shape, or the first shape using the picked point),
// or null; its group at the entered level (selectUnit) is what the press selects. THE rule the click (selection-tools.js), the hover
// (hover-manager.js) and the right click (input-manager.js) share.
export function pickOwner(state, shapeId, jointId) {
  if (shapeId) return shapeId;
  const s = jointId ? ((state && state.shapes) || []).find((x) => (x.joints || []).includes(jointId)) : null;
  return s ? s.id : null;
}

// TASK 756: the group the Select tool's hover lights: the group a click on the hovered shape (state.hoverOwner, #ui/hover-manager.js)
// selects, at the CURRENT level (read when drawn, so entering or leaving a group re-aims it without a pointer move), or null. Only while the
// Select tool is on (a tool switch without a pointer move does not leave a group lit for a tool that picks single curves).
export function hoveredUnit(state) {
  return state && state.hoverOwner && state.currentTool === TOOL_MODES.SELECT ? selectUnit(state, state.hoverOwner) : null;
}

// TASK 756: the shapes inside the ENTERED group (a Set), or null when no group is entered. What the canvas draws undimmed (svg-renderer.js)
// and what a host's own static layer leaves undimmed (Pen Plotter's underlay) read this one answer.
export function enteredShapes(state) {
  const id = enteredGroup(state);
  return id ? new Set(indexOf(state).shapesOf(id)) : null;
}

// TASK 756: what the GROUP COMMANDS can do on the current selection: THE answer the shortcuts, the canvas menu and a group's browser row
// all read (#ui/group-actions.js runs them).
//   group    the selection holds two or more things at the entered level (a whole group counts as one, a curve as one)
//   ungroup  the groups Ungroup dissolves, one level each: the group a click on a selected curve selects (selectUnit), else the curve's own group
//   enter    the ONE group the selection is (selectedGroups, nothing else selected), else null
//   leave    a group is entered
//   text     TASK 845: the text shape when that ONE group is a TEXT's group (textOfGroup), else null. A text's group is never entered (a double
//            click edits the text: Enter group is not offered) nor ungrouped (Convert to shapes ends a text): it is left out of `ungroup`.
export function groupCommands(state) {
  const ix = indexOf(state);
  const sel = (state && state.selectedShapes instanceof Set) ? state.selectedShapes : new Set();
  const byId = new Map(((state && state.shapes) || []).map((s) => [s.id, s]));
  const units = new Set(), ungroupIds = new Set();
  for (const id of sel) {
    const u = ix.unitOf(id);
    units.add(u || 'shape:' + id);
    const g = u || groupOf(byId.get(id));
    if (g) ungroupIds.add(g);
  }
  const whole = selectedGroups(state);
  const enter = whole.length === 1 && units.size === 1 ? whole[0] : null;
  const text = enter ? textOfGroup(state, enter) : null;
  return { group: units.size >= 2, ungroup: [...ungroupIds].filter((g) => !textOfGroup(state, g)), enter, leave: !!enteredGroup(state), text: text ? text.id : null };
}

// TASK 845: the TEXT shape (#core/text.js: { type: 'text' }) that is a direct member of group `gid`, or null. A group holding one is that text's
// group: the text and its derived letters, one rigid block like every group.
export function textOfGroup(state, gid) {
  if (!gid) return null;
  return ((state && state.shapes) || []).find((s) => s && s.type === 'text' && s.userGroupId === gid) || null;
}
