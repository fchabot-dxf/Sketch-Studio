// NEW DRAWING N2 -- SLOT: two semicircular ends (arcs) joined by two lines, rim joints shared. Midpoint = the end's centre (diameter), four
// line/arc tangents, equal radius of the two arcs, centre distance and one radius dimension.
import { point, line, arc, origin } from '../../audit/lib.js';

export const NAME = 'slot';
export const TITLE = 'Slot: two arcs + two lines (4 tangents)';

export const RECIPE = [
  { label: 'left centre at the origin', type: 'coincident', joints: ['CL', origin] },
  { label: 'centres horizontal', type: 'horizontal', joints: ['CL', 'CR'] },
  { label: 'centre distance 50', type: 'distance', joints: ['CL', 'CR'], value: 50, dimMode: 'horizontal' },
  { label: 'left end is a diameter: midpoint(a1,b1)=CL', type: 'midpoint', joints: ['a1', 'b1', 'CL'] },
  { label: 'right end is a diameter: midpoint(a2,b2)=CR', type: 'midpoint', joints: ['a2', 'b2', 'CR'] },
  { label: 'top line tangent to left arc', type: 'tangent', line: 'top', circle: 'arcL' },
  { label: 'top line tangent to right arc', type: 'tangent', line: 'top', circle: 'arcR' },
  { label: 'bottom line tangent to left arc', type: 'tangent', line: 'bottom', circle: 'arcL' },
  { label: 'bottom line tangent to right arc', type: 'tangent', line: 'bottom', circle: 'arcR' },
  { label: 'arcs equal radius', type: 'equal', shapes: ['arcR', 'arcL'] },
  { label: 'radius 8', type: 'distance', shape: 'arcL', isRadius: true, value: 8 },
];

export function build(S) {
  const CL = point(S, 3, 2), CR = point(S, 52, 3);
  const a1 = point(S, 3, -6), b1 = point(S, 3, 10), a2 = point(S, 52, -5), b2 = point(S, 52, 11);
  const names = { CL, CR, a1, b1, a2, b2 };
  names.arcL = arc(S, CL, a1, b1);
  names.arcR = arc(S, CR, b2, a2);
  names.top = line(S, a1, a2); names.bottom = line(S, b1, b2);
  return { names, probes: { redundant: { joints: ['CL', 'CR'] }, conflict: { joints: ['CL', 'CR'] }, delete: { type: 'distance', joints: ['CL', 'CR'] } } };
}
