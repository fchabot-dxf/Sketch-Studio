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

  // 6. VCARVE-5a: Dumbbell split loop — 2 lobes joined by a thin neck
  // At d=1 neck is intact (1 contour); at d=2..9 neck closes and splits into 2 independent islands (17 contours total)
  {
    const dumbbell = [{x:0,y:0},{x:20,y:0},{x:20,y:8},{x:40,y:8},{x:40,y:0},{x:60,y:0},{x:60,y:20},{x:40,y:20},{x:40,y:12},{x:20,y:12},{x:20,y:20},{x:0,y:20}];
    const stack = vcarveContours(dumbbell, { dStep: 1, halfAngleTan: 1, maxIters: 200 });
    assert(stack.length === 17, `dumbbell expected 17 contours, got ${stack.length}`);
    const depths = stack.map((c) => c.depth);
    assert(depths[0] === 1, 'first contour at depth 1 (connected neck)');
    // from depth 2 to 9, each depth has 2 contours (one per lobe)
    for (let d = 2; d <= 9; d++) {
      const atD = stack.filter((c) => Math.abs(c.depth - d) < 1e-6);
      assert(atD.length === 2, `depth ${d} has 2 split contours (one per lobe), got ${atD.length}`);
    }
    assert(Math.max(...depths) === 9, 'max depth reached is 9mm');
  }

  // 7. VCARVE-5a: Waisted pinch — angled neck where polygon-offset failed at d=1.0 producing 1 contour total
  // Clipper splits into 2 lobes and yields 15 contours down to d=4.0
  {
    const waist = [{x:0,y:0},{x:20,y:0},{x:11,y:10},{x:20,y:20},{x:0,y:20},{x:9,y:10}];
    const stack = vcarveContours(waist, { dStep: 0.5, halfAngleTan: 1, maxIters: 200 });
    assert(stack.length === 15, `waist expected 15 contours, got ${stack.length}`);
    assert(stack[0].depth === 0.5, 'first contour at depth 0.5');
    // from depth 1.0 to 4.0, each depth step has 2 contours
    for (let i = 2; i <= 8; i++) {
      const d = i * 0.5;
      const atD = stack.filter((c) => Math.abs(c.depth - d) < 1e-6);
      assert(atD.length === 2, `depth ${d} has 2 split contours, got ${atD.length}`);
    }
  }

  // 8. VCARVE-5a: Acute-corner fixture (20-degree wedge)
  // Asserts corner sharpness: analytical apex displacement = d / sin(10°).
  // Clipper apex vertex must not displace by more than dStep / 2 = 0.25mm.
  {
    const L = 50, halfAngle = (10 * Math.PI) / 180;
    const y = L * Math.tan(halfAngle);
    const wedge = [{ x: 0, y: 0 }, { x: L, y: -y }, { x: L, y: y }];
    const stack = vcarveContours(wedge, { dStep: 0.5, halfAngleTan: 1, maxIters: 200 });
    assert(stack.length === 14, `20° wedge expected 14 contours, got ${stack.length}`);
    for (let i = 0; i < stack.length; i++) {
      const d = (i + 1) * 0.5;
      const wantApexX = d / Math.sin(halfAngle);
      // find vertex closest to the wedge bisector (y ≈ 0)
      const apex = stack[i].polygon.reduce((minP, p) => (p.x < minP.x ? p : minP), stack[i].polygon[0]);
      const diff = Math.abs(apex.x - wantApexX);
      assert(diff < 0.25, `contour ${i} apex diff ${diff.toFixed(4)}mm must be < dStep/2 (0.25mm)`);
    }
  }

  console.log('vcarve tests passed ✅');
})().catch((e) => { console.error('vcarve tests failed ❌', e); process.exit(1); });
