// packages/core/offset.js - task 650: OFFSET, like Fusion's Sketch > Create > Offset (here in the Modify group, owner ruling). PURE (no DOM).
// The Offset tool (packages/ui/input-handlers/offset-tool.js) calls it; the solver (solver/engine.js + solver/definitions.js), the verifier and
// the dimension label read a stored offset constraint through offsetOperands / offsetRowValues here, the ONE reader of the record.
//
// FUSION (advisor-verified with the Fusion API, task 650): sketch.offset(chain, directionPoint, distance) on a chain of a 40 mm line, a 30 mm line
// and an R10 quarter arc, 5 mm inward, gave 3 new curves JOINED end to end (lines 35 and 25 mm, an R5 arc), ONE OffsetConstraint and ONE driving
// dimension (SketchOffsetCurvesDimension = 5) that sets the distance.
//
// THE CHAIN (offsetChainOf): the picked curve and every line / arc joined to it END TO END (shared or coincident end points, #core/loop-finder.js
// buildNodeMap), ordered from one end to the other (open) or round (closed); a circle is a chain of itself. A branch point (3+ curve ends at one
// point) is refused. Each piece is walked in the CHAIN direction (`rev`: the source shape runs the other way) and each join is a CORNER (the
// pieces meet at an angle) or TANGENT (they run on smoothly), read once from the source when the offset is made.
//
// THE GEOMETRY (offsetChainGeometry), a signed distance s = side * d along each piece's LEFT normal (in the chain direction):
//   line    moves along its normal by s (same direction)              arc / circle   keeps its centre, its radius changes by -s * dir
//   (dir = +1 when the arc runs counter-clockwise in the chain direction: its left normal points to the centre; a circle counts as dir = +1)
//   a CORNER join   the two offset curves are re-joined at their intersection nearest the source corner (line-line, line-arc, arc-arc)
//   a TANGENT join  both offset pieces end on the common normal through the source joint (Q = P + s n)
//   an OPEN END     the end piece stops on the normal through the source end point
//   collapse        a line that would reverse (or reach zero length) or an arc whose radius or sweep would reach zero is REFUSED with the reason.
//
// THE RESULT (applyOffset): new lines / arcs / a circle in the ACTIVE sketch (construction pieces stay construction), joined end to end by SHARED
// joints (a closed loop stays closed), each arc with its own centre point and makeArc's structural equal (its one shape constraint; a line has
// none), and ONE offset constraint that is also the driving DISTANCE dimension (a dimension kind, #core/parameters.js isDimension):
//   { type: 'offset', shapes: [src0, off0, src1, off1, ...], rev: [bool per piece], sides: [+1 / -1 per piece], joins: ['corner' | 'tangent'],
//     closed: bool, value: d, name, isDriven, driven, offset, labelSlide? }
// sides[k] is the sign the solver row reads: a line, the sign of the offset's signed distance from the source line (the point-on-line cross
// convention, (Q - A) x (B - A) / |B - A|, A, B = the source's joints[0], joints[1]); an arc / circle, the sign of R' - R. Offset pieces are made
// in the CHAIN order (a line [start, end], an arc [centre, start, end] with its sweep set to the chain direction), so piece k's start joint is
// the joint shared with piece k - 1.
// THE SOLVER ROWS (offsetOperands): exactly as many independent rows as the offset pieces have unknowns, so the offset chain is fully
// determined by its sources and d (no redundant row, no degenerate one at a tangent join):
//   every arc / circle centre       2 rows: centre' - centre (concentric)
//   a circle                        1 row:  R' - R - sides * d
//   every vertex Q (source point P) 2 rows, from the pieces meeting there:
//     N(piece, Q)  Q is at the offset distance from that piece's source: a line, its signed distance - sides * d; an arc, |Q - C| - R - sides * d
//     T(piece, Q)  Q is on the source normal through P: a line, (Q - P) . u / |u|; an arc, Q on the RAY from C through P (not the whole line
//                  through C): |Q - C| * angle(P - C, Q - C), the angle in (-pi, pi], so Q past the centre is no solution
//     open start: N(first) + T(first)   open end: N(last) + T(last)   corner: N(before) + N(after)   (N(before) / N(last): see below)
//     tangent: N(before) + T(after) when the piece after Q is an ARC, else N(before) + T(before)
//     where the piece before Q is an ARC, its N(before) row is the arc's structural equal (Q is its end joint, joints[2]), so it is not repeated;
//     where it is a LINE, its N(before) row at its END is the ray row R(before, Q): Q on the RAY from the piece's own START along its source
//     direction (in the chain direction): |Q - S| * angle(u, Q - S), S = the offset piece's start joint, u = the source's start -> end.
//   TASK 656: a line's N row at each end only puts that end on the offset LINE (a signed distance from the source line), so nothing said the offset
//   piece keeps its direction: a 60 x 40 rectangle offset 15 inside, its height edited 40 -> 20, was accepted with the inner rectangle inside out
//   (its offset top and bottom lines crossed: the "height" 20 - 30 = -10 drawn as +10, every row satisfied). The end row is now the ray row
//   above: with the start on the offset line (its own N row, or the arc / line rows of a tangent join) it holds the end on the same offset line
//   (the same unit gradient as the N row at a solution: same rank) AND ahead of the start, so an edit that needs a reversed offset line has no
//   solution and is refused like any edit the solver cannot satisfy (Fusion: the offset is the source -/+ d).
//   TASK 654 (fillet audit F24): an offset ARC's radius |Q - C| has no sign, so a row that only places Q (a line's N + T at a line -> arc tangent
//   join, a cross product that only puts Q on the LINE through C) is still satisfied when Q has passed the centre: the source radius edited below
//   d (an L's fillet R 8 -> 4 under a 5 mm inside offset) gave an offset arc of R |4 - 5| = 1 on the wrong side, accepted. Every offset arc now
//   has a row of its OWN that holds an end on its side of the centre (N = |Q - C| - R - sides * d, or T on the ray), so an edit that needs a
//   negative offset radius has no solution and is refused like any edit the solver cannot satisfy (Fusion: the offset radius is R -/+ d).
// Undo is the caller's (the tool wraps applyOffset in recordConstraintStep: ONE undo step). Refusals are data: { ok: false, reason }.
import { CONSTRAINT_TYPES } from './constants.js';
import { arcSweepInfo } from './geometry.js';
import { buildNodeMap, curveEnds, findConnectedChain } from './loop-finder.js';
import { makeArc } from './shapes.js';
import { newJointId, newShapeId } from './shape-id.js';
import { parse as parseUnit } from './units.js';
import { nextDimensionName } from './parameters.js';
import { SolverConfig } from './solver-config.js';
import { inActiveSketch } from './sketch-model.js';
// (No import of ./constraints.js: the solver reads this module, and constraints.js -> constraint-manager.js -> creation-placement.js imports the
// solver. The stored record is built by offsetConstraintRecord below, the one form constraints.js createConstraint also returns.)

export const OFFSET_UNDO_LABEL = 'offset';
/** A piece shorter than this (world mm), or a radius below it, counts as collapsed. */
export const OFFSET_COLLAPSE_TOL = 1e-3;
const TANGENT_TOL = 1e-6;   // two unit tangents whose cross product is below this run on smoothly (a tangent join)
const TAU = Math.PI * 2;
const mod2pi = (v) => ((v % TAU) + TAU) % TAU;
const wrapPi = (v) => { let x = mod2pi(v); if (x > Math.PI) x -= TAU; return x; };

/** Default offset distance in WORLD mm: 5 mm, or 1/4" = 6.35 mm for an inch document (the fillet's defaults). */
export function defaultOffsetDistance(docUnit = 'mm') { return docUnit === 'in' ? 6.35 : 5; }
// TASK 690 (owner turn 1822, Fusion measured by the advisor, turn 1823): an offset distance is SIGNED. A NEGATIVE distance puts the offset on the
// OTHER side of its source, at |distance| (Fusion: '-0.5 in' on a 1 cm line offset moves it to y = -1.27 cm; on a circle offset outward the
// radius shrinks). ONE rule, two readers: the Offset tool's box (offsetSideAndDistance: the side flips, the distance is |value|) and a stored
// offset DIMENSION, whose value is kept signed as typed (its label and the Parameters table show -5) and read by the solver rows as
// sides[k] * value (offsetRowValues: the same formula, the sign of the value flips the side). 0 is REFUSED (OFFSET_ZERO_REASON; Fusion accepts it
// and leaves the offset on its source: owner ruling 1825, we refuse). An offset arc / circle whose radius would reach zero or less (inward by
// |value| >= its source radius) is REFUSED (offsetValueRefusal; Fusion accepts it and the offset circle disappears: we refuse, the curve would
// lose its constraints). The FREE distance of an undimensioned offset (task 667, the solver's scalar unknown) stays > 0: undimensionOffset turns
// a negative value into |value| with every side flipped (the same geometry) when the dimension is deleted, so a drag can never flip it.
export const OFFSET_ZERO_REASON = 'an offset distance cannot be 0 (a negative distance puts the offset on the other side)';
/** A typed distance in the document unit (a suffix overrides) -> world mm, SIGNED (task 690), or null when it is not a number or it is 0. */
export function parseOffsetDistance(str, docUnit = 'mm') {
  const v = parseUnit(str, docUnit);
  return (v != null && Number.isFinite(v) && v !== 0) ? v : null;
}
/** THE negative rule of the Offset tool (task 690): a signed distance v on `side` -> { side, d }: a negative v is the other side at |v|. */
export function offsetSideAndDistance(side, v) {
  return { side: v < 0 ? -side : side, d: Math.abs(v) };
}
/** The radius an offset arc / circle row asks for: source radius R, the piece's stored side sign, the (signed) distance d. ONE formula: the rows and the refusal. */
export const offsetRadius = (R, sign, d) => R + sign * d;

const isLine = (s) => !!s && s.type === 'line' && Array.isArray(s.joints) && s.joints.length >= 2;
const isArc = (s) => !!s && s.type === 'arc' && Array.isArray(s.joints) && s.joints.length >= 3 && (!s.subType || s.subType === 'CENTER');
const isCircle = (s) => !!s && s.type === 'circle' && Array.isArray(s.joints) && s.joints.length >= 1;
/** The shape kinds Offset takes: a line, a centre arc, a circle. */
export const isOffsetShape = (s) => isLine(s) || isArc(s) || isCircle(s);
const findShape = (shapes, id) => (shapes || []).find((s) => s && s.id === id) || null;

// ---------------------------------------------------------------------------------------------------------- the chain
/**
 * The chain an Offset pick on `shapeId` takes: { ok: true, chain: { pieces: [{ id, rev }], closed, joins: ['corner' | 'tangent'] } } or
 * { ok: false, reason }. include(shape) is the caller's pick rule (a locked / hidden sketch is out). joins[k] is the join at the START of
 * piece k (k >= 1; and joins[0], between the last piece and the first, for a closed chain); joins.length = closed ? n : n - 1, joins[k - 1]
 * for an open chain is stored at index k - 1 (the join before piece k).
 */
export function offsetChainOf(state, shapeId, include = () => true) {
  const start = findShape(state && state.shapes, shapeId);
  if (!start) return { ok: false, reason: 'pick a line, an arc or a circle' };
  if (!isOffsetShape(start)) return { ok: false, reason: `a ${start.type} cannot be offset (lines, arcs and circles only)` };
  if (isCircle(start)) return { ok: true, chain: { pieces: [{ id: start.id, rev: false }], closed: true, joins: [] } };
  const ids = findConnectedChain(state, start.id, (s) => (isLine(s) || isArc(s)) && include(s));
  const shapes = ids.map((id) => findShape(state.shapes, id));
  const node = buildNodeMap(state);
  const ends = new Map(shapes.map((s) => [s.id, curveEnds(s).map(node)]));
  const at = new Map(); // node -> the shapes ending there
  for (const s of shapes) for (const n of ends.get(s.id)) { if (!at.has(n)) at.set(n, []); at.get(n).push(s); }
  for (const list of at.values()) if (list.length > 2) return { ok: false, reason: `the chain branches (${list.length} curves meet at one point); Offset needs a chain without branches` };
  if (shapes.some((s) => ends.get(s.id)[0] === ends.get(s.id)[1])) return { ok: false, reason: 'a curve of the chain starts and ends at the same point' };
  // open: start at an end of the chain (a point where only one curve ends); closed: start at the picked curve, in its own direction
  const tip = [...at.entries()].find(([, list]) => list.length === 1);
  let cur = tip ? tip[1][0] : start;
  let from = tip ? tip[0] : ends.get(start.id)[0];
  const pieces = [];
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const [e0, e1] = ends.get(cur.id);
    const rev = e0 !== from;
    pieces.push({ id: cur.id, rev });
    from = rev ? e0 : e1;
    cur = (at.get(from) || []).find((s) => !seen.has(s.id)) || null;
  }
  const closed = !tip;
  const chain = { pieces, closed, joins: [] };
  const n = pieces.length;
  const frames = pieces.map((p) => pieceFrame(state, p));
  for (let k = closed ? 0 : 1; k < n; k++) {
    const before = frames[(k - 1 + n) % n], after = frames[k];
    const t1 = before.tangentAt(1), t2 = after.tangentAt(0);
    const cross = t1.x * t2.y - t1.y * t2.x, dot = t1.x * t2.x + t1.y * t2.y;
    if (Math.abs(cross) < TANGENT_TOL && dot < 0) return { ok: false, reason: 'the chain turns back on itself at a point' };
    chain.joins[closed ? k : k - 1] = Math.abs(cross) < TANGENT_TOL ? 'tangent' : 'corner';
  }
  return { ok: true, chain };
}
// the join kind before piece k (k >= 1, or k = 0 of a closed chain)
const joinBefore = (chain, k) => chain.joins[chain.closed ? k : k - 1];

// The SOURCE piece in the chain direction, from the live joints:
//   line   { kind, A, B (chain start / end points), u (unit direction), len, startJ, endJ, src }
//   arc    { kind, C, R, a0 (chain start angle), span, dir (+1 = counter-clockwise in the chain direction), startJ, endJ, centreJ, src }
//   circle { kind, C, R, centreJ, src }   (dir = +1)
// plus pointAt(t) / tangentAt(t) / leftNormalAt(t), t in [0, 1] along the chain direction.
function pieceFrame(state, piece) {
  const s = findShape(state.shapes, piece.id), J = (id) => state.joints.get(id);
  if (isLine(s)) {
    const [j0, j1] = piece.rev ? [s.joints[1], s.joints[0]] : [s.joints[0], s.joints[1]];
    const A = J(j0), B = J(j1), len = Math.hypot(B.x - A.x, B.y - A.y) || 1e-12;
    const u = { x: (B.x - A.x) / len, y: (B.y - A.y) / len };
    return { kind: 'line', src: s, A: { x: A.x, y: A.y }, B: { x: B.x, y: B.y }, u, len, startJ: j0, endJ: j1,
      pointAt: (t) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }), tangentAt: () => u, leftNormalAt: () => ({ x: -u.y, y: u.x }) };
  }
  if (isCircle(s)) {
    const C = J(s.joints[0]), R = s.radius;
    const pointAt = (t) => ({ x: C.x + R * Math.cos(TAU * t), y: C.y + R * Math.sin(TAU * t) });
    return { kind: 'circle', src: s, C: { x: C.x, y: C.y }, R, dir: 1, centreJ: s.joints[0], pointAt,
      tangentAt: (t) => ({ x: -Math.sin(TAU * t), y: Math.cos(TAU * t) }), leftNormalAt: (t) => ({ x: -Math.cos(TAU * t), y: -Math.sin(TAU * t) }) };
  }
  const C = J(s.joints[0]), P1 = J(s.joints[1]), P2 = J(s.joints[2]);
  const info = arcSweepInfo(C, P1, P2, { sweep: s.sweep });
  const R = Math.hypot(P1.x - C.x, P1.y - C.y);
  const dir = piece.rev ? -info.dir : info.dir;
  const a0 = piece.rev ? info.a0 + info.dir * info.span : info.a0;
  const ang = (t) => a0 + dir * info.span * t;
  return { kind: 'arc', src: s, C: { x: C.x, y: C.y }, R, a0, span: info.span, dir, centreJ: s.joints[0],
    startJ: piece.rev ? s.joints[2] : s.joints[1], endJ: piece.rev ? s.joints[1] : s.joints[2],
    pointAt: (t) => ({ x: C.x + R * Math.cos(ang(t)), y: C.y + R * Math.sin(ang(t)) }),
    tangentAt: (t) => ({ x: -dir * Math.sin(ang(t)), y: dir * Math.cos(ang(t)) }),
    leftNormalAt: (t) => ({ x: -dir * Math.cos(ang(t)), y: -dir * Math.sin(ang(t)) }) };
}

// ---------------------------------------------------------------------------------------------------------- the geometry
// The offset curve of a source frame at signed distance s (left normal): a line { kind, p, u } or a circle { kind, c, r }.
function offsetCurve(f, s) {
  if (f.kind === 'line') { const n = f.leftNormalAt(0); return { kind: 'line', p: { x: f.A.x + s * n.x, y: f.A.y + s * n.y }, u: f.u }; }
  return { kind: 'circle', c: f.C, r: f.R - s * f.dir };
}
// The intersections of two offset curves (line / circle each).
function intersect(a, b) {
  const dot = (p, q) => p.x * q.x + p.y * q.y;
  if (a.kind === 'line' && b.kind === 'line') {
    const den = a.u.x * b.u.y - a.u.y * b.u.x;
    if (Math.abs(den) < 1e-12) return [];
    const w = { x: b.p.x - a.p.x, y: b.p.y - a.p.y }, t = (w.x * b.u.y - w.y * b.u.x) / den;
    return [{ x: a.p.x + t * a.u.x, y: a.p.y + t * a.u.y }];
  }
  if (a.kind === 'circle' && b.kind === 'line') return intersect(b, a);
  if (a.kind === 'line') {
    const w = { x: a.p.x - b.c.x, y: a.p.y - b.c.y }, h = dot(w, a.u), disc = h * h - (dot(w, w) - b.r * b.r);
    if (disc < 0) return [];
    return [-h - Math.sqrt(disc), -h + Math.sqrt(disc)].map((t) => ({ x: a.p.x + t * a.u.x, y: a.p.y + t * a.u.y }));
  }
  const dx = b.c.x - a.c.x, dy = b.c.y - a.c.y, dist = Math.hypot(dx, dy);
  if (!(dist > 1e-12)) return [];
  const m = (a.r * a.r - b.r * b.r + dist * dist) / (2 * dist), h2 = a.r * a.r - m * m;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2), mx = a.c.x + m * dx / dist, my = a.c.y + m * dy / dist;
  return [{ x: mx + h * dy / dist, y: my - h * dx / dist }, { x: mx - h * dy / dist, y: my + h * dx / dist }];
}

/**
 * The offset of `chain` at distance d (world mm, > 0) on `side` (+1 = the LEFT of the chain direction, -1 = the right; a circle: +1 = inward):
 * { ok: true, pieces: [...], vertices: [Q...] } or { ok: false, reason }. pieces[k]: a line { kind, a, b }, an arc { kind, c, r, a, b, dir }
 * (a, b in the chain direction), a circle { kind, c, r }. vertices: open n + 1 (the start of each piece, then the last end), closed n.
 */
export function offsetChainGeometry(state, chain, d, side) {
  if (!(d > 0)) return { ok: false, reason: 'enter a distance greater than zero' };
  const s = side * d, n = chain.pieces.length;
  const frames = chain.pieces.map((p) => pieceFrame(state, p));
  const curves = frames.map((f) => offsetCurve(f, s));
  const bad = curves.findIndex((c) => c.kind === 'circle' && !(c.r > OFFSET_COLLAPSE_TOL));
  if (bad !== -1) return { ok: false, reason: `the ${frames[bad].kind} of radius ${fmt(frames[bad].R)} would shrink to radius ${fmt(curves[bad].r)}` };
  if (frames[0].kind === 'circle') return { ok: true, pieces: [{ kind: 'circle', c: { ...frames[0].C }, r: curves[0].r }], vertices: [] };
  const along = (f, t) => { const p = f.pointAt(t), nn = f.leftNormalAt(t); return { x: p.x + s * nn.x, y: p.y + s * nn.y }; };
  const vertices = [];
  const nv = chain.closed ? n : n + 1;
  for (let k = 0; k < nv; k++) {
    if (!chain.closed && k === 0) { vertices.push(along(frames[0], 0)); continue; }
    if (!chain.closed && k === n) { vertices.push(along(frames[n - 1], 1)); continue; }
    const before = frames[(k - 1 + n) % n], P = before.pointAt(1);
    if (joinBefore(chain, k) === 'tangent') { vertices.push(along(before, 1)); continue; }
    const cand = intersect(curves[(k - 1 + n) % n], curves[k]);
    if (!cand.length) return { ok: false, reason: `the offset curves no longer meet at the corner (${fmt(P.x)}, ${fmt(P.y)})` };
    cand.sort((p, q) => Math.hypot(p.x - P.x, p.y - P.y) - Math.hypot(q.x - P.x, q.y - P.y));
    vertices.push(cand[0]);
  }
  const pieces = [];
  for (let k = 0; k < n; k++) {
    const f = frames[k], a = vertices[k], b = vertices[(k + 1) % nv];
    if (f.kind === 'line') {
      const l = (b.x - a.x) * f.u.x + (b.y - a.y) * f.u.y;
      if (!(l > OFFSET_COLLAPSE_TOL)) return { ok: false, reason: `a ${fmt(f.len)} line would ${l < -OFFSET_COLLAPSE_TOL ? 'turn back on itself' : 'collapse to zero length'}` };
      pieces.push({ kind: 'line', a, b });
    } else {
      const r = curves[k].r;
      const ds = wrapPi((Math.atan2(a.y - f.C.y, a.x - f.C.x) - f.a0) * f.dir);
      const de = wrapPi((Math.atan2(b.y - f.C.y, b.x - f.C.x) - (f.a0 + f.dir * f.span)) * f.dir);
      const span = f.span - ds + de;
      if (!(span * r > OFFSET_COLLAPSE_TOL) || span >= TAU) return { ok: false, reason: `an arc of radius ${fmt(f.R)} would collapse (its offset has no sweep left)` };
      pieces.push({ kind: 'arc', c: { ...f.C }, r, a, b, dir: f.dir });
    }
  }
  return { ok: true, pieces, vertices };
}
const fmt = (v) => String(Number(v.toFixed(3)));

/**
 * Which side of the chain the world point p lies on: +1 (left of the chain direction; inside a circle) or -1, judged on the piece nearest p
 * (its left normal at the nearest point). The preview follows the cursor with it.
 */
export function offsetSideAt(state, chain, p) {
  let best = null;
  for (const piece of chain.pieces) {
    const f = pieceFrame(state, piece);
    let t;
    if (f.kind === 'line') t = Math.max(0, Math.min(1, ((p.x - f.A.x) * f.u.x + (p.y - f.A.y) * f.u.y) / f.len));
    else {
      const a = Math.atan2(p.y - f.C.y, p.x - f.C.x);
      if (f.kind === 'circle') t = mod2pi(a) / TAU;
      else { const rel = mod2pi((a - f.a0) * f.dir); t = rel <= f.span ? rel / f.span : (rel - f.span < TAU - rel ? 1 : 0); }
    }
    const q = f.pointAt(t), dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dist < best.dist) best = { dist, q, nn: f.leftNormalAt(t) };
  }
  if (!best) return 1;
  return ((p.x - best.q.x) * best.nn.x + (p.y - best.q.y) * best.nn.y) < 0 ? -1 : 1;
}

/**
 * THE drag-handle anchor of an offset preview (task 650; a follow-up plugs the shared arrow handle in here): the midpoint of the FIRST offset
 * piece and the unit normal there pointing the way a growing distance moves it (away from its source), or null when this distance has no
 * offset. { point: {x, y}, normal: {x, y} }.
 */
export function offsetHandleAnchor(state, chain, side, d) {
  const g = offsetChainGeometry(state, chain, d, side);
  if (!g.ok) return null;
  const f = pieceFrame(state, chain.pieces[0]), p = g.pieces[0];
  if (p.kind === 'line') {
    const nn = f.leftNormalAt(0);
    return { point: { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 }, normal: { x: side * nn.x, y: side * nn.y } };
  }
  const ang = p.kind === 'circle' ? 0 : Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x) + p.dir * offsetArcSpan(p) / 2;
  const radial = { x: Math.cos(ang), y: Math.sin(ang) };
  const grow = Math.sign(p.r - f.R) || 1; // the radius grows with d (outward) or shrinks (inward)
  return { point: { x: p.c.x + p.r * radial.x, y: p.c.y + p.r * radial.y }, normal: { x: grow * radial.x, y: grow * radial.y } };
}
/** The sweep of an offset arc piece (offsetChainGeometry), radians in (0, 2 PI). */
export function offsetArcSpan(p) {
  return mod2pi((Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x) - Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x)) * p.dir) || TAU;
}

// ---------------------------------------------------------------------------------------------------------- apply
/**
 * Offset `chain` by the SIGNED distance d on `side` (task 710): the new shapes, their joints and constraints in `state` (the active sketch), ONE
 * offset constraint (the driving distance dimension) holding d AS TYPED. A negative d puts the curves on the other side (offsetSideAndDistance), and
 * the stored per-piece sides stay the ones of `side` (sides[k] * value = the geometry: exactly what editing the dimension to d gives later).
 * -> { ok: true, shapes: [ids], joints: [ids], constraint } or { ok: false, reason } (nothing changes).
 */
export function applyOffset(state, chain, d, side) {
  if (chain.pieces.some((p) => { const s = state.shapes.find((x) => x.id === p.id); return !s || !inActiveSketch(state, s); })) return { ok: false, reason: 'Offset works in the active sketch only' };
  const o = offsetSideAndDistance(side, d), flip = d < 0 ? -1 : 1;
  const g = offsetChainGeometry(state, chain, o.d, o.side);
  if (!g.ok) return g;
  const frames = chain.pieces.map((p) => pieceFrame(state, p));
  const out = { ok: true, shapes: [], joints: [], constraint: null };
  const joint = (p) => { const id = newJointId(); state.joints.set(id, { x: p.x, y: p.y, fixed: false }); out.joints.push(id); return id; }; // the joints.set wrap stamps the ACTIVE sketch
  const vj = g.vertices.map(joint);
  const sides = [];
  g.pieces.forEach((p, k) => {
    const f = frames[k], construction = !!f.src.isConstruction;
    let shape;
    if (p.kind === 'line') {
      shape = { id: newShapeId('s'), type: 'line', joints: [vj[k], vj[(k + 1) % vj.length]] };
      const A = state.joints.get(f.src.joints[0]), B = state.joints.get(f.src.joints[1]), m = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 };
      sides.push(flip * (((m.x - A.x) * (B.y - A.y) - (m.y - A.y) * (B.x - A.x)) < 0 ? -1 : 1));
    } else if (p.kind === 'circle') {
      shape = { id: newShapeId('s'), type: 'circle', joints: [joint(p.c)], radius: p.r };
      sides.push(flip * (p.r < f.R ? -1 : 1));
    } else {
      const made = makeArc(null, joint(p.c), vj[k], vj[(k + 1) % vj.length], 'CENTER', construction);
      shape = made.shapes[0];
      shape.sweep = p.dir > 0; // the chain direction (start -> end)
      state.shapes.push(shape); // the shapes.push wrap stamps the ACTIVE sketch
      state.constraints.push(...made.constraints); // makeArc's structural equal, in its stored form
      sides.push(flip * (p.r < f.R ? -1 : 1));
    }
    if (construction) shape.isConstruction = true;
    if (p.kind !== 'arc') state.shapes.push(shape);
    out.shapes.push(shape.id);
  });
  const shapes = [];
  chain.pieces.forEach((piece, k) => shapes.push(piece.id, out.shapes[k]));
  // the driving dimension's state (constraints.js withDimensionState's fields, in its order) and its automatic name (#core/parameters.js).
  // Its label sits a quarter of the first piece's length from the piece's middle (offsetDimensionEnds): beside the curves at any drawing size
  // (the dimensions' fixed default, 30 mm, puts it past the end of a short piece).
  const f0 = frames[0], size = f0.kind === 'line' ? f0.len : f0.kind === 'arc' ? f0.R * f0.span : f0.R;
  out.constraint = { ...offsetConstraintRecord({ shapes, rev: chain.pieces.map((p) => !!p.rev), sides, joins: chain.joins, closed: chain.closed, value: d, offset: size / 4 }),
    isDriven: false, driven: false, name: nextDimensionName(state.constraints) };
  state.constraints.push(out.constraint);
  return out;
}

/**
 * THE stored form of an offset constraint, without the dimension state (constraints.js createConstraint adds that: load, undo, paste): the
 * fields in one order (byte-stable saves), or null when `params` is no offset (shapes must be source / offset pairs).
 */
export function offsetConstraintRecord(params) {
  if (!params || !Array.isArray(params.shapes) || params.shapes.length < 2 || params.shapes.length % 2) return null;
  const n = params.shapes.length / 2;
  const rec = {
    type: CONSTRAINT_TYPES.OFFSET,
    shapes: params.shapes.slice(),
    rev: Array.from({ length: n }, (_, k) => !!(params.rev && params.rev[k])),
    sides: Array.from({ length: n }, (_, k) => ((params.sides && params.sides[k]) < 0 ? -1 : 1)),
    joins: Array.isArray(params.joins) ? params.joins.map((j) => (j === 'tangent' ? 'tangent' : 'corner')) : [],
    closed: !!params.closed,
    value: params.value,
    offset: Number.isFinite(params.offset) ? params.offset : (SolverConfig.DIMENSION_OFFSET || 30),
  };
  if (params.dimensioned === false) rec.dimensioned = false;
  return rec;
}

/** Find an undimensioned OFFSET constraint matching a source/copy shape pair `(shapeA, shapeB)` in either order. */
export function findUndimensionedOffsetPair(constraints, shapeA, shapeB) {
  if (!Array.isArray(constraints) || shapeA == null || shapeB == null) return null;
  for (const c of constraints) {
    if (!c || c.type !== CONSTRAINT_TYPES.OFFSET || c.dimensioned !== false || !Array.isArray(c.shapes)) continue;
    for (let k = 0; k + 1 < c.shapes.length; k += 2) {
      const a = c.shapes[k], b = c.shapes[k + 1];
      if ((a === shapeA && b === shapeB) || (a === shapeB && b === shapeA)) return c;
    }
  }
  return null;
}

/**
 * THE switch of a dimensioned OFFSET constraint `c` to the free distance (task 667: its dimension deleted, the relation kept). The free distance is
 * the solver's scalar unknown held > 0 (solver/definitions.js offset.validScalar: a drag never flips it through zero), so a NEGATIVE value (task
 * 690) becomes |value| with every side flipped: sides[k] * value is unchanged, the geometry does not move.
 */
export function undimensionOffset(c) {
  if (!c || c.type !== CONSTRAINT_TYPES.OFFSET) return false;
  if (Number(c.value) < 0) {
    c.value = -c.value;
    c.sides = (c.sides || []).map((s) => (s < 0 ? 1 : -1)); // a new array: an undo snapshot may hold the old one
  }
  c.dimensioned = false;
  delete c.name;
  delete c.expression;
  delete c.isDriven;
  delete c.driven;
  delete c.drivenReason;
  return true;
}

/**
 * TASK 690: why the stored offset `c` cannot take the (signed) distance v, or null. 0 (OFFSET_ZERO_REASON), or an offset arc / circle whose radius
 * (offsetRadius, the rows' formula) would reach zero or less at the source radii in `joints` / `shapes`. The dimension seam asks it (0 before
 * anything moves; the radius to name the cause when the solve refused the edit). length(v) writes a length (world mm) in the message.
 */
export function offsetValueRefusal(c, v, joints, shapes, length = fmt) {
  if (!(Number(v) !== 0)) return OFFSET_ZERO_REASON;
  const ps = storedPieces(c, shapes);
  if (!ps) return null;
  for (const p of ps) {
    if (p.src.type === 'line') continue;
    let R = p.src.radius;
    if (p.src.type === 'arc') {
      const C = joints.get(p.src.joints[0]), A = joints.get(p.src.joints[1]);
      if (!C || !A) continue;
      R = Math.hypot(A.x - C.x, A.y - C.y);
    }
    if (!Number.isFinite(R)) continue;
    if (!(offsetRadius(R, p.side, Number(v)) > OFFSET_COLLAPSE_TOL)) {
      return `an offset of ${length(Number(v))} takes the ${p.src.type} of radius ${length(R)} inward by ${length(Math.abs(Number(v)))}: it must stay under ${length(R)}`;
    }
  }
  return null;
}

/** Re-enable the driving dimension on an undimensioned OFFSET constraint `c` (keeps its current solved distance `c.value`). */
export function restoreOffsetDimension(state, c) {
  if (!c || c.type !== CONSTRAINT_TYPES.OFFSET) return false;
  delete c.dimensioned;
  c.isDriven = false;
  c.driven = false;
  delete c.drivenReason;
  if (!c.name && state && Array.isArray(state.constraints)) c.name = nextDimensionName(state.constraints);
  return true;
}

// ---------------------------------------------------------------------------------------------------------- the stored constraint
// The pieces of a stored offset constraint: [{ src, off, rev, side }] with the shapes resolved, or null when it cannot be resolved (a missing
// shape, a kind that does not match its source).
function storedPieces(c, shapes) {
  if (!c || !Array.isArray(c.shapes) || c.shapes.length < 2 || c.shapes.length % 2) return null;
  const out = [];
  for (let k = 0; k < c.shapes.length / 2; k++) {
    const src = findShape(shapes, c.shapes[2 * k]), off = findShape(shapes, c.shapes[2 * k + 1]);
    if (!isOffsetShape(src) || !off || off.type !== src.type || !isOffsetShape(off)) return null;
    out.push({ src, off, rev: !!(c.rev && c.rev[k]), side: (c.sides && c.sides[k]) < 0 ? -1 : 1 });
  }
  return out;
}

/**
 * THE rows of a stored offset constraint (the module header): [{ k, ... }] with joint ids and, for a radius, the SHAPE whose radius it reads,
 * or null when it cannot be resolved. Row kinds (each 1 row, 'cen' 2):
 *   { k: 'cen', a, b }                    a - b  (x and y)
 *   { k: 'rad', off, src, sign }          R(off) - R(src) - sign * d          (a circle)
 *   { k: 'nl', q, a, b, sign }            (q - a) x (b - a) / |b - a| - sign * d
 *   { k: 'tl', q, p, a, b }               (q - p) . (b - a) / |b - a|
 *   { k: 'na', q, c, src, sign }          |q - c| - R(src) - sign * d
 *   { k: 'ta', q, p, c }                  |q - c| * atan2((p - c) x (q - c), (p - c) . (q - c))   (q on the ray c -> p)
 *   { k: 'rl', q, p, a, b }               |q - p| * atan2((b - a) x (q - p), (b - a) . (q - p))   (q on the ray from p along a -> b, task 656)
 */
export function offsetOperands(c, shapes) {
  const ps = storedPieces(c, shapes);
  if (!ps) return null;
  const rows = [];
  const n = ps.length, closed = !!c.closed || (n === 1 && ps[0].src.type === 'circle');
  for (const p of ps) {
    if (p.src.type === 'circle') { rows.push({ k: 'cen', a: p.off.joints[0], b: p.src.joints[0] }, { k: 'rad', off: p.off.id, src: p.src.id, sign: p.side }); }
    else if (p.src.type === 'arc') rows.push({ k: 'cen', a: p.off.joints[0], b: p.src.joints[0] });
  }
  if (ps[0].src.type === 'circle') return rows;
  // the source point at the start (t = 0) / end (t = 1) of piece p in the chain direction
  const srcPoint = (p, t) => { const e = p.src.type === 'arc' ? [p.src.joints[1], p.src.joints[2]] : [p.src.joints[0], p.src.joints[1]]; return (t === 0) !== p.rev ? e[0] : e[1]; };
  const offStart = (p) => (p.off.type === 'arc' ? p.off.joints[1] : p.off.joints[0]);
  const offEnd = (p) => (p.off.type === 'arc' ? p.off.joints[2] : p.off.joints[1]);
  const N = (p, q) => (p.src.type === 'line' ? { k: 'nl', q, a: p.src.joints[0], b: p.src.joints[1], sign: p.side } : { k: 'na', q, c: p.src.joints[0], src: p.src.id, sign: p.side });
  const T = (p, q, P) => (p.src.type === 'line' ? { k: 'tl', q, p: P, a: p.src.joints[0], b: p.src.joints[1] } : { k: 'ta', q, p: P, c: p.src.joints[0] });
  // the row N(before, Q) where Q is the END of piece `before`: an arc's is its structural equal (not repeated here); a line's is the RAY row from
  // its offset start along its source direction (task 656: the offset line keeps its direction, a reversed one is no solution)
  const Nend = (p, q) => (p.off.type === 'arc' ? [] : [{ k: 'rl', q, p: offStart(p), a: srcPoint(p, 0), b: srcPoint(p, 1) }]);
  const nv = closed ? n : n + 1;
  for (let k = 0; k < nv; k++) {
    if (!closed && k === 0) { const p = ps[0], q = offStart(p); rows.push(N(p, q), T(p, q, srcPoint(p, 0))); continue; }
    if (!closed && k === n) { const p = ps[n - 1], q = offEnd(p); rows.push(...Nend(p, q), T(p, q, srcPoint(p, 1))); continue; }
    const before = ps[(k - 1 + n) % n], after = ps[k], q = offStart(after);
    const tangent = (c.joins && c.joins[closed ? k : k - 1]) === 'tangent';
    // a tangent join: Q on the source normal through the joint, read from the ARC after it when there is one (its own side of its centre)
    const t = tangent && (after.src.type === 'arc' ? T(after, q, srcPoint(after, 0)) : T(before, q, srcPoint(before, 1)));
    rows.push(...Nend(before, q), tangent ? t : N(after, q));
  }
  return rows;
}

/** How many solver rows a stored offset constraint has (0 when it cannot be resolved). */
export function offsetRowCount(c, shapes) {
  const rows = offsetOperands(c, shapes);
  return rows ? rows.reduce((m, r) => m + (r.k === 'cen' ? 2 : 1), 0) : 0;
}

/**
 * THE values of offset rows (one formula for the solver rows and the verifier): pt(ref) -> { x, y } of a joint reference, radius(ref) -> the
 * radius of a shape reference (the solver passes dense indices / radius operands, the verifier joint ids / shape ids). d = the distance.
 */
export function offsetRowValues(rows, d, pt, radius) {
  const out = [];
  for (const r of rows) {
    if (r.k === 'cen') { const a = pt(r.a), b = pt(r.b); out.push(a.x - b.x, a.y - b.y); continue; }
    if (r.k === 'rad') { out.push(radius(r.off) - offsetRadius(radius(r.src), r.sign, d)); continue; }
    const q = pt(r.q);
    if (r.k === 'rl') {
      const p = pt(r.p), a = pt(r.a), b = pt(r.b), ux = b.x - a.x, uy = b.y - a.y, wx = q.x - p.x, wy = q.y - p.y;
      out.push(Math.hypot(wx, wy) * Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy));
      continue;
    }
    if (r.k === 'nl' || r.k === 'tl') {
      const a = pt(r.a), b = pt(r.b), ux = b.x - a.x, uy = b.y - a.y, lu = Math.hypot(ux, uy) || 1e-12;
      if (r.k === 'nl') out.push(((q.x - a.x) * uy - (q.y - a.y) * ux) / lu - r.sign * d);
      else { const p = pt(r.p); out.push(((q.x - p.x) * ux + (q.y - p.y) * uy) / lu); }
      continue;
    }
    const c = pt(r.c);
    if (r.k === 'na') out.push(Math.hypot(q.x - c.x, q.y - c.y) - offsetRadius(radius(r.src), r.sign, d));
    else {
      const p = pt(r.p), ax = p.x - c.x, ay = p.y - c.y, bx = q.x - c.x, by = q.y - c.y;
      out.push(Math.hypot(bx, by) * Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    }
  }
  return out;
}

/** The verifier's residual (world mm): the largest |row| of a stored offset constraint (0 when it cannot be resolved). */
export function offsetResidual(c, joints, shapes, radiusOf) {
  const rows = offsetOperands(c, shapes);
  if (!rows) return 0;
  const pt = (id) => joints.get(id) || { x: NaN, y: NaN };
  const radius = (id) => radiusOf(findShape(shapes, id));
  return offsetRowValues(rows, Number(c.value) || 0, pt, radius).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

/** The offset constraint's dimension ends (#core/dim-label.js): a point on the first SOURCE piece and the matching point on its offset. */
export function offsetDimensionEnds(c, joints, shapes) {
  const ps = storedPieces(c, shapes);
  if (!ps) return { j1: null, j2: null };
  const { src, off } = ps[0], J = (id) => joints.get(id);
  if (src.type === 'line') {
    const a = J(src.joints[0]), b = J(src.joints[1]), oa = J(off.joints[0]), ob = J(off.joints[1]);
    if (!a || !b || !oa || !ob) return { j1: null, j2: null };
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ux = ob.x - oa.x, uy = ob.y - oa.y, l2 = ux * ux + uy * uy || 1e-24;
    const t = ((m.x - oa.x) * ux + (m.y - oa.y) * uy) / l2;
    return { j1: m, j2: { x: oa.x + t * ux, y: oa.y + t * uy } };
  }
  const C = J(src.joints[0]);
  if (!C) return { j1: null, j2: null };
  let ang = 0, R = src.radius, Ro = off.radius;
  if (src.type === 'arc') {
    const P1 = J(src.joints[1]), P2 = J(src.joints[2]);
    if (!P1 || !P2) return { j1: null, j2: null };
    const info = arcSweepInfo(C, P1, P2, { sweep: src.sweep });
    ang = info.a0 + info.dir * info.span / 2;
    R = Math.hypot(P1.x - C.x, P1.y - C.y);
    const Co = J(off.joints[0]), O1 = J(off.joints[1]);
    Ro = Co && O1 ? Math.hypot(O1.x - Co.x, O1.y - Co.y) : R;
  }
  return { j1: { x: C.x + R * Math.cos(ang), y: C.y + R * Math.sin(ang) }, j2: { x: C.x + Ro * Math.cos(ang), y: C.y + Ro * Math.sin(ang) } };
}
