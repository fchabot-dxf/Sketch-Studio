// tests/pocket-raster-loop-804b-node.test.js — TASK 804b: RASTER + LOOP with ZERO crossings (owner design 2595, #core/pocket-clearing.js rasterLoops),
// over the shapes of tests/helpers/pocket-shapes-804.js (bit 6 mm, stepover 40 %, the shape's allowance and none), checked with THE crossing check
// #core/path-crossings.js. (The hard rule over every pattern x Loop off / on, Raster Loop on included, is tests/pocket-nocross-804-node.test.js; this file
// is its own so each stays within the gate's per-file time.)
import assert from 'node:assert';
import { planClearing, clearingSettings } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';
import { CLEARING_REFUSED } from '../apps/shaper/src/cut-plan.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const settings = (sh, pattern, more = {}) => clearingSettings({ cutType: 'pocket', clearing: pattern, toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 0, ...more });
const planOf = (sh, pattern, more) => planClearing({ outer: sh.outer, holes: sh.holes || [] }, settings(sh, pattern, more));
// every written path of a plan: the clearing paths, and Loop off the finish pass (the wall's and the islands' centre loops)
const written = (plan) => [...plan.clear.map((c) => ({ points: c.points, closed: c.closed })), ...(plan.loop ? [] : [...plan.wall, ...plan.islands.flat()].map((w) => ({ points: w, closed: true })))];
// the distance from a point to the pocket's edge (its outer loop and islands)
const distTo = (sh) => {
  const loops = [sh.outer, ...(sh.holes || [])].map((r) => r.map(([x, y]) => ({ x, y })));
  const dseg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
  return (p) => { let m = Infinity; for (const l of loops) for (let i = 0; i + 1 < l.length; i++) m = Math.min(m, dseg(p, l[i], l[i + 1])); return m; };
};
const table = [];

// ── RASTER + LOOP (owner design 2595): per area ONE closed path, zero crossings, the passes row by row, then the step
// out to the WALL RING, the ring whole, back along it to the first pass's start; each island's ring a balloon; no clean-up ring; the leftover == Loop off's ──
for (const [name, sh] of Object.entries(SHAPES_804)) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
  const tag = `${name} raster Loop allowance ${allowance}`, more = { finishAllowance: allowance };
  const off = planOf(sh, 'raster', more), on = planOf(sh, 'raster', { ...more, loop: true });
  const r = (sh.bit || BIT_MM) / 2, dist = distTo(sh), holes = (sh.holes || []).length;
  eq([on.loopRefused, on.loop, on.loopCount], [null, true, 1], `${tag}: one closed path (one area)`);
  eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings`);
  const c = on.clear[0], kinds = c.turns.map((t) => t.kind);
  ok(c.closed && c.points[0].x === c.points.at(-1).x && c.points[0].y === c.points.at(-1).y, `${tag}: closed (first point == last)`);
  eq(c.points[0], off.clear[0].points[0], `${tag}: it starts where the first pass starts (the start mark)`);
  eq(kinds.filter((k) => k === 'pass').length, off.passes, `${tag}: every pass, in the zigzag order`);
  ok(!kinds.includes('cleanup'), `${tag}: no clean-up ring`);
  eq(kinds.filter((k) => k === 'finish').length, 1 + holes, `${tag}: the wall ring + each island's ring, each once`);
  eq(kinds.at(-1), 'finish', `${tag}: the wall ring is the last turn (then only the way back along it and the step in)`);
  let worstIn = Infinity, worstF = 0;
  for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
  for (const t of c.turns.filter((u) => u.kind === 'finish')) for (const p of c.points.slice(t.start, t.end + 1)) worstF = Math.max(worstF, Math.abs(dist(p) - r));
  ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
  ok(worstF <= 0.01, `${tag}: the rings exactly r from the wall / island (worst ${worstF.toFixed(5)})`);
  // (the same bound as the gradual Loop's in tests/pocket-nocross-804-node.test.js: the leftover's sliver filter rounds a sharp unreachable tip differently, e.g. the star with no allowance:
  // 58.947 vs 58.880 mm² after it, 58.683 vs 58.687 before it: the Loop leaves less)
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  table.push(`${tag}: 1 loop, ${off.passes} passes, ${1 + holes} ring(s), ${(on.length / 1000).toFixed(2)} m (Loop off ${((off.length + off.finishLength) / 1000).toFixed(2)} m)`);
}
{ // where no zigzag joined along the contour is crossing-free (the star at 45 degrees: its links interleave between the points), the Loop is REFUSED, never cut crossing
  const sh = SHAPES_804.star, on = planOf(sh, 'raster', { loop: true, rasterAngle: 45 });
  eq([on.loopRefused, on.loop], ['loop cross', false], 'star raster 45 degrees: the Loop refused (its zigzag links would cross)');
  eq(pathCrossings(written(on)).count, 0, 'star raster 45 degrees: what is written (the open passes + the clean-up ring + the wall) crosses nothing');
  ok(CLEARING_REFUSED[on.loopRefused], 'the refusal has its words (a plain line on the card)');
}

console.log(table.join('\n'));
console.log(`pocket-raster-loop-804b: ${checks} checks passed`);
