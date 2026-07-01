import { vcarveContours } from '#core/vcarve.js';
import { polyArea } from '#core/loop-geometry.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  const square = (s) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
  const A = (poly) => Math.abs(polyArea(poly));

  // 1. a 40×40 square, dStep 2, 90° (tan 1) → nested contours, increasing depth, FINITE termination
  {
    const stack = vcarveContours(square(40), { dStep: 2, halfAngleTan: 1, maxIters: 1000 });
    assert(stack.length >= 3, 'multiple contours');
    assert(stack.length < 1000, 'FINITE — terminated before maxIters (the medial axis)');
    // nested: each contour strictly smaller than the previous (and than the boundary)
    let prev = A(square(40));
    for (const c of stack) { const a = A(c.polygon); assert(a < prev, 'each contour is smaller (nested inward)'); prev = a; }
    // the first inset (d=2) of a 40×40 → a 36×36 square
    assert(near(A(stack[0].polygon), 36 * 36, 2), 'first contour ≈ 36×36 inset');
    // depths increasing, = d (tan 1): 2, 4, 6, …
    for (let i = 0; i < stack.length; i++) assert(near(stack[i].depth, 2 * (i + 1)), 'depth = d/tan (tan 1) increasing');
  }

  // 2. depth math — 60° V-bit (halfAngleTan = tan30° ≈ 0.5774) → depth ≈ 1.732·d
  {
    const t = Math.tan(Math.PI / 6);
    const stack = vcarveContours(square(40), { dStep: 2, halfAngleTan: t });
    assert(near(stack[0].depth, 2 / t), '60° → depth ≈ 1.732·d');
    // and 90° gives depth = d (1:1) — sanity contrast
    const s90 = vcarveContours(square(40), { dStep: 2, halfAngleTan: 1 });
    assert(near(s90[0].depth, 2) && stack[0].depth > s90[0].depth, '60° cuts deeper than 90° at the same inset');
  }

  // 3. termination — the deepest (last) contour is near the center; the next inset collapses to []
  {
    const stack = vcarveContours(square(40), { dStep: 2, halfAngleTan: 1 });
    const last = stack[stack.length - 1];
    assert(A(last.polygon) < A(square(40)) / 10, 'last contour is small (near the medial axis ridge)');
  }

  // 4. a too-small region → the first inset already collapses → no contours
  {
    assert(vcarveContours(square(1), { dStep: 2, halfAngleTan: 1 }).length === 0, 'too-small region → empty');
  }

  // 5. guards — bad inputs → []
  {
    assert(vcarveContours([{ x: 0, y: 0 }, { x: 1, y: 0 }], { dStep: 1, halfAngleTan: 1 }).length === 0, '<3 pts → []');
    assert(vcarveContours(square(40), { dStep: 0, halfAngleTan: 1 }).length === 0, 'dStep 0 → []');
    assert(vcarveContours(square(40), { dStep: 2, halfAngleTan: 0 }).length === 0, 'halfAngleTan 0 → []');
    assert(vcarveContours(null, { dStep: 2, halfAngleTan: 1 }).length === 0, 'null boundary → []');
  }

  console.log('vcarve tests passed ✅');
})().catch((e) => { console.error('vcarve tests failed ❌', e); process.exit(1); });
