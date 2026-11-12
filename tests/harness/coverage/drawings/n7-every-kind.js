// NEW DRAWING N7 -- ONE DRAWING MIXING EVERY SHAPE KIND of inventory.shapeKinds: line, construction line, circle, arc (centre, start, end), fillet
// arc, polygon side, rect side, bezier, and a lone point joint. Each kind is placed with a few constraints; the aim is that the kinds coexist in
// ONE solve (they share the one global system).
import { point, line, circle, arc, rect, polygon, fillet, origin } from '../../audit/lib.js';
import { makeBezier } from '#core/shapes.js';

export const NAME = 'every-kind';
export const TITLE = 'Every shape kind in one drawing';

export const RECIPE = [
  // rect (rect side), its TR corner filleted (fillet arc)
  { label: 'rect corner c1 at the origin', type: 'coincident', joints: ['c1', origin] },
  { label: 'rect width 60', type: 'distance', joints: ['c1', 'c3'], value: 60, dimMode: 'horizontal' },
  { label: 'rect height V-c3 43 (V = the filleted TR sharp; the pair c1-c3 is taken by the width: F1)', type: 'distance', joints: ['V', 'c3'], value: 43, dimMode: 'vertical' },
  // hexagon (polygon side)
  { label: 'hexagon centre 150 right', type: 'distance', joints: [origin, 'hO'], value: 150, dimMode: 'horizontal' },
  { label: 'hexagon centre 20 down', type: 'distance', joints: ['c1', 'hO'], value: 20, dimMode: 'vertical' },
  { label: 'hexagon circumradius 20', type: 'distance', joints: ['hO', 'hk0'], value: 20, dimMode: 'aligned' },
  { label: 'hexagon first radial horizontal', type: 'horizontal', joints: ['hO', 'hk0'] },
  // circle
  { label: 'circle centre 40 right', type: 'distance', joints: [origin, 'cc'], value: 40, dimMode: 'horizontal' },
  { label: 'circle centre 90 down', type: 'distance', joints: ['c1', 'cc'], value: 90, dimMode: 'vertical' },
  { label: 'circle radius 10', type: 'distance', shape: 'ring', isRadius: true, value: 10 },
  // arc
  { label: 'arc centre 100 right', type: 'distance', joints: [origin, 'ac'], value: 100, dimMode: 'horizontal' },
  { label: 'arc centre 90 down', type: 'distance', joints: ['c1', 'ac'], value: 90, dimMode: 'vertical' },
  { label: 'arc radius 15', type: 'distance', shape: 'arc', isRadius: true, value: 15 },
  { label: 'arc start level with its centre', type: 'horizontal', joints: ['ac', 'as'] },
  // bezier hangs from the arc end to a free endpoint
  { label: 'bezier start = arc end', type: 'coincident', joints: ['bz0', 'ae'] },
  // plain line + construction line + point
  { label: 'line horizontal', type: 'horizontal', joints: ['u', 'v'] },
  { label: 'line length 30', type: 'distance', joints: ['u', 'v'], value: 30, dimMode: 'horizontal' },
  { label: 'construction line vertical', type: 'vertical', joints: ['m', 'n'] },
  { label: 'lone point on the line', type: 'pointOnLine', joint: 'pt', shape: 'plain' },
];

export function build(S) {
  const names = {};
  const r = rect(S, 3, 2, 60, 45);
  names.c1 = r.c1; names.c3 = r.c3; names.top = r.top; names.right = r.right;
  const f = fillet(S, r.top, r.right, 8); names.V = f.V; names.filletArc = f.arc;
  const hO = point(S, 150, 21), hk = point(S, 170, 21);
  const built = polygon(S, hO, hk, 6);
  names.hO = hO; built.shapes.filter(s => !s.isConstruction).forEach((s, i) => { names['h' + i] = s.id; names['hk' + i] = s.joints[0]; });
  const c = circle(S, 41, 89, 10); names.cc = c.c; names.ring = c.id;
  names.ac = point(S, 101, 91); names.as = point(S, 116, 91); names.ae = point(S, 101, 76);
  names.arc = arc(S, names.ac, names.as, names.ae);
  names.bz0 = point(S, 101, 76); names.bz1 = point(S, 140, 120);
  const bz = makeBezier(S.state.joints, names.bz0, names.bz1, [110, 90], [130, 100]);
  S.state.shapes.push(...bz.shapes); names.bezier = bz.shapes[0].id;
  names.u = point(S, 20, 130); names.v = point(S, 52, 132); names.plain = line(S, names.u, names.v);
  names.m = point(S, 80, 120); names.n = point(S, 82, 160); names.cline = line(S, names.m, names.n, true);
  names.pt = point(S, 35, 131);
  return { names, probes: { redundant: { joints: ['c1', 'c3'] }, conflict: { joints: ['c1', 'c3'] }, delete: { type: 'distance', joints: ['c1', 'c3'] } } };
}
