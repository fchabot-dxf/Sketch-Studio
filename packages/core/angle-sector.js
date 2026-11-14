// packages/core/angle-sector.js -- TASK 553: THE measured sector of an ANGLE dimension. One representation, pure (no DOM).
//
// Two lines through a vertex make eight sectors: four of at most 180 degrees and their four complements (reflex). A DRIVING angle
// dimension stores the one it measures as
//   sector: { ray1, ray2, turn }
//     ray1 / ray2  the ray of line 1 / line 2 (c.shapes order) that bounds it: +1 = the line's stored direction (joints[0] -> joints[1]),
//                  -1 = the opposite ray
//     turn         the sector runs from ray 1 to ray 2 counter-clockwise (+1, the way atan2 grows) or clockwise (-1)
// and c.value is its span in degrees, 0 < value <= 360 (Fusion's dimension box, task 551). The sector keeps its rays and its turn while the
// value changes, so a value edit opens or closes it continuously, past 180 included (Fusion: 170 -> 190 turns the line on to -170).
// The solver row (definitions.js angle) is zero iff turning ray 1 by turn * value lands on ray 2, i.e. iff the counter-clockwise angle from
// line 1's direction u to line 2's direction v is  turn * value + (ray1 != ray2 ? 180 : 0)  modulo 360 (not modulo 180).
// A REFERENCE dimension stores no sector: it measures the sector its label sits in (task 543), and takes one when it becomes driving.
// Old documents (no `sector`, maybe task 543's `supplement`) are converted ONCE, on load: legacyAngleSector below is the only reader of
// `supplement`.

import { getLineIntersection } from './geometry.js';

const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;
const unit = (x) => (x === -1 ? -1 : 1);
// the angular distance between two directions, 0..PI
const apart = (a, b) => Math.abs(norm(a - b + Math.PI) - Math.PI);

// No stored sector (a constraint built in code without one): the counter-clockwise sector from line 1's direction to line 2's, the
// meaning the stored CCW pair (task 511, constraint-manager orderAnglePairCCW) gives a value created at the measured angle.
export const DEFAULT_ANGLE_SECTOR = Object.freeze({ ray1: 1, ray2: 1, turn: 1 });

export function angleSectorOf(c) {
  const s = c && c.sector;
  return s ? { ray1: unit(s.ray1), ray2: unit(s.ray2), turn: unit(s.turn) } : { ...DEFAULT_ANGLE_SECTOR };
}

// The CCW angle (radians) the row holds from line 1's direction to line 2's direction, for a sector and a value in degrees.
export function angleSectorTarget(sector, valueDeg) {
  return sector.turn * (Number(valueDeg) || 0) * Math.PI / 180 + (sector.ray1 !== sector.ray2 ? Math.PI : 0);
}

// The arc of a sector between lines whose directions are d1, d2 (radians, joints[0] -> joints[1]): { start, end }, drawn counter-clockwise
// from start to end, end - start in [0, 2PI) = the span the geometry gives it now (the value, once solved).
export function angleSectorArc(sector, d1, d2) {
  const r1 = d1 + (sector.ray1 < 0 ? Math.PI : 0), r2 = d2 + (sector.ray2 < 0 ? Math.PI : 0);
  const from = sector.turn > 0 ? r1 : r2, to = sector.turn > 0 ? r2 : r1;
  return { start: from, end: from + norm(to - from) };
}

// The stored form of a sector given as an arc { start, end } (counter-clockwise) whose ends are rays of the two lines: each end is matched
// to the nearest of the four rays, the start to either line, the end to the other one.
export function angleSectorFromArc(arc, d1, d2) {
  const rays = (d) => [[1, d], [-1, d + Math.PI]];
  const nearest = (a, d) => { const [p, m] = rays(d); return apart(a, p[1]) <= apart(a, m[1]) ? p : m; };
  const s1 = nearest(arc.start, d1), s2 = nearest(arc.start, d2);
  if (apart(arc.start, s1[1]) <= apart(arc.start, s2[1])) return { ray1: s1[0], ray2: nearest(arc.end, d2)[0], turn: 1 };
  return { ray1: nearest(arc.end, d1)[0], ray2: s2[0], turn: -1 };
}

// The four sectors of at most 180 degrees (task 543), as arcs. d1, d2 = the line directions (radians); labelAngle = the direction from the
// intersection to the label; value = degrees (then only the two sectors whose span is nearest it qualify, the label picks which: the one
// it sits in, else the nearer) or null (the sector the label sits in). Returns { start, end }, end - start = the CCW span.
// Used for a REFERENCE dimension and the creation preview (value null), for the creation / promotion choice (angleSectorUnderLabel) and by
// the old-file conversion (the arc an old document drew).
export function angleDimensionSector(d1, d2, labelAngle, value) {
  const ccw = norm(d2 - d1);
  const first = ccw <= Math.PI ? d1 : d2;                  // the ray the +d1/+d2 sector starts from (CCW)
  const s = ccw <= Math.PI ? ccw : TAU - ccw;              // that sector's span, 0..PI
  const sectors = [
    { start: first, span: s },
    { start: first + s, span: Math.PI - s },
    { start: first + Math.PI, span: s },
    { start: first + Math.PI + s, span: Math.PI - s },
  ].map((x) => ({ start: x.start, end: x.start + x.span, span: x.span }));
  let pool = sectors;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const v = value * Math.PI / 180;
    const useS = Math.abs(s - v) <= Math.abs((Math.PI - s) - v);
    pool = sectors.filter((x, i) => (i % 2 === 0) === useS);
  }
  const l = norm(labelAngle);
  let best = null, bestScore = Infinity;
  for (const x of pool) {
    const mid = x.start + x.span / 2;
    const off = norm(l - x.start);
    const score = off <= x.span ? -1 : Math.abs(norm(l - mid + Math.PI) - Math.PI);
    if (score < bestScore) { bestScore = score; best = x; }
  }
  return { start: best.start, end: best.end };
}

// Where a dimension's label sits as a direction from the intersection (labelAngle, else glyphPos / __pos, else bisect).
export function angleLabelAngle(c, int, d1, d2) {
  if (Number.isFinite(c.labelAngle)) return c.labelAngle;
  const at = c.glyphPos || c.__pos;
  return at && int ? Math.atan2(at.y - int.y, at.x - int.x) : (d1 + d2) / 2;
}

// What a dimension whose label sits at `labelAngle` measures (a NEW dimension being placed, or a reference becoming driving): the sector of
// at most 180 degrees under the label (Fusion: the drop sector decides, task 543) -> { value (degrees), sector }.
export function angleSectorUnderLabel(d1, d2, labelAngle) {
  const arc = angleDimensionSector(d1, d2, labelAngle, null);
  return { value: (arc.end - arc.start) * 180 / Math.PI, sector: angleSectorFromArc(arc, d1, d2) };
}

// A line whose joints were swapped (constraint-manager alignParallelOrientation) points the other way: every DRIVING angle on it keeps
// measuring the same sector by naming that line's other ray.
export function reverseLineInAngleSectors(constraints, shapeId) {
  for (const c of constraints || []) {
    if (!c || c.type !== 'angle' || c.isDriven || c.driven || !Array.isArray(c.shapes)) continue;
    if (!c.shapes.includes(shapeId)) continue;
    const s = angleSectorOf(c);
    if (c.shapes[0] === shapeId) s.ray1 = -s.ray1;
    if (c.shapes[1] === shapeId) s.ray2 = -s.ray2;
    c.sector = s;
  }
}

// THE old-document conversion (document.js deserializeDocument, the one load path). An angle constraint without `sector` was stored by an
// older build: its row held the CCW angle from line 1 to line 2 at value MODULO 180 (or at -value, `supplement: true`, task 543) and it drew
// the sector of span value under its label. Returns the constraint as this build stores it: `supplement` dropped; a DRIVING one gets the
// sector that (1) its old row was holding in the loaded geometry (the old target nearest the current angle, so a solved drawing stays exactly
// where it is) and (2) is the arc it drew (else, the one of the two sectors of that row under its label). Geometry is not touched.
export function legacyAngleSector(c, joints, shapes) {
  if (!c || c.type !== 'angle' || c.sector) return c;
  const { supplement, ...rest } = c;
  if (rest.isDriven || rest.driven || !Array.isArray(rest.shapes) || rest.shapes.length !== 2) return rest;
  const lineJoints = (id) => { const s = shapes.find((x) => x && x.id === id); return s && s.joints && s.joints.length >= 2 ? [joints.get(s.joints[0]), joints.get(s.joints[1])] : null; };
  const l1 = lineJoints(rest.shapes[0]), l2 = lineJoints(rest.shapes[1]);
  if (!l1 || !l2 || !l1[0] || !l1[1] || !l2[0] || !l2[1]) return rest;
  const d1 = Math.atan2(l1[1].y - l1[0].y, l1[1].x - l1[0].x), d2 = Math.atan2(l2[1].y - l2[0].y, l2[1].x - l2[0].x);
  const value = Number(rest.value) || 0, v = value * Math.PI / 180;
  // (1) the old row turned the old way (+value, or -value with `supplement`) and held one of two targets (radians, CCW from u to v): the
  // one nearest the loaded geometry. Two sectors hold it (vertical opposites: both rays reversed).
  const turn = supplement === true ? -1 : 1;
  const theta = norm(d2 - d1);
  const old = [turn * v, turn * v + Math.PI];
  const target = apart(old[1], theta) < apart(old[0], theta) ? old[1] : old[0];
  const holding = [];
  for (const ray1 of [1, -1]) for (const ray2 of [1, -1]) if (apart(angleSectorTarget({ ray1, ray2, turn }, value), target) < 1e-9) holding.push({ ray1, ray2, turn });
  // (2) the arc the old build drew, when it is one of them; else the one the label sits in (else the nearest to it)
  const int = getLineIntersection(l1[0], l1[1], l2[0], l2[1]);
  const labelAngle = angleLabelAngle(rest, int, d1, d2);
  const drawn = angleSectorFromArc(angleDimensionSector(d1, d2, labelAngle, value), d1, d2);
  const same = (a, b) => a.ray1 === b.ray1 && a.ray2 === b.ray2 && a.turn === b.turn;
  let sector = holding.find((s) => same(s, drawn));
  if (!sector) {
    const score = (s) => { const a = angleSectorArc(s, d1, d2), span = a.end - a.start; return (norm(labelAngle - a.start) <= span ? 0 : 10) + apart(labelAngle, a.start + span / 2); };
    sector = holding.reduce((best, s) => (score(s) < score(best) ? s : best));
  }
  return { ...rest, sector: { ...sector } };
}
