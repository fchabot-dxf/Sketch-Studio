import { vcarveContours } from '#core/vcarve.js';
import { polyArea } from '#core/loop-geometry.js';
import { holesOfLoop } from '#core/group-model.js';

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

  // 9. VCARVE-5b: Frame (40×40 outer, 10×10 hole centered)
  // Distance across wall is 15mm -> medial ridge collapses at 7.5mm.
  // At dStep 1, tan 1: exactly 14 contours (pairs at depths 1..7 mm, 0 at 8 mm).
  {
    const outer = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
    const hole = [{ x: 15, y: 15 }, { x: 25, y: 15 }, { x: 25, y: 25 }, { x: 15, y: 25 }];
    const stack = vcarveContours(outer, { dStep: 1, halfAngleTan: 1, maxIters: 200, holes: [hole] });
    assert(stack.length === 14, `frame expected 14 contours, got ${stack.length}`);
    for (let d = 1; d <= 7; d++) {
      const atD = stack.filter((c) => Math.abs(c.depth - d) < 1e-6);
      assert(atD.length === 2, `depth ${d} has 2 contours (outer wall + hole wall), got ${atD.length}`);
    }
    const maxD = Math.max(...stack.map((c) => c.depth));
    assert(maxD === 7, `max depth is 7mm (ridge at 7.5mm), got ${maxD}`);
  }

  // 10. VCARVE-5b: Two-hole fixture (60×40 outer, two 10×10 holes side-by-side)
  {
    const outer = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }];
    const h1 = [{ x: 10, y: 15 }, { x: 20, y: 15 }, { x: 20, y: 25 }, { x: 10, y: 25 }];
    const h2 = [{ x: 40, y: 15 }, { x: 50, y: 15 }, { x: 50, y: 25 }, { x: 40, y: 25 }];
    const stack = vcarveContours(outer, { dStep: 1, halfAngleTan: 1, maxIters: 200, holes: [h1, h2] });
    assert(stack.length > 0, 'two-hole fixture produces contours');
    // at d=1, there are 3 rings (outer + 2 holes)
    const atD1 = stack.filter((c) => Math.abs(c.depth - 1) < 1e-6);
    assert(atD1.length === 3, `depth 1 has 3 contours (outer + 2 holes), got ${atD1.length}`);
  }

  // 11. VCARVE-5b: Bullseye — dot inside a hole is an uncut island (depth-2 nested island)
  {
    const state = {
      shapes: [
        { id: 's1', userGroupId: 'g1' }, { id: 's2', userGroupId: 'g1' }, { id: 's3', userGroupId: 'g1' },
      ],
      groups: [{ id: 'g1', name: 'Group 1' }],
    };
    const loops = [
      { id: 'loop-outer', edges: ['s1'] },
      { id: 'loop-hole', edges: ['s2'] },
      { id: 'loop-dot', edges: ['s3'] },
    ];
    const loopPolys = {
      'loop-outer': [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }],
      'loop-hole': [{ x: 15, y: 15 }, { x: 45, y: 15 }, { x: 45, y: 45 }, { x: 15, y: 45 }],
      'loop-dot': [{ x: 25, y: 25 }, { x: 35, y: 25 }, { x: 35, y: 35 }, { x: 25, y: 35 }],
    };
    const holes = holesOfLoop('loop-outer', loops, state, loopPolys);
    assert(holes.length === 1 && holes[0] === 'loop-hole', `outer loop hole must be loop-hole only, got ${JSON.stringify(holes)}`);
    // Carve loop-outer with its derived holes: loop-dot stays uncut
    const stack = vcarveContours(loopPolys['loop-outer'], { dStep: 1, halfAngleTan: 1, holes: holes.map((h) => loopPolys[h]) });
    assert(stack.length > 0, 'outer vcarve produced contours');
    // None of the contours touch inside the 20..40 inner area of the hole (dot is untouched)
    for (const c of stack) {
      for (const p of c.polygon) {
        // Point must NOT be strictly inside the dot (25 < x < 35, 25 < y < 35)
        const insideDot = p.x > 25.01 && p.x < 34.99 && p.y > 25.01 && p.y < 34.99;
        assert(!insideDot, `contour point (${p.x}, ${p.y}) encroached on uncut bullseye dot!`);
      }
    }
  }

  console.log('vcarve tests passed ✅');
})().catch((e) => { console.error('vcarve tests failed ❌', e); process.exit(1); });
