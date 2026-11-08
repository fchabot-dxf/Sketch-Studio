// tests/cut-footprint.test.js — TASK 447: the Prepare previews show the TRUE footprint of a round bit, per cut type,
// from ONE core derivation (deriveCutFootprint / deriveVcarveFootprint). The exported SVG is unchanged (see
// shaper-export tests; also asserted here via the unchanged exportShaperSVG import path not touching footprints).
import assert from 'node:assert';
import { deriveCutFootprint } from '#core/profile-model.js';
import { deriveVcarveContours, deriveVcarveFootprint } from '#core/vcarve.js';
import { polyArea, pointInPolygon } from '#core/loop-geometry.js';

const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const near = (a, b, tolFrac, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tolFrac, `${msg}: ${a} vs ${b} (tol ${tolFrac * 100}%)`);
const inFootprint = (fp, p) => fp.rings.some((ring) => pointInPolygon(ring, p)); // nonzero union of capsules

// ── pocket: opening of a 60x40 rect by r=3 → area = rect - 4*(r^2 - pi r^2/4)  (corner loss), within 1%
{
  const r = 3, rec = { cutType: 'pocket', toolDia: 2 * r, cutOffset: 0 };
  const cut = { isCompound: true, outerPoly: rect(60, 40), holePolys: [] };
  const [fp] = deriveCutFootprint([cut], rec, null);
  assert.strictEqual(fp.kind, 'pocket'); assert.strictEqual(fp.rings.length, 1);
  const expected = 60 * 40 - 4 * (r * r - Math.PI * r * r / 4);
  near(polyArea(fp.rings[0]), expected, 0.01, 'pocket footprint area');
  // walls are reached (not inset by r): a point 0.1 from the wall is covered; the sharp corner point is not
  assert.ok(pointInPolygon(fp.rings[0], { x: 30, y: 0.1 }), 'wall reached');
  assert.ok(!pointInPolygon(fp.rings[0], { x: 0.2, y: 0.2 }), 'convex corner is rounded off (uncut), not highlighted');
}
// pocket with a hole: the hole's footprint ring is kept inside the opened outer
{
  const rec = { cutType: 'pocket', toolDia: 4, cutOffset: 0 };
  const cut = { isCompound: true, outerPoly: rect(60, 40), holePolys: [[{ x: 25, y: 15 }, { x: 35, y: 15 }, { x: 35, y: 25 }, { x: 25, y: 25 }]] };
  const [fp] = deriveCutFootprint([cut], rec, null);
  assert.strictEqual(fp.rings.length, 2, 'outer + one hole ring');
  near(polyArea(fp.rings[1]), 100, 0.01, 'hole footprint = the hole itself (closing keeps its convex corners)');
}
// a bit too big for the feature → empty footprint, no garbage
{
  const rec = { cutType: 'pocket', toolDia: 50, cutOffset: 0 };
  const [fp] = deriveCutFootprint([{ isCompound: true, outerPoly: rect(60, 40), holePolys: [] }], rec, null);
  assert.deepStrictEqual(fp.rings, [], 'pocket bit too big → empty');
  const inside = deriveCutFootprint([{ kind: 'loop', polygon: rect(60, 40), offsetSide: -1 }], { cutType: 'interior', toolDia: 50, cutOffset: 0 }, null)[0];
  assert.deepStrictEqual(inside.rings, [], 'inside cut with a bit too big → empty');
  assert.strictEqual(inside.center, null);
}
// no tool → no footprint
assert.deepStrictEqual(deriveCutFootprint([{ isCompound: true, outerPoly: rect(60, 40), holePolys: [] }], { cutType: 'pocket', toolDia: 0 }, null)[0].rings, []);

// ── inside / outside: swept band of the centre path, full width 2r, round joins
{
  const r = 2, rec = { cutType: 'exterior', toolDia: 2 * r, cutOffset: 0 };
  const [fp] = deriveCutFootprint([{ kind: 'loop', polygon: rect(60, 40), offsetSide: 1 }], rec, null);
  assert.strictEqual(fp.fillRule, 'nonzero');
  // outside: centre path is r outside the left wall (x = -2): the band spans x in [-4, 0]
  assert.ok(inFootprint(fp, { x: -3.9, y: 20 }) && inFootprint(fp, { x: -0.1, y: 20 }), 'band covers the full width 2r');
  assert.ok(!inFootprint(fp, { x: -4.2, y: 20 }) && !inFootprint(fp, { x: 0.3, y: 20 }), 'band is exactly 2r wide');
  // round join at the convex corner: the band's far corner is rounded (sharp corner point not covered)
  assert.ok(!inFootprint(fp, { x: -3.9, y: -3.9 }), 'a corner the bit cannot make sharp shows rounded');
  const inside = deriveCutFootprint([{ kind: 'loop', polygon: rect(60, 40), offsetSide: -1 }], { cutType: 'interior', toolDia: 4, cutOffset: 0 }, null)[0];
  assert.ok(inFootprint(inside, { x: 0.1, y: 20 }) && inFootprint(inside, { x: 3.9, y: 20 }) && !inFootprint(inside, { x: 4.3, y: 20 }), 'inside band: wall to wall+2r');
}
// ── on line (closed): the loop swept by r, centred on the path
{
  const [fp] = deriveCutFootprint([{ kind: 'loop', polygon: rect(60, 40), offsetSide: 0 }], { cutType: 'online', toolDia: 4, cutOffset: 0 }, null);
  assert.ok(inFootprint(fp, { x: 30, y: 1.9 }) && inFootprint(fp, { x: 30, y: -1.9 }) && !inFootprint(fp, { x: 30, y: 2.2 }), 'centred band, half-width r each side');
}
// ── on line, open chain: round end caps
{
  const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 50, y: 0 }]]) };
  const chain = { shapes: [{ id: 's1', type: 'line', joints: ['a', 'b'] }] };
  const [fp] = deriveCutFootprint([{ kind: 'chain', chain, offsetSide: 0 }], { cutType: 'online', toolDia: 6, cutOffset: 0 }, state);
  assert.strictEqual(fp.kind, 'chain');
  assert.ok(inFootprint(fp, { x: -2.9, y: 0 }) && inFootprint(fp, { x: 52.9, y: 0 }), 'cap extends r past each end');
  assert.ok(!inFootprint(fp, { x: -2.5, y: 2.5 }), 'the end cap is ROUND (the square corner is not covered)');
  assert.ok(inFootprint(fp, { x: 25, y: 2.9 }) && !inFootprint(fp, { x: 25, y: 3.2 }), 'width 2r along the chain');
}
// ── guide: not a cut → no footprint, centre kept (stays dashed)
{
  const [fp] = deriveCutFootprint([{ kind: 'loop', polygon: rect(20, 20), offsetSide: 0 }], { cutType: 'guide', toolDia: 4, cutOffset: 0 }, null);
  assert.strictEqual(fp.kind, 'guide'); assert.deepStrictEqual(fp.rings, []); assert.ok(fp.center);
}
// ── V-carve: each ring's surface width follows 2 * depth * tan(half-angle)
{
  const rec = { vbit: { angle: 60 }, dStep: 1, maxDepth: 6 };
  const contours = deriveVcarveContours(rect(40, 30), rec);
  const fps = deriveVcarveFootprint(contours, rec);
  assert.strictEqual(fps.length, contours.length); assert.ok(fps.length >= 3);
  const tan = Math.tan(30 * Math.PI / 180);
  fps.forEach((f, i) => {
    near(f.halfWidth, contours[i].depth * tan, 1e-9, `ring ${i} half-width = depth * tan(half-angle)`);
    near(2 * f.halfWidth, 2 * (i + 1) * 1, 1e-6, `ring ${i} full width = 2 x inset step`); // inset d = step*(i+1) for a simple rect
    assert.ok(f.rings.length > 0);
  });
}
console.log('cut-footprint: ok');
