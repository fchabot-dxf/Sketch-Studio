// DRAWING 1 -- PLATE: a 200 x 120 rectangle with all four corners filleted (equal R) and four circular holes near the corners
// (equal radii), symmetric about the centre (the document origin).
import { rect, fillet, circle, shape, residuals, describe, origin } from './lib.js';

export const NAME = 'plate';
export const TITLE = 'Plate: filleted rectangle + 4 holes';

// RECIPE (data). Targets are names from build(): rect lines top/right/bottom/left, corner sharps vTL/vTR/vBR/vBL, fillet arcs aTL.., hole
// centres c1..c4 (TL,TR,BR,BL) and hole circles h1..h4. `why` marks steps added while iterating towards nullity 0.
export const RECIPE = [
  { label: 'centre: midpoint(vTL,vBR) = origin', type: 'midpoint', joints: ['vTL', 'vBR', origin] },
  { label: 'width  vTL-vTR (horizontal) 200', type: 'distance', joints: ['vTL', 'vTR'], value: 200, dimMode: 'horizontal' },
  { label: 'height vTR-vBR (vertical) 120', type: 'distance', joints: ['vTR', 'vBR'], value: 120, dimMode: 'vertical' },
  { label: 'delete R dim of fillet TR (keep TL)', op: 'delete', match: { type: 'distance', isRadius: true, shape: 'aTR' } },
  { label: 'delete R dim of fillet BR', op: 'delete', match: { type: 'distance', isRadius: true, shape: 'aBR' } },
  { label: 'delete R dim of fillet BL', op: 'delete', match: { type: 'distance', isRadius: true, shape: 'aBL' } },
  { label: 'equal radius aTR = aTL', type: 'equal', shapes: ['aTR', 'aTL'] },
  { label: 'equal radius aBR = aTL', type: 'equal', shapes: ['aBR', 'aTL'] },
  { label: 'equal radius aBL = aTL', type: 'equal', shapes: ['aBL', 'aTL'] },
  { label: 'hole centres c1-c2 horizontal', type: 'horizontal', joints: ['c1', 'c2'] },
  { label: 'hole centres c2-c3 vertical', type: 'vertical', joints: ['c2', 'c3'] },
  { label: 'hole centres c3-c4 horizontal', type: 'horizontal', joints: ['c3', 'c4'] },
  { label: 'hole centres c4-c1 vertical', type: 'vertical', joints: ['c4', 'c1'] },
  { label: 'holes symmetric: midpoint(c1,c3) = origin', type: 'midpoint', joints: ['c1', 'c3', origin] },
  { label: 'hole spacing c1-c2 (horizontal) 140', type: 'distance', joints: ['c1', 'c2'], value: 140, dimMode: 'horizontal' },
  { label: 'hole spacing c2-c3 (vertical) 70', type: 'distance', joints: ['c2', 'c3'], value: 70, dimMode: 'vertical' },
  { label: 'hole radius h1 = 8', type: 'distance', shape: 'h1', isRadius: true, value: 8 },
  { label: 'equal radius h2 = h1', type: 'equal', shapes: ['h2', 'h1'] },
  { label: 'equal radius h3 = h1', type: 'equal', shapes: ['h3', 'h1'] },
  { label: 'equal radius h4 = h1', type: 'equal', shapes: ['h4', 'h1'] },
];

export function build(S) {
  const r = rect(S, -100, -60, 100, 60);
  const names = { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
  const f = {
    TR: fillet(S, r.top, r.right, 15), BR: fillet(S, r.right, r.bottom, 15),
    BL: fillet(S, r.bottom, r.left, 15), TL: fillet(S, r.left, r.top, 15),
  };
  for (const k of Object.keys(f)) { names['v' + k] = f[k].V; names['a' + k] = f[k].arc; }
  const hs = [[-70, -35], [70, -35], [70, 35], [-70, 35]].map(([x, y]) => circle(S, x, y, 8));
  hs.forEach((h, i) => { names['c' + (i + 1)] = h.c; names['h' + (i + 1)] = h.id; });
  return {
    names,
    probes: {
      redundant: { joints: ['vTL', 'vBR'] },    // the diagonal of a rectangle whose width and height are dimensioned
      conflict: { joints: ['vTL', 'vBR'] },
      delete: { type: 'distance', joints: ['vTL', 'vTR'] },
    },
    checks: [{
      // equal(h2,h1) is accepted; does it actually pull h2's radius to h1's? (a circle's radius is shape data, not a solver unknown)
      name: 'equal-radius on two circles drags the radius',
      run(S) {
        const h1 = shape(S, names.h1), h2 = shape(S, names.h2), old = h2.radius;
        h2.radius = 12; S.engine.solve(500);
        const got = h2.radius, r = residuals(S);
        h2.radius = old;
        return { pass: Math.abs(got - h1.radius) < 1e-6 && r.max < 1e-6, detail: `h2.radius set to 12, after solve = ${got} (h1 = ${h1.radius}); max residual ${r.max.toExponential(2)} (${describe(r.worst)})` };
      },
    }],
  };
}
