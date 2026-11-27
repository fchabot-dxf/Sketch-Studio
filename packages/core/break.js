// packages/core/break.js — TRACE-1
// Pure geometry operation: split a line, an arc or a circle into two. No DOM. Operates directly on state.joints / state.shapes.
//
// breakShape(state, shapeId, t, { joint }) → { newShapeId, midJointId } | null
//
// A LINE [A---B] at parameter t becomes [A---M] + [M---B]; an ARC (centre C, start S, end E) at parameter t along its sweep becomes the arcs
// C: S->M and C: M->E (TASK 1018), which share the centre and M, so they stay ONE circle. M is a new joint at the point of the curve at t, or
// (`joint`, TASK 1018 R2-05) a joint already held on the curve (a hole's centre on it): the curve is split AT that joint.
// A CIRCLE has no ends: breakCircle splits it at two points (TASK 1018, like Fusion's Break, which splits between the nearest intersections):
// breakAt chooses them around the click (where other curves cross it, or points held on it).
// All constraints referencing the original shape's endpoint joints are preserved (they remain attached to A and B / S and E respectively).

import { inActiveSketch } from './sketch-model.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { arcStructuralConstraints } from './shapes.js';
import { applySnapConstraint, onShapeSnap } from './snap-constraints.js';
import { curveGeom, curveParamAt, curvePointAt, curveCuts, heldJointsOn, boundsAround, inPiece, sameU } from './curve-cuts.js';

/**
 * Rebind any Horizontal / Vertical constraints on `pair = [aId, bId]` onto each surviving segment
 * in `pieces` (updating the existing constraint in place for `pieces[0]`, copying onto any rest).
 * Shared by breakShape (#core/break.js) and trimShape (#core/trim.js).
 */
export function transferOrientationConstraints(state, pair, pieces) {
  if (!state || !Array.isArray(state.constraints) || !pieces.length) return;
  const onPair = (c) => Array.isArray(c.joints) && c.joints.length === 2 && pair.every((j) => c.joints.includes(j));
  for (const c of state.constraints.filter((x) => x && (x.type === CONSTRAINT_TYPES.HORIZONTAL || x.type === CONSTRAINT_TYPES.VERTICAL) && onPair(x))) {
    c.joints = pieces[0].slice();
    for (const piece of pieces.slice(1)) state.constraints.push({ ...c, joints: piece.slice() });
  }
}

/** TASK 1018: an arc's own structural equal(s) (#core/shapes.js arcStructuralConstraints: [centre, rim, centre, rim]) on its rims `rims`. */
export function arcOwnEquals(state, centreId, rims) {
  return (state.constraints || []).filter((c) => c && c.type === CONSTRAINT_TYPES.EQUAL && Array.isArray(c.joints) && c.joints.length === 4
    && c.joints[0] === centreId && c.joints[2] === centreId && rims.includes(c.joints[1]) && rims.includes(c.joints[3]));
}

/** Remove these constraint objects from state.constraints (in place: the list stays the same array). */
export function dropConstraints(state, drop) {
  if (!drop.length || !Array.isArray(state.constraints)) return;
  const gone = new Set(drop);
  for (let i = state.constraints.length - 1; i >= 0; i--) if (gone.has(state.constraints[i])) state.constraints.splice(i, 1);
}

/**
 * TASK 1018: an arc or a circle `target` was split, and `piece` (a new arc) took over the part of it from parameter u0 to u1 of its geometry
 * `g` BEFORE the split (#core/curve-cuts.js). The constraints that name `target` and sit on that part follow `piece` (as Break retargets a
 * line's pointOnLine past the split): a point held on the curve there, and a tangent whose line / curve meets `piece` at one of its rims (and
 * not `target`). A midpoint of the arc ({ joint, shape }) halves a sweep that no longer exists: it is dropped. Every other one (a radius /
 * diameter dimension, equal, concentric, a tangent elsewhere) stays on `target`.
 */
export function splitArcConstraints(state, target, piece, g, u0, u1) {
  if (!Array.isArray(state.constraints)) return;
  const pieceRims = new Set(piece.joints.slice(1)), targetRims = new Set(target.joints.slice(1));
  const meetsPiece = (s) => !!s && Array.isArray(s.joints) && s.joints.some((j) => pieceRims.has(j)) && !s.joints.some((j) => targetRims.has(j));
  const shapeOf = (id) => (state.shapes || []).find((s) => s && s.id === id);
  const drop = [];
  for (const c of state.constraints) {
    if (!c) continue;
    if (c.type === CONSTRAINT_TYPES.MIDPOINT && c.shape === target.id && c.joint) { drop.push(c); continue; }
    if (c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.shape === target.id && c.joint) {
      const p = state.joints.get(c.joint);
      if (p && inPiece(g, u0, u1, p)) c.shape = piece.id;
      continue;
    }
    if (c.type !== CONSTRAINT_TYPES.TANGENT) continue;
    if (c.circle === target.id && c.line && meetsPiece(shapeOf(c.line))) c.circle = piece.id;
    else if (Array.isArray(c.shapes) && c.shapes.includes(target.id)) {
      const other = c.shapes.find((id) => id !== target.id);
      if (meetsPiece(shapeOf(other))) c.shapes = c.shapes.map((id) => (id === target.id ? piece.id : id));
    }
  }
  dropConstraints(state, drop);
}

/**
 * Split the line or arc shape `shapeId` at fractional parameter `t` (0..1: a line from its start to its end, an arc along its sweep), or AT
 * the joint `options.joint` held on it (TASK 1018 R2-05: no new joint; the constraint that held it on the curve goes, the joint is now both
 * pieces' end). Mutates state.joints and state.shapes in place.
 *   line: transfers orientation constraints to both pieces, links them with a collinear constraint, keeps whole-line length dimensions on [A, B].
 *   arc:  the two arcs share the centre and M (one circle); each gets its own structural equal; splitArcConstraints moves what sits on the new piece.
 *
 * @param {object} state    - #core sketch state (joints Map, shapes Array, genJ fn)
 * @param {string} shapeId  - ID of the target line / arc shape
 * @param {number} t        - Split parameter, 0 = start, 1 = end (clamped)
 * @param {{ joint?: string }} [options]
 * @returns {{ midJointId:string, newShapeId:string } | null}
 */
export function breakShape(state, shapeId, t, options = {}) {
  const shape = (state.shapes || []).find(s => s.id === shapeId);
  if (!shape || (shape.type !== 'line' && shape.type !== 'arc')) return null;
  if (!inActiveSketch(state, shape)) return null; // Fusion edits only the active sketch (task 659): nothing is written
  const jointId = options && options.joint ? options.joint : null;
  if (jointId && !state.joints.get(jointId)) return null;
  return shape.type === 'line' ? breakLine(state, shape, t, jointId) : breakArc(state, shape, t, jointId);
}

// the constraints that held `jointId` on `shape` (a point on it, a midpoint of an arc): the joint becomes the pieces' end, so they go
const heldBy = (state, jointId, shape) => (state.constraints || []).filter((c) => c && c.joint === jointId && c.shape === shape.id
  && (c.type === CONSTRAINT_TYPES.POINT_ON_LINE || c.type === CONSTRAINT_TYPES.MIDPOINT));

function breakLine(state, shape, t, jointId) {
  const [aId, bId] = shape.joints;
  const jA = state.joints.get(aId);
  const jB = state.joints.get(bId);
  if (!jA || !jB) return null;

  let midJointId = jointId;
  if (jointId) t = lineParamAtPoint(jA, jB, state.joints.get(jointId));
  t = Math.max(0.001, Math.min(0.999, t));
  if (!midJointId) {
    // Mint a new joint for the midpoint
    midJointId = state.genJ();
    state.joints.set(midJointId, { x: jA.x + t * (jB.x - jA.x), y: jA.y + t * (jB.y - jA.y) });
  }

  // Build the second segment (M→B), reusing the original shape's metadata
  const newShapeId = 'Lbrk_' + midJointId + '_' + bId;
  state.shapes.push({ ...shape, id: newShapeId, joints: [midJointId, bId] });

  // Mutate the original shape: A→M
  shape.joints = [aId, midJointId];

  // UX-04: preserve line orientation constraints on both pieces, bind them collinear, and retarget
  // pointOnLine constraints past the split onto the new piece. Overall [aId, bId] length dimensions (and a midpoint [aId, bId, M])
  // stay between aId and bId because no geometry was removed, keeping total length intact while M slides along the line.
  if (Array.isArray(state.constraints)) {
    if (jointId) dropConstraints(state, heldBy(state, jointId, shape));
    transferOrientationConstraints(state, [aId, bId], [[aId, midJointId], [midJointId, bId]]);
    for (const c of state.constraints) {
      if (c && c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.shape === shape.id && c.joint) {
        const pj = state.joints.get(c.joint);
        if (pj && lineParamAtPoint(jA, jB, pj) > t) c.shape = newShapeId;
      }
    }
    state.constraints.push({ type: CONSTRAINT_TYPES.COLLINEAR, shapes: [shape.id, newShapeId] });
  }

  return { midJointId, newShapeId };
}

function breakArc(state, shape, t, jointId) {
  const g = curveGeom(state, shape);
  if (!g) return null;
  const [cId, sId, eId] = shape.joints;
  let u = jointId ? curveParamAt(g, state.joints.get(jointId)) : t;
  u = Math.max(0.001, Math.min(0.999, u));
  let midJointId = jointId;
  if (!midJointId) {
    midJointId = state.genJ();
    const p = curvePointAt(g, u);
    state.joints.set(midJointId, { x: p.x, y: p.y });
  }
  const sweep = g.dir > 0; // both pieces keep the arc's turning sense, stored explicitly like every arc (NEW-11)
  const newShapeId = 'Abrk_' + midJointId + '_' + eId;
  const piece = { ...shape, id: newShapeId, joints: [cId, midJointId, eId], sweep };
  state.shapes.push(piece);
  shape.joints = [cId, sId, midJointId];
  shape.sweep = sweep;
  if (Array.isArray(state.constraints)) {
    dropConstraints(state, [...arcOwnEquals(state, cId, [sId, eId]), ...(jointId ? heldBy(state, jointId, shape) : [])]);
    splitArcConstraints(state, shape, piece, g, u, 1);
    state.constraints.push(...arcStructuralConstraints(shape), ...arcStructuralConstraints(piece));
  }
  return { midJointId, newShapeId };
}

/** What a Break of a circle needs and did not find (TASK 1018: a circle splits between two points on it). */
export const CIRCLE_BREAK_REFUSAL = 'Break: a circle splits between two points on it (where other curves cross it, or points lie on it)';

/**
 * THE break a click at world point `p` on curve `shapeId` makes, read by the Break tool's hover and its press alike:
 *   line / arc  { shapeId, kind, t, joint, points: [pt] }: the point of the curve nearest the click, or (TASK 1018 R2-05) a joint held on the
 *               curve (#core/curve-cuts.js heldJointsOn) within `tol` (world mm: the tool's pick radius) of the click: the split is AT it.
 *   circle      { shapeId, kind, cuts: [c0, c1], points }: the two cut points around the click (other curves crossing it, joints held on it; a
 *               held joint at a crossing is that joint): the circle splits into the clicked part and the rest. Fewer than two: { refusal }.
 * null when the shape is no line, arc or circle.
 */
export function breakAt(state, shapeId, p, tol = 0) {
  const s = (state.shapes || []).find((x) => x && x.id === shapeId);
  const g = curveGeom(state, s);
  if (!g) return null;
  const held = heldJointsOn(state, s);
  if (g.kind !== 'circle') {
    const near = held.map((h) => ({ h, d: Math.hypot(h.pt.x - p.x, h.pt.y - p.y) })).filter((x) => x.d <= tol).sort((a, b) => a.d - b.d)[0];
    if (near) return { shapeId, kind: g.kind, t: near.h.u, joint: near.h.joint, points: [near.h.pt] };
    const t = curveParamAt(g, p);
    return { shapeId, kind: g.kind, t, joint: null, points: [curvePointAt(g, t)] };
  }
  const cuts = curveCuts(state, s).map((k) => ({ ...k, joint: null }));
  for (const h of held) {
    const same = cuts.find((k) => sameU(g, k.u, h.u));
    if (same) { same.joint = h.joint; same.pt = h.pt; } else cuts.push({ u: h.u, pt: h.pt, cutters: [], joint: h.joint });
  }
  cuts.sort((a, b) => a.u - b.u);
  const around = boundsAround(g, cuts, curveParamAt(g, p));
  if (!around) return { shapeId, kind: 'circle', refusal: CIRCLE_BREAK_REFUSAL, points: [] };
  return { shapeId, kind: 'circle', cuts: around, points: around.map((k) => k.pt) };
}

/** Apply a breakAt plan (the tool's press). -> breakShape's / breakCircle's result, or null (a refusal, nothing written). */
export function applyBreak(state, plan) {
  if (!plan || plan.refusal) return null;
  if (plan.kind === 'circle') return breakCircle(state, plan.shapeId, plan.cuts[0], plan.cuts[1]);
  return breakShape(state, plan.shapeId, plan.t, plan.joint ? { joint: plan.joint } : {});
}

/**
 * TASK 1018: split the circle `shapeId` at two cut points (breakAt's: { u, pt, cutters, joint }), cut0 then cut1 growing in angle. The circle
 * becomes the ARC from cut1 round to cut0 (it keeps its id, so its diameter dimension, equal, concentric and tangent constraints stay on it), and a
 * new arc takes the part from cut0 to cut1; they share the centre and both rims (one circle). A cut on a held joint is that joint (the constraint
 * that held it on the circle goes); any other cut gets a new joint, held on the curves that cross there (the cut end bound to the cutter, as Trim does).
 * -> { newShapeId, joints: [j0, j1] } | null
 */
export function breakCircle(state, shapeId, cut0, cut1) {
  const shape = (state.shapes || []).find((s) => s && s.id === shapeId);
  if (!shape || shape.type !== 'circle' || !inActiveSketch(state, shape) || !cut0 || !cut1) return null;
  const g = curveGeom(state, shape);
  if (!g) return null;
  const minted = [];
  const jointOf = (cut) => {
    if (cut.joint && state.joints.has(cut.joint)) return cut.joint;
    const id = state.genJ();
    state.joints.set(id, { x: cut.pt.x, y: cut.pt.y });
    minted.push([id, cut]);
    return id;
  };
  const j0 = jointOf(cut0), j1 = jointOf(cut1);
  const [cId] = shape.joints;
  const held = [cut0.joint, cut1.joint].filter(Boolean);
  const heldOn = Array.isArray(state.constraints) ? held.flatMap((j) => heldBy(state, j, shape)) : [];
  circleToArc(shape, j1, j0); // the rest, cut1 -> cut0
  const newShapeId = 'Abrk_' + j0 + '_' + j1;
  const piece = { ...shape, id: newShapeId, joints: [cId, j0, j1], sweep: true };
  state.shapes.push(piece);
  if (Array.isArray(state.constraints)) {
    dropConstraints(state, heldOn);
    splitArcConstraints(state, shape, piece, g, cut0.u, cut1.u);
    state.constraints.push(...arcStructuralConstraints(shape), ...arcStructuralConstraints(piece));
    for (const [id, cut] of minted) for (const cutterId of cut.cutters) applySnapConstraint(state, id, onShapeSnap(cutterId, cut.pt));
  }
  return { newShapeId, joints: [j0, j1] };
}

/** TASK 1018: THE change of a circle into an arc (Trim and Break): the same shape (its id, so every constraint naming it stays) as the CENTER arc from
 *  `startId` growing in angle to `endId` round its centre. Its radius is then |rim - centre| (the solver reads it there): the stored scalar goes. */
export function circleToArc(shape, startId, endId) {
  shape.type = 'arc';
  shape.subType = 'CENTER';
  shape.joints = [shape.joints[0], startId, endId];
  shape.sweep = true;
  delete shape.radius;
}

/**
 * Find the closest parameter t on a line segment (A→B) to world point p.
 * Returns t in [0, 1].
 *
 * @param {{x,y}} jA - Start joint
 * @param {{x,y}} jB - End joint
 * @param {{x,y}} p  - World click point
 * @returns {number} t
 */
export function lineParamAtPoint(jA, jB, p) {
  const dx = jB.x - jA.x;
  const dy = jB.y - jA.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return 0;
  const t = ((p.x - jA.x) * dx + (p.y - jA.y) * dy) / L2;
  return Math.max(0, Math.min(1, t));
}
