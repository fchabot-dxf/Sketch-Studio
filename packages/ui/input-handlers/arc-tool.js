// Arc tool: Center Point Arc (centre, start, end) and TASK 1022 3-Point Arc (start, end, a point on the arc), described as data for the tool session
// (#ui/tool-session.js; task 1039, the plan's Arc migration, docs/INPUT-UNIFY-PLAN-1031.md 5.2 item 2). It never sees a pointer or a key: the translators
// turn a click, a drag's release, a tap, Enter in a box into the session's steps, and the session runs THE one build below once per arc, both variants.
import { TOOL_MODES, CONSTRAINT_TYPES, ARC_MODES } from '#core/constants.js';
import { makeArc } from '#core/shapes.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { applySnapConstraint, SNAP_JOIN } from '#core/snap-constraints.js';
import { boxValueText, SIZE_REFUSAL_HINT, refuseLength } from '#ui/numeric-input-manager.js';
import { angleBetween, circumcenter3Pt, arcSweepFor3Pt, arcSweepInfo } from '#core/geometry.js';
import { applyLiveAssign } from '#ui/input-handlers/base-tool.js';
import { defineTool, PICK } from '#ui/tool-session.js';

/** TASK 1028 (B-07): THE value rule of a typed sweep: an arc turns more than 0 and less than a full turn (0 and -90 were ignored, 360 / 720 made an arc whose
 *  ends are one point). The sweep box refuses by it (numeric-input-manager boxRefusal) and a sweep it refuses holds nothing (the session's rule). */
export const SWEEP_REFUSAL = 'A sweep must be more than 0 and less than 360 degrees.';
const refuseSweep = (v) => (v > 0 && v < 360 ? '' : SWEEP_REFUSAL);
/** TASK 1022: THE value rule of a 3-point arc's typed radius: a length (more than 0), and at least half the chord, the distance between the two ends. */
export const radiusTooSmallText = (minRadius) => `The radius must be at least half the distance between the arc's ends (${boxValueText(minRadius)}).`;
const halfChord = ({ start, end }) => dist(start.at, end.at) / 2;
const refuseThreePointRadius = (v, picks) => (!(v > 0) ? SIZE_REFUSAL_HINT : (v < halfChord(picks) - 1e-9 ? radiusTooSmallText(halfChord(picks)) : ''));
/** TASK 1022: the hint when the third point of a 3-point arc is on the line through its two ends (no circle goes through the three). */
export const COLLINEAR_ARC_HINT = 'No arc passes through three points on one line: move the third point off the line through the two ends.';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
/** the point `r` from `c` toward `p` (toward +x when `p` is on `c`: a typed length needs no direction) */
const along = (c, p, r) => { const d = dist(c, p); return d > 0 ? { x: c.x + (p.x - c.x) * r / d, y: c.y + (p.y - c.y) * r / d } : { x: c.x + r, y: c.y }; };
const typed = (v) => (v && v.typed ? v.value : null);
const onCircle = (c, r, a) => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

// ---- Center Point Arc: the end step. The pointer's path round the centre gives the winding direction (and a sweep past 180 degrees).
/** the winding the pointer made since the start: each hover adds its angle step (the short way); `total` < 0 = clockwise */
const WINDING = {
  from: ({ centre, start }) => ({ last: angleBetween(centre.at, start.at), total: 0 }),
  along: ({ centre }, w, p) => {
    const a = angleBetween(centre.at, p);
    let d = a - w.last;
    while (d <= -Math.PI) d += Math.PI * 2;
    while (d > Math.PI) d -= Math.PI * 2;
    return { last: a, total: w.total + d };
  },
};
const windingDir = (w) => (w.total < 0 ? -1 : 1);
/** THE end of a Center Point Arc: { at, sweep (the shape's flag), span (radians) } from the centre, the start, the pointer `p`, the typed sweep and the winding.
 *  A typed sweep is the arc's exact angle in the winding's direction; else the end is on the pointer's ray (nudged off an exact half turn, an SVG edge case). */
function centreArcEnd({ centre, start }, p, v, w) {
  const r = dist(centre.at, start.at);
  const a0 = angleBetween(centre.at, start.at);
  const sw = typed(v.sweep);
  if (sw !== null) return { at: onCircle(centre.at, r, a0 + windingDir(w) * sw * Math.PI / 180), sweep: windingDir(w) > 0, span: sw * Math.PI / 180, r };
  let a = angleBetween(centre.at, p);
  if (Math.abs(Math.abs(a - a0) - Math.PI) < 1e-9) a += 1e-6;
  return { at: onCircle(centre.at, r, a), sweep: w.total > 0, span: Math.abs(w.total), r };
}

// ---- 3-Point Arc
/**
 * TASK 1022: THE arc of the 3-Point mode from its start s, end e and the third point p: { center, radius, sweep } (sweep as an arc shape's: true = increasing
 * angle from s to e), or null when p is on the line through s and e. Untyped: the circle through the three points (#core/geometry.js circumcenter3Pt, the 3-point
 * arc slot's), the arc from s to e that passes through p. With a typed radius r (at least half the chord): the arc of radius r through s and e that bulges to p's
 * side, the short one or the long one as the arc through p would be (the circle through the three points has its centre on p's side of the chord: the long one).
 */
function threePointArcFor(s, e, p, radius) {
  const cc = circumcenter3Pt(s, e, p);
  if (!cc) return null;
  if (radius === null) return { center: cc.center, radius: cc.radius, sweep: arcSweepFor3Pt(cc.center, s, e, p) };
  const c = dist(s, e);
  const m = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
  const n = { x: -(e.y - s.y) / c, y: (e.x - s.x) / c };   // the chord's unit normal
  const side = Math.sign((p.x - m.x) * n.x + (p.y - m.y) * n.y);   // p's side of the chord (+1 / -1; not 0: p is off the line, cc exists)
  const long = Math.sign((cc.center.x - m.x) * n.x + (cc.center.y - m.y) * n.y) === side;
  const h = Math.sqrt(Math.max(0, radius * radius - (c / 2) * (c / 2)));
  const k = (long ? side : -side) * h;
  const center = { x: m.x + n.x * k, y: m.y + n.y * k };
  const apex = { x: center.x + n.x * side * radius, y: center.y + n.y * side * radius };   // the arc's point farthest on p's side: on the arc
  return { center, radius, sweep: arcSweepFor3Pt(center, s, e, apex) };
}
const threePointArc = ({ start, end }, p, v) => threePointArcFor(start.at, end.at, p, typed(v.radius));

/** the preview of an arc from `start` to `end` round `center` (the renderer's arc preview: resolved points, the winding the build gives the shape) */
const arcPreview = (center, start, end, sweep, at) => {
  const info = arcSweepInfo(center, start, end, { sweep });
  return { type: 'arc', fixed: [], at, props: { subMode: ARC_MODES.CENTER_START_END, center: { x: center.x, y: center.y }, radius: dist(center, start), startAngle: angleBetween(center, start), endAngle: angleBetween(center, end), largeArc: info.span > Math.PI, sweep } };
};

/**
 * THE build of an Arc tool arc, both variants (the one commit for a click, a drag's release, a tap and Enter): the arc shape on its three joints (makeArc: its
 * structural constraints), its direction `sweep`, a typed radius's dimension (TASK 597; with its formula / name / `param = expr`), the 3-Point Arc's typed
 * chord as a distance between its two ends (TASK 1022, the 3-point arc slot's typed span) and its third click on an existing POINT put on the arc, the kept
 * snaps of the clicks (coincident / point-on-line / midpoint, applySnapConstraint), all in the draw's ONE undo step. A typed sweep's `param = value` updates
 * that parameter (TASK 1028, B-13). The session dropped every snap a typed value positions.
 */
function buildArc(state, picks) {
  const three = !!picks.onArc;
  let c, s, e, sweep, radiusValue, radius;
  const joint = (p) => { const id = state.genJ(); state.joints.set(id, { x: p.x, y: p.y, fixed: false }); return id; };
  state.saveState();
  if (three) {   // the joints in the order the 3-Point Arc places them: start, end, centre
    const arc = threePointArc(picks, picks.onArc.at, picks.onArc.values);
    s = joint(picks.start.at); e = joint(picks.end.at); c = joint(arc.center);
    sweep = arc.sweep; radius = arc.radius; radiusValue = picks.onArc.values.radius;
  } else {
    const end = centreArcEnd(picks, picks.end.at, picks.end.values, picks.end.path);
    c = joint(picks.centre.at); s = joint(picks.start.at); e = joint(picks.end.at);
    sweep = end.sweep; radius = end.r; radiusValue = picks.start.values.radius;
    const sw = picks.end.values.sweep;
    if (sw.typed && sw.assign) applyLiveAssign(state, sw.assign);
  }
  const res = makeArc(state.joints, c, s, e, 'CENTER', state.isConstructionMode || false);
  res.shapes.forEach((sh) => state.shapes.push(sh));
  res.constraints.forEach((k) => ConstraintManager.createConstraint(state, k.type, k, { source: 'arc' }));
  const shape = res.shapes[0];
  shape.sweep = sweep;   // the winding DIRECTION (the large-arc choice is derived from the joints, geometry.arcSweepInfo, task 550)
  if (radiusValue.typed) {
    if (radiusValue.assign) applyLiveAssign(state, radiusValue.assign);
    ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { shape: shape.id, value: radius, isRadius: true, expression: radiusValue.expression, ...(radiusValue.name ? { name: radiusValue.name } : {}) }, { source: 'arc' });
  }
  if (three) {
    const ch = picks.end.values.chord;
    if (ch.typed) {
      if (ch.assign) applyLiveAssign(state, ch.assign);
      ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.DISTANCE, { joints: [s, e], value: ch.value, expression: ch.expression, ...(ch.name ? { name: ch.name } : {}) }, { source: 'arc' });
    }
    const on = picks.onArc.snap;   // a third click on an existing POINT puts it on the arc; a line / curve / axis only gave the position
    if (on && on.type === 'joint' && state.joints.has(on.id || on.targetId)) ConstraintManager.createConstraint(state, CONSTRAINT_TYPES.POINT_ON_LINE, { joint: on.id || on.targetId, shape: shape.id }, { source: 'arc' });
  } else if (picks.centre.snap) applySnapConstraint(state, c, picks.centre.snap, { join: SNAP_JOIN.DRAW });
  // TASK 1045: a drawing snap (SNAP_JOIN.DRAW): the start / end on an existing curve end point SHARES it (its new joint is merged and gone)
  if (picks.start.snap) applySnapConstraint(state, s, picks.start.snap, { join: SNAP_JOIN.DRAW });
  if (picks.end.snap) applySnapConstraint(state, e, picks.end.snap, { excludeJoints: [shape.joints[1]], join: SNAP_JOIN.DRAW });
}

export const ARC = defineTool({
  tool: TOOL_MODES.ARC,
  variantKey: 'arcMode',
  variants: {
    // Center Point Arc (Fusion's): the centre, the start (TASK 597: the RADIUS box; a typed radius puts the start at that distance on the pointer's ray),
    // the end (the SWEEP box, degrees: a typed sweep is the arc's exact angle, its direction the pointer's winding)
    [ARC_MODES.CENTER_START_END]: {
      steps: [
        { id: 'centre', pick: PICK.point, fires: 'press' },
        {
          id: 'start', pick: PICK.point, fires: 'release',
          boxes: [{ id: 'radius', quantity: 'length', positions: true, refuse: refuseLength, live: ({ centre }, p) => dist(centre.at, p) }],
          resolve: ({ centre }, p, v) => (v.radius.typed ? along(centre.at, p, v.radius.value) : p),
          tooSmall: ({ centre }, p) => [dist(centre.at, p)],   // TASK 782: a start on the centre makes no arc (the draw keeps waiting)
          // TASK 1039: the radius line, centre to the start the step will place (a typed radius holds its length): drawn now that the centre is held
          preview: ({ centre }, p, v) => ({ type: 'line', fixed: [centre.at], at: v.radius.typed ? along(centre.at, p, v.radius.value) : p }),
        },
        {
          id: 'end', pick: PICK.point, fires: 'release', path: WINDING,
          boxes: [{ id: 'sweep', quantity: 'angle', positions: true, refuse: refuseSweep, live: (picks, p, v, w) => Math.min(Math.abs(w.total) * 180 / Math.PI, 360) }],
          resolve: (picks, p, v, w) => centreArcEnd(picks, p, v, w).at,
          tooSmall: (picks, p, v, w) => { const end = centreArcEnd(picks, p, v, w); return [end.r * end.span]; },   // A-3: an end with no sweep places nothing
          preview: (picks, p, v, w) => { const end = centreArcEnd(picks, p, v, w); return arcPreview(picks.centre.at, picks.start.at, end.at, end.sweep, typed(v.sweep) !== null ? end.at : p); },
        },
      ],
    },
    // TASK 1022 3-Point Arc (the 3-point arc slot's order, Fusion-measured 2026-11-27): the start, the end (the CHORD box: a typed chord puts the end at
    // that distance on the pointer's ray), a point the arc passes through (the RADIUS box: a typed radius, at least half the chord, bulging to the point's side)
    [ARC_MODES.THREE_POINT]: {
      steps: [
        { id: 'start', pick: PICK.point, fires: 'press' },
        {
          id: 'end', pick: PICK.point, fires: 'release',
          boxes: [{ id: 'chord', quantity: 'length', positions: true, refuse: refuseLength, live: ({ start }, p) => dist(start.at, p) }],
          resolve: ({ start }, p, v) => (v.chord.typed ? along(start.at, p, v.chord.value) : p),
          tooSmall: ({ start }, p) => [dist(start.at, p)],   // TASK 782: an end on the start makes no arc
          preview: ({ start }, p, v) => ({ type: 'line', fixed: [start.at], at: v.chord.typed ? along(start.at, p, v.chord.value) : p }),
        },
        {
          id: 'onArc', pick: PICK.point, fires: 'release',
          boxes: [{ id: 'radius', quantity: 'length', positions: true, refuse: refuseThreePointRadius, live: (picks, p) => { const a = threePointArc(picks, p, { radius: { typed: false } }); return a ? a.radius : null; } }],
          refuse: (picks, p, v) => (threePointArc(picks, p, v) ? '' : COLLINEAR_ARC_HINT),
          preview: (picks, p, v) => {
            const a = threePointArc(picks, p, v);
            return a ? arcPreview(a.center, picks.start.at, picks.end.at, a.sweep, p) : { type: 'line', fixed: [picks.start.at], at: picks.end.at };
          },
        },
      ],
    },
  },
  build: buildArc,
  after: 'stay',
});
