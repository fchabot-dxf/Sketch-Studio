// packages/core/close-path.js — TASK 760: CLOSE PATH, the shared Design tab's command that joins the two free ends of an OPEN outline (every app).
// PURE (no DOM, no history: the tool layer takes the one undo step, #ui/close-path-actions.js). Built on #core/loop-finder.js: its chain rule
// (findConnectedChains: curves joined END TO END through shared or coincident end joints, a curve only with curves of its own kind) and its
// curve ends (curveEnds: a line's two joints, an arc's start / end, a bezier's first / last).
//
// THE CHAIN of a curve and its FREE ENDS: a free end is a point (a coincident cluster, buildNodeMap) where exactly ONE curve end of the chain
// lies. An OPEN chain has exactly two free ends and no BRANCH (a point where three or more curve ends lie). Close path closes an open chain:
//   gap <= CLOSE_PATH_COINCIDENT_MM   the two free ends are made COINCIDENT (no new curve): the end of the chain's LAST curve (in the walk from
//                                      the chain's first end) MOVES onto the first end, by the gap (<= the tolerance); when that end is held
//                                      (a fixed point in its cluster) the other one moves instead; both held: a line is added instead.
//   otherwise                          ONE straight line between the two free ends, coincident at both (each end of the line its own new joint
//                                      + a coincident, as the Line tool ends on an existing point), the chain's kind (construction or not), in
//                                      the chain's sketch and in the chain's INNERMOST common user group (#core/group-model.js: an imported
//                                      outline's group gains the line; a group that is not entered stays one rigid block, nothing else is added).
// Nothing but the coincident constraint(s) is added to state.constraints. A chain (not construction: findLoops skips it) must be a loop findLoops
// returns once closed (checked on the planned result BEFORE anything changes: a closing line on top of the chain itself is refused with the
// reason). TASK 761: every curve kind is an edge of findLoops (lines, arcs, beziers; their real tangents and areas, #core/curve-kinds), so a lone
// arc closed by its chord is a loop now, and a chain with a bezier is checked like any other.
// Refused, with the reason: a circle (always closed), a chain already closed, a chain that branches, a single straight line (nothing to enclose).
//
// TASK 760b, WHAT A COMMAND CLOSES (planCommandClose, the ONE rule every entry runs): a chain gets an added LINE (a gap above the near-closed
// tolerance) only when the user picked THAT chain: its own curves, or a whole group holding no other curve (its own innermost group); a chain the
// picks reach only through a group that holds other curves too (a whole imported file, an entered parent's child group) is closed only when it is
// NEAR-CLOSED (isNearClosed: the import offer's tolerance, the coincident case included); the others are left open and counted.
//
// THE IMPORT OFFER (nearClosedChains): the open chains of an import whose gap is at most NEAR_CLOSED_MM AND at most NEAR_CLOSED_REL of the
// chain's own size (its bounding box diagonal) are OFFERED for closing (never closed without the user); every other open chain of the import
// is counted as left open (an engraving line, a path drawn open on purpose).

import { buildNodeMap, curveEnds, findConnectedChains, findLoops } from './loop-finder.js';
import { addConstraint } from './constraints.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { newShapeId } from './shape-id.js';
import { groupChain, groupIndex } from './group-model.js';
import { inertEntities, activeSketchPick, sketchOf } from './sketch-model.js';

// The tolerances (base unit mm). COINCIDENT: at or below it the two free ends are made coincident, the move at most this. 0.01 mm is the finest
// length the app shows in mm (2 decimals), and above the rounding an importer leaves between the two ends of an outline drawn back to its start:
// an SVG written with 2 decimals of a px (Illustrator's default) is off by at most 0.005 px a coordinate = 0.0019 mm (96 px / in), 0.0026 mm
// across the two coordinates; 3 decimals of a mm by 0.0007 mm. A bigger gap gets a real (if tiny) line: the geometry never moves more than this.
export const CLOSE_PATH_COINCIDENT_MM = 0.01;
// NEAR-CLOSED (the import's offer): at most 0.5 mm, half the narrowest bit commonly cut with (1 mm): a cut bridges such a gap anyway, so it is no
// deliberate opening; AND at most 2 % of the chain's size, so a small outline (a 3 mm letter) with a 0.4 mm opening is not offered.
export const NEAR_CLOSED_MM = 0.5;
export const NEAR_CLOSED_REL = 0.02;
export const CLOSE_PATH_UNDO_LABEL = 'close path';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** THE pick rule of the command: a curve of the ACTIVE sketch (a locked / hidden one is out), not a reference curve, not a TEXT's letter (TASK 845:
 *  a single-line font's strokes are open on purpose and derived from the text: never closed, never marked as open ends). */
export function closePathPick(state) {
  const inert = inertEntities(state);
  return (s) => !!s && !s.reference && !s.textOutline && activeSketchPick(state, s, inert);
}

// The topology of one chain (ids): its free ends in walk order ([{ node, joint, shape }]), the most curve ends meeting at one point, the shapes.
function chainTopology(state, ids, node, byId) {
  const shapes = ids.map((id) => byId.get(id)).filter(Boolean);
  const at = new Map(); // node -> [{ joint, shape }]
  for (const s of shapes) for (const j of (curveEnds(s) || [])) {
    const n = node(j);
    if (!at.has(n)) at.set(n, []);
    at.get(n).push({ joint: j, shape: s });
  }
  let most = 0;
  for (const list of at.values()) most = Math.max(most, list.length);
  const free = [...at.entries()].filter(([, list]) => list.length === 1).map(([n, list]) => ({ node: n, joint: list[0].joint, shape: list[0].shape }));
  if (free.length === 2 && most <= 2) { // walk from the first free end: the second end is the end of the chain's LAST curve
    const [a, b] = free;
    const order = walkOrder(shapes, at, node, a);
    if (order && order[order.length - 1] !== b.shape.id) free.reverse();
  }
  return { shapes, free, most };
}

// the curve ids in walk order from free end `start` (an unbranched chain), or null
function walkOrder(shapes, at, node, start) {
  const out = [], seen = new Set();
  let from = start.node, cur = start.shape;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id); out.push(cur.id);
    const [e0, e1] = (curveEnds(cur) || []).map(node);
    const next = e0 === from ? e1 : e0;
    from = next;
    cur = ((at.get(next) || []).map((x) => x.shape)).find((s) => !seen.has(s.id)) || null;
  }
  return out.length === shapes.length ? out : null;
}

// What every plan of one pass reads, built ONCE: the cluster of each joint (buildNodeMap), the shapes by id, the coincidents by joint.
function passContext(state) {
  const node = buildNodeMap(state);
  const byId = new Map(state.shapes.map((s) => [s.id, s]));
  const members = new Map(); // node -> its joints
  for (const id of state.joints.keys()) { const n = node(id); if (!members.has(n)) members.set(n, []); members.get(n).push(id); }
  const coincidents = new Map(); // joint -> the coincident constraints naming it
  for (const c of (state.constraints || [])) {
    if (!c || c.type !== CONSTRAINT_TYPES.COINCIDENT || !Array.isArray(c.joints)) continue;
    for (const j of c.joints) { if (!coincidents.has(j)) coincidents.set(j, []); coincidents.get(j).push(c); }
  }
  return { node, byId, cluster: (jid) => members.get(node(jid)) || [jid], coincidents };
}

// The innermost user group that holds EVERY curve of the chain (the shortest common tail of their group chains, innermost first), or null.
function innermostCommonGroup(state, shapes) {
  const chains = shapes.map((s) => groupChain(state, s));
  if (!chains.length || chains.some((c) => !c.length)) return null;
  return chains[0].find((g) => chains.every((c) => c.includes(g))) || null;
}

// Does closing make the chain a loop of findLoops? Checked on a VIEW of the planned result (the chain's joints, the new line / the moved end, the
// coincidents), so nothing changes before it is known.
function closesToLoop(state, plan, ctx) {
  const { shapes, mode, ends } = plan;
  const joints = new Map();
  for (const s of shapes) for (const j of s.joints) { const p = state.joints.get(j); if (p) joints.set(j, { x: p.x, y: p.y }); }
  const constraints = [...new Set([...joints.keys()].flatMap((j) => ctx.coincidents.get(j) || []))];
  const viewShapes = [...shapes];
  const [stay, move] = ends;
  if (mode === 'coincident') {
    joints.set(move.joint, { ...state.joints.get(stay.joint) });
    constraints.push({ type: CONSTRAINT_TYPES.COINCIDENT, joints: [stay.joint, move.joint] });
  } else {
    joints.set('__cp_a', { ...state.joints.get(stay.joint) }); joints.set('__cp_b', { ...state.joints.get(move.joint) });
    viewShapes.push({ id: '__cp_line', type: 'line', joints: ['__cp_a', '__cp_b'] });
    constraints.push({ type: CONSTRAINT_TYPES.COINCIDENT, joints: ['__cp_a', stay.joint] }, { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['__cp_b', move.joint] });
  }
  const want = new Set(viewShapes.map((s) => s.id));
  return findLoops({ joints, shapes: viewShapes, constraints }).some((l) => l.edges.length === want.size && l.edges.every((e) => want.has(e)));
}

/** The plan for ONE chain (its curve ids, from findConnectedChains): { ok, reason?, ids, mode: 'coincident' | 'line', gap, ends: [stay, move] }. */
export function planClosePath(state, ids, ctx = passContext(state)) {
  const { node, byId } = ctx;
  const first = byId.get(ids[0]);
  if (!first) return { ok: false, ids, reason: 'nothing to close' };
  if (first.type === 'circle') return { ok: false, ids, reason: 'a circle is already closed' };
  if (!curveEnds(first)) return { ok: false, ids, reason: `a ${first.type} has no ends to join` };
  const { shapes, free, most } = chainTopology(state, ids, node, byId);
  if (most > 2) return { ok: false, ids, reason: `the path branches (${most} curves meet at one point): Close path needs one path with two free ends` };
  if (!free.length) return { ok: false, ids, reason: 'the path is already closed' };
  if (free.length !== 2) return { ok: false, ids, reason: `the path has ${free.length} free ends: Close path needs one path with two free ends` };
  if (shapes.length === 1 && first.type === 'line') return { ok: false, ids, reason: 'a single straight line cannot enclose an area' };
  const pa = state.joints.get(free[0].joint), pb = state.joints.get(free[1].joint);
  if (!pa || !pb) return { ok: false, ids, reason: 'an end point of the path is missing' };
  const gap = dist(pa, pb);
  const held = (end) => ctx.cluster(end.joint).some((j) => { const p = state.joints.get(j); return !!(p && p.fixed); });
  let ends = [free[0], free[1]]; // [stay, move]: the end of the last curve moves
  let mode = gap <= CLOSE_PATH_COINCIDENT_MM ? 'coincident' : 'line';
  if (mode === 'coincident' && held(ends[1])) {
    if (!held(ends[0])) ends = [ends[1], ends[0]];
    else mode = gap > 0 ? 'line' : 'coincident'; // both held where they are: a line (a zero gap needs no move at all)
  }
  const plan = { ok: true, ids, shapes, mode, gap, ends, moving: [...ctx.cluster(ends[1].joint)], isConstruction: !!first.isConstruction };
  if (!plan.isConstruction && !closesToLoop(state, plan, ctx)) {
    return { ok: false, ids, reason: 'the closing line would not enclose an area (it lies on the path itself)' };
  }
  return plan;
}

/**
 * planClosePaths(state, shapeIds, include) -> [plan]   the chains of the given curves (each chain once, in the order of the first curve of it in
 * shapeIds), each planned (planClosePath). include(shape) = the pick rule (default closePathPick: the active sketch). The chains are built ONCE.
 */
export function planClosePaths(state, shapeIds, include = closePathPick(state)) {
  const chains = findConnectedChains(state, include);
  const chainOf = new Map();
  for (const c of chains) for (const id of c) chainOf.set(id, c);
  const ctx = passContext(state);
  const seen = new Set(), plans = [];
  for (const id of shapeIds || []) {
    const c = chainOf.get(id);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    plans.push(planClosePath(state, c, ctx));
  }
  return plans;
}

/**
 * applyClosePath(state, plan) -> { ok, mode, lineId?, moved? }   does what the plan says (no history: the caller's ONE undo step).
 *   coincident: the moving end's cluster is moved onto the staying end (moved = the distance, <= CLOSE_PATH_COINCIDENT_MM), one coincident.
 *   line: two new joints at the two ends, the line between them (chain's kind, sketch, innermost common group), a coincident at each end.
 */
export function applyClosePath(state, plan) {
  if (!plan || !plan.ok) return { ok: false, reason: plan ? plan.reason : 'no plan' };
  const [stay, move] = plan.ends;
  const ps = state.joints.get(stay.joint), pm = state.joints.get(move.joint);
  if (plan.mode === 'coincident') {
    const dx = ps.x - pm.x, dy = ps.y - pm.y;
    for (const j of plan.moving) { const p = state.joints.get(j); p.x += dx; p.y += dy; } // the moving end's cluster (planned): its points stay together
    addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [stay.joint, move.joint] });
    return { ok: true, mode: 'coincident', moved: Math.hypot(dx, dy) };
  }
  const sketchId = sketchOf(plan.shapes[0]);
  const a = state.genJ(), b = state.genJ();
  state.joints.set(a, { x: ps.x, y: ps.y, fixed: false, sketchId });
  state.joints.set(b, { x: pm.x, y: pm.y, fixed: false, sketchId });
  const group = innermostCommonGroup(state, plan.shapes);
  const line = { id: newShapeId('s'), type: 'line', joints: [a, b], isConstruction: plan.isConstruction, sketchId, ...(group ? { userGroupId: group } : {}) };
  state.shapes.push(line);
  addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [a, stay.joint] });
  addConstraint(state, CONSTRAINT_TYPES.COINCIDENT, { joints: [b, move.joint] });
  return { ok: true, mode: 'line', lineId: line.id };
}

/** The free ends of every OPEN chain among the curves include() accepts (default: the active sketch): [{ x, y, joint }] (what the Close path tool
 *  marks on the canvas). A branching chain's free ends are free ends too. */
export function openChainEnds(state, include = closePathPick(state)) {
  if (!state || !state.joints || !Array.isArray(state.shapes)) return [];
  const node = buildNodeMap(state);
  const count = new Map(), first = new Map();
  for (const s of state.shapes) {
    if (!s || !include(s)) continue;
    for (const j of (curveEnds(s) || [])) {
      const k = (s.isConstruction ? 'c:' : 'n:') + node(j); // a chain is of one kind (findConnectedChains)
      count.set(k, (count.get(k) || 0) + 1);
      if (!first.has(k)) first.set(k, j);
    }
  }
  const out = [];
  for (const [k, n] of count) {
    if (n !== 1) continue;
    const j = first.get(k), p = state.joints.get(j);
    if (p) out.push({ x: p.x, y: p.y, joint: j });
  }
  return out;
}

/**
 * nearClosedChains(state, shapeIds) -> { offered: [{ ids, gap }], leftOpen, largestGap }   the import's offer. Among the chains of the curves
 * `shapeIds` (an import's shapes), the open ones that Close path can close (planClosePath ok) with a gap <= NEAR_CLOSED_MM and <= NEAR_CLOSED_REL
 * of the chain's size are offered; every other chain that is not closed (a bigger gap, a branch, a lone line) is counted in leftOpen.
 * largestGap = the largest offered gap (0 when none).
 */
export function nearClosedChains(state, shapeIds) {
  const set = new Set(shapeIds || []);
  const plans = planClosePaths(state, [...set], (s) => set.has(s.id));
  const offered = [];
  let leftOpen = 0, largestGap = 0;
  for (const p of plans) {
    if (isNearClosed(state, p)) {
      offered.push({ ids: p.ids, gap: p.gap });
      largestGap = Math.max(largestGap, p.gap);
    } else if (!(p.reason === 'the path is already closed' || p.reason === 'a circle is already closed')) leftOpen++;
  }
  return { offered, leftOpen, largestGap };
}

/** Is plan p a NEAR-CLOSED chain (closable, gap <= NEAR_CLOSED_MM and <= NEAR_CLOSED_REL of its size)? The import offer's rule and the group rule's. */
export function isNearClosed(state, p) {
  return !!(p && p.ok && p.gap <= NEAR_CLOSED_MM && p.gap <= NEAR_CLOSED_REL * chainSize(state, p.shapes));
}

const ALREADY_CLOSED = new Set(['the path is already closed', 'a circle is already closed']);

/**
 * planCommandClose(state, shapeIds, include) -> { plans: [plan to close], refused: [plan], leftOpen: [plan] }   THE command rule (header, 760b) on the
 * curves the user picked (a Close path click: [that curve]; the Select tool's selection otherwise). A pick that reaches a chain only through a whole
 * group holding other curves too (groupIndex unitOf at the entered level) closes it only when it is near-closed; the rest of such chains, and their
 * refusals other than "already closed", are leftOpen. A chain picked directly is planned as planClosePath plans it (closed or refused with its reason).
 */
export function planCommandClose(state, shapeIds, include = closePathPick(state)) {
  const sel = new Set(shapeIds || []);
  const ix = groupIndex(state);
  const unitOf = new Map(); // a picked curve -> the whole picked group it is reached through (null: picked itself)
  for (const id of sel) {
    let u = ix.unitOf(id);
    if (u && !ix.shapesOf(u).every((x) => sel.has(x))) u = null; // the group is not picked whole: the curve is
    unitOf.set(id, u);
  }
  const out = { plans: [], refused: [], leftOpen: [] };
  for (const p of planClosePaths(state, [...sel], include)) {
    const chain = new Set(p.ids);
    const direct = p.ids.some((id) => sel.has(id) && (!unitOf.get(id) || ix.shapesOf(unitOf.get(id)).every((x) => chain.has(x))));
    if (direct) (p.ok ? out.plans : out.refused).push(p);
    else if (isNearClosed(state, p)) out.plans.push(p);
    else if (!(p.reason && ALREADY_CLOSED.has(p.reason))) out.leftOpen.push(p);
  }
  return out;
}

// a chain's size: the diagonal of the box of its curves' points (an arc's centre is not on the curve: left out)
function chainSize(state, shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) for (const j of (s.type === 'arc' ? s.joints.slice(1) : s.joints)) {
    const p = state.joints.get(j);
    if (!p) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return Number.isFinite(x0) ? Math.hypot(x1 - x0, y1 - y0) : 0;
}

/**
 * closeOfferedChains(state, offered) -> { closed: [plan], results: [applyClosePath's result], skipped }   the offer's "Close them": each offered chain (its ids) is planned again
 * against the state as it is NOW and closed when it still is that open chain with a gap within NEAR_CLOSED_MM (an undo, an edit in between: it is
 * skipped). No history (the caller's ONE undo step).
 */
export function closeOfferedChains(state, offered) {
  const list = offered || [];
  const plans = planClosePaths(state, list.map((o) => o.ids[0])); // the chains are distinct: planned together, before any is closed
  const closed = [], results = [];
  for (const o of list) {
    const p = plans.find((x) => x.ids.includes(o.ids[0]));
    const same = p && p.ok && p.ids.length === o.ids.length && o.ids.every((id) => p.ids.includes(id)) && p.gap <= NEAR_CLOSED_MM;
    if (!same) continue;
    results.push(applyClosePath(state, p));
    closed.push(p);
  }
  return { closed, results, skipped: list.length - closed.length };
}
