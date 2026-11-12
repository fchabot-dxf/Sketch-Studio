// DRAWING 5 -- POLYGON + SPOKES: a regular hexagon from makePolygon (centre O, corners k0..k5, sides e0..e5, radials r0..r5), a concentric
// circle (centre coincident with O), two of the hexagon's edges (e1, e3) tangent to a second circle, and a construction axis through the
// midpoints of two opposite edges (M0 on e0, M3 on e3 ... see names) whose own midpoint is O.
import { point, circle, polygon, origin } from './lib.js';

export const NAME = 'polygon';
export const TITLE = 'Hexagon + concentric circle + tangent circle + midpoint axis';

export const RECIPE = [
  { label: 'centre O at the origin', type: 'coincident', joints: ['O', origin] },
  { label: 'circumradius O-k0 = 40', type: 'distance', joints: ['O', 'k0'], value: 40, dimMode: 'aligned' },
  { label: 'M0 = midpoint of edge e0 (k0,k1)', type: 'midpoint', joints: ['k0', 'k1', 'M0'] },
  { label: 'M3 = midpoint of the opposite edge e3 (k3,k4)', type: 'midpoint', joints: ['k3', 'k4', 'M3'] },
  { label: 'axis M0-M3 horizontal (rotation)', type: 'horizontal', joints: ['M0', 'M3'] },
  { label: 'axis symmetric about O: midpoint(M0,M3)=O', type: 'midpoint', joints: ['M0', 'M3', 'O'] },
  { label: 'concentric circle: centre = O', type: 'coincident', joints: ['cc', 'O'] },
  { label: 'concentric circle radius 25', type: 'distance', shape: 'ringA', isRadius: true, value: 25 },
  { label: 'second circle tangent to edge e1', type: 'tangent', line: 'e1', circle: 'ringB' },
  { label: 'second circle tangent to edge e2', type: 'tangent', line: 'e2', circle: 'ringB' },
  { label: 'second circle radius 8', type: 'distance', shape: 'ringB', isRadius: true, value: 8 },
];

export function build(S) {
  const O = point(S, 0, 0);
  // polygon-tool: the centre joint is the document origin's neighbour; the first corner is clicked 40 away
  const O2 = point(S, 3, 2);   // the click is slightly off the origin; the recipe puts it there
  const k0 = point(S, 3 + 40, 2);
  const built = polygon(S, O2, k0, 6);
  const names = { O: O2 };
  built.shapes.filter(s => !s.isConstruction).forEach((s, i) => { names['e' + i] = s.id; names['k' + i] = s.joints[0]; });
  S.state.joints.delete(O);   // (unused helper joint)
  names.M0 = point(S, 3 + 40 * Math.cos(Math.PI / 6) * Math.cos(Math.PI / 6) * 0 + 40 * 0.75, 2 + 40 * Math.sin(Math.PI / 3) * 0.5 * 0);
  const P = (id) => S.state.joints.get(id);
  const mid = (a, b) => point(S, (P(a).x + P(b).x) / 2, (P(a).y + P(b).y) / 2);
  S.state.joints.delete(names.M0);
  names.M0 = mid(names.k0, names.k1); names.M3 = mid(names.k3, names.k4);
  names.axis = 's_axis_' + names.M0;
  S.state.shapes.push({ id: names.axis, type: 'line', joints: [names.M0, names.M3], isConstruction: true });
  const cA = circle(S, 3, 2, 25), cB = circle(S, 3 + 20, 2 + 8, 8);
  names.cc = cA.c; names.ringA = cA.id; names.ringB = cB.id; names.cB = cB.c;
  return { names, probes: { redundant: { joints: ['k0', 'k3'] }, conflict: { joints: ['k0', 'k3'] }, delete: { type: 'distance', joints: ['O', 'k0'] } } };
}
