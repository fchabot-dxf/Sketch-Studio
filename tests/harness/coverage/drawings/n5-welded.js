// NEW DRAWING N5 -- OUTLINE WITH ONE JOINT PER CORNER (what a weld or an import produces, no coincident pairs): a T-shaped outline of 8 lines,
// every edge H or V, 6 dimensions.
import { point, line, origin } from '../../audit/lib.js';

export const NAME = 'welded-T';
export const TITLE = 'T outline, one shared joint per corner';

export const RECIPE = [
  { label: 'A at the origin', type: 'coincident', joints: ['A', origin] },
  { label: 'AB horizontal', type: 'horizontal', joints: ['A', 'B'] },
  { label: 'BC vertical', type: 'vertical', joints: ['B', 'C'] },
  { label: 'CD horizontal', type: 'horizontal', joints: ['C', 'D'] },
  { label: 'DE vertical', type: 'vertical', joints: ['D', 'E'] },
  { label: 'EF horizontal', type: 'horizontal', joints: ['E', 'F'] },
  { label: 'FG vertical', type: 'vertical', joints: ['F', 'G'] },
  { label: 'GH horizontal', type: 'horizontal', joints: ['G', 'H'] },
  { label: 'HA vertical', type: 'vertical', joints: ['H', 'A'] },
  { label: 'AB length 100', type: 'distance', joints: ['A', 'B'], value: 100, dimMode: 'horizontal' },
  { label: 'BC height 20', type: 'distance', joints: ['B', 'C'], value: 20, dimMode: 'vertical' },
  { label: 'CD length 40', type: 'distance', joints: ['D', 'C'], value: 40, dimMode: 'horizontal' },
  { label: 'DE height 60', type: 'distance', joints: ['D', 'E'], value: 60, dimMode: 'vertical' },
  { label: 'EF length 20', type: 'distance', joints: ['F', 'E'], value: 20, dimMode: 'horizontal' },
  { label: 'HA height 20', type: 'distance', joints: ['A', 'H'], value: 20, dimMode: 'vertical' },
];

export function build(S) {
  const pts = [[0, 0], [100, 0], [100, 20], [60, 20], [60, 80], [40, 80], [40, 20], [0, 20]];
  const ring = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const names = {};
  const J = pts.map(([x, y]) => point(S, x, y));
  ring.forEach((k, i) => { names[k] = J[i]; names['l' + k + ring[(i + 1) % 8]] = line(S, J[i], J[(i + 1) % 8]); });
  return { names, probes: { redundant: { joints: ['A', 'D'] }, conflict: { joints: ['A', 'D'] }, delete: { type: 'distance', joints: ['A', 'B'] } } };
}
