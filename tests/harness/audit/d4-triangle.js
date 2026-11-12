// DRAWING 4 -- TRIANGLE + CIRCLE: an isosceles triangle with an inscribed circle (three tangents). The circle's centre is placed by a
// construction: M = midpoint of the base AB, the construction axis C-M, and `pointOnLine(centre, axis)`. One equal-side pair (CA = CB) and
// one angle (at A). The circle's radius is the only size dimension (a circle's radius is shape data in this app, not a solver unknown).
import { point, line, polyline, circle, origin } from './lib.js';

export const NAME = 'triangle';
export const TITLE = 'Triangle + inscribed circle (three tangents)';

export const RECIPE = [
  { label: 'A at the origin', type: 'coincident', joints: ['A', origin] },
  { label: 'base AB horizontal', type: 'horizontal', joints: ['A', 'B'] },
  { label: 'equal sides CA = BC', type: 'equal', shapes: ['lCA', 'lBC'] },
  { label: 'interior angle at A = 70 (the dimension reads the angle between the directed lines AB and CA: 180 - 70)', type: 'angle', shapes: ['lAB', 'lCA'], value: 110 },
  { label: 'M = midpoint of the base', type: 'midpoint', joints: ['A', 'B', 'M'] },
  { label: 'circle centre on the axis C-M', type: 'pointOnLine', joint: 'I', shape: 'axis' },
  { label: 'circle tangent to AB', type: 'tangent', line: 'lAB', circle: 'ring' },
  { label: 'circle tangent to BC', type: 'tangent', line: 'lBC', circle: 'ring' },
  { label: 'circle tangent to CA (3rd: consistent by symmetry)', type: 'tangent', line: 'lCA', circle: 'ring' },
  { label: 'circle radius 20 (sets the size)', type: 'distance', shape: 'ring', isRadius: true, value: 20 },
];

export function build(S) {
  // the inscribed circle of A(0,0) B(100,0) C(50,70): r = area / s
  const seg = polyline(S, [[0, 0], [100, 0], [50, 70]]);   // A->B->C->A drawn with the line tool (coincident corners)
  const sa = Math.hypot(50, 70), s = (100 + 2 * sa) / 2, r = (100 * 70 / 2) / s;
  const names = { A: seg[0].a, B: seg[0].b, C: seg[1].b, lAB: seg[0].id, lBC: seg[1].id, lCA: seg[2].id };
  names.M = point(S, 50, 0);
  names.axis = line(S, names.C, names.M, true);
  const c = circle(S, 50, r, r);
  names.I = c.c; names.ring = c.id;
  return { names, probes: { redundant: { joints: ['A', 'C'] }, conflict: { joints: ['A', 'B'] }, delete: { type: 'angle' } } };
}
