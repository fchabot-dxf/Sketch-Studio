// packages/core/dim-label.js — THE single geometric rule for dimension label placement & drag (TASK 621).
// Every dimension label lives ON its dimension line / arc / leader:
//   - Linear (H / V / aligned / point-to-line / line-to-line): orthonormal frame (mid, a, n) with scalars (offset, labelSlide).
//   - Radius / diameter: polar frame about circle/arc centre with (offset, labelAngle).
//   - Angle: polar frame about line intersection with (offset, labelAngle).
// Dragging or projecting a legacy free `labelPos` maps world XY -> those parameters so the line / arc / leader follows.

import { CONSTRAINT_TYPES } from './constants.js';
import { getDist, getLineIntersection, isPointLineDistance } from './geometry.js';
import { angleSectorUnderLabel } from './angle-sector.js';
import { sceneJoints, sceneShapes } from './reference-lines.js';
import { offsetDimensionEnds } from './offset.js';

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
  if (c.type === CONSTRAINT_TYPES.OFFSET) return offsetDimensionEnds(c, opJoints, opShapes); // task 650: source piece -> its offset
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
  if (c.type === CONSTRAINT_TYPES.DISTANCE || c.type === CONSTRAINT_TYPES.OFFSET) {
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

// TASK 680: the Dimension tool's PLACEMENT, moved verbatim from packages/ui/input-handlers/dimension-tool.js so a headless tool operation
// (#core/tool-ops.js) places a dimension with the SAME rule: the mode a label point picks, the radius label, and the offset / mode / value
// a label point gives a dimension being placed.
export function detectDimMode(j1, j2, w) {
    const dx = j2.x - j1.x, dy = j2.y - j1.y;
    const lenSq = dx*dx + dy*dy;
    if (lenSq < 0.0001) return 'aligned';
    
    // If line is nearly horizontal or vertical (~5°), stay aligned — H/V would be redundant
    const lineAngle = Math.abs(Math.atan2(dy, dx));
    const isNearlyH = lineAngle < 0.087 || lineAngle > Math.PI - 0.087;
    const isNearlyV = Math.abs(lineAngle - Math.PI / 2) < 0.087;
    if (isNearlyH || isNearlyV) return 'aligned';
    
    // Project w onto line segment
    const t = ((w.x - j1.x) * dx + (w.y - j1.y) * dy) / lenSq;
    
    // 1. Inside perpendicular band
    if (t >= 0 && t <= 1) return 'aligned';
    
    // 2. Past endpoints
    const ex = (t < 0) ? j1.x : j2.x;
    const ey = (t < 0) ? j1.y : j2.y;
    
    const vx = w.x - ex;
    const vy = w.y - ey;
    
    // Flipped: Pulling horizontally (side) creates a VERTICAL dimension
    if (Math.abs(vx) > Math.abs(vy)) return 'vertical';
    return 'horizontal';
}

// TASK 448: THE one place a radius/diameter dimension's label placement is written (birth, drag while placing, and
// dragging an existing dimension all call it): the label's DISTANCE from the centre (offset) and its ANGLE around the
// centre (labelAngle), so the leader can sit at any angle and the label lands where it is dropped.
export function placeRadiusLabel(c, center, w) {
    const { offset, labelAngle } = polarPointToParams(center, w);
    c.offset = offset;
    c.labelAngle = labelAngle;
    delete c.labelPos;
}

export function updateConstraintOffset(state, c, w) {
    if (c.isRadius) {
        const shape = state.shapes ? sceneShapes(state.shapes).find(s => s.id === c.shape) : null;
        const center = (shape && shape.joints && shape.joints[0]) ? sceneJoints(state.joints).get(shape.joints[0]) : null;
        if (center) {
            placeRadiusLabel(c, center, w);
        }
    } else if (c.type === CONSTRAINT_TYPES.ANGLE && c.shapes && c.shapes.length === 2) {
        if (!c.__placing) {
            projectDimLabel(c, w, state.joints, state.shapes);
            return;
        }
        // Angle Dimension during placement: offset is radius from intersection, label stays on sector bisect by default
        const s1 = sceneShapes(state.shapes).find(s => s.id === c.shapes[0]);
        const s2 = sceneShapes(state.shapes).find(s => s.id === c.shapes[1]);
        if (s1 && s2) {
            const j1 = sceneJoints(state.joints).get(s1.joints[0]), j2 = sceneJoints(state.joints).get(s1.joints[1]);
            const j3 = sceneJoints(state.joints).get(s2.joints[0]), j4 = sceneJoints(state.joints).get(s2.joints[1]);
            if (j1 && j2 && j3 && j4) {
                const int = getLineIntersection(j1, j2, j3, j4);
                if (int) {
                    c.offset = getDist(int, w);
                    delete c.labelAngle;
                    delete c.labelPos;
                    // Also store explicit position for sector detection
                    c.glyphPos = w;
                    // TASK 543 / 553: while a NEW angle dimension is being placed, the sector under the label (at most 180 degrees) decides
                    // what it measures: its span is the value, the sector is stored. Geometry is untouched: every choice holds the lines where they are.
                    if (c.__newlyPlaced && !(c.isDriven || c.driven)) {
                        const choice = angleSectorUnderLabel(Math.atan2(j2.y - j1.y, j2.x - j1.x), Math.atan2(j4.y - j3.y, j4.x - j3.x), Math.atan2(w.y - int.y, w.x - int.x));
                        c.value = choice.value;
                        c.sector = choice.sector;
                    }
                }
            }
        }
    } else if (c.type === CONSTRAINT_TYPES.DISTANCE && c.shapes && c.shapes.length === 2) {
        if (!c.__placing) {
            projectDimLabel(c, w, state.joints, state.shapes);
            return;
        }
        const { j1, j2 } = resolveDimEndpoints(c, state.joints, state.shapes);
        if (j1 && j2) {
            const frame = linearDimFrame(c, j1, j2);
            c.offset = linearPointToParams(frame, w).offset;
            delete c.labelSlide;
            delete c.labelPos;
            c.glyphPos = linearParamsToPoint(frame, c.offset, 0);
        }
    } else if (isPointLineDistance(c)) {
        if (!c.__placing) {
            projectDimLabel(c, w, state.joints, state.shapes);
            return;
        }
        const { j1, j2 } = resolveDimEndpoints(c, state.joints, state.shapes);
        if (j1 && j2) {
            const frame = linearDimFrame(c, j1, j2);
            c.offset = linearPointToParams(frame, w).offset;
            delete c.labelSlide;
            delete c.labelPos;
            c.glyphPos = linearParamsToPoint(frame, c.offset, 0);
        }
    } else if (c.joints && c.joints.length >= 2) {
        const j1 = sceneJoints(state.joints).get(c.joints[0]);
        const j2 = sceneJoints(state.joints).get(c.joints[1]);
        if (j1 && j2) {
            // Detect and store dimension mode ONLY during placement
            if (c.__placing) {
                const mode = detectDimMode(j1, j2, w);
                c.dimMode = mode;
                
                // Check for an existing same-mode DRIVING dim on THIS edge (same joint-pair).
                const hasConflict = state.constraints.some(oc =>
                    oc !== c &&
                    oc.type === CONSTRAINT_TYPES.DISTANCE &&
                    !oc.isDriven && !oc.driven &&
                    oc.joints && oc.joints.length >= 2 &&
                    ((oc.joints[0] === c.joints[0] && oc.joints[1] === c.joints[1]) || (oc.joints[0] === c.joints[1] && oc.joints[1] === c.joints[0])) &&
                    (oc.dimMode || 'aligned') === mode
                );
                // Promote to reference on a same-edge conflict, but NEVER DEMOTE an upstream driven decision
                // (e.g. a rank-redundant CROSS-edge dim already marked driven by ConstraintManager) back to a
                // driver — that's the "renders as driver despite the reference notice" bug. Keep both flags in sync.
                const isReference = !!(c.isDriven || c.driven || c._forcedDriven || hasConflict);
                c.isDriven = isReference;
                c.driven = isReference;

                const frame = linearDimFrame(c, j1, j2);
                c.offset = linearPointToParams(frame, w).offset;
                delete c.labelSlide;
                delete c.labelPos;
                c.value = mode === 'horizontal' ? Math.abs(j2.x - j1.x) : mode === 'vertical' ? Math.abs(j2.y - j1.y) : getDist(j1, j2);
                c.glyphPos = linearParamsToPoint(frame, c.offset, 0);
            } else {
                // After placement, drag moves label onto its line via the one projection rule
                projectDimLabel(c, w, state.joints, state.shapes);
            }
        }
    }
}
