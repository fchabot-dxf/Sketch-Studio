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

  const [aId, bId] = target.joints;
  const jA = state.joints.get(aId);
  const jB = state.joints.get(bId);
  if (!jA || !jB) return null;

  // ── 1. Collect intersection parameters on the target ──────────────────────
  const tVals = [0, 1]; // always include endpoints as interval boundaries

  for (const other of shapes) {
    if (other.id === shapeId || other.type !== 'line') continue;
    const [cId, dId] = other.joints;
    const jC = state.joints.get(cId);
    const jD = state.joints.get(dId);
    if (!jC || !jD) continue;

    const t = segSegParam(jA, jB, jC, jD);
    if (t !== null && t > EPS && t < 1 - EPS) {
      tVals.push(t);
    }
  }

  tVals.sort((a, b) => a - b);

  // ── 2. Find which interval was clicked ────────────────────────────────────
  const tClick = lineParamAtPoint(jA, jB, clickPt);
  let intervalIdx = -1;
  for (let i = 0; i < tVals.length - 1; i++) {
    if (tClick >= tVals[i] && tClick <= tVals[i + 1]) {
      intervalIdx = i;
      break;
    }
  }
  if (intervalIdx < 0) return null;

  const t0 = tVals[intervalIdx];
  const t1 = tVals[intervalIdx + 1];
  const removed = [];
  const added   = [];

  // ── 3. Remove the clicked interval ────────────────────────────────────────
  if (t0 <= EPS && t1 >= 1 - EPS) {
    // Entire line is the interval → delete the whole shape
    removeShape(state, shapeId);
    removed.push(shapeId);

  } else if (t0 <= EPS) {
    // Leading interval [0, t1] → move the start joint to t1
    const newPt = lerpPt(jA, jB, t1);
    jA.x = newPt.x;
    jA.y = newPt.y;
    added.push(shapeId); // mutated in place

  } else if (t1 >= 1 - EPS) {
    // Trailing interval [t0, 1] → move the end joint to t0
    const newPt = lerpPt(jA, jB, t0);
    jB.x = newPt.x;
    jB.y = newPt.y;
    added.push(shapeId); // mutated in place

  } else {
    // Interior interval [t0, t1]:
    //   Original: A--------B
    //   Result:   A----M0  M1----B   (middle segment deleted)
    const pt0 = lerpPt(jA, jB, t0);
    const pt1 = lerpPt(jA, jB, t1);

    // Mint two new boundary joints
    const m0Id = state.genJ?.() ?? ('jtrim0_' + Date.now());
    const m1Id = state.genJ?.() ?? ('jtrim1_' + Date.now() + 1);
    state.joints.set(m0Id, { x: pt0.x, y: pt0.y });
    state.joints.set(m1Id, { x: pt1.x, y: pt1.y });

    // Build the right-hand segment M1→B
    const rightId = 'Ltrm_' + m1Id + '_' + bId;
    state.shapes.push({ ...target, id: rightId, joints: [m1Id, bId] });
    added.push(rightId);

    // Truncate original to A→M0
    target.joints = [aId, m0Id];
    added.push(shapeId);

    // The interval [M0→M1] is implicitly gone (we never create it)
    removed.push('(interval ' + m0Id + '→' + m1Id + ')');
  }

  return { removed, added };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Segment-segment intersection parameter t on segment AB, clamped-checked against CD.
 * Returns t in (0,1) if segments properly intersect, otherwise null.
 */
function segSegParam(jA, jB, jC, jD) {
  const dx1 = jB.x - jA.x, dy1 = jB.y - jA.y;
  const dx2 = jD.x - jC.x, dy2 = jD.y - jC.y;
  const denom = dy2 * dx1 - dx2 * dy1;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((jA.x - jC.x) * dy2 - (jA.y - jC.y) * dx2) / denom;
  const u = ((jA.x - jC.x) * dy1 - (jA.y - jC.y) * dx1) / denom;

  if (t < -EPS || t > 1 + EPS) return null;
  if (u < -EPS || u > 1 + EPS) return null;
  return Math.max(0, Math.min(1, t));
}

function lerpPt(a, b, t) {
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function lineParamAtPoint(jA, jB, p) {
  const dx = jB.x - jA.x, dy = jB.y - jA.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return 0;
  return Math.max(0, Math.min(1, ((p.x - jA.x) * dx + (p.y - jA.y) * dy) / L2));
}

function removeShape(state, id) {
  const idx = (state.shapes || []).findIndex(s => s.id === id);
  if (idx >= 0) state.shapes.splice(idx, 1);
}
