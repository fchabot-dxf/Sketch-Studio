// TASK 531 -- extreme arcs, part C: the UI-facing facts of an arc, measured in node. Hover, click and select all pick through ONE function, findSnap()
// (hover-manager.js:123, input-manager.js:417 / :600), so the pick of a tiny arc is measured by calling it on a stub svg at the default zoom (1 world unit = 1 px).
// The DOM-only parts (the select tool's getDragDOF mask, the stroke hit target of the path) are not reachable here: listed as limits in the doc.
import * as L from '../audit/lib.js';
import { findSnap } from '#ui/snap-detection.js';
import { SNAP } from '#core/constants.js';
import { SolverConfig } from '#core/solver-config.js';
import { svgStub } from './matrix-run.js';
import { buildArc, measureArc } from './arcs-variants.js';

const P = (S, id) => S.state.joints.get(id);
const pick = (S, x, y) => findSnap(S.state.joints, S.state.shapes, svgStub, { x, y }, [], false, false, 1);

// tolerances in force, quoted from the code (screen px unless noted)
export const TOLERANCES = {
  'SNAP.JOINT_PX (joint pick radius)': SNAP.JOINT_PX,
  'SNAP.LINE_PX (line / circle / arc pick radius)': SNAP.LINE_PX,
  'findSnap JOINT_PRIORITY_RADIUS (a joint this close always wins)': 15,
  'SolverConfig.SNAP_MAGNETISM (snap lock)': SolverConfig.SNAP_MAGNETISM,
  'SolverConfig.GEOMETRY_TOLERANCE (world, math pre-check "close enough")': SolverConfig.GEOMETRY_TOLERANCE,
  'SolverConfig.SNAP_WORLD_EPS (world, point snapped to a shape becomes coincident with its end)': SolverConfig.SNAP_WORLD_EPS,
  'SolverConfig.VERIFIER_TOLERANCE (world, "satisfied")': SolverConfig.VERIFIER_TOLERANCE,
  'SolverConfig.AUTO_COINCIDENT_TOL (world)': SolverConfig.AUTO_COINCIDENT_TOL,
};

// how the mouse can reach the arc: over every INTEGER pixel in a 15 x 15 window around each of its three joints, what does findSnap return? Then the arc body.
export function uiFacts(v) {
  const S = L.newSketch();
  const X = buildArc(S, v);
  const F = { c: P(S, X.joints[0]), s: P(S, X.joints[1]), e: P(S, X.joints[2]) };
  const m = measureArc(S, X.shape);
  const window = (pt) => {
    const counts = { start: 0, end: 0, centre: 0, arc: 0, other: 0, none: 0 };
    const x0 = Math.round(pt.x), y0 = Math.round(pt.y);
    for (let dx = -7; dx <= 7; dx++) for (let dy = -7; dy <= 7; dy++) {
      const r = pick(S, x0 + dx, y0 + dy);
      if (!r) counts.none++;
      else if (r.type === 'joint') counts[r.targetId === X.joints[1] ? 'start' : r.targetId === X.joints[2] ? 'end' : r.targetId === X.joints[0] ? 'centre' : 'other']++;
      else counts[r.targetId === X.shape ? 'arc' : 'other']++;
    }
    return counts;
  };
  const atEnd = window(F.e), atStart = window(F.s);
  // the arc body: the middle of the sweep, and the middle of the part of the CIRCLE the arc does not cover (mouse placed on the circle)
  const mid = (ang) => ({ x: F.c.x + m.R * Math.cos(ang), y: F.c.y + m.R * Math.sin(ang) });
  const a0 = Math.atan2(F.s.y - F.c.y, F.s.x - F.c.x);
  const onBody = mid(a0 + m.dir * m.span / 2), offBody = mid(a0 + m.dir * (m.span + (2 * Math.PI - m.span) / 2));
  const r1 = pick(S, onBody.x, onBody.y), r2 = pick(S, offBody.x, offBody.y);
  const name = (r) => (!r ? 'nothing' : r.type === 'joint' ? 'joint ' + (r.targetId === X.joints[1] ? 'start' : r.targetId === X.joints[2] ? 'end' : r.targetId === X.joints[0] ? 'centre' : '?') : (r.targetId === X.shape ? 'the arc' : 'a shape'));
  return {
    variant: v.id, chord: m.chord, spanDeg: m.spanDeg,
    // pixels around the END joint that return the END joint (0 = the end cannot be picked at the default zoom, only the start / the arc)
    endPixelsReturnEnd: atEnd.end, endPixelsReturnStart: atEnd.start, startPixelsReturnStart: atStart.start,
    endPickable: atEnd.end > 0,
    mouseOnArcBody: name(r1), mouseOnCircleOutsideSweep: name(r2),
    arcPickedOutsideSweep: !!r2 && r2.type === 'shape' && r2.targetId === X.shape,
    pathOk: m.pathOk, path: m.path, flagCoherent: m.flagCoherent,
  };
}
