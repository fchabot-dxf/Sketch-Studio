// tests/pocket-two-stage.test.js — TASK 452: the pocket preview shows the Origin's real TWO-STAGE pocket.
// Stage 1 CLEARS with the cutter kept back from the wall by the Origin's automatic offset (1/4 of the cutter diameter,
// declared once on the pocket CUT_TYPES record) + the user's cutOffset; stage 2 is the FINISH pass (Inside cut at zero
// offset to the wall; Outside around islands). The export is unchanged (the auto offset is the Origin's, never written).
import assert from 'node:assert';
import { CUT_TYPES, effectiveCutRecord } from '../apps/shaper/src/shaper.js';
import { deriveCutFootprint, deriveCutTravel } from '#core/profile-model.js';
import { pointInPolygon } from '#core/loop-geometry.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const D = 6.35, r = D / 2, quarter = D / 4;
const bbox = (poly) => ({ minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)), minY: Math.min(...poly.map((p) => p.y)), maxY: Math.max(...poly.map((p) => p.y)) });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const inAny = (rings, p) => rings.some((ring) => pointInPolygon(ring, p));
const pocket = (cutOffset = 0, holes = []) => {
  const rec = effectiveCutRecord({ cutType: 'pocket', toolDia: D, cutOffset, cutDepth: 6 }); // what Prepare feeds the derivation
  const cut = { isCompound: true, outerPoly: rect(0, 0, 60, 40), holePolys: holes };
  return { rec, fp: deriveCutFootprint([cut], rec, null)[0] };
};

// the automatic offset is declared ONCE on the pocket record, and only there
assert.strictEqual(CUT_TYPES.find((t) => t.id === 'pocket').autoOffsetFraction, 0.25);
assert.deepStrictEqual(CUT_TYPES.filter((t) => t.autoOffsetFraction).map((t) => t.id), ['pocket']);
near(effectiveCutRecord({ cutType: 'pocket', toolDia: D, cutOffset: 0 }).autoOffset, quarter, 1e-9, 'autoOffset = D/4');
assert.strictEqual(effectiveCutRecord({ cutType: 'exterior', toolDia: D, cutOffset: 0 }).autoOffset, 0, 'other types: none');

// (1) 60x40 pocket, 1/4in bit, offset 0: the cutter is kept back r + D/4 from each wall, so the CLEARED area stops D/4 short of the wall
{
  const { fp } = pocket(0);
  const b = bbox(fp.rings[0]);
  near(b.minX, quarter, 1e-6, 'cleared area starts D/4 from the left wall'); near(b.maxX, 60 - quarter, 1e-6, 'right');
  near(b.minY, quarter, 1e-6, 'top'); near(b.maxY, 40 - quarter, 1e-6, 'bottom');
  // the tool CENTRE path (erosion) is r + D/4 from the wall: the cleared area minus the corner rounding is the centre box grown by r
  assert.ok(inAny([fp.rings[0]], { x: 30, y: 20 }) && !inAny([fp.rings[0]], { x: 0.5, y: 20 }), 'the strip next to the wall is NOT cleared');
}
// (2) a manual cutOffset X ADDS to it: D/4 + X
{
  const X = 2, { fp } = pocket(X);
  const b = bbox(fp.rings[0]);
  near(b.minX, quarter + X, 1e-6, 'D/4 + X from the wall'); near(b.maxY, 40 - quarter - X, 1e-6, 'bottom');
}
// (3) the FINISH ring spans the wall to 2r in (the Inside cut at zero offset), so the uncleared strip is inside it
{
  const { fp } = pocket(0);
  assert.ok(fp.finishRings.length > 0);
  assert.ok(inAny(fp.finishRings, { x: 0.1, y: 20 }) && inAny(fp.finishRings, { x: D - 0.1, y: 20 }) && !inAny(fp.finishRings, { x: D + 0.3, y: 20 }), 'finish band = wall .. 2r');
  assert.ok(inAny(fp.finishRings, { x: 0.5, y: 20 }) && !inAny([fp.rings[0]], { x: 0.5, y: 20 }), 'the uncleared strip is removed by the finish pass');
  // the finish centre path (the travel path) is r in from the wall, independent of the auto/manual offset
  const wallB = bbox(fp.wall); near(wallB.minX, r, 1e-6, 'finish wall path r from the wall');
  const withOffset = pocket(3).fp; near(bbox(withOffset.wall).minX, r, 1e-6, 'finish path ignores the manual offset (Inside cut at zero offset)');
}
// (4) an island gets the mirror: cleared area stays D/4 away from it, the finish (Outside, zero offset) band wraps it
{
  const isl = rect(25, 15, 10, 10);
  const { fp } = pocket(0, [isl]);
  assert.strictEqual(fp.rings.length, 2, 'outer + island ring');
  const ib = bbox(fp.rings[1]);
  near(ib.minX, 25 - quarter, 1e-6, 'island: cleared area stops D/4 short of the island'); near(ib.maxX, 35 + quarter, 1e-6, 'island right');
  assert.ok(inAny(fp.finishRings, { x: 24.2, y: 20 }) && inAny(fp.finishRings, { x: 25 - D + 0.1, y: 20 }), 'island finish band wraps the island, 2r wide');
  near(bbox(fp.islandCenters[0]).minX, 25 - r, 1e-6, 'island finish path r from the island');
}
// (5) the 449 travel stays on the FINISH path (Inside cut = clockwise wall, counter-clockwise island)
{
  const { fp } = pocket(0, [rect(25, 15, 10, 10)]);
  const t = deriveCutTravel([fp]);
  assert.deepStrictEqual(t.map((x) => [x.role, x.direction]), [['wall', 'cw'], ['island', 'ccw']]);
  near(bbox(t[0].path).minX, r, 1e-6, 'travel path = finish path');
}
// (6) a bit too big for the pocket: nothing cleared (no garbage)
{
  const rec = effectiveCutRecord({ cutType: 'pocket', toolDia: 38, cutOffset: 0 });
  const fp = deriveCutFootprint([{ isCompound: true, outerPoly: rect(0, 0, 60, 40), holePolys: [] }], rec, null)[0];
  assert.deepStrictEqual(fp.rings, []);
}
// (7) EXPORT unchanged: the Origin's automatic offset is never written, and the preview-only autoOffset field changes nothing
{
  const state = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 60, y: 0 }], ['c', { x: 60, y: 40 }], ['d', { x: 0, y: 40 }]]),
    shapes: [['s1', 'a', 'b'], ['s2', 'b', 'c'], ['s3', 'c', 'd'], ['s4', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })), constraints: [] };
  const loop = findLoops(state)[0];
  const exp = (rec) => exportShaperSVG({ state, entries: [{ target: { kind: 'loop', id: loop.id }, rec }], encoding: CUT_TYPES, docUnit: 'mm' });
  const plain = exp({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: D });
  assert.strictEqual(exp({ cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: D, autoOffset: 99 }), plain, 'autoOffset never reaches the export');
  assert.ok(!/autoOffset/i.test(plain) && !plain.includes('cutOffset'), 'no offset attribute for a pocket with offset 0 (the Origin adds its own)');
  assert.ok(exp({ cutType: 'pocket', cutDepth: 6, cutOffset: 2, toolDia: D }).includes('shaper:cutOffset="2mm"'), 'a manual offset is still written, as before');
}
console.log('pocket-two-stage: ok');
