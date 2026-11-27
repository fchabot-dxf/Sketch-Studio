// ═══════════════════════════════════════════════════════════════════════════════
// BEZIER PEN TOOL — the SHARED #ui bezier pen for ALL apps (UNIFY-3-tool, punch #12)
// ═══════════════════════════════════════════════════════════════════════════════
// A classic pen tool composed on the shared sketcher: CLICK places a CORNER anchor; CLICK-DRAG pulls SYMMETRIC
// tangent handles (a SMOOTH anchor). Each anchor after the first commits a cubic segment into the #core store via
// makeBezier (UNIFY-3) — prev.hOut -> this.hIn — as a CONNECTED chain: consecutive segments SHARE the endpoint
// joint (so the path stays joined + editable) and carry ONE groupId (so the whole stroke selects together). A live
// PREVIEW of the pending segment + the handle being dragged is published on state.active.preview (type 'bezier';
// svg-renderer has an additive branch). Enter / double-click / Escape end the path.
//
// ADDITIVE: this module adds a NEW tool mode's interaction; it touches NO existing shape/constraint/tool behaviour.
// The endpoints are JOINTS (participate in the solver / snapping later); the 2 control points are shape DATA, not
// solver-constrained — matching the #core bezier shape MVP (UNIFY-3).
// TASK 872: every ANCHOR snaps and attaches as the Line tool's points do (and as Fusion's spline): the app's locked snap (input-manager
// updateSnapTarget: joints, line mid-span and midpoints, arc / circle edges, circle centres, construction / offset-made lines, origin, axes)
// shows its marker on hover, the anchor lands on it and gets the constraint the Line tool makes there through the shared base-tool
// applyLockedSnap (an existing curve end point shared, TASK 1045; another point coincident; point-on-line ...). The tangent HANDLES are free: they are shape data, not points of the sketch (the Line tool
// has no counterpart; Fusion's spline tangent handles are dragged free too).
// TASK 762: CLOSING ON THE FIRST ANCHOR, as the Line tool ends on its first point. With two or more anchors placed, while the snap is the
// path's FIRST anchor, a press places the anchor THERE: on release the anchor IS the first one (TASK 1045: shared, applyLockedSnap), the segment
// is committed and the path ENDS, closed (a loop of #core/loop-finder.js findLoops).
// The closing anchor is what an anchor always is: a click makes a CORNER (the last segment arrives along its own handle), a drag makes it
// SMOOTH (symmetric handles: the incoming one on the last segment, the outgoing one becomes the FIRST segment's first control point, so
// the curve passes the closing point without a kink).

import { TOOL_MODES, SNAP, TIME } from '#core/constants.js';
import { makeBezier } from '#core/shapes.js';
import { newShapeId } from '#core/shape-id.js';
import { clearPreview } from '#ui/preview-manager.js';
import { matchesShortcut } from '#ui/shortcuts.js'; // TASK 727: the keys are declared there
import { applyLockedSnap, snapPoint } from '#ui/input-handlers/base-tool.js'; // TASK 872: the Line tool's snap point + constraint, shared

// Module-level pen session (mirrors the other create tools' module state). anchors: committed anchors of the
// current path, each { jointId, x, y, hOutX, hOutY, hInX, hInY } in WORLD coords.
const pen = {
  anchors: [],
  firstSegment: null,      // TASK 762: the path's first committed segment (a smooth closing anchor sets its first control point)
  groupId: null,
  finished: true,          // no path in progress
  down: null,              // the anchor currently being placed { x, y, hOut*, hIn* }
  dragging: false,
  dragStartScreen: null,
  lastDownTime: 0,
  lastAnchorScreen: null,  // screen px of the last placed anchor (for double-click-to-end)
};

// No persistent listeners: the shared input-manager dispatches pointer/keydown to the handlers below by tool mode.
export function setupBezierTool(/* svg, state */) {}

export function resetBezierState(state) {
  pen.anchors = []; pen.firstSegment = null; pen.groupId = null; pen.finished = true; pen.down = null;
  pen.dragging = false; pen.dragStartScreen = null; pen.lastDownTime = 0; pen.lastAnchorScreen = null;
  try { if (state) { state.active = null; clearPreview(state); } } catch (_) {}
}

// End the current path — KEEP every committed segment, just close out the in-progress session + clear the preview.
function endPath(state) {
  try { state.endUndoGroup && state.endUndoGroup(); } catch (_) {}
  pen.anchors = []; pen.firstSegment = null; pen.groupId = null; pen.finished = true; pen.down = null;
  pen.dragging = false; pen.dragStartScreen = null;
  try { state.active = null; clearPreview(state); } catch (_) {}
}

export function handleBezierPointerDown(e, svg, state, snap, w) {
  if (state.currentTool !== TOOL_MODES.BEZIER) return false;
  const now = Date.now();

  // SELF-HEAL: if an external tool-switch cleared state.active while we thought a path was live, treat it as ended
  // so this click starts a FRESH path (doesn't silently reconnect to the abandoned anchors).
  if (!pen.finished && (!state.active || state.active.mode !== TOOL_MODES.BEZIER)) {
    pen.anchors = []; pen.groupId = null; pen.finished = true;
  }

  // DOUBLE-CLICK to end: a 2nd click near the last anchor within the double-click window ends the path (the first
  // click of the pair already placed that anchor, so no duplicate is created).
  if (!pen.finished && pen.lastAnchorScreen && (now - pen.lastDownTime) < (TIME.DOUBLE_CLICK || 300)) {
    const d = Math.hypot(e.clientX - pen.lastAnchorScreen.x, e.clientY - pen.lastAnchorScreen.y);
    if (d <= (SNAP.JOINT_PX || 30)) { endPath(state); return true; }
  }

  // Fresh path: open an undo group + a new shared groupId for the whole stroke.
  if (pen.finished) {
    pen.anchors = []; pen.groupId = newShapeId('bezier_'); pen.finished = false;
    try { state.beginDrawStep && state.beginDrawStep(); } catch (_) {}
  }

  // Begin placing this anchor (corner by default; a drag upgrades it to smooth in pointermove). TASK 872: on a locked snap it is placed exactly
  // there and gets that snap's constraint on release; TASK 762: on the first anchor's joint it closes the path.
  const hit = anchorSnap(state, snap);
  const close = !!hit && pen.anchors.length >= 2 && hit.type === 'joint' && hit.targetId === pen.anchors[0].jointId;
  const at = hit ? snapPoint(hit) : w;
  pen.down = { x: at.x, y: at.y, hOutX: at.x, hOutY: at.y, hInX: at.x, hInY: at.y, snap: hit, close };
  pen.dragging = false;
  pen.dragStartScreen = { x: e.clientX, y: e.clientY };
  pen.lastDownTime = now;
  pen.lastAnchorScreen = { x: e.clientX, y: e.clientY };

  state.active = { mode: TOOL_MODES.BEZIER };   // marks a live session so the renderer draws the pending preview
  showSnap(state, hit);
  updateBezierPreview(state, { x: at.x, y: at.y });
  return true;
}

// TASK 872: the snap an anchor takes: the app's LOCKED snap (the Line tool's rule: within the snap magnet), except the path's last anchor
// itself (a second anchor on the same point makes no segment), else null.
function anchorSnap(state, snap) {
  if (!snap || !snap.isLocked || !snapPoint(snap)) return null;
  const last = pen.anchors.length ? pen.anchors[pen.anchors.length - 1] : null;
  return (last && snap.type === 'joint' && snap.targetId === last.jointId) ? null : snap;
}
// The renderer's snap marker shows the snap the next anchor will take (none while a handle is dragged: the handles do not snap).
function showSnap(state, snap) { state.snapTarget = snap || null; state.activeSnap = snap || null; }

export function handleBezierPointerMove(e, svg, state, w) {
  if (state.currentTool !== TOOL_MODES.BEZIER) return false;
  // TASK 872: while an anchor is being placed the marker stays on the snap decided at the press (the handle drag does not snap); between
  // anchors it is the snap updateSnapTarget found for the pointer.
  const hit = pen.down ? pen.down.snap : anchorSnap(state, state.snapTarget);
  showSnap(state, hit);

  if (pen.down) {
    const dsx = e.clientX - pen.dragStartScreen.x, dsy = e.clientY - pen.dragStartScreen.y;
    if (!pen.dragging && Math.hypot(dsx, dsy) > (SNAP.DRAG_THRESHOLD || 2)) pen.dragging = true;
    if (pen.dragging) {
      // Symmetric handles: the outgoing handle follows the cursor, the incoming is its mirror about the anchor.
      const dx = w.x - pen.down.x, dy = w.y - pen.down.y;
      pen.down.hOutX = pen.down.x + dx; pen.down.hOutY = pen.down.y + dy;
      pen.down.hInX  = pen.down.x - dx; pen.down.hInY  = pen.down.y - dy;
    }
  }
  updateBezierPreview(state, hit && !pen.down ? snapPoint(hit) : { x: w.x, y: w.y });
  return true;
}

export function handleBezierPointerUp(e, svg, state, w) {
  if (state.currentTool !== TOOL_MODES.BEZIER) return false;
  if (!pen.down) return true;

  // Finalize this anchor: create its endpoint joint, add it to the chain.
  const a = pen.down;
  const newId = state.genJ();
  state.joints.set(newId, { x: a.x, y: a.y, fixed: false });
  // TASK 1045: on an existing curve end point (the path's first anchor when it closes, a line's end ...) the anchor IS that point (shared)
  const jointId = a.snap ? applyLockedSnap(state, newId, a.snap) : newId;
  const anchor = { jointId, x: a.x, y: a.y, hOutX: a.hOutX, hOutY: a.hOutY, hInX: a.hInX, hInY: a.hInY };

  // Commit the cubic from the PREVIOUS anchor to this one (c1 = prev.hOut, c2 = this.hIn). A corner anchor has its
  // handle at the anchor point, so the cubic degenerates to the straight segment — exactly right.
  if (pen.anchors.length >= 1) {
    const prev = pen.anchors[pen.anchors.length - 1];
    const { shapes } = makeBezier(
      state.joints, prev.jointId, anchor.jointId,
      [prev.hOutX, prev.hOutY], [anchor.hInX, anchor.hInY]
    );
    const shp = shapes[0];
    shp.groupId = pen.groupId;
    if (state.isConstructionMode) shp.isConstruction = true;
    state.shapes.push(shp);
    if (!pen.firstSegment) pen.firstSegment = shp;
    if (a.close) {
      // TASK 762: the closing anchor: a smooth one (dragged) leaves along the first segment, a corner (clicked) keeps the first segment as drawn
      if (a.hOutX !== a.x || a.hOutY !== a.y) pen.firstSegment.c1 = [a.hOutX, a.hOutY];
      if (state.saveState) state.saveState();
      showSnap(state, null);
      endPath(state);
      return true;
    }
    try { state.saveState && state.saveState(); } catch (_) {}
  }

  pen.anchors.push(anchor);
  pen.down = null;
  pen.dragging = false;
  pen.lastDownTime = Date.now();
  pen.lastAnchorScreen = { x: e.clientX, y: e.clientY };
  updateBezierPreview(state, { x: w.x, y: w.y });
  return true;
}

export function handleBezierKeyDown(e, svg, state) {
  if (state.currentTool !== TOOL_MODES.BEZIER) return false;
  if (matchesShortcut(e, 'bezier.finish')) { endPath(state); return true; }
  return false; // Escape is handled by input-manager's global handleEscape (which calls resetBezierState)
}

// Publish state.active.preview for svg-renderer's additive 'bezier' branch: the pending segment (dashed cubic), the
// handle bar(s) for the anchor being dragged, and dots on every anchor.
function updateBezierPreview(state, cursor) {
  if (!state.active || state.active.mode !== TOOL_MODES.BEZIER) return;
  const last = pen.anchors.length ? pen.anchors[pen.anchors.length - 1] : null;
  const cur = pen.down;
  const preview = { type: 'bezier', pt: cursor, anchorDots: pen.anchors.map(a => ({ x: a.x, y: a.y })), handles: [], seg: null };

  if (cur) {
    // Placing/dragging an anchor: preview the segment that will commit on release (prev.hOut -> cur.hIn) + handles.
    if (pen.dragging) {
      preview.handles.push({ ax: cur.x, ay: cur.y, hx: cur.hOutX, hy: cur.hOutY });
      preview.handles.push({ ax: cur.x, ay: cur.y, hx: cur.hInX, hy: cur.hInY });
    }
    preview.anchorDots.push({ x: cur.x, y: cur.y });
    if (last) preview.seg = { p0: { x: last.x, y: last.y }, c1: { x: last.hOutX, y: last.hOutY }, c2: { x: cur.hInX, y: cur.hInY }, p3: { x: cur.x, y: cur.y } };
  } else if (last) {
    // Between anchors (pointer up): rubber-band the next segment from the last anchor's hOut toward the cursor.
    preview.seg = { p0: { x: last.x, y: last.y }, c1: { x: last.hOutX, y: last.hOutY }, c2: { x: cursor.x, y: cursor.y }, p3: { x: cursor.x, y: cursor.y } };
  }
  state.active.preview = preview;
}
