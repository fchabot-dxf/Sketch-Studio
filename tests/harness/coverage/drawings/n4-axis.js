// NEW DRAWING N4 -- CONSTRUCTION CENTRE LINE DRIVING SYMMETRY: a 5-sided house outline (line-tool polyline: coincident corners) mirrored about
// a vertical CONSTRUCTION axis. Each left/right pair is symmetric by `midpoint(L,R,M)` with M held on the axis and L-R horizontal; the apex is a
// point on the axis.
import { point, line, polyline, origin } from '../../audit/lib.js';

export const NAME = 'axis-symmetry';
export const TITLE = 'House outline symmetric about a construction centre line';

export const RECIPE = [
  { label: 'axis top A0 at the origin', type: 'coincident', joints: ['A0', origin] },
  { label: 'axis vertical', type: 'vertical', joints: ['A0', 'A1'] },
  { label: 'axis length 120', type: 'distance', joints: ['A0', 'A1'], value: 120, dimMode: 'aligned' },
  { label: 'apex T on the axis', type: 'pointOnLine', joint: 'T', shape: 'axis' },
  { label: 'apex 10 below A0', type: 'distance', joints: ['A0', 'T'], value: 10, dimMode: 'vertical' },
  { label: 'shoulder midpoint Mc on the axis', type: 'pointOnLine', joint: 'Mc', shape: 'axis' },
  { label: 'shoulders L2-R2 horizontal', type: 'horizontal', joints: ['L2', 'R2'] },
  { label: 'shoulders symmetric: midpoint(L2,R2)=Mc', type: 'midpoint', joints: ['L2', 'R2', 'Mc'] },
  { label: 'shoulder width 50', type: 'distance', joints: ['L2', 'R2'], value: 50, dimMode: 'horizontal' },
  { label: 'shoulder level 30 below A0', type: 'distance', joints: ['A0', 'Mc'], value: 30, dimMode: 'vertical' },
  { label: 'base midpoint Mb on the axis', type: 'pointOnLine', joint: 'Mb', shape: 'axis' },
  { label: 'base L1-R1 horizontal', type: 'horizontal', joints: ['L1', 'R1'] },
  { label: 'base symmetric: midpoint(L1,R1)=Mb', type: 'midpoint', joints: ['L1', 'R1', 'Mb'] },
  { label: 'base width 60', type: 'distance', joints: ['L1', 'R1'], value: 60, dimMode: 'horizontal' },
  { label: 'base level 80 below A0', type: 'distance', joints: ['A0', 'Mb'], value: 80, dimMode: 'vertical' },
];

export function build(S) {
  // outline T -> R2 -> R1 -> L1 -> L2 -> T drawn with the line tool; names are the START joint of each segment (T, R2, R1, L1, L2)
  const seg = polyline(S, [[0, 10], [25, 30], [30, 80], [-30, 80], [-25, 30]]);
  const names = { T: seg[0].a, R2: seg[1].a, R1: seg[2].a, L1: seg[3].a, L2: seg[4].a };
  names.A0 = point(S, 0, 0); names.A1 = point(S, 0, 120);
  names.axis = line(S, names.A0, names.A1, true);
  names.Mc = point(S, 0, 30); names.Mb = point(S, 0, 80);
  return { names, probes: { redundant: { joints: ['L1', 'R1'] }, conflict: { joints: ['L1', 'R1'] }, delete: { type: 'distance', joints: ['L1', 'R1'] } } };
}
