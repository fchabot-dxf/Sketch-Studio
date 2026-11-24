// tests/board-extent-879-node.test.js — TASK 879: with no Stock loop the board is THE DRAWING'S EXTENT (#core/geometry-bounds drawingExtent) + the
// declared margin (DEFAULT_STOCK.margin, 6 in by owner ruling, turn 3480), and the export page holds the drawing by that same extent.
// The owner's "bromont" (a Fusion import): an annular-sector slab, outline = an arc r 1524 and an arc r 1085.85, BOTH centred at (0, 0), the part
// at x -6..127, y 1082..1524 mm. Every joint counted (the arcs' centre joint and the sketch origin at (0, 0)) gave a board from y 0 to 1524: a
// 1.5 m strip with the part at one end.
//   1. drawingExtent(bromont) = the part's own box (the centres and the origin are not drawn).
//   2. the board (buildRelief with that extent and the declared stock, no Stock loop) = the part's box + 152.4 mm on every side.
//   3. the export page (exportShaperSVG's viewBox, one exterior cut on the part) = the part's box, not the strip.
//   4. true extents: a circle (centre ± r), an arc < 180 (its ends and its bulge, not its centre), a Bezier (its curve extremes, not its control
//      points); construction lines do not count; a hidden sketch's shapes do; a free point does not.
//   5. the margin is the declaration's: a stored 12.7 (the old default; no field sets it) does not win on a restore (apps/shaper/src/stock.js setStock).
import assert from 'node:assert';
import { drawingExtent } from '#core/geometry-bounds.js';
import { buildRelief, DEFAULT_STOCK } from '#core/relief-model.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { getStock, setStock } from '../apps/shaper/src/stock.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const boxEq = (got, want, msg, tol = 1e-6) => assert(got && ['minX', 'minY', 'maxX', 'maxY'].every((k) => near(got[k], want[k], tol)), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// THE BROMONT OUTLINE: the outer arc r 1524 from A (x 127) to B (x -6), the inner arc r 1085.85 from C to D on the same radii, the two radial lines.
const R1 = 1524, R2 = 1085.85;
const onR = (x, r) => ({ x, y: Math.sqrt(r * r - x * x) });
const A = onR(127, R1), B = onR(-6, R1);
const C = { x: A.x * R2 / R1, y: A.y * R2 / R1 }, D = { x: B.x * R2 / R1, y: B.y * R2 / R1 };
const PART = { minX: -6, maxX: 127, minY: Math.min(C.y, D.y), maxY: R1 }; // the outer arc crosses the +y axis: its top is r 1524
const bromont = () => ({
  joints: new Map([['j_origin', { x: 0, y: 0, fixed: true }], ['jc', { x: 0, y: 0 }], ['jA', A], ['jB', B], ['jC', C], ['jD', D]]),
  constraints: [],
  shapes: [
    { id: 'outer', type: 'arc', joints: ['jc', 'jA', 'jB'], sweep: true, largeArc: false }, // A (85.2 deg) -> B (90.2 deg): increasing angle
    { id: 'inner', type: 'arc', joints: ['jc', 'jC', 'jD'], sweep: true, largeArc: false },
    { id: 'rA', type: 'line', joints: ['jA', 'jC'] },
    { id: 'rB', type: 'line', joints: ['jB', 'jD'] },
  ],
});

// 1. the drawing's extent = the part
boxEq(drawingExtent(bromont()), PART, '1. bromont: the drawing extent is the part, not the arcs\' centre / the origin at (0, 0)');
console.log(`1. drawingExtent(bromont) = x ${PART.minX}..${PART.maxX}, y ${PART.minY.toFixed(3)}..${PART.maxY} ✓`);

// 2. the board = the part + the declared margin (6 in) on every side
assert.strictEqual(DEFAULT_STOCK.margin, 152.4, '2. the declared margin is 6 in (owner turn 3480)');
{
  const owner = { thickness: 38.1, width: null, height: null, margin: DEFAULT_STOCK.margin };
  const rel = buildRelief({ stock: owner, items: [], bounds: drawingExtent(bromont()) });
  const m = 152.4;
  boxEq(rel.stockBox, { minX: PART.minX - m, maxX: PART.maxX + m, minY: PART.minY - m, maxY: PART.maxY + m }, '2. bromont board = part box + 152.4 mm each side');
  assert.strictEqual(rel.stockBox.thickness, 38.1);
  console.log(`2. board = x ${rel.stockBox.minX.toFixed(1)}..${rel.stockBox.maxX.toFixed(1)}, y ${rel.stockBox.minY.toFixed(3)}..${rel.stockBox.maxY.toFixed(1)} (${(rel.stockBox.maxX - rel.stockBox.minX).toFixed(1)} x ${(rel.stockBox.maxY - rel.stockBox.minY).toFixed(1)} mm) ✓`);
}

// 3. the export page: one exterior cut on the part's loop -> the viewBox is the part's box
{
  const state = bromont();
  const loops = findLoops(state);
  assert.strictEqual(loops.length, 1, '3. the bromont outline is one loop');
  const svg = exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loops[0].id }, rec: { cutType: 'exterior' } }], encoding: [{ id: 'exterior', cutType: 'outside', fill: '#000000', stroke: 'none' }], docUnit: 'mm' });
  const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  boxEq({ minX: vb[0], minY: vb[1], maxX: vb[0] + vb[2], maxY: vb[1] + vb[3] }, PART, '3. export page = the part, not a strip from y 0', 1e-3);
  console.log(`3. export viewBox="${vb.join(' ')}" ✓`);
}

// 4. true extents of each kind; construction and free points left out; a hidden sketch kept
{
  const J = (o) => new Map([['j_origin', { x: 0, y: 0, fixed: true }], ...Object.entries(o)]);
  // a circle far from the origin: centre ± r
  boxEq(drawingExtent({ joints: J({ c: { x: 500, y: 300 } }), shapes: [{ id: 'k', type: 'circle', joints: ['c'], radius: 20 }] }), { minX: 480, minY: 280, maxX: 520, maxY: 320 }, '4a. circle');
  // an arc < 180 (a D on the chord y = 120 of the circle centre (300, 100) r 50... centre far below): its ends + its bulge apex, not its centre
  {
    const c = { x: 300, y: -400 }, r = 500, s = { x: 300 - 300, y: -400 + 400 }, e = { x: 300 + 300, y: -400 + 400 }; // ends (0, 0)... (600, 0), apex (300, 100)
    const box = drawingExtent({ joints: J({ c, s, e }), shapes: [{ id: 'a', type: 'arc', joints: ['c', 'e', 's'], sweep: true, largeArc: false }] });
    boxEq(box, { minX: 0, minY: 0, maxX: 600, maxY: 100 }, `4b. arc < 180 (span ${(2 * Math.asin(300 / r) * 180 / Math.PI).toFixed(1)} deg): its ends and apex, not its centre (300, -400)`);
  }
  // a Bezier: its curve's extremes, not its control points
  {
    const box = drawingExtent({ joints: J({ p: { x: 100, y: 100 }, q: { x: 200, y: 100 } }), shapes: [{ id: 'b', type: 'bezier', joints: ['p', 'q'], c1: [100, 200], c2: [200, 200] }] });
    boxEq(box, { minX: 100, minY: 100, maxX: 200, maxY: 175 }, '4c. bezier: y up to 175 (the curve), not 200 (the control points)');
  }
  // construction lines do not count; a free point does not; a hidden sketch's shape does
  {
    const st = {
      joints: J({ a: { x: 10, y: 10 }, b: { x: 20, y: 30 }, k1: { x: -900, y: -900 }, k2: { x: 900, y: 900 }, free: { x: 5000, y: 5000 }, h1: { x: 40, y: 10 }, h2: { x: 50, y: 12 } }),
      sketches: [{ id: 'sk1', visible: true }, { id: 'sk2', visible: false }],
      shapes: [
        { id: 'l', type: 'line', joints: ['a', 'b'], sketchId: 'sk1' },
        { id: 'cl', type: 'line', joints: ['k1', 'k2'], isConstruction: true, sketchId: 'sk1' },
        { id: 'hl', type: 'line', joints: ['h1', 'h2'], sketchId: 'sk2' },
      ],
    };
    boxEq(drawingExtent(st), { minX: 10, minY: 10, maxX: 50, maxY: 30 }, '4d. construction line and free point left out, the hidden sketch\'s line kept');
  }
  // nothing drawn (only construction, or only the origin) -> null
  assert.strictEqual(drawingExtent({ joints: J({}), shapes: [] }), null, '4e. empty design: no extent');
  assert.strictEqual(drawingExtent({ joints: J({ p: { x: 1, y: 1 } }), shapes: [] }), null, '4f. a free point alone is not drawn');
  assert.strictEqual(drawingExtent({ joints: J({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 } }), shapes: [{ id: 'cl', type: 'line', joints: ['a', 'b'], isConstruction: true }] }), null, '4g. construction only: no extent');
  console.log('4. circle / arc < 180 / bezier true extents; construction, free points, centres out; hidden sketch in ✓');
}

// 5. the margin is the declaration's: a restore of an older save (margin 12.7) keeps 152.4; the thickness it carries is read
{
  setStock({ thickness: 38.1, width: null, height: null, margin: 12.7 }); // bromont's saved stock
  const s = getStock();
  assert.strictEqual(s.margin, 152.4, '5. a stored margin (the old default) does not win over the declaration');
  assert.strictEqual(s.thickness, 38.1, '5. the stored thickness is read');
  setStock(null);
  console.log(`5. restored ${JSON.stringify(s)} ✓`);
}
console.log('board-extent-879: all passed');
