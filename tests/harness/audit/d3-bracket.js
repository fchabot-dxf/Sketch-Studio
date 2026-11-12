// DRAWING 3 -- BRACKET: an L-shaped closed outline of 8 lines (two chamfered arm ends), a slot (two semicircular arcs + two lines) in the
// horizontal arm, and one hole (circle) in the vertical arm.  A..H = the 8 outline corners; slot: CL/CR = arc centres, a1/b1 (left arc rim,
// top/bottom), a2/b2 (right arc rim, top/bottom).
import { point, polyline, line, circle, arc, origin } from './lib.js';

export const NAME = 'bracket';
export const TITLE = 'Bracket: 8-line L outline + slot + hole';

// `why` marks steps added while iterating towards nullity 0 (see docs/CONSTRAINT-AUDIT.md).
export const RECIPE = [
  // -- outline: 16 coordinates; H/V on six lines, A at the origin
  { label: 'A at the origin', type: 'coincident', joints: ['A', origin] },
  { label: 'AB horizontal', type: 'horizontal', joints: ['A', 'B'] },
  { label: 'CD vertical', type: 'vertical', joints: ['C', 'D'] },
  { label: 'DE horizontal', type: 'horizontal', joints: ['D', 'E'] },
  { label: 'EF vertical', type: 'vertical', joints: ['E', 'F'] },
  { label: 'FG horizontal', type: 'horizontal', joints: ['F', 'G'] },
  { label: 'HA vertical', type: 'vertical', joints: ['H', 'A'] },
  { label: 'AB length 130', type: 'distance', joints: ['A', 'B'], value: 130, dimMode: 'horizontal' },
  { label: 'chamfer BC across 10', type: 'distance', joints: ['B', 'C'], value: 10, dimMode: 'horizontal' },
  { label: 'chamfer BC up 10', type: 'distance', joints: ['B', 'C'], value: 10, dimMode: 'vertical' },
  { label: 'CD length 30', type: 'distance', joints: ['C', 'D'], value: 30, dimMode: 'vertical' },
  { label: 'DE length 100', type: 'distance', joints: ['E', 'D'], value: 100, dimMode: 'horizontal' },
  { label: 'EF length 100', type: 'distance', joints: ['E', 'F'], value: 100, dimMode: 'vertical' },
  { label: 'FG length 30', type: 'distance', joints: ['G', 'F'], value: 30, dimMode: 'horizontal' },
  { label: 'chamfer GH down 10', type: 'distance', joints: ['H', 'G'], value: 10, dimMode: 'vertical' },
  // -- slot: semicircle ends symmetric about their centre, lines tangent to both arcs
  { label: 'slot left end: midpoint(a1,b1)=CL', type: 'midpoint', joints: ['a1', 'b1', 'CL'] },
  { label: 'slot right end: midpoint(a2,b2)=CR', type: 'midpoint', joints: ['a2', 'b2', 'CR'] },
  { label: 'slot top line tangent to left arc', type: 'tangent', line: 'slotTop', circle: 'arcL' },
  { label: 'slot top line tangent to right arc', type: 'tangent', line: 'slotTop', circle: 'arcR' },
  { label: 'slot bottom line tangent to left arc', type: 'tangent', line: 'slotBottom', circle: 'arcL' },
  { label: 'slot bottom line tangent to right arc', type: 'tangent', line: 'slotBottom', circle: 'arcR' },
  { label: 'slot arcs equal radius', type: 'equal', shapes: ['arcR', 'arcL'] },
  { label: 'slot radius 8', type: 'distance', shape: 'arcL', isRadius: true, value: 8 },
  { label: 'slot axis horizontal CL-CR', type: 'horizontal', joints: ['CL', 'CR'], why: 'rotation of the slot' },
  { label: 'slot length CL-CR 50', type: 'distance', joints: ['CL', 'CR'], value: 50, dimMode: 'horizontal' },
  { label: 'slot position: CL x = 60 from A', type: 'distance', joints: [origin, 'CL'], value: 60, dimMode: 'horizontal' },
  { label: 'slot position: CL y = 20 from A', type: 'distance', joints: [origin, 'CL'], value: 20, dimMode: 'vertical' },
  // -- hole
  { label: 'hole x = 20 from A', type: 'distance', joints: [origin, 'hc'], value: 20, dimMode: 'horizontal' },
  { label: 'hole y = 90 from A', type: 'distance', joints: [origin, 'hc'], value: 90, dimMode: 'vertical' },
  { label: 'hole radius 8', type: 'distance', shape: 'hole', isRadius: true, value: 8 },
];

// opts.shared: the same outline with ONE joint per corner (what a DXF/SVG import or a weld produces) instead of the line tool's coincident pairs.
export function build(S, opts = {}) {
  // the outline is drawn with the line tool: 8 segments A->B->...->H->A, each owning its two joints, corners joined by coincident constraints.
  // A corner's name is the START joint of the segment that begins there (its partner, the end of the previous segment, is coincident with it).
  const pts = [[0, 0], [130, 0], [140, 10], [140, 40], [40, 40], [40, 140], [10, 140], [0, 130]];
  const ring = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const names = {};
  if (opts.shared) {
    const J = pts.map(([x, y]) => point(S, x, y));
    ring.forEach((k, i) => { names[k] = J[i]; names['l' + k + ring[(i + 1) % 8]] = line(S, J[i], J[(i + 1) % 8]); });
  } else {
    const seg = polyline(S, pts);
    ring.forEach((k, i) => { names[k] = seg[i].a; names['l' + k + ring[(i + 1) % 8]] = seg[i].id; });
  }
  // slot (centres on y=20): left centre (60,20), right centre (110,20), radius 8
  const CL = point(S, 60, 20), CR = point(S, 110, 20);
  const a1 = point(S, 60, 12), b1 = point(S, 60, 28), a2 = point(S, 110, 12), b2 = point(S, 110, 28);
  names.CL = CL; names.CR = CR; names.a1 = a1; names.b1 = b1; names.a2 = a2; names.b2 = b2;
  names.arcL = arc(S, CL, a1, b1);          // left semicircle: top rim -> bottom rim (around the left side)
  names.arcR = arc(S, CR, b2, a2);          // right semicircle: bottom rim -> top rim (around the right side)
  names.slotTop = line(S, a1, a2); names.slotBottom = line(S, b1, b2);
  const h = circle(S, 20, 90, 8);
  names.hc = h.c; names.hole = h.id;
  return { names, probes: { redundant: { joints: ['A', 'D'] }, conflict: { joints: ['A', 'D'] }, delete: { type: 'distance', joints: ['A', 'B'] } } };
}
