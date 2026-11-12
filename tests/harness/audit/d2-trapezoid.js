// DRAWING 2 -- TRAPEZOID: the owner's shape rebuilt from scratch (compare with tests/fixtures/owner-trapezoid.document.json):
// horizontal top (400) and bottom (150), two slanted sides, height 431.8, a vertical construction centre line with midpoints on the
// top and bottom edge, four R20 fillets (each fillet arrives with its own driving radius dimension, as in the owner's file).
import { line, point, polyline, fillet, shape, origin } from './lib.js';

export const NAME = 'trapezoid';
export const TITLE = 'Trapezoid: slanted sides, centre line, 4 fillets (owner shape)';

// Names: lines top/right/bottom/left; corner sharps vTL/vTR/vBR/vBL (the fillets' virtual sharps); tL,tR = trimmed top-line ends,
// bL,bR = trimmed bottom-line ends; P,Q = centre-line ends (top, bottom); axis = the construction centre line.
export const RECIPE = [
  { label: 'top line horizontal', type: 'horizontal', joints: ['tL', 'tR'] },
  { label: 'bottom line horizontal', type: 'horizontal', joints: ['bL', 'bR'] },
  { label: 'centre line vertical', type: 'vertical', joints: ['P', 'Q'] },
  { label: 'midpoint of top edge = P', type: 'midpoint', joints: ['tL', 'tR', 'P'] },
  { label: 'midpoint of bottom edge = Q', type: 'midpoint', joints: ['bL', 'bR', 'Q'] },
  { label: 'Q at the origin', type: 'coincident', joints: ['Q', origin] },
  { label: 'height (line-to-line) 431.8', type: 'distance', shapes: ['top', 'bottom'], value: 431.8 },
  { label: 'bottom width vBL-vBR 150', type: 'distance', joints: ['vBL', 'vBR'], value: 150, dimMode: 'aligned' },
  { label: 'top width vTL-vTR 400', type: 'distance', joints: ['vTL', 'vTR'], value: 400, dimMode: 'aligned' },
];

export function build(S) {
  // line-tool style: four segments TL->TR->BR->BL->TL, corners joined by coincident constraints
  const seg = polyline(S, [[-200, -431.8], [200, -431.8], [75, 0], [-75, 0]]);
  const names = { top: seg[0].id, right: seg[1].id, bottom: seg[2].id, left: seg[3].id };
  const f = { TL: fillet(S, names.left, names.top, 20), TR: fillet(S, names.top, names.right, 20), BR: fillet(S, names.right, names.bottom, 20), BL: fillet(S, names.bottom, names.left, 20) };
  for (const k of Object.keys(f)) { names['v' + k] = f[k].V; names['a' + k] = f[k].arc; }
  const T = shape(S, names.top).joints, B = shape(S, names.bottom).joints;
  names.tL = T[0]; names.tR = T[1]; names.bR = B[0]; names.bL = B[1];
  names.P = point(S, 0, -431.8); names.Q = point(S, 0, 0);
  names.axis = line(S, names.P, names.Q, true);
  return { names, probes: { redundant: { joints: ['vTL', 'vBR'] }, conflict: { joints: ['vTL', 'vBR'] }, delete: { type: 'distance', joints: ['vTL', 'vTR'] } } };
}
