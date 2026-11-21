// packages/core/pattern.js - task 658: CIRCULAR and RECTANGULAR PATTERN, like Fusion's Sketch > Create > Circular / Rectangular Pattern (here in
// the Modify group, owner ruling, after Mirror). PURE (no DOM). The pattern tool (packages/ui/input-handlers/pattern-tool.js) calls it; the solver
// (solver/engine.js + solver/definitions.js), the verifier and the delete / paste paths read a stored pattern through the functions here, the ONE
// reader of the record.
//
// FUSION (advisor-verified with the Fusion API, task 658): createCircularPatternInput(entities, centrePoint) -> quantity, totalAngle (default 360),
// isSymmetric, suppression -> ONE CircularPatternConstraint; quantity and total angle are PARAMETERS (no sketch dimension). Quantity 6 -> 8 makes
// 8 instances; the copies FOLLOW the source (source diameter edited -> every copy follows); total 90 with quantity 4 -> 0, 30, 60, 90 degrees.
// createRectangularPatternInput(entities, Spacing | Extent) -> direction one / two (default the sketch X / Y), quantity one / two, distance one /
// two, symmetric per direction, suppression -> ONE RectangularPatternConstraint.
//
// THE OBJECTS (patternSources): the picked lines / arcs / circles and points. Every point of the objects (shape by shape, then the picked points)
// gets ONE copy point per instance; points JOINED in the objects (a shared joint or a coincident cluster: line chains, rectangles) are ONE point
// (its first one leads), so a copied chain stays joined and a copied rectangle stays closed. Stored as
//   sources: { shapes: [ids], points: [the leading joint ids], shapeJoints: [[the point index of each joint of each shape]] }.
// THE INSTANCES (patternSlots): the source is instance 0; the others are numbered `at`:
//   circular   at = [i], i = 1 .. N-1; the user angle i * step, counter-clockwise when positive, clockwise when negative (world y runs down: the
//              world rotation is -angle). step = total / N when |total| == 360, else total / (N - 1).
//   rectangular at = [i, j], i over direction 1, j over direction 2, [0, 0] = the source. The offset is i s1 u1 + j s2 u2, u = the direction's
//              unit vector (a picked line's start -> end, live; default the X axis / the user's +Y axis), s = the spacing: distanceType 'spacing'
//              -> the distance; 'total' (Fusion's Extent) -> distance / (N - 1).
//   SYMMETRIC (advisor, Fusion API, task 658 review): the quantity is still the TOTAL count (the source included) and the step is the same as
//              without it; the instances are placed AROUND the source: i = -ceil((N-1)/2) .. floor((N-1)/2), an even count's extra one on the
//              negative side (Fusion: circular 4 at 90 deg -> -60, -30, 0, 30; rectangular 3 at 20 mm -> -20, 0, +20).
//   A suppressed instance (Fusion's suppression; deleting a copy suppresses its instance) has no copy. suppressed = ['i' | 'i,j' keys].
// THE RECORD (patternConstraintRecord): ONE constraint per pattern
//   { type: 'circularPattern', sources, centre, quantity, angle (degrees), symmetric, suppressed, instances }
//   { type: 'rectangularPattern', sources, directions: [lineId | null, lineId | null], quantity: [n1, n2], distance: [d1, d2],
//     distanceType: 'spacing' | 'total', symmetric: [b1, b2], suppressed, instances }
//   instances: [{ at, shapes: [copy shape ids, aligned with sources.shapes], joints: [copy joint ids, aligned with sources.points] }].
//   TASK 694 (Fusion: the values are model parameters d<n>): names: { slot: name } (every value of #core/pattern-values.js PATTERN_VALUES, given by
//   #core/parameters.js namePatternValues) and expressions: { slot: formula } (only the values a formula drives), last, after instances.
//   The values are changed by the parameter model (#core/dimension-seams.js applyParameterChange / editPatternValues), which calls editPattern(s).
//   The record names no joint / shape in the generic `joints` / `shapes` fields: a delete of one copy SUPPRESSES that instance (patternsAfterDelete)
//   instead of dropping the whole pattern, and a partial copy / paste leaves it behind (patternRefs: the paste carries it only when every operand
//   is copied). NESTED ARRAYS ARE NEVER MUTATED IN PLACE (the undo snapshot copies a constraint shallowly): every change assigns new arrays.
// THE COPIES (makeInstance, the ONE place a copy is made): each source shape copied (its kind's own data: a circle's radius, an arc's sweep;
//   construction stays construction), in the ACTIVE sketch, each arc with makeArc's structural equal (its own shape constraint). No other
//   constraint and no dimension of the sources is copied: the copies FOLLOW the sources through the pattern's rows.
// THE SOLVER ROWS (patternOperands): per instance, per source point P with copy point Q:
//   'pt'   Q - T(P) = 0 (2 rows); T = the instance's rotation about the centre / its translation
//   'ray'  where Q is an arc copy's REDUCED rim (its structural equal already holds |Q - C'|): Q on the ray from the copy's centre C' along the
//          transformed source direction v = T(P - C) (1 row): |w| atan2(v x w, v . w), w = Q - C' (zero only on that ray, offset.js's 'ta' form)
//   'rad'  a circle copy's radius - its source's radius (1 row)
//   so the rows = the copies' unknowns exactly (sources and values held -> the copies have 0 DOF, no redundant row). The angle / distance /
//   quantity are VALUES of the record, not unknowns.
// REGENERATE (syncPattern): the ONE path that makes / removes copies: the tool's create and every later edit (quantity, symmetric, suppression,
// distance type, a re-pick) go through it, then placePattern puts every copy at its exact place.
// Undo is the caller's (ONE undo step per create / edit). Refusals are data: { ok: false, reason } and nothing changes.
import { CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from './constants.js';
import { getCoincidentJoints } from './joints.js';
import { makeArc } from './shapes.js';
import { newJointId, newShapeId } from './shape-id.js';
import { inertEntities, inActiveSketch } from './sketch-model.js';
import { isReferenceJointId } from './reference-lines.js';
import { SolverConfig } from './solver-config.js';
import { patternSlotTexts } from './pattern-values.js';
import { namePatternValues } from './parameters.js';
import { copyGroups, dropEmptyGroups } from './group-model.js'; // TASK 756: a copy of a whole user group is a group

const T = CONSTRAINT_TYPES;
export const PATTERN_TYPES = Object.freeze([T.CIRCULAR_PATTERN, T.RECTANGULAR_PATTERN]);
export const isPatternConstraint = (c) => !!c && PATTERN_TYPES.includes(c.type);
export const PATTERN_UNDO_LABEL = Object.freeze({ [T.CIRCULAR_PATTERN]: 'circular pattern', [T.RECTANGULAR_PATTERN]: 'rectangular pattern' });

/** The shape kinds a pattern copies (a point needs no entry: it is a source point of its own). */
export const PATTERN_KINDS = Object.freeze({
  line: {},
  circle: { radius: true },
  arc: { equal: true },
});
const isKind = (s) => !!s && Object.prototype.hasOwnProperty.call(PATTERN_KINDS, s.type) && (s.type !== 'arc' || !s.subType || s.subType === 'CENTER');

/** Fusion's dialog defaults (believed: Fusion's sketch Circular Pattern opens at 3 / 360 deg; Rectangular 2 x 1, Spacing). Distance in WORLD mm. */
export function patternDefaults(type, docUnit = 'mm') {
  if (type === T.CIRCULAR_PATTERN) return { quantity: 3, angle: 360, symmetric: false, suppressed: [] };
  const d = docUnit === 'in' ? 12.7 : 10;
  return { quantity: [2, 1], distance: [d, d], distanceType: 'spacing', symmetric: [false, false], directions: [null, null], suppressed: [] };
}
const FULL = 360 - 1e-9;
const findShape = (shapes, id) => (shapes || []).find((s) => s && s.id === id) || null;
const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// ---------------------------------------------------------------------------------------------------------- the objects
/** The objects as stored ids: { shapes, joints } (the origin and the axes' reserved points are never objects). */
export function patternObjectsOf(shapeIds, jointIds) {
  return {
    shapes: [...new Set(asList(shapeIds))],
    joints: [...new Set(asList(jointIds))].filter((j) => j !== ORIGIN_JOINT_ID && !isReferenceJointId(j)),
  };
}

/**
 * The stored sources of `objects` ({ shapes, joints } ids) -> { ok: true, sources } or { ok: false, reason }: nothing picked, an object in a
 * locked sketch (task 577), a kind with no pattern rule, two arcs that share both end points with a third (no rim is left for the third's row).
 */
export function patternSources(state, objects) {
  const shapes = objects.shapes.map((id) => findShape(state.shapes, id)).filter(Boolean);
  const loose = objects.joints.filter((id) => state.joints.has(id));
  if (!shapes.length && !loose.length) return { ok: false, reason: 'select the objects to pattern first' };
  const inert = inertEntities(state);
  if (inert && (shapes.some((s) => inert.lockedS.has(s.id)) || loose.some((id) => inert.lockedJ.has(id)))) return { ok: false, reason: 'an object is in a locked sketch' };
  // Fusion edits only the active sketch (task 659's one rule, #core/sketch-model.js inActiveSketch)
  if (shapes.some((s) => !inActiveSketch(state, s)) || loose.some((id) => !inActiveSketch(state, state.joints.get(id)))) return { ok: false, reason: 'the objects must be in the active sketch' };
  const odd = shapes.find((s) => s.reference || !isKind(s));
  if (odd) return { ok: false, reason: `a ${odd.reference ? 'reference line' : odd.type} cannot be patterned (lines, arcs, circles and points)` };
  const all = [];
  for (const s of shapes) for (const j of s.joints) if (!all.includes(j)) all.push(j);
  for (const j of loose) if (!all.includes(j)) all.push(j);
  const lead = new Map(), points = [];
  for (const p of all) {
    if (lead.has(p)) continue;
    for (const q of getCoincidentJoints(p, state.constraints)) if (all.includes(q) && !lead.has(q)) lead.set(q, p);
    lead.set(p, p);
    points.push(p);
  }
  const sources = { shapes: shapes.map((s) => s.id), points, shapeJoints: shapes.map((s) => s.joints.map((j) => points.indexOf(lead.get(j)))) };
  const red = reducedRims(sources, state.shapes);
  if (red.reason) return { ok: false, reason: red.reason };
  return { ok: true, sources };
}

// Each source ARC's reduced rim: the point (index) whose copy gets the 1-row 'ray' row (the copy arc's structural equal holds its radius) ->
// { map: Map(point index -> the arc's centre index) } or { reason }. The arc's end rim, or its start when another arc already reduced the end.
function reducedRims(sources, shapes) {
  const map = new Map();
  for (let si = 0; si < sources.shapes.length; si++) {
    const s = findShape(shapes, sources.shapes[si]);
    if (!s || s.type !== 'arc') continue;
    const [kc, k1, k2] = sources.shapeJoints[si];
    const pick = !map.has(k2) && k2 !== kc ? k2 : (!map.has(k1) && k1 !== kc ? k1 : null);
    if (pick == null) return { reason: 'three arcs share the same two end points' };
    map.set(pick, kc);
  }
  return { map };
}

// ---------------------------------------------------------------------------------------------------------- the values
const intOr = (v, d) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d); // not rounded: a typed 2.5 is refused (patternValuesRefusal), not silently made 3
const pair = (v, f) => [f(asList(v)[0]), f(asList(v)[1])];

export const CIRCULAR_ANGLE_REFUSAL = 'the total angle must be between -360 and 360 degrees, not 0';
/** Why a circular pattern total angle (user degrees) cannot be used, or null: [-360, 0) and (0, 360] are valid. */
export function circularAngleRefusal(angle) {
  return Number.isFinite(angle) && angle !== 0 && Math.abs(angle) <= 360 ? null : CIRCULAR_ANGLE_REFUSAL;
}

/** Why these pattern values cannot be used, or null. `c` is a record (or the values of one). */
export function patternValuesRefusal(c) {
  if (c.type === T.CIRCULAR_PATTERN) {
    if (!(Number.isInteger(c.quantity) && c.quantity >= 2)) return 'the quantity must be a whole number of 2 or more';
    if (c.quantity > 1000) return 'the quantity must be at most 1000';
    return circularAngleRefusal(c.angle);
  }
  for (let k = 0; k < 2; k++) {
    if (!(Number.isInteger(c.quantity[k]) && c.quantity[k] >= 1)) return `quantity ${k + 1} must be a whole number of 1 or more`;
    if (!Number.isFinite(c.distance[k]) || c.distance[k] === 0) return `distance ${k + 1} must be a number other than 0`;
  }
  if (c.quantity[0] * c.quantity[1] > 1000) return 'the pattern must have at most 1000 instances';
  if (c.quantity[0] < 2 && c.quantity[1] < 2) return 'a quantity of 2 or more is needed in one direction';
  return null;
}

/** The angle between neighbouring instances, user degrees (counter-clockwise when positive, clockwise when negative). */
export function patternAngleStep(c) {
  const n = c.quantity;
  if (!(n >= 2)) return 0;
  return Math.abs(c.angle) > FULL ? c.angle / n : c.angle / (n - 1);
}
/** The spacing between neighbouring instances in direction k (0 or 1), world mm (signed: a negative distance runs the other way). */
export function patternSpacing(c, k) {
  const n = c.quantity[k], d = c.distance[k];
  if (!(n >= 2)) return 0;
  return c.distanceType !== 'total' ? d : d / (n - 1);
}
/** The distance value that keeps the spacing of direction k with the distance type `type` (the dialog's type switch keeps the copies where they are). */
export function patternDistanceFor(c, k, type) {
  const n = c.quantity[k], s = patternSpacing(c, k);
  if (!(n >= 2)) return c.distance[k];
  return type === 'total' ? s * (n - 1) : s;
}

// the instance numbers of one direction (the source is 0): 0 .. N-1, or symmetric -ceil((N-1)/2) .. floor((N-1)/2)
const range = (n, sym) => { const lo = sym ? -Math.ceil((n - 1) / 2) : 0; return Array.from({ length: Math.max(1, n) }, (_, i) => lo + i); };
// the instance number at the far end of one direction (the arrow's): the side with more instances (symmetric: the negative side on a tie)
const farEnd = (n, sym) => (sym ? -Math.ceil((n - 1) / 2) : n - 1);
export const slotKey = (at) => at.join(',');

/** Every instance slot of the pattern except the source, in order: [{ at, key, suppressed }]. */
export function patternSlots(c) {
  const off = new Set(asList(c.suppressed));
  const out = [];
  if (c.type === T.CIRCULAR_PATTERN) {
    for (const i of range(c.quantity, !!c.symmetric)) if (i !== 0) out.push([i]);
  } else {
    for (const i of range(c.quantity[0], !!c.symmetric[0])) for (const j of range(c.quantity[1], !!c.symmetric[1])) if (i !== 0 || j !== 0) out.push([i, j]);
  }
  return out.map((at) => ({ at, key: slotKey(at), suppressed: off.has(slotKey(at)) }));
}

/** The transform of instance `at`: circular { th } (world radians), rectangular { t: [t1, t2] } (world mm along the two directions). */
export function patternTransform(c, at) {
  if (c.type === T.CIRCULAR_PATTERN) return { th: -at[0] * patternAngleStep(c) * Math.PI / 180 };
  return { t: [at[0] * patternSpacing(c, 0), at[1] * patternSpacing(c, 1)] };
}

// The default directions (world vectors): the X axis, the user's +Y axis (world y runs down). A direction picked on an AXIS is that axis's
// constant (the X axis right, the Y axis UP like Fusion's, whatever way the reserved axis line is stored).
export const PATTERN_DEFAULT_DIRECTIONS = Object.freeze([Object.freeze({ x: 1, y: 0 }), Object.freeze({ x: 0, y: -1 })]);
const AXIS_DIRECTIONS = Object.freeze({ ref_axis_x: PATTERN_DEFAULT_DIRECTIONS[0], ref_axis_y: PATTERN_DEFAULT_DIRECTIONS[1] });
// direction k of a record as a row operand: { a, b } (a sketch line's ends, live) or { x, y } (a constant); null when its line is missing
function directionOperand(shapes, id, k) {
  if (!id) return { ...PATTERN_DEFAULT_DIRECTIONS[k] };
  if (AXIS_DIRECTIONS[id]) return { ...AXIS_DIRECTIONS[id] };
  const l = findShape(shapes, id);
  return l && l.type === 'line' ? { a: l.joints[0], b: l.joints[1] } : null;
}
/** A picked direction as stored: the direction's own default axis is null (the default), another axis / a line its id. */
export const patternDirectionPick = (k, id) => ((k === 0 && id === 'ref_axis_x') || (k === 1 && id === 'ref_axis_y') ? null : id);

// the live frame of a pattern: circular { C }, rectangular { u: [u1, u2] }, from pt(jointId) -> {x, y}; null when an operand is missing
function frameOf(ops, pt) {
  if (ops.kind === T.CIRCULAR_PATTERN) { const C = pt(ops.centre); return C ? { C } : null; }
  const u = ops.dirs.map((d) => {
    if (d.a == null) return { x: d.x, y: d.y };
    const a = pt(d.a), b = pt(d.b);
    if (!a || !b) return null;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1e-12;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  });
  return u.every(Boolean) ? { u } : null;
}
// THE transform of a point (T) and of a vector (V) by one instance: the rows, the placement and the preview all use these two.
function movePoint(ops, frame, tr, p) {
  if (ops.kind === T.CIRCULAR_PATTERN) {
    const co = Math.cos(tr.th), si = Math.sin(tr.th), dx = p.x - frame.C.x, dy = p.y - frame.C.y;
    return { x: frame.C.x + co * dx - si * dy, y: frame.C.y + si * dx + co * dy };
  }
  return { x: p.x + tr.t[0] * frame.u[0].x + tr.t[1] * frame.u[1].x, y: p.y + tr.t[0] * frame.u[0].y + tr.t[1] * frame.u[1].y };
}
function moveVector(ops, tr, v) {
  if (ops.kind !== T.CIRCULAR_PATTERN) return v;
  const co = Math.cos(tr.th), si = Math.sin(tr.th);
  return { x: co * v.x - si * v.y, y: si * v.x + co * v.y };
}

// ---------------------------------------------------------------------------------------------------------- the record
/** THE stored form of a pattern constraint: every field in one order (byte-stable saves), deep-copied; null when `params` is no pattern. */
export function patternConstraintRecord(params) {
  if (!params || !PATTERN_TYPES.includes(params.type)) return null;
  const s = params.sources;
  if (!s || !Array.isArray(s.shapes) || !Array.isArray(s.points) || !Array.isArray(s.shapeJoints) || s.shapeJoints.length !== s.shapes.length) return null;
  const sources = { shapes: s.shapes.slice(), points: s.points.slice(), shapeJoints: s.shapeJoints.map((l) => asList(l).slice()) };
  const instances = asList(params.instances).map((i) => ({ at: asList(i.at).map(Number), shapes: asList(i.shapes).slice(), joints: asList(i.joints).slice() }));
  const suppressed = [...new Set(asList(params.suppressed).map(String))];
  // TASK 694: the values' names and formulas (copied; only declared values; `expressions` only when a formula drives one)
  const named = (rec) => {
    const names = patternSlotTexts(rec.type, params.names), expressions = patternSlotTexts(rec.type, params.expressions);
    if (Object.keys(names).length) rec.names = names;
    if (Object.keys(expressions).length) rec.expressions = expressions;
    return rec;
  };
  if (params.type === T.CIRCULAR_PATTERN) {
    if (params.centre == null) return null;
    return named({
      type: T.CIRCULAR_PATTERN,
      sources, centre: params.centre, quantity: intOr(params.quantity, 3), angle: Number(params.angle), symmetric: !!params.symmetric, suppressed, instances,
    });
  }
  return named({
    type: T.RECTANGULAR_PATTERN,
    sources,
    directions: pair(params.directions, (v) => (v == null ? null : v)),
    quantity: pair(params.quantity, (v) => intOr(v, 1)),
    distance: pair(params.distance, Number),
    distanceType: params.distanceType === 'total' ? 'total' : 'spacing',
    symmetric: pair(params.symmetric, (v) => !!v),
    suppressed, instances,
  });
}

/** Every joint / shape a pattern names (the clipboard's "inside the copy" test, the sketch of the constraint). */
export function patternRefs(c) {
  const joints = new Set(c.sources.points), shapes = new Set(c.sources.shapes);
  for (const i of c.instances) { i.joints.forEach((j) => joints.add(j)); i.shapes.forEach((s) => shapes.add(s)); }
  if (c.type === T.CIRCULAR_PATTERN) joints.add(c.centre);
  else for (const d of c.directions) if (d && !AXIS_DIRECTIONS[d]) shapes.add(d);
  return { joints: [...joints], shapes: [...shapes] };
}
/** A copy of the record with every id mapped (jointOf(id), shapeOf(id): the paste's id maps); without the values' names and formulas (task 694:
 *  the paste names the copy's values afresh, #ui/clipboard.js). */
export function remapPattern(c, jointOf, shapeOf) {
  const { names, expressions, ...rest } = c;
  return patternConstraintRecord({
    ...rest,
    sources: { shapes: c.sources.shapes.map(shapeOf), points: c.sources.points.map(jointOf), shapeJoints: c.sources.shapeJoints },
    centre: c.centre != null ? jointOf(c.centre) : c.centre,
    directions: c.directions ? c.directions.map((d) => (d ? shapeOf(d) : null)) : c.directions,
    instances: c.instances.map((i) => ({ at: i.at, shapes: i.shapes.map(shapeOf), joints: i.joints.map(jointOf) })),
  });
}

// ---------------------------------------------------------------------------------------------------------- the solver rows
/**
 * THE rows of a stored pattern (the module header) -> { kind, centre?, dirs?, rows: [...] } with joint ids and, for a radius, shape ids, or null
 * when it cannot be resolved (a missing shape / joint operand, a copy whose kind does not match its source). dirs[k]: { a, b } (a line's joints)
 * or { x, y } (a constant direction). Row kinds, each carrying its instance's transform ({ th } or { t }):
 *   { k: 'pt', q, p }            q - T(p)                                   (2 rows)
 *   { k: 'ray', q, cq, p, cs }   |w| atan2(v x w, v . w), v = V(p - cs), w = q - cq   (1 row)
 *   { k: 'rad', off, src }       R(off) - R(src)                            (1 row)
 */
export function patternOperands(c, shapes) {
  if (!isPatternConstraint(c) || !c.sources) return null;
  const src = c.sources.shapes.map((id) => findShape(shapes, id));
  if (src.some((s) => !s)) return null;
  const red = reducedRims(c.sources, shapes);
  if (red.reason) return null;
  const ops = { kind: c.type, rows: [] };
  if (c.type === T.CIRCULAR_PATTERN) ops.centre = c.centre;
  else {
    ops.dirs = [0, 1].map((k) => directionOperand(shapes, c.directions[k], k));
    if (ops.dirs.some((d) => !d)) return null;
  }
  const points = c.sources.points;
  // TASK 847: the copies by id from ONE index (each was a scan of every shape, per copy: a solver assembly of a pattern of z copies grew with
  // z x shapes); the first shape with that id, the one findShape returns
  const byId = new Map();
  for (const s of (shapes || [])) if (s && !byId.has(s.id)) byId.set(s.id, s);
  for (const inst of c.instances) {
    if (inst.joints.length !== points.length || inst.shapes.length !== src.length) return null;
    const copies = inst.shapes.map((id) => byId.get(id) || null);
    if (copies.some((s, si) => !s || s.type !== src[si].type)) return null;
    const tr = patternTransform(c, inst.at);
    points.forEach((p, k) => {
      if (red.map.has(k)) { const kc = red.map.get(k); ops.rows.push({ k: 'ray', q: inst.joints[k], cq: inst.joints[kc], p, cs: points[kc], ...tr }); }
      else ops.rows.push({ k: 'pt', q: inst.joints[k], p, ...tr });
    });
    src.forEach((s, si) => { if (s.type === 'circle') ops.rows.push({ k: 'rad', off: inst.shapes[si], src: s.id, ...tr }); });
  }
  return ops;
}

/** How many solver rows a stored pattern has (0 when it cannot be resolved). */
export function patternRowCount(c, shapes) {
  const ops = patternOperands(c, shapes);
  return ops ? ops.rows.reduce((m, r) => m + (r.k === 'pt' ? 2 : 1), 0) : 0;
}

/**
 * THE values of pattern rows (one formula for the solver rows and the verifier): ops from patternOperands with its references replaced as the
 * caller needs (the solver: dense indices; the verifier: ids); pt(ref) -> { x, y }, radius(ref) -> a shape reference's radius.
 */
export function patternRowValues(ops, pt, radius) {
  const frame = frameOf(ops, pt);
  if (!frame) return ops.rows.flatMap((r) => (r.k === 'pt' ? [NaN, NaN] : [NaN]));
  const out = [];
  for (const r of ops.rows) {
    if (r.k === 'rad') { out.push(radius(r.off) - radius(r.src)); continue; }
    const q = pt(r.q), p = pt(r.p);
    if (r.k === 'pt') { const m = movePoint(ops, frame, r, p); out.push(q.x - m.x, q.y - m.y); continue; }
    const cs = pt(r.cs), cq = pt(r.cq);
    const v = moveVector(ops, r, { x: p.x - cs.x, y: p.y - cs.y }), wx = q.x - cq.x, wy = q.y - cq.y;
    out.push(Math.hypot(wx, wy) * Math.atan2(v.x * wy - v.y * wx, v.x * wx + v.y * wy));
  }
  return out;
}

/** The verifier's residual (world mm): the largest |row| of a stored pattern (0 when it cannot be resolved). */
export function patternResidual(c, joints, shapes, radiusOf) {
  const ops = patternOperands(c, shapes);
  if (!ops) return 0;
  const pt = (id) => joints.get(id) || { x: NaN, y: NaN };
  return patternRowValues(ops, pt, (id) => radiusOf(findShape(shapes, id))).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}

/** The copies' solver unknowns (what gives way when a source is edited: creation-placement constraintOperands): { joints, circles }. */
export function patternCopyOperands(c, shapes) {
  const joints = new Set(), circles = new Set();
  for (const i of (c.instances || [])) {
    i.joints.forEach((j) => joints.add(j));
    for (const id of i.shapes) { const s = findShape(shapes, id); if (s && s.type === 'circle') circles.add(id); }
  }
  return { joints, circles };
}

// ---------------------------------------------------------------------------------------------------------- the geometry
const liveOps = (state, c) => {
  const ops = { kind: c.type };
  if (c.type === T.CIRCULAR_PATTERN) ops.centre = c.centre;
  else ops.dirs = [0, 1].map((k) => directionOperand(state.shapes, c.directions[k], k) || { ...PATTERN_DEFAULT_DIRECTIONS[k] });
  return ops;
};
const ptOf = (state) => (id) => { const j = state.joints.get(id); return j ? { x: j.x, y: j.y } : null; };

/**
 * The geometry of one instance slot (the preview of a suppressed instance, the ghosts of the tool): the source shapes and points moved by the
 * slot's transform -> [{ kind: 'line', a, b } | { kind: 'circle', c, r } | { kind: 'arc', c, a, b, r, sweep } | { kind: 'point', p }], or [].
 */
export function patternSlotGeometry(state, c, at) {
  const ops = liveOps(state, c), pt = ptOf(state), frame = frameOf(ops, pt);
  if (!frame) return [];
  const tr = patternTransform(c, at), M = (id) => { const p = pt(id); return p ? movePoint(ops, frame, tr, p) : null; };
  const out = [], used = new Set();
  for (const id of c.sources.shapes) {
    const s = findShape(state.shapes, id);
    if (!s) continue;
    s.joints.forEach((j) => used.add(j));
    if (s.type === 'line') out.push({ kind: 'line', a: M(s.joints[0]), b: M(s.joints[1]) });
    else if (s.type === 'circle') out.push({ kind: 'circle', c: M(s.joints[0]), r: s.radius });
    else { const C = M(s.joints[0]), a = M(s.joints[1]); out.push({ kind: 'arc', c: C, a, b: M(s.joints[2]), r: Math.hypot(a.x - C.x, a.y - C.y), sweep: s.sweep }); }
  }
  for (const p of c.sources.points) if (!used.has(p) && ![...getCoincidentJoints(p, state.constraints)].some((q) => used.has(q))) out.push({ kind: 'point', p: M(p) });
  return out.filter((g) => Object.values(g).every((v) => v !== null));
}

/** The middle of the source points (the rectangular arrows start from it, the circular label sits beside the centre). */
export function patternSourceMiddle(state, c) {
  const ps = c.sources.points.map((id) => state.joints.get(id)).filter(Boolean);
  if (!ps.length) return null;
  return { x: ps.reduce((m, p) => m + p.x, 0) / ps.length, y: ps.reduce((m, p) => m + p.y, 0) / ps.length };
}

/**
 * THE handles of a pattern (the drag arrows of a rectangular pattern, the labels): rectangular, one per direction with a quantity of 2 or more,
 * { k, point (the source middle moved to the direction's far-end instance), dir (the unit direction from the source to it, the way the
 * distance grows), steps (how many spacings away it is), along (its distance along dir from the source middle), extent (how far the objects
 * reach from their middle along dir: an arrow / a label sits past it, off the copy) }; circular, one { point: the centre }.
 */
export function patternHandles(state, c) {
  if (c.type === T.CIRCULAR_PATTERN) { const C = state.joints.get(c.centre); return C ? [{ point: { x: C.x, y: C.y } }] : []; }
  const ops = liveOps(state, c), frame = frameOf(ops, ptOf(state)), m = patternSourceMiddle(state, c);
  if (!frame || !m) return [];
  const out = [];
  for (let k = 0; k < 2; k++) {
    if (c.quantity[k] < 2) continue;
    const end = farEnd(c.quantity[k], c.symmetric[k]), along = end * patternSpacing(c, k), u = frame.u[k], sg = Math.sign(along) || 1;
    const dir = { x: sg * u.x, y: sg * u.y };
    const extent = c.sources.points.reduce((e, id) => { const p = state.joints.get(id); return p ? Math.max(e, (p.x - m.x) * dir.x + (p.y - m.y) * dir.y) : e; }, 0);
    out.push({ k, point: { x: m.x + along * u.x, y: m.y + along * u.y }, dir, steps: Math.abs(end), along: Math.abs(along), extent });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------- make / regenerate
// THE one place a copy is made: the copy points of every source point and a copy of every source shape for the instance `at`.
function makeInstance(state, c, at) {
  const seq = newShapeId('');
  // placed by placePattern; the joints.set wrap stamps the ACTIVE sketch; a point kept without a shape (orphanAllowed) keeps its copies too
  const joints = c.sources.points.map((p) => {
    const id = newJointId(), src = state.joints.get(p);
    state.joints.set(id, src && src.orphanAllowed ? { x: 0, y: 0, fixed: false, orphanAllowed: true } : { x: 0, y: 0, fixed: false });
    return id;
  });
  const groups = new Map(), copies = new Map();
  const shapes = c.sources.shapes.map((sid, si) => {
    const src = findShape(state.shapes, sid);
    const { id, joints: sj, sketchId, userGroupId, groupId, filletSharp, dragTarget, ...rest } = src; // a copy is no fillet's arc (its user group: copyGroups below)
    const copy = { ...rest, id: `s${seq}_p${si}`, joints: c.sources.shapeJoints[si].map((k) => joints[k]) };
    if (groupId) { if (!groups.has(groupId)) groups.set(groupId, `pattern_${seq}_${groups.size}`); copy.groupId = groups.get(groupId); }
    state.shapes.push(copy); // the shapes.push wrap stamps the ACTIVE sketch
    copies.set(sid, copy);
    if (PATTERN_KINDS[src.type].equal) state.constraints.push(...makeArc(null, copy.joints[0], copy.joints[1], copy.joints[2], copy.subType || 'CENTER', !!copy.isConstruction).constraints);
    return copy.id;
  });
  copyGroups(state, state, copies); // TASK 756: each copy of a whole user group is a group beside the original (#core/group-model.js)
  return { at: at.slice(), shapes, joints };
}

// The constraint fields that name a joint / a shape (the delete path's and the clipboard's list).
const JOINT_FIELDS = ['joints', 'joint'], SHAPE_FIELDS = ['shapes', 'shape', 'line', 'circle'];
const names = (k, fields, ids) => fields.some((f) => asList(k[f]).some((x) => ids.has(x)));

// Remove one instance's copies: its shapes, its points (a point another shape still uses stays, as a plain point), every constraint on them.
function removeInstance(state, inst) {
  const shapes = new Set(inst.shapes);
  for (let i = state.shapes.length - 1; i >= 0; i--) if (state.shapes[i] && shapes.has(state.shapes[i].id)) state.shapes.splice(i, 1);
  const used = new Set(state.shapes.flatMap((s) => asList(s.joints)));
  const joints = new Set(inst.joints.filter((j) => !used.has(j)));
  for (let i = state.constraints.length - 1; i >= 0; i--) {
    const k = state.constraints[i];
    if (k && !isPatternConstraint(k) && (names(k, SHAPE_FIELDS, shapes) || names(k, JOINT_FIELDS, joints))) state.constraints.splice(i, 1);
  }
  for (const j of joints) state.joints.delete(j);
  dropEmptyGroups(state); // TASK 756: the instance's copy groups go with its copies
}

/** Put every copy at its exact place: each copy point at T(its source point), each circle copy's radius = its source's. */
export function placePattern(state, c) {
  const ops = liveOps(state, c), pt = ptOf(state), frame = frameOf(ops, pt);
  if (!frame) return;
  for (const inst of c.instances) {
    const tr = patternTransform(c, inst.at);
    c.sources.points.forEach((p, k) => {
      const P = pt(p), q = state.joints.get(inst.joints[k]);
      if (!P || !q) return;
      const m = movePoint(ops, frame, tr, P); q.x = m.x; q.y = m.y;
    });
    c.sources.shapes.forEach((sid, si) => {
      const s = findShape(state.shapes, sid), cp = findShape(state.shapes, inst.shapes[si]);
      if (s && cp && s.type === 'circle') cp.radius = s.radius;
    });
  }
}

/** THE regenerate: make the copies of every wanted slot the pattern lacks, remove those of slots it no longer has (or suppresses), place all. */
export function syncPattern(state, c) {
  const have = new Map(c.instances.map((i) => [slotKey(i.at), i]));
  const wanted = patternSlots(c).filter((s) => !s.suppressed);
  const keys = new Set(wanted.map((s) => s.key));
  for (const [key, inst] of have) if (!keys.has(key)) removeInstance(state, inst);
  c.instances = wanted.map((s) => have.get(s.key) || makeInstance(state, c, s.at));
  placePattern(state, c);
}

/**
 * Make a pattern: `type` (circularPattern | rectangularPattern), the objects ({ shapes, joints } ids) and the values (patternDefaults' fields;
 * circular: centre). -> { ok: true, constraint, shapes, joints } (the copies) or { ok: false, reason } (nothing changes).
 */
export function applyPattern(state, type, objects, values) {
  const src = patternSources(state, objects);
  if (!src.ok) return src;
  const { names, expressions, ...plain } = values || {}; // task 694: a new pattern's values get the next automatic names, never given ones
  const rec = patternConstraintRecord({ ...plain, type, sources: src.sources, instances: [] });
  if (!rec) return { ok: false, reason: type === T.CIRCULAR_PATTERN ? 'pick the centre point' : 'the pattern values are incomplete' };
  const why = patternValuesRefusal(rec) || placementRefusal(state, rec);
  if (why) return { ok: false, reason: why };
  state.constraints.push(rec);
  namePatternValues(state.constraints, rec, state.parameters);
  syncPattern(state, rec);
  return { ok: true, constraint: rec, shapes: rec.instances.flatMap((i) => i.shapes), joints: rec.instances.flatMap((i) => i.joints) };
}

// a centre / direction that cannot be used with these sources
function placementRefusal(state, c) {
  if (c.type === T.CIRCULAR_PATTERN) {
    if (!state.joints.has(c.centre) && c.centre !== ORIGIN_JOINT_ID) return 'pick the centre point';
    if (c.centre !== ORIGIN_JOINT_ID && !inActiveSketch(state, state.joints.get(c.centre))) return 'the centre point must be in the active sketch (or the origin)'; // task 659's rule
    if (c.sources.points.includes(c.centre) && !c.sources.shapes.some((id) => { const s = findShape(state.shapes, id); return s && s.joints.includes(c.centre); })) return 'the centre point cannot be one of the objects';
    return null;
  }
  for (let k = 0; k < 2; k++) {
    const id = c.directions[k];
    if (!id || AXIS_DIRECTIONS[id]) continue;
    const l = findShape(state.shapes, id);
    if (!l || l.type !== 'line') return `direction ${k + 1} must be a line`;
    if (!inActiveSketch(state, l)) return `the direction ${k + 1} line must be in the active sketch (or an axis)`; // task 659's rule
    const a = state.joints.get(l.joints[0]), b = state.joints.get(l.joints[1]);
    if (!a || !b || !(Math.hypot(b.x - a.x, b.y - a.y) > 0)) return `the direction ${k + 1} line has no length`;
  }
  return null;
}

/**
 * Edit a pattern (the dialog's OK on an existing pattern, a value typed for its label, the tool's live preview): `changes` = any of the record's
 * value fields (quantity, angle, symmetric, suppressed, distance, distanceType, directions, centre) or `objects` (a re-pick). Regenerates
 * through syncPattern, then solves; refused (nothing changes) when the values are not allowed or the sketch cannot hold them.
 * -> { ok: true } | { ok: false, reason }. The undo step is the caller's.
 */
export function editPattern(state, c, changes, solve = (s) => (s.engine && typeof s.engine.solve === 'function' ? s.engine.solve(SolverConfig.ITERATIONS || 500) : null)) {
  const { objects, ...values } = changes || {};
  let sources = c.sources;
  if (objects) { const src = patternSources(state, objects); if (!src.ok) return src; sources = src.sources; }
  const next = patternConstraintRecord({ ...c, ...values, sources, instances: c.instances });
  if (!next) return { ok: false, reason: 'the pattern values are incomplete' };
  const why = patternValuesRefusal(next) || placementRefusal(state, next);
  if (why) return { ok: false, reason: why };
  const backup = backupState(state, [c]);
  const rebuild = objects || next.centre !== c.centre || JSON.stringify(next.directions) !== JSON.stringify(c.directions);
  if (rebuild) { for (const inst of c.instances) removeInstance(state, inst); next.instances = []; }
  Object.assign(c, next);
  syncPattern(state, c);
  const res = solve(state);
  if (res && res.converged === false) { restoreState(state, backup); solve(state); return { ok: false, reason: 'the sketch cannot hold these values (it conflicts with another constraint)' }; }
  return { ok: true };
}

/**
 * TASK 694: edit several patterns as ONE change (a parameter that drives more than one pattern): list = [{ c, changes }], each through
 * editPattern. All or nothing: the first refusal puts every pattern back -> { ok: false, reason, c }. On success -> { ok: true, restore() }:
 * restore() puts them all back too (the caller's later step refused: #core/dimension-seams.js applyParameterChange).
 */
export function editPatterns(state, list, solve = (s) => (s.engine && typeof s.engine.solve === 'function' ? s.engine.solve(SolverConfig.ITERATIONS || 500) : null)) {
  const backup = backupState(state, list.map((x) => x.c));
  const restore = () => { restoreState(state, backup); solve(state); };
  for (const { c, changes } of list) {
    const res = editPattern(state, c, changes, solve);
    if (!res.ok) { restore(); return { ok: false, reason: res.reason, c }; }
  }
  return { ok: true, restore };
}

// what an edit may change, to put it back when the solve refuses it (in place: the engine holds these containers)
function backupState(state, records) {
  return {
    records: records.map((c) => [c, { ...c }]), shapes: state.shapes.slice(), constraints: state.constraints.slice(),
    groups: Array.isArray(state.groups) ? state.groups.map((g) => ({ ...g })) : null, // TASK 756: an instance's copy groups (copyGroups)
    joints: new Map([...state.joints].map(([id, j]) => [id, { ...j }])),
    radii: state.shapes.filter((s) => typeof s.radius === 'number').map((s) => [s, s.radius]),
  };
}
function restoreState(state, b) {
  for (const [c, record] of b.records) { for (const k of Object.keys(c)) delete c[k]; Object.assign(c, record); }
  state.shapes.length = 0; state.shapes.push(...b.shapes);
  state.constraints.length = 0; state.constraints.push(...b.constraints);
  if (b.groups) { state.groups.length = 0; state.groups.push(...b.groups); } // TASK 756
  for (const id of [...state.joints.keys()]) if (!b.joints.has(id)) state.joints.delete(id);
  for (const [id, j] of b.joints) { const live = state.joints.get(id); if (live) Object.assign(live, j); else state.joints.set(id, j); }
  for (const [s, r] of b.radii) s.radius = r;
}

/**
 * The delete path's follow-up (delete-manager.js, after shapes / joints went): a pattern that lost a COPY suppresses that instance (its other
 * copies go too: Fusion suppresses an instance, not one curve of it); a pattern that lost a SOURCE shape or point, its centre or a direction line
 * is deleted (its copies stay as plain geometry, as Fusion's "delete pattern constraint").
 */
export function patternsAfterDelete(state) {
  const shapeIds = new Set(state.shapes.map((s) => s.id));
  for (const c of state.constraints.filter(isPatternConstraint)) {
    const lost = c.sources.shapes.some((id) => !shapeIds.has(id)) || c.sources.points.some((j) => !state.joints.has(j))
      || (c.type === T.CIRCULAR_PATTERN ? !state.joints.has(c.centre) : c.directions.some((d) => d && !AXIS_DIRECTIONS[d] && !shapeIds.has(d)));
    if (lost) { state.constraints.splice(state.constraints.indexOf(c), 1); continue; }
    const gone = c.instances.filter((i) => i.shapes.some((id) => !shapeIds.has(id)) || i.joints.some((j) => !state.joints.has(j)));
    if (!gone.length) continue;
    c.suppressed = [...new Set([...c.suppressed, ...gone.map((i) => slotKey(i.at))])];
    syncPattern(state, c);
  }
}

/** The instance whose copies include the shape / joint `id`, or null: { c, inst }. */
export function patternInstanceOf(state, id) {
  for (const c of state.constraints) {
    if (!isPatternConstraint(c)) continue;
    const inst = c.instances.find((i) => i.shapes.includes(id) || i.joints.includes(id));
    if (inst) return { c, inst };
  }
  return null;
}
