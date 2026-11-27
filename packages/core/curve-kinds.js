// packages/core/curve-kinds.js — TASK 761: THE GEOMETRY OF EACH CURVE KIND, declared ONCE. Every reader of a curve's shape between its two end joints
// reads it here: the loop finder (#core/loop-finder: which joints a curve joins, the direction it leaves an end in, the area it adds to a face), the
// loop / chain geometry (#core/loop-geometry: polygons, SVG paths), the hold part walk (#core/hold-part), the chain footprint (#core/profile-model),
// the plotter's polylines (#core/core-shape-to-polyline), Prepare's edges and picking, and the SketchStudio SVG / DXF export.
//
// A kind declares:
//   min                   the joints a shape of the kind has at least
//   ends(joints)          its two END joints, start then end (a chain of curves passes through these)
//   leave(s, J, atEnd)    the direction it LEAVES an end in ({ dx, dy } along the curve, from its start when atEnd is false, from its end walking back
//                         when true) and `bend`, its signed curvature there (+ turns left / counter-clockwise), or null. A kind without `leave` is straight:
//                         its direction is its chord (the loop finder keeps today's exact arithmetic for a line).
//   bulge(s, J)           the signed area between the curve walked start -> end and its chord (end -> start back along the chord): 0 for a line. Exact
//                         (an arc: the circular segment; a bezier: Green's integral by 3-point Gauss-Legendre, exact for its degree-5 integrand).
//   points(s, state, n)   the curve sampled start -> end ([{x, y}], both ends included): a line its two joints; an arc the rendered curve (sampleArc, n
//                         samples, as before); a bezier at CURVE_TOLERANCE_MM (chord deviation, the step count from the de Casteljau bound).
//   pathSeg(s, state, from, to)  the SVG path command from `from` to `to` (no M): `L`, a direction-aware `A`, a cubic `C` (control points in the walk's order).
// A shape whose kind is not declared here (a circle: a closed curve with no ends) is no curve between ends.

import { calculateArcPath, arcSweepInfo } from './geometry.js';
import { flattenCubic } from './svg-import.js'; // the ONE cubic flattener (de Casteljau), here with the step count the tolerance asks for
import { TOOL_MODES, MIRROR_STEPS } from './constants.js';
import { exportForm } from './origin-rules.js'; // TASK 803: the written number's decimals are the Origin rules' (geomDecimals)

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The CHORD DEVIATION (base mm) a bezier is sampled at wherever a polyline stands for it (loop polygons: containment, picking, offsets, the pocket
 *  clearing and hold part regions, the 3D Review; the plotter's strokes): the same 0.005 mm the hold part and the pocket clearing sample arcs at
 *  (HOLD_PART.chordTolMm, POCKET_CLEARING.chordTolMm), far below a router bit's or a pen's own error. The document and the exported files keep the
 *  exact cubic. */
export const CURVE_TOLERANCE_MM = 0.005;
/** A bound on the steps of one bezier (a huge curve at the tolerance): 2048 segments. */
export const BEZIER_MAX_STEPS = 2048;

// SVG path number: <= geomDecimals dp (4: #core/origin-rules.js), trailing zeros trimmed, no "-0" (world units = base mm). (Moved here from #core/loop-geometry, which re-exports it.)
const GEOM_SCALE = 10 ** exportForm('geomDecimals');
export function num(n) {
  let r = Math.round(Number(n) * GEOM_SCALE) / GEOM_SCALE;
  if (Object.is(r, -0)) r = 0;
  return String(r);
}

// Sample an arc shape into points (start→end) using the SAME path math the renderer uses (TRUE curve, not chord). Needs the DOM (the browser SVG
// path API); in Node it degrades to the endpoints. (Moved here unchanged from #core/loop-geometry, which re-exports it.)
// TASK 817: a computation can be handed the samples of a sketch's arcs instead (withArcSamples): a module WORKER has no SVG DOM, so the page samples its
// arcs here, with the DOM (arcSamplesOf), hands the table over, and the worker's derivation reads exactly those points (the same polygons, the same file
// as on the page). An arc the table lacks is an error there, never its endpoints in its place.
let suppliedArcs = null; // { N, byId: { [shape id]: [{x, y}] } } while a withArcSamples computation runs
/** The samples of every arc of `state` at N points (this function's: the DOM's where there is one), as withArcSamples takes them. */
export function arcSamplesOf(state, N = 24) {
  const byId = {};
  for (const s of state.shapes || []) if (s && s.type === 'arc') byId[s.id] = sampleArc(s, state, N);
  return { N, byId };
}
/** fn() with sampleArc reading `table` (arcSamplesOf's, or null: sampleArc as above). Returns fn's result. */
export function withArcSamples(table, fn) {
  const prev = suppliedArcs;
  suppliedArcs = table || null;
  try { return fn(); } finally { suppliedArcs = prev; }
}
export function sampleArc(s, state, N = 24) {
  if (suppliedArcs) {
    const pts = suppliedArcs.N === N ? suppliedArcs.byId[s.id] : undefined;
    if (!pts) throw new Error(`arc samples not supplied for ${s.id} at ${N} points`);
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }
  const [p1, p2, p3] = (s.joints || []).map((id) => state.joints.get(id));
  if (!p1 || !p2 || !p3) return [];
  const d = calculateArcPath(p1, p2, p3, s.subType, { sweep: s.sweep });
  // TASK 847: the arc's two ENDS, start -> end (a CENTER arc's joints are [centre, start, end]: p2, p3; this returned the centre p1 for its start)
  const ends = () => [{ x: p2.x, y: p2.y }, { x: p3.x, y: p3.y }];
  if (typeof document === 'undefined' || !document.createElementNS) return ends();
  const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d);
  let len = 0; try { len = path.getTotalLength(); } catch (_) {}
  if (!len) return ends();
  const pts = [];
  for (let i = 0; i <= N; i++) { try { const pt = path.getPointAtLength((i / N) * len); pts.push({ x: pt.x, y: pt.y }); } catch (_) {} }
  return pts;
}

// An arc's `A` command from fromPos to toPos, walked either way (moved here unchanged from #core/loop-geometry).
function arcSeg(shape, fromPos, toPos, state) {
  const center = state.joints.get(shape.joints[0]);
  const start = state.joints.get(shape.joints[1]);
  const end = state.joints.get(shape.joints[2]);
  if (!center || !start || !end) return `L ${num(toPos.x)} ${num(toPos.y)}`;
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  const info = arcSweepInfo(center, start, end, { sweep: shape.sweep });   // TASK 550: direction + derived large-arc, one function
  const stored = info.dir > 0 ? 1 : 0;
  const forward = Math.hypot(fromPos.x - start.x, fromPos.y - start.y) <= Math.hypot(fromPos.x - end.x, fromPos.y - end.y);
  const sweep = forward ? stored : (stored ? 0 : 1);
  const largeArc = info.large ? 1 : 0;
  return `A ${num(r)} ${num(r)} 0 ${largeArc} ${sweep} ${num(toPos.x)} ${num(toPos.y)}`;
}

// an arc's centre, start, end, radius and sweep (arcSweepInfo: the stored direction), or null
function arcParts(s, J) {
  const c = J.get(s.joints[0]), a = J.get(s.joints[1]), b = J.get(s.joints[2]);
  if (!c || !a || !b) return null;
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  if (!(r > 0)) return null;
  return { c, a, b, r, info: arcSweepInfo(c, a, b, { sweep: s.sweep }) };
}

/** A bezier shape's four points [P0, P1, P2, P3] ({x, y}: its end joints and its two control points, shape data c1 / c2), or null. */
export function bezierPoints(s, J) {
  const a = J.get(s.joints[0]), b = J.get(s.joints[s.joints.length - 1]);
  if (!a || !b || !Array.isArray(s.c1) || !Array.isArray(s.c2)) return null;
  return [{ x: a.x, y: a.y }, { x: s.c1[0], y: s.c1[1] }, { x: s.c2[0], y: s.c2[1] }, { x: b.x, y: b.y }];
}
const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
const cross = (u, v) => u.x * v.y - u.y * v.x;
const len = (u) => Math.hypot(u.x, u.y);
// leaving P0 of the cubic P (P1 - P0; P2 - P0 / P3 - P0 when the control point sits on the end) and the signed curvature there
function cubicLeave(P) {
  const d1 = sub(P[1], P[0]), d2 = sub(P[2], P[0]), d3 = sub(P[3], P[0]);
  const eps = 1e-12;
  const dir = len(d1) > eps ? d1 : len(d2) > eps ? d2 : d3;
  if (!(len(dir) > eps)) return null;
  const b1 = { x: 3 * d1.x, y: 3 * d1.y }, b2 = { x: 6 * (P[2].x - 2 * P[1].x + P[0].x), y: 6 * (P[2].y - 2 * P[1].y + P[0].y) };
  const s = len(b1);
  return { dx: dir.x, dy: dir.y, bend: s > eps ? cross(b1, b2) / (s * s * s) : 0 };
}
const GL3 = [[0.5 - Math.sqrt(15) / 10, 5 / 18], [0.5, 8 / 18], [0.5 + Math.sqrt(15) / 10, 5 / 18]];
// the signed area under the cubic, 1/2 ∫ (x y' - y x') dt over [0, 1] (degree 5: 3-point Gauss-Legendre is exact), minus its chord's share
function cubicBulge(P) {
  let I = 0;
  for (const [t, w] of GL3) {
    const u = 1 - t;
    const x = u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x;
    const y = u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y;
    const dx = 3 * (u * u * (P[1].x - P[0].x) + 2 * u * t * (P[2].x - P[1].x) + t * t * (P[3].x - P[2].x));
    const dy = 3 * (u * u * (P[1].y - P[0].y) + 2 * u * t * (P[2].y - P[1].y) + t * t * (P[3].y - P[2].y));
    I += w * (x * dy - y * dx);
  }
  return I / 2 - (P[0].x * P[3].y - P[3].x * P[0].y) / 2;
}
/** The steps a cubic is sampled in for a chord deviation <= tol: deviation <= (1/8) max|B''| / n^2 with max|B''| <= 6 max(|P0 - 2P1 + P2|, |P1 - 2P2 + P3|). */
export function bezierSteps(P, tol = CURVE_TOLERANCE_MM) {
  const m = Math.max(Math.hypot(P[0].x - 2 * P[1].x + P[2].x, P[0].y - 2 * P[1].y + P[2].y), Math.hypot(P[1].x - 2 * P[2].x + P[3].x, P[1].y - 2 * P[2].y + P[3].y));
  return Math.min(BEZIER_MAX_STEPS, Math.max(1, Math.ceil(Math.sqrt((0.75 * m) / tol))));
}

export const CURVE_KINDS = Object.freeze({
  line: {
    min: 2,
    ends: (j) => [j[0], j[1]],
    bulge: () => 0,
    points(s, state) { const a = state.joints.get(s.joints[0]), b = state.joints.get(s.joints[1]); return a && b ? [a, b] : []; },
    pathSeg: (s, state, from, to) => `L ${num(to.x)} ${num(to.y)}`,
  },
  arc: {
    min: 3,
    ends: (j) => [j[1], j[2]], // joints[0] is its centre
    leave(s, J, atEnd) {
      const p = arcParts(s, J);
      if (!p) return null;
      const at = atEnd ? p.b : p.a, g = atEnd ? -p.info.dir : p.info.dir; // walking back from the end turns the other way
      return { dx: -(at.y - p.c.y) * g, dy: (at.x - p.c.x) * g, bend: g / p.r };
    },
    bulge(s, J) { const p = arcParts(s, J); return p ? (p.info.dir * p.r * p.r * (p.info.span - Math.sin(p.info.span))) / 2 : 0; },
    points: (s, state, n = 24) => sampleArc(s, state, n),
    pathSeg: (s, state, from, to) => arcSeg(s, from, to, state),
  },
  bezier: {
    min: 2,
    ends: (j) => [j[0], j[j.length - 1]],
    leave(s, J, atEnd) { const P = bezierPoints(s, J); return P ? cubicLeave(atEnd ? P.slice().reverse() : P) : null; },
    bulge(s, J) { const P = bezierPoints(s, J); return P ? cubicBulge(P) : 0; },
    points(s, state) {
      const P = bezierPoints(s, state.joints);
      if (!P) return [];
      const pts = [P[0]];
      flattenCubic(P[0].x, P[0].y, P[1].x, P[1].y, P[2].x, P[2].y, P[3].x, P[3].y, (x, y) => pts.push({ x, y }), bezierSteps(P));
      pts[pts.length - 1] = P[3]; // the end joint itself (t = 1)
      return pts;
    },
    pathSeg(s, state, from, to) {
      const P = bezierPoints(s, state.joints);
      if (!P) return `L ${num(to.x)} ${num(to.y)}`;
      const forward = Math.hypot(from.x - P[0].x, from.y - P[0].y) <= Math.hypot(from.x - P[3].x, from.y - P[3].y);
      const [c1, c2] = forward ? [P[1], P[2]] : [P[2], P[1]];
      return `C ${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(to.x)} ${num(to.y)}`;
    },
  },
});

/** BUG-300 (F-81 / F-81b): what a drawing EXPORTS, declared once: the drawn kinds (circles included) and never construction geometry (a helper, not part
 *  of the design: Fusion leaves it out of its export too). A text's letters are lines and beziers (exported); the text record itself is not. Read by the
 *  SketchStudio SVG / DXF writer and (TASK 1036, BUG-372) the design thumbnail, so the thumbnail draws what the export draws. */
export const EXPORTED_TYPES = Object.freeze(['line', 'arc', 'bezier', 'circle']);
export const exportedShapes = (state) => state.shapes.filter((s) => s && EXPORTED_TYPES.includes(s.type) && !s.isConstruction);

/** The kind declaration of shape s (CURVE_KINDS), or null when it is no curve between two ends (a circle, an unknown kind, too few joints). */
export function curveKind(s) {
  const k = s && CURVE_KINDS[s.type];
  return k && Array.isArray(s.joints) && s.joints.length >= k.min ? k : null;
}

/** Shape s sampled from the end nearest `fromPos` to the other ([{x, y}], both ends), the kind's points; [] for no curve. */
export function curvePointsFrom(s, state, fromPos, n) {
  const k = curveKind(s);
  if (!k) return [];
  const pts = k.points(s, state, n);
  if (pts.length >= 2 && fromPos) {
    const d = (p) => (p.x - fromPos.x) ** 2 + (p.y - fromPos.y) ** 2;
    if (d(pts[pts.length - 1]) < d(pts[0])) return pts.slice().reverse();
  }
  return pts;
}

/** TASK 762: THE uses a curve kind has no maths for, declared ONCE, each with the reason the app's notice gives. A press on such a curve's BODY (THE shared
 *  pick, #ui/snap-detection.js findSnap) is refused with that reason instead of doing nothing (input-manager handlePointerDown, before the tool sees the
 *  press; the Mirror tool's line step reads its own key). Keys: a tool (#core/constants.js TOOL_MODES), `mirror:line` (Mirror's mirror-line pick) and
 *  `pointOnCurve` (a point held on the curve: a snap's point-on-curve constraint, #core/constraint-manager.js createConstraint). A use not listed takes the
 *  kind: for a bezier, Select (hover, click, drag, double click, box, the hold menu), Close path, Mirror's objects, and Offset, which gives its own reason
 *  (#core/offset.js offsetChainOf). What each refused tool would take is in WORK-LOG TURN 762. */
const NO_BEZIER = (what) => `${what}: not available on a Bezier curve`;
// TASK 1018: Trim and Break take lines, arcs and circles (#core/curve-cuts.js), so an arc or a circle refuses neither (task 1007 refused them).
export const CURVE_REFUSALS = Object.freeze({
  bezier: Object.freeze({
    [TOOL_MODES.TRIM]: NO_BEZIER('Trim') + ' (Trim cuts lines, arcs and circles only)',
    [TOOL_MODES.BREAK]: NO_BEZIER('Break') + ' (Break splits lines, arcs and circles only)',
    [TOOL_MODES.FILLET]: NO_BEZIER('Fillet') + ' (Fillet rounds corners of lines and arcs only)',
    [TOOL_MODES.DIMENSION]: NO_BEZIER('Dimension') + ' (pick its end points to dimension the distance between them)',
    [TOOL_MODES.COINCIDENT]: NO_BEZIER('Coincident') + ' (a point cannot be held on its curve: pick its end point)',
    [TOOL_MODES.HORIZONTAL_VERTICAL]: NO_BEZIER('Horizontal / Vertical') + ' (pick its two end points)',
    [TOOL_MODES.PARALLEL]: NO_BEZIER('Parallel') + ' (lines only)',
    [TOOL_MODES.PERPENDICULAR]: NO_BEZIER('Perpendicular') + ' (lines only)',
    [TOOL_MODES.COLLINEAR]: NO_BEZIER('Collinear') + ' (lines only)',
    [TOOL_MODES.TANGENT]: NO_BEZIER('Tangent') + ' (lines, circles and arcs only)',
    [TOOL_MODES.EQUAL]: NO_BEZIER('Equal') + ' (lines, circles and arcs only)',
    [TOOL_MODES.MIDPOINT]: NO_BEZIER('Midpoint') + ' (a point and a line or an arc only)',
    [TOOL_MODES.SYMMETRIC]: NO_BEZIER('Symmetric') + ' (points, lines, circles and arcs only)',
    [`${TOOL_MODES.MIRROR}:${MIRROR_STEPS.LINE}`]: NO_BEZIER('Mirror line') + ' (pick a line, a construction line or the X / Y axis)',
    pointOnCurve: 'Point on curve: a point cannot be held on a Bezier curve (it stays where it was placed, not held)',
  }),
});

/** TASK 845: THE uses a TEXT's letter refuses (a curve or a point marked textOutline: #core/text.js; its letters are derived from the text, so a
 *  tool may not reshape or constrain one alone), with the reason the notice gives. The same keys as CURVE_REFUSALS, plus Offset, Close path, Mirror
 *  and the two patterns (their copies are tied to their sources by constraints a letter cannot take). A use not listed takes it: Select (the whole
 *  text: hover, click, drag, the transform box, the hold menu), and the drawing tools, whose snap only lands on a letter's place
 *  (#ui/input-manager.js toolSnap: a position snap, nothing tied). The text's ANCHOR point is no letter: it takes every point use. */
const TEXT_LETTER = (what) => `${what}: not available on a text's letters (they are made from the text: double-click it to edit, or Convert to shapes to work on the curves)`;
export const TEXT_OUTLINE_REFUSALS = Object.freeze(Object.fromEntries([
  [TOOL_MODES.TRIM, 'Trim'], [TOOL_MODES.BREAK, 'Break'], [TOOL_MODES.CLOSE_PATH, 'Close path'], [TOOL_MODES.FILLET, 'Fillet'], [TOOL_MODES.OFFSET, 'Offset'],
  [TOOL_MODES.MIRROR, 'Mirror'], [`${TOOL_MODES.MIRROR}:${MIRROR_STEPS.LINE}`, 'Mirror line'], [TOOL_MODES.CIRCULAR_PATTERN, 'Circular Pattern'],
  [TOOL_MODES.RECTANGULAR_PATTERN, 'Rectangular Pattern'], [TOOL_MODES.DIMENSION, 'Dimension (its anchor point takes one)'],
  [TOOL_MODES.COINCIDENT, 'Coincident (its anchor point takes one)'], [TOOL_MODES.HORIZONTAL_VERTICAL, 'Horizontal / Vertical'], [TOOL_MODES.PARALLEL, 'Parallel'],
  [TOOL_MODES.PERPENDICULAR, 'Perpendicular'], [TOOL_MODES.COLLINEAR, 'Collinear'], [TOOL_MODES.TANGENT, 'Tangent'], [TOOL_MODES.EQUAL, 'Equal'],
  [TOOL_MODES.MIDPOINT, 'Midpoint'], [TOOL_MODES.SYMMETRIC, 'Symmetric'], ['pointOnCurve', 'Point on curve'],
].map(([use, what]) => [use, TEXT_LETTER(what)])));

/** The reason `use` (a CURVE_REFUSALS key) refuses shape s, or null when the use takes it. TASK 845: a text's letter (s.textOutline, a curve or a
 *  point) reads TEXT_OUTLINE_REFUSALS instead of its kind's. */
export function curveRefusal(s, use) {
  const r = s && (s.textOutline ? TEXT_OUTLINE_REFUSALS : CURVE_REFUSALS[s.type]);
  return (r && r[use]) || null;
}
