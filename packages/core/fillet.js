// packages/core/fillet.js — 2D Fillet (Corner Rounding)
// Pure geometry & topological constraint operations for corner rounding.
// Replaces a sharp corner between two lines with a smooth, tangent circular arc.
//
// No DOM. Pure function on state.joints / state.shapes / state.constraints.

import { makeArc } from './shapes.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { removeOrphanJoints } from './joints.js';
import { parse as parseUnit } from './units.js';

/** A trimmed line shorter than this (world mm) counts as collapsed. */
export const COLLAPSE_TOL = 1e-3;

/** Default fillet radius in WORLD mm (1 world unit = 1 mm): 5 mm, or 1/4" = 6.35 mm for an inch document. */
export function defaultFilletRadius(docUnit = 'mm') {
  return docUnit === 'in' ? 6.35 : 5;
}

/** Parse a typed radius in the document unit (a suffix overrides) -> world mm, or null if invalid / <= 0. */
export function parseFilletRadius(str, docUnit = 'mm') {
  const v = parseUnit(str, docUnit);
  return (v != null && v > 0) ? v : null;
}

/**
 * Get all joint IDs that form a coincident cluster with startJointId.
 * @param {object} state
 * @param {string} startJointId
 * @returns {Set<string>}
 */
export function getCoincidentCluster(state, startJointId) {
  const cluster = new Set([startJointId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of (state.constraints || [])) {
      if (c && c.type === CONSTRAINT_TYPES.COINCIDENT && Array.isArray(c.joints)) {
        if (c.joints.some(j => cluster.has(j))) {
          for (const j of c.joints) {
            if (!cluster.has(j)) {
              cluster.add(j);
              changed = true;
            }
          }
        }
      }
    }
    if (state.joints) {
      for (const cid of Array.from(cluster)) {
        const cPt = state.joints.get(cid);
        if (!cPt || typeof cPt.x !== 'number') continue;
        for (const [jid, jPt] of state.joints.entries()) {
          if (!cluster.has(jid) && jPt && typeof jPt.x === 'number') {
            if (Math.hypot(jPt.x - cPt.x, jPt.y - cPt.y) < 1e-4) {
              cluster.add(jid);
              changed = true;
            }
          }
        }
      }
    }
  }
  return cluster;
}

/**
 * Find corner info at a specific joint.
 * A valid corner has exactly 2 lines meeting at the joint's coincident cluster.
 * @param {object} state
 * @param {string} jointId
 * @returns {object|null}
 */
export function findCornerAtJoint(state, jointId) {
  if (!state || !state.joints || !state.joints.has(jointId)) return null;
  const cJoint = state.joints.get(jointId);
  const cluster = getCoincidentCluster(state, jointId);

  const incidentLines = [];
  for (const s of (state.shapes || [])) {
    if (s && s.type === 'line' && Array.isArray(s.joints) && s.joints.length >= 2) {
      const in0 = cluster.has(s.joints[0]);
      const in1 = cluster.has(s.joints[1]);
      if (in0 && !in1) {
        incidentLines.push({ shape: s, cornerJoint: s.joints[0], otherJoint: s.joints[1], cornerIdx: 0 });
      } else if (in1 && !in0) {
        incidentLines.push({ shape: s, cornerJoint: s.joints[1], otherJoint: s.joints[0], cornerIdx: 1 });
      }
    }
  }

  if (incidentLines.length !== 2) return null;

  const [lineA, lineB] = incidentLines;
  const pA = state.joints.get(lineA.otherJoint);
  const pB = state.joints.get(lineB.otherJoint);
  if (!pA || !pB) return null;

  return {
    cornerJointId: jointId,
    cluster,
    cornerPt: { x: cJoint.x, y: cJoint.y },
    lineA,
    lineB,
    pA: { x: pA.x, y: pA.y },
    pB: { x: pB.x, y: pB.y }
  };
}

/**
 * Find a corner near the given world point (within tolerance).
 * @param {object} state
 * @param {{x: number, y: number}} worldPt
 * @param {number} tolerance
 * @returns {object|null}
 */
export function findCornerAtPoint(state, worldPt, tolerance = 15) {
  if (!state || !state.joints || !worldPt) return null;

  let bestCorner = null;
  let bestDist = tolerance;

  for (const [jid, j] of state.joints.entries()) {
    if (!j || typeof j.x !== 'number' || typeof j.y !== 'number') continue;
    const d = Math.hypot(worldPt.x - j.x, worldPt.y - j.y);
    if (d < bestDist) {
      const corner = findCornerAtJoint(state, jid);
      if (corner) {
        bestDist = d;
        bestCorner = corner;
      }
    }
  }

  return bestCorner;
}

/**
 * Why did a fillet click near `worldPt` do nothing? Returns a user-facing message, or null when the
 * click was nowhere near a joint (empty space needs no toast). Call only after findCornerAtPoint failed.
 */
export function diagnoseNoFillet(state, worldPt, tolerance = 15) {
  if (!state || !state.joints || !worldPt) return null;
  let best = null, bestDist = tolerance;
  for (const [jid, j] of state.joints.entries()) {
    if (!j || typeof j.x !== 'number') continue;
    const d = Math.hypot(worldPt.x - j.x, worldPt.y - j.y);
    if (d < bestDist) { bestDist = d; best = jid; }
  }
  if (!best) return null;
  const cluster = getCoincidentCluster(state, best);
  const touching = (state.shapes || []).filter(sh => sh && Array.isArray(sh.joints) && sh.joints.some(j => cluster.has(j)));
  const arcs = touching.filter(sh => sh.type === 'arc');
  if (arcs.some(a => (state.constraints || []).some(c => c && c.type === 'tangent' && c.circle === a.id))) {
    return 'This corner is already filleted';
  }
  const lines = touching.filter(sh => sh.type === 'line');
  if (lines.length > 2) return 'Fillet needs a corner between exactly two lines (T-junction)';
  return 'Fillet needs a corner between two lines';
}

/**
 * Compute the fillet geometry (tangent points, arc center, actual radius).
 * @param {{x: number, y: number}} pA - Endpoint of line A away from corner
 * @param {{x: number, y: number}} cornerPt - Corner vertex
 * @param {{x: number, y: number}} pB - Endpoint of line B away from corner
 * @param {number} requestedRadius - Target fillet radius
 * @returns {object}
 */
export function calculateFilletGeometry(pA, cornerPt, pB, requestedRadius = 5) {
  const vA = { x: pA.x - cornerPt.x, y: pA.y - cornerPt.y };
  const vB = { x: pB.x - cornerPt.x, y: pB.y - cornerPt.y };
  const lenA = Math.hypot(vA.x, vA.y);
  const lenB = Math.hypot(vB.x, vB.y);

  if (lenA < 1e-4 || lenB < 1e-4) {
    return { valid: false, reason: 'Line segments are too short to fillet' };
  }

  const uA = { x: vA.x / lenA, y: vA.y / lenA };
  const uB = { x: vB.x / lenB, y: vB.y / lenB };

  const dot = Math.max(-1, Math.min(1, uA.x * uB.x + uA.y * uB.y));
  if (Math.abs(dot) > 0.9999) {
    return { valid: false, reason: 'Lines are collinear (angle ~ 0° or 180°)' };
  }

  const theta = Math.acos(dot);
  const halfAngle = theta / 2;
  const sinHalf = Math.sin(halfAngle);
  const tanHalf = Math.tan(halfAngle);

  let radius = Math.max(0.1, requestedRadius);
  let d = radius / tanHalf;

  // NO clamp (owner ruling): an oversized radius is applied as asked; a tangent point may land past a line's far
  // end (that line then runs "backwards", like Fusion). The ONE refusal is the singular value where a trimmed
  // line would collapse to exactly zero length -- there the constraints are degenerate and the solver would
  // report success with a wrong answer (verified in Node, turn 403).
  if (Math.abs(d - lenA) < COLLAPSE_TOL || Math.abs(d - lenB) < COLLAPSE_TOL) {
    return { valid: false, reason: `R = ${radius.toFixed(2)} would collapse a line to zero length; use a slightly different radius` };
  }

  const tA = { x: cornerPt.x + d * uA.x, y: cornerPt.y + d * uA.y };
  const tB = { x: cornerPt.x + d * uB.x, y: cornerPt.y + d * uB.y };

  const bisector = { x: uA.x + uB.x, y: uA.y + uB.y };
  const bLen = Math.hypot(bisector.x, bisector.y) || 1;
  const uBis = { x: bisector.x / bLen, y: bisector.y / bLen };
  const distCenter = radius / sinHalf;
  const centerPt = { x: cornerPt.x + distCenter * uBis.x, y: cornerPt.y + distCenter * uBis.y };

  return {
    valid: true,
    radius,
    d,
    tA,
    tB,
    centerPt,
    theta,
    halfAngle
  };
}

/**
 * Apply a fillet to a corner.
 * Mutates state, adds the tangent arc shape, updates line endpoints,
 * preserves or adjusts existing constraints, and executes a solver pass.
 *
 * @param {object} state - Application sketch state
 * @param {object} cornerInfo - From findCornerAtJoint or findCornerAtPoint
 * @param {number} [radius=5] - Desired fillet radius
 * @returns {object|null}
 */
export function applyFillet(state, cornerInfo, radius = 5) {
  if (!state || !cornerInfo) return null;

  const geom = calculateFilletGeometry(cornerInfo.pA, cornerInfo.cornerPt, cornerInfo.pB, radius);
  if (!geom.valid) return { success: false, reason: geom.reason };

  // History is the caller's (tool layer) job, like every other tool -- do NOT saveState here, or one fillet takes two undo steps.

  const { joints, shapes, constraints } = state;
  const { cluster, lineA, lineB } = cornerInfo;
  const { tA, tB, centerPt, d } = geom;
  const cornerPt0 = { x: cornerInfo.cornerPt.x, y: cornerInfo.cornerPt.y };
  const finalRadius = geom.radius;

  // Helper to generate joint IDs matching existing scheme
  let counter = 1;
  const genJ = () => {
    let id;
    do { id = 'j_fillet_' + Date.now().toString(36) + '_' + (counter++); } while (joints.has(id));
    return id;
  };

  const jCenter = genJ();
  const jTA = genJ();
  const jTB = genJ();
  const jV = genJ(); // virtual sharp: the corner as it was (see below)

  joints.set(jCenter, { x: centerPt.x, y: centerPt.y, fixed: false });
  joints.set(jTA, { x: tA.x, y: tA.y, fixed: false });
  joints.set(jTB, { x: tB.x, y: tB.y, fixed: false });
  // V: a bare joint (NO shape) left at the sharp corner. Held on both trimmed lines by `mutual` pointOnLine so it
  // follows them when the radius changes; overall dimensions attach to it. Not a shape => loops/export ignore it.
  joints.set(jV, { x: cornerPt0.x, y: cornerPt0.y, fixed: false, virtualSharp: true });

  // Update line endpoint joints to the new tangent points
  lineA.shape.joints[lineA.cornerIdx] = jTA;
  lineB.shape.joints[lineB.cornerIdx] = jTB;

  // Update constraints referencing the corner joints
  if (Array.isArray(constraints)) {
    for (let i = constraints.length - 1; i >= 0; i--) {
      const c = constraints[i];
      if (!c) continue;

      // Remove internal coincident constraints of the corner cluster
      if (c.type === CONSTRAINT_TYPES.COINCIDENT && Array.isArray(c.joints)) {
        if (c.joints.every(j => cluster.has(j))) {
          constraints.splice(i, 1);
          continue;
        }
      }

      // MEASUREMENT constraints (a joint-pair DISTANCE, a joint-form EQUAL) keep meaning the SHARP corner: any
      // joint of the corner cluster is re-linked to the virtual-sharp joint V and the ORIGINAL value is kept,
      // so editing the fillet radius never changes an overall dimension (Fusion's behaviour).
      const isMeasure = !c.isRadius && (
        (c.type === CONSTRAINT_TYPES.DISTANCE && Array.isArray(c.joints) && c.joints.length >= 2) ||
        (c.type === CONSTRAINT_TYPES.EQUAL && Array.isArray(c.joints) && c.joints.length >= 4));
      if (isMeasure) {
        for (let k = 0; k < c.joints.length; k++) if (cluster.has(c.joints[k])) c.joints[k] = jV;
        continue;
      }

      // DIRECTIONAL constraints (H/V, parallel, perpendicular, angle, ...) keep relinking to the tangent joints:
      // the line survives (trimmed) and keeps its direction.
      if (Array.isArray(c.joints)) {
        for (let k = 0; k < c.joints.length; k++) {
          if (c.joints[k] === lineA.cornerJoint) c.joints[k] = jTA;
          else if (c.joints[k] === lineB.cornerJoint) c.joints[k] = jTB;
        }
      }

      // A shape-based LENGTH dimension of a trimmed line really does get shorter by d.
      if (c.type === CONSTRAINT_TYPES.DISTANCE && typeof c.value === 'number' && !c.isRadius) {
        if (c.shape === lineA.shape.id) c.value = Math.max(0.1, c.value - d);
        if (c.shape === lineB.shape.id) c.value = Math.max(0.1, c.value - d);
      }
    }
  }

  // Create the arc shape
  const { shapes: arcShapes, constraints: arcConstraints } = makeArc(joints, jCenter, jTA, jTB, 'CENTER');
  const arcShape = arcShapes[0];
  arcShape.filletSharp = jV; // data on the arc (survives undo/save): which joint is its virtual sharp corner
  // NOTE: no arcShape.radius -- the radius dimension below is the source of truth; a frozen scalar would go stale on edit.
  shapes.push(arcShape);
  constraints.push(...arcConstraints);

  // V is held on both trimmed lines. Pushed BEFORE removeOrphanJoints, which would otherwise delete V (it is
  // referenced by constraints only, not by a shape).
  constraints.push({ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: jV, shape: lineA.shape.id, mutual: true });
  constraints.push({ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: jV, shape: lineB.shape.id, mutual: true });

  // Delete the old corner cluster joints
  for (const jid of cluster) {
    joints.delete(jid);
  }
  removeOrphanJoints(state);

  // Add geometric tangent constraints between the lines and the arc
  constraints.push({ type: 'tangent', line: lineA.shape.id, circle: arcShape.id });
  constraints.push({ type: 'tangent', line: lineB.shape.id, circle: arcShape.id });

  // Driving RADIUS dimension on the new arc -- same shape the Dimension tool makes for an arc
  // (distance + isRadius + shape), so the fillet is a live, editable radius.
  const radiusConstraint = {
    type: CONSTRAINT_TYPES.DISTANCE,
    shape: arcShape.id,
    value: finalRadius,
    isRadius: true,
    isDriven: false,
    offset: Math.max(finalRadius * 0.6, 6)
  };
  constraints.push(radiusConstraint);

  // Solve to ensure mathematical consistency
  try {
    if (state.engine && typeof state.engine.solve === 'function') {
      state.engine.solve(200);
    }
  } catch (_) {}

  return {
    success: true,
    arc: arcShape,
    radiusConstraint,
    radius: finalRadius,
    requestedRadius: radius,
    centerPt,
    tA,
    tB,
    joints: [jCenter, jTA, jTB],
    virtualSharp: jV
  };
}


// ---- radius edit support for an existing fillet (arc.filletSharp = its virtual-sharp joint V) ----

/** The two trimmed lines of a fillet arc, with their far (non-arc) and rim (arc) joints. */
function filletLines(state, arc) {
  const out = [];
  for (const c of (state.constraints || [])) {
    if (!c || c.type !== CONSTRAINT_TYPES.TANGENT || c.circle !== arc.id || !c.line) continue;
    const line = (state.shapes || []).find(sh => sh && sh.id === c.line);
    if (!line || !Array.isArray(line.joints)) continue;
    const rim = line.joints.find(j => arc.joints.includes(j));
    const far = line.joints.find(j => !arc.joints.includes(j));
    if (rim && far) out.push({ line, rim, far });
  }
  return out;
}

/**
 * Place the fillet's centre + two tangent joints at the ANALYTIC positions for `radius` (from V and the two
 * lines' far endpoints), so the solver starts at the answer and only polishes -- it never has to walk a line
 * through zero length. Returns {ok:true} or {ok:false, reason} (collinear / collapse / not a fillet).
 */
export function seedFilletForRadius(state, arc, radius) {
  if (!state || !arc || !arc.filletSharp) return { ok: false, reason: 'not a fillet arc' };
  const V = state.joints.get(arc.filletSharp);
  const ls = filletLines(state, arc);
  if (!V || ls.length !== 2) return { ok: false, reason: 'fillet geometry is incomplete' };
  const [A, B] = ls;
  const geom = calculateFilletGeometry(state.joints.get(A.far), V, state.joints.get(B.far), radius);
  if (!geom.valid) return { ok: false, reason: geom.reason };
  const put = (id, p) => { const j = state.joints.get(id); if (j) { j.x = p.x; j.y = p.y; } };
  put(arc.joints[0], geom.centerPt);
  put(A.rim, geom.tA);
  put(B.rim, geom.tB);
  return { ok: true };
}

/** True if either trimmed line of this fillet has collapsed to (near) zero length. */
export function filletHasCollapsedLine(state, arc) {
  for (const { rim, far } of filletLines(state, arc)) {
    const a = state.joints.get(rim), b = state.joints.get(far);
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < COLLAPSE_TOL) return true;
  }
  return false;
}
