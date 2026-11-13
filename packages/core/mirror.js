// packages/core/mirror.js - task 585: MIRROR, like Fusion's Sketch > Create > Mirror (measured by the advisor in Fusion, WORK-LOG TURN 585,
// docs/FUSION-COMPARISON.md "Mirror (task 585)"). PURE (no DOM). The Mirror tool (packages/ui/input-handlers/mirror-tool.js) calls it.
//
// RESULT (Fusion's, measured): a mirrored COPY of the objects in the ACTIVE sketch, tied to the originals by SYMMETRIC constraints about the
// mirror line (#core/symmetric.js forms, unchanged) and by nothing else: no constraint and no dimension of the originals is copied, so the
// copy has no dimension of its own and follows every edit of the originals.
//   POINTS  every point of the objects gets its OWN copy point at its mirror image, linked by a point symmetric { joints: [p, p'], line }.
//           Points joined in the objects (a shared joint, or a coincident cluster: the line tool's chains and the rectangles join their
//           corners that way) become ONE copy point (the copy's corners are shared joints, so a chain stays connected and a rectangle stays
//           closed) with ONE link (from the cluster's first point). A point ON the mirror line still gets its own copy point (measured).
//   SHAPES  MIRROR_KINDS below, one entry per shape kind (a kind not listed is refused).
// One undo step is the caller's (the tool wraps this in recordConstraintStep). Refusals are data: { ok: false, reason } and nothing changes.
import { CONSTRAINT_TYPES, ORIGIN_JOINT_ID } from './constants.js';
import { addConstraintObject } from './constraints.js';
import { getCoincidentJoints } from './joints.js';
import { findShapeById, isReferenceJointId, sceneJoints } from './reference-lines.js';
import { mirrorPoint } from './symmetric.js';
import { makeArc } from './shapes.js';
import { newShapeId } from './shape-id.js';
import { inertEntities } from './sketch-model.js';

// How each shape kind is copied and linked. `centre`: joints[0] is linked by the CIRCLE form of the symmetric ({ shapes: [s, s'], line }:
// centres mirror + radii equal) instead of a point pair; `copy(copy, src, M)`: the kind's own data mirrored (M = the mirror of a point);
// `own(copy)`: the constraints that DEFINE the kind (an arc's structural equal, makeArc's), made for the copy as for any new shape of the kind.
//   line    end points linked by point pairs (Fusion, measured: Symmetry(Pt, Pt) per end, no line symmetry).
//   circle  ONE circle-form symmetric (Fusion, measured: Symmetry(Circle, Circle')); the radius copied.
//   arc     the circle form (centre + equal radius) PLUS point pairs on its two ends, so the copy is the arc's true mirror image; its sweep
//           direction flips (a mirror reverses the turning sense). Not measured in Fusion: to verify in Fusion.
//   bezier  end points linked by point pairs; the two control points are shape DATA (not solver points, makeBezier's MVP limit), mirrored
//           once: they do not follow the original's later edits, exactly as the original's own control points do not follow its ends.
export const MIRROR_KINDS = Object.freeze({
  line: {},
  circle: { centre: true },
  arc: {
    centre: true,
    copy: (copy, src) => { if (typeof src.sweep === 'boolean') copy.sweep = !src.sweep; },
    own: (copy) => makeArc(null, copy.joints[0], copy.joints[1], copy.joints[2], copy.subType, !!copy.isConstruction).constraints,
  },
  bezier: {
    copy: (copy, src, M) => {
      const c1 = M({ x: src.c1[0], y: src.c1[1] }), c2 = M({ x: src.c2[0], y: src.c2[1] });
      copy.c1 = [c1.x, c1.y]; copy.c2 = [c2.x, c2.y];
    },
  },
});

export const MIRROR_UNDO_LABEL = 'mirror';

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// The objects as stored ids: { shapes: [...], joints: [...] } (the origin and the axes' reserved points are never objects).
export function mirrorObjectsOf(shapeIds, jointIds) {
  return {
    shapes: [...new Set(asList(shapeIds))],
    joints: [...new Set(asList(jointIds))].filter((j) => j !== ORIGIN_JOINT_ID && !isReferenceJointId(j)),
  };
}

// Why these objects cannot be mirrored, or null: nothing selected, an object in a locked sketch (task 577), a kind with no mirror rule.
export function mirrorObjectsRefusal(state, objects) {
  const shapes = objects.shapes.map((id) => state.shapes.find((s) => s.id === id)).filter(Boolean);
  const joints = objects.joints.filter((id) => state.joints.has(id));
  if (!shapes.length && !joints.length) return 'select the objects to mirror first';
  const inert = inertEntities(state);
  if (inert && (shapes.some((s) => inert.lockedS.has(s.id)) || joints.some((id) => inert.lockedJ.has(id)))) return 'an object is in a locked sketch';
  const odd = shapes.find((s) => !Object.prototype.hasOwnProperty.call(MIRROR_KINDS, s.type));
  if (odd) return `a ${odd.type} cannot be mirrored`;
  return null;
}

// Why `lineId` cannot be the mirror line of these objects, or null: it must be a line (a sketch line, a construction line or an axis) with a
// length, and not one of the objects (Fusion: not measured, to verify in Fusion; refused here).
export function mirrorLineRefusal(state, objects, lineId) {
  const line = lineId == null ? null : findShapeById(state.shapes, lineId);
  if (!line || line.type !== 'line') return 'pick the mirror line: a line, a construction line or the X / Y axis';
  if (objects.shapes.includes(line.id)) return 'the mirror line cannot be one of the objects to mirror';
  const J = sceneJoints(state.joints), a = J.get(line.joints[0]), b = J.get(line.joints[1]);
  if (!a || !b || !(Math.hypot(b.x - a.x, b.y - a.y) > 0)) return 'the mirror line has no length';
  return null;
}

/**
 * Mirror `objects` ({ shapes, joints } ids) about the line `lineId` (a sketch line or ref_axis_x / ref_axis_y).
 * → { ok: true, shapes: [new shape ids], joints: [new joint ids], constraints: [the added constraints] } or { ok: false, reason }.
 */
export function mirrorObjects(state, objects, lineId) {
  const why = mirrorObjectsRefusal(state, objects) || mirrorLineRefusal(state, objects, lineId);
  if (why) return { ok: false, reason: why };
  const line = findShapeById(state.shapes, lineId);
  const J = sceneJoints(state.joints), a = J.get(line.joints[0]), b = J.get(line.joints[1]);
  const M = (p) => mirrorPoint(p, a, b);

  const shapes = objects.shapes.map((id) => state.shapes.find((s) => s.id === id)).filter(Boolean);
  // the points of the objects, in a stable order (shape by shape, then the selected points)
  const points = [];
  for (const s of shapes) for (const j of s.joints) if (!points.includes(j)) points.push(j);
  for (const j of objects.joints) if (state.joints.has(j) && !points.includes(j)) points.push(j);
  // the clusters: points joined by a coincident constraint are one copy point (its first point is the cluster's link)
  const copyOf = new Map(), lead = [];
  for (const p of points) {
    if (copyOf.has(p)) continue;
    const id = state.genJ();
    for (const q of getCoincidentJoints(p, state.constraints)) if (points.includes(q)) copyOf.set(q, id);
    lead.push(p);
  }
  // a circle / arc centre is linked by the circle form, not by a point pair
  const centres = new Set(shapes.filter((s) => MIRROR_KINDS[s.type].centre).map((s) => copyOf.get(s.joints[0])));

  const out = { ok: true, shapes: [], joints: [], constraints: [] };
  const before = state.constraints.length;
  const add = (c) => { if (!addConstraintObject(state, c)) throw new Error('mirror: the constraint was not added: ' + JSON.stringify(c)); };
  for (const p of lead) {
    const m = M(state.joints.get(p));
    state.joints.set(copyOf.get(p), { x: m.x, y: m.y, fixed: false }); // no sketchId: the joints.set wrap stamps the ACTIVE sketch
    out.joints.push(copyOf.get(p));
  }
  const seq = newShapeId('');
  const groups = new Map();
  shapes.forEach((src, i) => {
    const { id, joints, sketchId, userGroupId, groupId, filletSharp, dragTarget, ...rest } = src; // the copy is no fillet's arc and in no user group
    const copy = { ...rest, id: `s${seq}_m${i}`, joints: joints.map((j) => copyOf.get(j)) };
    if (groupId) { if (!groups.has(groupId)) groups.set(groupId, `mirror_${seq}_${groups.size}`); copy.groupId = groups.get(groupId); }
    const kind = MIRROR_KINDS[src.type];
    if (kind.copy) kind.copy(copy, src, M);
    state.shapes.push(copy); // no sketchId: the shapes.push wrap stamps the ACTIVE sketch
    out.shapes.push(copy.id);
    if (kind.own) kind.own(copy).forEach(add);
  });
  for (const p of lead) if (!centres.has(copyOf.get(p))) add({ type: CONSTRAINT_TYPES.SYMMETRIC, joints: [p, copyOf.get(p)], line: line.id });
  shapes.forEach((src, i) => { if (MIRROR_KINDS[src.type].centre) add({ type: CONSTRAINT_TYPES.SYMMETRIC, shapes: [src.id, out.shapes[i]], line: line.id }); });
  out.constraints = state.constraints.slice(before);
  return out;
}
