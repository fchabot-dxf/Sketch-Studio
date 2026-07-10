// packages/core/tests/plot-clip.test.js — PP-2b-1 oracle. Proves the vendored Clipper engine (#core/plot/clip.js)
// LOADS + RUNS in Node (via clipper-node-shim, no browser) and does the ROBUST ops #core/polygon-offset CANNOT:
// split a concave inset into multiple rings, concentric multi-ring, boolean union, and holes. The ring counts are
// the golden from running these same ops (matches the PP-2b gate probe: dumbbell inset -> 2, concentric -> 9).
import { insetPolygon, offsetRings, unionPolygons, toClipper, fromClipper, CLIP_SCALE, ClipperLib } from '#core/plot/clip.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  // Clipper loaded in Node — the shim aliased self -> globalThis before the browser UMD ran (else it throws).
  assert(ClipperLib && ClipperLib.Clipper, 'ClipperLib loaded in Node');
  assert(CLIP_SCALE === 1000, 'CLIP_SCALE = 1000');

  const square = [[0, 0], [20, 0], [20, 20], [0, 20]];
  // dumbbell: two 20x20 lobes joined by a height-4 neck (y 8..12) — an inset past the neck must SPLIT it.
  const dumbbell = [[0,0],[20,0],[20,8],[40,8],[40,0],[60,0],[60,20],[40,20],[40,12],[20,12],[20,20],[0,20]];

  // 1. control — a simple loop insets to ONE ring (parity with polygon-offset on simple loops).
  assert(insetPolygon(square, 3).length === 1, 'square inset 3 -> 1 ring');

  // 2. THE GAP polygon-offset cannot do — the inset SPLITS the pinched neck into 2 rings (probe golden).
  assert(insetPolygon(dumbbell, 3).length === 2, 'dumbbell inset 3 -> 2 rings (split)');

  // 3. concentric fill across BOTH lobes (probe golden = 9).
  assert(offsetRings(dumbbell, 2, 1, 500).length === 9, 'dumbbell concentric spacing 2 -> 9 rings');

  // 4. boolean union — two overlapping squares merge to ONE ring.
  const A = [[0, 0], [20, 0], [20, 20], [0, 20]], B = [[10, 10], [30, 10], [30, 30], [10, 30]];
  assert(unionPolygons([A, B]).length === 1, 'union of overlapping squares -> 1 ring');

  // 5. HOLES — an outer ring + an inner ring of OPPOSITE winding (nonZero) yields outer + hole = 2 rings.
  const outer = [[0, 0], [40, 0], [40, 40], [0, 40]];
  const innerRev = [[10, 10], [10, 30], [30, 30], [30, 10]];
  assert(unionPolygons([outer, innerRev]).length === 2, 'outer + reversed inner -> 2 rings (a hole)');

  // 6. helper round-trip: toClipper drops the dup closer, fromClipper re-closes.
  const rt = fromClipper(toClipper([[1, 2], [3, 4], [5, 6]]));
  assert(rt.length === 4 && rt[0][0] === 1 && rt[3][0] === 1, 'toClipper/fromClipper round-trip closes the ring');

  console.log('plot-clip (PP-2b-1) tests passed ✅');
})().catch((e) => { console.error('plot-clip tests failed ❌', e); process.exit(1); });
