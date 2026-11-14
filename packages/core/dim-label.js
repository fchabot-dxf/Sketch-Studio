// packages/core/dim-label.js — THE single geometric rule for dimension label placement & drag (TASK 621).
// Every dimension label lives ON its dimension line / arc / leader:
//   - Linear (H / V / aligned / point-to-line / line-to-line): orthonormal frame (mid, a, n) with scalars (offset, labelSlide).
//   - Radius / diameter: polar frame about circle/arc centre with (offset, labelAngle).
//   - Angle: polar frame about line intersection with (offset, labelAngle).
// Dragging or projecting a legacy free `labelPos` maps world XY -> those parameters so the line / arc / leader follows.

import { CONSTRAINT_TYPES } from './constants.js';
import { getDist, getLineIntersection, isPointLineDistance } from './geometry.js';
import { sceneJoints, sceneShapes } from './reference-lines.js';

function projectFoot(pt, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, det = dx * dx + dy * dy;
  if (det <= 1e-5) return null;
  const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / det;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Resolve the two geometry anchor endpoints { j1, j2 } for a distance or radius constraint.
 * Wraps joints/shapes with built-in reference axes when needed.
 */
export function resolveDimEndpoints(c, joints, shapes) {
  const opJoints = sceneJoints(joints);
  const opShapes = sceneShapes(shapes);
  let j1 = null, j2 = null;
  if (c.isRadius && c.shape) {
    const shape = opShapes.find((s) => s.id === c.shape);
    if (shape && shape.joints && shape.joints.length >= 1) j1 = opJoints.get(shape.joints[0]) || null;
  } else if (isPointLineDistance(c)) {
    j1 = opJoints.get(c.joints[0]) || null;
    const la = opJoints.get(c.joints[1]), lb = opJoints.get(c.joints[2]);
    if (j1 && la && lb) j2 = projectFoot(j1, la, lb);
  } else if (c.joints && c.joints.length >= 2) {
    j1 = opJoints.get(c.joints[0]) || null;
    j2 = opJoints.get(c.joints[1]) || null;
  } else if (c.shapes && c.shapes.length === 2) {
    const s1 = opShapes.find((s) => s.id === c.shapes[0]);
    const s2 = opShapes.find((s) => s.id === c.shapes[1]);
    if (s1 && s2 && s1.joints && s2.joints) {
      const l1a = opJoints.get(s1.joints[0]), l1b = opJoints.get(s1.joints[1]);
      const l2a = opJoints.get(s2.joints[0]), l2b = opJoints.get(s2.joints[1]);
      if (l1a && l1b && l2a && l2b) {
        j1 = { x: (l1a.x + l1b.x) / 2, y: (l1a.y + l1b.y) / 2 };
        j2 = projectFoot(j1, l2a, l2b);
      }
    }
  } else if (c.joint && c.shape) {
    j1 = opJoints.get(c.joint) || null;
    const s = opShapes.find((sh) => sh.id === c.shape);
    if (j1 && s && s.joints) {
      const l1 = opJoints.get(s.joints[0]), l2 = opJoints.get(s.joints[1]);
      if (l1 && l2) j2 = projectFoot(j1, l1, l2);
    }
  }
  return { j1, j2 };
}

/**
 * Orthonormal frame { dimMode, mid, dx, dy, len, ax, ay, nx, ny } for a linear dimension's endpoints.
 * `a = (ax, ay)` runs along the dimension line (dimLineStart -> dimLineEnd); `n = (nx, ny)` is its offset normal.
 */
export function linearDimFrame(c, j1, j2) {
  const dimMode = (c && c.dimMode) || 'aligned';
  const mid = { x: (j1.x + j2.x) / 2, y: (j1.y + j2.y) / 2 };
  const dx = j2.x - j1.x, dy = j2.y - j1.y, len = Math.hypot(dx, dy);
  let ax, ay, nx, ny;
  if (dimMode === 'horizontal') {
    ax = j2.x > j1.x ? 1 : -1;
    ay = 0;
    nx = 0;
    ny = 1;
  } else if (dimMode === 'vertical') {
    ax = 0;
    ay = j2.y > j1.y ? 1 : -1;
    nx = 1;
    ny = 0;
  } else if (len > 0.01) {
    ax = dx / len;
    ay = dy / len;
    nx = -dy / len;
    ny = dx / len;
  } else {
    ax = 1;
    ay = 0;
    nx = 0;
    ny = -1;
  }
  return { dimMode, mid, dx, dy, len, ax, ay, nx, ny };
}

/** Project a world point onto a linear frame as { offset, labelSlide }. */
export const linearPointToParams = (frame, pos) => {
  const vx = pos.x - frame.mid.x, vy = pos.y - frame.mid.y;
  return {
    offset: vx * frame.nx + vy * frame.ny,
    labelSlide: vx * frame.ax + vy * frame.ay,
  };
};

/** Reconstruct the world point on a linear dimension line from (offset, labelSlide). */
export const linearParamsToPoint = (frame, offset, labelSlide = 0) => ({
  x: frame.mid.x + frame.nx * offset + frame.ax * labelSlide,
  y: frame.mid.y + frame.ny * offset + frame.ay * labelSlide,
});

/** Project a world point onto a polar frame about `origin` as { offset, labelAngle }. */
export const polarPointToParams = (origin, pos) => ({
  offset: getDist(origin, pos),
  labelAngle: Math.atan2(pos.y - origin.y, pos.x - origin.x),
});

/** Resolve the line-intersection vertex for an angle constraint, or null if invalid/parallel. */
export function angleVertex(c, joints, shapes) {
  if (!c || !c.shapes || c.shapes.length !== 2) return null;
  const opJoints = sceneJoints(joints);
  const opShapes = sceneShapes(shapes);
  const s1 = opShapes.find((s) => s.id === c.shapes[0]);
  const s2 = opShapes.find((s) => s.id === c.shapes[1]);
  if (!s1 || !s2 || !s1.joints || !s2.joints) return null;
  const j1 = opJoints.get(s1.joints[0]), j2 = opJoints.get(s1.joints[1]);
  const j3 = opJoints.get(s2.joints[0]), j4 = opJoints.get(s2.joints[1]);
  if (!j1 || !j2 || !j3 || !j4) return null;
  return getLineIntersection(j1, j2, j3, j4);
}

/**
 * Project a world XY label position onto a constraint's on-line / on-arc / on-leader parameters,
 * mutating `c` in place (`offset` + `labelSlide` or `labelAngle`) and removing any legacy `labelPos`.
 */
export function projectDimLabel(c, pos, joints, shapes) {
  if (!c || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
  if (c.isRadius) {
    const { j1: center } = resolveDimEndpoints(c, joints, shapes);
    if (!center) return false;
    const { offset, labelAngle } = polarPointToParams(center, pos);
    c.offset = offset;
    c.labelAngle = labelAngle;
    delete c.labelPos;
    return true;
  }
  if (c.type === CONSTRAINT_TYPES.ANGLE) {
    const int = angleVertex(c, joints, shapes);
    if (!int) return false;
    const { offset, labelAngle } = polarPointToParams(int, pos);
    c.offset = offset;
    c.labelAngle = labelAngle;
    delete c.labelPos;
    return true;
  }
  if (c.type === CONSTRAINT_TYPES.DISTANCE) {
    const { j1, j2 } = resolveDimEndpoints(c, joints, shapes);
    if (!j1 || !j2) return false;
    const frame = linearDimFrame(c, j1, j2);
    const { offset, labelSlide } = linearPointToParams(frame, pos);
    c.offset = offset;
    c.labelSlide = labelSlide;
    delete c.labelPos;
    return true;
  }
  return false;
}
