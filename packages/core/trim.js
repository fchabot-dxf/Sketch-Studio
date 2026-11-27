// packages/core/trim.js — TRACE-1; TASK 1018: lines, arcs and circles, cut by lines, arcs and circles.
// Pure geometry operation: remove the portion of a curve that the user clicked between its nearest two cuts (#core/curve-cuts.js: where the
// active sketch's other lines, arcs and circles cross it).
//
// trimShape(state, shapeId, clickPoint) → TrimResult | null
//
// Algorithm:
//   1. The cuts on the target (curveCuts), sorted along it; a line's or an arc's ends bound it too, a circle has no ends.
//   2. The piece the click falls in (trimPieceAt, also what the Trim tool's hover shows).
//   3. Remove the piece:
//      - the whole curve (no cut around it; a circle cut fewer than twice): delete the shape, through THE delete rule.
//      - a line / an arc: a leading / trailing piece moves that end to the cut; an interior piece splits it in two (the middle is never made).
//      - a circle: becomes the ARC that remains (TASK 1018, the same shape and id: its diameter dimension stays on it, as a diameter).
//   4. Each cut end is bound to its cutter(s) (UX-11), and the trimmed curve's constraints follow its kept pieces (keepLineConstraints,
//      keepArcConstraints): what named the removed part goes, through THE delete rule.
//   5. Return ids of added/removed shapes for undo support.
//
// No DOM. Pure function on state.joints / state.shapes.

import { inActiveSketch } from './sketch-model.js';
import { removeGeometry } from './delete-manager.js';
import { applySnapConstraint, onShapeSnap } from './snap-constraints.js';
import { transferOrientationConstraints, lineParamAtPoint, arcOwnEquals, dropConstraints, splitArcConstraints, circleToArc } from './break.js';
import { arcStructuralConstraints } from './shapes.js';
import { curveGeom, curveParamAt, curvePointAt, curveCuts, boundsAround, curvePiece, CUT_EPS } from './curve-cuts.js';
import { CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from './constants.js';

const EPS = CUT_EPS; // parameter epsilon (avoid exact endpoints)

/**
 * @typedef {object} TrimResult
 * @property {string[]} removed  - Shape IDs that were deleted
 * @property {string[]} added    - Shape IDs that were added
 */

/**
 * THE piece of curve `shapeId` a trim click at `clickPt` removes: { target, g, b0, b1, whole } (b0 / b1 the bounds around the click, each
 * { u, pt, cutters }; for a circle b0 -> b1 grows in angle and may wrap), or null (no line, arc or circle; another sketch's curve).
 */
export function trimPieceAt(state, shapeId, clickPt) {
  const target = (state.shapes || []).find((s) => s && s.id === shapeId);
  if (!target || !inActiveSketch(state, target)) return null; // Fusion edits only the active sketch (task 659): nothing is written
  const g = curveGeom(state, target);
  if (!g) return null;
  const around = boundsAround(g, curveCuts(state, target), curveParamAt(g, clickPt));
  if (!around) return g.kind === 'circle' ? { target, g, b0: null, b1: null, whole: true } : null;
  const [b0, b1] = around;
  return { target, g, b0, b1, whole: g.kind !== 'circle' && b0.u <= EPS && b1.u >= 1 - EPS };
}

/** What a trim click at `clickPt` would remove, as the Trim tool's hover draws it (#core/curve-cuts.js curvePiece), or null. */
export function trimPreview(state, shapeId, clickPt) {
  const p = trimPieceAt(state, shapeId, clickPt);
  if (!p) return null;
  return p.whole ? curvePiece(p.g, 0, 1, p.g.kind === 'circle') : curvePiece(p.g, p.b0.u, p.b1.u);
}

/**
 * Trim the clicked portion of curve `shapeId` (a line, an arc or a circle) at its nearest cuts.
 *
 * @param {object}  state      - #core sketch state
 * @param {string}  shapeId   - Target curve shape ID
 * @param {{x,y}}   clickPt   - World-space click point
 * @returns {TrimResult | null}
 */
export function trimShape(state, shapeId, clickPt) {
  const piece = trimPieceAt(state, shapeId, clickPt);
  if (!piece) return null;
  if (piece.whole) {
    // Entire curve is the piece → delete the whole shape, through THE delete rule (task 709: its points, constraints and dimensions go with it)
    removeGeometry(state, [shapeId]);
    return { removed: [shapeId], added: [] };
  }
  if (piece.g.kind === 'line') return trimLine(state, piece);
  if (piece.g.kind === 'arc') return trimArc(state, piece);
  return trimCircle(state, piece);
}

// the cut end `jointId` at `pt` is held on every curve that cuts there (UX-11)
const bindCutters = (state, jointId, cutters, pt) => {
  for (const cutterId of cutters) applySnapConstraint(state, jointId, onShapeSnap(cutterId, pt));
};
const newJointAt = (state, pt) => {
  const id = state.genJ();
  state.joints.set(id, { x: pt.x, y: pt.y });
  return id;
};

function trimLine(state, { target, g, b0, b1 }) {
  const shapeId = target.id;
  const [aId, bId] = target.joints;
  const jA = g.a, jB = g.b;
  const t0 = b0.u;
  const t1 = b1.u;
  const removed = [];
  const added   = [];

  if (t0 <= EPS) {
    // Leading interval [0, t1] → truncate start to t1
    const newPt = curvePointAt(g, t1);
    const mId = newJointAt(state, newPt);
    target.joints = [mId, bId];
    keepLineConstraints(state, shapeId, [aId, bId], [target.joints]);
    bindCutters(state, mId, b1.cutters, newPt);
    added.push(shapeId);

  } else if (t1 >= 1 - EPS) {
    // Trailing interval [t0, 1] → truncate end to t0
    const newPt = curvePointAt(g, t0);
    const mId = newJointAt(state, newPt);
    target.joints = [aId, mId];
    keepLineConstraints(state, shapeId, [aId, bId], [target.joints]);
    bindCutters(state, mId, b0.cutters, newPt);
    added.push(shapeId);

  } else {
    // Interior interval [t0, t1]:
    //   Original: A--------B
    //   Result:   A----M0  M1----B   (middle segment deleted)
    const pt0 = curvePointAt(g, t0);
    const pt1 = curvePointAt(g, t1);

    // Mint two new boundary joints
    const m0Id = newJointAt(state, pt0);
    const m1Id = newJointAt(state, pt1);

    // Build the right-hand segment M1→B
    const rightId = 'Ltrm_' + m1Id + '_' + bId;
    state.shapes.push({ ...target, id: rightId, joints: [m1Id, bId] });
    added.push(rightId);

    // Truncate original to A→M0
    target.joints = [aId, m0Id];
    keepLineConstraints(state, shapeId, [aId, bId], [target.joints, [m1Id, bId]], { targetId: shapeId, rightId, jA, jB, t1 });
    bindCutters(state, m0Id, b0.cutters, pt0);
    bindCutters(state, m1Id, b1.cutters, pt1);
    added.push(shapeId);

    // The interval [M0→M1] is implicitly gone (we never create it)
    removed.push('(interval ' + m0Id + '→' + m1Id + ')');
  }

  return { removed, added };
}

// TASK 1018: an arc's leading / trailing piece moves that rim to the cut; an interior piece splits it into two arcs round the same centre
function trimArc(state, { target, g, b0, b1 }) {
  const shapeId = target.id;
  const [cId, sId, eId] = target.joints;
  const sweep = g.dir > 0; // the kept arcs keep its turning sense, stored explicitly like every arc (NEW-11)
  const removed = [];
  const added = [];
  if (b0.u <= EPS) {
    const pt = curvePointAt(g, b1.u), mId = newJointAt(state, pt);
    target.joints = [cId, mId, eId];
    target.sweep = sweep;
    keepArcConstraints(state, target, [sId, eId], [target]);
    bindCutters(state, mId, b1.cutters, pt);
    added.push(shapeId);
  } else if (b1.u >= 1 - EPS) {
    const pt = curvePointAt(g, b0.u), mId = newJointAt(state, pt);
    target.joints = [cId, sId, mId];
    target.sweep = sweep;
    keepArcConstraints(state, target, [sId, eId], [target]);
    bindCutters(state, mId, b0.cutters, pt);
    added.push(shapeId);
  } else {
    const pt0 = curvePointAt(g, b0.u), pt1 = curvePointAt(g, b1.u);
    const m0Id = newJointAt(state, pt0), m1Id = newJointAt(state, pt1);
    const rightId = 'Atrm_' + m1Id + '_' + eId;
    const right = { ...target, id: rightId, joints: [cId, m1Id, eId], sweep };
    state.shapes.push(right);
    added.push(rightId);
    target.joints = [cId, sId, m0Id];
    target.sweep = sweep;
    splitArcConstraints(state, target, right, g, b1.u, 1);
    keepArcConstraints(state, target, [sId, eId], [target, right]);
    bindCutters(state, m0Id, b0.cutters, pt0);
    bindCutters(state, m1Id, b1.cutters, pt1);
    added.push(shapeId);
    removed.push('(interval ' + m0Id + '→' + m1Id + ')');
  }
  return { removed, added };
}

// TASK 1018 (R1-12): a circle cut at b0 and b1 loses the part from b0 to b1 (growing in angle) and becomes the arc from b1 round to b0, the same
// shape: every constraint naming it (its diameter dimension, a diameter on the arc as Fusion keeps it; concentric; equal; tangent) stays.
function trimCircle(state, { target, b0, b1 }) {
  const j0 = newJointAt(state, b0.pt), j1 = newJointAt(state, b1.pt);
  circleToArc(target, j1, j0);
  keepArcConstraints(state, target, [], [target]);
  bindCutters(state, j0, b0.cutters, b0.pt);
  bindCutters(state, j1, b1.cutters, b1.pt);
  return { removed: [], added: [target.id] };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// The ends no surviving curve uses (the origin always stays)
const goneEnds = (state, ends) => {
  const used = new Set(state.shapes.flatMap((sh) => sh.joints || []));
  return ends.filter((j) => !used.has(j) && j !== ORIGIN_JOINT_ID);
};

/**
 * TASK 789 / UX-11: what the trimmed line's constraints become. `pair` = the line's end pair before the trim, `pieces` = the end pairs of the
 * pieces that stay. The line's ORIENTATION (horizontal / vertical) transfers to every kept piece via transferOrientationConstraints, and its
 * MIRROR (TASK 1018 R2-03) via transferMirrorPairs. Both an end that no surviving curve uses (`gone`) AND any constraints / dimensions on the
 * trimmed span `pair` itself (e.g. a shared-corner edge's width dim) go through THE delete rule (`removeGeometry`), so no dimension across a
 * removed span is left behind.
 */
function keepLineConstraints(state, lineId, pair, pieces, rightMeta = null) {
  transferOrientationConstraints(state, pair, pieces);
  if (rightMeta && Array.isArray(state.constraints)) {
    for (const c of state.constraints) {
      if (c && c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.shape === rightMeta.targetId && c.joint) {
        const pj = state.joints.get(c.joint);
        if (pj && lineParamAtPoint(rightMeta.jA, rightMeta.jB, pj) >= rightMeta.t1 - EPS) c.shape = rightMeta.rightId;
      }
    }
  }
  const gone = goneEnds(state, pair);
  transferMirrorPairs(state, lineId, gone, pair.filter((j) => !gone.includes(j)));
  removeGeometry(state, [], gone, { trimmedPairs: [pair] });
}

/**
 * TASK 1018 (R2-03): Mirror ties a mirrored line to its original by its two END pairs (point symmetric { joints: [p, p'], line }: Fusion's,
 * #core/mirror.js), nothing else. When Trim removes one of those ends, its pair would go with it and leave the copy free to turn. The two
 * lines WERE mirror images (both end pairs about the same line), so they stay mirror images AS LINES: the removed end's pair becomes the line
 * form { shapes: [this line, the other], line } (#core/symmetric.js: the infinite lines mirror; where each segment ends stays free, so each
 * keeps its own cut). Only when the other line's other end is the mirror of this line's kept end: a lone pair names no line, and goes as before.
 */
function transferMirrorPairs(state, lineId, gone, kept) {
  if (!gone.length || !kept.length || !Array.isArray(state.constraints)) return;
  const isPair = (c) => c && c.type === CONSTRAINT_TYPES.SYMMETRIC && c.line && Array.isArray(c.joints) && c.joints.length === 2;
  const pairOf = (p, q, line) => state.constraints.some((c) => isPair(c) && c.line === line && c.joints.includes(p) && c.joints.includes(q));
  const linesForm = (s1, s2, line) => state.constraints.some((c) => c && c.type === CONSTRAINT_TYPES.SYMMETRIC && c.line === line
    && Array.isArray(c.shapes) && c.shapes.includes(s1) && c.shapes.includes(s2));
  for (const c of state.constraints.filter(isPair)) {
    const g = gone.find((j) => c.joints.includes(j));
    if (!g) continue;
    const q = c.joints.find((j) => j !== g);
    const other = state.shapes.find((s) => s && s.type === 'line' && s.id !== lineId && Array.isArray(s.joints) && s.joints.includes(q));
    if (!other) continue;
    const q2 = other.joints.find((j) => j !== q);
    if (!kept.some((k) => pairOf(k, q2, c.line)) || linesForm(lineId, other.id, c.line)) continue;
    state.constraints.push({ type: CONSTRAINT_TYPES.SYMMETRIC, shapes: [lineId, other.id], line: c.line });
  }
}

/**
 * TASK 1018: what a trimmed arc's (or a circle turned arc's) constraints become. `rims` = its two rims before the trim (none for a circle),
 * `pieces` = the arcs that stay. Its own structural equal (#core/shapes.js) is made again for each piece on the piece's rims; a midpoint of the
 * arc goes (the sweep it halved is gone); a rim no surviving curve uses goes through THE delete rule, with every constraint and dimension on it.
 */
function keepArcConstraints(state, target, rims, pieces) {
  if (Array.isArray(state.constraints)) {
    dropConstraints(state, [
      ...arcOwnEquals(state, target.joints[0], rims),
      ...state.constraints.filter((c) => c && c.type === CONSTRAINT_TYPES.MIDPOINT && c.joint && c.shape === target.id),
    ]);
  }
  removeGeometry(state, [], goneEnds(state, rims));
  if (Array.isArray(state.constraints)) for (const p of pieces) state.constraints.push(...arcStructuralConstraints(p));
}
