// apps/shaper/src/relief-frame.js — TASK 841: a part's LEVELS follow the part. A region with levels (an STL relief, a Fusion part's `levels`) keeps, with its
// region data (operations-store.js regions[key]), the part's own FRAME:
//   frame = { joints: [[jointId, x, y], ...], at: [a, b, c, d, e, f] }
//     joints  the outline's points in the part's own frame (where they were when the part was sliced: the slicer's coordinates, Y down)
//     at      the placement the stored `levels` are at now (x' = a x + c y + e, y' = b x + d y + f: a rotation and a move, never a scale or a mirror)
// The placement of the part NOW is the rotation + move that best puts its frame points on where those joints are now (a least-squares fit: the outline
// moved, rotated, dragged by the Design tools). followReliefs (run by cut-plan.js followDesign, where the plan is read against a sketch that may have been
// edited since) puts the levels at that placement: a moved outline's levels move with it, exactly, never left behind. Pure data in and out: the region
// entry is REPLACED (undo snapshots share the old one by reference). A region without a frame (a document saved before 841) is left as it is.

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
/** Two placements closer than this (mm, on a unit move of the frame) are the same one: a solve's float noise never re-places the levels. */
const SAME_TOL = 1e-7;

/** The point (x, y) through the placement m. */
export const placePoint = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** m after n (n first). */
export const composePlacement = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
/** The inverse of a rotation + move. */
export function invertPlacement(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
/** The rotation by `angle` (radians) about (0, 0), then the move (dx, dy). */
export const placement = (angle, dx, dy) => [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), dx, dy];

/**
 * fitPlacement(pairs) -> the rotation + move that best puts each [x, y] on its [X, Y] (pairs: [[x, y, X, Y], ...], at least 2 apart), the 2D least-squares
 * fit (centroids, then the angle of the summed cross / dot products); null when the points do not tell it (fewer than 2 distinct ones).
 */
export function fitPlacement(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  let px = 0, py = 0, qx = 0, qy = 0;
  for (const [x, y, X, Y] of pairs) { px += x; py += y; qx += X; qy += Y; }
  px /= n; py /= n; qx /= n; qy /= n;
  let dot = 0, cross = 0, spread = 0;
  for (const [x, y, X, Y] of pairs) {
    const ax = x - px, ay = y - py, bx = X - qx, by = Y - qy;
    dot += ax * bx + ay * by; cross += ax * by - ay * bx; spread += ax * ax + ay * ay;
  }
  if (!(spread > 1e-18)) return null;
  const t = Math.atan2(cross, dot), c = Math.cos(t), s = Math.sin(t);
  return [c, s, -s, c, qx - (c * px - s * py), qy - (s * px + c * py)];
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** The levels ([{ z, loops: [flat [x0, y0, ...]] }], #core/stepped-cut.js readLevels) through the placement m: NEW arrays (rounded like readLevels'). */
export function placeLevels(levels, m) {
  return levels.map((lv) => ({ ...lv, loops: lv.loops.map((flat) => {
    const out = new Array(flat.length);
    for (let i = 0; i < flat.length; i += 2) { const [x, y] = placePoint(m, flat[i], flat[i + 1]); out[i] = r6(x); out[i + 1] = r6(y); }
    return out;
  }) }));
}

/** The frame of an outline made of `shapeIds`: each of their joints at its point in the part's own frame (`localOf`: joint id -> [x, y]), placed at `at`. */
export function frameOf(state, shapeIds, localOf, at = IDENTITY) {
  const ids = new Set(shapeIds), seen = new Set(), joints = [];
  for (const s of state.shapes) {
    if (!ids.has(s.id)) continue;
    for (const jid of (s.joints || [])) {
      const p = localOf.get(jid);
      if (!p || seen.has(jid)) continue;
      seen.add(jid);
      joints.push([jid, p[0], p[1]]);
    }
  }
  return { joints, at: [...at] };
}

/** Where the part of `frame` is NOW (its joints as they are in `state`), or null when fewer than 2 of its joints are left. */
export function placementNow(state, frame) {
  if (!frame || !Array.isArray(frame.joints)) return null;
  const pairs = [];
  for (const [id, x, y] of frame.joints) { const j = state.joints.get(id); if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) pairs.push([x, y, j.x, j.y]); }
  return fitPlacement(pairs);
}

const samePlacement = (m, n) => Array.isArray(n) && n.length === 6 && m.every((v, i) => Math.abs(v - n[i]) <= SAME_TOL);

/**
 * followReliefs(state, { keys, regionOf, setRegion }) -> the number of regions whose levels moved: every region with levels and a frame whose part is no
 * longer where its levels are (placementNow differs from frame.at) gets its levels at the new placement (placeLevels of the move from `at` to now) and the
 * new `at`. The store's own accessors are passed in (cut-plan.js: operations-store.js regionKeys / regionOf / setRegion).
 */
export function followReliefs(state, { keys, regionOf, setRegion }) {
  let moved = 0;
  for (const key of keys) {
    const reg = regionOf(key);
    if (!reg || !reg.frame || !Array.isArray(reg.levels) || !reg.levels.length) continue;
    const now = placementNow(state, reg.frame);
    if (!now || samePlacement(now, reg.frame.at)) continue;
    const step = composePlacement(now, invertPlacement(reg.frame.at));
    setRegion(key, { ...reg, levels: placeLevels(reg.levels, step), frame: { ...reg.frame, at: now } });
    moved++;
  }
  return moved;
}
