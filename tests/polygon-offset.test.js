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

  // ── SP1h3 robustness ──
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const segsCross = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  };
  const selfIntersects = (poly) => { const n = poly.length; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue; if (segsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true; } return false; };
  const maxR = (poly, cx, cy) => Math.max(...poly.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const minR = (poly, cx, cy) => Math.min(...poly.map((p) => Math.hypot(p.x - cx, p.y - cy)));

  // 8. L-shape (concave / reflex vertex): offset OUT + IN — correct, no spikes, no self-intersection
  {
    const L = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 }]; // CCW, reflex at (2,2)
    const o = offsetPolygon(L, 0.5);
    assert(o.length >= 3 && !selfIntersects(o), 'L out: valid, no self-intersect');
    assert(area(o) > area(L), 'L out grows');
    assert(maxR(o, 0, 0) < 12, 'L out: no runaway spike');
    const inn = offsetPolygon(L, -0.5);
    assert(inn.length >= 3 && !selfIntersects(inn), 'L in: valid, no self-intersect');
    assert(area(inn) < area(L), 'L in shrinks');
  }

  // 9. Arc-density: a many-vertex circle-ish polygon — offset stays smooth + ~concentric
  {
    const N = 32, R = 10, C = [];
    for (let i = 0; i < N; i++) { const t = (i / N) * 2 * Math.PI; C.push({ x: R * Math.cos(t), y: R * Math.sin(t) }); }
    const o = offsetPolygon(C, 2);
    assert(o.length >= 3 && !selfIntersects(o), 'circle out: smooth, no self-intersect');
    assert(close(maxR(o, 0, 0), 12, 0.3) && close(minR(o, 0, 0), 12, 0.3), 'circle out ~concentric r≈12');
    const inn = offsetPolygon(C, -2);
    assert(close(maxR(inn, 0, 0), 8, 0.3) && close(minR(inn, 0, 0), 8, 0.3), 'circle in ~concentric r≈8');
  }

  // 10. Thin-neck self-intersection: a thin rectangle inset past half-height → clean empty (no garbage)
  {
    const THIN = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 3 }, { x: 0, y: 3 }]; // 20×3
    assert(offsetPolygon(THIN, -2).length === 0, 'thin rect inset past half-height → empty (no garbage)');
    assert(offsetPolygon(THIN, -1).length >= 3, 'thin rect modest inset is valid'); // 1 < 1.5 half
  }

  // 11. Tiny / duplicate-vertex edges: collapsed cleanly, no NaN / spikes
  {
    const SQd = [{ x: 0, y: 0 }, { x: 0, y: 1e-9 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]; // a near-duplicate at start
    const o = offsetPolygon(SQd, 2);
    assert(o.length >= 3 && !selfIntersects(o), 'tiny-edge: valid, no self-intersect');
    assert(o.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'tiny-edge: no NaN');
    assert(area(o) > area(SQ) - 1, 'tiny-edge ~ square out');
  }

  console.log('polygon-offset tests passed ✅');
})().catch((e) => { console.error('polygon-offset tests failed ❌', e); process.exit(1); });
