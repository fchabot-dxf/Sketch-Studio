// NEW DRAWING N6 -- A POLYGON WITH A FILLET ON EVERY CORNER: a 5-sided house outline drawn with the line tool (coincident corners), the Fillet tool
// applied to all five corners (each fillet arrives with its tangents, its virtual sharp V and a driving radius dimension), then dimensioned between
// the virtual sharps (the overall dimensions keep meaning the SHARP corner).
// (A pentagon made with the POLYGON tool cannot be used: Fillet refuses its corners, see finding N-F2 in docs/COVERAGE-AUDIT.md.)
import { polyline, fillet, shape, origin } from '../../audit/lib.js';

export const NAME = 'filleted-polygon';
export const TITLE = 'House pentagon, every corner filleted (R6)';

// vA..vE = the virtual sharps of corners A(0,0) B(60,0) C(60,40) D(30,70) E(0,40); s0..s4 = sides AB BC CD DE EA with their trimmed end joints
// s<k>a / s<k>b (first / second joint of the side).
export const RECIPE = [
  { label: 'sharp A at the origin', type: 'coincident', joints: ['vA', origin] },
  { label: 'AB horizontal', type: 'horizontal', joints: ['s0a', 's0b'] },
  { label: 'BC vertical', type: 'vertical', joints: ['s1a', 's1b'] },
  { label: 'EA vertical', type: 'vertical', joints: ['s4a', 's4b'] },
  { label: 'width vA-vB 60', type: 'distance', joints: ['vA', 'vB'], value: 60, dimMode: 'horizontal' },
  { label: 'right wall vB-vC 40', type: 'distance', joints: ['vB', 'vC'], value: 40, dimMode: 'vertical' },
  { label: 'left wall vA-vE 40', type: 'distance', joints: ['vA', 'vE'], value: 40, dimMode: 'vertical' },
  { label: 'roof sides equal: |vC vD| = |vD vE|', type: 'equal', joints: ['vC', 'vD', 'vD', 'vE'] },
  { label: 'apex 30 below vE', type: 'distance', joints: ['vE', 'vD'], value: 30, dimMode: 'vertical' },
];

export function build(S) {
  const seg = polyline(S, [[3, 2], [63, 2], [63, 42], [33, 72], [3, 42]])   // drawn 3,2 off the origin: a corner AT the origin makes applyFillet delete the origin joint (finding N-F1);
  const names = {};
  seg.forEach((s, i) => { names['s' + i] = s.id; });
  const corner = ['B', 'C', 'D', 'E', 'A'];   // side i meets side i+1 at corner[i]
  for (let i = 0; i < 5; i++) {
    const f = fillet(S, names['s' + i], names['s' + ((i + 1) % 5)], 6);
    names['v' + corner[i]] = f.V; names['a' + corner[i]] = f.arc;
  }
  for (let i = 0; i < 5; i++) { const j = shape(S, names['s' + i]).joints; names['s' + i + 'a'] = j[0]; names['s' + i + 'b'] = j[1]; }
  return { names, probes: { redundant: { joints: ['vB', 'vE'] }, conflict: { joints: ['vB', 'vE'] }, delete: { type: 'distance', joints: ['vA', 'vB'] } } };
}
