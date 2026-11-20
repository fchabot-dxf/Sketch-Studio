// tests/pocket-raster-loop-835-node.test.js — TASK 835 (was 804b's file): RASTER + LOOP that CUTS BOTH WAYS (#core/pocket-clearing.js rasterLoops: the
// boundary of a comb of every other strip joined by corridors, the rings as balloons, the seam near the area's middle), over the shapes of
// tests/helpers/pocket-shapes-804.js + the owner's bow-tie (the 804b reconstruction of Butterfly_key_1: 3 x 2 in, waist 0.5 in, 1/8 in bit, 0.02 in
// allowance), checked with THE crossing check #core/path-crossings.js:
//  1. at Raster angle 0, the shape's allowance and none: ONE closed path per area, zero crossings, every pass cut ONCE from the area's edge to the area's
//     edge but for its corridor gaps (each at most half a stepover), no clean-up ring, the wall ring + each island's ring once (exactly r from the
//     wall), every point inside R inset by r, the leftover == Loop off's (and the raw swept area: no more than 0.03 mm² left), the plunge point (the start
//     mark = the first point) on a pass at least a stepover inside the area (the middle: the owner's bow-tie's neck, the square's middle), the wall ring
//     the last ring (only the closing stretch after it), and (with an allowance) no part of the loop but its rings runs on a ring (the wall traced once);
//  2. THE HARD RULE over the sweep shapes x angles 30 / 45 / 90 / 137 x allowance (the shape's / 0) x stepover 40 / 75 %: zero crossings, never refused,
//     one closed loop, every pass cut once, the leftover == Loop off's.
import assert from 'node:assert';
import { planClearing, clearingSettings } from '#core/pocket-clearing.js';
import { pathCrossings } from '#core/path-crossings.js';
import { regionsFromRings, diffRegions, regionsArea, offsetRegions } from '#core/plot/clip.js';
import { SHAPES_804, BIT_MM, ALLOW_MM } from './helpers/pocket-shapes-804.js';
import { passCoverage } from './helpers/raster-passes-835.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const IN = 25.4, close = (pts) => [...pts, pts[0]];
const SHAPES = {
  ownerBowtie: { outer: close([[-1.5, -1], [0, -0.25], [1.5, -1], [1.5, 1], [0, 0.25], [-1.5, 1]].map(([x, y]) => [x * IN, y * IN])), bit: 0.125 * IN, allowance: 0.02 * IN },
  ...SHAPES_804,
};
const settings = (sh, more = {}) => clearingSettings({ cutType: 'pocket', clearing: 'raster', toolDia: sh.bit || BIT_MM, stepover: 40, finishAllowance: sh.allowance ?? ALLOW_MM, rasterAngle: 0, ...more });
const planOf = (sh, more) => planClearing({ outer: sh.outer, holes: sh.holes || [] }, settings(sh, more));
// the distance from a point to the pocket's edge (its outer loop and islands)
const distTo = (sh) => {
  const loops = [sh.outer, ...(sh.holes || [])].map((r) => r.map(([x, y]) => ({ x, y })));
  const dseg = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy; const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy); };
  return (p) => { let m = Infinity; for (const l of loops) for (let i = 0; i + 1 < l.length; i++) m = Math.min(m, dseg(p, l[i], l[i + 1])); return m; };
};
const rawLeft = (sh, plan) => regionsArea(diffRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), plan.swept));
// every pass cut once, edge to edge, its corridor gaps at most half a stepover
const cutOnce = (on, off, s) => {
  const bad = (x) => !(x.twice <= 0.01 && x.ends <= 0.01 && x.gaps.every((g) => g <= s / 2 + 0.01));
  const cov = passCoverage(on.clear, off.clear.filter((c) => c.role === 'raster').map((c) => c.points));
  return { ok: !cov.some(bad), bad: cov.find(bad), gaps: cov.reduce((n, x) => n + x.gaps.length, 0) };
};
const table = [];

// ── 1. angle 0: the structure ──
for (const [name, sh] of Object.entries(SHAPES)) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) {
  const tag = `${name} raster Loop allowance ${allowance}`, more = { finishAllowance: allowance };
  const off = planOf(sh, more), on = planOf(sh, { ...more, loop: true }), st = settings(sh, more);
  const r = st.r, s = st.stepover, dist = distTo(sh), holes = (sh.holes || []).length;
  eq([on.loopRefused, on.loop, on.loopCount], [null, true, 1], `${tag}: one closed path (one area)`);
  eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings`);
  const c = on.clear[0], kinds = c.turns.map((t) => t.kind);
  ok(c.closed && c.points[0].x === c.points.at(-1).x && c.points[0].y === c.points.at(-1).y, `${tag}: closed (first point == last)`);
  const cov = cutOnce(on, off, s);
  ok(cov.ok, `${tag}: every pass cut once, edge to edge, but for its corridor gaps (${JSON.stringify(cov.bad)})`);
  ok(!kinds.includes('cleanup'), `${tag}: no clean-up ring`);
  eq(kinds.filter((k) => k === 'finish').length, 1 + holes, `${tag}: the wall ring + each island's ring, each once`);
  const after = c.turns.slice(c.turns.findLastIndex((t) => t.kind === 'finish') + 1);
  ok(after.length <= 2 && after.every((t) => t.kind === 'pass'), `${tag}: the last ring, then only the closing stretch (${JSON.stringify(after)})`);
  let worstIn = Infinity, worstF = 0;
  for (const p of c.points) worstIn = Math.min(worstIn, dist(p) - r);
  for (const t of c.turns.filter((u) => u.kind === 'finish')) for (const p of c.points.slice(t.start, t.end + 1)) worstF = Math.max(worstF, Math.abs(dist(p) - r));
  ok(worstIn >= -0.02, `${tag}: every point inside R inset by r (worst ${worstIn.toFixed(4)})`);
  ok(worstF <= 0.01, `${tag}: the rings exactly r from the wall / island (worst ${worstF.toFixed(5)})`);
  // THE WALL TRACED ONCE (owner turn 2991: "it goes over itself on every go around"): with an allowance, no part of the loop but its rings runs ON a ring
  if (allowance > 0) {
    const rings = offsetRegions(regionsFromRings([sh.outer, ...(sh.holes || [])], 'evenodd'), -r, 0.005).flatMap((g) => [g.outer, ...g.holes]).map((l) => l.map(([x, y]) => ({ x, y })));
    const onRing = (p) => rings.some((l) => { for (let i = 0; i + 1 < l.length; i++) { const a = l[i], b = l[i + 1], vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L)) : 0; if (Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy) <= 0.01) return true; } return false; });
    const inRing = new Array(c.points.length).fill(false);
    for (const t of c.turns.filter((u) => u.kind === 'finish')) for (let i = t.start; i < t.end; i++) inRing[i] = true;
    let along = 0;
    for (let i = 0; i + 1 < c.points.length; i++) { const p = c.points[i], q = c.points[i + 1]; if (!inRing[i] && onRing(p) && onRing(q) && onRing({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })) along += Math.hypot(q.x - p.x, q.y - p.y); }
    ok(along <= 0.05, `${tag}: no part of the loop but its rings runs on a ring (${along.toFixed(2)} mm does)`);
  }
  // (the sliver filter of the reported leftover rounds a sharp unreachable tip differently (the star with no allowance: up to 0.15 mm² either way): the raw
  // uncut area is held to 0.03 mm²)
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  const dRaw = rawLeft(sh, on) - rawLeft(sh, off);
  ok(dRaw <= 0.03, `${tag}: the raw uncut area no more than Loop off's + 0.03 mm² (${dRaw.toFixed(4)})`);
  // THE SEAM: the first point (the start mark, the plunge) on a pass, at least a stepover inside the area (never at its edge)
  eq(on.startPoint, c.points[0], `${tag}: the start mark is the loop's first point`);
  ok(c.turns.some((t) => t.kind === 'pass' && t.start <= 1), `${tag}: the loop starts on a pass (${JSON.stringify(c.turns[0])})`);
  const depth = dist(c.points[0]) - r - allowance;
  ok(depth >= s - 0.01, `${tag}: the plunge point at least a stepover inside the area (${depth.toFixed(2)} mm)`);
  if (name === 'ownerBowtie') ok(Math.abs(c.points[0].x) <= 0.4 * IN && Math.abs(c.points[0].y) <= 0.25 * IN, `${tag}: the plunge point in the bow-tie's middle (${JSON.stringify(c.points[0])})`);
  if (name === 'square') ok(Math.hypot(c.points[0].x - 40, c.points[0].y - 40) <= st.toolDia, `${tag}: the plunge point within a bit of the square's middle (${JSON.stringify(c.points[0])})`);
  table.push(`${tag}: 1 loop, ${off.passes} passes (${cov.gaps} corridor gaps), ${1 + holes} ring(s), plunge ${depth.toFixed(1)} mm inside, ${(on.length / 1000).toFixed(2)} m (Loop off ${((off.length + off.finishLength) / 1000).toFixed(2)} m)`);
}

// ── 2. THE HARD RULE over the sweep ──
let n = 0;
for (const [name, sh] of Object.entries(SHAPES)) for (const angle of [30, 45, 90, 137]) for (const allowance of [sh.allowance ?? ALLOW_MM, 0]) for (const stepover of [40, 75]) {
  const tag = `${name} angle ${angle} allowance ${allowance} stepover ${stepover}`, more = { rasterAngle: angle, finishAllowance: allowance, stepover };
  const off = planOf(sh, more), on = planOf(sh, { ...more, loop: true }), s = settings(sh, more).stepover;
  eq([on.loopRefused, on.loopCount], [null, 1], `${tag}: one closed loop, never refused`);
  eq(pathCrossings(on.clear.map((c) => ({ points: c.points, closed: true }))).count, 0, `${tag}: zero crossings`);
  const cov = cutOnce(on, off, s);
  ok(cov.ok, `${tag}: every pass cut once, edge to edge, but for its corridor gaps (${JSON.stringify(cov.bad)})`);
  ok(Math.abs(on.leftover.area - off.leftover.area) <= Math.max(0.2, off.leftover.area * 0.01), `${tag}: the leftover == Loop off's (${on.leftover.area.toFixed(3)} vs ${off.leftover.area.toFixed(3)} mm²)`);
  n++;
}
table.push(`the hard rule: ${n} more cases (angles 30 / 45 / 90 / 137 x allowance x stepover 40 / 75 %), zero crossings, none refused`);

console.log(table.join('\n'));
console.log(`pocket-raster-loop-835: ${checks} checks passed`);
