// NEW DRAWING N3 -- COLLINEAR + CONCENTRIC + SYMMETRY-BY-MIDPOINT + POINT-ON-ARC. Two lines made collinear (shapes), a circle and an arc made
// concentric (their centre joints coincident), a segment E-F whose midpoint IS the circle centre (symmetry), and a point held on the arc.
import { point, line, circle, arc, origin } from '../../audit/lib.js';

export const NAME = 'collinear-concentric';
export const TITLE = 'Collinear lines, concentric circle + arc, midpoint symmetry, point on arc';

export const RECIPE = [
  { label: 'A at the origin', type: 'coincident', joints: ['A', origin] },
  { label: 'AB horizontal', type: 'horizontal', joints: ['A', 'B'] },
  { label: 'AB length 30', type: 'distance', joints: ['A', 'B'], value: 30, dimMode: 'horizontal' },
  { label: 'CD collinear with AB', type: 'collinear', shapes: ['lAB', 'lCD'] },
  { label: 'CD length 40', type: 'distance', joints: ['C', 'D'], value: 40, dimMode: 'horizontal' },
  { label: 'gap B-C 20', type: 'distance', joints: ['B', 'C'], value: 20, dimMode: 'horizontal' },
  { label: 'circle centre 45 right of the origin', type: 'distance', joints: [origin, 'O'], value: 45, dimMode: 'horizontal' },
  { label: 'circle centre 60 below A (the origin joint pair is taken by the H dim: F1)', type: 'distance', joints: ['A', 'O'], value: 60, dimMode: 'vertical' },
  { label: 'circle radius 15', type: 'distance', shape: 'ring', isRadius: true, value: 15 },
  { label: 'concentric: arc centre = circle centre', type: 'coincident', joints: ['ca', 'O'] },
  { label: 'arc radius 25', type: 'distance', shape: 'arc', isRadius: true, value: 25 },
  { label: 'arc start level with its centre', type: 'horizontal', joints: ['ca', 'sa'] },
  { label: 'arc end above its centre', type: 'vertical', joints: ['ca', 'sb'] },
  { label: 'E-F horizontal', type: 'horizontal', joints: ['E', 'F'] },
  { label: 'symmetry: O is the midpoint of E-F', type: 'midpoint', joints: ['E', 'F', 'O'] },
  { label: 'E-F length 70', type: 'distance', joints: ['E', 'F'], value: 70, dimMode: 'horizontal' },
  { label: 'point P on the arc', type: 'pointOnLine', joint: 'P', shape: 'arc' },
  { label: 'P 10 right of the arc centre', type: 'distance', joints: ['ca', 'P'], value: 10, dimMode: 'horizontal' },
];

export function build(S) {
  const names = {};
  names.A = point(S, 0, 0); names.B = point(S, 30, 0); names.C = point(S, 50, 5); names.D = point(S, 90, -3);
  names.lAB = line(S, names.A, names.B); names.lCD = line(S, names.C, names.D);
  const c = circle(S, 45, 60, 15); names.O = c.c; names.ring = c.id;
  names.ca = point(S, 46, 61); names.sa = point(S, 71, 61); names.sb = point(S, 46, 36);
  names.arc = arc(S, names.ca, names.sa, names.sb);
  names.E = point(S, 10, 100); names.F = point(S, 80, 100); names.lEF = line(S, names.E, names.F, true);
  names.P = point(S, 56, 60 - Math.sqrt(25 * 25 - 100));
  return { names, probes: { redundant: { joints: ['A', 'B'] }, conflict: { joints: ['A', 'B'] }, delete: { type: 'distance', joints: ['A', 'B'] } } };
}
