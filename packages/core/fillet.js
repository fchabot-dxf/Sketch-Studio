// packages/core/fillet.js — 2D Fillet (Corner Rounding)
// Pure geometry & topological constraint operations for corner rounding.
// Replaces a sharp corner between two lines with a smooth, tangent circular arc.
//
// No DOM. Pure function on state.joints / state.shapes / state.constraints.

import { makeArc } from './shapes.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { removeOrphanJoints } from './joints.js';

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

  // Clamp if fillet tangent extends past either line segment
  const maxD = Math.min(lenA, lenB) * 0.95;
  if (d > maxD) {
    d = maxD;
    radius = d * tanHalf;
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
  if (!geom.valid) return null;

  try { state.saveState?.(); } catch (_) {}

  const { joints, shapes, constraints } = state;
  const { cluster, lineA, lineB } = cornerInfo;
  const { tA, tB, centerPt, d } = geom;
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

  joints.set(jCenter, { x: centerPt.x, y: centerPt.y, fixed: false });
  joints.set(jTA, { x: tA.x, y: tA.y, fixed: false });
  joints.set(jTB, { x: tB.x, y: tB.y, fixed: false });

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

      // Re-link constraints targeting the old corner joints to the new tangent joints
      if (Array.isArray(c.joints)) {
        for (let k = 0; k < c.joints.length; k++) {
          if (c.joints[k] === lineA.cornerJoint) c.joints[k] = jTA;
          else if (c.joints[k] === lineB.cornerJoint) c.joints[k] = jTB;
        }
      }

      // Adjust distance/dimension values on lineA or lineB if present
      if (c.type === CONSTRAINT_TYPES.DISTANCE && typeof c.value === 'number') {
        const affectsA = c.shape === lineA.shape.id || (Array.isArray(c.joints) && c.joints.includes(jTA) && c.joints.includes(lineA.otherJoint));
        const affectsB = c.shape === lineB.shape.id || (Array.isArray(c.joints) && c.joints.includes(jTB) && c.joints.includes(lineB.otherJoint));
        if (affectsA) c.value = Math.max(0.1, c.value - d);
        if (affectsB) c.value = Math.max(0.1, c.value - d);
      }
    }
  }

  // Create the arc shape
  const { shapes: arcShapes, constraints: arcConstraints } = makeArc(joints, jCenter, jTA, jTB, 'CENTER');
  const arcShape = arcShapes[0];
  arcShape.radius = finalRadius;
  shapes.push(arcShape);
  constraints.push(...arcConstraints);

  // Delete the old corner cluster joints
  for (const jid of cluster) {
    joints.delete(jid);
  }
  removeOrphanJoints(state);

  // Add geometric tangent constraints between the lines and the arc
  constraints.push({ type: 'tangent', line: lineA.shape.id, circle: arcShape.id });
  constraints.push({ type: 'tangent', line: lineB.shape.id, circle: arcShape.id });

  // Solve to ensure mathematical consistency
  try {
    if (state.engine && typeof state.engine.solve === 'function') {
      state.engine.solve(200);
    }
  } catch (_) {}

  return {
    success: true,
    arc: arcShape,
    radius: finalRadius,
    centerPt,
    tA,
    tB,
    joints: [jCenter, jTA, jTB]
  };
}
