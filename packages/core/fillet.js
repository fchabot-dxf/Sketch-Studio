// packages/core/fillet.js — 2D Fillet (Corner Rounding)
// Pure geometry & topological constraint operations for corner rounding.
// Replaces a sharp corner between two curves (line + line, line + arc, arc + arc) with a smooth, tangent circular arc.
// Each curve at the corner is a "leg" (legAt): a line, or an arc seen from the corner end. ONE path serves every pairing:
// filletGeometryForLegs finds the fillet centre, tangent points and per-leg trim; applyFillet trims each leg by moving
// its corner joint to its tangent point (a line keeps its direction, an arc keeps its centre and radius).
//
// No DOM. Pure function on state.joints / state.shapes / state.constraints.

import { makeArc } from './shapes.js';
import { arcSweepInfo } from './geometry.js';
import { CONSTRAINT_TYPES } from './constants.js';
import { removeOrphanJoints } from './joints.js';
import { parse as parseUnit } from './units.js';
import { nextDimensionName } from './parameters.js';
import { newJointId } from './shape-id.js';

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

const TAU = Math.PI * 2;
const mod2pi = (v) => ((v % TAU) + TAU) % TAU;
const isArcShape = (s) => s && s.type === 'arc' && Array.isArray(s.joints) && s.joints.length >= 3 && (!s.subType || s.subType === 'CENTER');
const isLineShape = (s) => s && s.type === 'line' && Array.isArray(s.joints) && s.joints.length >= 2;
// The joints a curve ENDS on: a line's two, an arc's two rims (its centre, joints[0], is not an end).
const endJoints = (s) => (s.type === 'arc' ? [s.joints[1], s.joints[2]] : [s.joints[0], s.joints[1]]);

/**
 * A curve at a corner, seen from the corner point P: its direction into the curve and what the fillet needs to trim it.
 *   line: { kind:'line', u, far, len }          u = unit direction from P to the far end
 *   arc:  { kind:'arc',  u, c, R, aP, bodyDir, span }   u = unit tangent into the arc; the arc runs `span` radians from P
 *         (angle aP, direction bodyDir = +1 increasing angle) to its far end, keeping its centre c and radius R.
 * `cornerJoint` is the shape's joint at the corner; `P` is where the corner is (the joint's position, or a virtual sharp).
 */
function legAt(state, shape, cornerJoint, P) {
  const J = shape.joints, pt = (id) => state.joints.get(id);
  if (shape.type === 'line') {
    const far = pt(J[0] === cornerJoint ? J[1] : J[0]);
    const len = Math.hypot(far.x - P.x, far.y - P.y);
    return { kind: 'line', u: { x: (far.x - P.x) / (len || 1), y: (far.y - P.y) / (len || 1) }, far: { x: far.x, y: far.y }, len };
  }
  const c = pt(J[0]), start = pt(J[1]), end = pt(J[2]);
  const atStart = J[1] === cornerJoint;
  const far = atStart ? end : start;
  const { dir } = arcSweepInfo(c, start, end, { sweep: shape.sweep });
  const bodyDir = atStart ? dir : -dir;
  const aP = Math.atan2(P.y - c.y, P.x - c.x);
  const span = mod2pi((Math.atan2(far.y - c.y, far.x - c.x) - aP) * bodyDir);
  return {
    kind: 'arc', c: { x: c.x, y: c.y }, R: Math.hypot(far.x - c.x, far.y - c.y), aP, bodyDir, span,
    u: { x: -bodyDir * Math.sin(aP), y: bodyDir * Math.cos(aP) }, far: { x: far.x, y: far.y }
  };
}

/**
 * Find corner info at a specific joint.
 * A valid corner has exactly 2 curves (lines, or arcs ending there) meeting at the joint's coincident cluster.
 * Two arc-involving curves that already run tangent (a filleted corner, a smooth join) are not a corner: nothing to round.
 * @param {object} state
 * @param {string} jointId
 * @returns {object|null}
 */
export function findCornerAtJoint(state, jointId) {
  if (!state || !state.joints || !state.joints.has(jointId)) return null;
  const cJoint = state.joints.get(jointId);
  const cluster = getCoincidentCluster(state, jointId);

  // Construction lines (a Polygon's radials) hang off the corner but are not part of it: they do not count as a third
  // line. They stay attached through the fillet (applyFillet re-links them to the virtual sharp). A corner made ONLY
  // of construction lines still counts them (nothing else to fillet).
  const curves = (state.shapes || []).filter(s => isLineShape(s) || isArcShape(s));
  // an arc touches a corner by ONE end in the cluster and its centre outside it; a line by one end
  const touches = (s) => { const [e0, e1] = endJoints(s); return cluster.has(e0) !== cluster.has(e1) && !(s.type === 'arc' && cluster.has(s.joints[0])); };
  const solid = curves.filter(s => !s.isConstruction);
  const cornerCurves = solid.filter(touches).length > 0 ? solid : curves;
  const incident = [];
  for (const s of cornerCurves) {
    if (!touches(s)) continue;
    const ends = endJoints(s);
    const idx = cluster.has(ends[0]) ? 0 : 1;
    const base = s.type === 'arc' ? 1 : 0; // index of the first end in shape.joints
    incident.push({ shape: s, cornerJoint: ends[idx], otherJoint: ends[1 - idx], cornerIdx: base + idx });
  }

  if (incident.length !== 2) return null;

  const [lineA, lineB] = incident;
  const pA = state.joints.get(lineA.otherJoint);
  const pB = state.joints.get(lineB.otherJoint);
  if (!pA || !pB) return null;

  const cornerPt = { x: cJoint.x, y: cJoint.y };
  const curveA = legAt(state, lineA.shape, lineA.cornerJoint, cornerPt);
  const curveB = legAt(state, lineB.shape, lineB.cornerJoint, cornerPt);
  if ((curveA.kind === 'arc' || curveB.kind === 'arc') && Math.abs(curveA.u.x * curveB.u.x + curveA.u.y * curveB.u.y) > TANGENT_DOT) return null;

  return {
    cornerJointId: jointId,
    cluster,
    cornerPt,
    lineA,
    lineB,
    curveA,
    curveB,
    pA: { x: pA.x, y: pA.y },
    pB: { x: pB.x, y: pB.y }
  };
}

const TANGENT_DOT = 0.9999;

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
  if (lines.length > 2 && arcs.length === 0) return 'Fillet needs a corner between exactly two lines (T-junction)';
  const ends = touching.filter(sh => (isLineShape(sh) || isArcShape(sh)) && endJoints(sh).some(j => cluster.has(j)));
  if (ends.length > 2) return 'Fillet needs a corner between exactly two lines or arcs (T-junction)';
  if (ends.length === 2 && ends.some(sh => sh.type === 'arc')) return 'These curves already run tangent to each other: nothing to fillet';
  return arcs.length ? 'Fillet needs a corner between two lines or arcs that meet at an end' : 'Fillet needs a corner between two lines';
}

/**
 * Fillet geometry for two legs (legAt) meeting at P: the tangent points, the fillet centre and per-leg trim.
 * line + line is the closed form (calculateFilletGeometry). Otherwise the centre is where each leg's offset curve
 * (a line offset by r, or a circle of radius R - r / R + r about the arc's centre), taken on the side of the OTHER leg's
 * direction (the inside of the corner), meet; the intersection nearest P whose tangent points fall on the legs is used.
 * The result also carries insideA / insideB: true when the fillet lies inside that arc's circle.
 */
export function filletGeometryForLegs(P, legA, legB, requestedRadius = 5) {
  if (legA.kind === 'line' && legB.kind === 'line') return calculateFilletGeometry(legA.far, P, legB.far, requestedRadius);
  if (Math.abs(legA.u.x * legB.u.x + legA.u.y * legB.u.y) > TANGENT_DOT) {
    return { valid: false, reason: 'Curves run tangent to each other (nothing to round)' };
  }
  const radius = Math.max(0.1, requestedRadius);
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const loci = [[legA, legB], [legB, legA]].map(([leg, other]) => {
    let n = { x: -leg.u.y, y: leg.u.x };
    if (dot(n, other.u) < 0) n = { x: -n.x, y: -n.y };
    if (leg.kind === 'line') return { kind: 'line', p: { x: P.x + n.x * radius, y: P.y + n.y * radius }, u: leg.u };
    const inside = dot(n, { x: leg.c.x - P.x, y: leg.c.y - P.y }) > 0;
    return { kind: 'circle', c: leg.c, rho: inside ? leg.R - radius : leg.R + radius, inside };
  });
  const tooBig = loci.findIndex(l => l.kind === 'circle' && l.rho < COLLAPSE_TOL);
  if (tooBig !== -1) return { valid: false, reason: `R = ${radius.toFixed(2)} is too large for the arc (its radius is ${[legA, legB][tooBig].R.toFixed(2)})` };

  let candidates;
  const [LA, LB] = loci;
  if (LA.kind === 'line' || LB.kind === 'line') {
    const ln = LA.kind === 'line' ? LA : LB, ci = LA.kind === 'line' ? LB : LA;
    const w = { x: ln.p.x - ci.c.x, y: ln.p.y - ci.c.y };
    const b = dot(w, ln.u), disc = b * b - (dot(w, w) - ci.rho * ci.rho);
    candidates = disc < 0 ? [] : [-b - Math.sqrt(disc), -b + Math.sqrt(disc)].map(t => ({ x: ln.p.x + t * ln.u.x, y: ln.p.y + t * ln.u.y }));
  } else {
    const dx = LB.c.x - LA.c.x, dy = LB.c.y - LA.c.y, dist = Math.hypot(dx, dy);
    const a = (LA.rho * LA.rho - LB.rho * LB.rho + dist * dist) / (2 * dist || 1), h2 = LA.rho * LA.rho - a * a;
    if (!(dist > 1e-9) || h2 < 0) candidates = [];
    else {
      const h = Math.sqrt(h2), mx = LA.c.x + a * dx / dist, my = LA.c.y + a * dy / dist;
      candidates = [{ x: mx + h * dy / dist, y: my - h * dx / dist }, { x: mx - h * dy / dist, y: my + h * dx / dist }];
    }
  }

  // the tangent point of a leg for a candidate centre O, or the reason it does not trim that leg
  const trim = (leg, O) => {
    if (leg.kind === 'line') {
      const d = dot({ x: O.x - P.x, y: O.y - P.y }, leg.u);
      if (d <= COLLAPSE_TOL) return { reason: 'would start behind the corner' };
      if (Math.abs(d - leg.len) < COLLAPSE_TOL) return { reason: 'would collapse a line to zero length; use a slightly different radius' };
      return { t: { x: P.x + d * leg.u.x, y: P.y + d * leg.u.y } };
    }
    const dc = Math.hypot(O.x - leg.c.x, O.y - leg.c.y) || 1e-12;
    const t = { x: leg.c.x + leg.R * (O.x - leg.c.x) / dc, y: leg.c.y + leg.R * (O.y - leg.c.y) / dc };
    const delta = mod2pi((Math.atan2(t.y - leg.c.y, t.x - leg.c.x) - leg.aP) * leg.bodyDir);
    if (delta * leg.R <= COLLAPSE_TOL) return { reason: 'would start behind the corner' };
    if (Math.abs(leg.span - delta) * leg.R < COLLAPSE_TOL) return { reason: 'would collapse an arc to zero length; use a slightly different radius' };
    if (delta > leg.span) return { reason: 'would run past the far end of the arc' };
    return { t };
  };
  let best = null, why = 'does not fit this corner (no circle of that radius touches both curves)';
  for (const O of candidates) {
    const a = trim(legA, O), b = trim(legB, O);
    if (a.reason || b.reason) { why = a.reason || b.reason; continue; }
    const d = Math.hypot(O.x - P.x, O.y - P.y);
    if (!best || d < best.d) best = { d, O, tA: a.t, tB: b.t };
  }
  if (!best) return { valid: false, reason: `R = ${radius.toFixed(2)} ${why}` };
  return {
    valid: true, radius, tA: best.tA, tB: best.tB, centerPt: best.O,
    insideA: loci[0].kind === 'circle' ? loci[0].inside : undefined,
    insideB: loci[1].kind === 'circle' ? loci[1].inside : undefined
  };
}

/** The fillet geometry of a corner (findCornerAtJoint's result) for a radius. */
export function cornerFilletGeometry(corner, radius) {
  const a = corner.curveA || { kind: 'line', far: corner.pA }, b = corner.curveB || { kind: 'line', far: corner.pB };
  return filletGeometryForLegs(corner.cornerPt, a, b, radius);
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

  const geom = cornerFilletGeometry(cornerInfo, radius);
  if (!geom.valid) return { success: false, reason: geom.reason };

  // History is the caller's (tool layer) job, like every other tool -- do NOT saveState here, or one fillet takes two undo steps.

  const { joints, shapes, constraints } = state;
  const { cluster, lineA, lineB } = cornerInfo;
  const { tA, tB, centerPt } = geom;
  const cornerPt0 = { x: cornerInfo.cornerPt.x, y: cornerInfo.cornerPt.y };
  const finalRadius = geom.radius;

  const genJ = newJointId;

  const jCenter = genJ();
  const jTA = genJ();
  const jTB = genJ();
  // virtual sharp: the corner as it was (see below). A corner whose cluster holds a FIXED joint (the origin is one; so is any
  // point the user locked) keeps that joint as its sharp: it is already fixed at the corner, both trimmed lines are held to it,
  // and it must never be deleted. With several coincident fixed joints the first one in joint order is kept (the origin is
  // always first); the other fixed ones are coincident with it, so deleting them loses no position.
  let keptFixed = null;
  for (const [id, j] of joints) if (cluster.has(id) && j && j.fixed) { keptFixed = id; break; }
  const jV = keptFixed || genJ();

  joints.set(jCenter, { x: centerPt.x, y: centerPt.y, fixed: false });
  joints.set(jTA, { x: tA.x, y: tA.y, fixed: false });
  joints.set(jTB, { x: tB.x, y: tB.y, fixed: false });
  // V: a bare joint (NO shape) left at the sharp corner. Held on both trimmed lines by pointOnLine so it
  // follows them when the radius changes; overall dimensions attach to it. Not a shape => loops/export ignore it.
  if (!keptFixed) joints.set(jV, { x: cornerPt0.x, y: cornerPt0.y, fixed: false, virtualSharp: true });

  // Update line endpoint joints to the new tangent points
  lineA.shape.joints[lineA.cornerIdx] = jTA;
  lineB.shape.joints[lineB.cornerIdx] = jTB;

  // Construction lines on the corner (a Polygon's radial) keep meaning the sharp corner: re-link them to V
  for (const s of shapes) {
    if (s && s.type === 'line' && s.isConstruction && s !== lineA.shape && s !== lineB.shape && Array.isArray(s.joints)) {
      for (let k = 0; k < s.joints.length; k++) if (cluster.has(s.joints[k])) s.joints[k] = jV;
    }
  }

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

      // An ARC leg's own structural equal (makeArc: [centre, rim, centre, rim], it keeps the arc a circle) is part of that arc, not a
      // measurement: its corner rim follows the leg's tangent joint, like the arc itself (task 649).
      const ownArc = c.type === CONSTRAINT_TYPES.EQUAL && Array.isArray(c.joints) && c.joints.length === 4 ? [[lineA, jTA], [lineB, jTB]].find(([leg]) => leg.shape.type === 'arc' && c.joints[0] === leg.shape.joints[0] && c.joints[2] === leg.shape.joints[0]) : null;
      if (ownArc) {
        for (let k = 0; k < c.joints.length; k++) if (cluster.has(c.joints[k])) c.joints[k] = ownArc[1];
        continue;
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
      // the line survives (trimmed) and keeps its direction. When the two curves SHARE the corner joint (a line drawn from another
      // curve's end), a constraint that names curve B's far end is about curve B: it follows B's tangent point (task 649).
      if (Array.isArray(c.joints)) {
        const onB = lineA.cornerJoint === lineB.cornerJoint && c.joints.includes(lineB.otherJoint) && !c.joints.includes(lineA.otherJoint);
        for (let k = 0; k < c.joints.length; k++) {
          if (c.joints[k] === lineA.cornerJoint) c.joints[k] = onB ? jTB : jTA;
          else if (c.joints[k] === lineB.cornerJoint) c.joints[k] = jTB;
        }
      }
      // TASK 535 O12 (like Fusion): a line-length dimension, with or without a formula, is a joint-pair MEASURE (handled above): it is re-linked to
      // the virtual sharp and keeps its value AND its formula. (A former branch here shortened a DISTANCE that carries `shape` and is no radius;
      // no dimension has that form, createConstraint only gives `shape` to a radius, so it never ran, and it would have overwritten a formula's value.)
    }
  }

  // Create the arc shape
  const { shapes: arcShapes, constraints: arcConstraints } = makeArc(joints, jCenter, jTA, jTB, 'CENTER');
  const arcShape = arcShapes[0];
  arcShape.filletSharp = jV; // data on the arc (survives undo/save): which joint is its virtual sharp corner
  // NOTE: no arcShape.radius -- the radius dimension below is the source of truth; a frozen scalar would go stale on edit.
  shapes.push(arcShape);
  constraints.push(...arcConstraints);

  // V is held on both trimmed curves (a line: pointOnLine; an arc: the same constraint on its circle). Pushed BEFORE removeOrphanJoints, which would otherwise delete V (it is
  // referenced by constraints only, not by a shape).
  constraints.push({ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: jV, shape: lineA.shape.id });
  constraints.push({ type: CONSTRAINT_TYPES.POINT_ON_LINE, joint: jV, shape: lineB.shape.id });

  // Delete the old corner cluster joints
  for (const jid of cluster) {
    if (jid !== jV) joints.delete(jid);
  }
  removeOrphanJoints(state);

  // Add geometric tangent constraints between each trimmed curve and the fillet arc: line -> arc `tangent {line, circle}`;
  // arc -> arc `tangent {shapes}` on the branch the fillet lies on (inside the arc's circle: internal, outside: external).
  [[lineA, geom.insideA], [lineB, geom.insideB]].forEach(([leg, inside]) => {
    if (leg.shape.type === 'arc') constraints.push({ type: 'tangent', shapes: [leg.shape.id, arcShape.id], branch: inside ? 'internal' : 'external' });
    else constraints.push({ type: 'tangent', line: leg.shape.id, circle: arcShape.id });
  });

  // Driving RADIUS dimension on the new arc -- same shape the Dimension tool makes for an arc
  // (distance + isRadius + shape), so the fillet is a live, editable radius.
  const radiusConstraint = {
    type: CONSTRAINT_TYPES.DISTANCE,
    shape: arcShape.id,
    value: finalRadius,
    isRadius: true,
    isDriven: false,
    driven: false,
    name: nextDimensionName(constraints), // TASK 535: this dimension is pushed directly (not through addConstraint), so it takes its automatic name here
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

/** The fillet's trimmed legs (a line or an arc each), with their far (non-fillet) and rim (on the fillet arc) joints. */
// The fillet's two tangent LEGS ({ shape: the trimmed line or arc, rim: its joint on the fillet arc, far: its other end }). Exported for the
// dimension seam (task 550): a fillet radius edit judges the legs by filletHasCollapsedLine and everything else by findCollapsedShape.
export function filletLines(state, arc) {
  const out = [];
  for (const c of (state.constraints || [])) {
    if (!c || c.type !== CONSTRAINT_TYPES.TANGENT) continue;
    const id = c.circle === arc.id && c.line ? c.line : (Array.isArray(c.shapes) && c.shapes.includes(arc.id) ? c.shapes.find(s => s !== arc.id) : null);
    const shape = id && (state.shapes || []).find(sh => sh && sh.id === id);
    if (!shape || !Array.isArray(shape.joints)) continue;
    const ends = shape.type === 'arc' ? endJoints(shape) : shape.joints;
    const rim = ends.find(j => arc.joints.slice(1).includes(j));
    const far = ends.find(j => j !== rim);
    if (rim && far) out.push({ shape, rim, far });
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
  const geom = filletGeometryForLegs(V, legAt(state, A.shape, A.rim, V), legAt(state, B.shape, B.rim, V), radius);
  if (!geom.valid) return { ok: false, reason: geom.reason };
  const put = (id, p) => { const j = state.joints.get(id); if (j) { j.x = p.x; j.y = p.y; } };
  put(arc.joints[0], geom.centerPt);
  put(A.rim, geom.tA);
  put(B.rim, geom.tB);
  return { ok: true };
}

/** True if either trimmed leg (line or arc) of this fillet has collapsed to (near) zero length. */
export function filletHasCollapsedLine(state, arc) {
  for (const { rim, far } of filletLines(state, arc)) {
    const a = state.joints.get(rim), b = state.joints.get(far);
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < COLLAPSE_TOL) return true;
  }
  return false;
}

// ---- two-line pick (Fusion-style): click line 1, click line 2 ----

/** Distance from `p` to a line segment, or to an arc's drawn sweep (not its whole circle); null for any other shape. */
function curveDistance(state, s, p) {
  if (isLineShape(s)) {
    const a = state.joints.get(s.joints[0]), b = state.joints.get(s.joints[1]);
    if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    let t = L2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  if (isArcShape(s)) {
    const c = state.joints.get(s.joints[0]), a = state.joints.get(s.joints[1]), b = state.joints.get(s.joints[2]);
    if (!c || !a || !b) return null;
    const info = arcSweepInfo(c, a, b, { sweep: s.sweep });
    const R = Math.hypot(a.x - c.x, a.y - c.y);
    const rel = mod2pi((Math.atan2(p.y - c.y, p.x - c.x) - info.a0) * info.dir);
    if (rel <= info.span) return Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - R);
    return Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y));
  }
  return null;
}

function nearestCurve(state, worldPt, tolerance, accept) {
  if (!state || !state.joints || !worldPt) return null;
  let best = null, bestD = tolerance;
  for (const s of (state.shapes || [])) {
    if (!s || !accept(s)) continue;
    const d = curveDistance(state, s, worldPt);
    if (d != null && d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** Nearest LINE shape whose segment passes within `tolerance` of `worldPt`, or null. */
export function findLineAtPoint(state, worldPt, tolerance = 10) {
  return nearestCurve(state, worldPt, tolerance, s => s.type === 'line');
}

/** Nearest LINE or ARC (its drawn sweep) within `tolerance` of `worldPt`, or null: what a Fillet pick can land on. */
export function findFilletShapeAtPoint(state, worldPt, tolerance = 10) {
  return nearestCurve(state, worldPt, tolerance, s => s.type === 'line' || s.type === 'arc');
}

/**
 * The fillet corner formed by exactly these two shapes (lines or arcs; they must meet at a shared/coincident joint and
 * nothing else may touch that corner), or null. Same shape as findCornerAtJoint's result.
 */
export function findCornerBetweenLines(state, lineA, lineB) {
  if (!state || !lineA || !lineB || lineA.id === lineB.id) return null;
  for (const jid of lineA.joints) {
    const corner = findCornerAtJoint(state, jid);
    if (corner && ((corner.lineA.shape.id === lineA.id && corner.lineB.shape.id === lineB.id) ||
                   (corner.lineA.shape.id === lineB.id && corner.lineB.shape.id === lineA.id))) return corner;
  }
  return null;
}
