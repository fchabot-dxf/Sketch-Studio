//
// SLOT - Pure geometry & constraint builders for Fusion 360's five slot types.
// Real lines & arcs only (via makeArc); no polylines, no new constraint types.
//

import { CONSTRAINT_TYPES, SLOT_MODES } from './constants.js';
import { createConstraint } from './constraints.js';
import { makeArc } from './shapes.js';
import { newShapeId } from './shape-id.js';

const TAU = Math.PI * 2;
const MIN_HALF_WIDTH = 0.05;
const MIN_SPAN = 0.1;

function mod2pi(a) {
  return ((a % TAU) + TAU) % TAU;
}

/** Circumcircle { center, radius } of three non-collinear points, or null. */
export function circumcenter3Pt(p1, p2, p3) {
  if (!p1 || !p2 || !p3) return null;
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (!Number.isFinite(d) || Math.abs(d) < 1e-6) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const radius = Math.hypot(ax - ux, ay - uy);
  if (!Number.isFinite(radius) || radius < MIN_SPAN) return null;
  return { center: { x: ux, y: uy }, radius };
}

/** True if the CCW sweep from p1 to p2 around center passes through p3. */
export function arcSweepFor3Pt(center, p1, p2, p3) {
  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  const a3 = Math.atan2(p3.y - center.y, p3.x - center.x);
  const d12 = mod2pi(a2 - a1);
  const d13 = mod2pi(a3 - a1);
  return d13 <= d12;
}

/** Positive angular span (in radians, 0..2pi] from p1 to p2 for the given sweep direction. */
export function arcAngleSpan(center, p1, p2, sweep) {
  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  const raw = sweep ? mod2pi(a2 - a1) : mod2pi(a1 - a2);
  return raw < 1e-6 ? TAU : raw;
}

/** Perpendicular distance from point p to the infinite line through a->b. */
export function perpDistToLine(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Radial distance delta | |p - center| - R | used as half-width when hovering an arc slot. */
export function arcWidthFromPoint(center, R, p) {
  return Math.max(MIN_HALF_WIDTH * 2, Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - R) * 2);
}

/** Clamp requested width for any straight slot mode so centers stay distinct in Overall mode. */
export function clampStraightSlotWidth(mode, spanLen, requestedWidth) {
  const w = Number.isFinite(requestedWidth) ? requestedWidth : 10;
  if (mode === SLOT_MODES.OVERALL) {
    const maxW = Math.max(MIN_HALF_WIDTH * 2, spanLen * 0.9);
    return Math.max(MIN_HALF_WIDTH * 2, Math.min(w, maxW));
  }
  return Math.max(MIN_HALF_WIDTH * 2, w);
}

/** Clamp requested width for an arc slot so the inner arc radius never collapses through center. */
export function clampArcSlotWidth(centerRadius, requestedWidth) {
  const w = Number.isFinite(requestedWidth) ? requestedWidth : 10;
  const maxW = Math.max(MIN_HALF_WIDTH * 2, centerRadius * 1.8);
  return Math.max(MIN_HALF_WIDTH * 2, Math.min(w, maxW));
}

/**
 * Pure geometry resolver for all three straight slot modes (shared by builders & SVG preview).
 * Returns { mode, c1, c2, cl1, cl2, m, a1, a2, b1, b2, r, width, ux, uy } or null.
 */
export function computeStraightSlotPoints({ mode, p1, p2, width }) {
  if (!p1 || !p2) return null;
  let cl1, cl2, c1, c2, m = null;
  if (mode === SLOT_MODES.CENTER_POINT) {
    m = { x: p1.x, y: p1.y };
    c2 = { x: p2.x, y: p2.y };
    c1 = { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    cl1 = c1;
    cl2 = c2;
  } else {
    cl1 = { x: p1.x, y: p1.y };
    cl2 = { x: p2.x, y: p2.y };
    c1 = { x: p1.x, y: p1.y };
    c2 = { x: p2.x, y: p2.y };
  }

  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist < MIN_SPAN) return null;
  const ux = dx / dist, uy = dy / dist;
  const clampedW = clampStraightSlotWidth(mode, dist, width);
  const r = clampedW * 0.5;

  if (mode === SLOT_MODES.OVERALL) {
    c1 = { x: cl1.x + ux * r, y: cl1.y + uy * r };
    c2 = { x: cl2.x - ux * r, y: cl2.y - uy * r };
  }

  const nx = -uy, ny = ux;
  return {
    mode,
    c1, c2, cl1, cl2, m,
    a1: { x: c1.x + r * nx, y: c1.y + r * ny },
    a2: { x: c1.x - r * nx, y: c1.y - r * ny },
    b1: { x: c2.x + r * nx, y: c2.y + r * ny },
    b2: { x: c2.x - r * nx, y: c2.y - r * ny },
    r,
    width: clampedW,
    ux, uy,
    centerDist: Math.hypot(c2.x - c1.x, c2.y - c1.y),
    spanDist: Math.hypot(cl2.x - cl1.x, cl2.y - cl1.y),
  };
}

/**
 * Pure geometry resolver for both arc slot modes (shared by builders & SVG preview).
 * Returns { center, c1, c2, o1, o2, i1, i2, r, midRadius, sweep, width } or null.
 */
export function computeArcSlotPoints({ center, c1, c2, sweep, width }) {
  if (!center || !c1 || !c2) return null;
  const r1 = Math.hypot(c1.x - center.x, c1.y - center.y);
  const r2 = Math.hypot(c2.x - center.x, c2.y - center.y);
  if (!Number.isFinite(r1) || !Number.isFinite(r2) || r1 < MIN_SPAN || r2 < MIN_SPAN) return null;
  const u1x = (c1.x - center.x) / r1, u1y = (c1.y - center.y) / r1;
  const u2x = (c2.x - center.x) / r2, u2y = (c2.y - center.y) / r2;
  const c2OnCircle = { x: center.x + r1 * u2x, y: center.y + r1 * u2y };
  if (Math.hypot(c2OnCircle.x - c1.x, c2OnCircle.y - c1.y) < MIN_SPAN &&
      Math.hypot(c1.x - c2.x, c1.y - c2.y) < MIN_SPAN) {
    return null;
  }

  const clampedW = clampArcSlotWidth(r1, width);
  const r = clampedW * 0.5;
  const rOut = r1 + r;
  const rIn = r1 - r;
  return {
    center: { x: center.x, y: center.y },
    c1: { x: c1.x, y: c1.y },
    c2: c2OnCircle,
    o1: { x: center.x + rOut * u1x, y: center.y + rOut * u1y },
    i1: { x: center.x + rIn * u1x, y: center.y + rIn * u1y },
    o2: { x: center.x + rOut * u2x, y: center.y + rOut * u2y },
    i2: { x: center.x + rIn * u2x, y: center.y + rIn * u2y },
    r,
    midRadius: r1,
    sweep: !!sweep,
    width: clampedW,
  };
}

function allocJoint(joints, pt, genJ, extra = null) {
  const id = genJ();
  joints.set(id, extra ? { x: pt.x, y: pt.y, fixed: false, ...extra } : { x: pt.x, y: pt.y, fixed: false });
  return id;
}

function makeWidthDimension(shapeId, width, r, labelAngle) {
  return createConstraint(CONSTRAINT_TYPES.DISTANCE, {
    shape: shapeId,
    isRadius: true,
    isDiameter: true,
    value: width,
    offset: r + Math.max(0.25, Math.min(18, r * 1.3)),
    labelAngle,
  });
}

function buildStraightSlotCore(joints, { c1Id, c2Id, cl1Id, cl2Id, geom, seq, isConstruction, extraConstraints = [] }) {
  const a1Id = allocJoint(joints, geom.a1, geom.genJ);
  const a2Id = allocJoint(joints, geom.a2, geom.genJ);
  const b1Id = allocJoint(joints, geom.b1, geom.genJ);
  const b2Id = allocJoint(joints, geom.b2, geom.genJ);

  const groupId = 'slot_' + seq;
  const constrFlag = !!isConstruction;

  const s1 = { id: `s_slot_${seq}_s1`, type: 'line', joints: [a1Id, b1Id], groupId, isConstruction: constrFlag };
  const s2 = { id: `s_slot_${seq}_s2`, type: 'line', joints: [b2Id, a2Id], groupId, isConstruction: constrFlag };

  const e1Res = makeArc(joints, c1Id, a1Id, a2Id, 'CENTER', constrFlag);
  const e2Res = makeArc(joints, c2Id, b1Id, b2Id, 'CENTER', constrFlag);
  const e1 = e1Res.shapes[0];
  const e2 = e2Res.shapes[0];
  if (e1) { e1.groupId = groupId; e1.sweep = true; }
  if (e2) { e2.groupId = groupId; e2.sweep = false; }

  const cl = { id: `s_slot_${seq}_cl`, type: 'line', joints: [cl1Id, cl2Id], isConstruction: true };

  const constraints = [
    ...e1Res.constraints,
    ...e2Res.constraints,
    createConstraint(CONSTRAINT_TYPES.TANGENT, { line: s1.id, circle: e1.id }),
    createConstraint(CONSTRAINT_TYPES.TANGENT, { line: s2.id, circle: e1.id }),
    createConstraint(CONSTRAINT_TYPES.TANGENT, { line: s1.id, circle: e2.id }),
    createConstraint(CONSTRAINT_TYPES.TANGENT, { line: s2.id, circle: e2.id }),
    createConstraint(CONSTRAINT_TYPES.PARALLEL, { shapes: [s1.id, s2.id] }),
    ...extraConstraints.map((fn) => fn({ s1, s2, e1, e2, cl })),
  ].filter(Boolean);

  const labelAngle = Math.atan2(-geom.uy, -geom.ux) - Math.PI / 5;
  const widthDim = makeWidthDimension(e1.id, geom.width, geom.r, labelAngle);
  if (widthDim) constraints.push(widthDim);

  return {
    shapes: [s1, e2, s2, e1, cl].filter(Boolean),
    constraints,
    meta: { groupId, s1, s2, e1, e2, cl, c1Id, c2Id, a1Id, a2Id, b1Id, b2Id, widthDim },
  };
}

/**
 * 1. Center to Center Slot: pick two end arc centers c1Id, c2Id, then width.
 */
export function makeSlotCenterToCenter(joints, c1Id, c2Id, width, genJ, isConstruction = false) {
  const p1 = joints.get(c1Id), p2 = joints.get(c2Id);
  const geom = computeStraightSlotPoints({ mode: SLOT_MODES.CENTER_TO_CENTER, p1, p2, width });
  if (!geom) return { shapes: [], constraints: [] };
  const seq = newShapeId('');
  return buildStraightSlotCore(joints, {
    c1Id, c2Id, cl1Id: c1Id, cl2Id: c2Id,
    geom: { ...geom, genJ },
    seq, isConstruction,
  });
}

/**
 * 2. Overall Slot: pick two overall tip points t1Id, t2Id, then width.
 */
export function makeSlotOverall(joints, t1Id, t2Id, width, genJ, isConstruction = false) {
  const p1 = joints.get(t1Id), p2 = joints.get(t2Id);
  const geom = computeStraightSlotPoints({ mode: SLOT_MODES.OVERALL, p1, p2, width });
  if (!geom) return { shapes: [], constraints: [] };
  const seq = newShapeId('');
  const c1Id = allocJoint(joints, geom.c1, genJ);
  const c2Id = allocJoint(joints, geom.c2, genJ);

  const built = buildStraightSlotCore(joints, {
    c1Id, c2Id, cl1Id: t1Id, cl2Id: t2Id,
    geom: { ...geom, genJ },
    seq, isConstruction,
    extraConstraints: [
      ({ e1, e2, cl }) => createConstraint(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: t1Id, shape: e1.id }),
      ({ e2 }) => createConstraint(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: t2Id, shape: e2.id }),
      ({ cl }) => createConstraint(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: c1Id, shape: cl.id }),
      ({ cl }) => createConstraint(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: c2Id, shape: cl.id }),
    ],
  });
  built.meta.t1Id = t1Id;
  built.meta.t2Id = t2Id;
  return built;
}

/**
 * 3. Center Point Slot: pick slot center mId and one end arc center c2Id, then width.
 */
export function makeSlotCenterPoint(joints, mId, c2Id, width, genJ, isConstruction = false) {
  const pm = joints.get(mId), pc2 = joints.get(c2Id);
  const geom = computeStraightSlotPoints({ mode: SLOT_MODES.CENTER_POINT, p1: pm, p2: pc2, width });
  if (!geom) return { shapes: [], constraints: [] };
  if (pm && !pm.orphanAllowed && mId !== 'j_origin') pm.orphanAllowed = true;
  const seq = newShapeId('');
  const c1Id = allocJoint(joints, geom.c1, genJ);

  const built = buildStraightSlotCore(joints, {
    c1Id, c2Id, cl1Id: c1Id, cl2Id: c2Id,
    geom: { ...geom, genJ },
    seq, isConstruction,
    extraConstraints: [
      () => createConstraint(CONSTRAINT_TYPES.MIDPOINT, { joints: [c1Id, c2Id, mId] }),
    ],
  });
  built.meta.mId = mId;
  return built;
}

function buildArcSlotCore(joints, { centerId, c1Id, c2Id, sweep, width, genJ, isConstruction, seq, extraConstraints = [] }) {
  const center = joints.get(centerId), c1 = joints.get(c1Id), c2 = joints.get(c2Id);
  const geom = computeArcSlotPoints({ center, c1, c2, sweep, width });
  if (!geom) return { shapes: [], constraints: [] };
  if (center && !center.orphanAllowed && centerId !== 'j_origin') center.orphanAllowed = true;
  // Ensure c2 sits accurately on the circle of center & c1
  if (c2) {
    c2.x = geom.c2.x;
    c2.y = geom.c2.y;
  }

  const o1Id = allocJoint(joints, geom.o1, genJ);
  const i1Id = allocJoint(joints, geom.i1, genJ);
  const o2Id = allocJoint(joints, geom.o2, genJ);
  const i2Id = allocJoint(joints, geom.i2, genJ);

  const groupId = 'slot_' + seq;
  const constrFlag = !!isConstruction;

  const acRes = makeArc(joints, centerId, c1Id, c2Id, 'CENTER', true);
  const aoRes = makeArc(joints, centerId, o1Id, o2Id, 'CENTER', constrFlag);
  const aiRes = makeArc(joints, centerId, i1Id, i2Id, 'CENTER', constrFlag);
  const e1Res = makeArc(joints, c1Id, i1Id, o1Id, 'CENTER', constrFlag);
  const e2Res = makeArc(joints, c2Id, o2Id, i2Id, 'CENTER', constrFlag);

  const ac = acRes.shapes[0];
  const ao = aoRes.shapes[0];
  const ai = aiRes.shapes[0];
  const e1 = e1Res.shapes[0];
  const e2 = e2Res.shapes[0];
  if (ac) { delete ac.groupId; ac.sweep = geom.sweep; }
  if (ao) { ao.groupId = groupId; ao.sweep = geom.sweep; }
  if (ai) { ai.groupId = groupId; ai.sweep = geom.sweep; }
  if (e1) { e1.groupId = groupId; e1.sweep = geom.sweep; }
  if (e2) { e2.groupId = groupId; e2.sweep = geom.sweep; }

  const constraints = [
    ...acRes.constraints,
    ...aoRes.constraints,
    ...aiRes.constraints,
    ...e1Res.constraints,
    ...e2Res.constraints,
    createConstraint(CONSTRAINT_TYPES.TANGENT, { shapes: [ao.id, e1.id], branch: 'internal' }),
    createConstraint(CONSTRAINT_TYPES.TANGENT, { shapes: [ai.id, e1.id], branch: 'external' }),
    createConstraint(CONSTRAINT_TYPES.TANGENT, { shapes: [ao.id, e2.id], branch: 'internal' }),
    ...extraConstraints.map((fn) => fn({ ac, ao, ai, e1, e2 })),
  ].filter(Boolean);

  // Place width dimension radially outward from e1's cap away from center
  const baseAng = Math.atan2(geom.c1.y - geom.center.y, geom.c1.x - geom.center.x);
  const tangSign = geom.sweep ? -1 : 1;
  const labelAngle = baseAng + tangSign * (Math.PI * 0.5);
  const widthDim = makeWidthDimension(e1.id, geom.width, geom.r, labelAngle);
  if (widthDim) constraints.push(widthDim);

  return {
    shapes: [ao, e2, ai, e1, ac].filter(Boolean),
    constraints,
    meta: { groupId, ac, ao, ai, e1, e2, centerId, c1Id, c2Id, o1Id, i1Id, o2Id, i2Id, widthDim },
  };
}

/**
 * 4. Three Point Arc Slot: pick start center c1Id, end center c2Id, third point p3 (with optional p3Id), then width.
 */
export function makeSlotThreePointArc(joints, c1Id, c2Id, p3OrId, width, genJ, isConstruction = false, { bindThirdJoint = false } = {}) {
  const c1 = joints.get(c1Id), c2 = joints.get(c2Id);
  const p3IsId = typeof p3OrId === 'string';
  const p3 = p3IsId ? joints.get(p3OrId) : p3OrId;
  const cc = circumcenter3Pt(c1, c2, p3);
  if (!cc) return { shapes: [], constraints: [] };
  const sweep = arcSweepFor3Pt(cc.center, c1, c2, p3);
  const centerId = allocJoint(joints, cc.center, genJ, { orphanAllowed: true });
  const seq = newShapeId('');
  const extraConstraints = [];
  if (bindThirdJoint && p3IsId && p3) {
    extraConstraints.push(({ ac }) => createConstraint(CONSTRAINT_TYPES.POINT_ON_LINE, { joint: p3OrId, shape: ac.id }));
  }
  return buildArcSlotCore(joints, {
    centerId, c1Id, c2Id, sweep, width, genJ, isConstruction, seq, extraConstraints,
  });
}

/**
 * 5. Center Point Arc Slot: pick center arc centerId, start center c1Id, end center c2Id, sweep, then width.
 */
export function makeSlotCenterPointArc(joints, centerId, c1Id, c2Id, sweep, width, genJ, isConstruction = false) {
  const seq = newShapeId('');
  return buildArcSlotCore(joints, {
    centerId, c1Id, c2Id, sweep, width, genJ, isConstruction, seq,
  });
}
