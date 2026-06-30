import { loopPolygon, polyArea, pointInPolygon, polygonContains } from '#core/loop-geometry.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const close = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const RECT = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  // 1. pointInPolygon — inside / outside
  {
    assert(pointInPolygon(RECT, { x: 5, y: 5 }) === true, 'centre inside');
    assert(pointInPolygon(RECT, { x: 15, y: 5 }) === false, 'right of → outside');
    assert(pointInPolygon(RECT, { x: 5, y: -1 }) === false, 'below → outside');
    assert(pointInPolygon(RECT, { x: 0.01, y: 5 }) === true, 'just inside the left edge');
    assert(pointInPolygon(RECT, { x: -0.01, y: 5 }) === false, 'just outside the left edge');
  }

  // 2. polygonContains — rect-in-rect true; disjoint / overlapping / equal / bigger false
  {
    assert(polygonContains(RECT, [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }]) === true, 'inner rect strictly contained');
    assert(polygonContains(RECT, [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }]) === false, 'disjoint → false');
    assert(polygonContains(RECT, [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 8 }, { x: 5, y: 8 }]) === false, 'overlapping (straddles a wall) → false');
    assert(polygonContains(RECT, RECT.map((p) => ({ ...p }))) === false, 'equal → false (not strict)');
    assert(polygonContains(RECT, [{ x: -5, y: -5 }, { x: 15, y: -5 }, { x: 15, y: 15 }, { x: -5, y: 15 }]) === false, 'bigger → false');
    assert(polygonContains(RECT, [{ x: 1, y: 1 }]) === false, '<3 points → false');
  }

  // 3. loopPolygon (PURE for LINE / CIRCLE loops — no DOM)
  {
    const J = new Map([['A', { x: 0, y: 0 }], ['B', { x: 10, y: 0 }], ['C', { x: 10, y: 6 }], ['D', { x: 0, y: 6 }]]);
    const state = { joints: J, shapes: [] };
    const shapeById = new Map([['AB', { id: 'AB', type: 'line' }], ['BC', { id: 'BC', type: 'line' }], ['CD', { id: 'CD', type: 'line' }], ['DA', { id: 'DA', type: 'line' }]]);
    const loop = { joints: ['A', 'B', 'C', 'D'], edges: ['AB', 'BC', 'CD', 'DA'] };
    const poly = loopPolygon(loop, state, shapeById);
    assert(poly.length === 4, 'line loop → 4 boundary points');
    assert(close(poly[0].x, 0) && close(poly[1].x, 10) && close(poly[2].y, 6), 'line loop traces the corners');
    assert(close(polyArea(poly), 60), 'line loop area = 10×6');

    const cJ = new Map([['Z', { x: 0, y: 0 }]]);
    const cstate = { joints: cJ, shapes: [] };
    const circ = { id: 'circ', type: 'circle', joints: ['Z'], radius: 5 };
    const cpoly = loopPolygon({ joints: ['Z'], edges: ['circ'] }, cstate, new Map([['circ', circ]]));
    assert(cpoly.length === 48, 'circle loop → 48 rim points');
    assert(cpoly.every((p) => close(Math.hypot(p.x, p.y), 5, 1e-9)), 'circle rim at radius 5');
    assert(close(polyArea(cpoly), Math.PI * 25, 0.5), 'circle area ≈ πr² (48-gon under-approximates slightly)');
  }

  console.log('loop-geometry tests passed ✅');
})().catch((e) => { console.error('loop-geometry tests failed ❌', e); process.exit(1); });
