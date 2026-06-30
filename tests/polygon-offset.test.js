import { offsetPolygon } from '#core/polygon-offset.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const close = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const area = (poly) => { let s = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y; return Math.abs(s / 2); };
  // does the polygon contain a point ~(x,y) (within tol)?
  const hasPt = (poly, x, y, tol = 1e-4) => poly.some((p) => close(p.x, x, tol) && close(p.y, y, tol));

  const SQ = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]; // CCW

  // 1. Square OUT by 2 → larger square, corners shifted by 2 outward
  {
    const o = offsetPolygon(SQ, 2);
    assert(o.length === 4, 'square out: 4 verts');
    assert(hasPt(o, -2, -2) && hasPt(o, 12, -2) && hasPt(o, 12, 12) && hasPt(o, -2, 12), 'square out corners +2');
    assert(close(area(o), 14 * 14), 'square out area = 14²');
  }

  // 2. Square IN by 2 → smaller square
  {
    const o = offsetPolygon(SQ, -2);
    assert(o.length === 4, 'square in: 4 verts');
    assert(hasPt(o, 2, 2) && hasPt(o, 8, 2) && hasPt(o, 8, 8) && hasPt(o, 2, 8), 'square in corners +2 inward');
    assert(close(area(o), 6 * 6), 'square in area = 6²');
  }

  // 3. Sign / direction: OUT grows, IN shrinks
  {
    assert(area(offsetPolygon(SQ, 1)) > area(SQ), 'out grows');
    assert(area(offsetPolygon(SQ, -1)) < area(SQ), 'in shrinks');
  }

  // 4. Triangle OUT → 3 verts, bigger
  {
    const T = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }];
    const o = offsetPolygon(T, 1);
    assert(o.length === 3, 'triangle out: 3 verts');
    assert(area(o) > area(T), 'triangle out grows');
  }

  // 5. Degenerate: inward offset larger than the shape → inverts → empty
  {
    assert(offsetPolygon(SQ, -6).length === 0, 'over-inset (>half) → empty');
    assert(offsetPolygon(SQ, -5).length === 0, 'inset to a point/inverted → empty');
  }

  // 6. Edge cases
  {
    assert(offsetPolygon(SQ, 0).length === 4, 'distance 0 → same polygon');
    assert(close(area(offsetPolygon(SQ, 0)), area(SQ)), 'distance 0 → unchanged area');
    assert(offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1).length === 0, '<3 points → []');
    assert(offsetPolygon(null, 1).length === 0, 'null → []');
  }

  // 7. CW input is handled (positive = OUTWARD regardless of winding)
  {
    const CW = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 }]; // CW
    assert(area(offsetPolygon(CW, 1)) > area(CW), 'CW out grows too');
  }

  console.log('polygon-offset tests passed ✅');
})().catch((e) => { console.error('polygon-offset tests failed ❌', e); process.exit(1); });
