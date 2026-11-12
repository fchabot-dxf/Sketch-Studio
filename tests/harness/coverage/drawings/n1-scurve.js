// NEW DRAWING N1 -- S-CURVE of tangent arcs: line -> arc -> arc -> line, every joint shared (a line ends ON the arc rim, the two arcs share one
// rim joint Q). Covers tangent line/arc (endpoint form), tangent arc/arc (external, two different radii) and the arc radius dimension.
import { point, line, arc, origin } from '../../audit/lib.js';

export const NAME = 'scurve';
export const TITLE = 'S-curve: line - arc - arc - line, all tangent';

export const RECIPE = [
  { label: 'P0 at the origin', type: 'coincident', joints: ['P0', origin] },
  { label: 'l1 horizontal', type: 'horizontal', joints: ['P0', 'P1'] },
  { label: 'l1 length 40', type: 'distance', joints: ['P0', 'P1'], value: 40, dimMode: 'horizontal' },
  { label: 'l1 tangent to arc a1', type: 'tangent', line: 'l1', circle: 'a1' },
  { label: 'arc a1 radius 30', type: 'distance', shape: 'a1', isRadius: true, value: 30 },
  { label: 'a1 quarter turn: C1-Q horizontal', type: 'horizontal', joints: ['C1', 'Q'] },
  { label: 'arc a1 tangent to arc a2', type: 'tangent', shapes: ['a1', 'a2'] },
  { label: 'arc a2 radius 25', type: 'distance', shape: 'a2', isRadius: true, value: 25 },
  { label: 'l2 horizontal', type: 'horizontal', joints: ['R', 'P3'] },
  { label: 'l2 tangent to arc a2', type: 'tangent', line: 'l2', circle: 'a2' },
  { label: 'l2 length 40', type: 'distance', joints: ['R', 'P3'], value: 40, dimMode: 'horizontal' },
];

export function build(S) {
  const P0 = point(S, 0, 0), P1 = point(S, 40, 0), C1 = point(S, 40, 30), Q = point(S, 70, 30), C2 = point(S, 95, 30), R = point(S, 95, 55), P3 = point(S, 135, 55);
  const names = { P0, P1, C1, Q, C2, R, P3 };
  names.l1 = line(S, P0, P1);
  names.a1 = arc(S, C1, P1, Q);
  names.a2 = arc(S, C2, Q, R);
  names.l2 = line(S, R, P3);
  return { names, probes: { redundant: { joints: ['P0', 'P3'] }, conflict: { joints: ['P0', 'P3'] }, delete: { type: 'distance', joints: ['P0', 'P1'] } } };
}
