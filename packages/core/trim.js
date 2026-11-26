// packages/core/trim.js — TRACE-1
// Pure geometry operation: remove the portion of a line that the user clicked
// between its nearest two intersections with other lines in the sketch.
//
// trimShape(state, shapeId, clickPoint) → TrimResult | null
//
// Algorithm:
//   1. Find all line shapes that intersect the target line (within its segment bounds).
//   2. Sort intersection parameters t along the target line.
//   3. Identify which interval the click falls in.
//   4. Remove the clicked interval:
//      - If it is an interior interval: break target at both boundary t values,
//        delete the middle segment.
//      - If it is the leading/trailing interval: truncate the endpoint joint.
//   5. Return ids of added/removed shapes for undo support.
//
// No DOM. Pure function on state.joints / state.shapes.

import { getLineIntersection } from './geometry.js';
import { inActiveSketch } from './sketch-model.js';
import { removeGeometry } from './delete-manager.js';
import { applySnapConstraint, onShapeSnap } from './snap-constraints.js';
import { transferOrientationConstraints, lineParamAtPoint } from './break.js';
import { CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from './constants.js';

const EPS = 1e-6; // parameter epsilon (avoid exact endpoints)

/**
 * @typedef {object} TrimResult
 * @property {string[]} removed  - Shape IDs that were deleted
 * @property {string[]} added    - Shape IDs that were added
 */

/**
 * Trim the clicked portion of line `shapeId` at its nearest intersections.
 *
 * @param {object}  state      - #core sketch state
 * @param {string}  shapeId   - Target line shape ID
 * @param {{x,y}}   clickPt   - World-space click point
 * @returns {TrimResult | null}
 */
export function trimShape(state, shapeId, clickPt) {
  const shapes = state.shapes || [];
  const target = shapes.find(s => s.id === shapeId);
  if (!target || target.type !== 'line') return null;
  if (!inActiveSketch(state, target)) return null; // Fusion edits only the active sketch (task 659): nothing is written

  const [aId, bId] = target.joints;
  const jA = state.joints.get(aId);
  const jB = state.joints.get(bId);
  if (!jA || !jB) return null;

  // ── 1. Collect intersection boundaries on the target ─────────────────────
  const bounds = [{ t: 0, cutters: [] }, { t: 1, cutters: [] }]; // always include endpoints as interval boundaries

  for (const other of shapes) {
    if (other.id === shapeId || other.type !== 'line' || !inActiveSketch(state, other)) continue; // cutting boundaries: the active sketch's curves only (task 659)
    const [cId, dId] = other.joints;
    const jC = state.joints.get(cId);
    const jD = state.joints.get(dId);
    if (!jC || !jD) continue;

    const t = segSegParam(jA, jB, jC, jD);
    if (t !== null && t > EPS && t < 1 - EPS) {
      const existing = bounds.find((b) => Math.abs(b.t - t) <= EPS);
      if (existing) existing.cutters.push(other.id);
      else bounds.push({ t, cutters: [other.id] });
    }
  }

  bounds.sort((a, b) => a.t - b.t);

  // ── 2. Find which interval was clicked ────────────────────────────────────
  const tClick = lineParamAtPoint(jA, jB, clickPt);
  let intervalIdx = -1;
  for (let i = 0; i < bounds.length - 1; i++) {
    if (tClick >= bounds[i].t && tClick <= bounds[i + 1].t) {
      intervalIdx = i;
      break;
    }
  }
  if (intervalIdx < 0) return null;

  const b0 = bounds[intervalIdx];
  const b1 = bounds[intervalIdx + 1];
  const t0 = b0.t;
  const t1 = b1.t;
  const removed = [];
  const added   = [];
  const bindCutters = (jointId, cutters, pt) => {
    for (const cutterId of cutters) applySnapConstraint(state, jointId, onShapeSnap(cutterId, pt));
  };

  // ── 3. Remove the clicked interval ────────────────────────────────────────
  if (t0 <= EPS && t1 >= 1 - EPS) {
    // Entire line is the interval → delete the whole shape, through THE delete rule (task 709: its points, constraints and dimensions go with it)
    removeGeometry(state, [shapeId]);
    removed.push(shapeId);

  } else if (t0 <= EPS) {
    // Leading interval [0, t1] → truncate start to t1
    const newPt = lerpPt(jA, jB, t1);
    const mId = state.genJ();
    state.joints.set(mId, { x: newPt.x, y: newPt.y });
    target.joints = [mId, bId];
    keepLineConstraints(state, [aId, bId], [target.joints]);
    bindCutters(mId, b1.cutters, newPt);
    added.push(shapeId);

  } else if (t1 >= 1 - EPS) {
    // Trailing interval [t0, 1] → truncate end to t0
    const newPt = lerpPt(jA, jB, t0);
    const mId = state.genJ();
    state.joints.set(mId, { x: newPt.x, y: newPt.y });
    target.joints = [aId, mId];
    keepLineConstraints(state, [aId, bId], [target.joints]);
    bindCutters(mId, b0.cutters, newPt);
    added.push(shapeId);

  } else {
    // Interior interval [t0, t1]:
    //   Original: A--------B
    //   Result:   A----M0  M1----B   (middle segment deleted)
    const pt0 = lerpPt(jA, jB, t0);
    const pt1 = lerpPt(jA, jB, t1);

    // Mint two new boundary joints
    const m0Id = state.genJ();
    const m1Id = state.genJ();
    state.joints.set(m0Id, { x: pt0.x, y: pt0.y });
    state.joints.set(m1Id, { x: pt1.x, y: pt1.y });

    // Build the right-hand segment M1→B
    const rightId = 'Ltrm_' + m1Id + '_' + bId;
    state.shapes.push({ ...target, id: rightId, joints: [m1Id, bId] });
    added.push(rightId);

    // Truncate original to A→M0
    target.joints = [aId, m0Id];
    keepLineConstraints(state, [aId, bId], [target.joints, [m1Id, bId]], { targetId: shapeId, rightId, jA, jB, t1 });
    bindCutters(m0Id, b0.cutters, pt0);
    bindCutters(m1Id, b1.cutters, pt1);
    added.push(shapeId);

    // The interval [M0→M1] is implicitly gone (we never create it)
    removed.push('(interval ' + m0Id + '→' + m1Id + ')');
  }

  return { removed, added };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * TASK 789 / UX-11: what the trimmed line's constraints become. `pair` = the line's end pair before the trim, `pieces` = the end pairs of the
 * pieces that stay. The line's ORIENTATION (horizontal / vertical) transfers to every kept piece via transferOrientationConstraints. Both an end
 * that no surviving curve uses (`gone`) AND any constraints / dimensions on the trimmed span `pair` itself (e.g. a shared-corner edge's width dim)
 * go through THE delete rule (`removeGeometry`), so no dimension across a removed span is left behind.
 */
function keepLineConstraints(state, pair, pieces, rightMeta = null) {
  transferOrientationConstraints(state, pair, pieces);
  if (rightMeta && Array.isArray(state.constraints)) {
    for (const c of state.constraints) {
      if (c && c.type === CONSTRAINT_TYPES.POINT_ON_LINE && c.shape === rightMeta.targetId && c.joint) {
        const pj = state.joints.get(c.joint);
        if (pj && lineParamAtPoint(rightMeta.jA, rightMeta.jB, pj) >= rightMeta.t1 - EPS) c.shape = rightMeta.rightId;
      }
    }
  }
  const used = new Set(state.shapes.flatMap((sh) => sh.joints || []));
  const gone = pair.filter((j) => !used.has(j) && j !== ORIGIN_JOINT_ID);
  removeGeometry(state, [], gone, { trimmedPairs: [pair] });
}

/**
 * Segment-segment intersection parameter t on segment AB, clamped-checked against CD.
 * Returns t in (0,1) if segments properly intersect, otherwise null.
 */
function segSegParam(jA, jB, jC, jD) {
  const dx1 = jB.x - jA.x, dy1 = jB.y - jA.y;
  const dx2 = jD.x - jC.x, dy2 = jD.y - jC.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((jC.x - jA.x) * dy2 - (jC.y - jA.y) * dx2) / denom;
  const u = ((jC.x - jA.x) * dy1 - (jC.y - jA.y) * dx1) / denom;

  if (t < -EPS || t > 1 + EPS) return null;
  if (u < -EPS || u > 1 + EPS) return null;
  return Math.max(0, Math.min(1, t));
}

function lerpPt(a, b, t) {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

