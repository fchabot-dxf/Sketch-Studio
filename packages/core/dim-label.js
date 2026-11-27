// packages/core/dim-label.js — THE single geometric rule for dimension label placement & drag (TASK 621).
// Every dimension label lives ON its dimension line / arc / leader:
//   - Linear (H / V / aligned / point-to-line / line-to-line): orthonormal frame (mid, a, n) with scalars (offset, labelSlide).
//   - Radius / diameter: polar frame about circle/arc centre with (offset, labelAngle).
//   - Angle: polar frame about line intersection with (offset, labelAngle).
// Dragging or projecting a legacy free `labelPos` maps world XY -> those parameters so the line / arc / leader follows.

import { CONSTRAINT_TYPES } from './constants.js';
import { getDist, getLineIntersection, isPointLineDistance, arcSweepInfo, angleInArcSweep } from './geometry.js';
import { angleSectorUnderLabel } from './angle-sector.js';
import { sceneJoints, sceneShapes } from './reference-lines.js';
import { offsetDimensionEnds } from './offset.js';
import { SolverConfig } from './solver-config.js';

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
/**
 * Detect dimension mode based on mouse position relative to segment.
 * Returns 'aligned', 'horizontal', or 'vertical'.
 * TASK 680 (advisor ruling, Fusion): the orientation follows the label. A LEVEL or PLUMB pair (exactly horizontal / vertical) is always a
 * horizontal / vertical dimension (never aligned, never the zero one across it); a pair within ~5 degrees of an axis is horizontal / vertical
 * by where the label is (above / below it: horizontal for a near-level pair, vertical for a near-plumb one; past its ends: as below); only a
 * clearly diagonal pair is ALIGNED, with the label beside it (its perpendicular band).
 */
export function detectDimMode(j1, j2, w) {
    const dx = j2.x - j1.x, dy = j2.y - j1.y;
    const lenSq = dx*dx + dy*dy;
    if (lenSq < 0.0001) return 'aligned';
    const len = Math.sqrt(lenSq);
    if (Math.abs(dy) <= 1e-9 * len) return 'horizontal'; // level
    if (Math.abs(dx) <= 1e-9 * len) return 'vertical';   // plumb

    const lineAngle = Math.abs(Math.atan2(dy, dx));
    const isNearlyH = lineAngle < 0.087 || lineAngle > Math.PI - 0.087;
    const isNearlyV = Math.abs(lineAngle - Math.PI / 2) < 0.087;

    // Project w onto line segment
    const t = ((w.x - j1.x) * dx + (w.y - j1.y) * dy) / lenSq;

    // 1. Inside perpendicular band: a near-level / near-plumb pair measures along its axis, a diagonal one along itself
    if (t >= 0 && t <= 1) return isNearlyH ? 'horizontal' : isNearlyV ? 'vertical' : 'aligned';
    
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
    } else if ((c.type === CONSTRAINT_TYPES.DISTANCE && c.shapes && c.shapes.length === 2) || c.type === CONSTRAINT_TYPES.OFFSET) {
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
            // Detect and store dimension mode ONLY during placement (unless a tool operation locks the mode)
            if (c.__placing) {
                const mode = c.__lockDimMode || detectDimMode(j1, j2, w);
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
                // TASK 1019 (R1-04): for a dimension born in this placement the upstream decision is ConstraintManager's (it names its reason);
                // the same-edge conflict follows the mode under the pointer NOW: passing through the mode of the pair's driving dimension on
                // the way to another mode no longer leaves the new dimension a reference.
                const upstream = c.__newlyPlaced === true ? !!c.drivenReason : !!(c.isDriven || c.driven);
                const isReference = !!(upstream || c._forcedDriven || hasConflict);
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

// ── R1-15 / R1-11: the DEFAULT placement of a new dimension's label (one function; every dimension born without a placement of its own takes it) ──
// A label is placed where it does not sit on another label or on the drawing: a CIRCLE's diameter label just outside its rim, at the first of the angles
// 0, +45, -45, +90 ... degrees whose label point is clear of every other label and whose leader (rim -> label) touches no other shape (concentric
// circles stagger around the centre instead of piling up on +X; a hole's leader turns away from a slot); a LINEAR dimension takes an offset scaled to the
// length it measures (a long part is not given a 30 mm gap on an 80 mm edge), stepped outward until clear of the other labels.
const LABEL_GAP = 12;          // world units: two label points closer than this overlap (a label is about this wide at the usual zoom)
const RIM_GAP = 8;             // a circle's label sits this far outside its rim
const SHAPE_CLEAR = 2;         // a label point / leader keeps this far from every other shape
const RADIAL_TRIES = [0, 45, -45, 90, -90, 135, -135, 180].map((d) => d * Math.PI / 180);
const LINEAR_STEP = 10;
const SAME_CENTRE_ANGLE = 40 * Math.PI / 180;   // two diameter labels round one centre are at least this far apart in angle

const centreOf = (shape, joints) => (shape && shape.joints && shape.joints[0] ? joints.get(shape.joints[0]) : null);

/** where an existing dimension's label sits (a point), or null when it has none that is known here */
function labelPointOf(c, joints, shapes) {
  if (c.glyphPos && Number.isFinite(c.glyphPos.x)) return { x: c.glyphPos.x, y: c.glyphPos.y };
  if (c.type !== CONSTRAINT_TYPES.DISTANCE) return null;
  const { j1, j2 } = resolveDimEndpoints(c, joints, shapes);
  if (!j1) return null;
  const off = Number.isFinite(c.offset) ? c.offset : (SolverConfig.DIMENSION_OFFSET || 30);
  if (c.isRadius && c.shape) {
    const a = Number.isFinite(c.labelAngle) ? c.labelAngle : 0;
    return { x: j1.x + Math.cos(a) * off, y: j1.y + Math.sin(a) * off };
  }
  if (!j2) return null;
  return linearParamsToPoint(linearDimFrame(c, j1, j2), off, Number.isFinite(c.labelSlide) ? c.labelSlide : 0);
}

const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
/** the distance from a point to a shape's drawn curve (line, circle, arc; any other kind: infinity) */
function distToShape(p, s, joints) {
  const j = (i) => (s.joints && s.joints[i] ? joints.get(s.joints[i]) : null);
  if (s.type === 'line') { const a = j(0), b = j(1); return a && b ? segDist(p, a, b) : Infinity; }
  if (s.type === 'circle') { const c = j(0); return c && Number.isFinite(s.radius) ? Math.abs(getDist(c, p) - s.radius) : Infinity; }
  if (s.type === 'arc') {
    const c = j(0), a = j(1), b = j(2);
    if (!c || !a || !b) return Infinity;
    const r = getDist(c, a);
    const info = arcSweepInfo(c, a, b, { sweep: s.sweep });
    return angleInArcSweep(info, Math.atan2(p.y - c.y, p.x - c.x)) ? Math.abs(getDist(c, p) - r) : Math.min(getDist(p, a), getDist(p, b));
  }
  return Infinity;
}
const clearOfShapes = (points, shapes, joints, except) => points.every((p) => shapes.every((s) => s.id === except || s.isConstruction || distToShape(p, s, joints) >= SHAPE_CLEAR));

/**
 * The default placement of the new DISTANCE dimension `c` (no placement of its own yet) among `state`'s joints, shapes and dimensions:
 * { offset, labelAngle } for a circle's diameter, { offset } for a linear one, null for any other kind (it keeps the renderer's default).
 */
export function defaultLabelPlacement(c, state) {
  if (!c || c.type !== CONSTRAINT_TYPES.DISTANCE || !state || !state.joints || !Array.isArray(state.shapes)) return null;
  const others = (state.constraints || []).map((k) => (k === c ? null : labelPointOf(k, state.joints, state.shapes))).filter(Boolean);
  const clearOfLabels = (p) => others.every((q) => getDist(p, q) >= LABEL_GAP);
  if (c.isRadius && c.shape) {
    const shape = state.shapes.find((s) => s.id === c.shape);
    const centre = shape && shape.type === 'circle' ? centreOf(shape, state.joints) : null;
    if (!centre || !(shape.radius > 0)) return null;
    const offset = shape.radius + RIM_GAP;
    // concentric circles stagger their ANGLE: a label keeps SAME_CENTRE_ANGLE away from the angle of every diameter label already round this centre
    const roundCentre = state.constraints.filter((k) => k !== c && k.type === CONSTRAINT_TYPES.DISTANCE && k.isRadius && k.shape).map((k) => {
      const s = state.shapes.find((x) => x.id === k.shape), o = s && s.type === 'circle' ? centreOf(s, state.joints) : null;
      return o && getDist(o, centre) < 1e-6 ? (Number.isFinite(k.labelAngle) ? k.labelAngle : 0) : null;
    }).filter((a) => a !== null);
    const apartFromRound = (a) => roundCentre.every((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) >= SAME_CENTRE_ANGLE);
    for (const a of RADIAL_TRIES) {
      if (!apartFromRound(a)) continue;
      const rim = { x: centre.x + Math.cos(a) * shape.radius, y: centre.y + Math.sin(a) * shape.radius };
      const label = { x: centre.x + Math.cos(a) * offset, y: centre.y + Math.sin(a) * offset };
      const mid = { x: (rim.x + label.x) / 2, y: (rim.y + label.y) / 2 };
      if (clearOfLabels(label) && clearOfShapes([label, mid], state.shapes, state.joints, shape.id)) return { offset, labelAngle: a };
    }
    return { offset, labelAngle: 0 };
  }
  const { j1, j2 } = resolveDimEndpoints(c, state.joints, state.shapes);
  if (!j1 || !j2) return null;
  const frame = linearDimFrame(c, j1, j2);
  const base = Math.max(10, Math.min(SolverConfig.DIMENSION_OFFSET || 30, 0.2 * frame.len));
  for (let i = 0; i < 4; i++) {
    const offset = base + i * LINEAR_STEP;
    if (clearOfLabels(linearParamsToPoint(frame, offset, 0))) return { offset };
  }
  return { offset: base };
}
