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
// solver-constrained — matching the #core bezier shape MVP (UNIFY-3). Not wired to snapping yet (anchors land at the
// raw world point); a follow-up can route the first anchor through findSnap like the other create tools.

import { TOOL_MODES, SNAP, TIME } from '#core/constants.js';
import { makeBezier } from '#core/shapes.js';
import { clearPreview } from '#ui/preview-manager.js';

// Module-level pen session (mirrors the other create tools' module state). anchors: committed anchors of the
// current path, each { jointId, x, y, hOutX, hOutY, hInX, hInY } in WORLD coords.
const pen = {
  anchors: [],
  groupId: null,
  finished: true,          // no path in progress
  down: null,              // the anchor currently being placed { x, y, hOut*, hIn* }
  dragging: false,
  dragStartScreen: null,
  lastDownTime: 0,
  lastAnchorScreen: null,  // screen px of the last placed anchor (for double-click-to-end)
};
let bezierSeq = 0;          // monotonic id/group suffix (Date.now() alone can collide within a ms)

// No persistent listeners: the shared input-manager dispatches pointer/keydown to the handlers below by tool mode.
export function setupBezierTool(/* svg, state */) {}

export function resetBezierState(state) {
  pen.anchors = []; pen.groupId = null; pen.finished = true; pen.down = null;
  pen.dragging = false; pen.dragStartScreen = null; pen.lastDownTime = 0; pen.lastAnchorScreen = null;
  try { if (state) { state.active = null; clearPreview(state); } } catch (_) {}
}

// End the current path — KEEP every committed segment, just close out the in-progress session + clear the preview.
function endPath(state) {
  try { state.endUndoGroup && state.endUndoGroup(); } catch (_) {}
  pen.anchors = []; pen.groupId = null; pen.finished = true; pen.down = null;
  pen.dragging = false; pen.dragStartScreen = null;
  try { state.active = null; clearPreview(state); } catch (_) {}
}

export function handleBezierPointerDown(e, svg, state, w) {
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
    pen.anchors = []; pen.groupId = 'bezier_' + (++bezierSeq) + '_' + now; pen.finished = false;
    try { state.beginUndoGroup && state.beginUndoGroup(); } catch (_) {}
  }

  // Begin placing this anchor (corner by default; a drag upgrades it to smooth in pointermove).
  pen.down = { x: w.x, y: w.y, hOutX: w.x, hOutY: w.y, hInX: w.x, hInY: w.y };
  pen.dragging = false;
  pen.dragStartScreen = { x: e.clientX, y: e.clientY };
  pen.lastDownTime = now;
  pen.lastAnchorScreen = { x: e.clientX, y: e.clientY };

  state.active = { mode: TOOL_MODES.BEZIER };   // marks a live session so the renderer draws the pending preview
  updateBezierPreview(state, { x: w.x, y: w.y });
  return true;
}

export function handleBezierPointerMove(e, svg, state, w) {
  if (state.currentTool !== TOOL_MODES.BEZIER) return false;
  // The pen doesn't use snapping — suppress any stray snap glyph updateSnapTarget may have set (state.active is set,
  // so it computes a snapTarget we don't want rendered).
  state.snapTarget = null; state.activeSnap = null;

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
  updateBezierPreview(state, { x: w.x, y: w.y });
  return true;
}

export function handleBezierPointerUp(e, svg, state, w) {
  if (state.currentTool !== TOOL_MODES.BEZIER) return false;
  if (!pen.down) return true;

  // Finalize this anchor: create its endpoint joint, add it to the chain.
  const a = pen.down;
  const jointId = state.genJ();
  state.joints.set(jointId, { x: a.x, y: a.y, fixed: false });
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
    shp.id = 's_bezier_' + (++bezierSeq) + '_' + Date.now();  // guaranteed-unique (Date.now() alone can collide)
    shp.groupId = pen.groupId;
    if (state.isConstructionMode) shp.isConstruction = true;
    state.shapes.push(shp);
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
  if (e.key === 'Enter') { endPath(state); return true; }
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
