// packages/core/tests/geometry-bounds.test.js — pure Node unit tests for #core/geometry-bounds.js (TASK 436b)

import assert from 'node:assert';
import { computeGeometryBounds } from '#core/geometry-bounds.js';

// Ensure zero DOM globals are touched (live app and Node tests run the exact same analytical code)
assert.strictEqual(typeof globalThis.document, 'undefined', 'pure #core test must run with no DOM');

// 1. Empty sketch (only j_origin) -> null
assert.strictEqual(
  computeGeometryBounds({ joints: new Map([['j_origin', { x: 0, y: 0, fixed: true }]]), shapes: [] }),
  null,
  'sketch with only j_origin has no geometry'
);

// 2. Joint-only sketch ignores j_origin, includes user joints
const jointOnly = computeGeometryBounds({
  joints: new Map([
    ['j_origin', { x: 0, y: 0, fixed: true }],
    ['j1', { x: 20, y: 30 }],
    ['j2', { x: 50, y: 70 }],
  ]),
  shapes: [],
});
assert.deepStrictEqual(jointOnly, { minX: 20, minY: 30, maxX: 50, maxY: 70, w: 30, h: 40 });

// 3. Line + circle ignores j_origin and expands circle by ±r
const lineCircle = computeGeometryBounds({
  joints: new Map([
    ['j_origin', { x: 0, y: 0, fixed: true }],
    ['ja', { x: 10, y: 20 }],
    ['jb', { x: 40, y: 30 }],
    ['jc', { x: 30, y: 25 }],
  ]),
  shapes: [
    { id: 'l1', type: 'line', joints: ['ja', 'jb'] },
    { id: 'c1', type: 'circle', joints: ['jc'], radius: 15 },
  ],
});
assert.deepStrictEqual(lineCircle, { minX: 10, minY: 10, maxX: 45, maxY: 40, w: 35, h: 30 });

// 4. Short arc (D-shape): excludes unrendered center (70, -20) & j_origin (0, 0), includes bulge apex (70, 30)
const shortArc = computeGeometryBounds({
  joints: new Map([
    ['j_origin', { x: 0, y: 0, fixed: true }],
    ['j_c', { x: 70, y: -20 }],
    ['j_s', { x: 40, y: 20 }],
    ['j_e', { x: 100, y: 20 }],
  ]),
  shapes: [
    { id: 's_chord', type: 'line', joints: ['j_s', 'j_e'] },
    { id: 's_arc', type: 'arc', subType: 'CENTER', joints: ['j_c', 'j_s', 'j_e'], largeArc: false, sweep: false },
  ],
});
assert(Math.abs(shortArc.minX - 40) < 1e-9);
assert(Math.abs(shortArc.maxX - 100) < 1e-9);
assert(Math.abs(shortArc.minY - 20) < 1e-9, 'arc center y=-20 and j_origin y=0 must be excluded');
assert(Math.abs(shortArc.maxY - 30) < 1e-9, 'cardinal bulge apex y=30 must be included');

// 5. Explicit largeArc=true, sweep=false (270° around (0,0) from (10,0) to (0,10) crosses -pi/2 and pi)
const largeCcw = computeGeometryBounds({
  joints: new Map([
    ['jc', { x: 0, y: 0 }],
    ['js', { x: 10, y: 0 }],
    ['je', { x: 0, y: 10 }],
  ]),
  shapes: [{ id: 'a_lg_ccw', type: 'arc', subType: 'CENTER', joints: ['jc', 'js', 'je'], largeArc: true, sweep: false }],
});
assert(Math.abs(largeCcw.minX - (-10)) < 1e-9);
assert(Math.abs(largeCcw.maxX - 10) < 1e-9);
assert(Math.abs(largeCcw.minY - (-10)) < 1e-9);
assert(Math.abs(largeCcw.maxY - 10) < 1e-9);

// 6. Explicit largeArc=true, sweep=true (W3C SVG selects reflected center (10, 10), crossing 0 -> (20, 10) and +pi/2 -> (10, 20))
const largeCw = computeGeometryBounds({
  joints: new Map([
    ['jc', { x: 0, y: 0 }],
    ['js', { x: 10, y: 0 }],
    ['je', { x: 0, y: 10 }],
  ]),
  shapes: [{ id: 'a_lg_cw', type: 'arc', subType: 'CENTER', joints: ['jc', 'js', 'je'], largeArc: true, sweep: true }],
});
assert(Math.abs(largeCw.minX - 0) < 1e-9);
assert(Math.abs(largeCw.maxX - 20) < 1e-9);
assert(Math.abs(largeCw.minY - 0) < 1e-9);
assert(Math.abs(largeCw.maxY - 20) < 1e-9);

// 7. Cubic bezier analytical derivative extrema (arch from (0,0) to (100,0) with c1=(0,100), c2=(100,100) peaks at t=0.5 -> y=75)
const bez = computeGeometryBounds({
  joints: new Map([
    ['p0', { x: 0, y: 0 }],
    ['p3', { x: 100, y: 0 }],
  ]),
  shapes: [{ id: 'b1', type: 'bezier', joints: ['p0', 'p3'], c1: [0, 100], c2: [100, 100] }],
});
assert(Math.abs(bez.minX - 0) < 1e-9);
assert(Math.abs(bez.maxX - 100) < 1e-9);
assert(Math.abs(bez.minY - 0) < 1e-9);
assert(Math.abs(bez.maxY - 75) < 1e-9, 'cubic bezier peak at t=0.5 is 0.75 * 100 = 75');

console.log('geometry-bounds pure #core tests passed ✅');
